import {
  Inbox, Send, FileText, Trash2, Archive, Star, AlertTriangle,
  ChevronDown, ChevronRight, Plus, FolderIcon, FolderPlus, Pencil, Trash
} from 'lucide-react';
import { useState } from 'react';
import { MailAccount, MailFolder } from '../../types';
import ContextMenu, { ContextMenuItem } from '../ui/ContextMenu';

interface FolderPaneProps {
  accounts: MailAccount[];
  selectedAccount: MailAccount | null;
  folders: MailFolder[];
  selectedFolder: string;
  onSelectAccount: (account: MailAccount) => void;
  onSelectFolder: (folder: string) => void;
  onCompose: () => void;
  onDropMessage?: (uid: number, toFolder: string) => void;
  onCreateFolder?: (parentPath?: string) => void;
  onRenameFolder?: (folderPath: string, currentName: string) => void;
  onDeleteFolder?: (folderPath: string) => void;
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
  onSelectAccount, onSelectFolder, onCompose, onDropMessage,
  onCreateFolder, onRenameFolder, onDeleteFolder,
}: FolderPaneProps) {
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set(accounts.map(a => a.id)));
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder?: MailFolder } | null>(null);

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
    <div className="w-full bg-outlook-bg-primary border-r border-outlook-border flex flex-col flex-shrink-0 overflow-hidden">
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
                  const isDragOver = dragOverFolder === folder.path;
                  
                  return (
                    <button
                      key={folder.path}
                      onClick={() => onSelectFolder(folder.path)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, folder });
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverFolder(folder.path);
                      }}
                      onDragLeave={() => setDragOverFolder(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverFolder(null);
                        const uid = parseInt(e.dataTransfer.getData('text/x-mail-uid'), 10);
                        if (uid && onDropMessage && folder.path !== selectedFolder) {
                          onDropMessage(uid, folder.path);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-1 text-sm rounded transition-colors
                        ${isDragOver
                          ? 'bg-outlook-blue/10 ring-2 ring-outlook-blue ring-inset'
                          : isSelected
                            ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary'
                            : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
                        }`}
                    >
                      <Icon size={14} className={isSelected || isDragOver ? 'text-outlook-blue' : ''} />
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

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={buildFolderContextMenu(contextMenu.folder)}
        />
      )}
    </div>
  );

  function isSpecialFolder(folder?: MailFolder): boolean {
    if (!folder) return false;
    if (folder.specialUse) return true;
    const name = folder.name.toLowerCase();
    return ['inbox', 'sent', 'drafts', 'trash', 'junk', 'spam', 'archive'].some(s => name.includes(s));
  }

  function buildFolderContextMenu(folder?: MailFolder): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    if (onCreateFolder) {
      items.push({
        label: 'Nouveau dossier',
        icon: <FolderPlus size={14} />,
        onClick: () => onCreateFolder(folder?.path),
      });
    }

    if (folder) {
      const special = isSpecialFolder(folder);

      if (onRenameFolder && !special) {
        items.push({
          label: 'Renommer le dossier',
          icon: <Pencil size={14} />,
          onClick: () => onRenameFolder(folder.path, folder.name),
        });
      }

      if (onDeleteFolder && !special) {
        items.push({ label: '', separator: true, onClick: () => {} });
        items.push({
          label: 'Supprimer le dossier',
          icon: <Trash size={14} />,
          onClick: () => onDeleteFolder(folder.path),
          danger: true,
        });
      }
    }

    return items;
  }
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
