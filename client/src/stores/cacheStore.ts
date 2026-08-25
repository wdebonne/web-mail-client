import { create } from 'zustand';
import type { CacheStats } from '../pwa/offlineDB';

export type TaskPhase = 'idle' | 'running' | 'done' | 'error';

/**
 * Deux tâches de nature très différentes cohabitent, et les confondre donnerait
 * une barre de progression illisible :
 *
 *  - le **delta** est court et fréquent (quelques secondes, toutes les minutes) ;
 *  - le **backfill** est long et rare (la première synchro d'une boîte, ou
 *    l'ajout d'un compte), s'interrompt et reprend.
 *
 * Chacune a donc son propre état.
 */
export interface CacheTaskState {
  running: boolean;
  phase: TaskPhase;
  /** Libellé court de l'action en cours (« Réception — Fred Pro »). */
  label: string;
  /** Progression de 0 à 100. */
  progress: number;
  processed: number;
  total: number;
  error: string | null;
}

const idleTask = (): CacheTaskState => ({
  running: false,
  phase: 'idle',
  label: '',
  progress: 0,
  processed: 0,
  total: 0,
  error: null,
});

export type CacheTaskName = 'delta' | 'backfill';

interface CacheState {
  delta: CacheTaskState;
  backfill: CacheTaskState;
  /** Backfill suspendu par l'utilisateur — respecté entre deux lots. */
  backfillPaused: boolean;
  lastSyncAt: string | null;
  stats: CacheStats | null;

  patchTask: (task: CacheTaskName, patch: Partial<CacheTaskState>) => void;
  resetTask: (task: CacheTaskName) => void;
  setBackfillPaused: (paused: boolean) => void;
  setStats: (stats: CacheStats | null) => void;
  reset: () => void;
}

export const useCacheStore = create<CacheState>((set) => ({
  delta: idleTask(),
  backfill: idleTask(),
  backfillPaused: false,
  lastSyncAt: null,
  stats: null,

  patchTask: (task, patch) =>
    set((state) => ({ [task]: { ...state[task], ...patch } }) as Partial<CacheState>),

  resetTask: (task) => set({ [task]: idleTask() } as Partial<CacheState>),

  setBackfillPaused: (paused) => set({ backfillPaused: paused }),

  setStats: (stats) => set({ stats, lastSyncAt: stats?.lastSync ?? null }),

  reset: () =>
    set({
      delta: idleTask(),
      backfill: idleTask(),
      backfillPaused: false,
    }),
}));

/** Vrai si l'une ou l'autre des tâches travaille — pour l'indicateur global. */
export function isCacheBusy(state: Pick<CacheState, 'delta' | 'backfill'>): boolean {
  return state.delta.running || state.backfill.running;
}
