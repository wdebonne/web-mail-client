/**
 * Passphrase-protected keystore for OpenPGP and S/MIME key material.
 *
 * Storage model (IndexedDB, database `webmail-security`, object store `keys`):
 *   { id, kind, email, name, createdAt,
 *     publicData: string (ASCII-armored PGP public key or PEM certificate),
 *     privateCiphertext: ArrayBuffer (optional, AES-GCM wrapped private key material),
 *     privateIv: ArrayBuffer (optional, 12-byte IV) }
 *
 * The master passphrase never leaves the user's browser. It is stretched with PBKDF2
 * (310 000 iterations, SHA-256, unique per-key salt stored alongside) into an AES-GCM
 * key used to wrap each private key. The unlocked session key is kept only in
 * memory (via the security store) and is cleared on lock / logout / tab close.
 */
import { openDB, IDBPDatabase } from 'idb';

export type KeyKind = 'pgp' | 'smime';

export interface StoredKey {
  id: string;
  kind: KeyKind;
  email: string;
  name?: string;
  createdAt: string;
  /** ASCII-armored PGP public key block or PEM-encoded X.509 certificate. */
  publicData: string;
  /** Optional encrypted private key material (PGP armored private key or PKCS#8 PEM). */
  privateCiphertext?: ArrayBuffer;
  privateIv?: ArrayBuffer;
  privateSalt?: ArrayBuffer;
  /** True when this is the default identity for outbound signing/decryption. */
  isDefault?: boolean;
  /** Source fingerprint / serial number (informational). */
  fingerprint?: string;
}

const DB_NAME = 'webmail-security';
const DB_VERSION = 1;
const STORE = 'keys';

let dbInstance: IDBPDatabase | null = null;

async function db(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('kind', 'kind');
        store.createIndex('email', 'email');
      }
    },
  });
  return dbInstance;
}

const enc = new TextEncoder();

/** Derive an AES-GCM key from a user passphrase using PBKDF2. */
async function deriveKey(passphrase: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptPrivate(plaintext: string, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt.buffer);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return { ciphertext, iv: iv.buffer, salt: salt.buffer };
}

async function decryptPrivate(
  ciphertext: ArrayBuffer,
  iv: ArrayBuffer,
  salt: ArrayBuffer,
  passphrase: string
): Promise<string> {
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

function genId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const keystore = {
  /** Insert a key with an optional private half encrypted by `passphrase`. */
  async put(
    entry: Omit<StoredKey, 'id' | 'createdAt' | 'privateCiphertext' | 'privateIv' | 'privateSalt'> & {
      privatePlaintext?: string;
      passphrase?: string;
    }
  ): Promise<StoredKey> {
    const base: StoredKey = {
      id: genId(),
      kind: entry.kind,
      email: entry.email,
      name: entry.name,
      createdAt: new Date().toISOString(),
      publicData: entry.publicData,
      fingerprint: entry.fingerprint,
      isDefault: entry.isDefault,
    };
    if (entry.privatePlaintext) {
      if (!entry.passphrase) throw new Error('Une phrase de passe est requise pour enregistrer une clé privée.');
      const { ciphertext, iv, salt } = await encryptPrivate(entry.privatePlaintext, entry.passphrase);
      base.privateCiphertext = ciphertext;
      base.privateIv = iv;
      base.privateSalt = salt;
    }
    const database = await db();
    // Clear any previous default of the same kind when this one is default.
    if (base.isDefault) {
      const tx = database.transaction(STORE, 'readwrite');
      const all = await tx.store.getAll() as StoredKey[];
      for (const k of all) {
        if (k.kind === base.kind && k.isDefault) {
          await tx.store.put({ ...k, isDefault: false });
        }
      }
      await tx.store.put(base);
      await tx.done;
    } else {
      await database.put(STORE, base);
    }
    return base;
  },

  async list(kind?: KeyKind): Promise<StoredKey[]> {
    const database = await db();
    const all = await database.getAll(STORE) as StoredKey[];
    return kind ? all.filter(k => k.kind === kind) : all;
  },

  async get(id: string): Promise<StoredKey | undefined> {
    const database = await db();
    return (await database.get(STORE, id)) as StoredKey | undefined;
  },

  async delete(id: string): Promise<void> {
    const database = await db();
    await database.delete(STORE, id);
  },

  async setDefault(id: string): Promise<void> {
    const database = await db();
    const target = (await database.get(STORE, id)) as StoredKey | undefined;
    if (!target) return;
    const tx = database.transaction(STORE, 'readwrite');
    const all = await tx.store.getAll() as StoredKey[];
    for (const k of all) {
      if (k.kind === target.kind) {
        await tx.store.put({ ...k, isDefault: k.id === id });
      }
    }
    await tx.done;
  },

  async defaultFor(kind: KeyKind): Promise<StoredKey | undefined> {
    const all = await this.list(kind);
    return all.find(k => k.isDefault) || all[0];
  },

  async findByEmail(email: string, kind: KeyKind): Promise<StoredKey | undefined> {
    const all = await this.list(kind);
    const target = email.toLowerCase().trim();
    return all.find(k => (k.email || '').toLowerCase().trim() === target);
  },

  /** Return the decrypted private key material for `id`, or throw if the passphrase is wrong. */
  async unlockPrivate(id: string, passphrase: string): Promise<string> {
    const entry = await this.get(id);
    if (!entry) throw new Error('Clé introuvable');
    if (!entry.privateCiphertext || !entry.privateIv || !entry.privateSalt) {
      throw new Error('Cette clé ne contient pas de partie privée.');
    }
    return decryptPrivate(entry.privateCiphertext, entry.privateIv, entry.privateSalt, passphrase);
  },
};
