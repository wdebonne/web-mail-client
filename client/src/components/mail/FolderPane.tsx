import {
  Inbox, Send, FileText, Trash2, Archive, Star, AlertTriangle,
  ChevronDown, ChevronRight, Plus, FolderIcon
} from 'lucide-react';
import { useState } from 'react';
import { MailAccount, MailFolder } from '../../types';

interface FolderPaneProps {
  accounts: MailAccount[];
  selectedAccount: MailAccount | null;
  folders: MailFolder[];
  selectedFolder: string;
  onSelectAccount: (account: MailAccount) => void;
  onSelectFolder: (folder: string) => void;
  onCompose: () => void;
}

const FOLDER_ICONS: Record<string, any> = {
  '\\Inbox': Inbox,
  '\\Sent': Send,
  '\\Drafts': FileText,
  '\\Trash': Trash2,
  '\\Junk': AlertTriangle,
  '\\Archive': Archive,
  '\\Flagged': Star,
};

const FOLDER_LABELS: Record<string, string> = {
  'INBOX': 'Boîte de réception',
  'Sent': 'Éléments envoyés',
  'Drafts': 'Brouillons',
  'Trash': 'Éléments supprimés',
  'Junk': 'Courrier indésirable',
  'Archive': 'Archives',
  'INBOX.Sent': 'Éléments envoyés',
  'INBOX.Drafts': 'Brouillons',
  'INBOX.Trash': 'Éléments supprimés',
  'INBOX.Junk': 'Courrier indésirable',
};

export default function FolderPane({
  accounts, selectedAccount, folders, selectedFolder,
  onSelectAccount, onSelectFolder, onCompose,
}: FolderPaneProps) {
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set(accounts.map(a => a.id)));
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const toggleAccount = (id: string) => {
    const next = new Set(expandedAccounts);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedAccounts(next);
  };

  const getFolderIcon = (folder: MailFolder) => {
    if (folder.specialUse) {
      return FOLDER_ICONS[folder.specialUse] || FolderIcon;
    }
    const name = folder.name.toLowerCase();
    if (name === 'inbox') return Inbox;
    if (name.includes('sent') || name.includes('envoy')) return Send;
    if (name.includes('draft') || name.includes('brouillon')) return FileText;
    if (name.includes('trash') || name.includes('corbeille') || name.includes('supprim')) return Trash2;
    if (name.includes('junk') || name.includes('spam') || name.includes('indésirable')) return AlertTriangle;
    if (name.includes('archive')) return Archive;
    return FolderIcon;
  };

  const getFolderLabel = (folder: MailFolder) => {
    return FOLDER_LABELS[folder.path] || FOLDER_LABELS[folder.name] || folder.name;
  };

  return (
    <div className="w-64 bg-outlook-bg-primary border-r border-outlook-border flex flex-col flex-shrink-0 overflow-hidden">
      {/* New message button */}
      <div className="p-3">
        <button
          onClick={onCompose}
          className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-sm"
        >
          <Plus size={16} />
          Nouveau message
        </button>
      </div>

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto px-1">
        {accounts.map((account) => (
          <div key={account.id} className="mb-1">
            {/* Account header */}
            <button
              onClick={() => {
                onSelectAccount(account);
                toggleAccount(account.id);
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-outlook-bg-hover transition-colors
                ${selectedAccount?.id === account.id ? 'font-semibold text-outlook-text-primary' : 'text-outlook-text-secondary'}`}
            >
              {expandedAccounts.has(account.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: account.color }}
              />
              <span className="truncate">{account.assigned_display_name || account.name}</span>
            </button>

            {/* Folders */}
            {expandedAccounts.has(account.id) && selectedAccount?.id === account.id && (
              <div className="ml-4">
                {/* Default folder order */}
                {sortFolders(folders).map((folder) => {
                  const Icon = getFolderIcon(folder);
                  const isSelected = folder.path === selectedFolder;
                  
                  return (
                    <button
                      key={folder.path}
                      onClick={() => onSelectFolder(folder.path)}
                      className={`w-full flex items-center gap-2 px-3 py-1 text-sm rounded transition-colors
                        ${isSelected
                          ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary'
                          : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
                        }`}
                    >
                      <Icon size={14} className={isSelected ? 'text-outlook-blue' : ''} />
                      <span className="truncate">{getFolderLabel(folder)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {accounts.length === 0 && (
          <div className="text-center text-outlook-text-disabled text-sm py-8 px-4">
            Aucun compte configuré.<br />
            Allez dans Paramètres pour ajouter un compte.
          </div>
        )}
      </div>
    </div>
  );
}

function sortFolders(folders: MailFolder[]): MailFolder[] {
  const priority: Record<string, number> = {
    '\\Inbox': 0,
    '\\Drafts': 1,
    '\\Sent': 2,
    '\\Junk': 3,
    '\\Trash': 4,
    '\\Archive': 5,
  };

  return [...folders].sort((a, b) => {
    const pa = a.specialUse ? (priority[a.specialUse] ?? 10) : (a.name === 'INBOX' ? 0 : 10);
    const pb = b.specialUse ? (priority[b.specialUse] ?? 10) : (b.name === 'INBOX' ? 0 : 10);
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}
