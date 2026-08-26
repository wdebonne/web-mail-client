import { openDB, IDBPDatabase } from 'idb';
import { buildTerms, makeSnippet, TOKENIZER_VERSION } from '../services/tokenize';

const DB_NAME = 'webmail-offline';

/**
 * v3 — cache local complet.
 *
 * Les corps vivent dans leur propre store : afficher une liste de 50 messages
 * ne doit jamais désérialiser 50 corps HTML, quel que soit le volume stocké.
 * `syncState` porte, par dossier, ce qu'il faut pour calculer un delta sans rien
 * redemander d'inutile.
 */
const DB_VERSION = 3;

let dbInstance: IDBPDatabase | null = null;

/** Date de repli pour les messages sans en-tête Date exploitable.
 *  Une clé d'index `undefined` exclurait purement et simplement le message de
 *  l'index — il disparaîtrait de la liste au lieu d'être mal trié. */
const EPOCH = '1970-01-01T00:00:00.000Z';

/** Identifiant composite : le même UID peut exister dans plusieurs dossiers. */
export function makeEmailId(accountId: string, folder: string, uid: number | string): string {
  return `${accountId}-${folder}-${uid}`;
}

/** Normalise une date de message en chaîne ISO triable, toujours définie. */
export function toSortDate(date: any): string {
  if (!date) return EPOCH;
  const ts = date instanceof Date ? date.getTime() : Date.parse(String(date));
  return Number.isNaN(ts) ? EPOCH : new Date(ts).toISOString();
}

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      // ── Stores d'origine ────────────────────────────────────────────────
      // Chaque création est gardée : une montée de version ne doit jamais
      // recréer (donc vider) un store qui existe déjà.
      if (!db.objectStoreNames.contains('emails')) {
        const emailStore = db.createObjectStore('emails', { keyPath: 'id' });
        emailStore.createIndex('accountId', 'accountId');
        emailStore.createIndex('folder', ['accountId', 'folder']);
        emailStore.createIndex('date', 'date');
        emailStore.createIndex('folderDate', ['accountId', 'folder', 'sortDate']);
        emailStore.createIndex('terms', 'terms', { multiEntry: true });
      }

      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('contacts')) {
        const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
        contactStore.createIndex('email', 'email');
        contactStore.createIndex('name', 'display_name');
      }

      if (!db.objectStoreNames.contains('events')) {
        const eventStore = db.createObjectStore('events', { keyPath: 'id' });
        eventStore.createIndex('calendarId', 'calendar_id');
        eventStore.createIndex('startDate', 'start_date');
      }

      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'accountId' });
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }

      // ── v2 → v3 : on AJOUTE, on ne reconstruit pas ──────────────────────
      // Les enregistrements existants survivent tels quels ; il leur manque
      // seulement `terms`, `snippet` et `sortDate`, qu'une passe de rattrapage
      // remplit ensuite en tâche de fond. C'est tout l'objet de cette version :
      // mettre l'application à jour ne doit pas coûter un retéléchargement.
      if (oldVersion > 0 && oldVersion < 3 && db.objectStoreNames.contains('emails')) {
        const emailStore = tx.objectStore('emails');
        if (!emailStore.indexNames.contains('folderDate')) {
          emailStore.createIndex('folderDate', ['accountId', 'folder', 'sortDate']);
        }
        if (!emailStore.indexNames.contains('terms')) {
          emailStore.createIndex('terms', 'terms', { multiEntry: true });
        }
      }

      if (!db.objectStoreNames.contains('bodies')) {
        const bodyStore = db.createObjectStore('bodies', { keyPath: 'id' });
        bodyStore.createIndex('folder', ['accountId', 'folder']);
        bodyStore.createIndex('cachedAt', 'cachedAt');
      }

      if (!db.objectStoreNames.contains('syncState')) {
        db.createObjectStore('syncState', { keyPath: ['accountId', 'folder'] });
      }
    },
  });

  return dbInstance;
}

export interface FolderSyncRecord {
  accountId: string;
  folder: string;
  /** Comparé en chaîne : UIDVALIDITY est un entier 32 bits non signé côté IMAP. */
  uidValidity: string;
  uidNext: number;
  messageCount: number;
  highestModseq?: string;
  /** Plus grand UID connu localement — borne basse des « nouveaux ». */
  highestUid: number;
  /** Reste à rapatrier pour le backfill : UID connus du serveur, pas encore en cache. */
  backfillPending: number[];
  backfillTotal: number;
  backfillDone: boolean;
  lastDeltaAt?: string;
  /** Dernier relevé complet des drapeaux — sert à espacer les balayages
   *  coûteux sur les serveurs sans CONDSTORE. */
  lastFlagSweepAt?: string;
}

export interface CacheStats {
  emails: number;
  /** Messages dont le corps est en cache — c'est ce qui rend la recherche complète. */
  bodies: number;
  bodyBytes: number;
  folders: number;
  contacts: number;
  events: number;
  /** Occupation réelle de l'origine, telle que le navigateur la rapporte. */
  usage?: number;
  quota?: number;
  lastSync?: string | null;
  /** Vrai quand le stockage est marqué persistant (à l'abri d'une éviction). */
  persisted?: boolean;
}

/** Clé du compteur d'octets de corps, tenu à l'écriture plutôt que recalculé. */
const BODY_BYTES_KEY = 'bodyBytes';

/** Curseur de la passe de ré-indexation, pour la reprendre là où elle s'arrête. */
const REINDEX_CURSOR_KEY = 'reindexCursor';

async function bumpBodyBytes(db: IDBPDatabase, delta: number) {
  if (!delta) return;
  const current = ((await db.get('meta', BODY_BYTES_KEY)) as number) || 0;
  await db.put('meta', Math.max(0, current + delta), BODY_BYTES_KEY);
}

export const offlineDB = {
  // ═══════════════════════════════════════════════════════════════════════
  // En-têtes
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Écrit des en-têtes de message, en **préservant** ce qui a été dérivé du
   * corps. Un delta réécrit l'enveloppe à chaque changement de drapeau : sans
   * cette fusion, il effacerait les termes et l'aperçu issus du corps déjà
   * téléchargé et la recherche dans le contenu se viderait silencieusement.
   */
  async putEnvelopes(records: any[]) {
    if (!records?.length) return;
    const db = await getDB();
    const tx = db.transaction('emails', 'readwrite');

    for (const rec of records) {
      const id = rec.id || makeEmailId(rec.accountId, rec.folder, rec.uid);
      const existing: any = await tx.store.get(id);
      const merged: any = { ...existing, ...rec, id, sortDate: toSortDate(rec.date ?? existing?.date) };

      if (existing?.hasBody) {
        merged.terms = existing.terms;
        merged.snippet = existing.snippet;
        merged.hasBody = true;
        merged.tokenizerVersion = existing.tokenizerVersion;
      } else {
        merged.terms = buildTerms({
          subject: rec.subject,
          fromName: rec.from?.name,
          fromAddress: rec.from?.address,
          to: rec.to,
          cc: rec.cc,
        });
        merged.hasBody = false;
        // Estampillé même sans corps : c'est ce qui permet à un changement de
        // règles de tokenisation de déclencher la ré-indexation de TOUS les
        // enregistrements, pas seulement de ceux dont le corps est en cache.
        merged.tokenizerVersion = TOKENIZER_VERSION;
      }

      await tx.store.put(merged);
    }
    await tx.done;
  },

  /** Alias historique — conservé pour les appelants existants. */
  async cacheEmails(emails: any[]) {
    return offlineDB.putEnvelopes(emails);
  },

  async getEmails(accountId: string, folder: string) {
    const db = await getDB();
    const index = db.transaction('emails').store.index('folder');
    return index.getAll([accountId, folder]);
  },

  async getEmail(id: string) {
    const db = await getDB();
    return db.get('emails', id);
  },

  /**
   * Une page de dossier, du plus récent au plus ancien, lue au curseur sur
   * l'index `folderDate`. Ne charge jamais le dossier entier — c'est ce qui
   * permet d'afficher instantanément un dossier de dizaines de milliers de
   * messages.
   */
  async getFolderPage(
    accountId: string,
    folder: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<any[]> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const db = await getDB();
    const index = db.transaction('emails').store.index('folderDate');
    const range = IDBKeyRange.bound(
      [accountId, folder, ''],
      [accountId, folder, '\uffff'],
    );

    const out: any[] = [];
    let cursor = await index.openCursor(range, 'prev');
    if (cursor && offset > 0) cursor = await cursor.advance(offset);
    while (cursor && out.length < limit) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    return out;
  },

  async countFolder(accountId: string, folder: string): Promise<number> {
    const db = await getDB();
    return db.transaction('emails').store.index('folder').count([accountId, folder]);
  },

  async countFolderBodies(accountId: string, folder: string): Promise<number> {
    const db = await getDB();
    return db.transaction('bodies').store.index('folder').count([accountId, folder]);
  },

  /** UID présents localement pour un dossier — base de l'arithmétique de delta. */
  async getFolderUids(accountId: string, folder: string): Promise<Map<number, number>> {
    const db = await getDB();
    const index = db.transaction('emails').store.index('folder');
    const out = new Map<number, number>();
    let cursor = await index.openCursor(IDBKeyRange.only([accountId, folder]));
    while (cursor) {
      const v: any = cursor.value;
      let bits = 0;
      if (v.flags?.seen) bits |= 1;
      if (v.flags?.flagged) bits |= 2;
      if (v.flags?.answered) bits |= 4;
      if (v.flags?.draft) bits |= 8;
      out.set(Number(v.uid), bits);
      cursor = await cursor.continue();
    }
    return out;
  },

  /** Applique des changements de drapeaux venus du serveur ou d'une action locale. */
  async updateFlags(
    accountId: string,
    folder: string,
    changes: Array<{ uid: number; flags: Record<string, boolean> }>,
  ) {
    if (!changes?.length) return;
    const db = await getDB();
    const tx = db.transaction('emails', 'readwrite');
    for (const change of changes) {
      const id = makeEmailId(accountId, folder, change.uid);
      const rec: any = await tx.store.get(id);
      if (!rec) continue;
      rec.flags = { ...rec.flags, ...change.flags };
      // La liste lit `isRead` sur certains chemins (résultats de recherche
      // serveur) — on garde les deux formes cohérentes.
      if ('seen' in change.flags) rec.isRead = change.flags.seen;
      if ('flagged' in change.flags) rec.isFlagged = change.flags.flagged;
      await tx.store.put(rec);
    }
    await tx.done;
  },

  /** Retire des messages du cache (déplacés, supprimés, disparus du serveur). */
  async deleteEmails(accountId: string, folder: string, uids: number[]) {
    if (!uids?.length) return;
    const db = await getDB();
    const tx = db.transaction(['emails', 'bodies'], 'readwrite');
    const bodyStore = tx.objectStore('bodies');
    let freed = 0;
    for (const uid of uids) {
      const id = makeEmailId(accountId, folder, uid);
      const body: any = await bodyStore.get(id);
      if (body) freed += Number(body.bytes) || 0;
      await tx.objectStore('emails').delete(id);
      await bodyStore.delete(id);
    }
    await tx.done;
    await bumpBodyBytes(db, -freed);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Corps
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Enregistre des corps et ré-indexe les en-têtes correspondants : c'est à ce
   * moment que la recherche cesse de se limiter au sujet et à l'expéditeur.
   */
  async putBodies(
    accountId: string,
    folder: string,
    bodies: Array<{
      uid: number;
      bodyText?: string;
      bodyHtml?: string;
      attachments?: any[];
      truncated?: boolean;
      /** Texte extrait des pièces jointes bureautiques, s'il a pu l'être. */
      attachmentText?: string;
    }>,
  ) {
    if (!bodies?.length) return;
    const db = await getDB();
    const tx = db.transaction(['bodies', 'emails'], 'readwrite');
    const bodyStore = tx.objectStore('bodies');
    const emailStore = tx.objectStore('emails');
    const cachedAt = new Date().toISOString();
    let delta = 0;

    for (const body of bodies) {
      const id = makeEmailId(accountId, folder, body.uid);
      const bodyText = body.bodyText || '';
      const bodyHtml = body.bodyHtml || '';
      // IndexedDB stocke les chaînes en UTF-16 : deux octets par unité. Compter
      // les caractères sous-estimerait de moitié, et l'éviction déclenchée sur
      // ce compteur libérerait bien moins que le quota ne l'exige.
      const bytes = (bodyText.length + bodyHtml.length) * 2;

      const previous: any = await bodyStore.get(id);

      // Le texte des pièces jointes n'est extrait qu'à l'ouverture d'un message.
      // Une réécriture venue du remplissage de fond n'en a pas : sans cette
      // garde, elle effacerait un travail d'extraction déjà fait.
      const attachmentText = body.attachmentText ?? previous?.attachmentText ?? '';
      const totalBytes = bytes + attachmentText.length * 2;
      delta += totalBytes - (Number(previous?.bytes) || 0);

      await bodyStore.put({
        id,
        accountId,
        folder,
        uid: body.uid,
        bodyText,
        bodyHtml,
        attachments: body.attachments || [],
        attachmentText,
        truncated: !!body.truncated,
        cachedAt,
        bytes: totalBytes,
      });

      const email: any = await emailStore.get(id);
      if (email) {
        email.terms = buildTerms({
          subject: email.subject,
          fromName: email.from?.name,
          fromAddress: email.from?.address,
          to: email.to,
          cc: email.cc,
          bodyText,
          bodyHtml,
          attachmentNames: (body.attachments || []).map((a: any) => a?.filename),
          attachmentText,
        });
        email.snippet = makeSnippet(bodyText, bodyHtml);
        email.hasBody = true;
        email.tokenizerVersion = TOKENIZER_VERSION;
        await emailStore.put(email);
      }
    }

    await tx.done;
    await bumpBodyBytes(db, delta);
  },

  /**
   * Passe de rattrapage sur les enregistrements laissés par une version
   * antérieure du cache (pas de `terms`, pas de `sortDate`) ou indexés par une
   * version antérieure du tokeniseur.
   *
   * C'est ce qui permet à une mise à jour de l'application de ne rien
   * retélécharger : les corps déjà en cache sont relus sur place et ré-indexés.
   * Appelée par lots, en tâche de fond, avec un curseur repris d'un appel à
   * l'autre — l'interface n'est jamais bloquée.
   */
  async reindexStale(limit = 500): Promise<{ processed: number; done: boolean }> {
    const db = await getDB();
    const lastId = (await db.get('meta', REINDEX_CURSOR_KEY)) as string | undefined;

    const tx = db.transaction(['emails', 'bodies'], 'readwrite');
    const bodyStore = tx.objectStore('bodies');
    let cursor = await tx
      .objectStore('emails')
      .openCursor(lastId ? IDBKeyRange.lowerBound(lastId, true) : undefined);

    let scanned = 0;
    let processed = 0;
    let cursorId: string | undefined = lastId;

    while (cursor && scanned < limit) {
      const rec: any = cursor.value;
      cursorId = rec.id;
      scanned += 1;

      const stale =
        !rec.terms
        || rec.sortDate === undefined
        || rec.tokenizerVersion !== TOKENIZER_VERSION;

      if (stale) {
        const body: any = rec.hasBody ? await bodyStore.get(rec.id) : undefined;
        rec.sortDate = toSortDate(rec.date);
        rec.terms = buildTerms({
          subject: rec.subject,
          fromName: rec.from?.name,
          fromAddress: rec.from?.address,
          to: rec.to,
          cc: rec.cc,
          bodyText: body?.bodyText,
          bodyHtml: body?.bodyHtml,
          attachmentNames: (body?.attachments || []).map((a: any) => a?.filename),
          // Relu depuis le cache : une ré-indexation ne re-télécharge ni
          // ne ré-extrait quoi que ce soit.
          attachmentText: body?.attachmentText,
        });
        if (body) {
          rec.snippet = makeSnippet(body.bodyText, body.bodyHtml);
          rec.hasBody = true;
        } else {
          rec.hasBody = false;
        }
        rec.tokenizerVersion = TOKENIZER_VERSION;
        await cursor.update(rec);
        processed += 1;
      }

      cursor = await cursor.continue();
    }

    const done = !cursor;
    await tx.done;
    await db.put('meta', done ? '' : cursorId, REINDEX_CURSOR_KEY);
    return { processed, done };
  },

  async getBody(accountId: string, folder: string, uid: number) {
    const db = await getDB();
    return db.get('bodies', makeEmailId(accountId, folder, uid));
  },

  /**
   * UID d'un dossier dont le corps manque encore — file de travail du backfill.
   *
   * `before` reprend le parcours là où il s'est arrêté. Sans lui, chaque lot
   * repartirait du message le plus récent et retraverserait tous ceux déjà
   * traités : sur un dossier de 20 000 messages, le remplissage deviendrait
   * quadratique et ne finirait jamais.
   */
  async listMissingBodyUids(
    accountId: string,
    folder: string,
    limit = 100,
    before?: string,
  ): Promise<{ uids: number[]; cursor?: string }> {
    const db = await getDB();
    const index = db.transaction('emails').store.index('folderDate');
    const range = IDBKeyRange.bound(
      [accountId, folder, ''],
      [accountId, folder, before ?? '\uffff'],
      false,
      // Borne haute exclusive à la reprise, pour ne pas retraiter le dernier vu.
      before !== undefined,
    );

    const out: number[] = [];
    let last: string | undefined;
    // Du plus récent au plus ancien : ce sont les messages récents qu'on veut
    // pouvoir chercher et lire hors-ligne en premier.
    let cursor = await index.openCursor(range, 'prev');
    while (cursor && out.length < limit) {
      const v: any = cursor.value;
      last = v.sortDate;
      if (!v.hasBody) out.push(Number(v.uid));
      cursor = await cursor.continue();
    }
    return { uids: out, cursor: cursor ? last : undefined };
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Recherche locale
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Intersection des jeux de clés correspondant à chaque terme (sémantique ET).
   *
   * L'index `multiEntry` ne lit que les clés qui matchent : la recherche ne
   * désérialise jamais l'ensemble des corps, contrairement à un balayage.
   * `IDBKeyRange.bound(t, t + '\uffff')` donne la recherche par préfixe
   * gratuitement — « factu » trouve « facture », ce que les gens attendent.
   */
  async searchByTerms(
    terms: string[],
    opts: { accountId?: string; folder?: string; limit?: number } = {},
  ): Promise<any[]> {
    if (!terms?.length) return [];
    const db = await getDB();
    const tx = db.transaction('emails');
    const index = tx.store.index('terms');

    let candidates: Set<string> | null = null;
    for (const term of terms) {
      const keys = (await index.getAllKeys(
        IDBKeyRange.bound(term, `${term}\uffff`),
      )) as string[];
      const set = new Set<string>(keys);
      if (candidates === null) {
        candidates = set;
      } else {
        // Intersection en place : on ne garde que ce qui survit à chaque terme.
        const next = new Set<string>();
        for (const key of candidates) {
          if (set.has(key)) next.add(key);
        }
        candidates = next;
      }
      if (candidates.size === 0) return [];
    }
    if (!candidates) return [];

    // Les lectures se font par paquets menés de front : IndexedDB traite
    // volontiers plusieurs requêtes en parallèle dans une même transaction, et
    // les enchaîner une à une multiplierait le temps d'attente sur un terme
    // très courant.
    const ids = [...candidates];
    const out: any[] = [];
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = await Promise.all(ids.slice(i, i + CHUNK).map((id) => tx.store.get(id)));
      for (const rec of chunk as any[]) {
        if (!rec) continue;
        if (opts.accountId && rec.accountId !== opts.accountId) continue;
        if (opts.folder && rec.folder !== opts.folder) continue;
        out.push(rec);
      }
    }
    await tx.done;

    out.sort((a, b) => String(b.sortDate || '').localeCompare(String(a.sortDate || '')));
    return opts.limit ? out.slice(0, opts.limit) : out;
  },

  // ═══════════════════════════════════════════════════════════════════════
  // État de synchronisation
  // ═══════════════════════════════════════════════════════════════════════

  async getSyncState(accountId: string, folder: string): Promise<FolderSyncRecord | undefined> {
    const db = await getDB();
    return db.get('syncState', [accountId, folder]);
  },

  async putSyncState(state: FolderSyncRecord) {
    const db = await getDB();
    await db.put('syncState', state);
  },

  async getAllSyncStates(): Promise<FolderSyncRecord[]> {
    const db = await getDB();
    return db.getAll('syncState');
  },

  /**
   * Purge un dossier et lui seul — le cas UIDVALIDITY. Un changement de
   * numérotation sur un dossier ne dit rien des autres : les vider tous
   * coûterait une resynchronisation complète sans raison.
   */
  async deleteFolderData(accountId: string, folder: string) {
    const db = await getDB();
    const tx = db.transaction(['emails', 'bodies', 'syncState'], 'readwrite');
    const key = IDBKeyRange.only([accountId, folder]);

    let freed = 0;
    let bodyCursor = await tx.objectStore('bodies').index('folder').openCursor(key);
    while (bodyCursor) {
      freed += Number((bodyCursor.value as any).bytes) || 0;
      await bodyCursor.delete();
      bodyCursor = await bodyCursor.continue();
    }

    let mailCursor = await tx.objectStore('emails').index('folder').openCursor(key);
    while (mailCursor) {
      await mailCursor.delete();
      mailCursor = await mailCursor.continue();
    }

    await tx.objectStore('syncState').delete([accountId, folder]);
    await tx.done;
    await bumpBodyBytes(db, -freed);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Outbox / contacts / événements / brouillons / dossiers — inchangés
  // ═══════════════════════════════════════════════════════════════════════

  async addToOutbox(email: any) {
    const db = await getDB();
    return db.add('outbox', { ...email, createdAt: new Date().toISOString() });
  },

  async getOutbox() {
    const db = await getDB();
    return db.getAll('outbox');
  },

  async removeFromOutbox(id: number) {
    const db = await getDB();
    return db.delete('outbox', id);
  },

  async cacheContacts(contacts: any[]) {
    const db = await getDB();
    const tx = db.transaction('contacts', 'readwrite');
    for (const contact of contacts) {
      await tx.store.put(contact);
    }
    await tx.done;
  },

  async getContacts() {
    const db = await getDB();
    return db.getAll('contacts');
  },

  async searchContacts(query: string) {
    const db = await getDB();
    const all = await db.getAll('contacts');
    const q = query.toLowerCase();
    return all.filter(c =>
      c.email?.toLowerCase().includes(q) ||
      c.first_name?.toLowerCase().includes(q) ||
      c.last_name?.toLowerCase().includes(q) ||
      c.display_name?.toLowerCase().includes(q)
    );
  },

  async cacheEvents(events: any[]) {
    const db = await getDB();
    const tx = db.transaction('events', 'readwrite');
    for (const event of events) {
      await tx.store.put(event);
    }
    await tx.done;
  },

  async getEvents(start: string, end: string) {
    const db = await getDB();
    const all = await db.getAll('events');
    return all.filter(e => e.start_date >= start && e.start_date <= end);
  },

  async saveDraft(draft: any) {
    const db = await getDB();
    if (draft.id) {
      return db.put('drafts', draft);
    }
    return db.add('drafts', { ...draft, createdAt: new Date().toISOString() });
  },

  async getDrafts() {
    const db = await getDB();
    return db.getAll('drafts');
  },

  async deleteDraft(id: number) {
    const db = await getDB();
    return db.delete('drafts', id);
  },

  async cacheFolders(accountId: string, folders: any[]) {
    const db = await getDB();
    await db.put('folders', { accountId, folders, cachedAt: new Date().toISOString() });
  },

  async getFoldersCache(accountId: string): Promise<any[] | null> {
    const db = await getDB();
    const entry = await db.get('folders', accountId);
    return entry?.folders ?? null;
  },

  async getAllAccountFolders(): Promise<Array<{ accountId: string; folders: any[] }>> {
    const db = await getDB();
    return db.getAll('folders');
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Meta
  // ═══════════════════════════════════════════════════════════════════════

  async setMeta(key: string, value: any) {
    const db = await getDB();
    await db.put('meta', value, key);
  },

  async getMeta<T = any>(key: string): Promise<T | undefined> {
    const db = await getDB();
    return db.get('meta', key);
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Statistiques, persistance, éviction
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Demande au navigateur de marquer le stockage comme persistant.
   *
   * Sans cela, l'origine peut être évincée sous pression disque — ce qui
   * réduirait à néant une première synchronisation de plusieurs heures.
   */
  async requestPersistence(): Promise<boolean> {
    try {
      if (!navigator.storage?.persist) return false;
      if (await navigator.storage.persisted?.()) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  },

  /**
   * Comptages via `count()` sur index, jamais via `getAll()`.
   *
   * L'ancienne version chargeait tous les enregistrements en mémoire pour les
   * compter : avec un cache complet, elle aurait fait tomber l'onglet.
   */
  async getStats(): Promise<CacheStats> {
    const db = await getDB();
    const [emails, bodies, contacts, events, folderEntries] = await Promise.all([
      db.count('emails'),
      db.count('bodies'),
      db.count('contacts'),
      db.count('events'),
      db.getAll('folders'),
    ]);

    const folderCount = folderEntries.reduce(
      (acc, entry) => acc + (Array.isArray(entry?.folders) ? entry.folders.length : 0),
      0,
    );

    let quota: number | undefined;
    let usage: number | undefined;
    let persisted: boolean | undefined;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        quota = est.quota;
        usage = est.usage;
      }
      persisted = await navigator.storage?.persisted?.();
    } catch {
      // ignore
    }

    const [bodyBytes, lastSync] = await Promise.all([
      db.get('meta', BODY_BYTES_KEY) as Promise<number | undefined>,
      db.get('meta', 'lastSync') as Promise<string | undefined>,
    ]);

    return {
      emails,
      bodies,
      bodyBytes: bodyBytes || 0,
      folders: folderCount,
      contacts,
      events,
      quota,
      usage,
      persisted,
      lastSync: lastSync ?? null,
    };
  },

  /**
   * Libère de la place en supprimant les corps les plus anciens.
   *
   * Seuls les corps sont évincés : les en-têtes sont légers et sont ce qui fait
   * vivre l'affichage et le tri. Les perdre dégraderait l'application bien plus
   * que de perdre un corps, qui se retélécharge à l'ouverture.
   */
  async evictOldestBodies(targetBytes: number): Promise<number> {
    if (targetBytes <= 0) return 0;
    const db = await getDB();
    const tx = db.transaction(['bodies', 'emails'], 'readwrite');
    const emailStore = tx.objectStore('emails');
    let freed = 0;

    let cursor = await tx.objectStore('bodies').index('cachedAt').openCursor();
    while (cursor && freed < targetBytes) {
      const value: any = cursor.value;
      freed += Number(value.bytes) || 0;

      const email: any = await emailStore.get(value.id);
      if (email) {
        // Retour à un index sujet/expéditeur : le message reste listable et
        // trouvable par son objet, il n'est simplement plus cherchable au corps.
        // Le corps s'en va, mais le message reste trouvable par son objet, ses
        // correspondants et le nom de ses pièces jointes.
        email.terms = buildTerms({
          subject: email.subject,
          fromName: email.from?.name,
          fromAddress: email.from?.address,
          to: email.to,
          cc: email.cc,
          attachmentNames: (value.attachments || []).map((a: any) => a?.filename),
        });
        email.hasBody = false;
        await emailStore.put(email);
      }

      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
    await bumpBodyBytes(db, -freed);
    return freed;
  },

  async clearAll() {
    const db = await getDB();
    const stores = ['emails', 'bodies', 'syncState', 'folders', 'contacts', 'events', 'meta'] as const;
    await Promise.all(stores.map((s) => db.clear(s)));
  },
};
