import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMailStore, ComposeData } from '../stores/mailStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { offlineDB } from '../pwa/offlineDB';
import FolderPane from '../components/mail/FolderPane';
import MessageList from '../components/mail/MessageList';
import MessageView from '../components/mail/MessageView';
import ComposeModal from '../components/mail/ComposeModal';
import toast from 'react-hot-toast';

export default function MailPage() {
  const isOnline = useNetworkStatus();
  const queryClient = useQueryClient();
  const {
    accounts, selectedAccount, selectedFolder, messages, selectedMessage,
    isComposing, composeData,
    setAccounts, selectAccount, setFolders, selectFolder,
    setMessages, selectMessage, openCompose, closeCompose,
    updateMessageFlags, removeMessage,
  } = useMailStore();

  // Load accounts
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: api.getAccounts,
    staleTime: 1000 * 60 * 10,
  });

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
    selectMessage(message);
    
    // Auto mark as read
    if (!message.flags?.seen && selectedAccount) {
      markReadMutation.mutate({ uid: message.uid, isRead: true });
    }

    // Load full message
    if (selectedAccount && isOnline) {
      try {
        const full = await api.getMessage(selectedAccount.id, message.uid, selectedFolder);
        selectMessage(full);
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

  return (
    <div className="h-full flex">
      {/* Folder pane */}
      <FolderPane
        accounts={accounts}
        selectedAccount={selectedAccount}
        folders={useMailStore(s => s.folders)}
        selectedFolder={selectedFolder}
        onSelectAccount={selectAccount}
        onSelectFolder={selectFolder}
        onCompose={() => openCompose()}
      />

      {/* Message list pane */}
      <MessageList
        messages={messages}
        selectedMessage={selectedMessage}
        loading={loadingMessages}
        onSelectMessage={handleSelectMessage}
        onToggleFlag={(uid, flagged) => flagMutation.mutate({ uid, isFlagged: flagged })}
        onDelete={(uid) => deleteMutation.mutate(uid)}
        folder={selectedFolder}
      />

      {/* Message reading pane */}
      <MessageView
        message={selectedMessage}
        onReply={() => selectedMessage && handleReply(selectedMessage)}
        onReplyAll={() => selectedMessage && handleReply(selectedMessage, true)}
        onForward={() => selectedMessage && handleForward(selectedMessage)}
        onDelete={() => selectedMessage && deleteMutation.mutate(selectedMessage.uid)}
        onToggleFlag={() => selectedMessage && flagMutation.mutate({ uid: selectedMessage.uid, isFlagged: !selectedMessage.flags.flagged })}
        onMove={(folder) => selectedMessage && moveMutation.mutate({ uid: selectedMessage.uid, toFolder: folder })}
      />

      {/* Compose modal */}
      {isComposing && composeData && (
        <ComposeModal
          initialData={composeData}
          accounts={accounts}
          selectedAccountId={selectedAccount?.id}
          onSend={(data) => sendMutation.mutate(data)}
          onClose={closeCompose}
          isSending={sendMutation.isPending}
        />
      )}
    </div>
  );
}
