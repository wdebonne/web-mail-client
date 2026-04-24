import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'webmail-offline';
const DB_VERSION = 2;

let dbInstance: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Cached emails for offline reading
      if (!db.objectStoreNames.contains('emails')) {
        const emailStore = db.createObjectStore('emails', { keyPath: 'id' });
        emailStore.createIndex('accountId', 'accountId');
        emailStore.createIndex('folder', ['accountId', 'folder']);
        emailStore.createIndex('date', 'date');
      }

      // Outbox for offline composed emails
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }

      // Contacts cache
      if (!db.objectStoreNames.contains('contacts')) {
        const contactStore = db.createObjectStore('contacts', { keyPath: 'id' });
        contactStore.createIndex('email', 'email');
        contactStore.createIndex('name', 'display_name');
      }

      // Calendar events cache
      if (!db.objectStoreNames.contains('events')) {
        const eventStore = db.createObjectStore('events', { keyPath: 'id' });
        eventStore.createIndex('calendarId', 'calendar_id');
        eventStore.createIndex('startDate', 'start_date');
      }

      // Drafts
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
      }

      // Folder tree cache (one entry per account)
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'accountId' });
      }

      // Meta (lastSync, etc.)
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    },
  });

  return dbInstance;
}

// Rough byte estimate of a JS value when serialised.
function byteSizeOf(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

export interface CacheStats {
  emails: number;
  attachments: number;
  attachmentsSize: number;
  folders: number;
  contacts: number;
  events: number;
  totalSize: number;
  quota?: number;
  usage?: number;
  lastSync?: string | null;
}

export const offlineDB = {
  // Emails
  async cacheEmails(emails: any[]) {
    const db = await getDB();
    const tx = db.transaction('emails', 'readwrite');
    for (const email of emails) {
      await tx.store.put(email);
    }
    await tx.done;
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

  // Outbox
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

  // Contacts
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

  // Events
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

  // Drafts
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

  // ===== Folder tree =====
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

  /** Return all cached emails across every account/folder — used by the Cache settings panel. */
  async getAllCachedEmails(): Promise<any[]> {
    const db = await getDB();
    return db.getAll('emails');
  },

  // ===== Meta (last sync timestamp, etc.) =====
  async setMeta(key: string, value: any) {
    const db = await getDB();
    await db.put('meta', value, key);
  },

  async getMeta<T = any>(key: string): Promise<T | undefined> {
    const db = await getDB();
    return db.get('meta', key);
  },

  // ===== Stats & purge =====
  async getStats(): Promise<CacheStats> {
    const db = await getDB();
    const [emails, contacts, events, folderEntries] = await Promise.all([
      db.getAll('emails'),
      db.getAll('contacts'),
      db.getAll('events'),
      db.getAll('folders'),
    ]);

    let attachments = 0;
    let attachmentsSize = 0;
    let emailsSize = 0;
    for (const e of emails) {
      emailsSize += byteSizeOf(e);
      const atts = Array.isArray(e?.attachments) ? e.attachments : [];
      attachments += atts.length;
      for (const a of atts) {
        attachmentsSize += Number(a?.size) || 0;
      }
    }
    const contactsSize = byteSizeOf(contacts);
    const eventsSize = byteSizeOf(events);
    const foldersSize = byteSizeOf(folderEntries);
    const folderCount = folderEntries.reduce(
      (acc, entry) => acc + (Array.isArray(entry?.folders) ? entry.folders.length : 0),
      0,
    );

    const totalSize =
      emailsSize + contactsSize + eventsSize + foldersSize + attachmentsSize;

    let quota: number | undefined;
    let usage: number | undefined;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        quota = est.quota;
        usage = est.usage;
      }
    } catch {
      // ignore
    }

    const lastSync = (await db.get('meta', 'lastSync')) as string | undefined;

    return {
      emails: emails.length,
      attachments,
      attachmentsSize,
      folders: folderCount,
      contacts: contacts.length,
      events: events.length,
      totalSize,
      quota,
      usage,
      lastSync: lastSync ?? null,
    };
  },

  async clearAll() {
    const db = await getDB();
    const stores = ['emails', 'folders', 'contacts', 'events', 'meta'] as const;
    await Promise.all(stores.map((s) => db.clear(s)));
  },
};
