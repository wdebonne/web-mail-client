import { useEffect, useRef, useState } from 'react';
import { useCacheStore } from '../stores/cacheStore';
import {
  runDeltaSync,
  runBackfill,
  pauseBackfill,
  resumeBackfill,
  refreshCacheStats,
} from '../services/cacheService';
import { Database, CheckCircle2, AlertCircle, RefreshCw, Pause, Play } from 'lucide-react';

/**
 * Indicateur circulaire de la barre supérieure.
 *
 * L'anneau suit la tâche la plus longue en cours : le remplissage initial quand
 * il tourne (il dure), sinon le delta (il ne dure pas). Confondre les deux
 * donnerait une jauge qui saute de 3 % à 100 % sans rien vouloir dire.
 */
export default function CacheIndicator() {
  const { delta, backfill, backfillPaused, lastSyncAt, stats } = useCacheStore();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    refreshCacheStats().catch(() => {});
  }, []);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setPopoverOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [popoverOpen]);

  // Le backfill prime sur le delta : c'est lui qui a une durée perceptible.
  const active = backfill.running ? backfill : delta;
  const isRunning = delta.running || backfill.running;
  const hasError = delta.phase === 'error' || backfill.phase === 'error';

  const size = 28;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, active.progress));
  const dashOffset = circumference * (1 - pct / 100);

  const statusIcon = () => {
    if (hasError) return <AlertCircle size={12} className="text-red-300" />;
    if (isRunning) return <RefreshCw size={12} className="text-white animate-spin" />;
    if (delta.phase === 'done') return <CheckCircle2 size={12} className="text-emerald-300" />;
    return <Database size={12} className="text-white/80" />;
  };

  const ringColor = hasError
    ? '#fca5a5'
    : delta.phase === 'done' && !isRunning
      ? '#6ee7b7'
      : '#ffffff';

  const formatDate = (iso: string | null) => {
    if (!iso) return 'jamais';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const formatCount = (n: number | undefined) => (n ?? 0).toLocaleString();

  const title = isRunning
    ? `${active.label || 'Synchronisation…'} — ${pct}%`
    : hasError
      ? `Erreur : ${delta.error || backfill.error}`
      : `Cache local — dernière synchro ${formatDate(lastSyncAt)}`;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        className="w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center transition-colors"
        aria-label="État du cache local"
        title={title}
      >
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={ringColor}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={isRunning || delta.phase === 'done' ? dashOffset : circumference}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.3s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">{statusIcon()}</div>
        </div>
      </button>

      {popoverOpen && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-2 z-50 w-80 bg-outlook-bg-secondary text-outlook-text-primary border border-outlook-border rounded-md shadow-lg p-3 text-sm"
        >
          <div className="font-medium mb-2">Cache local</div>

          {/* Mise à jour — courte et fréquente */}
          <TaskRow
            name="Mise à jour"
            state={delta}
            hint={delta.running ? delta.label : 'Vérifie ce qui a changé toutes les minutes'}
          />

          {/* Remplissage — long, reprenable */}
          {(backfill.running || backfill.processed > 0 || backfillPaused) && (
            <TaskRow
              name="Remplissage"
              state={backfill}
              hint={
                backfillPaused
                  ? 'En pause — reprendra là où il s’est arrêté'
                  : backfill.label || 'Télécharge les messages plus anciens'
              }
            />
          )}

          <div className="text-xs text-outlook-text-secondary mt-3 space-y-0.5">
            <div>
              {formatCount(stats?.emails)} message(s) en cache, dont{' '}
              {formatCount(stats?.bodies)} avec leur contenu
            </div>
            <div>Dernière synchro : {formatDate(lastSyncAt)}</div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPopoverOpen(false);
                void runDeltaSync({ force: true }).then(() => runBackfill());
              }}
              disabled={delta.running}
              className="flex-1 px-2 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {delta.running ? 'En cours…' : 'Mettre à jour'}
            </button>

            {(backfill.running || backfillPaused) && (
              <button
                type="button"
                onClick={() => (backfillPaused ? resumeBackfill() : pauseBackfill())}
                className="px-2 py-1.5 text-xs rounded border border-outlook-border hover:bg-outlook-bg-hover flex items-center gap-1"
                title={backfillPaused ? 'Reprendre le remplissage' : 'Suspendre le remplissage'}
              >
                {backfillPaused ? <Play size={12} /> : <Pause size={12} />}
                {backfillPaused ? 'Reprendre' : 'Pause'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  name,
  state,
  hint,
}: {
  name: string;
  state: { running: boolean; phase: string; progress: number; processed: number; total: number; error: string | null };
  hint: string;
}) {
  const pct = Math.max(0, Math.min(100, state.progress));
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{name}</span>
        <span className="text-outlook-text-secondary">
          {state.running || state.phase === 'done' ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="w-full h-1.5 bg-outlook-bg-hover rounded overflow-hidden">
        <div
          className={`h-full ${state.phase === 'error' ? 'bg-red-500' : 'bg-outlook-blue'}`}
          style={{ width: `${pct}%`, transition: 'width 0.3s ease' }}
        />
      </div>
      <div className="text-xs text-outlook-text-secondary break-words mt-0.5 min-h-[1.2em]">
        {state.error || hint}
      </div>
      {state.total > 0 && state.running && (
        <div className="text-xs text-outlook-text-secondary">
          {state.processed.toLocaleString()} / {state.total.toLocaleString()}
        </div>
      )}
    </div>
  );
}
