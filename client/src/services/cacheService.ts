/**
 * Client-side cache service.
 *
 * Walks every mail account → every folder → caches the folder tree and the
 * message list of each folder into IndexedDB so that mail pages load instantly
 * and remain available offline. Progress is streamed live into the
 * `cacheStore` so the top-bar indicator and the Settings page can display it.
 *
 * Full message bodies and attachment bytes are cached lazily, as the user
 * opens them — that keeps the initial sync bounded.
 */

import { api } from '../api';
import { offlineDB } from '../pwa/offlineDB';
import { useCacheStore } from '../stores/cacheStore';

let currentRun: Promise<void> | null = null;

/** Folders that are rarely useful to pre-cache; we skip them unless explicitly asked. */
const SKIP_FOLDER_HINTS = ['\\All', '\\Junk']; // keep Trash + Archive — users do consult them

/** Time window during which the cache is considered fresh enough to skip a full resync. */
export const CACHE_FRESHNESS_MS = 15 * 60 * 1000; // 15 minutes

/** Per-folder freshness window: skip re-fetching a folder synced more recently than this. */
const FOLDER_FRESHNESS_MS = 10 * 60 * 1000; // 10 minutes

/** Number of folders we refresh in parallel. Kept low so the IMAP side stays happy. */
const FOLDER_CONCURRENCY = 4;

function shouldSkipFolder(f: any): boolean {
  if (!f) return true;
  const flags: string[] = Array.isArray(f.flags) ? f.flags : [];
  const specialUse: string = f.specialUse || '';
  return SKIP_FOLDER_HINTS.some((h) => specialUse === h || flags.includes(h));
}

function folderMetaKey(accountId: string, folderPath: string): string {
  return `folder:${accountId}:${folderPath}`;
}

/** Compute a cheap fingerprint of a message list (UIDs + read/flagged state). */
function fingerprintMessages(messages: Array<{ uid: number; flags?: { seen?: boolean; flagged?: boolean } }>): string {
  // Sort by uid so ordering differences don't trigger a rewrite.
  const items = messages
    .map((m) => `${m.uid}:${m.flags?.seen ? 1 : 0}${m.flags?.flagged ? 1 : 0}`)
    .sort();
  return `${items.length}|${items.join(',')}`;
}

/** Refresh stats without touching the running flag. */
export async function refreshCacheStats() {
  const stats = await offlineDB.getStats();
  useCacheStore.getState().setStats(stats);
  return stats;
}

/** Check whether the cache has been refreshed within `CACHE_FRESHNESS_MS`. */
export async function isCacheFresh(maxAgeMs = CACHE_FRESHNESS_MS): Promise<boolean> {
  const last = await offlineDB.getMeta<string>('lastSync');
  if (!last) return false;
  const ts = Date.parse(last);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < maxAgeMs;
}

/**
 * Synchronise all folders & messages for every configured account.
 * If a sync is already in progress, the existing promise is returned.
 *
 * @param opts.force - Ignore every freshness check and re-fetch everything (default: false).
 *                     Without `force`, the sync is **incremental**: folders synced within the
 *                     last {@link FOLDER_FRESHNESS_MS} are skipped, and folders whose server
 *                     fingerprint matches the cached one are not rewritten to IndexedDB.
 */
export function syncAllCache(opts: { force?: boolean } = {}): Promise<void> {
  if (currentRun) return currentRun;
  currentRun = runSync(!!opts.force).finally(() => {
    currentRun = null;
  });
  return currentRun;
}

async function runSync(force: boolean) {
  const store = useCacheStore.getState();
  store.reset();
  store.setRunning(true);
  store.update({ phase: 'accounts', currentLabel: 'Lecture des comptes…', progress: 1 });

  try {
    const accounts = await api.getAccounts();
    if (!accounts?.length) {
      store.update({ phase: 'done', progress: 100, currentLabel: 'Aucun compte configuré' });
      await offlineDB.setMeta('lastSync', new Date().toISOString());
      await refreshCacheStats();
      return;
    }

    // Pass 1 — collect folders per account.
    store.update({ phase: 'folders', currentLabel: 'Collecte des dossiers…', progress: 3 });
    const plan: Array<{ account: any; folder: any }> = [];
    for (const account of accounts) {
      try {
        const folders = await api.getFolders(account.id);
        await offlineDB.cacheFolders(account.id, folders || []);
        for (const folder of folders || []) {
          if (shouldSkipFolder(folder)) continue;
          plan.push({ account, folder });
        }
      } catch (err) {
        // An account could be unreachable — keep going with the others.
        console.warn('[cache] failed to list folders for', account?.email, err);
      }
    }

    if (plan.length === 0) {
      store.update({ phase: 'done', progress: 100, currentLabel: 'Aucun dossier à mettre en cache' });
      await offlineDB.setMeta('lastSync', new Date().toISOString());
      await refreshCacheStats();
      return;
    }

    // Pass 2 — cache messages folder by folder, in parallel (bounded concurrency).
    store.update({
      phase: 'messages',
      totalItems: plan.length,
      processedItems: 0,
      currentLabel: force ? 'Resynchronisation complète…' : 'Mise à jour incrémentale…',
    });

    const now = Date.now();
    let done = 0;
    let skipped = 0;
    let refreshed = 0;

    const syncOne = async ({ account, folder }: { account: any; folder: any }) => {
      const label = `${folder.name || folder.path} — ${account.email || account.name || ''}`.trim();
      store.update({ currentLabel: label });

      const metaKey = folderMetaKey(account.id, folder.path);
      const meta = (await offlineDB.getMeta<{ syncedAt: string; fingerprint: string }>(metaKey)) || null;

      // Freshness skip: folder synced recently → leave IndexedDB alone.
      if (!force && meta?.syncedAt) {
        const ts = Date.parse(meta.syncedAt);
        if (!Number.isNaN(ts) && now - ts < FOLDER_FRESHNESS_MS) {
          skipped += 1;
          return;
        }
      }

      try {
        const result = await api.getMessages(account.id, folder.path, 1);
        const messages = result?.messages || [];
        const fingerprint = fingerprintMessages(messages);

        // Fingerprint match → nothing changed, don't rewrite IndexedDB.
        if (!force && meta?.fingerprint === fingerprint) {
          await offlineDB.setMeta(metaKey, { syncedAt: new Date().toISOString(), fingerprint });
          skipped += 1;
          return;
        }

        if (messages.length) {
          await offlineDB.cacheEmails(
            messages.map((m: any) => ({
              ...m,
              id: `${account.id}-${folder.path}-${m.uid}`,
              accountId: account.id,
              folder: folder.path,
            })),
          );
        }
        await offlineDB.setMeta(metaKey, { syncedAt: new Date().toISOString(), fingerprint });
        refreshed += 1;
      } catch (err) {
        console.warn('[cache] failed to cache', folder.path, 'of', account.email, err);
      }
    };

    // Parallel worker pool — keeps FOLDER_CONCURRENCY folders in flight at once.
    const queue = [...plan];
    const workers = Array.from({ length: Math.min(FOLDER_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) break;
        await syncOne(item);
        done += 1;
        const progress = Math.min(99, Math.round((done / plan.length) * 100));
        store.update({ processedItems: done, progress });
      }
    });
    await Promise.all(workers);

    await offlineDB.setMeta('lastSync', new Date().toISOString());
    store.update({
      phase: 'done',
      progress: 100,
      currentLabel:
        refreshed === 0
          ? 'Cache déjà à jour'
          : `Cache mis à jour — ${refreshed} dossier(s) actualisé(s), ${skipped} inchangé(s)`,
    });
    await refreshCacheStats();
  } catch (err: any) {
    console.error('[cache] sync failed', err);
    store.update({
      phase: 'error',
      lastError: err?.message || 'Erreur inconnue',
      currentLabel: 'Échec de la mise en cache',
    });
    await refreshCacheStats();
  } finally {
    store.setRunning(false);
  }
}

/** Purge every cached mail/folder and reset the state. */
export async function purgeCache() {
  await offlineDB.clearAll();
  useCacheStore.getState().reset();
  await refreshCacheStats();
}
