/**
 * Session-only state for the security module. The actual key material lives in
 * `keystore.ts` (IndexedDB, encrypted). This store only tracks whether the user has
 * unlocked a private key during the session so signing / decryption operations can run
 * without re-prompting for the passphrase on every action.
 *
 * Unlocked state is deliberately **not persisted**: a page reload always requires
 * re-entering the passphrase.
 */
import { create } from 'zustand';
import { StoredKey } from '../crypto/keystore';
import * as openpgp from 'openpgp';

export interface UnlockedPgpEntry {
  keyId: string;
  privateKey: openpgp.PrivateKey;
  publicArmored: string;
  email: string;
}

export interface UnlockedSmimeEntry {
  keyId: string;
  certificatePem: string;
  privateKeyPkcs8Pem: string;
  email: string;
}

interface SecurityState {
  keys: StoredKey[];
  unlockedPgp: Record<string, UnlockedPgpEntry>;
  unlockedSmime: Record<string, UnlockedSmimeEntry>;
  reloadKeys: (list: StoredKey[]) => void;
  unlockPgp: (entry: UnlockedPgpEntry) => void;
  unlockSmime: (entry: UnlockedSmimeEntry) => void;
  lock: (keyId: string) => void;
  lockAll: () => void;
}

export const useSecurityStore = create<SecurityState>((set) => ({
  keys: [],
  unlockedPgp: {},
  unlockedSmime: {},
  reloadKeys: (list) => set({ keys: list }),
  unlockPgp: (entry) => set((s) => ({ unlockedPgp: { ...s.unlockedPgp, [entry.keyId]: entry } })),
  unlockSmime: (entry) => set((s) => ({ unlockedSmime: { ...s.unlockedSmime, [entry.keyId]: entry } })),
  lock: (keyId) => set((s) => {
    const { [keyId]: _p, ...restP } = s.unlockedPgp;
    const { [keyId]: _s, ...restS } = s.unlockedSmime;
    void _p; void _s;
    return { unlockedPgp: restP, unlockedSmime: restS };
  }),
  lockAll: () => set({ unlockedPgp: {}, unlockedSmime: {} }),
}));
