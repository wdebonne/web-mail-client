/**
 * Synchronisation du cache local.
 *
 * Deux tâches, délibérément séparées :
 *
 *  - **Le delta** (`runDeltaSync`) est court et fréquent. Il commence par une
 *    sonde `STATUS` sur une seule connexion IMAP par compte ; tant que
 *    UIDVALIDITY, UIDNEXT et le nombre de messages sont inchangés, il n'y a rien
 *    à télécharger et le cycle s'arrête là. C'est le cas courant.
 *
 *  - **Le backfill** (`runBackfill`) est long, rare et reprenable. Il remplit le
 *    cache en profondeur — tous les messages de tous les dossiers, corps
 *    compris — à la première synchro ou à l'ajout d'une boîte. Il cède la main
 *    entre chaque lot et persiste sa progression : fermer l'onglet ne coûte que
 *    le lot en cours.
 *
 * Le serveur ne conserve aucun état de synchronisation : c'est ici, face à
 * IndexedDB, qu'on sait ce qui était déjà connu et donc ce qui a changé.
 */

import { api } from '../api';
import type { SyncFolderState } from '../api';
import { offlineDB, makeEmailId, type FolderSyncRecord } from '../pwa/offlineDB';
import { useCacheStore } from '../stores/cacheStore';

/** Dossiers rarement utiles à pré-charger. Corbeille et Archive sont gardées : on les consulte. */
const SKIP_FOLDER_HINTS = ['\\All', '\\Junk'];

/** Fenêtre au-delà de laquelle un cache est considéré comme périmé au démarrage. */
export const CACHE_FRESHNESS_MS = 15 * 60 * 1000;

/** Cadence de la boucle de delta en arrière-plan. */
export const DELTA_INTERVAL_MS = 60 * 1000;

/**
 * Sans CONDSTORE, détecter un changement de drapeau impose de relire tout le
 * dossier. On ne le fait donc pas à chaque minute : un message lu depuis un
 * téléphone peut rester « non lu » ici quelques minutes sans que ce soit grave,
 * alors qu'un message *reçu* doit apparaître tout de suite — et lui est détecté
 * par UIDNEXT, qui ne coûte rien.
 */
const FLAG_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/** Au-delà, les nouveaux messages partent au backfill plutôt que d'allonger le delta. */
const DELTA_MAX_NEW = 500;

/** Limites imposées par les routes serveur (voir server/src/routes/sync.ts). */
const ENVELOPE_BATCH = 500;
const BODY_BATCH = 25;

/** Ré-indexation des enregistrements hérités : taille de lot. */
const REINDEX_BATCH = 500;

/** Au-delà de ce taux d'occupation, on évince les corps les plus anciens. */
const QUOTA_HIGH_WATER = 0.85;

let deltaRun: Promise<DeltaOutcome> | null = null;
let backfillRun: Promise<void> | null = null;
let loopTimer: ReturnType<typeof setInterval> | null = null;

export interface FolderDelta {
  accountId: string;
  folder: string;
  added: number;
  removed: number;
  flagged: number;
}

export interface DeltaOutcome {
  /** Dossiers réellement modifiés — de quoi patcher les listes déjà affichées. */
  changed: FolderDelta[];
}

type DeltaListener = (outcome: DeltaOutcome) => void;
const deltaListeners = new Set<DeltaListener>();

/**
 * S'abonne aux deltas appliqués. C'est ce qui remplace le sondage périodique de
 * la liste : au lieu de redemander la page 1 toutes les 30 secondes à tout
 * hasard, l'interface n'est prévenue que lorsqu'un dossier a réellement bougé.
 */
export function onDeltaApplied(listener: DeltaListener): () => void {
  deltaListeners.add(listener);
  return () => {
    deltaListeners.delete(listener);
  };
}

function emitDelta(outcome: DeltaOutcome) {
  if (!outcome.changed.length) return;
  for (const listener of deltaListeners) {
    try {
      listener(outcome);
    } catch (err) {
      console.warn('[cache] delta listener failed', err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilitaires
// ═══════════════════════════════════════════════════════════════════════════

function bitsToFlags(bits: number) {
  return {
    seen: (bits & 1) !== 0,
    flagged: (bits & 2) !== 0,
    answered: (bits & 4) !== 0,
    draft: (bits & 8) !== 0,
  };
}

function shouldSkipFolder(folder: any): boolean {
  if (!folder) return true;
  const flags: string[] = Array.isArray(folder.flags) ? folder.flags : [];
  const specialUse: string = folder.specialUse || '';
  return SKIP_FOLDER_HINTS.some((hint) => specialUse === hint || flags.includes(hint));
}

/** Rend la main au navigateur entre deux lots, pour que l'interface reste vivante. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 0);
  });
}

export async function refreshCacheStats() {
  const stats = await offlineDB.getStats();
  useCacheStore.getState().setStats(stats);
  return stats;
}

export async function isCacheFresh(maxAgeMs = CACHE_FRESHNESS_MS): Promise<boolean> {
  const last = await offlineDB.getMeta<string>('lastSync');
  if (!last) return false;
  const ts = Date.parse(last);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < maxAgeMs;
}

/**
 * Charge l'arbre des dossiers d'un compte, en réutilisant le cache local quand
 * il est frais. Sert à connaître les drapeaux `\All` / `\Junk` — le STATUS seul
 * ne les donne pas.
 */
async function getFolderTree(accountId: string): Promise<any[]> {
  const cached = await offlineDB.getFoldersCache(accountId);
  if (cached?.length) return cached;
  try {
    const folders = await api.getFolders(accountId);
    await offlineDB.cacheFolders(accountId, folders || []);
    return folders || [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Delta
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Synchronisation incrémentale. Renvoie la liste des dossiers réellement
 * modifiés, pour que l'appelant puisse rafraîchir ce qui est à l'écran sans
 * tout invalider.
 */
export function runDeltaSync(
  opts: { force?: boolean; priorityFolder?: { accountId: string; folder: string } } = {},
): Promise<DeltaOutcome> {
  if (deltaRun) return deltaRun;
  deltaRun = doDeltaSync(opts).finally(() => {
    deltaRun = null;
  });
  return deltaRun;
}

async function doDeltaSync(opts: {
  force?: boolean;
  priorityFolder?: { accountId: string; folder: string };
}): Promise<DeltaOutcome> {
  const store = useCacheStore.getState();
  const outcome: DeltaOutcome = { changed: [] };

  store.patchTask('delta', {
    running: true,
    phase: 'running',
    error: null,
    progress: 0,
    processed: 0,
    label: 'Vérification…',
  });

  try {
    const accounts = await api.getAccounts();
    if (!accounts?.length) {
      store.patchTask('delta', { running: false, phase: 'done', progress: 100, label: 'Aucun compte' });
      return outcome;
    }

    store.patchTask('delta', { total: accounts.length });
    let done = 0;

    for (const account of accounts) {
      try {
        const tree = await getFolderTree(account.id);
        const skip = new Set(
          tree.filter((f: any) => shouldSkipFolder(f)).map((f: any) => f.path),
        );

        const { folders: remoteState } = await api.syncFolderState(account.id);

        for (const [path, remote] of Object.entries(remoteState)) {
          if (skip.has(path)) continue;
          store.patchTask('delta', {
            label: `${path} — ${account.email || account.name || ''}`.trim(),
          });
          const change = await syncFolderDelta(account.id, path, remote, opts);
          if (change) outcome.changed.push(change);
        }
      } catch (err) {
        // Un compte injoignable ne doit pas empêcher les autres de se mettre à jour.
        console.warn('[cache] delta failed for', account?.email, err);
      }

      done += 1;
      store.patchTask('delta', {
        processed: done,
        progress: Math.round((done / accounts.length) * 100),
      });
    }

    await offlineDB.setMeta('lastSync', new Date().toISOString());
    store.patchTask('delta', {
      running: false,
      phase: 'done',
      progress: 100,
      label: outcome.changed.length
        ? `${outcome.changed.length} dossier(s) mis à jour`
        : 'Déjà à jour',
    });
  } catch (err: any) {
    console.error('[cache] delta sync failed', err);
    store.patchTask('delta', {
      running: false,
      phase: 'error',
      error: err?.message || 'Erreur inconnue',
      label: 'Échec de la synchronisation',
    });
  }

  await refreshCacheStats().catch(() => {});
  emitDelta(outcome);
  return outcome;
}

/**
 * Delta d'un dossier. Renvoie `null` quand rien n'a bougé — c'est le chemin
 * qu'on veut voir emprunté la plupart du temps.
 */
async function syncFolderDelta(
  accountId: string,
  folder: string,
  remote: SyncFolderState,
  opts: { force?: boolean; priorityFolder?: { accountId: string; folder: string } },
): Promise<FolderDelta | null> {
  let local = await offlineDB.getSyncState(accountId, folder);

  // UIDVALIDITY a changé : la numérotation du dossier est repartie de zéro.
  // On purge CE dossier, et lui seul — un changement ici ne dit rien des autres.
  if (local?.uidValidity && local.uidValidity !== remote.uidValidity) {
    await offlineDB.deleteFolderData(accountId, folder);
    local = undefined;
  }

  const isPriority =
    opts.priorityFolder?.accountId === accountId && opts.priorityFolder?.folder === folder;

  if (local && !opts.force) {
    // UIDNEXT ne fait que croître : inchangé, aucun message n'a été ajouté.
    // Combiné à un nombre de messages inchangé, cela exclut aussi toute
    // suppression. Le raccourci est exact, pas heuristique.
    const structurallyUnchanged =
      local.uidNext === remote.uidNext && local.messageCount === remote.messages;

    if (structurallyUnchanged) {
      // Avec CONDSTORE, un MODSEQ identique garantit que même les drapeaux
      // n'ont pas bougé : on ne demande rien du tout.
      if (remote.highestModseq && local.highestModseq === remote.highestModseq) return null;

      const sweptAgo = local.lastFlagSweepAt
        ? Date.now() - Date.parse(local.lastFlagSweepAt)
        : Number.POSITIVE_INFINITY;
      if (!isPriority && sweptAgo < FLAG_SWEEP_INTERVAL_MS) return null;
    }
  }

  const snapshot = await api.syncUidFlags(accountId, folder);

  // Le dossier a pu changer entre la sonde STATUS et ce relevé.
  if (local?.uidValidity && local.uidValidity !== snapshot.uidValidity) {
    await offlineDB.deleteFolderData(accountId, folder);
    local = undefined;
  }

  const localUids = await offlineDB.getFolderUids(accountId, folder);
  const remoteUids = new Map(snapshot.uids);

  const removed: number[] = [];
  for (const uid of localUids.keys()) {
    if (!remoteUids.has(uid)) removed.push(uid);
  }

  const added: number[] = [];
  const flagChanges: Array<{ uid: number; flags: Record<string, boolean> }> = [];
  for (const [uid, bits] of remoteUids) {
    const localBits = localUids.get(uid);
    if (localBits === undefined) added.push(uid);
    else if (localBits !== bits) flagChanges.push({ uid, flags: bitsToFlags(bits) });
  }

  if (removed.length) await offlineDB.deleteEmails(accountId, folder, removed);
  if (flagChanges.length) await offlineDB.updateFlags(accountId, folder, flagChanges);

  // Les plus récents d'abord : ce sont eux qu'on veut voir apparaître tout de
  // suite. Le reste devient la file du backfill.
  added.sort((a, b) => b - a);
  const inline = added.slice(0, DELTA_MAX_NEW);
  const deferred = added.slice(DELTA_MAX_NEW);

  for (let i = 0; i < inline.length; i += ENVELOPE_BATCH) {
    const batch = inline.slice(i, i + ENVELOPE_BATCH);
    const { messages } = await api.syncEnvelopes(accountId, folder, batch);
    await offlineDB.putEnvelopes(
      messages.map((m: any) => ({
        ...m,
        id: makeEmailId(accountId, folder, m.uid),
        accountId,
        folder,
      })),
    );
  }

  // Un vrai delta (quelques messages arrivés) récupère aussi leur corps tout de
  // suite, pour qu'un mail à peine reçu soit immédiatement cherchable et
  // lisible hors-ligne. Un amorçage de dossier, lui, laisse ça au backfill.
  if (inline.length > 0 && inline.length <= BODY_BATCH) {
    try {
      const { bodies } = await api.syncBodies(accountId, folder, inline);
      await offlineDB.putBodies(accountId, folder, bodies);
    } catch {
      // Sans gravité : le backfill repassera.
    }
  }

  const highestUid = snapshot.uids.length ? snapshot.uids[snapshot.uids.length - 1][0] : 0;
  const record: FolderSyncRecord = {
    accountId,
    folder,
    uidValidity: snapshot.uidValidity,
    uidNext: snapshot.uidNext,
    messageCount: snapshot.messages,
    highestModseq: snapshot.highestModseq,
    highestUid,
    backfillPending: deferred,
    backfillTotal: snapshot.messages,
    backfillDone: deferred.length === 0,
    lastDeltaAt: new Date().toISOString(),
    lastFlagSweepAt: new Date().toISOString(),
  };
  await offlineDB.putSyncState(record);

  if (!added.length && !removed.length && !flagChanges.length) return null;
  return {
    accountId,
    folder,
    added: inline.length,
    removed: removed.length,
    flagged: flagChanges.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Backfill
// ═══════════════════════════════════════════════════════════════════════════

function backfillShouldStop(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return useCacheStore.getState().backfillPaused;
}

export function pauseBackfill() {
  useCacheStore.getState().setBackfillPaused(true);
}

export function resumeBackfill() {
  useCacheStore.getState().setBackfillPaused(false);
  void runBackfill().catch(() => {});
}

/**
 * Remplit le cache en profondeur : tous les en-têtes restants, puis tous les
 * corps manquants, dossier par dossier.
 *
 * Entièrement reprenable. Les en-têtes suivent `backfillPending`, persisté après
 * chaque lot ; les corps n'ont besoin d'aucun curseur — le drapeau `hasBody`
 * porté par chaque message *est* la progression.
 */
export function runBackfill(): Promise<void> {
  if (backfillRun) return backfillRun;
  backfillRun = doBackfill().finally(() => {
    backfillRun = null;
  });
  return backfillRun;
}

async function doBackfill(): Promise<void> {
  const store = useCacheStore.getState();
  store.patchTask('backfill', {
    running: true,
    phase: 'running',
    error: null,
    progress: 0,
    processed: 0,
    label: 'Analyse du cache…',
  });

  try {
    await offlineDB.requestPersistence();

    const states = await offlineDB.getAllSyncStates();
    const work: Array<{ state: FolderSyncRecord; remaining: number }> = [];

    for (const state of states) {
      const envelopes = state.backfillPending?.length || 0;
      const [total, withBody] = await Promise.all([
        offlineDB.countFolder(state.accountId, state.folder),
        offlineDB.countFolderBodies(state.accountId, state.folder),
      ]);
      const remaining = envelopes + Math.max(0, total - withBody);
      if (remaining > 0) work.push({ state, remaining });
    }

    if (!work.length) {
      store.patchTask('backfill', {
        running: false,
        phase: 'done',
        progress: 100,
        label: 'Cache complet',
      });
      return;
    }

    const grandTotal = work.reduce((acc, w) => acc + w.remaining, 0);
    let processed = 0;
    store.patchTask('backfill', { total: grandTotal });

    for (const { state } of work) {
      if (backfillShouldStop()) break;
      await backfillFolder(state, (count) => {
        processed += count;
        store.patchTask('backfill', {
          processed,
          progress: Math.min(99, Math.round((processed / grandTotal) * 100)),
        });
      });
    }

    const stopped = backfillShouldStop();
    store.patchTask('backfill', {
      running: false,
      phase: 'done',
      progress: stopped ? Math.min(99, Math.round((processed / grandTotal) * 100)) : 100,
      label: stopped ? 'Interrompu — reprise possible' : 'Cache complet',
    });
  } catch (err: any) {
    console.error('[cache] backfill failed', err);
    store.patchTask('backfill', {
      running: false,
      phase: 'error',
      error: err?.message || 'Erreur inconnue',
      label: 'Échec du remplissage',
    });
  }

  await refreshCacheStats().catch(() => {});
  await enforceQuota().catch(() => {});
}

async function backfillFolder(
  state: FolderSyncRecord,
  advance: (count: number) => void,
): Promise<void> {
  const store = useCacheStore.getState();
  const { accountId, folder } = state;

  const label = (suffix: string) => {
    store.patchTask('backfill', { label: `${folder} — ${suffix}` });
  };

  // ── Phase 1 : en-têtes restants ──────────────────────────────────────────
  let pending = [...(state.backfillPending || [])];
  while (pending.length && !backfillShouldStop()) {
    // Le delta est prioritaire : s'il tourne, on le laisse finir plutôt que de
    // se disputer les connexions IMAP du serveur.
    if (deltaRun) await deltaRun.catch(() => {});

    label(`${pending.length} en-tête(s) restant(s)`);
    const batch = pending.slice(0, ENVELOPE_BATCH);
    const { messages } = await api.syncEnvelopes(accountId, folder, batch);
    await offlineDB.putEnvelopes(
      messages.map((m: any) => ({
        ...m,
        id: makeEmailId(accountId, folder, m.uid),
        accountId,
        folder,
      })),
    );

    pending = pending.slice(batch.length);
    // Persisté après CHAQUE lot : fermer l'onglet ne coûte que le lot en cours.
    //
    // On relit l'état avant d'écrire : un delta a pu passer entre deux lots et
    // mettre à jour UIDNEXT ou le nombre de messages. Réécrire l'instantané
    // qu'on tient depuis le début du remplissage effacerait sa mise à jour, et
    // le delta suivant reverrait un dossier faussement inchangé.
    const current = (await offlineDB.getSyncState(accountId, folder)) || state;
    await offlineDB.putSyncState({
      ...current,
      backfillPending: pending,
      backfillDone: pending.length === 0,
    });

    advance(batch.length);
    await yieldToUi();
  }

  // ── Phase 2 : corps manquants ────────────────────────────────────────────
  // Pas de curseur à tenir : `hasBody` est la progression.
  let scan = await offlineDB.listMissingBodyUids(accountId, folder, BODY_BATCH);
  while (scan.uids.length && !backfillShouldStop()) {
    if (deltaRun) await deltaRun.catch(() => {});

    const missing = scan.uids;
    label(`${missing.length} corps en cours de récupération`);
    const { bodies } = await api.syncBodies(accountId, folder, missing);
    await offlineDB.putBodies(accountId, folder, bodies);

    // Un UID demandé mais absent de la réponse n'a pas de corps récupérable
    // (message disparu entre-temps, structure MIME sans partie texte). Sans ce
    // marquage il reviendrait à chaque tour et bloquerait le backfill.
    const returned = new Set(bodies.map((b) => b.uid));
    const unavailable = missing.filter((uid) => !returned.has(uid));
    if (unavailable.length) {
      await offlineDB.putBodies(
        accountId,
        folder,
        unavailable.map((uid) => ({ uid, bodyText: '', bodyHtml: '', attachments: [] })),
      );
    }

    advance(missing.length);
    await yieldToUi();

    // Reprise au point atteint : on ne retraverse jamais ce qui a déjà été vu.
    scan = await offlineDB.listMissingBodyUids(accountId, folder, BODY_BATCH, scan.cursor);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Quota et ré-indexation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Évince les corps les plus anciens quand le quota du navigateur se remplit.
 * Jamais les en-têtes : ils sont légers et sont ce qui fait vivre l'affichage,
 * alors qu'un corps se retélécharge à l'ouverture.
 */
export async function enforceQuota(): Promise<number> {
  try {
    if (!navigator.storage?.estimate) return 0;
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) return 0;
    if (usage / quota < QUOTA_HIGH_WATER) return 0;
    // On redescend franchement sous le seuil pour ne pas rappeler l'éviction
    // à chaque lot suivant.
    const target = usage - quota * (QUOTA_HIGH_WATER - 0.1);
    const freed = await offlineDB.evictOldestBodies(target);
    if (freed > 0) await refreshCacheStats().catch(() => {});
    return freed;
  } catch {
    return 0;
  }
}

/**
 * Complète en tâche de fond les enregistrements écrits par une version
 * antérieure du cache. Rien n'est retéléchargé : les corps déjà présents sont
 * relus sur place.
 */
export async function reindexInBackground(): Promise<void> {
  try {
    for (;;) {
      const { done } = await offlineDB.reindexStale(REINDEX_BATCH);
      if (done) return;
      await yieldToUi();
    }
  } catch (err) {
    console.warn('[cache] reindex failed', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Pilotage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Point d'entrée historique, conservé pour les appelants existants : un delta,
 * puis le backfill lancé en arrière-plan sans être attendu.
 */
export async function syncAllCache(opts: { force?: boolean } = {}): Promise<void> {
  await runDeltaSync({ force: opts.force });
  void runBackfill().catch(() => {});
}

/** Synchronise un compte précis — utilisé juste après l'ajout d'une boîte. */
export async function syncAccountNow(accountId: string): Promise<void> {
  // L'arbre des dossiers du nouveau compte n'est pas encore en cache : on le
  // récupère d'abord, sinon le delta ne saurait pas quels dossiers ignorer.
  try {
    const folders = await api.getFolders(accountId);
    await offlineDB.cacheFolders(accountId, folders || []);
  } catch {
    // Le delta retentera via getFolderTree.
  }
  await runDeltaSync({ force: true });
  void runBackfill().catch(() => {});
}

/**
 * Démarre la boucle de fond. Remplace le `refetchInterval` de la liste : au lieu
 * d'un FETCH de 50 enveloppes toutes les 30 s par dossier ouvert, c'est un
 * STATUS par compte toutes les 60 s, qui ne déclenche un téléchargement que
 * s'il constate un changement.
 */
export function startCacheLoop(): () => void {
  stopCacheLoop();

  const tick = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    void runDeltaSync().catch(() => {});
  };

  loopTimer = setInterval(tick, DELTA_INTERVAL_MS);

  const onOnline = () => {
    tick();
    void runBackfill().catch(() => {});
  };
  window.addEventListener('online', onOnline);

  return () => {
    stopCacheLoop();
    window.removeEventListener('online', onOnline);
  };
}

export function stopCacheLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

/** Purge tout le cache local et remet les compteurs à zéro. */
export async function purgeCache() {
  await offlineDB.clearAll();
  useCacheStore.getState().reset();
  await refreshCacheStats();
}
