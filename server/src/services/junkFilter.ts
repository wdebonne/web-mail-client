import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { decrypt } from '../utils/encryption';
import { MailService, JunkMeta } from './mail';
import { markServiceStarted, markServiceStopped, markServiceTick } from './serviceStatus';
import { forgetCachedEmail } from '../utils/emailCache';

/**
 * Filtre « courrier indésirable ».
 *
 * Trois sources de décision, dans cet ordre de priorité :
 *
 *   1. Liste d'expéditeurs autorisés (perso + contacts si l'option est active) —
 *      un expéditeur autorisé n'est JAMAIS classé indésirable, quoi qu'en dise
 *      le reste. C'est le garde-fou qui rend la fonction acceptable pour un
 *      utilisateur non technicien : il peut toujours se garantir de recevoir
 *      les messages qui comptent.
 *   2. Liste d'expéditeurs bloqués (perso + liste globale de l'admin) — décision
 *      explicite de l'utilisateur, appliquée telle quelle.
 *   3. En-têtes du filtre antispam du serveur (SpamAssassin, Rspamd, Exchange…),
 *      selon le niveau choisi. Aucun apprentissage, aucun modèle local : on lit
 *      le verdict déjà calculé en amont par le serveur de messagerie.
 *
 * Le service de fond ne traite QUE les nouveaux messages (curseur `junk_scan_state`
 * par compte). Les messages déjà reçus ne sont jamais déplacés dans le dos de
 * l'utilisateur : c'est la case « déplacer aussi les messages déjà reçus » du
 * dialogue de blocage qui s'en charge, à sa demande explicite.
 *
 * Volontairement indépendant de newMailPoller : celui-ci ne traite que les
 * utilisateurs ayant une souscription push active ou un répondeur automatique,
 * et plafonne à 5 messages par cycle. Un filtre greffé dessus serait
 * silencieusement inopérant pour la majorité des comptes. Le poller appelle
 * quand même `applyJunkFilter` en ligne (voir newMailPoller.ts) pour qu'un
 * message classé indésirable ne déclenche pas de notification ; les deux
 * chemins partagent le même curseur et le même verrou par compte.
 */

const TICK_MS = Math.max(30_000, Number(process.env.JUNK_FILTER_INTERVAL_MS) || 120_000);
/**
 * Plafond de messages examinés par compte et par cycle. Au-delà, seuls les
 * plus récents sont analysés et le curseur saute quand même jusqu'au dernier
 * UID : un afflux massif (import, longue coupure) laisse donc passer les plus
 * anciens sans les filtrer, plutôt que de bloquer le cycle sur un seul compte.
 * Le balayage manuel (« Nettoyer maintenant ») permet de les rattraper.
 */
const MAX_PER_CYCLE = 50;
/** Intervalle minimal entre deux vidages du dossier Indésirables d'un compte. */
const PURGE_INTERVAL_MS = 6 * 60 * 60_000;
const SERVICE_NAME = 'junkFilter';

/** Verrou par compte : le service de fond et le poller peuvent tomber en même temps. */
const accountLocks = new Set<string>();

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

// ─── Configuration ────────────────────────────────────────────────────

export type ServerFilterLevel = 'off' | 'normal' | 'strict';

export interface JunkConfig {
  enabled: boolean;
  serverFilter: ServerFilterLevel;
  trustContacts: boolean;
  purgeDays: number;
}

/** Seuil de score SpamAssassin au-delà duquel le message est classé indésirable. */
const LEVEL_THRESHOLD: Record<ServerFilterLevel, number | null> = {
  off: null,
  normal: 5,
  strict: 3,
};

interface AdminDefaults extends JunkConfig {
  featureEnabled: boolean;
}

let cachedDefaults: AdminDefaults = {
  featureEnabled: true,
  enabled: true,
  serverFilter: 'normal',
  trustContacts: true,
  purgeDays: 30,
};

function unquote(raw: unknown): string {
  return String(raw ?? '').replace(/^"|"$/g, '').trim();
}

function toLevel(raw: string, fallback: ServerFilterLevel): ServerFilterLevel {
  return raw === 'off' || raw === 'normal' || raw === 'strict' ? raw : fallback;
}

export async function loadAdminDefaults(): Promise<AdminDefaults> {
  try {
    const r = await pool.query(
      `SELECT key, value FROM admin_settings
        WHERE key IN ('junk_enabled', 'junk_default_enabled', 'junk_default_server_filter',
                      'junk_default_trust_contacts', 'junk_default_purge_days')`,
    );
    const next: AdminDefaults = { ...cachedDefaults };
    for (const row of r.rows) {
      const raw = unquote(row.value);
      switch (row.key) {
        case 'junk_enabled': next.featureEnabled = raw !== 'false'; break;
        case 'junk_default_enabled': next.enabled = raw !== 'false'; break;
        case 'junk_default_server_filter': next.serverFilter = toLevel(raw, 'normal'); break;
        case 'junk_default_trust_contacts': next.trustContacts = raw !== 'false'; break;
        case 'junk_default_purge_days': {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0 && n <= 365) next.purgeDays = Math.floor(n);
          break;
        }
      }
    }
    cachedDefaults = next;
  } catch (err) {
    logger.debug({ err }, 'junk: chargement des réglages admin impossible, valeurs précédentes conservées');
  }
  return cachedDefaults;
}

export function getAdminDefaults(): AdminDefaults {
  return cachedDefaults;
}

/** Réglages effectifs d'un utilisateur : sa ligne si elle existe, sinon les défauts admin. */
export async function getUserConfig(userId: string): Promise<JunkConfig> {
  const defaults = cachedDefaults;
  try {
    const r = await pool.query(
      `SELECT enabled, server_filter, trust_contacts, purge_days
         FROM junk_settings WHERE user_id = $1`,
      [userId],
    );
    if (r.rowCount === 0) {
      return {
        enabled: defaults.enabled,
        serverFilter: defaults.serverFilter,
        trustContacts: defaults.trustContacts,
        purgeDays: defaults.purgeDays,
      };
    }
    const row = r.rows[0];
    return {
      enabled: !!row.enabled,
      serverFilter: toLevel(String(row.server_filter), defaults.serverFilter),
      trustContacts: !!row.trust_contacts,
      purgeDays: Number(row.purge_days) || 0,
    };
  } catch (err) {
    logger.debug({ err, userId }, 'junk: lecture des réglages utilisateur impossible');
    return {
      enabled: defaults.enabled,
      serverFilter: defaults.serverFilter,
      trustContacts: defaults.trustContacts,
      purgeDays: defaults.purgeDays,
    };
  }
}

// ─── Normalisation & correspondance ───────────────────────────────────

/** Adresse en minuscules, sans nom d'affichage ni chevrons. */
export function normalizeAddress(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  const angle = s.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : s).trim();
  return addr.includes('@') ? addr : '';
}

/** Domaine d'une adresse, sans le '@'. */
export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1);
}

export interface JunkLists {
  blocked: Set<string>;
  safe: Set<string>;
}

/**
 * Charge les listes d'un utilisateur : ses entrées + les entrées globales de
 * l'admin. Adresses et domaines cohabitent dans le même Set — un domaine est
 * stocké sans '@', une adresse en contient un, il n'y a donc pas d'ambiguïté.
 */
export async function loadLists(userId: string): Promise<JunkLists> {
  const lists: JunkLists = { blocked: new Set(), safe: new Set() };
  try {
    const r = await pool.query(
      `SELECT list_type, pattern FROM junk_senders
        WHERE user_id = $1 OR user_id IS NULL`,
      [userId],
    );
    for (const row of r.rows) {
      const pattern = String(row.pattern || '').toLowerCase();
      if (!pattern) continue;
      if (row.list_type === 'blocked') lists.blocked.add(pattern);
      else lists.safe.add(pattern);
    }
  } catch (err) {
    logger.debug({ err, userId }, 'junk: chargement des listes impossible');
  }
  return lists;
}

function listMatches(list: Set<string>, address: string): boolean {
  if (!address) return false;
  if (list.has(address)) return true;
  const domain = domainOf(address);
  return domain ? list.has(domain) : false;
}

/** L'adresse figure-t-elle dans les contacts de l'utilisateur ? */
async function isKnownContact(userId: string, address: string): Promise<boolean> {
  if (!address) return false;
  try {
    const r = await pool.query(
      `SELECT 1 FROM contacts WHERE user_id = $1 AND lower(email) = $2 LIMIT 1`,
      [userId, address],
    );
    return r.rowCount! > 0;
  } catch {
    return false;
  }
}

// ─── Lecture du verdict du serveur ────────────────────────────────────

/**
 * Score antispam extrait des en-têtes, ou null si le serveur n'en pose aucun.
 * Gère les trois formes rencontrées en production :
 *   X-Spam-Status: Yes, score=7.3 required=5.0 tests=...
 *   X-Spam-Score: 7.3
 *   X-Spam-Level: *******   (une étoile par point, SpamAssassin)
 */
export function extractSpamScore(headers: Record<string, string>): number | null {
  const status = headers['x-spam-status'];
  if (status) {
    const m = status.match(/score=(-?\d+(?:\.\d+)?)/i);
    if (m) return Number(m[1]);
  }
  const score = headers['x-spam-score'];
  if (score) {
    const n = Number(String(score).trim().split(/\s+/)[0]);
    if (Number.isFinite(n)) return n;
  }
  const level = headers['x-spam-level'];
  if (level) {
    const stars = String(level).trim().match(/^\*+/);
    if (stars) return stars[0].length;
  }
  return null;
}

/** Le serveur a-t-il explicitement drapeauté le message ? */
export function hasSpamFlag(headers: Record<string, string>): boolean {
  const flag = headers['x-spam-flag'];
  if (flag && /^yes/i.test(flag.trim())) return true;
  const status = headers['x-spam-status'];
  return !!status && /^yes/i.test(status.trim());
}

// ─── Décision ─────────────────────────────────────────────────────────

export type JunkReason = 'blocked-address' | 'blocked-domain' | 'server-flag' | 'server-score';

export interface JunkVerdict {
  junk: boolean;
  reason: JunkReason | null;
  /** Détail affichable, ex. « expéditeur bloqué » ou « score antispam 7.3 ». */
  detail: string | null;
}

const NOT_JUNK: JunkVerdict = { junk: false, reason: null, detail: null };

/**
 * Évalue un message. `safeOverride` court-circuite tout : une adresse autorisée
 * (liste blanche ou contact connu) revient toujours en boîte de réception.
 */
export async function evaluateJunk(
  userId: string,
  meta: Pick<JunkMeta, 'from' | 'headers'>,
  config: JunkConfig,
  lists: JunkLists,
): Promise<JunkVerdict> {
  const address = normalizeAddress(meta.from?.address);

  // 1. Autorisé explicitement → jamais indésirable.
  if (address && listMatches(lists.safe, address)) return NOT_JUNK;
  if (address && config.trustContacts && await isKnownContact(userId, address)) return NOT_JUNK;

  // 2. Bloqué explicitement.
  if (address && lists.blocked.has(address)) {
    return { junk: true, reason: 'blocked-address', detail: `expéditeur bloqué (${address})` };
  }
  const domain = domainOf(address);
  if (domain && lists.blocked.has(domain)) {
    return { junk: true, reason: 'blocked-domain', detail: `domaine bloqué (@${domain})` };
  }

  // 3. Verdict du filtre du serveur.
  const threshold = LEVEL_THRESHOLD[config.serverFilter];
  if (threshold !== null) {
    // Le drapeau prime sur le score : SpamAssassin ne pose `X-Spam-Flag: YES`
    // qu'au-delà du seuil configuré sur le serveur lui-même. Le niveau choisi
    // ici ne sert qu'à durcir cette décision, jamais à l'assouplir.
    if (hasSpamFlag(meta.headers)) {
      return { junk: true, reason: 'server-flag', detail: 'marqué comme spam par le serveur' };
    }
    const score = extractSpamScore(meta.headers);
    if (score !== null && score >= threshold) {
      return { junk: true, reason: 'server-score', detail: `score antispam ${score}` };
    }
  }

  return NOT_JUNK;
}

// ─── Dossier « Indésirables » ─────────────────────────────────────────

const JUNK_NAME_HINTS = ['junk', 'spam', 'junk e-mail', 'indésirable', 'indesirable', 'pourriel'];

/** Cache du chemin résolu, par compte — un LIST IMAP par message classé serait ruineux. */
const junkFolderCache = new Map<string, { path: string; at: number }>();
const JUNK_FOLDER_TTL_MS = 30 * 60_000;

/**
 * Chemin du dossier indésirable du compte. Cherche d'abord l'attribut IMAP
 * SPECIAL-USE `\Junk` (fiable), puis les noms usuels, et retombe sur la
 * création d'un dossier « Junk » à la racine — `moveMessage` crée de toute
 * façon la destination manquante, cette valeur n'est donc jamais un cul-de-sac.
 *
 * `accountId` n'active que la mise en cache ; l'appeler sans reste correct.
 */
export async function resolveJunkFolder(service: MailService, accountId?: string): Promise<string> {
  if (accountId) {
    const hit = junkFolderCache.get(accountId);
    if (hit && Date.now() - hit.at < JUNK_FOLDER_TTL_MS) return hit.path;
  }
  const resolved = await resolveJunkFolderUncached(service);
  if (accountId) junkFolderCache.set(accountId, { path: resolved, at: Date.now() });
  return resolved;
}

async function resolveJunkFolderUncached(service: MailService): Promise<string> {
  try {
    const folders = await service.getFolders();
    const bySpecial = folders.find((f: any) => f.specialUse === '\\Junk');
    if (bySpecial) return bySpecial.path;
    const byName = folders.find((f: any) => {
      const name = String(f.name || '').toLowerCase();
      return JUNK_NAME_HINTS.includes(name);
    });
    if (byName) return byName.path;
    // Certains serveurs imbriquent tout sous INBOX (Dovecot avec préfixe) :
    // on aligne le nouveau dossier sur cette convention plutôt que la racine.
    const inbox = folders.find((f: any) => String(f.path || '').toUpperCase() === 'INBOX');
    const nested = folders.find((f: any) => String(f.path || '').toUpperCase().startsWith('INBOX.'));
    if (nested && inbox) return `INBOX${inbox.delimiter || '.'}Junk`;
  } catch (err) {
    logger.debug({ err }, 'junk: résolution du dossier indésirable impossible');
  }
  return 'Junk';
}

// ─── Adaptation depuis un message déjà analysé ────────────────────────

/**
 * Construit un `JunkMeta` à partir d'un message déjà téléchargé et analysé par
 * `MailService.getMessage` (chemin du poller de nouveaux mails), qui expose les
 * en-têtes sous des noms camelCase. Évite un second aller-retour IMAP pour un
 * message dont on a déjà tout en main.
 */
export function metaFromParsedMessage(uid: number, msg: any): JunkMeta {
  const h = msg?.headers || {};
  const headers: Record<string, string> = {};
  const put = (name: string, value: unknown) => {
    if (value != null && String(value).length > 0) headers[name] = String(value);
  };
  put('x-spam-flag', h.xSpamFlag);
  put('x-spam-status', h.xSpamStatus);
  put('x-spam-level', h.xSpamLevel);
  put('x-spam-score', h.xSpamScore);
  put('list-unsubscribe', h.listUnsubscribe);
  return {
    uid,
    from: msg?.from ? { address: String(msg.from.address || ''), name: msg.from.name } : null,
    subject: String(msg?.subject || ''),
    date: msg?.date ? new Date(msg.date) : null,
    headers,
  };
}

// ─── Application ──────────────────────────────────────────────────────

export interface AccountRef {
  id: string;
  user_id: string;
  email: string;
}

/**
 * Évalue puis déplace les messages indésirables d'un lot de métadonnées.
 * Renvoie les UID déplacés. Aucune exception n'est propagée : un échec IMAP
 * sur un message ne doit jamais interrompre le traitement des suivants.
 */
export async function applyJunkFilter(
  account: AccountRef,
  metas: JunkMeta[],
  service: MailService,
  opts: { config?: JunkConfig; lists?: JunkLists; junkFolder?: string } = {},
): Promise<number[]> {
  if (metas.length === 0) return [];
  const config = opts.config ?? await getUserConfig(account.user_id);
  if (!config.enabled || !cachedDefaults.featureEnabled) return [];

  const lists = opts.lists ?? await loadLists(account.user_id);
  const moved: number[] = [];
  let junkFolder = opts.junkFolder ?? null;

  for (const meta of metas) {
    let verdict: JunkVerdict;
    try {
      verdict = await evaluateJunk(account.user_id, meta, config, lists);
    } catch (err) {
      logger.debug({ err, uid: meta.uid }, 'junk: évaluation impossible');
      continue;
    }
    if (!verdict.junk) continue;

    if (!junkFolder) junkFolder = await resolveJunkFolder(service, account.id);
    try {
      await service.moveMessage('INBOX', meta.uid, junkFolder);
      // Le message n'est plus dans INBOX : sans cette purge, sa ligne de cache
      // y survivrait et continuerait de remonter dans les recherches.
      await forgetCachedEmail(account.id, 'INBOX', meta.uid);
      moved.push(meta.uid);
      logger.info(
        { accountId: account.id, uid: meta.uid, reason: verdict.reason },
        `junk: message déplacé vers « ${junkFolder} » — ${verdict.detail}`,
      );
      if (verdict.reason === 'blocked-address' || verdict.reason === 'blocked-domain') {
        await recordHit(account.user_id, normalizeAddress(meta.from?.address));
      }
    } catch (err) {
      logger.debug({ err, uid: meta.uid, accountId: account.id }, 'junk: déplacement impossible');
    }
  }
  return moved;
}

/** Incrémente le compteur de l'entrée bloquée ayant matché (adresse ou domaine). */
async function recordHit(userId: string, address: string): Promise<void> {
  if (!address) return;
  const domain = domainOf(address);
  try {
    await pool.query(
      `UPDATE junk_senders
          SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE list_type = 'blocked'
          AND (user_id = $1 OR user_id IS NULL)
          AND pattern IN ($2, $3)`,
      [userId, address, domain],
    );
  } catch {
    /* compteur d'affichage seulement — un échec ne doit rien interrompre */
  }
}

// ─── Service de fond ──────────────────────────────────────────────────

/** Charge un compte prêt à l'emploi (mot de passe déchiffré ou jeton OAuth frais). */
async function buildService(row: any): Promise<MailService | null> {
  try {
    let password = '';
    let accessToken: string | undefined;
    if (row.oauth_provider) {
      const { ensureFreshAccessToken } = await import('./oauth');
      accessToken = (await ensureFreshAccessToken(row)) ?? undefined;
    } else if (row.password_encrypted) {
      password = decrypt(row.password_encrypted);
    }
    return new MailService({
      email: row.email,
      name: row.name,
      imap_host: row.imap_host,
      imap_port: row.imap_port,
      imap_secure: row.imap_secure,
      smtp_host: row.smtp_host,
      smtp_port: row.smtp_port,
      smtp_secure: row.smtp_secure,
      username: row.username || row.email,
      password,
      access_token: accessToken,
    } as any);
  } catch (err) {
    logger.debug({ err, accountId: row.id }, 'junk: compte inutilisable');
    return null;
  }
}

async function scanAccount(row: any): Promise<void> {
  if (accountLocks.has(row.id)) return;
  accountLocks.add(row.id);
  try {
    const config = await getUserConfig(row.user_id);
    if (!config.enabled) return;

    const service = await buildService(row);
    if (!service) return;

    const stateRes = await pool.query(
      `SELECT last_uid, last_purge_at FROM junk_scan_state WHERE account_id = $1`,
      [row.id],
    );
    const known = stateRes.rowCount! > 0;
    const lastUid = known ? Number(stateRes.rows[0].last_uid) || 0 : 0;
    const lastPurgeAt = known && stateRes.rows[0].last_purge_at
      ? new Date(stateRes.rows[0].last_purge_at).getTime()
      : 0;

    const uids = await service.listFolderUids('INBOX').catch((err) => {
      logger.debug({ err, accountId: row.id }, 'junk: listage INBOX impossible');
      return null;
    });
    if (!uids) return;

    const maxUid = uids.length > 0 ? Math.max(...uids) : 0;

    if (!known) {
      // Premier passage sur ce compte : on pose seulement le repère. Déplacer
      // rétroactivement toute une boîte de réception au premier démarrage
      // serait la pire des surprises pour un utilisateur non technicien.
      await pool.query(
        `INSERT INTO junk_scan_state (account_id, last_uid, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (account_id) DO UPDATE SET last_uid = EXCLUDED.last_uid, updated_at = NOW()`,
        [row.id, maxUid],
      );
      return;
    }

    // UID plus bas que le curseur : la boîte a été recréée côté serveur
    // (UIDVALIDITY neuf, numérotation repartie de zéro). Sans ce garde-fou, le
    // curseur resterait définitivement hors d'atteinte et le compte ne serait
    // plus jamais filtré. On repart du repère courant, sans rejouer le passé.
    if (maxUid < lastUid) {
      logger.info(
        { accountId: row.id, lastUid, maxUid },
        'junk: numérotation IMAP réinitialisée — curseur remis à zéro',
      );
      await pool.query(
        `UPDATE junk_scan_state SET last_uid = $2, updated_at = NOW() WHERE account_id = $1`,
        [row.id, maxUid],
      );
      return;
    }

    const fresh = uids.filter((u) => u > lastUid).sort((a, b) => a - b).slice(-MAX_PER_CYCLE);
    if (fresh.length > 0) {
      const lists = await loadLists(row.user_id);
      const metas = await service.fetchJunkMeta('INBOX', fresh).catch((err) => {
        logger.debug({ err, accountId: row.id }, 'junk: lecture des métadonnées impossible');
        return [] as JunkMeta[];
      });
      if (metas.length > 0) {
        await applyJunkFilter({ id: row.id, user_id: row.user_id, email: row.email }, metas, service, { config, lists });
      }
    }

    if (maxUid > lastUid) {
      await pool.query(
        `UPDATE junk_scan_state SET last_uid = $2, updated_at = NOW() WHERE account_id = $1`,
        [row.id, maxUid],
      );
    }

    if (config.purgeDays > 0 && Date.now() - lastPurgeAt >= PURGE_INTERVAL_MS) {
      await purgeJunkFolder(row, service, config.purgeDays);
      await pool.query(
        `UPDATE junk_scan_state SET last_purge_at = NOW() WHERE account_id = $1`,
        [row.id],
      );
    }
  } catch (err) {
    logger.debug({ err, accountId: row.id }, 'junk: analyse du compte échouée');
  } finally {
    accountLocks.delete(row.id);
  }
}

/** Supprime définitivement les messages du dossier Indésirables plus vieux que N jours. */
async function purgeJunkFolder(row: any, service: MailService, days: number): Promise<void> {
  try {
    const folder = await resolveJunkFolder(service);
    const before = new Date(Date.now() - days * 24 * 60 * 60_000);
    const uids = await service.listFolderUidsBefore(folder, before).catch(() => [] as number[]);
    if (!uids || uids.length === 0) return;
    await service.deleteMessages(folder, uids);
    logger.info(
      { accountId: row.id },
      `junk: ${uids.length} message(s) de plus de ${days} jours purgé(s) du dossier « ${folder} »`,
    );
  } catch (err) {
    logger.debug({ err, accountId: row.id }, 'junk: purge impossible');
  }
}

async function tick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const defaults = await loadAdminDefaults();
    if (!defaults.featureEnabled) {
      markServiceTick(SERVICE_NAME);
      return;
    }

    // Tous les comptes dont le propriétaire (ou l'utilisateur destinataire d'une
    // boîte partagée) n'a pas désactivé le classement automatique. Le filtrage
    // fin se fait dans scanAccount : ici on écarte seulement les utilisateurs
    // ayant explicitement mis `enabled = false`.
    const result = await pool.query(
      `SELECT DISTINCT ma.*, COALESCE(ma.user_id, mba.user_id) AS user_id
         FROM mail_accounts ma
         LEFT JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id
         LEFT JOIN junk_settings js ON js.user_id = COALESCE(ma.user_id, mba.user_id)
        WHERE COALESCE(ma.user_id, mba.user_id) IS NOT NULL
          AND COALESCE(js.enabled, $1) = true`,
      [defaults.enabled],
    );

    for (const row of result.rows) {
      await scanAccount(row);
    }
    markServiceTick(SERVICE_NAME);
  } catch (err) {
    markServiceTick(SERVICE_NAME, err);
    logger.error(err as Error, 'junk: cycle échoué');
  } finally {
    isRunning = false;
  }
}

export function startJunkFilter(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  markServiceStarted(SERVICE_NAME, 'Courrier indésirable', TICK_MS);
  logger.info('Junk filter started');
  // Premier cycle immédiat pour poser les repères des comptes déjà connus.
  void loadAdminDefaults();
}

export function stopJunkFilter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    markServiceStopped(SERVICE_NAME);
  }
}
