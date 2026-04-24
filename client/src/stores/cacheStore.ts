import { create } from 'zustand';
import type { CacheStats } from '../pwa/offlineDB';

export type CachePhase = 'idle' | 'accounts' | 'folders' | 'messages' | 'done' | 'error';

interface CacheState {
  isRunning: boolean;
  phase: CachePhase;
  /** Short label describing the current action (e.g. "Dossier Inbox — Fred Pro"). */
  currentLabel: string;
  /** Progress from 0 to 100. */
  progress: number;
  /** Number of items processed during the current sync. */
  processedItems: number;
  totalItems: number;
  lastError: string | null;
  lastSyncAt: string | null;
  stats: CacheStats | null;

  setRunning: (running: boolean) => void;
  update: (patch: Partial<Omit<CacheState, keyof ReturnType<typeof actionsShape>>>) => void;
  setStats: (stats: CacheStats | null) => void;
  reset: () => void;
}

// Phantom helper so TS understands which keys are actions vs data.
const actionsShape = () => ({
  setRunning: (_: boolean) => {},
  update: (_: any) => {},
  setStats: (_: any) => {},
  reset: () => {},
});

export const useCacheStore = create<CacheState>((set) => ({
  isRunning: false,
  phase: 'idle',
  currentLabel: '',
  progress: 0,
  processedItems: 0,
  totalItems: 0,
  lastError: null,
  lastSyncAt: null,
  stats: null,

  setRunning: (running) => set({ isRunning: running }),
  update: (patch) => set(patch as any),
  setStats: (stats) => set({ stats, lastSyncAt: stats?.lastSync ?? null }),
  reset: () =>
    set({
      isRunning: false,
      phase: 'idle',
      currentLabel: '',
      progress: 0,
      processedItems: 0,
      totalItems: 0,
      lastError: null,
    }),
}));
