import { create } from 'zustand';
import { MailAccount, MailFolder, Email } from '../types';

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
}

export interface ComposeData {
  to: { email: string; name?: string }[];
  cc: { email: string; name?: string }[];
  bcc: { email: string; name?: string }[];
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
    set({
      isComposing: true,
      composeData: {
        to: data?.to || [],
        cc: data?.cc || [],
        bcc: data?.bcc || [],
        subject: data?.subject || '',
        bodyHtml: data?.bodyHtml || '',
        inReplyTo: data?.inReplyTo,
        references: data?.references,
        accountId: data?.accountId || account?.id,
      },
    });
  },

  closeCompose: () => set({ isComposing: false, composeData: null }),

  updateMessageFlags: (uid, flags) => {
    set((state) => ({
      messages: state.messages.map(m =>
        m.uid === uid ? { ...m, flags: { ...m.flags, ...flags } } : m
      ),
      selectedMessage: state.selectedMessage?.uid === uid
        ? { ...state.selectedMessage, flags: { ...state.selectedMessage.flags, ...flags } }
        : state.selectedMessage,
    }));
  },

  removeMessage: (uid) => {
    set((state) => ({
      messages: state.messages.filter(m => m.uid !== uid),
      selectedMessage: state.selectedMessage?.uid === uid ? null : state.selectedMessage,
    }));
  },
}));
