import { create } from 'zustand';
import { MailAccount, MailFolder, Email, EmailAddress } from '../types';

export interface OpenTab {
  id: string;
  type: 'message' | 'compose';
  message?: Email;
  composeData?: ComposeData;
  label: string;
}

export type TabMode = 'drafts-only' | 'all-opened';

export type VirtualFolder = 'unified-inbox' | 'unified-sent' | null;

interface MailState {
  accounts: MailAccount[];
  selectedAccount: MailAccount | null;
  folders: MailFolder[];
  selectedFolder: string;
  /** When set, the message list shows a virtual/unified view instead of a single folder. */
  virtualFolder: VirtualFolder;
  /** When set, messages are further filtered to those bearing the given category id
   *  (works in combination with the unified inbox aggregation). */
  categoryFilter: string | null;
  messages: Email[];
  selectedMessage: Email | null;
  isComposing: boolean;
  composeData: ComposeData | null;
  totalMessages: number;
  currentPage: number;

  // Tabs
  openTabs: OpenTab[];
  activeTabId: string | null;
  tabMode: TabMode;
  maxTabs: number;

  setAccounts: (accounts: MailAccount[]) => void;
  selectAccount: (account: MailAccount) => void;
  setFolders: (folders: MailFolder[]) => void;
  selectFolder: (folder: string) => void;
  selectVirtualFolder: (v: VirtualFolder) => void;
  setCategoryFilter: (id: string | null) => void;
  setMessages: (messages: Email[], total: number, page: number) => void;
  selectMessage: (message: Email | null) => void;
  openCompose: (data?: Partial<ComposeData>) => void;
  closeCompose: () => void;
  updateMessageFlags: (uid: number, flags: Partial<Email['flags']>) => void;
  removeMessage: (uid: number) => void;

  // Tab actions
  openMessageTab: (message: Email) => void;
  openComposeTab: (data?: Partial<ComposeData>) => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  updateComposeTab: (tabId: string, data: Partial<ComposeData>) => void;
  setTabMode: (mode: TabMode) => void;
  setMaxTabs: (max: number) => void;
}

export interface ComposeData {
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string;
  references?: string;
  accountId?: string;
}

export const useMailStore = create<MailState>((set, get) => ({
  accounts: [],
  selectedAccount: null,
  folders: [],
  selectedFolder: 'INBOX',
  virtualFolder: null,
  categoryFilter: null,
  messages: [],
  selectedMessage: null,
  isComposing: false,
  composeData: null,
  totalMessages: 0,
  currentPage: 1,
  openTabs: [],
  activeTabId: null,
  tabMode: (localStorage.getItem('tabMode') as TabMode) || 'drafts-only',
  maxTabs: parseInt(localStorage.getItem('maxTabs') || '6', 10),

  setAccounts: (accounts) => {
    set({ accounts });
    if (!get().selectedAccount && accounts.length > 0) {
      const defaultAccount = accounts.find(a => a.is_default) || accounts[0];
      set({ selectedAccount: defaultAccount });
    }
  },

  selectAccount: (account) => {
    set({ selectedAccount: account, selectedFolder: 'INBOX', virtualFolder: null, categoryFilter: null, messages: [], selectedMessage: null, currentPage: 1 });
  },

  setFolders: (folders) => set({ folders }),

  selectFolder: (folder) => {
    set({ selectedFolder: folder, virtualFolder: null, categoryFilter: null, messages: [], selectedMessage: null, currentPage: 1 });
  },

  selectVirtualFolder: (v) => {
    set({ virtualFolder: v, categoryFilter: null, messages: [], selectedMessage: null, currentPage: 1 });
  },

  setCategoryFilter: (id) => {
    // Clearing → return to whatever folder is currently selected.
    // Setting → switch into the unified inbox so we aggregate across mailboxes,
    // then filter by category id at render time.
    if (id) {
      const { virtualFolder } = get();
      if (virtualFolder === 'unified-inbox') {
        // Already in the unified view: just swap the filter, keep the cached messages
        // so the list stays populated (the React Query key is unchanged and would not refetch).
        set({ categoryFilter: id, selectedMessage: null });
      } else {
        set({ categoryFilter: id, virtualFolder: 'unified-inbox', messages: [], selectedMessage: null, currentPage: 1 });
      }
    } else {
      set({ categoryFilter: null });
    }
  },

  setMessages: (messages, total, page) => set({ messages, totalMessages: total, currentPage: page }),

  selectMessage: (message) => set({ selectedMessage: message }),

  openCompose: (data) => {
    const account = get().selectedAccount;
    const composeData: ComposeData = {
      to: data?.to || [],
      cc: data?.cc || [],
      bcc: data?.bcc || [],
      subject: data?.subject || '',
      bodyHtml: data?.bodyHtml || '',
      inReplyTo: data?.inReplyTo,
      references: data?.references,
      accountId: data?.accountId || account?.id,
    };
    set({ isComposing: true, composeData });
    // Also open as tab
    get().openComposeTab(composeData);
  },

  closeCompose: () => {
    const { activeTabId, openTabs } = get();
    const activeTab = openTabs.find(t => t.id === activeTabId);
    if (activeTab?.type === 'compose') {
      get().closeTab(activeTab.id);
    }
    set({ isComposing: false, composeData: null });
  },

  updateMessageFlags: (uid, flags) => {
    set((state) => ({
      messages: state.messages.map(m =>
        m.uid === uid ? { ...m, flags: { ...m.flags, ...flags } } : m
      ),
      selectedMessage: state.selectedMessage?.uid === uid
        ? { ...state.selectedMessage, flags: { ...state.selectedMessage.flags, ...flags } }
        : state.selectedMessage,
      openTabs: state.openTabs.map(tab =>
        tab.type === 'message' && tab.message?.uid === uid
          ? { ...tab, message: { ...tab.message!, flags: { ...tab.message!.flags, ...flags } } }
          : tab
      ),
    }));
  },

  removeMessage: (uid) => {
    set((state) => ({
      messages: state.messages.filter(m => m.uid !== uid),
      selectedMessage: state.selectedMessage?.uid === uid ? null : state.selectedMessage,
    }));
  },

  // --- Tab management ---
  openMessageTab: (message) => {
    const { openTabs, tabMode, maxTabs } = get();
    const tabId = `msg-${message.uid}`;
    const existing = openTabs.find(t => t.id === tabId);

    if (existing) {
      // Already open — switch to it and update message data
      set({
        activeTabId: tabId,
        selectedMessage: message,
        isComposing: false,
        openTabs: openTabs.map(t => t.id === tabId ? { ...t, message } : t),
      });
      return;
    }

    // In drafts-only mode, don't create message tabs — just select the message
    if (tabMode === 'drafts-only') {
      set({
        selectedMessage: message,
        isComposing: false,
      });
      return;
    }

    // all-opened mode: enforce maxTabs limit (count only message tabs)
    let updatedTabs = [...openTabs];
    const messageTabs = updatedTabs.filter(t => t.type === 'message');
    if (messageTabs.length >= maxTabs) {
      // Remove the oldest message tab that isn't active
      const oldestInactive = messageTabs.find(t => t.id !== get().activeTabId);
      if (oldestInactive) {
        updatedTabs = updatedTabs.filter(t => t.id !== oldestInactive.id);
      } else {
        // All are active? Remove the oldest anyway
        updatedTabs = updatedTabs.filter(t => t.id !== messageTabs[0].id);
      }
    }

    set({
      openTabs: [...updatedTabs, {
        id: tabId,
        type: 'message',
        message,
        label: message.subject || '(Sans objet)',
      }],
      activeTabId: tabId,
      selectedMessage: message,
      isComposing: false,
    });
  },

  openComposeTab: (data) => {
    const { openTabs } = get();
    const account = get().selectedAccount;
    const composeData: ComposeData = {
      to: data?.to || [],
      cc: data?.cc || [],
      bcc: data?.bcc || [],
      subject: data?.subject || '',
      bodyHtml: data?.bodyHtml || '',
      inReplyTo: data?.inReplyTo,
      references: data?.references,
      accountId: data?.accountId || account?.id,
    };
    const tabId = `compose-${Date.now()}`;
    set({
      openTabs: [...openTabs, {
        id: tabId,
        type: 'compose',
        composeData,
        label: composeData.subject || '(Aucun objet)',
      }],
      activeTabId: tabId,
      isComposing: true,
      composeData,
    });
  },

  switchTab: (tabId) => {
    const { openTabs } = get();
    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.type === 'message') {
      set({
        activeTabId: tabId,
        selectedMessage: tab.message || null,
        isComposing: false,
        composeData: null,
      });
    } else {
      set({
        activeTabId: tabId,
        isComposing: true,
        composeData: tab.composeData || null,
      });
    }
  },

  closeTab: (tabId) => {
    const { openTabs, activeTabId } = get();
    const remaining = openTabs.filter(t => t.id !== tabId);
    const wasActive = activeTabId === tabId;

    if (wasActive) {
      if (remaining.length > 0) {
        // Switch to the last remaining tab
        const lastTab = remaining[remaining.length - 1];
        if (lastTab.type === 'message') {
          set({
            openTabs: remaining,
            activeTabId: lastTab.id,
            selectedMessage: lastTab.message || null,
            isComposing: false,
            composeData: null,
          });
        } else {
          set({
            openTabs: remaining,
            activeTabId: lastTab.id,
            isComposing: true,
            composeData: lastTab.composeData || null,
          });
        }
      } else {
        set({
          openTabs: [],
          activeTabId: null,
          selectedMessage: null,
          isComposing: false,
          composeData: null,
        });
      }
    } else {
      set({ openTabs: remaining });
    }
  },

  updateComposeTab: (tabId, data) => {
    set((state) => ({
      openTabs: state.openTabs.map(tab =>
        tab.id === tabId && tab.type === 'compose'
          ? {
              ...tab,
              composeData: { ...tab.composeData!, ...data },
              label: data.subject || tab.composeData?.subject || '(Aucun objet)',
            }
          : tab
      ),
      composeData: state.activeTabId === tabId
        ? { ...state.composeData!, ...data }
        : state.composeData,
    }));
  },

  setTabMode: (mode) => {
    localStorage.setItem('tabMode', mode);
    // When switching to drafts-only, remove all message tabs
    if (mode === 'drafts-only') {
      const { openTabs, activeTabId } = get();
      const remaining = openTabs.filter(t => t.type !== 'message');
      const wasActiveRemoved = !remaining.find(t => t.id === activeTabId);
      if (wasActiveRemoved) {
        const lastTab = remaining[remaining.length - 1];
        set({
          tabMode: mode,
          openTabs: remaining,
          activeTabId: lastTab?.id || null,
          isComposing: lastTab?.type === 'compose',
          composeData: lastTab?.composeData || null,
        });
      } else {
        set({ tabMode: mode, openTabs: remaining });
      }
    } else {
      set({ tabMode: mode });
    }
  },

  setMaxTabs: (max) => {
    localStorage.setItem('maxTabs', String(max));
    set({ maxTabs: max });
  },
}));
