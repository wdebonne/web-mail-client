import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Database, RefreshCw, Trash2, HardDrive, Folder, FileText, ShieldCheck, Mail } from 'lucide-react';
import { useCacheStore } from '../stores/cacheStore';
import { offlineDB } from '../pwa/offlineDB';
import {
  runDeltaSync,
  runBackfill,
  pauseBackfill,
  resumeBackfill,
  purgeCache,
  refreshCacheStats,
} from '../services/cacheService';

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
  /** Messages dont le corps est en cache — ce qui rend la recherche complète. */
  bodies: number;
}

export default function CacheSettings() {
  const { stats, delta, backfill, backfillPaused } = useCacheStore();
  const isRunning = delta.running || backfill.running;
  const [breakdown, setBreakdown] = useState<FolderBreakdown[]>([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);

  const refresh = async () => {
    setLoadingBreakdown(true);
    try {
      await refreshCacheStats();

      // Le détail se construit par `count()` sur index, dossier par dossier.
      // L'ancienne version chargeait tous les messages en mémoire pour les
      // compter : avec un cache complet, elle ferait tomber l'onglet.
      const accountFolders = await offlineDB.getAllAccountFolders();
      const rows: FolderBreakdown[] = [];

      for (const entry of accountFolders) {
        const folders: any[] = Array.isArray(entry.folders) ? entry.folders : [];
        const accountLabel = folders[0]?.accountName || entry.accountId.slice(0, 8);
        for (const folder of folders) {
          const path = folder?.path;
          if (!path) continue;
          const count = await offlineDB.countFolder(entry.accountId, path);
          if (count === 0) continue;
          rows.push({
            account: accountLabel,
            folder: folder.name || path,
            count,
            bodies: await offlineDB.countFolderBodies(entry.accountId, path),
          });
        }
      }

      setBreakdown(rows.sort((a, b) => b.count - a.count));
    } finally {
      setLoadingBreakdown(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recharge le détail dès qu'une tâche se termine.
  useEffect(() => {
    if (isRunning) return;
    if (delta.phase === 'idle' && backfill.phase === 'idle') return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, delta.phase, backfill.phase]);

  const quotaPct = useMemo(() => {
    if (!stats?.quota || !stats.usage) return null;
    return Math.min(100, Math.round((stats.usage / stats.quota) * 100));
  }, [stats?.quota, stats?.usage]);

  const handleSync = () => {
    if (delta.running) return;
    toast.promise(
      runDeltaSync({ force: true }).then(() => {
        // Le remplissage repart en arrière-plan sans bloquer le toast : il peut
        // durer des minutes, l'utilisateur n'a pas à l'attendre.
        void runBackfill().catch(() => {});
      }),
      {
        loading: 'Vérification des dossiers…',
        success: 'Cache à jour',
        error: 'Échec de la mise à jour',
      },
    );
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
      setConfirmPurge(false);
      toast.success('Cache réinitialisé — reconstruction en arrière-plan');
      await runDeltaSync({ force: true });
      void runBackfill().catch(() => {});
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

      {/* Progression — deux tâches de natures différentes, jamais confondues */}
      {(isRunning || backfillPaused || delta.phase === 'error' || backfill.phase === 'error') && (
        <div className="mb-4 p-3 rounded border border-outlook-border bg-outlook-bg-primary space-y-3">
          <TaskProgress
            title="Mise à jour"
            subtitle="Ne télécharge que ce qui a changé depuis la dernière fois."
            state={delta}
          />
          {(backfill.running || backfillPaused || backfill.phase === 'error') && (
            <TaskProgress
              title="Remplissage du cache"
              subtitle="Récupère les messages plus anciens et leur contenu. Interruptible : la progression est conservée."
              state={backfill}
              action={
                <button
                  type="button"
                  onClick={() => (backfillPaused ? resumeBackfill() : pauseBackfill())}
                  className="px-2 py-1 text-xs rounded border border-outlook-border hover:bg-outlook-bg-hover"
                >
                  {backfillPaused ? 'Reprendre' : 'Suspendre'}
                </button>
              }
            />
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <StatCard icon={Mail} label="E-mails" value={stats?.emails ?? 0} />
        <StatCard icon={FileText} label="Corps en cache" value={stats?.bodies ?? 0} />
        <StatCard icon={Folder} label="Dossiers" value={stats?.folders ?? 0} />
        <StatCard icon={HardDrive} label="Poids des corps" value={formatBytes(stats?.bodyBytes)} />
        <StatCard
          icon={ShieldCheck}
          label="Stockage persistant"
          value={stats?.persisted ? 'Oui' : 'Non'}
        />
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
          disabled={delta.running}
          className="px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <RefreshCw size={14} className={delta.running ? 'animate-spin' : ''} />
          {delta.running ? 'En cours…' : 'Mettre à jour le cache'}
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
                  <th className="px-3 py-2 font-medium text-right">Corps</th>
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
                    <td
                      className="px-3 py-1.5 text-right font-mono tabular-nums text-outlook-text-secondary"
                      title={b.bodies < b.count ? 'Corps encore en cours de récupération' : 'Dossier complet'}
                    >
                      {b.bodies}
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

function TaskProgress({
  title,
  subtitle,
  state,
  action,
}: {
  title: string;
  subtitle: string;
  state: {
    running: boolean;
    phase: string;
    label: string;
    progress: number;
    processed: number;
    total: number;
    error: string | null;
  };
  action?: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, state.progress));
  return (
    <div>
      <div className="flex items-center justify-between mb-1 text-sm gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <RefreshCw size={14} className={state.running ? 'animate-spin' : ''} />
          <span className="truncate">{state.label || title}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-outlook-text-secondary">{pct}%</span>
          {action}
        </span>
      </div>
      <div className="w-full h-2 bg-outlook-bg-hover rounded overflow-hidden">
        <div
          className={state.phase === 'error' ? 'h-full bg-red-500' : 'h-full bg-outlook-blue'}
          style={{ width: `${pct}%`, transition: 'width 0.3s ease' }}
        />
      </div>
      <div className="mt-1 text-xs text-outlook-text-secondary">
        {state.total > 0 && state.running
          ? `${state.processed.toLocaleString()} / ${state.total.toLocaleString()} — ${subtitle}`
          : subtitle}
      </div>
      {state.error && <div className="mt-1 text-xs text-red-500">{state.error}</div>}
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
