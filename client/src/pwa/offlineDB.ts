import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'webmail-offline';
const DB_VERSION = 1;

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
    },
  });

  return dbInstance;
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
};
