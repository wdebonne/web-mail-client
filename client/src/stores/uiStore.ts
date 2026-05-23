import { create } from 'zustand';

interface UIState {
  // Monotonic counter incremented each time the mobile/tablet hamburger button is
  // pressed. Pages (mail, calendar, …) subscribe to this value to toggle their
  // own contextual sidebar (folder list, calendar list, …).
  mobileSidebarSignal: number;
  toggleMobileSidebar: () => void;
  // Title shown in the mobile top bar (set by the active page).
  mobilePageTitle: string;
  setMobilePageTitle: (title: string) => void;
  // True when a mail is open full-screen on mobile — hides the top header and
  // bottom nav to maximise reading area.
  mobileReadingView: boolean;
  setMobileReadingView: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  mobileSidebarSignal: 0,
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarSignal: s.mobileSidebarSignal + 1 })),
  mobilePageTitle: '',
  setMobilePageTitle: (title) => set({ mobilePageTitle: title }),
  mobileReadingView: false,
  setMobileReadingView: (v) => set({ mobileReadingView: v }),
}));
