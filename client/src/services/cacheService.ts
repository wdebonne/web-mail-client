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

function shouldSkipFolder(f: any): boolean {
  if (!f) return true;
  const flags: string[] = Array.isArray(f.flags) ? f.flags : [];
  const specialUse: string = f.specialUse || '';
  return SKIP_FOLDER_HINTS.some((h) => specialUse === h || flags.includes(h));
}

/** Refresh stats without touching the running flag. */
export async function refreshCacheStats() {
  const stats = await offlineDB.getStats();
  useCacheStore.getState().setStats(stats);
  return stats;
}

/**
 * Synchronise all folders & messages for every configured account.
 * If a sync is already in progress, the existing promise is returned.
 */
export function syncAllCache(): Promise<void> {
  if (currentRun) return currentRun;
  currentRun = runSync().finally(() => {
    currentRun = null;
  });
  return currentRun;
}

async function runSync() {
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

    // Pass 2 — cache messages folder by folder.
    store.update({
      phase: 'messages',
      totalItems: plan.length,
      processedItems: 0,
      currentLabel: 'Mise en cache des messages…',
    });

    let done = 0;
    for (const { account, folder } of plan) {
      const label = `${folder.name || folder.path} — ${account.email || account.name || ''}`.trim();
      store.update({ currentLabel: label });

      try {
        const result = await api.getMessages(account.id, folder.path, 1);
        const messages = result?.messages || [];
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
      } catch (err) {
        console.warn('[cache] failed to cache', folder.path, 'of', account.email, err);
      }

      done += 1;
      const progress = Math.min(99, Math.round((done / plan.length) * 100));
      store.update({ processedItems: done, progress });
    }

    await offlineDB.setMeta('lastSync', new Date().toISOString());
    store.update({ phase: 'done', progress: 100, currentLabel: 'Cache à jour' });
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
