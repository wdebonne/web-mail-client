import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMailStore, ComposeData } from '../stores/mailStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { offlineDB } from '../pwa/offlineDB';
import FolderPane from '../components/mail/FolderPane';
import MessageList from '../components/mail/MessageList';
import MessageView from '../components/mail/MessageView';
import ComposeModal from '../components/mail/ComposeModal';
import Ribbon from '../components/mail/Ribbon';
import toast from 'react-hot-toast';
import { ArrowLeft, PanelLeftOpen, PanelLeftClose, Mail, X, Pencil } from 'lucide-react';

export default function MailPage() {
  const isOnline = useNetworkStatus();
  const queryClient = useQueryClient();
  const {
    accounts, selectedAccount, selectedFolder, messages, selectedMessage,
    isComposing, composeData,
    setAccounts, selectAccount, setFolders, selectFolder,
    setMessages, selectMessage, openCompose, closeCompose,
    updateMessageFlags, removeMessage,
    openTabs, activeTabId, openMessageTab, switchTab, closeTab,
    tabMode, maxTabs, setTabMode, setMaxTabs,
  } = useMailStore();

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

  useEffect(() => {
    if (accountsData) {
      setAccounts(accountsData);
    }
  }, [accountsData]);

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

  // Load messages
  const { data: messagesData, isLoading: loadingMessages } = useQuery({
    queryKey: ['messages', selectedAccount?.id, selectedFolder],
    queryFn: async () => {
      if (!selectedAccount) return { messages: [], total: 0, page: 1 };
      try {
        const result = await api.getMessages(selectedAccount.id, selectedFolder);
        // Cache for offline
        if (result.messages) {
          await offlineDB.cacheEmails(result.messages.map((m: any) => ({
            ...m,
            id: `${selectedAccount.id}-${m.uid}`,
            accountId: selectedAccount.id,
            folder: selectedFolder,
          })));
        }
        return result;
      } catch {
        // Fallback to offline cache
        const cached = await offlineDB.getEmails(selectedAccount.id, selectedFolder);
        return { messages: cached, total: cached.length, page: 1 };
      }
    },
    enabled: !!selectedAccount,
    refetchInterval: isOnline ? 30000 : false,
  });

  useEffect(() => {
    if (messagesData) {
      setMessages(messagesData.messages || [], messagesData.total || 0, messagesData.page || 1);
    }
  }, [messagesData]);

  // Mark as read mutation
  const markReadMutation = useMutation({
    mutationFn: ({ uid, isRead }: { uid: number; isRead: boolean }) =>
      selectedAccount ? api.markAsRead(selectedAccount.id, uid, isRead, selectedFolder) : Promise.resolve(),
    onSuccess: (_, { uid, isRead }) => {
      updateMessageFlags(uid, { seen: isRead });
    },
  });

  // Flag mutation
  const flagMutation = useMutation({
    mutationFn: ({ uid, isFlagged }: { uid: number; isFlagged: boolean }) =>
      selectedAccount ? api.toggleFlag(selectedAccount.id, uid, isFlagged, selectedFolder) : Promise.resolve(),
    onSuccess: (_, { uid, isFlagged }) => {
      updateMessageFlags(uid, { flagged: isFlagged });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (uid: number) =>
      selectedAccount ? api.deleteMessage(selectedAccount.id, uid, selectedFolder) : Promise.resolve(),
    onSuccess: (_, uid) => {
      removeMessage(uid);
      toast.success('Message supprimé');
    },
  });

  // Move mutation
  const moveMutation = useMutation({
    mutationFn: ({ uid, toFolder }: { uid: number; toFolder: string }) =>
      selectedAccount ? api.moveMessage(selectedAccount.id, uid, selectedFolder, toFolder) : Promise.resolve(),
    onSuccess: (_, { uid }) => {
      removeMessage(uid);
      toast.success('Message déplacé');
    },
  });

  // Copy mutation
  const copyMutation = useMutation({
    mutationFn: ({ uid, toFolder }: { uid: number; toFolder: string }) =>
      selectedAccount ? api.copyMessage(selectedAccount.id, uid, selectedFolder, toFolder) : Promise.resolve(),
    onSuccess: () => {
      toast.success('Message copié');
    },
  });

  // Folder management mutations
  const createFolderMutation = useMutation({
    mutationFn: (path: string) =>
      selectedAccount ? api.createFolder(selectedAccount.id, path) : Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', selectedAccount?.id] });
      toast.success('Dossier créé');
    },
    onError: (error: any) => toast.error(`Erreur: ${error.message}`),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      selectedAccount ? api.renameFolder(selectedAccount.id, oldPath, newPath) : Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', selectedAccount?.id] });
      toast.success('Dossier renommé');
    },
    onError: (error: any) => toast.error(`Erreur: ${error.message}`),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (path: string) =>
      selectedAccount ? api.deleteFolder(selectedAccount.id, path) : Promise.resolve(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders', selectedAccount?.id] });
      toast.success('Dossier supprimé');
    },
    onError: (error: any) => toast.error(`Erreur: ${error.message}`),
  });

  // Folder context menu handlers
  const handleCreateFolder = (parentPath?: string) => {
    const name = prompt('Nom du nouveau dossier :');
    if (!name?.trim()) return;
    const sanitized = name.trim().replace(/[\\\/]/g, '');
    const path = parentPath ? `${parentPath}.${sanitized}` : sanitized;
    createFolderMutation.mutate(path);
  };

  const handleRenameFolder = (folderPath: string, currentName: string) => {
    const newName = prompt('Nouveau nom du dossier :', currentName);
    if (!newName?.trim() || newName.trim() === currentName) return;
    const sanitized = newName.trim().replace(/[\\\/]/g, '');
    const parts = folderPath.split('.');
    parts[parts.length - 1] = sanitized;
    const newPath = parts.join('.');
    renameFolderMutation.mutate({ oldPath: folderPath, newPath });
  };

  const handleDeleteFolder = (folderPath: string) => {
    if (!confirm(`Supprimer le dossier "${folderPath}" et tout son contenu ?`)) return;
    deleteFolderMutation.mutate(folderPath);
  };

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: async (data: any) => {
      if (isOnline) {
        return api.sendMail(data);
      } else {
        await offlineDB.addToOutbox(data);
        return { success: true, offline: true };
      }
    },
    onSuccess: (result: any) => {
      closeCompose();
      if (result?.offline) {
        toast.success('Message enregistré dans la boîte d\'envoi (envoi au retour de la connexion)');
      } else {
        toast.success('Message envoyé');
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
    
    // Auto mark as read
    if (!message.flags?.seen && selectedAccount) {
      markReadMutation.mutate({ uid: message.uid, isRead: true });
    }

    // Load full message
    if (selectedAccount && isOnline) {
      try {
        const full = await api.getMessage(selectedAccount.id, message.uid, selectedFolder);
        openMessageTab(full);
      } catch {}
    }
  };

  const handleReply = (message: any, replyAll: boolean = false) => {
    const replyTo = message.from ? [message.from] : [];
    const replyCC = replyAll && message.cc ? message.cc : [];
    
    openCompose({
      to: replyTo,
      cc: replyCC,
      subject: message.subject?.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      bodyHtml: `<br/><br/><div style="border-left:2px solid #0078D4;padding-left:12px;margin-left:0;color:#605E5C">
        <p><b>De :</b> ${message.from?.name || message.from?.address}<br/>
        <b>Envoyé :</b> ${new Date(message.date).toLocaleString('fr-FR')}<br/>
        <b>À :</b> ${message.to?.map((t: any) => t.name || t.address).join('; ')}<br/>
        <b>Objet :</b> ${message.subject}</p>
        ${message.bodyHtml || message.bodyText || ''}
      </div>`,
      inReplyTo: message.messageId,
      references: message.headers?.references,
      accountId: selectedAccount?.id,
    });
  };

  const handleForward = (message: any) => {
    openCompose({
      to: [],
      subject: message.subject?.startsWith('Fwd:') ? message.subject : `Fwd: ${message.subject}`,
      bodyHtml: `<br/><br/><div style="border-top:1px solid #E1DFDD;padding-top:12px;color:#605E5C">
        <p><b>---------- Message transféré ----------</b><br/>
        <b>De :</b> ${message.from?.name || message.from?.address}<br/>
        <b>Date :</b> ${new Date(message.date).toLocaleString('fr-FR')}<br/>
        <b>Objet :</b> ${message.subject}<br/>
        <b>À :</b> ${message.to?.map((t: any) => t.name || t.address).join('; ')}</p>
        ${message.bodyHtml || message.bodyText || ''}
      </div>`,
      accountId: selectedAccount?.id,
    });
  };

  // Mobile view state: 'folders' | 'list' | 'message'
  const [mobileView, setMobileView] = useState<'folders' | 'list' | 'message'>('list');
  const [showFolderPane, setShowFolderPane] = useState(true);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(() => {
    return localStorage.getItem('ribbonCollapsed') === 'true';
  });
  const [ribbonMode, setRibbonMode] = useState<'classic' | 'simplified'>(() => {
    return (localStorage.getItem('ribbonMode') as 'classic' | 'simplified') || 'classic';
  });

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

  // When selecting a folder on mobile, switch to list view
  const handleSelectFolder = (folder: string) => {
    selectFolder(folder);
    setMobileView('list');
  };

  // When selecting a message on mobile, switch to message view
  const handleSelectMessageMobile = async (message: any) => {
    await handleSelectMessage(message);
    setMobileView('message');
  };

  // Handle drag & drop move
  const handleDropMessage = (uid: number, toFolder: string) => {
    moveMutation.mutate({ uid, toFolder });
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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-outlook-bg-tertiary">
      {/* Ribbon toolbar block */}
      <div className="flex-shrink-0 mx-1.5 mt-1.5 mb-1.5 rounded-md shadow-sm overflow-hidden">
        <Ribbon
          onNewMessage={() => openCompose()}
          onReply={() => selectedMessage && handleReply(selectedMessage)}
          onReplyAll={() => selectedMessage && handleReply(selectedMessage, true)}
          onForward={() => selectedMessage && handleForward(selectedMessage)}
          onDelete={() => selectedMessage && deleteMutation.mutate(selectedMessage.uid)}
          onArchive={() => selectedMessage && moveMutation.mutate({ uid: selectedMessage.uid, toFolder: 'Archive' })}
          onToggleFlag={() => selectedMessage && flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged })}
          onMarkRead={() => selectedMessage && markReadMutation.mutate({ uid: selectedMessage.uid, isRead: true })}
          onMarkUnread={() => selectedMessage && markReadMutation.mutate({ uid: selectedMessage.uid, isRead: false })}
          onSync={handleSync}
          hasSelectedMessage={!!selectedMessage}
          isFlagged={!!selectedMessage?.flags?.flagged}
          isRead={!!selectedMessage?.flags?.seen}
          showFolderPane={showFolderPane}
          onToggleFolderPane={() => setShowFolderPane(!showFolderPane)}
          onPrint={handlePrint}
          onDownloadEml={handleDownloadEml}
          isCollapsed={ribbonCollapsed}
          onToggleCollapse={toggleRibbonCollapsed}
          ribbonMode={ribbonMode}
          onChangeRibbonMode={handleChangeRibbonMode}
          tabMode={tabMode}
          maxTabs={maxTabs}
          onChangeTabMode={setTabMode}
          onChangeMaxTabs={setMaxTabs}
        />
      </div>

      {/* Main content area — 3 blocks with gaps */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden min-h-0 gap-1 px-1.5 pb-1.5">
        {/* Folder pane block — collapsible + resizable */}
        {showFolderPane && (
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
                folders={useMailStore(s => s.folders)}
                selectedFolder={selectedFolder}
                onSelectAccount={selectAccount}
                onSelectFolder={handleSelectFolder}
                onCompose={() => openCompose()}
                onDropMessage={handleDropMessage}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={handleRenameFolder}
                onDeleteFolder={handleDeleteFolder}
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
              onClick={() => setMobileView('folders')}
              className="text-outlook-text-secondary hover:text-outlook-text-primary p-1 rounded hover:bg-outlook-bg-hover"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="text-sm font-medium text-outlook-text-primary truncate">
              {selectedAccount?.assigned_display_name || selectedAccount?.name}
            </span>
          </div>
          <MessageList
            messages={messages}
            selectedMessage={selectedMessage}
            loading={loadingMessages}
            onSelectMessage={handleSelectMessageMobile}
            onToggleFlag={(uid, flagged) => flagMutation.mutate({ uid, isFlagged: flagged })}
            onDelete={(uid) => deleteMutation.mutate(uid)}
            folder={selectedFolder}
            onReply={(msg) => handleReply(msg)}
            onReplyAll={(msg) => handleReply(msg, true)}
            onForward={(msg) => handleForward(msg)}
            onMarkRead={(uid, isRead) => markReadMutation.mutate({ uid, isRead })}
            onMove={(uid, toFolder) => moveMutation.mutate({ uid, toFolder })}
            onCopy={(uid, toFolder) => copyMutation.mutate({ uid, toFolder })}
            folders={useMailStore(s => s.folders)}
            onToggleFolderPane={() => setShowFolderPane(!showFolderPane)}
            showFolderPane={showFolderPane}
          />
        </div>

        {/* Desktop message list block — uses pixel width from resize handle */}
        <div
          className="hidden md:flex flex-col flex-shrink-0 h-full bg-white rounded-md shadow-sm overflow-hidden"
          style={{ width: listWidth }}
        >
          <MessageList
            messages={messages}
            selectedMessage={selectedMessage}
            loading={loadingMessages}
            onSelectMessage={handleSelectMessageMobile}
            onToggleFlag={(uid, flagged) => flagMutation.mutate({ uid, isFlagged: flagged })}
            onDelete={(uid) => deleteMutation.mutate(uid)}
            folder={selectedFolder}
            onReply={(msg) => handleReply(msg)}
            onReplyAll={(msg) => handleReply(msg, true)}
            onForward={(msg) => handleForward(msg)}
            onMarkRead={(uid, isRead) => markReadMutation.mutate({ uid, isRead })}
            onMove={(uid, toFolder) => moveMutation.mutate({ uid, toFolder })}
            onCopy={(uid, toFolder) => copyMutation.mutate({ uid, toFolder })}
            folders={useMailStore(s => s.folders)}
            onToggleFolderPane={() => setShowFolderPane(!showFolderPane)}
            showFolderPane={showFolderPane}
            listWidth={listWidth}
          />
        </div>

        {/* Message list resize handle — desktop only */}
        <div
          className="hidden md:flex w-1 flex-shrink-0 cursor-col-resize hover:bg-outlook-blue/30 active:bg-outlook-blue/50 transition-colors group relative"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Right pane: message view + tab bar stacked vertically */}
        <div className={`
          ${mobileView === 'message' ? 'flex' : 'hidden'} md:flex
          flex-col flex-1 min-w-0 overflow-hidden
        `}>
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
            {isComposing && composeData ? (
              <ComposeModal
                initialData={composeData}
                accounts={accounts}
                selectedAccountId={selectedAccount?.id}
                onSend={(data) => sendMutation.mutate(data)}
                onClose={closeCompose}
                isSending={sendMutation.isPending}
                inline
              />
            ) : (
              <MessageView
                message={selectedMessage}
                onReply={() => selectedMessage && handleReply(selectedMessage)}
                onReplyAll={() => selectedMessage && handleReply(selectedMessage, true)}
                onForward={() => selectedMessage && handleForward(selectedMessage)}
                onDelete={() => selectedMessage && deleteMutation.mutate(selectedMessage.uid)}
                onToggleFlag={() => selectedMessage && flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged })}
                onMove={(folder) => selectedMessage && moveMutation.mutate({ uid: selectedMessage.uid, toFolder: folder })}
                attachmentMinVisibleKb={attachmentMinVisibleKb}
              />
            )}
          </div>

          {/* Tab bar block — visible only when >= 2 tabs */}
          {openTabs.length >= 2 && (
            <div className="flex-shrink-0 bg-outlook-bg-primary flex items-center h-9 px-1 gap-0.5 overflow-x-auto mt-1 rounded-b-md shadow-sm">
              {openTabs.map(tab => (
                <div
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={`outlook-tab flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium max-w-48 cursor-pointer select-none group
                    ${tab.id === activeTabId
                      ? tab.type === 'compose' ? 'outlook-tab-compose' : 'outlook-tab-active'
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
  );
}
