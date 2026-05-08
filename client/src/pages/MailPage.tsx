import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../api';
import { useMailStore, ComposeData } from '../stores/mailStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useWebSocket } from '../hooks/useWebSocket';
import { useUIStore } from '../stores/uiStore';
import { offlineDB } from '../pwa/offlineDB';
import FolderPane from '../components/mail/FolderPane';
import MessageList from '../components/mail/MessageList';
import MessageView from '../components/mail/MessageView';
import ComposeModal from '../components/mail/ComposeModal';
import type { ComposeApi } from '../components/mail/ComposeModal';
import Ribbon from '../components/mail/Ribbon';
import AutoResponderModal from '../components/mail/AutoResponderModal';
import RulesModal from '../components/mail/RulesModal';
import EmojiPanel from '../components/mail/EmojiPanel';
import GifPanel from '../components/mail/GifPanel';
import { MailTemplatePickerModal, MailTemplatesManagerModal } from '../components/mail/MailTemplates';
import ContextMenu, { ContextMenuItem } from '../components/ui/ContextMenu';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import FloatingActionButton from '../components/ui/FloatingActionButton';
import toast from 'react-hot-toast';
import { ArrowLeft, PanelLeftOpen, PanelLeftClose, Mail, X, Pencil, Columns2, Plus } from 'lucide-react';
import { getAccountDisplayName } from '../utils/mailPreferences';
import {
  getUnifiedAccountIds, getUnifiedInboxEnabled, getUnifiedSentEnabled,
  findInboxFolderPath, findSentFolderPath,
  findTrashFolderPath, isTrashFolderPath,
  getDeleteConfirmEnabled,
  getSwipePrefs, getSwipeMoveTarget, getSwipeCopyTarget, setSwipeMoveTarget, setSwipeCopyTarget,
  getAutoLoadAllEnabled,
  getMailDisplayMode, setMailDisplayMode, MAIL_DISPLAY_MODE_CHANGED_EVENT,
  type SwipeAction, type MailDisplayMode,
} from '../utils/mailPreferences';
import {
  toggleMessageCategory, clearMessageCategories, getMessageCategories,
  subscribeCategories,
} from '../utils/categories';
import { applyCategoryRules } from '../utils/mailRulesEval';
import { useAuthStore } from '../stores/authStore';
import { CategoryEditorModal, CategoryManageModal, CategoryPicker } from '../components/mail/CategoryModals';
import { resolveFolderDisplayName } from '../components/mail/MessageList';
import FolderPickerDialog from '../components/mail/FolderPickerDialog';
import type { MailFolder } from '../types';

type AttachmentActionMode = 'preview' | 'download' | 'menu';

export default function MailPage() {
  const isOnline = useNetworkStatus();
  const queryClient = useQueryClient();
  const {
    accounts, selectedAccount, selectedFolder, folders, messages, selectedMessage,
    isComposing, composeData,
    setAccounts, selectAccount, setFolders, selectFolder,
    setMessages, appendMessages, selectMessage, openCompose, closeCompose,
    updateMessageFlags, removeMessage,
    openTabs, activeTabId, openMessageTab, switchTab, closeTab,
    tabMode, maxTabs, setTabMode, setMaxTabs,
    virtualFolder, selectVirtualFolder,
    categoryFilter, setCategoryFilter,
    totalMessages, currentPage,
  } = useMailStore();

  // Bump to re-render when preferences change (favorites etc.)
  const [prefsVersion, setPrefsVersion] = useState(0);
  const bumpPrefs = useCallback(() => setPrefsVersion((n) => n + 1), []);

  // Mail rules — used to apply the client-side `assignCategory` action when
  // a freshly fetched message matches one of the user's enabled rules.
  const authUser = useAuthStore((s) => s.user);
  const { data: rulesForCategorization = [] } = useQuery({
    queryKey: ['mail-rules'],
    queryFn: () => api.listMailRules(),
    staleTime: 60_000,
  });

  /** Resolve the origin (accountId, folder) for a message — uses message tags
   *  when present (virtual/unified view), falls back to the current selection. */
  const originOf = useCallback((msg: any | null | undefined): { accountId?: string; folder: string } => {
    if (msg?._accountId) return { accountId: msg._accountId, folder: msg._folder || selectedFolder };
    return { accountId: selectedAccount?.id, folder: selectedFolder };
  }, [selectedAccount, selectedFolder]);

  const originByUid = useCallback((uid: number): { accountId?: string; folder: string } => {
    const m = messages.find((x) => x.uid === uid);
    return originOf(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, selectedAccount, selectedFolder]);

  /** Resolve the origin from a row callback. When the MessageList forwards
   *  the message's `_accountId`/`_folder` (unified view) we trust those tags;
   *  otherwise we fall back to scanning `messages` by uid. This avoids the
   *  bug where two messages from different accounts share the same IMAP UID
   *  and `find()` would otherwise return the wrong row. */
  const resolveOrigin = useCallback((
    uid: number, accountId?: string, folder?: string,
  ): { accountId?: string; folder: string } => {
    if (accountId || folder) {
      return {
        accountId: accountId || selectedAccount?.id,
        folder: folder || selectedFolder,
      };
    }
    return originByUid(uid);
  }, [originByUid, selectedAccount, selectedFolder]);

  // Load accounts
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: api.getAccounts,
    staleTime: 1000 * 60 * 10,
  });

  const { data: userSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 1000 * 60 * 5,
  });

  const attachmentMinVisibleKb = Number.isFinite(Number(userSettings?.attachment_visibility_min_kb))
    ? Math.max(0, Number(userSettings?.attachment_visibility_min_kb))
    : 10;

  const attachmentActionMode: AttachmentActionMode = ['preview', 'download', 'menu'].includes(userSettings?.attachment_action_mode)
    ? userSettings.attachment_action_mode
    : 'preview';

  const attachmentModeMutation = useMutation({
    mutationFn: (mode: AttachmentActionMode) => api.updateSettings({ attachmentActionMode: mode }),
    onSuccess: (_result, mode) => {
      queryClient.setQueryData(['settings'], (prev: any) => ({
        ...(prev || {}),
        attachment_action_mode: mode,
      }));
      toast.success('Préférence pièces jointes mise à jour');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Impossible d\'enregistrer la préférence');
    },
  });

  useEffect(() => {
    if (accountsData) {
      setAccounts(accountsData);
    }
  }, [accountsData]);

  // Dynamic browser tab title: "<folder> — <app name>" (Outlook-like).
  // Falls back to just the app name when no folder is selected.
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: api.getBranding,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    const appName = branding?.app_name || 'WebMail';
    let folderLabel = '';
    if (virtualFolder === 'unified-inbox') folderLabel = 'Boîte de réception (unifiée)';
    else if (virtualFolder === 'unified-sent') folderLabel = 'Éléments envoyés (unifiés)';
    else if (selectedFolder) folderLabel = resolveFolderDisplayName(selectedFolder);

    document.title = folderLabel ? `${folderLabel} — ${appName}` : appName;
  }, [branding?.app_name, selectedFolder, virtualFolder]);

  // Load folders
  const { data: foldersData } = useQuery({
    queryKey: ['folders', selectedAccount?.id],
    queryFn: () => selectedAccount ? api.getFolders(selectedAccount.id) : Promise.resolve([]),
    enabled: !!selectedAccount,
  });

  useEffect(() => {
    if (foldersData) {
      setFolders(foldersData);
    }
  }, [foldersData]);

  // Load messages (single-folder OR aggregated unified view)
  const [loadAllActive, setLoadAllActive] = useState(() => getAutoLoadAllEnabled());

  // Track the global "auto-load all messages" preference. When the user
  // enables it from Settings, every newly-opened folder automatically pages
  // through every remaining message so client-side search covers the whole
  // mailbox. When disabled, only the current folder's manual toggle remains.
  const [autoLoadAll, setAutoLoadAll] = useState(() => getAutoLoadAllEnabled());
  useEffect(() => {
    const onChange = (e: any) => {
      const enabled = !!e?.detail?.enabled;
      setAutoLoadAll(enabled);
      if (enabled) setLoadAllActive(true);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'mail.autoLoadAll') {
        const enabled = getAutoLoadAllEnabled();
        setAutoLoadAll(enabled);
        if (enabled) setLoadAllActive(true);
      }
    };
    window.addEventListener('mail-auto-load-all-changed', onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('mail-auto-load-all-changed', onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: virtualFolder
      ? ['virtual-messages', virtualFolder, prefsVersion, accounts.map((a) => a.id).join(',')]
      : ['messages', selectedAccount?.id, selectedFolder],
    queryFn: async () => {
      if (virtualFolder) {
        // Aggregate the FIRST page for each included account so the user sees
        // results within seconds. Additional pages are fetched progressively
        // by a separate effect (see below) when "Tout charger" is active.
        const unifiedIds = getUnifiedAccountIds();
        const included = accounts.filter((a) =>
          !unifiedIds.length ? true : unifiedIds.includes(a.id),
        );
        if (!included.length) return { messages: [], total: 0, page: 1 };

        const results = await Promise.all(
          included.map(async (acct) => {
            try {
              const accFolders: MailFolder[] =
                queryClient.getQueryData<MailFolder[]>(['folders', acct.id]) ||
                ((await api.getFolders(acct.id).then((f) => {
                  queryClient.setQueryData(['folders', acct.id], f);
                  return f;
                })) as MailFolder[]);
              const target =
                virtualFolder === 'unified-inbox'
                  ? findInboxFolderPath(accFolders)
                  : findSentFolderPath(accFolders);
              if (!target) return [] as any[];
              const res = await api.getMessages(acct.id, target, 1);
              return (res.messages || []).map((m: any) => ({
                ...m, _accountId: acct.id, _folder: target,
                _virtualTotal: res.total ?? 0,
              }));
            } catch {
              return [] as any[];
            }
          }),
        );
        const merged = ([] as any[]).concat(...results);
        merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return { messages: merged, total: merged.length, page: 1 };
      }

      if (!selectedAccount) return { messages: [], total: 0, page: 1 };
      // Try the network first; if it fails (offline / server hiccup), fall back
      // to IndexedDB so the UI keeps working with whatever has been cached.
      try {
        const result = await api.getMessages(selectedAccount.id, selectedFolder);
        if (result.messages) {
          // Fire-and-forget: writing to IndexedDB must never block the UI.
          // The list is rendered as soon as the network response arrives;
          // the cache update happens in the background.
          void offlineDB.cacheEmails(result.messages.map((m: any) => ({
            ...m,
            // Composite id: account + folder + uid avoids cross-folder collisions
            // (the same UID can exist in multiple folders).
            id: `${selectedAccount.id}-${selectedFolder}-${m.uid}`,
            accountId: selectedAccount.id,
            folder: selectedFolder,
          }))).catch(() => { /* cache failure is non-fatal */ });
        }
        return result;
      } catch {
        const cached = await offlineDB.getEmails(selectedAccount.id, selectedFolder);
        return { messages: cached, total: cached.length, page: 1 };
      }
    },
    enabled: virtualFolder ? accounts.length > 0 : !!selectedAccount,
    refetchInterval: isOnline ? 30000 : false,
    // Keep the previous folder's messages visible during refetch so navigation
    // feels instantaneous instead of flashing an empty list.
    placeholderData: keepPreviousData,
    // Within 2 minutes, navigating back to a folder reuses the cached React-Query
    // result and skips the network round-trip entirely.
    staleTime: 1000 * 60 * 2,
  });

  useEffect(() => {
    if (messagesData) {
      setMessages(messagesData.messages || [], messagesData.total || 0, messagesData.page || 1);
    }
  }, [messagesData]);

  // Real-time refresh: when the server emits WebSocket events, update the
  // local caches *surgically* instead of invalidating the queries — a full
  // refetch of `['messages']` would reset pagination to page 1, which is
  // disastrous when "Tout charger" is active (it relaunches the page 2..N
  // loop and floods the network with hundreds of `messages?page=N` requests).
  // Pattern:
  //   - `mail-moved` / `mail-deleted` → drop the UID from the source folder
  //     cache (and the virtual caches), then a lightweight folder-counts
  //     refresh (no re-pagination).
  //   - `new-mail` / `mail-archived` → light invalidation limited to the
  //     active query, only when no auto-load loop is currently running.
  useWebSocket({
    'new-mail': (data) => {
      console.debug('[ws] new-mail', data);
      // Folder counts always benefit from a refresh (cheap).
      queryClient.invalidateQueries({ queryKey: ['folders'], refetchType: 'active' });
      // For the active list: only schedule a non-disruptive refetch if no
      // auto-load loop is in progress.
      if (!loadAllActive && !loadingMore) {
        queryClient.invalidateQueries({ queryKey: ['messages'], refetchType: 'active' });
        queryClient.invalidateQueries({ queryKey: ['virtual-messages'], refetchType: 'active' });
      }
    },
    'mail-moved': (data) => {
      console.debug('[ws] mail-moved', data);
      const accountId: string | undefined = data?.accountId;
      const srcFolder: string | undefined = data?.srcFolder;
      const uid: number | undefined = data?.uid;
      // 1) Drop the UID from the source folder's cached message list — this
      //    is what makes the row disappear from the INBOX instantly.
      if (accountId && srcFolder && typeof uid === 'number') {
        queryClient.setQueryData<any>(['messages', accountId, srcFolder], (old: any) => {
          if (!old || !Array.isArray(old.messages)) return old;
          const filtered = old.messages.filter((m: any) => m?.uid !== uid);
          if (filtered.length === old.messages.length) return old;
          return { ...old, messages: filtered, total: Math.max(0, (old.total ?? filtered.length) - 1) };
        });
        // 2) Same surgical removal in the unified/virtual views.
        removeMessageFromVirtualCaches(uid, accountId, srcFolder);
        // 3) If this is the folder currently displayed, sync the Zustand
        //    store too (the visible list is read from there).
        if (selectedAccount?.id === accountId && selectedFolder === srcFolder) {
          removeMessage(uid, accountId, srcFolder);
        }
      }
      // 4) Folder counts (unread, total) need a refresh.
      queryClient.invalidateQueries({ queryKey: ['folders'], refetchType: 'active' });
    },
    'mail-deleted': (data) => {
      console.debug('[ws] mail-deleted', data);
      const accountId: string | undefined = data?.accountId;
      const folder: string | undefined = data?.folder || data?.srcFolder;
      const uid: number | undefined = data?.uid;
      if (accountId && folder && typeof uid === 'number') {
        queryClient.setQueryData<any>(['messages', accountId, folder], (old: any) => {
          if (!old || !Array.isArray(old.messages)) return old;
          const filtered = old.messages.filter((m: any) => m?.uid !== uid);
          if (filtered.length === old.messages.length) return old;
          return { ...old, messages: filtered, total: Math.max(0, (old.total ?? filtered.length) - 1) };
        });
        removeMessageFromVirtualCaches(uid, accountId, folder);
        if (selectedAccount?.id === accountId && selectedFolder === folder) {
          removeMessage(uid, accountId, folder);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['folders'], refetchType: 'active' });
    },
    'mail-read': () => {
      // Read-state changes do not move/remove messages; only the unread
      // count needs a refresh. The list itself is updated locally by the
      // existing `updateMessageFlags` calls in the read mutation.
      queryClient.invalidateQueries({ queryKey: ['folders'], refetchType: 'active' });
    },
    'mail-archived': (data) => {
      console.debug('[ws] mail-archived', data);
      const accountId: string | undefined = data?.accountId;
      const folder: string | undefined = data?.srcFolder || data?.folder;
      const uid: number | undefined = data?.uid;
      if (accountId && folder && typeof uid === 'number') {
        queryClient.setQueryData<any>(['messages', accountId, folder], (old: any) => {
          if (!old || !Array.isArray(old.messages)) return old;
          const filtered = old.messages.filter((m: any) => m?.uid !== uid);
          if (filtered.length === old.messages.length) return old;
          return { ...old, messages: filtered, total: Math.max(0, (old.total ?? filtered.length) - 1) };
        });
        removeMessageFromVirtualCaches(uid, accountId, folder);
        if (selectedAccount?.id === accountId && selectedFolder === folder) {
          removeMessage(uid, accountId, folder);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['folders'], refetchType: 'active' });
    },
  });

  // Apply user's mail rules with `assignCategory` actions to the freshly
  // fetched messages. Categories live in localStorage (client-side only) so
  // this re-evaluation has to happen here rather than on the server.
  useEffect(() => {
    const list = messagesData?.messages || [];
    if (!list.length || !rulesForCategorization.length || !selectedAccount) return;
    const n = applyCategoryRules(list as any, rulesForCategorization, {
      accountId: selectedAccount.id,
      folder: selectedFolder,
      accountEmail: selectedAccount.email || '',
      userEmail: authUser?.email || '',
      userDisplayName: (authUser as any)?.display_name || (authUser as any)?.displayName || '',
    });
    if (n > 0) bumpPrefs();
  }, [messagesData, rulesForCategorization, selectedAccount, selectedFolder, authUser, bumpPrefs]);

  // Hydrate the message list from IndexedDB the instant the user switches to a
  // folder, without waiting for the network round-trip. The React-Query refetch
  // will overwrite the list once the server replies; until then the user sees
  // the cached messages immediately. This is what gives the app its "instant"
  // feel after a reload or when navigating between folders.
  useEffect(() => {
    if (virtualFolder || !selectedAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await offlineDB.getEmails(selectedAccount.id, selectedFolder);
        if (cancelled) return;
        // Only inject the cache if React-Query hasn't already produced data for
        // this folder (otherwise we'd clobber the freshly fetched list).
        const existing = queryClient.getQueryData<any>(['messages', selectedAccount.id, selectedFolder]);
        if (existing && Array.isArray(existing.messages) && existing.messages.length) return;
        if (cached.length) {
          setMessages(cached as any, cached.length, 1);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAccount?.id, selectedFolder, virtualFolder]);

  // Pagination — "Charger plus de messages" appends the next page from the server
  // (the IMAP listing returns 50 messages per page, newest first).
  const [loadingMore, setLoadingMore] = useState(false);
  const hasMoreMessages = !virtualFolder && messages.length < totalMessages;
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMoreMessages || !selectedAccount) return;
    setLoadingMore(true);
    try {
      const nextPage = (currentPage || 1) + 1;
      const res = await api.getMessages(selectedAccount.id, selectedFolder, nextPage);
      const fetched = res.messages || [];
      if (fetched.length > 0) {
        // Non-blocking cache write — do not delay appending messages to the UI.
        void offlineDB.cacheEmails(fetched.map((m: any) => ({
          ...m,
          id: `${selectedAccount.id}-${selectedFolder}-${m.uid}`,
          accountId: selectedAccount.id,
          folder: selectedFolder,
        }))).catch(() => { /* cache failure is non-fatal */ });
      }
      appendMessages(fetched, res.total ?? totalMessages, nextPage);
    } catch (err) {
      console.error('Load more messages error:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreMessages, selectedAccount, selectedFolder, currentPage, totalMessages, appendMessages]);

  // "Tout charger" — auto-fetch every remaining page so the user can search across
  // the full mailbox/folder. Works for both single-folder and unified views; the
  // unified case is handled inside the React Query queryFn (see above).
  const handleToggleLoadAll = useCallback(() => {
    setLoadAllActive((v) => !v);
  }, []);
  // Reset the auto-load flag when the user navigates to a different folder/account/view
  // so we don't accidentally trigger a heavy fetch in the new context — unless the
  // global "auto-load all messages" preference is enabled, in which case every folder
  // should keep paging until the end.
  useEffect(() => {
    setLoadAllActive(autoLoadAll);
  }, [selectedAccount?.id, selectedFolder, virtualFolder, autoLoadAll]);
  // Drive the single-folder auto-load loop: while active, kick off the next page
  // as soon as the previous one resolves.
  useEffect(() => {
    if (!loadAllActive || virtualFolder) return;
    if (loadingMessages || loadingMore) return;
    if (!hasMoreMessages) {
      setLoadAllActive(false);
      return;
    }
    handleLoadMore();
  }, [loadAllActive, virtualFolder, loadingMessages, loadingMore, hasMoreMessages, handleLoadMore]);

  // Progressive unified-view paginator: when on a unified folder with
  // "Tout charger" active, fetch page 2..N for each account and merge the
  // results into the cached query data so the message list grows without
  // blocking the initial render.
  useEffect(() => {
    if (!loadAllActive || !virtualFolder) return;
    const unifiedIds = getUnifiedAccountIds();
    const included = accounts.filter((a) =>
      !unifiedIds.length ? true : unifiedIds.includes(a.id),
    );
    if (!included.length) return;
    const queryKey = ['virtual-messages', virtualFolder, prefsVersion, accounts.map((a) => a.id).join(',')];
    let cancelled = false;
    (async () => {
      for (const acct of included) {
        if (cancelled) return;
        try {
          const accFolders: MailFolder[] =
            queryClient.getQueryData<MailFolder[]>(['folders', acct.id]) || [];
          const target =
            virtualFolder === 'unified-inbox'
              ? findInboxFolderPath(accFolders)
              : findSentFolderPath(accFolders);
          if (!target) continue;
          // We already fetched page 1 in queryFn — start at page 2.
          let page = 2;
          const MAX_PAGES = 500;
          while (page <= MAX_PAGES) {
            if (cancelled) return;
            const current = queryClient.getQueryData<any>(queryKey);
            const haveForAccount = (current?.messages || []).filter(
              (m: any) => m._accountId === acct.id && m._folder === target,
            ).length;
            const totalForAccount = (current?.messages || []).find(
              (m: any) => m._accountId === acct.id && m._folder === target,
            )?._virtualTotal ?? 0;
            if (totalForAccount && haveForAccount >= totalForAccount) break;
            const res = await api.getMessages(acct.id, target, page);
            const batch = res.messages || [];
            if (!batch.length) break;
            const tagged = batch.map((m: any) => ({
              ...m, _accountId: acct.id, _folder: target,
              _virtualTotal: res.total ?? totalForAccount,
            }));
            queryClient.setQueryData<any>(queryKey, (old: any) => {
              const prev: any[] = old?.messages || [];
              const seen = new Set(prev.map((m: any) => `${m._accountId}:${m._folder}:${m.uid}`));
              const merged = [...prev];
              for (const m of tagged) {
                const key = `${m._accountId}:${m._folder}:${m.uid}`;
                if (!seen.has(key)) { seen.add(key); merged.push(m); }
              }
              merged.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
              return { messages: merged, total: merged.length, page: 1 };
            });
            page += 1;
          }
        } catch {
          /* ignore — keep paging next account */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAllActive, virtualFolder, prefsVersion, accounts.length]);

  // Mark as read mutation
  const markReadMutation = useMutation({
    mutationFn: ({ uid, isRead, accountId, folder }: { uid: number; isRead: boolean; accountId?: string; folder?: string }) => {
      const accId = accountId || selectedAccount?.id;
      const fld = folder || selectedFolder;
      return accId ? api.markAsRead(accId, uid, isRead, fld) : Promise.resolve();
    },
    onSuccess: (_, { uid, isRead }) => {
      updateMessageFlags(uid, { seen: isRead });
    },
  });

  // Flag mutation
  const flagMutation = useMutation({
    mutationFn: ({ uid, isFlagged, accountId, folder }: { uid: number; isFlagged: boolean; accountId?: string; folder?: string }) => {
      const accId = accountId || selectedAccount?.id;
      const fld = folder || selectedFolder;
      return accId ? api.toggleFlag(accId, uid, isFlagged, fld) : Promise.resolve();
    },
    onSuccess: (_, { uid, isFlagged }) => {
      updateMessageFlags(uid, { flagged: isFlagged });
    },
  });

  /** Surgically drop a message from every cached `virtual-messages` query so
   *  the unified inbox / unified sent / favourites views update immediately
   *  after a delete/move/archive — without triggering a full re-pagination
   *  (which would be expensive when the « Tout charger » mode is active). */
  const removeMessageFromVirtualCaches = useCallback((uid: number, accountId?: string, folder?: string) => {
    queryClient.setQueriesData<any>({ queryKey: ['virtual-messages'] }, (old: any) => {
      if (!old || !Array.isArray(old.messages)) return old;
      const filtered = old.messages.filter((m: any) => {
        if (m?.uid !== uid) return true;
        if (accountId && m?._accountId && m._accountId !== accountId) return true;
        if (folder && m?._folder && m._folder !== folder) return true;
        return false;
      });
      if (filtered.length === old.messages.length) return old;
      return { ...old, messages: filtered, total: Math.max(0, (old.total ?? filtered.length) - 1) };
    });
  }, [queryClient]);

  // Delete mutation — either moves a message to the Trash folder (safe
  // delete, recoverable) or performs an IMAP permanent delete when
  // toTrash=false or when a Trash folder cannot be located.
  const deleteMutation = useMutation({
    mutationFn: async (
      { uid, accountId, folder, toTrash, trashPath }:
      { uid: number; accountId?: string; folder?: string; toTrash?: boolean; trashPath?: string }
    ) => {
      const accId = accountId || selectedAccount?.id;
      const fld = folder || selectedFolder;
      if (!accId) return { moved: false };
      if (toTrash && trashPath && trashPath !== fld) {
        await api.moveMessage(accId, uid, fld, trashPath);
        return { moved: true };
      }
      await api.deleteMessage(accId, uid, fld);
      return { moved: false };
    },
    // Optimistic removal: take the row out of the list immediately so the UI
    // feels instant (the IMAP round-trip can take a few seconds). Rollback on
    // error by restoring the snapshot.
    onMutate: ({ uid, accountId, folder }) => {
      const accId = accountId || selectedAccount?.id;
      const fld = folder || selectedFolder;
      const prev = useMailStore.getState().messages;
      // Capture the selection BEFORE removeMessage runs — the store nulls it
      // out itself when the deleted UID matches, so we need to know the
      // previous state to decide whether to navigate back to the list.
      const sel = useMailStore.getState().selectedMessage;
      const wasViewingDeleted = !!(sel && sel.uid === uid && (!accId || (sel as any)._accountId === accId));
      removeMessage(uid, accId, fld);
      // On mobile / tablet the message column is shown full-screen; bring the
      // user back to the message list instead of leaving them on the empty
      // "Sélectionnez un message" placeholder.
      if (wasViewingDeleted) {
        setMobileView('list');
      }
      return { prev };
    },
    onSuccess: (data: any, { accountId, uid, folder }) => {
      if (data?.moved) {
        toast.success('Message envoyé dans la corbeille');
        // The trash folder count changed — refresh folders list for the account.
        queryClient.invalidateQueries({ queryKey: ['folders', accountId || selectedAccount?.id] });
      } else {
        toast.success('Message supprimé');
      }
      // Unified inbox / Sent / favourite folder views aggregate across accounts —
      // patch every cached `virtual-messages` query so the deleted row also
      // disappears there without triggering a costly full re-pagination.
      removeMessageFromVirtualCaches(uid, accountId || selectedAccount?.id, folder || selectedFolder);
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.prev) useMailStore.setState({ messages: ctx.prev });
      toast.error(err?.message || 'Erreur lors de la suppression');
    },
  });

  // Confirmation dialog state (delete) — decoupled from the mutation so the
  // user can cancel without triggering any IMAP call.
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { title: string; description: string; permanent: boolean; onConfirm: () => void }
    | null
  >(null);

  // --- Swipe gesture state (mobile/tablet) ---
  // Preferences live in localStorage (see utils/mailPreferences). We keep a
  // local copy here so the MessageList re-renders when the user changes them
  // in the Settings page. A custom 'mail-swipe-prefs-changed' event is also
  // listened to for same-tab updates (storage events only fire across tabs).
  const [swipePrefs, setSwipePrefsState] = useState(() => getSwipePrefs());
  useEffect(() => {
    const reload = () => setSwipePrefsState(getSwipePrefs());
    window.addEventListener('storage', reload);
    window.addEventListener('mail-swipe-prefs-changed', reload);
    return () => {
      window.removeEventListener('storage', reload);
      window.removeEventListener('mail-swipe-prefs-changed', reload);
    };
  }, []);
  // Folder picker dialog (used when a swipe action is 'move' or 'copy' but no
  // default target is configured for the account, or when the configured
  // folder no longer exists).
  const [folderPicker, setFolderPicker] = useState<
    | {
        title: string;
        description: string;
        confirmLabel: string;
        accountId: string;
        folders: MailFolder[];
        initialPath: string | null;
        /** Whether to remember the picked folder as the default for this account. */
        rememberAs: 'move' | 'copy' | null;
        onPick: (path: string) => void;
      }
    | null
  >(null);

  // Folder creation helper usable from the picker dialog.
  const createFolderAwait = useCallback(async (accountId: string, name: string): Promise<string | null> => {
    try {
      const sanitized = name.trim().replace(/[\\\/]/g, '');
      if (!sanitized) return null;
      const path = sanitized;
      await api.createFolder(accountId, path);
      await queryClient.invalidateQueries({ queryKey: ['folders', accountId] });
      // Re-fetch synchronously to return the actual created path.
      const fresh = await queryClient.fetchQuery({
        queryKey: ['folders', accountId],
        queryFn: () => api.getFolders(accountId),
      });
      const found = fresh.find((f) => f.path === path || f.name === sanitized);
      toast.success('Dossier créé');
      return found?.path ?? path;
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la création du dossier');
      return null;
    }
  }, [queryClient]);

  /** Wrap a delete request: resolve the Trash folder of the origin account,
   *  move the message there when possible, or fall back to a permanent IMAP
   *  delete when the message is already in Trash (or no Trash exists).
   *  Shows a confirmation dialog when the user enabled this safeguard. */
  const requestDelete = useCallback(async (
    args: { uid: number; accountId?: string; folder?: string },
  ) => {
    const accId = args.accountId || selectedAccount?.id;
    const fld = args.folder || selectedFolder;
    if (!accId) return;

    // Resolve the account's folders (from cache or network) so we can locate Trash.
    let accFolders = queryClient.getQueryData<MailFolder[]>(['folders', accId]);
    if (!accFolders) {
      try {
        accFolders = await queryClient.fetchQuery({
          queryKey: ['folders', accId],
          queryFn: () => api.getFolders(accId),
        });
      } catch {
        accFolders = [];
      }
    }
    const trashPath = findTrashFolderPath(accFolders || []);
    const alreadyInTrash = isTrashFolderPath(accFolders || [], fld);
    const permanent = alreadyInTrash || !trashPath;

    const run = () => {
      deleteMutation.mutate({
        uid: args.uid,
        accountId: accId,
        folder: fld,
        toTrash: !permanent,
        trashPath: trashPath || undefined,
      });
    };

    if (!getDeleteConfirmEnabled()) { run(); return; }

    setDeleteConfirm({
      title: permanent ? 'Supprimer définitivement ?' : 'Supprimer ce message ?',
      description: permanent
        ? 'Ce message sera supprimé définitivement du serveur et ne pourra pas être récupéré.'
        : `Le message sera déplacé dans la corbeille${trashPath ? ` (${trashPath})` : ''}. Vous pourrez le récupérer depuis ce dossier.`,
      permanent,
      onConfirm: () => { setDeleteConfirm(null); run(); },
    });
  }, [selectedAccount, selectedFolder, deleteMutation, queryClient]);

  // Move mutation
  const moveMutation = useMutation({
    mutationFn: ({ uid, toFolder, accountId, fromFolder }: { uid: number; toFolder: string; accountId?: string; fromFolder?: string }) => {
      const accId = accountId || selectedAccount?.id;
      const src = fromFolder || selectedFolder;
      return accId ? api.moveMessage(accId, uid, src, toFolder) : Promise.resolve();
    },
    onMutate: ({ uid, accountId, fromFolder }) => {
      const accId = accountId || selectedAccount?.id;
      const src = fromFolder || selectedFolder;
      const prev = useMailStore.getState().messages;
      removeMessage(uid, accId, src);
      return { prev };
    },
    onSuccess: (_data, { uid, accountId, fromFolder }) => {
      toast.success('Message déplacé');
      removeMessageFromVirtualCaches(uid, accountId || selectedAccount?.id, fromFolder || selectedFolder);
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.prev) useMailStore.setState({ messages: ctx.prev });
      toast.error(err?.message || 'Erreur lors du déplacement');
    },
  });

  // Archive mutation — server-side builds Archives/{year}/{month} tree
  // (configurable by admin) using the message's reception date.
  const archiveMutation = useMutation({
    mutationFn: ({ uid, accountId, fromFolder }: { uid: number; accountId?: string; fromFolder?: string }) => {
      const accId = accountId || selectedAccount?.id;
      const src = fromFolder || selectedFolder;
      if (!accId) return Promise.resolve({ success: false, destFolder: '' });
      return api.archiveMessage(accId, uid, src);
    },
    onMutate: ({ uid, accountId, fromFolder }) => {
      const accId = accountId || selectedAccount?.id;
      const src = fromFolder || selectedFolder;
      const prev = useMailStore.getState().messages;
      removeMessage(uid, accId, src);
      return { prev };
    },
    onSuccess: (data: any, { uid, accountId, fromFolder }) => {
      const where = data?.destFolder ? ` (${data.destFolder})` : '';
      toast.success(`Message archivé${where}`);
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      removeMessageFromVirtualCaches(uid, accountId || selectedAccount?.id, fromFolder || selectedFolder);
    },
    onError: (err: any, _vars, ctx: any) => {
      if (ctx?.prev) useMailStore.setState({ messages: ctx.prev });
      toast.error(err?.message || 'Erreur d\'archivage');
    },
  });

  // Copy mutation
  const copyMutation = useMutation({
    mutationFn: ({ uid, toFolder, accountId, fromFolder }: { uid: number; toFolder: string; accountId?: string; fromFolder?: string }) => {
      const accId = accountId || selectedAccount?.id;
      const src = fromFolder || selectedFolder;
      return accId ? api.copyMessage(accId, uid, src, toFolder) : Promise.resolve();
    },
    onSuccess: () => {
      toast.success('Message copié');
    },
  });

  // Folder management mutations
  const createFolderMutation = useMutation({
    mutationFn: ({ accountId, path }: { accountId: string; path: string }) =>
      api.createFolder(accountId, path),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['folders', variables.accountId] });
      toast.success('Dossier créé');
    },
    onError: (error: any) => toast.error(`Erreur: ${error.message}`),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ accountId, oldPath, newPath }: { accountId?: string; oldPath: string; newPath: string }) => {
      const id = accountId || selectedAccount?.id;
      return id ? api.renameFolder(id, oldPath, newPath) : Promise.resolve();
    },
    onSuccess: (_data, variables) => {
      const id = variables.accountId || selectedAccount?.id;
      queryClient.invalidateQueries({ queryKey: ['folders', id] });
      toast.success('Dossier renommé');
    },
    onError: (error: any) => toast.error(`Erreur: ${error.message}`),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: ({ accountId, path }: { accountId: string; path: string }) =>
      api.deleteFolder(accountId, path),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['folders', variables.accountId] });
      toast.success('Dossier supprimé');
    },
    onError: (error: any) => toast.error(`Erreur: ${error.message}`),
  });

  // Helper: fetch folders for a specific account from query cache, falling back to active selection.
  const getFoldersForAccount = (accountId: string): MailFolder[] => {
    const cached = queryClient.getQueryData<MailFolder[]>(['folders', accountId]);
    if (cached && cached.length) return cached;
    if (selectedAccount?.id === accountId) return folders;
    return [];
  };

  // Folder context menu handlers
  const handleCreateFolder = (accountId: string, parentPath?: string) => {
    const name = prompt('Nom du nouveau dossier :');
    if (!name?.trim()) return;
    const sanitized = name.trim().replace(/[\\\/]/g, '');
    let path = sanitized;
    if (parentPath) {
      const parent = getFoldersForAccount(accountId).find((f) => f.path === parentPath);
      const delimiter = parent?.delimiter || '.';
      path = `${parentPath}${delimiter}${sanitized}`;
    }
    createFolderMutation.mutate({ accountId, path });
  };

  const handleRenameFolder = (accountId: string, folderPath: string, currentName: string) => {
    const newName = prompt('Nouveau nom du dossier :', currentName);
    if (!newName?.trim() || newName.trim() === currentName) return;
    const sanitized = newName.trim().replace(/[\\\/]/g, '');
    const current = getFoldersForAccount(accountId).find((f) => f.path === folderPath);
    const delimiter = current?.delimiter || '.';
    const idx = folderPath.lastIndexOf(delimiter);
    const newPath = idx >= 0 ? `${folderPath.slice(0, idx)}${delimiter}${sanitized}` : sanitized;
    renameFolderMutation.mutate({ accountId, oldPath: folderPath, newPath });
  };

  const handleDeleteFolder = (accountId: string, folderPath: string) => {
    if (!confirm(`Supprimer le dossier "${folderPath}" et tout son contenu ?`)) return;
    deleteFolderMutation.mutate({ accountId, path: folderPath });
  };

  const handleMoveFolder = (accountId: string, oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    renameFolderMutation.mutate({ accountId, oldPath, newPath });
  };

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: async (data: any) => {
      // Pre-built RFC 822 MIME (S/MIME or PGP/MIME) — route to the raw passthrough endpoint.
      if (data?.rawMime) {
        return api.sendMailRaw({
          accountId: data.accountId,
          to: (data.to || []).map((r: any) => ({ email: r.address, name: r.name })),
          cc: (data.cc || []).map((r: any) => ({ email: r.address, name: r.name })),
          bcc: (data.bcc || []).map((r: any) => ({ email: r.address, name: r.name })),
          rawMime: data.rawMime,
          inReplyToUid: data.inReplyToUid,
          inReplyToFolder: data.inReplyToFolder,
        });
      }
      if (isOnline) {
        return api.sendMail(data);
      } else {
        await offlineDB.addToOutbox(data);
        return { success: true, offline: true };
      }
    },
    onSuccess: (result: any, variables: any) => {
      closeCompose();
      if (result?.offline) {
        toast.success('Message enregistré dans la boîte d\'envoi (envoi au retour de la connexion)');
      } else {
        toast.success('Message envoyé');
        // Optimistic update: if this was a reply, reflect the \Answered flag locally so the
        // « répondu » indicator appears immediately in the list without waiting for a refetch.
        if (variables?.inReplyToUid) {
          updateMessageFlags(variables.inReplyToUid, { answered: true });
        }
        // Refresh the message list to pick up the server-side flag change.
        queryClient.invalidateQueries({ queryKey: ['messages'] });
        queryClient.invalidateQueries({ queryKey: ['virtual-messages'] });
      }
    },
    onError: (error: any) => {
      toast.error(`Erreur d'envoi: ${error.message}`);
    },
  });

  // Process outbox when coming back online
  useEffect(() => {
    if (isOnline) {
      offlineDB.getOutbox().then(async (outboxItems) => {
        if (outboxItems.length > 0) {
          toast.loading(`Envoi de ${outboxItems.length} message(s) en attente...`, { id: 'outbox' });
          try {
            await api.processOutbox();
            toast.success('Messages en attente envoyés', { id: 'outbox' });
          } catch {
            toast.error('Erreur lors de l\'envoi des messages en attente', { id: 'outbox' });
          }
        }
      });
    }
  }, [isOnline]);

  const handleSelectMessage = async (message: any) => {
    openMessageTab(message);

    const { accountId, folder } = originOf(message);

    // Auto mark as read
    if (!message.flags?.seen && accountId) {
      markReadMutation.mutate({ uid: message.uid, isRead: true, accountId, folder });
    }

    // Load full message
    if (accountId && isOnline) {
      try {
        const full = await api.getMessage(accountId, message.uid, folder);
        // Preserve origin tags when in unified view
        const enriched = message._accountId
          ? { ...full, _accountId: message._accountId, _folder: message._folder }
          : full;
        openMessageTab(enriched);
      } catch {}
    }
  };

  const handleReply = (message: any, replyAll: boolean = false) => {
    const replyTo = message.from ? [message.from] : [];
    const replyCC = replyAll && message.cc ? message.cc : [];
    const { accountId, folder } = originOf(message);

    if (splitComposeReply) setComposeAlongsideMessage(message);
    openCompose({
      to: replyTo,
      cc: replyCC,
      subject: splitComposeReply
        ? ''
        : (message.subject?.startsWith('Re:') ? message.subject : `Re: ${message.subject}`),
      bodyHtml: splitComposeReply
        ? ''
        : `<br/><br/><div style="border-left:2px solid #0078D4;padding-left:12px;margin-left:0;color:#605E5C">
        <p><b>De :</b> ${message.from?.name || message.from?.address}<br/>
        <b>Envoyé :</b> ${new Date(message.date).toLocaleString('fr-FR')}<br/>
        <b>À :</b> ${message.to?.map((t: any) => t.name || t.address).join('; ')}<br/>
        <b>Objet :</b> ${message.subject}</p>
        ${message.bodyHtml || message.bodyText || ''}
      </div>`,
      inReplyTo: message.messageId,
      references: message.headers?.references,
      accountId: accountId || selectedAccount?.id,
      inReplyToUid: message.uid,
      inReplyToFolder: folder,
    });
  };

  const handleForward = (message: any) => {
    const { accountId } = originOf(message);
    if (splitComposeReply) setComposeAlongsideMessage(message);
    openCompose({
      to: [],
      subject: splitComposeReply
        ? ''
        : (message.subject?.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject}`),
      bodyHtml: splitComposeReply
        ? ''
        : `<br/><br/><div style="border-top:1px solid #E1DFDD;padding-top:12px;color:#605E5C">
        <p><b>---------- Message transféré ----------</b><br/>
        <b>De :</b> ${message.from?.name || message.from?.address}<br/>
        <b>Date :</b> ${new Date(message.date).toLocaleString('fr-FR')}<br/>
        <b>Objet :</b> ${message.subject}<br/>
        <b>À :</b> ${message.to?.map((t: any) => t.name || t.address).join('; ')}</p>
        ${message.bodyHtml || message.bodyText || ''}
      </div>`,
      accountId: accountId || selectedAccount?.id,
    });
  };

  // Mobile view state: 'folders' | 'list' | 'message'
  const [mobileView, setMobileView] = useState<'folders' | 'list' | 'message'>('list');
  const [showFolderPane, setShowFolderPane] = useState(true);

  // Deep-link from a Web Push notification action (Outlook-style buttons:
  // archive / delete / reply / markRead / flag). The Service Worker forwards
  // the click via URL params; we run the matching mutation, then clean the
  // params so a refresh doesn't re-trigger them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('notifAction');
    if (!action) return;
    const uid = Number(params.get('notifUid') || 0);
    const accountId = params.get('notifAccountId') || undefined;
    const folder = params.get('notifFolder') || 'INBOX';
    if (!uid || !accountId) return;

    const cleanup = () => {
      params.delete('notifAction');
      params.delete('notifUid');
      params.delete('notifAccountId');
      params.delete('notifFolder');
      const qs = params.toString();
      const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState({}, '', url);
    };

    (async () => {
      try {
        if (action === 'markRead') {
          markReadMutation.mutate({ uid, isRead: true, accountId, folder });
          toast.success('Marqué comme lu');
        } else if (action === 'flag') {
          flagMutation.mutate({ uid, isFlagged: true, accountId, folder });
        } else if (action === 'delete') {
          deleteMutation.mutate({ uid, accountId, folder, toTrash: true });
          toast.success('Message supprimé');
        } else if (action === 'archive') {
          let folders = queryClient.getQueryData<MailFolder[]>(['folders', accountId]);
          if (!folders) {
            try {
              folders = await queryClient.fetchQuery({
                queryKey: ['folders', accountId],
                queryFn: () => api.getFolders(accountId),
              });
            } catch { folders = []; }
          }
          const archive = (folders || []).find(f =>
            /archive|archives/i.test(f.path) || /archive|archives/i.test(f.name)
          );
          const target = archive?.path || 'Archive';
          moveMutation.mutate({ uid, toFolder: target, accountId, fromFolder: folder });
          toast.success('Message archivé');
        } else if (action === 'reply') {
          // Best-effort: load the message then open a reply.
          try {
            const msg = await api.getMessage(accountId, uid, folder);
            handleReply(msg);
          } catch {
            toast.error('Impossible d\u2019ouvrir la réponse');
          }
        }
      } finally {
        cleanup();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile/tablet: the top-bar hamburger emits a signal via the UI store. When
  // it fires, toggle between the folder list and the message list.
  const mobileSidebarSignal = useUIStore((s) => s.mobileSidebarSignal);
  const lastSidebarSignalRef = useRef(mobileSidebarSignal);
  useEffect(() => {
    if (lastSidebarSignalRef.current === mobileSidebarSignal) return;
    lastSidebarSignalRef.current = mobileSidebarSignal;
    // Switching to the folder pane on mobile/tablet must also force
    // showFolderPane back on, since selecting a folder auto-collapses it
    // (see effect on selectedFolder/virtualFolder below).
    setMobileView((v) => {
      const next = v === 'folders' ? 'list' : 'folders';
      if (next === 'folders') setShowFolderPane(true);
      return next;
    });
  }, [mobileSidebarSignal]);

  // Mobile/tablet OS "back" button: intercept and map to in-app navigation
  // (message view → list, list → folder pane). The default browser/OS back
  // would otherwise leave the app entirely. We push a single sentinel history
  // entry on mount, and re-push it after consuming a back press so subsequent
  // back presses keep being captured. When the user is already on the folder
  // view (top of the in-app stack), we let the back press propagate normally
  // so they can leave the page.
  const mobileViewRef = useRef(mobileView);
  useEffect(() => { mobileViewRef.current = mobileView; }, [mobileView]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Only intercept on mobile widths — md+ shows all panes simultaneously.
    const mq = window.matchMedia('(max-width: 767px)');
    if (!mq.matches) return;

    const SENTINEL = '__mailMobileBack';
    try {
      window.history.pushState({ [SENTINEL]: true }, '');
    } catch { /* ignore */ }

    const onPop = () => {
      const v = mobileViewRef.current;
      if (v === 'message') {
        try { window.history.pushState({ [SENTINEL]: true }, ''); } catch { /* ignore */ }
        setMobileView('list');
        selectMessage(null);
      } else if (v === 'list') {
        try { window.history.pushState({ [SENTINEL]: true }, ''); } catch { /* ignore */ }
        setShowFolderPane(true);
        setMobileView('folders');
      }
      // 'folders' → don't re-push, allow normal back navigation.
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Clean up our sentinel entry if it's still on top, so leaving the page
      // doesn't require an extra back press.
      try {
        if (window.history.state && (window.history.state as any)[SENTINEL]) {
          window.history.back();
        }
      } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reading pane mode — matches Outlook's "Volet de lecture" setting.
  // 'right'  : list on the left, reading pane on the right (default)
  // 'bottom' : list on top, reading pane below (stacked vertically)
  // 'hidden' : no reading pane (messages open in the full right area only when selected in context)
  type ReadingPaneMode = 'right' | 'bottom' | 'hidden';
  const [readingPaneMode, setReadingPaneMode] = useState<ReadingPaneMode>(() => {
    const v = localStorage.getItem('readingPaneMode');
    return (v === 'bottom' || v === 'hidden' || v === 'right') ? v : 'right';
  });
  useEffect(() => { localStorage.setItem('readingPaneMode', readingPaneMode); }, [readingPaneMode]);
  // Density of the message list rows.
  type ListDensity = 'spacious' | 'comfortable' | 'compact';
  const [listDensity, setListDensity] = useState<ListDensity>(() => {
    const v = localStorage.getItem('listDensity');
    return (v === 'spacious' || v === 'compact' || v === 'comfortable') ? v : 'comfortable';
  });
  useEffect(() => { localStorage.setItem('listDensity', listDensity); }, [listDensity]);
  // Message list display mode (wide columns vs compact cards).
  type ListDisplayMode = 'auto' | 'wide' | 'compact';
  const [listDisplayMode, setListDisplayMode] = useState<ListDisplayMode>(() => {
    const v = localStorage.getItem('listDisplayMode');
    return (v === 'wide' || v === 'compact' || v === 'auto') ? v : 'auto';
  });
  useEffect(() => { localStorage.setItem('listDisplayMode', listDisplayMode); }, [listDisplayMode]);
  // Mail body display mode (corps du mail) — natif (largeur de lecture) ou
  // étiré (toute la largeur). Préférence globale, peut être surchargée par
  // message dans MessageView.
  const [mailDisplayMode, setMailDisplayModeState] = useState<MailDisplayMode>(() => getMailDisplayMode());
  useEffect(() => {
    const handler = () => setMailDisplayModeState(getMailDisplayMode());
    window.addEventListener(MAIL_DISPLAY_MODE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(MAIL_DISPLAY_MODE_CHANGED_EVENT, handler);
  }, []);
  const handleChangeMailDisplayMode = useCallback((m: MailDisplayMode) => {
    setMailDisplayMode(m);
    setMailDisplayModeState(m);
  }, []);
  // Conversation view — group messages by thread. Disabled by default.
  const [conversationView, setConversationView] = useState<boolean>(() => {
    return localStorage.getItem('conversationView') === '1';
  });
  useEffect(() => { localStorage.setItem('conversationView', conversationView ? '1' : '0'); }, [conversationView]);

  // Outlook-style Conversations menu: separate the "grouping mode" (how the list is built)
  // from the "show-all-in-reading-pane" flag (how the reading pane renders the thread).
  // `conversationView` above remains as a legacy boolean kept in sync with `conversationGrouping`.
  const [conversationGrouping, setConversationGrouping] = useState<'none' | 'conversation' | 'branches'>(() => {
    const v = localStorage.getItem('conversationGrouping');
    if (v === 'none' || v === 'conversation' || v === 'branches') return v;
    return localStorage.getItem('conversationView') === '1' ? 'conversation' : 'none';
  });
  useEffect(() => {
    localStorage.setItem('conversationGrouping', conversationGrouping);
    setConversationView(conversationGrouping !== 'none');
  }, [conversationGrouping]);

  const [conversationShowAllInReadingPane, setConversationShowAllInReadingPane] = useState<boolean>(() => {
    const v = localStorage.getItem('conversationShowAllInReadingPane');
    return v === null ? true : v === '1';
  });
  useEffect(() => {
    localStorage.setItem('conversationShowAllInReadingPane', conversationShowAllInReadingPane ? '1' : '0');
  }, [conversationShowAllInReadingPane]);
  // Effective display mode: in "bottom" disposition we force a compact layout unless the user explicitly overrode it.
  const effectiveListDisplayMode: ListDisplayMode =
    listDisplayMode !== 'auto' ? listDisplayMode : readingPaneMode === 'bottom' ? 'compact' : 'auto';
  // Height (in px) of the message list when the reading pane is docked at the bottom.
  const [listHeight, setListHeight] = useState<number>(() => {
    const n = parseInt(localStorage.getItem('listHeight') || '320', 10);
    return Number.isFinite(n) && n >= 120 && n <= 900 ? n : 320;
  });
  useEffect(() => { localStorage.setItem('listHeight', String(listHeight)); }, [listHeight]);
  const isListResizingHeight = useRef(false);
  const handleListHeightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isListResizingHeight.current = true;
    const startY = e.clientY;
    const startH = listHeight;
    const onMove = (ev: MouseEvent) => {
      if (!isListResizingHeight.current) return;
      const delta = ev.clientY - startY;
      const next = Math.min(900, Math.max(120, startH + delta));
      setListHeight(next);
    };
    const onUp = () => {
      isListResizingHeight.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  // When true, the inline compose pane takes the full width (folder pane + message list hidden).
  const [composeExpanded, setComposeExpanded] = useState(false);
  // Split view: show the active tab + another tab side-by-side.
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem('splitRatio') || '0.5');
    return Number.isFinite(saved) && saved > 0.15 && saved < 0.85 ? saved : 0.5;
  });
  // Split-mode personalization: keep folder pane / message list visible while in split view.
  const [splitKeepFolderPane, setSplitKeepFolderPane] = useState<boolean>(() => localStorage.getItem('splitKeepFolderPane') === 'true');
  const [splitKeepMessageList, setSplitKeepMessageList] = useState<boolean>(() => localStorage.getItem('splitKeepMessageList') === 'true');
  useEffect(() => { localStorage.setItem('splitKeepFolderPane', String(splitKeepFolderPane)); }, [splitKeepFolderPane]);
  useEffect(() => { localStorage.setItem('splitKeepMessageList', String(splitKeepMessageList)); }, [splitKeepMessageList]);
  // When true, Reply / Reply-All / Forward opens the compose alongside the source message (side-by-side).
  const [splitComposeReply, setSplitComposeReply] = useState<boolean>(() => localStorage.getItem('splitComposeReply') === 'true');
  useEffect(() => { localStorage.setItem('splitComposeReply', String(splitComposeReply)); }, [splitComposeReply]);
  // The source message shown next to the compose pane (when side-by-side compose is active).
  const [composeAlongsideMessage, setComposeAlongsideMessage] = useState<any | null>(null);
  useEffect(() => { if (!isComposing && composeAlongsideMessage) setComposeAlongsideMessage(null); }, [isComposing, composeAlongsideMessage]);
  // Reset the local "expanded compose" flag whenever composition ends so the
  // mobile FAB (which is hidden while composing/expanded) reappears.
  useEffect(() => { if (!isComposing && composeExpanded) setComposeExpanded(false); }, [isComposing, composeExpanded]);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingSplit = useRef(false);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(() => {
    return localStorage.getItem('ribbonCollapsed') === 'true';
  });
  const [ribbonMode, setRibbonMode] = useState<'classic' | 'simplified'>(() => {
    return (localStorage.getItem('ribbonMode') as 'classic' | 'simplified') || 'classic';
  });

  // Shared ref for the compose editor — allows the ribbon's Message tab to drive formatting
  const composeEditorRef = useRef<HTMLDivElement>(null);
  // Shared API ref — allows the ribbon Insérer tab to drive compose actions (attach files, etc.)
  const composeApiRef = useRef<ComposeApi | null>(null);
  // Emoji side panel (opened from the Insérer tab)
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const savedEmojiRangeRef = useRef<Range | null>(null);
  // GIF side panel (opened from the Insérer tab)
  const [showGifPanel, setShowGifPanel] = useState(false);

  // Mail templates modals (Insérer > Modèles)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showTemplatesManager, setShowTemplatesManager] = useState(false);

  // Auto-close the side panels when composition ends.
  useEffect(() => {
    if (!isComposing) {
      if (showEmojiPanel) setShowEmojiPanel(false);
      if (showGifPanel) setShowGifPanel(false);
    }
  }, [isComposing, showEmojiPanel, showGifPanel]);

  const saveComposeSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const editor = composeEditorRef.current;
    if (editor && editor.contains(range.commonAncestorContainer)) {
      savedEmojiRangeRef.current = range.cloneRange();
    }
  }, []);

  const restoreComposeSelection = useCallback(() => {
    const editor = composeEditorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    const range = savedEmojiRangeRef.current;
    if (sel && range && editor.contains(range.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  const insertEmojiIntoCompose = useCallback((emoji: string) => {
    restoreComposeSelection();
    document.execCommand('insertText', false, emoji);
    // Re-save the collapsed range after insertion so next emoji appends in order.
    const newSel = window.getSelection();
    if (newSel && newSel.rangeCount > 0) {
      savedEmojiRangeRef.current = newSel.getRangeAt(0).cloneRange();
    }
  }, [restoreComposeSelection]);

  const insertGifIntoCompose = useCallback((url: string, alt?: string) => {
    if (!url) return;
    restoreComposeSelection();
    const safeAlt = (alt || 'GIF').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const html = `<img src="${url}" alt="${safeAlt}" style="max-width:300px;height:auto;" />`;
    document.execCommand('insertHTML', false, html);
    const newSel = window.getSelection();
    if (newSel && newSel.rangeCount > 0) {
      savedEmojiRangeRef.current = newSel.getRangeAt(0).cloneRange();
    }
  }, [restoreComposeSelection]);

  // Resizable message list pane
  const [listWidth, setListWidth] = useState(() => {
    const saved = localStorage.getItem('mailListWidth');
    return saved ? parseInt(saved, 10) : 320;
  });

  // Resizable folder pane
  const [folderWidth, setFolderWidth] = useState(() => {
    const saved = localStorage.getItem('folderPaneWidth');
    return saved ? parseInt(saved, 10) : 224;
  });

  const isDragging = useRef(false);
  const isDraggingFolder = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      // Calculate offset from the start of the message list pane
      let folderPaneWidth = 0;
      if (showFolderPane) {
        const folderEl = containerRef.current.querySelector('[data-pane="folders"]');
        if (folderEl) folderPaneWidth = (folderEl as HTMLElement).offsetWidth + 4; // +4 for resize handle
      }
      const newWidth = ev.clientX - containerRect.left - folderPaneWidth;
      const clamped = Math.max(220, Math.min(newWidth, containerRect.width - 400));
      setListWidth(clamped);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist
      setListWidth(prev => {
        localStorage.setItem('mailListWidth', String(prev));
        return prev;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [showFolderPane]);

  // Resizable folder pane handler
  const handleFolderResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingFolder.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingFolder.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = ev.clientX - containerRect.left;
      const clamped = Math.max(160, Math.min(newWidth, 400));
      setFolderWidth(clamped);
    };

    const onMouseUp = () => {
      isDraggingFolder.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setFolderWidth(prev => {
        localStorage.setItem('folderPaneWidth', String(prev));
        return prev;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Resizable split handler (between two side-by-side tabs)
  const handleSplitResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplit.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingSplit.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      const clamped = Math.max(0.15, Math.min(0.85, ratio));
      setSplitRatio(clamped);
    };
    const onMouseUp = () => {
      isDraggingSplit.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setSplitRatio(prev => {
        localStorage.setItem('splitRatio', String(prev));
        return prev;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // When selecting a folder on mobile, switch to list view. On tablet
  // (md..lg, where the folder pane is shown alongside the message list),
  // also collapse the folder pane so the message list gets the full width.
  const handleSelectFolder = (folder: string) => {
    selectFolder(folder);
    setMobileView('list');
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setShowFolderPane(false);
    }
  };

  // Mirror the mobile/tablet auto-collapse behaviour for folder/virtual-folder
  // selections triggered from inside FolderPane (favorites + unified pseudo
  // entries call selectVirtualFolder / selectFolder on the store directly).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileView('list');
    }
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setShowFolderPane(false);
    }
  }, [selectedFolder, virtualFolder, selectedAccount?.id]);

  // Clear split pairing if that tab is closed.
  useEffect(() => {
    if (splitTabId && !openTabs.some(t => t.id === splitTabId)) {
      setSplitTabId(null);
    }
  }, [openTabs, splitTabId]);

  // If the user activates the split tab, swap the pairing with the previously active tab
  // so the side-by-side view remains consistent.
  const prevActiveTabIdRef = useRef<string | null>(activeTabId);
  useEffect(() => {
    const prev = prevActiveTabIdRef.current;
    if (splitTabId && activeTabId && activeTabId === splitTabId && prev && prev !== splitTabId) {
      setSplitTabId(prev);
    }
    prevActiveTabIdRef.current = activeTabId;
  }, [activeTabId, splitTabId]);

  // Resolve tab/message for split rendering
  const splitTab = splitTabId ? openTabs.find(t => t.id === splitTabId) : undefined;
  const splitMessage = splitTab?.type === 'message' ? splitTab.message : undefined;
  // Only render side-by-side when both sides are message tabs and compose isn't expanded
  const splitActive = !!splitMessage && !!selectedMessage && splitMessage.uid !== selectedMessage.uid && !composeExpanded && !isComposing;
  // True when showing a source message alongside the compose pane (reply/forward with keep-original-visible)
  const splitComposeActive = isComposing && !!composeAlongsideMessage && !composeExpanded;

  // Select a folder that may belong to a non-active account: activate the account first.
  const handleSelectFolderInAccount = useCallback((account: any, folder: string) => {
    if (selectedAccount?.id !== account.id) {
      selectAccount(account);
    }
    selectFolder(folder);
    setMobileView('list');
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setShowFolderPane(false);
    }
  }, [selectedAccount, selectAccount, selectFolder]);

  // When selecting a message on mobile, switch to message view
  const handleSelectMessageMobile = async (message: any) => {
    await handleSelectMessage(message);
    setMobileView('message');
  };

  // Handle drag & drop move (legacy signature: within active account)
  const handleDropMessage = (uid: number, toFolder: string) => {
    moveMutation.mutate({ uid, toFolder });
  };

  // Cross-account message drop (copy or move)
  const transferMessageMutation = useMutation({
    mutationFn: (params: {
      srcAccountId: string;
      srcFolder: string;
      uid: number;
      destAccountId: string;
      destFolder: string;
      mode: 'copy' | 'move';
    }) => api.transferMessage(params),
    onSuccess: (_result, params) => {
      if (params.mode === 'move') {
        if (selectedAccount?.id === params.srcAccountId && selectedFolder === params.srcFolder) {
          removeMessage(params.uid, params.srcAccountId, params.srcFolder);
        }
        queryClient.invalidateQueries({ queryKey: ['messages', params.srcAccountId, params.srcFolder] });
        toast.success('Message déplacé');
      } else {
        toast.success('Message copié');
      }
      queryClient.invalidateQueries({ queryKey: ['messages', params.destAccountId, params.destFolder] });
    },
    onError: (error: any) => toast.error(error.message || 'Erreur de transfert'),
  });

  const handleCrossAccountDrop = (
    payload: { uid: number; srcAccountId: string; srcFolder: string },
    dest: { account: any; folder: string },
    mode: 'copy' | 'move',
  ) => {
    transferMessageMutation.mutate({
      srcAccountId: payload.srcAccountId,
      srcFolder: payload.srcFolder,
      uid: payload.uid,
      destAccountId: dest.account.id,
      destFolder: dest.folder,
      mode,
    });
  };

  // Copy a folder (with its messages) to another (or the same) account
  const copyFolderMutation = useMutation({
    mutationFn: (params: {
      srcAccountId: string; srcPath: string; destAccountId: string; destPath: string;
    }) => api.copyFolderToAccount(params),
    onSuccess: (result, params) => {
      queryClient.invalidateQueries({ queryKey: ['folders', params.destAccountId] });
      queryClient.invalidateQueries({ queryKey: ['messages', params.destAccountId, params.destPath] });
      const copied = result?.copied ?? 0;
      const total = result?.total ?? 0;
      toast.success(`Dossier copié (${copied}/${total} messages)`);
    },
    onError: (error: any) => toast.error(error.message || 'Erreur de copie du dossier'),
  });

  const handleCopyFolder = (
    src: { accountId: string; path: string; name: string },
    dest: { accountId: string; path: string },
  ) => {
    toast.loading('Copie du dossier en cours…', { id: `folder-copy-${src.path}` });
    copyFolderMutation.mutate(
      { srcAccountId: src.accountId, srcPath: src.path, destAccountId: dest.accountId, destPath: dest.path },
      {
        onSettled: () => toast.dismiss(`folder-copy-${src.path}`),
      },
    );
  };

  const toggleRibbonCollapsed = useCallback(() => {
    setRibbonCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('ribbonCollapsed', String(next));
      return next;
    });
  }, []);

  const handleChangeRibbonMode = useCallback((mode: 'classic' | 'simplified') => {
    setRibbonMode(mode);
    localStorage.setItem('ribbonMode', mode);
  }, []);

  const handlePrint = useCallback(() => {
    if (!selectedMessage) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html><head><title>${selectedMessage.subject || ''}</title>
        <style>body{font-family:'Segoe UI',sans-serif;padding:20px;}</style>
        </head><body>
        <h2>${selectedMessage.subject || '(Sans objet)'}</h2>
        <p><b>De :</b> ${selectedMessage.from?.name || selectedMessage.from?.address || ''}</p>
        <p><b>Date :</b> ${new Date(selectedMessage.date).toLocaleString('fr-FR')}</p>
        <hr/>
        ${selectedMessage.bodyHtml || selectedMessage.bodyText || ''}
        </body></html>`);
      printWindow.document.close();
      printWindow.print();
    }
  }, [selectedMessage]);

  const handleDownloadEml = useCallback(async () => {
    if (!selectedMessage || !selectedAccount) return;
    try {
      const response = await fetch(`/api/accounts/${selectedAccount.id}/messages/${selectedMessage.uid}/raw`);
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(selectedMessage.subject || 'message').replace(/[^a-zA-Z0-9]/g, '_')}.eml`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        toast.error('Impossible de télécharger le message');
      }
    } catch {
      toast.error('Erreur lors du téléchargement');
    }
  }, [selectedMessage, selectedAccount]);

  const handleSync = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['messages'] });
    queryClient.invalidateQueries({ queryKey: ['folders'] });
    toast.success('Synchronisation lancée');
  }, [queryClient]);

  // ─── Categories ────────────────────────────────────────────────────────
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);
  const [categoryEditTarget, setCategoryEditTarget] = useState<any | null>(null);
  const [categoryManageOpen, setCategoryManageOpen] = useState(false);
  const [contextCategoryPicker, setContextCategoryPicker] = useState<{ message: any; x: number; y: number } | null>(null);
  // Auto-responder modal (vacation responder).
  const [autoResponderOpen, setAutoResponderOpen] = useState(false);
  // Mail rules modal (Outlook-style rules manager).
  const [rulesOpen, setRulesOpen] = useState(false);
  const { data: autoResponderFeature } = useQuery({
    queryKey: ['auto-responder-feature-settings'],
    queryFn: api.getAutoResponderFeatureSettings,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const autoResponderFeatureEnabled = autoResponderFeature?.enabled !== false;
  const { data: autoResponderStatus } = useQuery({
    queryKey: ['auto-responder', selectedAccount?.id, 'status'],
    queryFn: () => selectedAccount ? api.getAutoResponder(selectedAccount.id) : Promise.resolve(null),
    enabled: !!selectedAccount && autoResponderFeatureEnabled,
    refetchOnWindowFocus: false,
  });
  // Bump to force re-render when categories or assignments change.
  const [, setCatsTick] = useState(0);
  useEffect(() => subscribeCategories(() => setCatsTick((n) => n + 1)), []);

  const selectedMessageCategoryIds = useMemo(() => {
    if (!selectedMessage) return [];
    const o = originOf(selectedMessage);
    return getMessageCategories(selectedMessage as any, o.accountId, o.folder);
  }, [selectedMessage, prefsVersion, originOf]);

  const handleCategorize = useCallback((message: any, categoryId: string) => {
    const o = originOf(message);
    const next = toggleMessageCategory(message, categoryId, o.accountId, o.folder);
    // Categorised messages auto-flag → they appear in the "Épinglé" group of the list,
    // matching the spec ("le mail catégorisé va en mail épinglé / favoris").
    if (next.length > 0 && !message.flags?.flagged && o.accountId) {
      flagMutation.mutate({ uid: message.uid, isFlagged: true, accountId: o.accountId, folder: o.folder });
    }
    setCatsTick((n) => n + 1);
  }, [originOf, flagMutation]);

  const handleClearCategories = useCallback((message: any) => {
    const o = originOf(message);
    clearMessageCategories(message, o.accountId, o.folder);
    setCatsTick((n) => n + 1);
  }, [originOf]);

  // Apply category filter on top of whatever messages are currently loaded.
  const visibleMessages = useMemo(() => {
    if (!categoryFilter) return messages;
    return messages.filter((m) => {
      const o = originOf(m);
      const ids = getMessageCategories(m as any, o.accountId, o.folder);
      return ids.includes(categoryFilter);
    });
  }, [messages, categoryFilter, originOf]);

  // Conversation thread of the currently selected message — computed only when the conversation
  // view is enabled. The matching key mirrors the one used by MessageList to decorate rows.
  const conversationThreadKeyOf = (msg: any): string => {
    const refs: string | undefined = msg.headers?.references?.trim();
    if (refs) {
      const first = refs.split(/\s+/)[0];
      if (first) return first;
    }
    const inReplyTo: string | undefined = msg.headers?.inReplyTo?.trim();
    if (inReplyTo) return inReplyTo;
    if (msg.messageId) return msg.messageId;
    return 'subj:' + (msg.subject || '').replace(/^\s*(re|fwd?|tr|rép|réf)\s*:\s*/gi, '').trim().toLowerCase();
  };
  const conversationThread = useMemo(() => {
    if (!conversationView || !conversationShowAllInReadingPane || !selectedMessage) return undefined;
    const key = conversationThreadKeyOf(selectedMessage);
    const thread = visibleMessages.filter((m) => conversationThreadKeyOf(m) === key);
    return thread.length > 1 ? thread : undefined;
  }, [conversationView, conversationShowAllInReadingPane, selectedMessage, visibleMessages]);

  // ---- Swipe action dispatcher ----
  // Resolves a swipe direction to a concrete IMAP operation. For 'move'/'copy'
  // this respects the per-account default folder; when missing, we open the
  // folder picker dialog so the user can choose and optionally memorise it.
  const handleSwipeAction = (uid: number, action: SwipeAction, accountId?: string, folder?: string) => {
    if (action === 'none') return;
    const o = resolveOrigin(uid, accountId, folder);
    const accId = o.accountId;
    if (!accId) return;

    switch (action) {
      case 'archive':
        archiveMutation.mutate({ uid, accountId: accId, fromFolder: o.folder });
        return;
      case 'trash':
        requestDelete({ uid, accountId: accId, folder: o.folder });
        return;
      case 'flag': {
        const msg = messages.find((m) => m.uid === uid);
        flagMutation.mutate({ uid, isFlagged: !msg?.flags?.flagged, accountId: accId, folder: o.folder });
        return;
      }
      case 'read': {
        const msg = messages.find((m) => m.uid === uid);
        markReadMutation.mutate({ uid, isRead: !msg?.flags?.seen, accountId: accId, folder: o.folder });
        return;
      }
      case 'move':
      case 'copy': {
        const accFolders = queryClient.getQueryData<MailFolder[]>(['folders', accId]) ?? (selectedAccount?.id === accId ? folders : []);
        const preset = action === 'move' ? getSwipeMoveTarget(accId) : getSwipeCopyTarget(accId);
        const folderExists = !!(preset && accFolders.some((f) => f.path === preset));
        const runWith = (path: string) => {
          if (action === 'move') moveMutation.mutate({ uid, toFolder: path, accountId: accId, fromFolder: o.folder });
          else copyMutation.mutate({ uid, toFolder: path, accountId: accId, fromFolder: o.folder });
        };
        if (folderExists && preset) {
          runWith(preset);
          return;
        }
        setFolderPicker({
          title: action === 'move' ? 'Déplacer vers…' : 'Copier vers…',
          description:
            action === 'move'
              ? 'Choisissez un dossier de destination. Vous pouvez le définir par défaut dans les préférences pour un balayage plus rapide.'
              : 'Choisissez un dossier de destination pour la copie.',
          confirmLabel: action === 'move' ? 'Déplacer' : 'Copier',
          accountId: accId,
          folders: accFolders,
          initialPath: preset || null,
          rememberAs: action,
          onPick: (path) => {
            runWith(path);
          },
        });
        return;
      }
    }
  };

  const handleSwipe = (uid: number, direction: 'left' | 'right', accountId?: string, folder?: string) => {
    const action = direction === 'left' ? swipePrefs.leftAction : swipePrefs.rightAction;
    handleSwipeAction(uid, action, accountId, folder);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-outlook-bg-tertiary">
      {/* Ribbon toolbar block */}
      <div className="flex-shrink-0 mx-1.5 mt-1.5 mb-1.5 rounded-md shadow-sm overflow-hidden">
        <Ribbon
          onNewMessage={() => openCompose()}
          onReply={() => selectedMessage && handleReply(selectedMessage)}
          onReplyAll={() => selectedMessage && handleReply(selectedMessage, true)}
          onForward={() => selectedMessage && handleForward(selectedMessage)}
          onDelete={() => {
            if (!selectedMessage) return;
            const o = originOf(selectedMessage);
            requestDelete({ uid: selectedMessage.uid, accountId: o.accountId, folder: o.folder });
          }}
          onArchive={() => {
            if (!selectedMessage) return;
            const o = originOf(selectedMessage);
            archiveMutation.mutate({ uid: selectedMessage.uid, accountId: o.accountId, fromFolder: o.folder });
          }}
          onToggleFlag={() => {
            if (!selectedMessage) return;
            const o = originOf(selectedMessage);
            flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged, accountId: o.accountId, folder: o.folder });
          }}
          onMarkRead={() => {
            if (!selectedMessage) return;
            const o = originOf(selectedMessage);
            markReadMutation.mutate({ uid: selectedMessage.uid, isRead: true, accountId: o.accountId, folder: o.folder });
          }}
          onMarkUnread={() => {
            if (!selectedMessage) return;
            const o = originOf(selectedMessage);
            markReadMutation.mutate({ uid: selectedMessage.uid, isRead: false, accountId: o.accountId, folder: o.folder });
          }}
          onSync={handleSync}
          hasSelectedMessage={!!selectedMessage}
          isFlagged={!!selectedMessage?.flags?.flagged}
          isRead={!!selectedMessage?.flags?.seen}
          showFolderPane={showFolderPane}
          onToggleFolderPane={() => setShowFolderPane(!showFolderPane)}
          onPrint={handlePrint}
          onDownloadEml={handleDownloadEml}
          attachmentActionMode={attachmentActionMode}
          onChangeAttachmentActionMode={(mode) => attachmentModeMutation.mutate(mode)}
          isCollapsed={ribbonCollapsed}
          onToggleCollapse={toggleRibbonCollapsed}
          ribbonMode={ribbonMode}
          onChangeRibbonMode={handleChangeRibbonMode}
          tabMode={tabMode}
          maxTabs={maxTabs}
          onChangeTabMode={setTabMode}
          onChangeMaxTabs={setMaxTabs}
          isComposing={isComposing}
          composeEditorRef={composeEditorRef}
          onComposeAttachFiles={(files) => composeApiRef.current?.addFiles(files)}
          onOpenTemplatesPicker={isComposing ? () => setShowTemplatePicker(true) : undefined}
          onOpenTemplatesManager={() => setShowTemplatesManager(true)}
          onToggleEmojiPanel={() => {
            saveComposeSelection();
            setShowEmojiPanel(v => !v);
          }}
          isEmojiPanelOpen={showEmojiPanel}
          onToggleGifPanel={() => {
            saveComposeSelection();
            setShowGifPanel(v => !v);
          }}
          isGifPanelOpen={showGifPanel}
          accounts={accounts}
          onFavoritesChanged={() => {
            bumpPrefs();
            queryClient.invalidateQueries({ queryKey: ['virtual-messages'] });
          }}
          splitActive={splitActive}
          onSwapSplit={() => { if (splitTabId) switchTab(splitTabId); }}
          splitKeepFolderPane={splitKeepFolderPane}
          onToggleSplitKeepFolderPane={() => setSplitKeepFolderPane(v => !v)}
          splitKeepMessageList={splitKeepMessageList}
          onToggleSplitKeepMessageList={() => setSplitKeepMessageList(v => !v)}
          splitComposeReply={splitComposeReply}
          onToggleSplitComposeReply={() => setSplitComposeReply(v => !v)}
          readingPaneMode={readingPaneMode}
          onChangeReadingPaneMode={(m) => setReadingPaneMode(m)}
          listDensity={listDensity}
          onChangeListDensity={(d) => setListDensity(d)}
          listDisplayMode={listDisplayMode}
          onChangeListDisplayMode={(m) => setListDisplayMode(m)}
          mailDisplayMode={mailDisplayMode}
          onChangeMailDisplayMode={handleChangeMailDisplayMode}
          conversationGrouping={conversationGrouping}
          onChangeConversationGrouping={(m) => setConversationGrouping(m)}
          conversationShowAllInReadingPane={conversationShowAllInReadingPane}
          onToggleConversationShowAllInReadingPane={() => setConversationShowAllInReadingPane(v => !v)}
          onCategorize={(catId) => selectedMessage && handleCategorize(selectedMessage, catId)}
          onClearCategories={() => selectedMessage && handleClearCategories(selectedMessage)}
          onNewCategory={() => setCategoryCreateOpen(true)}
          onManageCategories={() => setCategoryManageOpen(true)}
          messageCategoryIds={selectedMessageCategoryIds}
          onOpenAutoResponder={autoResponderFeatureEnabled ? () => setAutoResponderOpen(true) : undefined}
          autoResponderEnabled={!!autoResponderStatus?.enabled}
          onOpenRules={() => setRulesOpen(true)}
        />
      </div>

      {/* Main content area — 3 blocks with gaps */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden min-h-0 gap-1 px-1.5 pb-1.5">
        {/* Folder pane block — collapsible + resizable */}
        {showFolderPane && !composeExpanded && (!splitActive || splitKeepFolderPane) && (!splitComposeActive || splitKeepFolderPane) && (
          <>
            <div
              data-pane="folders"
              className={`
                ${mobileView === 'folders' ? 'flex' : 'hidden'} md:flex
                flex-col flex-shrink-0 w-full bg-white rounded-md shadow-sm overflow-hidden
              `}
              style={{ width: window.innerWidth >= 768 ? folderWidth : undefined }}
            >
              <FolderPane
                accounts={accounts}
                selectedAccount={selectedAccount}
                folders={folders}
                selectedFolder={selectedFolder}
                onSelectAccount={selectAccount}
                onSelectFolderInAccount={handleSelectFolderInAccount}
                onCompose={() => openCompose()}
                onDropMessage={handleCrossAccountDrop}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
                onCopyFolderBetweenAccounts={handleCopyFolder}
                onMoveFolder={handleMoveFolder}
                onPreferencesChanged={() => {
                  // Accounts list is server-driven; a lightweight refresh to pick up local name overrides happens on next render.
                  queryClient.invalidateQueries({ queryKey: ['accounts'] });
                  bumpPrefs();
                  queryClient.invalidateQueries({ queryKey: ['virtual-messages'] });
                }}
                externalPrefsVersion={prefsVersion}
                onAfterSelect={() => {
                  if (typeof window !== 'undefined' && window.innerWidth < 768) {
                    setMobileView('list');
                  }
                  if (typeof window !== 'undefined' && window.innerWidth < 1280) {
                    setShowFolderPane(false);
                  }
                }}
              />
            </div>
            {/* Folder resize handle — desktop only */}
            <div
              className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize hover:bg-outlook-blue/30 active:bg-outlook-blue/50 transition-colors group relative"
              onMouseDown={handleFolderResizeStart}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          </>
        )}

        {/* Message list block — resizable on desktop */}
        {/* Mobile view */}
        <div className={`${mobileView === 'list' ? 'flex' : 'hidden'} md:hidden flex-col w-full h-full bg-white rounded-md shadow-sm overflow-hidden`}>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-outlook-border">
            <button
              onClick={() => { setShowFolderPane(true); setMobileView('folders'); }}
              className="text-outlook-text-secondary hover:text-outlook-text-primary p-1 rounded hover:bg-outlook-bg-hover"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="text-sm font-medium text-outlook-text-primary truncate">
              {virtualFolder === 'unified-inbox'
                ? 'Boîte de réception (Favoris)'
                : virtualFolder === 'unified-sent'
                  ? 'Éléments envoyés (Favoris)'
                  : selectedAccount ? getAccountDisplayName(selectedAccount) : ''}
            </span>
          </div>
          <MessageList
            messages={visibleMessages}
            selectedMessage={selectedMessage}
            loading={loadingMessages}
            onSelectMessage={handleSelectMessageMobile}
            onOpenCategoryPicker={(message, x, y) => setContextCategoryPicker({ message, x, y })}
            onToggleFlag={(uid, flagged, aId, fld) => { const o = resolveOrigin(uid, aId, fld); flagMutation.mutate({ uid, isFlagged: flagged, accountId: o.accountId, folder: o.folder }); }}
            onDelete={(uid, aId, fld) => { const o = resolveOrigin(uid, aId, fld); requestDelete({ uid, accountId: o.accountId, folder: o.folder }); }}
            folder={virtualFolder === 'unified-inbox' ? 'INBOX' : virtualFolder === 'unified-sent' ? 'Sent' : selectedFolder}
            onReply={(msg) => handleReply(msg)}
            onReplyAll={(msg) => handleReply(msg, true)}
            onForward={(msg) => handleForward(msg)}
            onMarkRead={(uid, isRead, aId, fld) => { const o = resolveOrigin(uid, aId, fld); markReadMutation.mutate({ uid, isRead, accountId: o.accountId, folder: o.folder }); }}
            onMove={(uid, toFolder, aId, fld) => { const o = resolveOrigin(uid, aId, fld); moveMutation.mutate({ uid, toFolder, accountId: o.accountId, fromFolder: o.folder }); }}
            onCopy={(uid, toFolder, aId, fld) => { const o = resolveOrigin(uid, aId, fld); copyMutation.mutate({ uid, toFolder, accountId: o.accountId, fromFolder: o.folder }); }}
            onArchive={(uid, aId, fld) => { const o = resolveOrigin(uid, aId, fld); archiveMutation.mutate({ uid, accountId: o.accountId, fromFolder: o.folder }); }}
            folders={folders}
            onToggleFolderPane={() => setShowFolderPane(!showFolderPane)}
            showFolderPane={showFolderPane}
            attachmentMinVisibleKb={attachmentMinVisibleKb}
            accountId={selectedAccount?.id}
            density={listDensity}
            listDisplayMode={effectiveListDisplayMode}
            conversationView={conversationView}
            conversationGrouping={conversationGrouping}
            swipeEnabled={swipePrefs.enabled}
            swipeLeftAction={swipePrefs.leftAction}
            swipeRightAction={swipePrefs.rightAction}
            onSwipe={handleSwipe}
            hasMore={hasMoreMessages}
            totalMessages={totalMessages}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            loadAllActive={loadAllActive}
            isVirtualFolder={!!virtualFolder}
            onFavoritesChanged={() => {
              bumpPrefs();
              queryClient.invalidateQueries({ queryKey: ['virtual-messages'] });
            }}
          />
        </div>

        {/* Desktop message list block — uses pixel width from resize handle */}
        {/* Wrapper: on mobile uses display:contents so children behave as direct flex children of containerRef (mobile layout unchanged). On desktop it becomes a flex container whose direction depends on readingPaneMode (right → row, bottom → column). */}
        <div className={`contents md:flex md:flex-1 md:min-w-0 md:min-h-0 md:gap-1 ${readingPaneMode === 'bottom' ? 'md:flex-col' : 'md:flex-row'}`}>
        {!composeExpanded && (!splitActive || splitKeepMessageList) && (!splitComposeActive || splitKeepMessageList) && (
          <>
            <div
              className={`hidden md:flex flex-col flex-shrink-0 bg-white rounded-md shadow-sm overflow-hidden ${readingPaneMode === 'bottom' ? 'w-full h-auto' : 'h-full'} ${readingPaneMode === 'hidden' ? 'md:flex-1 relative' : ''}`}
              style={
                readingPaneMode === 'bottom'
                  ? { height: listHeight, width: '100%' }
                  : readingPaneMode === 'hidden'
                    ? undefined
                    : { width: listWidth }
              }
            >
              {readingPaneMode === 'hidden' && selectedMessage ? (
                <>
                  <button
                    type="button"
                    onClick={() => selectMessage(null)}
                    className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded hover:bg-outlook-bg-hover text-outlook-text-secondary hover:text-outlook-text-primary bg-white/80 backdrop-blur-sm border border-outlook-border shadow-sm"
                    title="Fermer et revenir à la liste"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <MessageView
                    message={selectedMessage}
                    onReply={() => handleReply(selectedMessage)}
                    onReplyAll={() => handleReply(selectedMessage, true)}
                    onForward={() => handleForward(selectedMessage)}
                    onDelete={() => {
                      const o = originOf(selectedMessage);
                      requestDelete({ uid: selectedMessage.uid, accountId: o.accountId, folder: o.folder });
                    }}
                    onToggleFlag={() => {
                      const o = originOf(selectedMessage);
                      flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged, accountId: o.accountId, folder: o.folder });
                    }}
                    onMove={(folder) => {
                      const o = originOf(selectedMessage);
                      moveMutation.mutate({ uid: selectedMessage.uid, toFolder: folder, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    onArchive={() => {
                      const o = originOf(selectedMessage);
                      archiveMutation.mutate({ uid: selectedMessage.uid, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    attachmentMinVisibleKb={attachmentMinVisibleKb}
                    attachmentActionMode={attachmentActionMode}
                    mailDisplayMode={mailDisplayMode}
                    conversationMessages={conversationThread}
                    onSelectThreadMessage={(m) => handleSelectMessage(m)}
                  />
                </>
              ) : (
                <MessageList
                  messages={visibleMessages}
                  selectedMessage={selectedMessage}
                  loading={loadingMessages}
                  onSelectMessage={handleSelectMessageMobile}
                  onOpenCategoryPicker={(message, x, y) => setContextCategoryPicker({ message, x, y })}
                  onToggleFlag={(uid, flagged, aId, fld) => { const o = resolveOrigin(uid, aId, fld); flagMutation.mutate({ uid, isFlagged: flagged, accountId: o.accountId, folder: o.folder }); }}
                  onDelete={(uid, aId, fld) => { const o = resolveOrigin(uid, aId, fld); requestDelete({ uid, accountId: o.accountId, folder: o.folder }); }}
                  folder={virtualFolder === 'unified-inbox' ? 'INBOX' : virtualFolder === 'unified-sent' ? 'Sent' : selectedFolder}
                  onReply={(msg) => handleReply(msg)}
                  onReplyAll={(msg) => handleReply(msg, true)}
                  onForward={(msg) => handleForward(msg)}
                  onMarkRead={(uid, isRead, aId, fld) => { const o = resolveOrigin(uid, aId, fld); markReadMutation.mutate({ uid, isRead, accountId: o.accountId, folder: o.folder }); }}
                  onMove={(uid, toFolder, aId, fld) => { const o = resolveOrigin(uid, aId, fld); moveMutation.mutate({ uid, toFolder, accountId: o.accountId, fromFolder: o.folder }); }}
                  onCopy={(uid, toFolder, aId, fld) => { const o = resolveOrigin(uid, aId, fld); copyMutation.mutate({ uid, toFolder, accountId: o.accountId, fromFolder: o.folder }); }}
                  onArchive={(uid, aId, fld) => { const o = resolveOrigin(uid, aId, fld); archiveMutation.mutate({ uid, accountId: o.accountId, fromFolder: o.folder }); }}
                  folders={folders}
                  onToggleFolderPane={() => setShowFolderPane(!showFolderPane)}
                  showFolderPane={showFolderPane}
                  listWidth={listWidth}
                  attachmentMinVisibleKb={attachmentMinVisibleKb}
                  accountId={selectedAccount?.id}
                  density={listDensity}
                  listDisplayMode={effectiveListDisplayMode}
                  conversationView={conversationView}
                  conversationGrouping={conversationGrouping}
                  swipeEnabled={swipePrefs.enabled}
                  swipeLeftAction={swipePrefs.leftAction}
                  swipeRightAction={swipePrefs.rightAction}
                  onSwipe={handleSwipe}
                  hasMore={hasMoreMessages}
                  totalMessages={totalMessages}
                  loadingMore={loadingMore}
                  onLoadMore={handleLoadMore}
                  loadAllActive={loadAllActive}
                  isVirtualFolder={!!virtualFolder}
                  onFavoritesChanged={() => {
                    bumpPrefs();
                    queryClient.invalidateQueries({ queryKey: ['virtual-messages'] });
                  }}
                />
              )}
            </div>

            {/* Message list resize handle — desktop only; orientation depends on reading pane mode */}
            {readingPaneMode !== 'hidden' && (
              readingPaneMode === 'bottom' ? (
                <div
                  className="hidden md:flex h-1 flex-shrink-0 cursor-row-resize hover:bg-outlook-blue/30 active:bg-outlook-blue/50 transition-colors group relative"
                  onMouseDown={handleListHeightResizeStart}
                >
                  <div className="absolute inset-x-0 -top-1 -bottom-1" />
                </div>
              ) : (
                <div
                  className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize hover:bg-outlook-blue/30 active:bg-outlook-blue/50 transition-colors group relative"
                  onMouseDown={handleResizeStart}
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
              )
            )}
          </>
        )}

        {/* Right pane: message view + tab bar stacked vertically */}
        <div className={`
          ${mobileView === 'message' ? 'flex' : 'hidden'}
          ${readingPaneMode === 'hidden' ? 'md:hidden' : 'md:flex'}
          flex-col flex-1 min-w-0 overflow-hidden
        `}>
          {/* Compose + optional side panels (emoji, etc.) laid out horizontally */}
          <div className="flex-1 flex min-h-0 gap-1">
          {/* Reading / Compose block */}
          <div className={`flex-1 flex flex-col min-h-0 bg-white shadow-sm overflow-hidden ${openTabs.length >= 2 ? 'rounded-t-md' : 'rounded-md'}`}>
            {/* Mobile back button */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-outlook-border md:hidden">
              <button
                onClick={() => { setMobileView('list'); selectMessage(null); }}
                className="text-outlook-text-secondary hover:text-outlook-text-primary p-1 rounded hover:bg-outlook-bg-hover"
              >
                <ArrowLeft size={18} />
              </button>
              <span className="text-sm font-medium text-outlook-text-primary truncate">
                {selectedMessage?.subject || 'Retour'}
              </span>
            </div>

            {/* Inline compose — replaces the reading pane when composing */}
            {isComposing && composeData && composeAlongsideMessage ? (
              /* Side-by-side: original message on the left, compose on the right */
              <div ref={splitContainerRef} className="flex-1 flex min-h-0 min-w-0">
                <div className="h-full min-w-0 overflow-hidden relative" style={{ width: `${splitRatio * 100}%` }}>
                  {/* Close button — hide the original to give full width to compose */}
                  <button
                    type="button"
                    onClick={() => { setComposeAlongsideMessage(null); setComposeExpanded(true); }}
                    className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded hover:bg-outlook-bg-hover text-outlook-text-secondary hover:text-outlook-text bg-white/80 backdrop-blur-sm border border-outlook-border shadow-sm"
                    title="Masquer le mail d'origine (écriture pleine largeur)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <MessageView
                    message={composeAlongsideMessage}
                    onReply={() => handleReply(composeAlongsideMessage)}
                    onReplyAll={() => handleReply(composeAlongsideMessage, true)}
                    onForward={() => handleForward(composeAlongsideMessage)}
                    onDelete={() => {
                      const o = originOf(composeAlongsideMessage);
                      requestDelete({ uid: composeAlongsideMessage.uid, accountId: o.accountId, folder: o.folder });
                    }}
                    onToggleFlag={() => {
                      const o = originOf(composeAlongsideMessage);
                      flagMutation.mutate({ uid: composeAlongsideMessage.uid, isFlagged: !composeAlongsideMessage.flags.flagged, accountId: o.accountId, folder: o.folder });
                    }}
                    onMove={(folder) => {
                      const o = originOf(composeAlongsideMessage);
                      moveMutation.mutate({ uid: composeAlongsideMessage.uid, toFolder: folder, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    onArchive={() => {
                      const o = originOf(composeAlongsideMessage);
                      archiveMutation.mutate({ uid: composeAlongsideMessage.uid, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    attachmentMinVisibleKb={attachmentMinVisibleKb}
                    attachmentActionMode={attachmentActionMode}
                    mailDisplayMode={mailDisplayMode}
                  />
                </div>
                {/* Split resize handle */}
                <div
                  className="w-1 flex-shrink-0 cursor-col-resize hover:bg-outlook-blue/30 active:bg-outlook-blue/50 transition-colors relative"
                  onMouseDown={handleSplitResizeStart}
                  title="Glisser pour redimensionner"
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
                <div className="h-full flex-1 min-w-0 overflow-hidden border-l border-outlook-border">
                  <ComposeModal
                    initialData={composeData}
                    accounts={accounts}
                    selectedAccountId={selectedAccount?.id}
                    onSend={(data) => sendMutation.mutate(data)}
                    onClose={() => { setComposeExpanded(false); setComposeAlongsideMessage(null); closeCompose(); }}
                    isSending={sendMutation.isPending}
                    inline
                    externalEditorRef={composeEditorRef}
                    hideInlineToolbar
                    apiRef={composeApiRef}
                    isExpanded={composeExpanded}
                    onToggleExpand={() => setComposeExpanded(v => !v)}
                  />
                </div>
              </div>
            ) : isComposing && composeData ? (
              <ComposeModal
                initialData={composeData}
                accounts={accounts}
                selectedAccountId={selectedAccount?.id}
                onSend={(data) => sendMutation.mutate(data)}
                onClose={() => { setComposeExpanded(false); setComposeAlongsideMessage(null); closeCompose(); }}
                isSending={sendMutation.isPending}
                inline
                externalEditorRef={composeEditorRef}
                hideInlineToolbar
                apiRef={composeApiRef}
                isExpanded={composeExpanded}
                onToggleExpand={() => setComposeExpanded(v => !v)}
              />
            ) : splitActive ? (
              <div ref={splitContainerRef} className="flex-1 flex min-h-0 min-w-0">
                <div className="h-full min-w-0 overflow-hidden" style={{ width: `${splitRatio * 100}%` }}>
                  <MessageView
                    message={selectedMessage}
                    onReply={() => selectedMessage && handleReply(selectedMessage)}
                    onReplyAll={() => selectedMessage && handleReply(selectedMessage, true)}
                    onForward={() => selectedMessage && handleForward(selectedMessage)}
                    onDelete={() => {
                      if (!selectedMessage) return;
                      const o = originOf(selectedMessage);
                      requestDelete({ uid: selectedMessage.uid, accountId: o.accountId, folder: o.folder });
                    }}
                    onToggleFlag={() => {
                      if (!selectedMessage) return;
                      const o = originOf(selectedMessage);
                      flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged, accountId: o.accountId, folder: o.folder });
                    }}
                    onMove={(folder) => {
                      if (!selectedMessage) return;
                      const o = originOf(selectedMessage);
                      moveMutation.mutate({ uid: selectedMessage.uid, toFolder: folder, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    onArchive={() => {
                      if (!selectedMessage) return;
                      const o = originOf(selectedMessage);
                      archiveMutation.mutate({ uid: selectedMessage.uid, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    attachmentMinVisibleKb={attachmentMinVisibleKb}
                    attachmentActionMode={attachmentActionMode}
                    mailDisplayMode={mailDisplayMode}
                    conversationMessages={conversationThread}
                    onSelectThreadMessage={(m) => handleSelectMessage(m)}
                  />
                </div>
                {/* Split resize handle */}
                <div
                  className="w-1 flex-shrink-0 cursor-col-resize hover:bg-outlook-blue/30 active:bg-outlook-blue/50 transition-colors relative"
                  onMouseDown={handleSplitResizeStart}
                  title="Glisser pour redimensionner"
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
                <div className="h-full flex-1 min-w-0 overflow-hidden border-l border-outlook-border">
                  <MessageView
                    message={splitMessage!}
                    onReply={() => handleReply(splitMessage!)}
                    onReplyAll={() => handleReply(splitMessage!, true)}
                    onForward={() => handleForward(splitMessage!)}
                    onDelete={() => {
                      const o = originOf(splitMessage!);
                      requestDelete({ uid: splitMessage!.uid, accountId: o.accountId, folder: o.folder });
                    }}
                    onToggleFlag={() => {
                      const o = originOf(splitMessage!);
                      flagMutation.mutate({ uid: splitMessage!.uid, isFlagged: !splitMessage!.flags.flagged, accountId: o.accountId, folder: o.folder });
                    }}
                    onMove={(folder) => {
                      const o = originOf(splitMessage!);
                      moveMutation.mutate({ uid: splitMessage!.uid, toFolder: folder, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    onArchive={() => {
                      const o = originOf(splitMessage!);
                      archiveMutation.mutate({ uid: splitMessage!.uid, accountId: o.accountId, fromFolder: o.folder });
                    }}
                    attachmentMinVisibleKb={attachmentMinVisibleKb}
                    attachmentActionMode={attachmentActionMode}
                    mailDisplayMode={mailDisplayMode}
                  />
                </div>
              </div>
            ) : (
              <MessageView
                message={selectedMessage}
                onReply={() => selectedMessage && handleReply(selectedMessage)}
                onReplyAll={() => selectedMessage && handleReply(selectedMessage, true)}
                onForward={() => selectedMessage && handleForward(selectedMessage)}
                onDelete={() => {
                  if (!selectedMessage) return;
                  const o = originOf(selectedMessage);
                  requestDelete({ uid: selectedMessage.uid, accountId: o.accountId, folder: o.folder });
                }}
                onToggleFlag={() => {
                  if (!selectedMessage) return;
                  const o = originOf(selectedMessage);
                  flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged, accountId: o.accountId, folder: o.folder });
                }}
                onMove={(folder) => {
                  if (!selectedMessage) return;
                  const o = originOf(selectedMessage);
                  moveMutation.mutate({ uid: selectedMessage.uid, toFolder: folder, accountId: o.accountId, fromFolder: o.folder });
                }}
                onArchive={() => {
                  if (!selectedMessage) return;
                  const o = originOf(selectedMessage);
                  archiveMutation.mutate({ uid: selectedMessage.uid, accountId: o.accountId, fromFolder: o.folder });
                }}
                attachmentMinVisibleKb={attachmentMinVisibleKb}
                attachmentActionMode={attachmentActionMode}
                mailDisplayMode={mailDisplayMode}
                conversationMessages={conversationThread}
                onSelectThreadMessage={(m) => handleSelectMessage(m)}
              />
            )}
          </div>

          {/* Emoji side panel — only while composing */}
          {isComposing && (
            <EmojiPanel
              open={showEmojiPanel}
              onClose={() => setShowEmojiPanel(false)}
              onSelect={insertEmojiIntoCompose}
            />
          )}
          {/* GIF side panel — only while composing */}
          {isComposing && (
            <GifPanel
              open={showGifPanel}
              onClose={() => setShowGifPanel(false)}
              onSelect={insertGifIntoCompose}
            />
          )}

          {/* Mail templates picker — only while composing */}
          {showTemplatePicker && isComposing && (
            <MailTemplatePickerModal
              onClose={() => setShowTemplatePicker(false)}
              onOpenManager={() => { setShowTemplatePicker(false); setShowTemplatesManager(true); }}
              onInsert={(tpl) => {
                composeApiRef.current?.applyTemplate(tpl.subject, tpl.bodyHtml);
              }}
            />
          )}
          {/* Mail templates manager */}
          {showTemplatesManager && (
            <MailTemplatesManagerModal onClose={() => setShowTemplatesManager(false)} />
          )}
          </div>

          {/* Tab bar block — visible only when >= 2 tabs */}
          {openTabs.length >= 2 && (
            <div className="flex-shrink-0 bg-outlook-bg-primary flex items-center h-9 px-1 gap-0.5 overflow-x-auto mt-1 rounded-b-md shadow-sm">
              {openTabs.map(tab => (
                <div
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTabContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
                  }}
                  className={`outlook-tab flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium max-w-48 cursor-pointer select-none group
                    ${tab.id === activeTabId
                      ? tab.type === 'compose' ? 'outlook-tab-compose' : 'outlook-tab-active'
                      : tab.id === splitTabId
                        ? 'bg-outlook-blue/10 text-outlook-blue ring-1 ring-outlook-blue/30'
                        : 'hover:bg-outlook-bg-hover text-outlook-text-secondary'
                    }`}
                >
                  {tab.type === 'compose' ? (
                    <Pencil size={11} className="flex-shrink-0" />
                  ) : (
                    <Mail size={11} className="flex-shrink-0" />
                  )}
                  <span className="truncate">{tab.label || '(Sans objet)'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className="text-outlook-text-disabled hover:text-outlook-danger ml-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Tab context menu (right-click on a bottom tab) */}
      {tabContextMenu && (() => {
        const tab = openTabs.find(t => t.id === tabContextMenu.tabId);
        if (!tab) return null;
        const isActive = tab.id === activeTabId;
        const isSplit = tab.id === splitTabId;
        const canSplit = tab.type === 'message' && !isActive && !isComposing;
        const items: ContextMenuItem[] = [];
        if (canSplit) {
          items.push({
            label: isSplit ? 'Retirer de la vue côte à côte' : 'Afficher côte à côte',
            icon: <Columns2 size={14} />,
            onClick: () => setSplitTabId(isSplit ? null : tab.id),
          });
        }
        if (splitTabId && !canSplit) {
          items.push({
            label: 'Fermer la vue côte à côte',
            icon: <Columns2 size={14} />,
            onClick: () => setSplitTabId(null),
          });
        }
        items.push({
          label: 'Fermer l\'onglet',
          icon: <X size={14} />,
          onClick: () => closeTab(tab.id),
          danger: true,
        });
        return (
          <ContextMenu
            x={tabContextMenu.x}
            y={tabContextMenu.y}
            items={items}
            onClose={() => setTabContextMenu(null)}
          />
        );
      })()}

      {/* Category create modal */}
      {categoryCreateOpen && (
        <CategoryEditorModal
          mode="create"
          onClose={() => setCategoryCreateOpen(false)}
        />
      )}

      {/* Category edit modal */}
      {categoryEditTarget && (
        <CategoryEditorModal
          mode="edit"
          initial={categoryEditTarget}
          onClose={() => setCategoryEditTarget(null)}
        />
      )}

      {/* Category management modal */}
      {categoryManageOpen && (
        <CategoryManageModal
          onClose={() => setCategoryManageOpen(false)}
          onCreate={() => setCategoryCreateOpen(true)}
          onEdit={(cat) => setCategoryEditTarget(cat)}
        />
      )}

      {/* Auto-responder (vacation responder) modal triggered from the ribbon. */}
      {autoResponderOpen && (
        <AutoResponderModal
          onClose={() => setAutoResponderOpen(false)}
          accountId={selectedAccount?.id}
          accounts={accounts}
        />
      )}

      {/* Outlook-style rules modal triggered from the ribbon. */}
      {rulesOpen && (
        <RulesModal
          onClose={() => setRulesOpen(false)}
          defaultAccountId={selectedAccount?.id || null}
        />
      )}

      {/* Category picker triggered from a message context menu */}
      {contextCategoryPicker && (() => {
        const o = originOf(contextCategoryPicker.message);
        const assigned = getMessageCategories(contextCategoryPicker.message, o.accountId, o.folder);
        return (
          <CategoryPicker
            top={contextCategoryPicker.y}
            left={contextCategoryPicker.x}
            assigned={assigned}
            onToggle={(id) => handleCategorize(contextCategoryPicker.message, id)}
            onClear={() => { handleClearCategories(contextCategoryPicker.message); setContextCategoryPicker(null); }}
            onCreate={() => { setContextCategoryPicker(null); setCategoryCreateOpen(true); }}
            onManage={() => { setContextCategoryPicker(null); setCategoryManageOpen(true); }}
            onClose={() => setContextCategoryPicker(null)}
          />
        );
      })()}

      {/* Delete confirmation dialog — bypassable via the "Afficher" ribbon tab. */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title={deleteConfirm?.title || ''}
        description={deleteConfirm?.description}
        confirmLabel={deleteConfirm?.permanent ? 'Supprimer définitivement' : 'Déplacer dans la corbeille'}
        cancelLabel="Annuler"
        danger={!!deleteConfirm?.permanent}
        icon={deleteConfirm?.permanent ? 'warning' : 'trash'}
        onConfirm={() => deleteConfirm?.onConfirm()}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* Folder picker triggered by a swipe → move/copy when no default folder
          is configured for the account (or when the configured folder is gone). */}
      <FolderPickerDialog
        open={!!folderPicker}
        title={folderPicker?.title || ''}
        description={folderPicker?.description}
        confirmLabel={folderPicker?.confirmLabel || 'Sélectionner'}
        folders={folderPicker?.folders || []}
        accountId={folderPicker?.accountId}
        initialPath={folderPicker?.initialPath ?? null}
        onCreate={createFolderAwait}
        onPick={(path) => {
          if (!folderPicker) return;
          // Persist as default if the user hasn't configured one yet.
          if (folderPicker.rememberAs === 'move' && !getSwipeMoveTarget(folderPicker.accountId)) {
            setSwipeMoveTarget(folderPicker.accountId, path);
            window.dispatchEvent(new Event('mail-swipe-prefs-changed'));
          } else if (folderPicker.rememberAs === 'copy' && !getSwipeCopyTarget(folderPicker.accountId)) {
            setSwipeCopyTarget(folderPicker.accountId, path);
            window.dispatchEvent(new Event('mail-swipe-prefs-changed'));
          }
          folderPicker.onPick(path);
          setFolderPicker(null);
        }}
        onCancel={() => setFolderPicker(null)}
      />
      {/* Floating action button — mobile/tablet only.
       *  Visible whenever the user is browsing the folder/list views, even if
       *  a draft compose tab is open in the background — tapping it then
       *  brings them back to the in-progress draft instead of dropping it. */}
      {!composeExpanded && mobileView !== 'message' && (
        <FloatingActionButton
          onClick={() => {
            setMobileView('message');
            if (!isComposing) openCompose();
          }}
          label="Nouveau message"
          icon={<Plus size={24} />}
        />
      )}
    </div>
  );
}
