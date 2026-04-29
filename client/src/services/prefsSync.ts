/**
 * Cross-device preferences synchronisation.
 *
 * Mirrors a curated set of `localStorage` keys (account/folder names,
 * ordering, colours, calendar preferences, layout, signatures, swipe
 * actions, theme, etc.) into the per-user `user_preferences` table on
 * the server, so the same customisations follow the user across PCs,
 * phones and tablets.
 *
 * Strategy
 * ────────
 * • Each key tracks two ISO timestamps:
 *     - `local[key]`  → last time the key changed on this device.
 *     - `remote[key]` → last server-side timestamp this device has seen.
 * • A key needs a **push** when `local[key] !== remote[key]`.
 * • A key needs a **pull** when the server reports a newer `updatedAt`.
 * • Conflict resolution is **last-write-wins** on `updatedAt`. The PUT
 *   endpoint enforces this with a SQL `WHERE updated_at < EXCLUDED.updated_at`.
 *
 * The set of synchronised keys is shared with the local backup module
 * (see `BACKUP_KEYS` / `BACKUP_PREFIXES` in `utils/backup.ts`) — anything
 * the user can already export through the manual backup is also a
 * candidate for cloud sync.
 */

import { api } from '../api';
import { BACKUP_KEYS, BACKUP_PREFIXES, isSyncableKey, LOCAL_SETTINGS_CHANGED_EVENT } from '../utils/backup';

// localStorage meta keys (never themselves synced).
const META_LOCAL = 'prefsSync.local';
const META_REMOTE = 'prefsSync.remote';
const META_ENABLED = 'prefsSync.enabled';
const META_LAST_SYNC = 'prefsSync.lastSync';
const META_LAST_ERROR = 'prefsSync.lastError';
const META_PREFIXES = ['prefsSync.', 'backup.'];

const PUSH_DEBOUNCE_MS = 1500;
const PULL_INTERVAL_MS = 5 * 60 * 1000;

const SYNC_STATUS_EVENT = 'prefs-sync-status-changed';

let started = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let internalWrite = false;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function readMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, string>) {
  try {
    internalWrite = true;
    localStorage.setItem(key, JSON.stringify(value));
  } finally {
    internalWrite = false;
  }
}

function isMetaKey(key: string): boolean {
  return META_PREFIXES.some((p) => key.startsWith(p));
}

function emitStatus(status: 'idle' | 'pulling' | 'pushing' | 'error', detail?: string) {
  try {
    window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: { status, detail } }));
  } catch {
    /* noop */
  }
}

export function isPrefsSyncEnabled(): boolean {
  // Default is enabled; the user can opt out from Settings.
  const v = localStorage.getItem(META_ENABLED);
  return v === null ? true : v === 'true';
}

export function setPrefsSyncEnabled(enabled: boolean) {
  internalWrite = true;
  try {
    localStorage.setItem(META_ENABLED, enabled ? 'true' : 'false');
  } finally {
    internalWrite = false;
  }
  if (enabled) {
    schedulePush(0);
  }
}

export function getLastSyncAt(): string | null {
  return localStorage.getItem(META_LAST_SYNC);
}

export function getLastSyncError(): string | null {
  return localStorage.getItem(META_LAST_ERROR);
}

function setLastSyncAt(iso: string) {
  internalWrite = true;
  try {
    localStorage.setItem(META_LAST_SYNC, iso);
    localStorage.removeItem(META_LAST_ERROR);
  } finally {
    internalWrite = false;
  }
}

function setLastSyncError(message: string) {
  internalWrite = true;
  try {
    localStorage.setItem(META_LAST_ERROR, message);
  } finally {
    internalWrite = false;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Marks a key as locally modified (without itself triggering a sync of the meta map). */
function markLocalChange(key: string, ts: string = nowIso()) {
  const local = readMap(META_LOCAL);
  local[key] = ts;
  writeMap(META_LOCAL, local);
}

// ─────────────────────────────────────────────────────────────────────────
// Pull / push
// ─────────────────────────────────────────────────────────────────────────

async function pullFromServer(): Promise<void> {
  emitStatus('pulling');
  const { items } = await api.getPreferences();
  const local = readMap(META_LOCAL);
  const remote = readMap(META_REMOTE);

  for (const [key, entry] of Object.entries(items)) {
    if (!isSyncableKey(key)) continue;
    const remoteTs = entry.updatedAt;
    const localTs = local[key];
    // Apply remote when there's no local timestamp or remote is strictly newer.
    if (!localTs || Date.parse(remoteTs) > Date.parse(localTs)) {
      internalWrite = true;
      try {
        if (entry.value === null) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, entry.value);
        }
      } finally {
        internalWrite = false;
      }
      local[key] = remoteTs;
    }
    remote[key] = remoteTs;
  }

  writeMap(META_LOCAL, local);
  writeMap(META_REMOTE, remote);
  // Notify stores that depend on these keys (signatures, categories, swipe prefs…).
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('mail-categories-changed')); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('mail-swipe-prefs-changed')); } catch { /* noop */ }
}

/** Returns the keys that need to be pushed (local timestamp differs from remote). */
function collectDirtyKeys(): string[] {
  const local = readMap(META_LOCAL);
  const remote = readMap(META_REMOTE);
  const seen = new Set<string>();
  const keys: string[] = [];

  // Backup-listed keys present in localStorage even without a local timestamp
  // get one synthesised so they are pushed at least once on first run.
  for (const k of BACKUP_KEYS) {
    if (localStorage.getItem(k) !== null && !local[k]) {
      local[k] = nowIso();
    }
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !isSyncableKey(k)) continue;
    if (!local[k]) local[k] = nowIso();
  }
  writeMap(META_LOCAL, local);

  for (const k of Object.keys(local)) {
    if (!isSyncableKey(k)) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    if (local[k] !== remote[k]) keys.push(k);
  }
  return keys;
}

async function pushToServer(): Promise<void> {
  const dirty = collectDirtyKeys();
  if (dirty.length === 0) return;
  emitStatus('pushing');

  const local = readMap(META_LOCAL);
  const items: Record<string, { value: string | null; updatedAt: string }> = {};
  for (const k of dirty) {
    items[k] = {
      value: localStorage.getItem(k), // null → key was removed locally
      updatedAt: local[k],
    };
  }

  const { items: accepted } = await api.putPreferences(items);
  const remote = readMap(META_REMOTE);
  for (const [k, entry] of Object.entries(accepted)) {
    remote[k] = entry.updatedAt;
    // Snap the local timestamp to whatever the server stored, so the key is
    // no longer considered dirty.
    local[k] = entry.updatedAt;
  }
  writeMap(META_LOCAL, local);
  writeMap(META_REMOTE, remote);

  // For keys that were rejected (server had newer values), a follow-up pull
  // brings the newer value down.
  const rejected = dirty.filter((k) => !(k in accepted));
  if (rejected.length > 0) {
    await pullFromServer();
  }
}

async function runSyncCycle(): Promise<void> {
  if (!isPrefsSyncEnabled()) return;
  try {
    await pullFromServer();
    await pushToServer();
    setLastSyncAt(nowIso());
    emitStatus('idle');
  } catch (err: any) {
    const msg = err?.message || 'Erreur de synchronisation';
    setLastSyncError(msg);
    emitStatus('error', msg);
    console.warn('[prefsSync] sync cycle failed:', err);
  }
}

function schedulePush(delay: number = PUSH_DEBOUNCE_MS) {
  if (!isPrefsSyncEnabled()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void runSyncCycle();
  }, delay);
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** Boot the sync service. Safe to call multiple times. */
export function startPrefsSync(): void {
  if (started) return;
  started = true;

  // Initial reconciliation (full pull + push of any local-only changes).
  void runSyncCycle();

  // Local change events (already emitted by the backup watcher for every
  // backupable localStorage write — both same-tab and cross-tab via storage).
  window.addEventListener(LOCAL_SETTINGS_CHANGED_EVENT, (e: any) => {
    if (internalWrite) return;
    const key = e?.detail?.key;
    if (typeof key === 'string') markLocalChange(key);
    schedulePush();
  });
  window.addEventListener('storage', (e) => {
    if (!e.key || isMetaKey(e.key) || !isSyncableKey(e.key)) return;
    markLocalChange(e.key);
    schedulePush();
  });

  // Periodic pull catches changes made on other devices when the app is
  // left open (background tab on a desktop, for instance).
  pullTimer = setInterval(() => {
    void runSyncCycle();
  }, PULL_INTERVAL_MS);

  // Last-chance push before the tab closes.
  window.addEventListener('beforeunload', () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
      // Best-effort fire-and-forget; the browser may or may not let it complete.
      void pushToServer().catch(() => undefined);
    }
  });
}

export function stopPrefsSync(): void {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (pullTimer) { clearInterval(pullTimer); pullTimer = null; }
  started = false;
}

/** Force a sync cycle now (used by the Settings page button). */
export async function triggerPrefsSyncNow(): Promise<void> {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  await runSyncCycle();
}

export const PREFS_SYNC_EVENT = SYNC_STATUS_EVENT;
