import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeState {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  init: () => void;
}

const STORAGE_KEY = 'theme.mode';

function readInitialMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function apply(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.style.colorScheme = resolved;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readInitialMode(),
  resolved: resolve(readInitialMode()),

  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
    const resolved = resolve(mode);
    apply(resolved);
    set({ mode, resolved });
  },

  toggle: () => {
    const { resolved } = get();
    const next: ThemeMode = resolved === 'dark' ? 'light' : 'dark';
    get().setMode(next);
  },

  init: () => {
    const { mode } = get();
    const resolved = resolve(mode);
    apply(resolved);
    set({ resolved });

    // Listen for system preference changes when in 'system' mode
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        if (get().mode === 'system') {
          const r = systemPrefersDark() ? 'dark' : 'light';
          apply(r);
          set({ resolved: r });
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', handler);
      else mq.addListener(handler);
    } catch {}
  },
}));
