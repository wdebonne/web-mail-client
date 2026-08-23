import { create } from 'zustand';

/** Cible d'insertion publiée par la fenêtre de composition quand elle est ouverte. */
export interface NotesInsertTarget {
  insertHtml: (html: string) => void;
  attachFiles: (files: File[]) => void;
}

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

  // Grande modale « Notes & fichiers ». Elle est montée une seule fois, dans
  // Layout, pour être accessible depuis n'importe quelle page — d'où l'état
  // global plutôt qu'un état local de page.
  notesModalOpen: boolean;
  openNotesModal: () => void;
  closeNotesModal: () => void;
  /**
   * Publié par MailPage tant qu'une composition est ouverte. La modale s'en
   * sert pour proposer « Insérer dans le message » au lieu de « Nouveau
   * message » ; null en dehors d'une composition.
   */
  notesInsertTarget: NotesInsertTarget | null;
  setNotesInsertTarget: (target: NotesInsertTarget | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  mobileSidebarSignal: 0,
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarSignal: s.mobileSidebarSignal + 1 })),
  mobilePageTitle: '',
  setMobilePageTitle: (title) => set({ mobilePageTitle: title }),
  mobileReadingView: false,
  setMobileReadingView: (v) => set({ mobileReadingView: v }),

  notesModalOpen: false,
  openNotesModal: () => set({ notesModalOpen: true }),
  closeNotesModal: () => set({ notesModalOpen: false }),
  notesInsertTarget: null,
  setNotesInsertTarget: (target) => set({ notesInsertTarget: target }),
}));
