import { create } from 'zustand';
import { MailAccount, MailFolder, Email, EmailAddress } from '../types';

export interface OpenTab {
  id: string;
  type: 'message' | 'compose';
  message?: Email;
  composeData?: ComposeData;
  label: string;
}

interface MailState {
  accounts: MailAccount[];
  selectedAccount: MailAccount | null;
  folders: MailFolder[];
  selectedFolder: string;
  messages: Email[];
  selectedMessage: Email | null;
  isComposing: boolean;
  composeData: ComposeData | null;
  totalMessages: number;
  currentPage: number;

  // Tabs
  openTabs: OpenTab[];
  activeTabId: string | null;

  setAccounts: (accounts: MailAccount[]) => void;
  selectAccount: (account: MailAccount) => void;
  setFolders: (folders: MailFolder[]) => void;
  selectFolder: (folder: string) => void;
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
  messages: [],
  selectedMessage: null,
  isComposing: false,
  composeData: null,
  totalMessages: 0,
  currentPage: 1,
  openTabs: [],
  activeTabId: null,

  setAccounts: (accounts) => {
    set({ accounts });
    if (!get().selectedAccount && accounts.length > 0) {
      const defaultAccount = accounts.find(a => a.is_default) || accounts[0];
      set({ selectedAccount: defaultAccount });
    }
  },

  selectAccount: (account) => {
    set({ selectedAccount: account, selectedFolder: 'INBOX', messages: [], selectedMessage: null, currentPage: 1 });
  },

  setFolders: (folders) => set({ folders }),

  selectFolder: (folder) => {
    set({ selectedFolder: folder, messages: [], selectedMessage: null, currentPage: 1 });
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
    const { openTabs } = get();
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
    } else {
      set({
        openTabs: [...openTabs, {
          id: tabId,
          type: 'message',
          message,
          label: message.subject || '(Sans objet)',
        }],
        activeTabId: tabId,
        selectedMessage: message,
        isComposing: false,
      });
    }
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
}));
