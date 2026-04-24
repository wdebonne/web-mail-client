import { useEffect, useRef, useState } from 'react';
import { useCacheStore } from '../stores/cacheStore';
import { syncAllCache, refreshCacheStats } from '../services/cacheService';
import { Database, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

/**
 * Small circular progress indicator shown in the top bar, to the left of the
 * user avatar. Reflects the live cache sync state and exposes a tooltip with
 * the current action + percentage.
 *
 * Clicking the indicator triggers a manual refresh of the cache.
 */
export default function CacheIndicator() {
  const { isRunning, phase, progress, currentLabel, processedItems, totalItems, lastSyncAt } =
    useCacheStore();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Load current stats on mount so the popover shows meaningful info before any sync.
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

  // SVG ring geometry.
  const size = 28;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, progress));
  const dashOffset = circumference * (1 - pct / 100);

  const statusIcon = () => {
    if (phase === 'error') return <AlertCircle size={12} className="text-red-300" />;
    if (isRunning) return <RefreshCw size={12} className="text-white animate-spin" />;
    if (phase === 'done') return <CheckCircle2 size={12} className="text-emerald-300" />;
    return <Database size={12} className="text-white/80" />;
  };

  const ringColor =
    phase === 'error' ? '#fca5a5' : phase === 'done' && !isRunning ? '#6ee7b7' : '#ffffff';

  const formatDate = (iso: string | null) => {
    if (!iso) return 'jamais';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const title = isRunning
    ? `${currentLabel || 'Mise en cache…'} — ${pct}%`
    : phase === 'error'
      ? `Erreur : ${currentLabel}`
      : `Cache local — cliquez pour synchroniser (dernière : ${formatDate(lastSyncAt)})`;

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
              strokeDashoffset={isRunning || phase === 'done' ? dashOffset : circumference}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.3s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {statusIcon()}
          </div>
        </div>
      </button>

      {popoverOpen && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-2 z-50 w-72 bg-outlook-bg-secondary text-outlook-text-primary border border-outlook-border rounded-md shadow-lg p-3 text-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">Cache local</span>
            <span className="text-xs text-outlook-text-secondary">{pct}%</span>
          </div>

          <div className="w-full h-2 bg-outlook-bg-hover rounded overflow-hidden mb-2">
            <div
              className={`h-full ${phase === 'error' ? 'bg-red-500' : 'bg-outlook-blue'}`}
              style={{ width: `${pct}%`, transition: 'width 0.3s ease' }}
            />
          </div>

          <div className="text-xs text-outlook-text-secondary break-words min-h-[1.2em]">
            {currentLabel || (isRunning ? 'Préparation…' : 'En attente')}
          </div>

          {totalItems > 0 && (
            <div className="text-xs text-outlook-text-secondary mt-1">
              {processedItems} / {totalItems} dossiers traités
            </div>
          )}

          <div className="text-xs text-outlook-text-secondary mt-2">
            Dernière synchro : {formatDate(lastSyncAt)}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => { setPopoverOpen(false); syncAllCache(); }}
              disabled={isRunning}
              className="flex-1 px-2 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'En cours…' : 'Mettre à jour'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
