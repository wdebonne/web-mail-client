import { create } from 'zustand';

interface UIState {
  // Monotonic counter incremented each time the mobile/tablet hamburger button is
  // pressed. Pages (mail, calendar, …) subscribe to this value to toggle their
  // own contextual sidebar (folder list, calendar list, …).
  mobileSidebarSignal: number;
  toggleMobileSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  mobileSidebarSignal: 0,
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarSignal: s.mobileSidebarSignal + 1 })),
}));
