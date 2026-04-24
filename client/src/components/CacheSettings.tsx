import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Database, RefreshCw, Trash2, HardDrive, Folder, Paperclip, Mail } from 'lucide-react';
import { useCacheStore } from '../stores/cacheStore';
import { offlineDB } from '../pwa/offlineDB';
import { syncAllCache, purgeCache, refreshCacheStats } from '../services/cacheService';

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Jamais';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

interface FolderBreakdown {
  account: string;
  folder: string;
  count: number;
}

export default function CacheSettings() {
  const { stats, isRunning, phase, progress, currentLabel, processedItems, totalItems, lastError } =
    useCacheStore();
  const [breakdown, setBreakdown] = useState<FolderBreakdown[]>([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const refresh = async () => {
    setLoadingBreakdown(true);
    try {
      await refreshCacheStats();
      // Build a small per-folder breakdown from cached emails + account folders metadata.
      const [accountFolders, emails] = await Promise.all([
        offlineDB.getAllAccountFolders(),
        offlineDB.getAllCachedEmails(),
      ]);

      const accountsById: Record<string, string> = {};
      for (const entry of accountFolders) {
        const folders: any[] = Array.isArray(entry.folders) ? entry.folders : [];
        const anyFolder = folders[0];
        accountsById[entry.accountId] =
          anyFolder?.accountName || entry.accountId.slice(0, 8);
      }

      const map = new Map<string, FolderBreakdown>();
      for (const e of emails) {
        const key = `${e.accountId}::${e.folder}`;
        const cur = map.get(key);
        if (cur) cur.count += 1;
        else
          map.set(key, {
            account: accountsById[e.accountId] || e.accountId,
            folder: e.folder,
            count: 1,
          });
      }
      setBreakdown(Array.from(map.values()).sort((a, b) => b.count - a.count));
    } finally {
      setLoadingBreakdown(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch the breakdown when a sync run completes.
  useEffect(() => {
    if (!isRunning && (phase === 'done' || phase === 'error')) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, phase]);

  const quotaPct = useMemo(() => {
    if (!stats?.quota || !stats.usage) return null;
    return Math.min(100, Math.round((stats.usage / stats.quota) * 100));
  }, [stats?.quota, stats?.usage]);

  const handleSync = () => {
    if (isRunning) return;
    toast.promise(syncAllCache({ force: true }), {
      loading: 'Mise en cache en cours…',
      success: 'Cache mis à jour',
      error: 'Échec de la mise en cache',
    });
  };

  const handlePurge = async () => {
    try {
      await purgeCache();
      setBreakdown([]);
      toast.success('Cache vidé');
      setConfirmPurge(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de la purge');
    }
  };

  const handleRebuild = async () => {
    try {
      await purgeCache();
      setBreakdown([]);
      toast.success('Cache réinitialisé — reconstruction…');
      setConfirmPurge(false);
      await syncAllCache({ force: true });
      toast.success('Cache reconstruit');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
        <Database size={18} /> Cache local
      </h3>
      <p className="text-sm text-outlook-text-secondary mb-4">
        Le cache local conserve vos dossiers, messages et métadonnées de pièces jointes dans votre
        navigateur afin d'accélérer l'affichage et de permettre la consultation hors-ligne.
      </p>

      {/* Live progress */}
      {(isRunning || phase === 'error') && (
        <div className="mb-4 p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <div className="flex items-center justify-between mb-1 text-sm">
            <span className="flex items-center gap-2">
              <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
              {currentLabel || 'Mise en cache…'}
            </span>
            <span className="text-outlook-text-secondary">{progress}%</span>
          </div>
          <div className="w-full h-2 bg-outlook-bg-hover rounded overflow-hidden">
            <div
              className={phase === 'error' ? 'h-full bg-red-500' : 'h-full bg-outlook-blue'}
              style={{ width: `${progress}%`, transition: 'width 0.3s ease' }}
            />
          </div>
          {totalItems > 0 && (
            <div className="mt-1 text-xs text-outlook-text-secondary">
              {processedItems} / {totalItems} dossiers traités
            </div>
          )}
          {lastError && <div className="mt-1 text-xs text-red-500">{lastError}</div>}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={Mail} label="E-mails" value={stats?.emails ?? 0} />
        <StatCard icon={Paperclip} label="Pièces jointes" value={stats?.attachments ?? 0} />
        <StatCard icon={Folder} label="Dossiers" value={stats?.folders ?? 0} />
        <StatCard icon={HardDrive} label="Poids total cache" value={formatBytes(stats?.totalSize)} />
        <StatCard icon={Paperclip} label="Poids pièces jointes" value={formatBytes(stats?.attachmentsSize)} />
        <StatCard icon={RefreshCw} label="Dernière synchro" value={formatDate(stats?.lastSync)} />
      </div>

      {/* Storage quota */}
      {stats?.quota && stats?.usage != null && (
        <div className="mb-4 p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="flex items-center gap-2">
              <HardDrive size={14} /> Espace navigateur utilisé
            </span>
            <span className="text-outlook-text-secondary">
              {formatBytes(stats.usage)} / {formatBytes(stats.quota)} ({quotaPct}%)
            </span>
          </div>
          <div className="w-full h-2 bg-outlook-bg-hover rounded overflow-hidden">
            <div
              className="h-full bg-outlook-blue"
              style={{ width: `${quotaPct ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          onClick={handleSync}
          disabled={isRunning}
          className="px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
          {isRunning ? 'En cours…' : 'Mettre à jour le cache'}
        </button>

        <button
          type="button"
          onClick={handleRebuild}
          disabled={isRunning}
          className="px-3 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Database size={14} /> Réinitialiser & reconstruire
        </button>

        {!confirmPurge ? (
          <button
            type="button"
            onClick={() => setConfirmPurge(true)}
            disabled={isRunning}
            className="px-3 py-1.5 text-sm rounded border border-red-500/50 text-red-500 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-2"
          >
            <Trash2 size={14} /> Purger le cache
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-500">Supprimer tout le cache local ?</span>
            <button
              type="button"
              onClick={handlePurge}
              className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
            >
              Confirmer
            </button>
            <button
              type="button"
              onClick={() => setConfirmPurge(false)}
              className="px-2 py-1 text-xs rounded border border-outlook-border"
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      {/* Per-folder breakdown */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold">Contenu détaillé</h4>
          <button
            type="button"
            onClick={refresh}
            className="text-xs text-outlook-blue hover:underline flex items-center gap-1"
            disabled={loadingBreakdown}
          >
            <RefreshCw size={12} className={loadingBreakdown ? 'animate-spin' : ''} /> Rafraîchir
          </button>
        </div>

        {breakdown.length === 0 ? (
          <p className="text-sm text-outlook-text-secondary italic">
            {loadingBreakdown ? 'Chargement…' : 'Aucun message en cache.'}
          </p>
        ) : (
          <div className="border border-outlook-border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-outlook-bg-primary">
                <tr className="text-left text-outlook-text-secondary">
                  <th className="px-3 py-2 font-medium">Compte</th>
                  <th className="px-3 py-2 font-medium">Dossier</th>
                  <th className="px-3 py-2 font-medium text-right">Messages</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b, i) => (
                  <tr
                    key={`${b.account}-${b.folder}-${i}`}
                    className="border-t border-outlook-border"
                  >
                    <td className="px-3 py-1.5 truncate max-w-[10rem]" title={b.account}>
                      {b.account}
                    </td>
                    <td className="px-3 py-1.5 truncate max-w-[14rem]" title={b.folder}>
                      {b.folder}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {b.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string | number;
}) {
  return (
    <div className="p-3 rounded border border-outlook-border bg-outlook-bg-primary">
      <div className="flex items-center gap-2 text-xs text-outlook-text-secondary mb-1">
        <Icon size={14} />
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold truncate" title={String(value)}>
        {value}
      </div>
    </div>
  );
}
