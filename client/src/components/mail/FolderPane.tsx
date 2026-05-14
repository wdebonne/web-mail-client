import {
  Inbox, Send, FileText, Trash2, Archive, Star, AlertTriangle,
  ChevronDown, ChevronRight, Plus, FolderIcon, FolderPlus, Pencil,
  Trash, Copy, GripVertical, RotateCcw, Tag, Palette, MailCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { api } from '../../api';
import { MailAccount, MailFolder } from '../../types';
import ContextMenu, { ContextMenuItem } from '../ui/ContextMenu';
import {
  getCategories, subscribeCategories, MailCategory,
} from '../../utils/categories';
import { BASE_COLORS } from '../../utils/colorUtils';
import {
  getAccountDisplayName,
  setAccountDisplayOverride,
  getAccountColor,
  setAccountColorOverride,
  setAccountOrder,
  sortAccounts,
  setFolderOrder,
  sortFolders,
  getExpandedAccounts,
  setExpandedAccounts as persistExpanded,
  getFavoriteFolders,
  isFavoriteFolder,
  toggleFavoriteFolder,
  removeFavoriteFolder,
  setFavoriteFolders,
  getUnifiedAccountIds,
  getUnifiedInboxEnabled,
  getUnifiedSentEnabled,
  getFavoritesExpanded,
  setFavoritesExpanded as persistFavoritesExpanded,
  findInboxFolderPath,
  findSentFolderPath,
  FavoriteFolder,
  getFolderPaneFontSize,
  FOLDER_PANE_FONT_SIZE_PX,
  FOLDER_PANE_FONT_SIZE_CHANGED_EVENT,
  getUnreadIndicatorPrefs,
  UNREAD_INDICATORS_CHANGED_EVENT,
  type UnreadIndicatorPrefs,
} from '../../utils/mailPreferences';
import { useMailStore, VirtualFolder } from '../../stores/mailStore';

type DropPosition = 'before' | 'after';

interface FolderPaneProps {
  accounts: MailAccount[];
  selectedAccount: MailAccount | null;
  folders: MailFolder[];
  selectedFolder: string;
  onSelectAccount: (account: MailAccount) => void;
  onSelectFolderInAccount: (account: MailAccount, folder: string) => void;
  onCompose: () => void;
  onDropMessage?: (
    payload: { uid: number; srcAccountId: string; srcFolder: string },
    dest: { account: MailAccount; folder: string },
    mode: 'move' | 'copy',
  ) => void;
  onCreateFolder?: (accountId: string, parentPath?: string) => void;
  onRenameFolder?: (accountId: string, folderPath: string, currentName: string) => void;
  onDeleteFolder?: (accountId: string, folderPath: string) => void;
  onCopyFolderBetweenAccounts?: (
    src: { accountId: string; path: string; name: string },
    dest: { accountId: string; path: string },
  ) => void;
  onMoveFolder?: (accountId: string, oldPath: string, newPath: string) => void;
  onMarkFolderAllRead?: (accountId: string, folderPath: string) => void;
  onPreferencesChanged?: () => void;
  /** Called after any folder/virtual-folder selection so the parent can close the
   *  pane on mobile/tablet without duplicating the breakpoint logic in here. */
  onAfterSelect?: () => void;
  /** External signal that mail preferences (favorites, unified selection…) changed elsewhere. */
  externalPrefsVersion?: number;
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

function isSpecialFolder(folder?: MailFolder): boolean {
  if (!folder) return false;
  if (folder.specialUse) return true;
  const name = folder.name.toLowerCase();
  return ['inbox', 'sent', 'drafts', 'trash', 'junk', 'spam', 'archive'].some((s) => name.includes(s));
}

function getFolderIcon(folder: MailFolder) {
  if (folder.specialUse) return FOLDER_ICONS[folder.specialUse] || FolderIcon;
  const name = folder.name.toLowerCase();
  if (name === 'inbox') return Inbox;
  if (name.includes('sent') || name.includes('envoy')) return Send;
  if (name.includes('draft') || name.includes('brouillon')) return FileText;
  if (name.includes('trash') || name.includes('corbeille') || name.includes('supprim')) return Trash2;
  if (name.includes('junk') || name.includes('spam') || name.includes('indésirable')) return AlertTriangle;
  if (name.includes('archive')) return Archive;
  return FolderIcon;
}

function getFolderLabel(folder: MailFolder) {
  const mapped = FOLDER_LABELS[folder.path] || FOLDER_LABELS[folder.name];
  if (mapped) return mapped;
  // Always display only the leaf segment, so nested folders show their short name
  // (e.g. "test sous" instead of "test.test sous" or "INBOX.test.test sous").
  const delim = folder.delimiter || '.';
  const pathSegments = folder.path ? folder.path.split(delim) : [];
  const pathLeaf = pathSegments[pathSegments.length - 1];
  const candidate = pathLeaf || folder.name || folder.path;
  const nameSegments = candidate.split(delim);
  return nameSegments[nameSegments.length - 1] || candidate;
}

const DT_MSG = 'application/x-mail-message';
const DT_FOLDER = 'application/x-mail-folder';
const DT_FOLDER_REORDER = 'application/x-mail-folder-reorder';
const DT_ACCOUNT_REORDER = 'application/x-mail-account-reorder';

export default function FolderPane({
  accounts, selectedAccount, folders, selectedFolder,
  onSelectAccount, onSelectFolderInAccount, onCompose,
  onDropMessage, onCreateFolder, onRenameFolder, onDeleteFolder,
  onCopyFolderBetweenAccounts, onMoveFolder, onMarkFolderAllRead, onPreferencesChanged, onAfterSelect,
  externalPrefsVersion,
}: FolderPaneProps) {
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(() => {
    const persisted = getExpandedAccounts();
    return new Set(persisted.length ? persisted : accounts.map((a) => a.id));
  });
  const [favoritesExpanded, setFavoritesExpandedState] = useState<boolean>(getFavoritesExpanded());
  const [prefsVersion, setPrefsVersion] = useState(0);
  const triggerRerender = () => setPrefsVersion((n) => n + 1);
  const queryClient = useQueryClient();
  const virtualFolder = useMailStore((s) => s.virtualFolder);
  const selectVirtualFolder = useMailStore((s) => s.selectVirtualFolder);
  const categoryFilter = useMailStore((s) => s.categoryFilter);
  const setCategoryFilter = useMailStore((s) => s.setCategoryFilter);

  // User-configurable font size for the whole folder tree (Settings → Apparence
  // on mobile/tablet, "Afficher" ribbon on desktop). The selected size is
  // applied as inline `fontSize` on the scroll container; descendant labels
  // use `text-[length:inherit]` so they pick it up automatically.
  const [folderFontSize, setFolderFontSize] = useState(getFolderPaneFontSize);
  useEffect(() => {
    const handler = () => setFolderFontSize(getFolderPaneFontSize());
    window.addEventListener(FOLDER_PANE_FONT_SIZE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FOLDER_PANE_FONT_SIZE_CHANGED_EVENT, handler);
  }, []);
  const folderFontSizePx = FOLDER_PANE_FONT_SIZE_PX[folderFontSize];

  // Unread indicators preferences (count / bold / dot + scope) — kept in sync
  // through a global event so the ribbon and the pane stay aligned.
  const [unreadPrefs, setUnreadPrefs] = useState<UnreadIndicatorPrefs>(() => getUnreadIndicatorPrefs());
  useEffect(() => {
    const handler = () => setUnreadPrefs(getUnreadIndicatorPrefs());
    window.addEventListener(UNREAD_INDICATORS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(UNREAD_INDICATORS_CHANGED_EVENT, handler);
  }, []);

  const [accountContextMenu, setAccountContextMenu] = useState<
    { x: number; y: number; account: MailAccount } | null
  >(null);

  const [mailColorPickerPopover, setMailColorPickerPopover] = useState<{
    x: number; y: number; account: MailAccount;
  } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<
    { x: number; y: number; account: MailAccount; folder: MailFolder } | null
  >(null);
  const [favoriteContextMenu, setFavoriteContextMenu] = useState<
    { x: number; y: number; fav: FavoriteFolder } | null
  >(null);
  const [accountDropIndicator, setAccountDropIndicator] = useState<
    { id: string; position: DropPosition } | null
  >(null);

  useEffect(() => {
    persistExpanded(Array.from(expandedAccounts));
  }, [expandedAccounts]);

  useEffect(() => {
    persistFavoritesExpanded(favoritesExpanded);
  }, [favoritesExpanded]);

  // Ensure newly added accounts appear expanded by default (if none were persisted yet)
  useEffect(() => {
    setExpandedAccounts((prev) => {
      if (prev.size > 0) return prev;
      return new Set(accounts.map((a) => a.id));
    });
  }, [accounts]);

  const orderedAccounts = useMemo(() => sortAccounts(accounts), [accounts, prefsVersion]);

  const toggleAccount = (id: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAccountDragStart = (e: React.DragEvent, account: MailAccount) => {
    e.dataTransfer.setData(DT_ACCOUNT_REORDER, account.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAccountDragOver = (e: React.DragEvent, account: MailAccount) => {
    const types = e.dataTransfer.types;
    if (types.includes(DT_ACCOUNT_REORDER)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const position: DropPosition = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      setAccountDropIndicator({ id: account.id, position });
      return;
    }
    if (types.includes(DT_FOLDER_REORDER)) {
      // Allow un-nesting a folder by dropping it on its account header
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleAccountDrop = (e: React.DragEvent, targetAccount: MailAccount) => {
    // Folder un-nest to root
    const folderRaw = e.dataTransfer.getData(DT_FOLDER_REORDER);
    if (folderRaw) {
      try {
        const payload = JSON.parse(folderRaw) as { accountId: string; path: string };
        if (payload.accountId === targetAccount.id && onMoveFolder) {
          e.preventDefault();
          e.stopPropagation();
          // Read folders from React Query cache so it works for any account (not only the active one).
          const acctFolders =
            (queryClient.getQueryData<MailFolder[]>(['folders', targetAccount.id]) as MailFolder[] | undefined) ||
            (targetAccount.id === selectedAccount?.id ? (folders as MailFolder[]) : []);
          const srcFolder = acctFolders.find((f) => f.path === payload.path);
          const delimiter = srcFolder?.delimiter || '.';
          const parts = payload.path.split(delimiter);
          if (parts.length < 2) {
            setAccountDropIndicator(null);
            return; // already at root
          }
          const baseName = parts[parts.length - 1];
          // Preserve personal namespace root (e.g. "INBOX" on Courier/o2switch),
          // otherwise IMAP refuses to create a mailbox outside the personal namespace.
          const hasNamespaceRoot = acctFolders.some(
            (f) => f.path === parts[0] && f.delimiter === delimiter,
          );
          const newPath = hasNamespaceRoot ? `${parts[0]}${delimiter}${baseName}` : baseName;
          if (newPath && newPath !== payload.path) {
            onMoveFolder(targetAccount.id, payload.path, newPath);
          }
          setAccountDropIndicator(null);
          return;
        }
      } catch {}
    }

    const draggedId = e.dataTransfer.getData(DT_ACCOUNT_REORDER);
    if (!draggedId || draggedId === targetAccount.id) {
      setAccountDropIndicator(null);
      return;
    }
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: DropPosition = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';

    const baseOrder = orderedAccounts.map((a) => a.id);
    const withoutDragged = baseOrder.filter((id) => id !== draggedId);
    const targetIdx = withoutDragged.indexOf(targetAccount.id);
    const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
    withoutDragged.splice(insertAt, 0, draggedId);
    setAccountOrder(withoutDragged);
    setAccountDropIndicator(null);
    triggerRerender();
    onPreferencesChanged?.();
  };

  return (
    <div className="w-full h-full min-h-0 bg-white flex flex-col flex-shrink-0 overflow-hidden">
      {/*
        Bouton "Nouveau message" : masqué sur mobile/tablette (`< md`) car le
        bouton flottant (FAB) en bas de page assure déjà cette fonction et
        permet d'éviter le doublon en haut du volet.
      */}
      <div className="hidden md:block p-3">
        <button
          onClick={onCompose}
          className="w-full bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md py-3 md:py-2 px-4 text-[15px] md:text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-sm min-h-[44px] md:min-h-0"
        >
          <Plus size={18} className="md:w-4 md:h-4" />
          Nouveau message
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto px-1 pb-4 pt-2 md:pt-0"
        style={{ fontSize: `${folderFontSizePx}px` }}
      >
        <FavoritesSection
          accounts={orderedAccounts}
          expanded={favoritesExpanded}
          onToggleExpanded={() => setFavoritesExpandedState((v) => !v)}
          virtualFolder={virtualFolder}
          selectedAccountId={selectedAccount?.id || null}
          selectedFolder={selectedFolder}
          onSelectVirtual={(v) => { selectVirtualFolder(v); onAfterSelect?.(); }}
          onSelectFavorite={(fav) => {
            const account = accounts.find((a) => a.id === fav.accountId);
            if (account) onSelectFolderInAccount(account, fav.path);
            onAfterSelect?.();
          }}
          onFavoriteContextMenu={(fav, x, y) => setFavoriteContextMenu({ x, y, fav })}
          categoryFilter={categoryFilter}
          onSelectCategoryFilter={(id) => setCategoryFilter(id)}
          prefsVersion={prefsVersion + (externalPrefsVersion || 0)}
          unreadPrefs={unreadPrefs}
          onChanged={() => {
            triggerRerender();
            onPreferencesChanged?.();
          }}
        />

        {orderedAccounts.map((account) => {
          const isExpanded = expandedAccounts.has(account.id);
          const indicator = accountDropIndicator?.id === account.id ? accountDropIndicator.position : null;
          return (
            <div
              key={account.id}
              className="mb-2 md:mb-1 relative"
              onDragOver={(e) => handleAccountDragOver(e, account)}
              onDragLeave={(e) => {
                const related = e.relatedTarget as Node | null;
                if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
                  setAccountDropIndicator((prev) => (prev?.id === account.id ? null : prev));
                }
              }}
              onDrop={(e) => handleAccountDrop(e, account)}
            >
              {indicator === 'before' && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-outlook-blue pointer-events-none z-10" />
              )}
              {indicator === 'after' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-outlook-blue pointer-events-none z-10" />
              )}

              <div
                draggable
                onDragStart={(e) => handleAccountDragStart(e, account)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setAccountContextMenu({ x: e.clientX, y: e.clientY, account });
                }}
                onClick={() => {
                  onSelectAccount(account);
                  if (!expandedAccounts.has(account.id)) toggleAccount(account.id);
                }}
                className={`group flex items-center gap-1.5 md:gap-1 px-2 py-2.5 md:py-1.5 min-h-[44px] md:min-h-0 text-[length:inherit] rounded hover:bg-outlook-bg-hover transition-colors cursor-pointer
                  ${selectedAccount?.id === account.id ? 'font-semibold text-outlook-text-primary' : 'text-outlook-text-secondary'}`}
              >
                <GripVertical
                  size={12}
                  className="hidden md:block text-outlook-text-disabled opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  aria-label="Glisser pour réordonner"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAccount(account.id);
                  }}
                  className="flex-shrink-0 p-1.5 md:p-0.5 -m-1 md:m-0 rounded hover:bg-outlook-bg-selected"
                  aria-label={isExpanded ? 'Réduire' : 'Développer'}
                >
                  {isExpanded ? <ChevronDown size={16} className="md:w-3 md:h-3" /> : <ChevronRight size={16} className="md:w-3 md:h-3" />}
                </button>
                <div
                  className="w-2.5 h-2.5 md:w-2 md:h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: getAccountColor(account) }}
                />
                <span className="truncate flex-1 text-left">{getAccountDisplayName(account)}</span>
              </div>

              {isExpanded && (
                <AccountFolders
                  account={account}
                  selectedAccountId={selectedAccount?.id || null}
                  selectedFolder={selectedFolder}
                  externalFolders={selectedAccount?.id === account.id ? folders : undefined}
                  onSelectFolder={(folder) => onSelectFolderInAccount(account, folder.path)}
                  onContextMenu={(folder, x, y) => setFolderContextMenu({ x, y, account, folder })}
                  onDropMessage={onDropMessage}
                  onCopyFolder={onCopyFolderBetweenAccounts}
                  onMoveFolder={onMoveFolder}
                  onFolderOrderChanged={triggerRerender}
                  prefsVersion={prefsVersion}
                  unreadPrefs={unreadPrefs}
                />
              )}
            </div>
          );
        })}

        {accounts.length === 0 && (
          <div className="text-center text-outlook-text-disabled text-sm py-8 px-4">
            Aucun compte configuré.<br />
            Allez dans Paramètres pour ajouter un compte.
          </div>
        )}
      </div>

      {accountContextMenu && (
        <ContextMenu
          x={accountContextMenu.x}
          y={accountContextMenu.y}
          onClose={() => setAccountContextMenu(null)}
          items={buildAccountContextMenu(accountContextMenu.account, onCreateFolder, () => {
            triggerRerender();
            onPreferencesChanged?.();
          }, (account) => setMailColorPickerPopover({ account, x: accountContextMenu.x, y: accountContextMenu.y }))}
        />
      )}

      {mailColorPickerPopover && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setMailColorPickerPopover(null)} />
          <div
            className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg p-2"
            style={{ top: mailColorPickerPopover.y + 4, left: mailColorPickerPopover.x + 4 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap gap-1">
              {BASE_COLORS.map(col => (
                <button
                  key={col.value}
                  onClick={() => {
                    setAccountColorOverride(mailColorPickerPopover.account.id, col.value);
                    triggerRerender();
                    onPreferencesChanged?.();
                    setMailColorPickerPopover(null);
                  }}
                  className={`w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform ${getAccountColor(mailColorPickerPopover.account) === col.value ? 'border-outlook-text-primary' : 'border-transparent'}`}
                  style={{ backgroundColor: col.value }}
                  title={col.label}
                />
              ))}
              {(() => {
                const cur = getAccountColor(mailColorPickerPopover.account);
                return cur && !BASE_COLORS.some(c => c.value === cur) ? (
                  <div className="w-6 h-6 rounded-full border-2 border-outlook-text-primary" style={{ backgroundColor: cur }} />
                ) : null;
              })()}
              <div className="relative w-6 h-6">
                <div className="w-6 h-6 rounded-full border-2 border-dashed border-outlook-border flex items-center justify-center text-outlook-text-secondary pointer-events-none">
                  <span className="text-sm leading-none select-none">+</span>
                </div>
                <input
                  type="color"
                  defaultValue={getAccountColor(mailColorPickerPopover.account) ?? '#0078D4'}
                  onChange={(e) => {
                    setAccountColorOverride(mailColorPickerPopover.account.id, e.target.value);
                    triggerRerender();
                    onPreferencesChanged?.();
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-full"
                  style={{ border: 'none', padding: 0 }}
                  title="Couleur personnalisée"
                />
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}

      {folderContextMenu && (
        <ContextMenu
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          onClose={() => setFolderContextMenu(null)}
          items={buildFolderContextMenu(
            folderContextMenu.account,
            folderContextMenu.folder,
            accounts,
            onCreateFolder,
            onRenameFolder,
            onDeleteFolder,
            onCopyFolderBetweenAccounts,
            triggerRerender,
            onMarkFolderAllRead,
          )}
        />
      )}

      {favoriteContextMenu && (
        <ContextMenu
          x={favoriteContextMenu.x}
          y={favoriteContextMenu.y}
          onClose={() => setFavoriteContextMenu(null)}
          items={[
            {
              label: 'Retirer des favoris',
              icon: <Star size={14} />,
              onClick: () => {
                removeFavoriteFolder(favoriteContextMenu.fav.accountId, favoriteContextMenu.fav.path);
                triggerRerender();
              },
            },
          ]}
        />
      )}
    </div>
  );
}

interface AccountFoldersProps {
  account: MailAccount;
  selectedAccountId: string | null;
  selectedFolder: string;
  externalFolders?: MailFolder[];
  onSelectFolder: (folder: MailFolder) => void;
  onContextMenu: (folder: MailFolder, x: number, y: number) => void;
  onDropMessage?: FolderPaneProps['onDropMessage'];
  onCopyFolder?: FolderPaneProps['onCopyFolderBetweenAccounts'];
  onMoveFolder?: FolderPaneProps['onMoveFolder'];
  onFolderOrderChanged?: () => void;
  prefsVersion?: number;
  unreadPrefs: UnreadIndicatorPrefs;
}

function AccountFolders({
  account, selectedAccountId, selectedFolder, externalFolders,
  onSelectFolder, onContextMenu, onDropMessage, onCopyFolder, onMoveFolder, onFolderOrderChanged, prefsVersion,
  unreadPrefs,
}: AccountFoldersProps) {
  // When a virtual folder (Favoris > Boîte de réception unifiée, etc.) is
  // active, we must NOT highlight any regular folder in the per-account tree —
  // the previous selectedAccount/selectedFolder still live in the store but
  // they no longer represent the user's current location.
  const virtualFolder = useMailStore((s) => s.virtualFolder);
  const { data } = useQuery({
    queryKey: ['folders', account.id],
    queryFn: () => api.getFolders(account.id),
    enabled: !externalFolders,
    staleTime: 1000 * 60 * 2,
  });

  const folders: MailFolder[] = (externalFolders || (data as MailFolder[]) || []) as MailFolder[];
  const ordered = useMemo(() => sortFolders(folders, account.id), [folders, account.id, prefsVersion]);

  // Per-folder STATUS (unseen / total / recent) — only fetched when the user
  // actually wants to see unread indicators. Cached server-side for 20 s.
  const wantStatus =
    unreadPrefs.showCount || unreadPrefs.showBold || unreadPrefs.showDot;
  const { data: statusData } = useQuery({
    queryKey: ['folder-status', account.id],
    queryFn: () => api.getFoldersStatus(account.id),
    enabled: wantStatus,
    staleTime: 30_000,
    refetchInterval: (q) => {
      // Server returned `failed:true` (auth issue, IMAP down) — back off to
      // avoid hammering. The server cache is already 5 minutes in that case.
      const d: any = q.state.data;
      if (d?.failed) return false;
      return 60_000;
    },
    refetchOnWindowFocus: true,
    retry: false,
  });
  const statusByPath = (statusData?.folders || {}) as Record<
    string,
    { messages: number; unseen: number; recent: number }
  >;
  const inboxPath = useMemo(() => findInboxFolderPath(folders), [folders]);

  const isFolderInScope = (folderPath: string): boolean => {
    switch (unreadPrefs.scope) {
      case 'inbox-only':
      case 'inbox-and-favorites':
        return folderPath === inboxPath;
      case 'favorites-only':
        return false;
      case 'all-folders':
      default:
        return true;
    }
  };

  const [dragOver, setDragOver] = useState<string | null>(null);
  const [folderDropIndicator, setFolderDropIndicator] = useState<
    { path: string; position: DropPosition } | null
  >(null);

  const handleFolderDragStart = (e: React.DragEvent, folder: MailFolder) => {
    e.dataTransfer.setData(
      DT_FOLDER_REORDER,
      JSON.stringify({ accountId: account.id, path: folder.path }),
    );
    e.dataTransfer.setData(
      DT_FOLDER,
      JSON.stringify({ accountId: account.id, path: folder.path, name: folder.name }),
    );
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleFolderDragOver = (e: React.DragEvent, folder: MailFolder) => {
    const types = e.dataTransfer.types;
    if (types.includes(DT_FOLDER_REORDER)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const edgeZone = Math.min(6, rect.height * 0.25);
      const fromTop = e.clientY - rect.top;
      const fromBottom = rect.bottom - e.clientY;
      // Shift forces reorder; otherwise drop on body (center) = nest, edges = reorder
      const wantReorder = e.shiftKey || fromTop < edgeZone || fromBottom < edgeZone;
      if (wantReorder) {
        const position: DropPosition = fromTop < rect.height / 2 ? 'before' : 'after';
        setFolderDropIndicator({ path: folder.path, position });
        setDragOver(null);
      } else {
        setDragOver(folder.path);
        setFolderDropIndicator(null);
      }
      return;
    }
    if (types.includes(DT_FOLDER)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(folder.path);
      setFolderDropIndicator(null);
      return;
    }
    if (types.includes(DT_MSG) || types.includes('text/x-mail-uid')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
      setDragOver(folder.path);
      setFolderDropIndicator(null);
    }
  };

  const handleFolderDrop = (e: React.DragEvent, folder: MailFolder) => {
    e.preventDefault();

    const reorderRaw = e.dataTransfer.getData(DT_FOLDER_REORDER);
    if (reorderRaw) {
      try {
        const payload = JSON.parse(reorderRaw) as { accountId: string; path: string };
        if (payload.accountId === account.id && payload.path !== folder.path) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const edgeZone = Math.min(6, rect.height * 0.25);
          const fromTop = e.clientY - rect.top;
          const fromBottom = rect.bottom - e.clientY;
          const wantReorder = e.shiftKey || fromTop < edgeZone || fromBottom < edgeZone;
          if (!wantReorder && onMoveFolder) {
            // Nest: make dragged folder a child of this folder
            const srcFolder = folders.find((f) => f.path === payload.path);
            const d = srcFolder?.delimiter || folder.delimiter || '.';
            const idx = payload.path.lastIndexOf(d);
            const baseName = idx >= 0 ? payload.path.slice(idx + d.length) : payload.path;
            // Prevent moving a folder into itself or its own descendant
            if (!folder.path.startsWith(payload.path + d) && folder.path !== payload.path) {
              const newPath = `${folder.path}${d}${baseName}`;
              if (newPath !== payload.path) {
                onMoveFolder(account.id, payload.path, newPath);
              }
            }
          } else {
            const position: DropPosition = fromTop < rect.height / 2 ? 'before' : 'after';
            const currentOrder = ordered.map((f) => f.path);
            const withoutDragged = currentOrder.filter((p) => p !== payload.path);
            const targetIdx = withoutDragged.indexOf(folder.path);
            const insertAt = position === 'before' ? targetIdx : targetIdx + 1;
            withoutDragged.splice(insertAt, 0, payload.path);
            setFolderOrder(account.id, withoutDragged);
            onFolderOrderChanged?.();
          }
        } else if (payload.accountId !== account.id && onCopyFolder) {
          const folderPayload = e.dataTransfer.getData(DT_FOLDER);
          if (folderPayload) {
            const src = JSON.parse(folderPayload);
            const d = folder.delimiter || '.';
            onCopyFolder(
              { accountId: src.accountId, path: src.path, name: src.name },
              { accountId: account.id, path: `${folder.path}${d}${src.name}` },
            );
          }
        }
      } catch {}
      setFolderDropIndicator(null);
      setDragOver(null);
      return;
    }

    const folderRaw = e.dataTransfer.getData(DT_FOLDER);
    if (folderRaw) {
      try {
        const src = JSON.parse(folderRaw);
        if (src.accountId !== account.id && onCopyFolder) {
          const d = folder.delimiter || '.';
          onCopyFolder(
            { accountId: src.accountId, path: src.path, name: src.name },
            { accountId: account.id, path: `${folder.path}${d}${src.name}` },
          );
        }
      } catch {}
      setDragOver(null);
      return;
    }

    const msgRaw = e.dataTransfer.getData(DT_MSG);
    const legacyUid = e.dataTransfer.getData('text/x-mail-uid');
    if (msgRaw || legacyUid) {
      try {
        let payload: { uid: number; srcAccountId: string; srcFolder: string } | null = null;
        if (msgRaw) {
          payload = JSON.parse(msgRaw);
        } else if (legacyUid && selectedAccountId) {
          payload = {
            uid: parseInt(legacyUid, 10),
            srcAccountId: selectedAccountId,
            srcFolder: selectedFolder,
          };
        }
        if (payload && onDropMessage) {
          const mode: 'copy' | 'move' = e.ctrlKey || e.metaKey ? 'copy' : 'move';
          if (!(payload.srcAccountId === account.id && payload.srcFolder === folder.path)) {
            onDropMessage(payload, { account, folder: folder.path }, mode);
          }
        }
      } catch {}
      setDragOver(null);
    }
  };

  // Build a parent/child tree preserving sorted order at every level.
  const tree = useMemo(() => {
    type Node = { folder: MailFolder; children: Node[] };
    const byPath = new Map<string, Node>();
    for (const f of ordered) byPath.set(f.path, { folder: f, children: [] });
    const roots: Node[] = [];
    for (const node of byPath.values()) {
      const f = node.folder;
      const d = f.delimiter;
      if (d && f.path.includes(d)) {
        const parentPath = f.path.slice(0, f.path.lastIndexOf(d));
        const parent = byPath.get(parentPath);
        if (parent) {
          parent.children.push(node);
          continue;
        }
      }
      roots.push(node);
    }
    return roots;
  }, [ordered]);

  const renderFolder = (folder: MailFolder, depth: number): React.ReactNode => {
    const isSelected = !virtualFolder && selectedAccountId === account.id && folder.path === selectedFolder;
    const isDragOver = dragOver === folder.path;
    const indicator = folderDropIndicator?.path === folder.path ? folderDropIndicator.position : null;
    const Icon = getFolderIcon(folder);
    const unseen = statusByPath[folder.path]?.unseen || 0;
    const inScope = isFolderInScope(folder.path);
    const showUnread = wantStatus && inScope && unseen > 0;
    const useBold = showUnread && unreadPrefs.showBold;
    const showDot = showUnread && unreadPrefs.showDot;
    const showCount = showUnread && unreadPrefs.showCount;
    return (
      <div key={folder.path} className="relative">
        {indicator === 'before' && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-outlook-blue z-10 pointer-events-none" />
        )}
        {indicator === 'after' && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-outlook-blue z-10 pointer-events-none" />
        )}
        <button
          draggable
          onDragStart={(e) => handleFolderDragStart(e, folder)}
          onClick={() => onSelectFolder(folder)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(folder, e.clientX, e.clientY);
          }}
          onDragOver={(e) => handleFolderDragOver(e, folder)}
          onDragLeave={() => {
            setDragOver((prev) => (prev === folder.path ? null : prev));
            setFolderDropIndicator((prev) => (prev?.path === folder.path ? null : prev));
          }}
          onDrop={(e) => handleFolderDrop(e, folder)}
          style={{ paddingLeft: 12 + depth * 16 }}
          className={`w-full flex items-center gap-2.5 md:gap-2 pr-3 py-2.5 md:py-1 min-h-[40px] md:min-h-0 text-[length:inherit] rounded transition-colors
            ${isDragOver
              ? 'bg-outlook-blue/10 ring-2 ring-outlook-blue ring-inset'
              : isSelected
                ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary'
                : useBold
                  ? 'text-outlook-text-primary hover:bg-outlook-bg-hover'
                  : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
            }`}
        >
          <Icon size={16} className={`md:w-3.5 md:h-3.5 flex-shrink-0 ${isSelected || isDragOver ? 'text-outlook-blue' : ''}`} />
          {showDot && (
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"
              title={`${unseen} non lu${unseen > 1 ? 's' : ''}`}
            />
          )}
          <span className={`truncate flex-1 text-left ${useBold ? 'font-semibold' : ''}`}>
            {getFolderLabel(folder)}
          </span>
          {showCount && (
            <span
              className={`flex-shrink-0 text-xs tabular-nums ${useBold ? 'font-semibold text-outlook-blue' : 'text-outlook-text-secondary'}`}
              title={`${unseen} non lu${unseen > 1 ? 's' : ''}`}
            >
              {unseen}
            </span>
          )}
        </button>
      </div>
    );
  };

  const renderNode = (node: { folder: MailFolder; children: { folder: MailFolder; children: any[] }[] }, depth: number): React.ReactNode => {
    return (
      <div key={node.folder.path}>
        {renderFolder(node.folder, depth)}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="ml-4">
      {tree.map((node) => renderNode(node, 0))}
    </div>
  );
}

function buildAccountContextMenu(
  account: MailAccount,
  onCreateFolder?: (accountId: string, parentPath?: string) => void,
  onChange?: () => void,
  onPersonnaliser?: (account: MailAccount) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  items.push({
    label: 'Renommer la boîte mail',
    icon: <Pencil size={14} />,
    onClick: () => {
      const current = getAccountDisplayName(account);
      const newName = window.prompt('Nouveau nom d\'affichage :', current);
      if (newName === null) return;
      const trimmed = newName.trim();
      setAccountDisplayOverride(account.id, trimmed || null);
      onChange?.();
    },
  });

  items.push({
    label: 'Réinitialiser le nom',
    icon: <RotateCcw size={14} />,
    onClick: () => {
      setAccountDisplayOverride(account.id, null);
      onChange?.();
    },
  });

  items.push({ label: '', separator: true, onClick: () => {} });
  items.push({
    label: 'Couleur de la boîte mail',
    icon: <Palette size={14} />,
    onClick: () => {},
    submenu: [
      ...BASE_COLORS.map((col) => ({
        label: col.label,
        icon: <span className="inline-block w-3 h-3 rounded-sm border border-gray-300" style={{ backgroundColor: col.value }} />,
        onClick: () => {
          setAccountColorOverride(account.id, col.value);
          onChange?.();
        },
      })),
      { label: '', separator: true, onClick: () => {} },
      ...(onPersonnaliser ? [{
        label: 'Personnaliser…',
        icon: <Palette size={14} />,
        onClick: () => onPersonnaliser(account),
      }] : []),
      {
        label: 'Réinitialiser la couleur',
        icon: <RotateCcw size={14} />,
        onClick: () => {
          setAccountColorOverride(account.id, null);
          onChange?.();
        },
      },
    ],
  });

  if (onCreateFolder) {
    items.push({ label: '', separator: true, onClick: () => {} });
    items.push({
      label: 'Nouveau dossier',
      icon: <FolderPlus size={14} />,
      onClick: () => onCreateFolder(account.id, undefined),
    });
  }

  items.push({ label: '', separator: true, onClick: () => {} });
  items.push({
    label: 'Réinitialiser l\'ordre des boîtes',
    icon: <RotateCcw size={14} />,
    onClick: () => {
      setAccountOrder([]);
      onChange?.();
    },
  });

  return items;
}

function buildFolderContextMenu(
  account: MailAccount,
  folder: MailFolder,
  allAccounts: MailAccount[],
  onCreateFolder?: (accountId: string, parentPath?: string) => void,
  onRenameFolder?: (accountId: string, folderPath: string, currentName: string) => void,
  onDeleteFolder?: (accountId: string, folderPath: string) => void,
  onCopyFolder?: (
    src: { accountId: string; path: string; name: string },
    dest: { accountId: string; path: string },
  ) => void,
  onChange?: () => void,
  onMarkAllRead?: (accountId: string, folderPath: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const special = isSpecialFolder(folder);

  const isFav = isFavoriteFolder(account.id, folder.path);
  items.push({
    label: isFav ? 'Retirer des favoris' : 'Ajouter aux favoris',
    icon: <Star size={14} className={isFav ? 'fill-current' : ''} />,
    onClick: () => {
      toggleFavoriteFolder(account.id, folder.path);
      onChange?.();
    },
  });
  items.push({ label: '', separator: true, onClick: () => {} });

  if (onCreateFolder) {
    items.push({
      label: 'Nouveau sous-dossier',
      icon: <FolderPlus size={14} />,
      onClick: () => onCreateFolder(account.id, folder.path),
    });
  }

  if (onRenameFolder && !special) {
    items.push({
      label: 'Renommer le dossier',
      icon: <Pencil size={14} />,
      onClick: () => onRenameFolder(account.id, folder.path, folder.name),
    });
  }

  if (onCopyFolder) {
    items.push({ label: '', separator: true, onClick: () => {} });
    items.push({
      label: 'Copier le dossier vers…',
      icon: <Copy size={14} />,
      onClick: () => {},
      submenu: allAccounts.map((target) => ({
        label: getAccountDisplayName(target),
        icon: <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getAccountColor(target) }} />,
        onClick: () => {
          const baseName = folder.name.includes('.') ? folder.name.split('.').pop()! : folder.name;
          const suggested = target.id === account.id ? `${baseName}-copie` : baseName;
          const newName = window.prompt(
            `Nom du dossier de destination sur « ${getAccountDisplayName(target)} » :`,
            suggested,
          );
          if (!newName?.trim()) return;
          const cleanName = newName.trim().replace(/[\\\/]/g, '');
          onCopyFolder(
            { accountId: account.id, path: folder.path, name: folder.name },
            { accountId: target.id, path: cleanName },
          );
        },
      })),
    });
  }

  if (onDeleteFolder && !special) {
    items.push({ label: '', separator: true, onClick: () => {} });
    items.push({
      label: 'Supprimer le dossier',
      icon: <Trash size={14} />,
      onClick: () => onDeleteFolder(account.id, folder.path),
      danger: true,
    });
  }

  if (onMarkAllRead) {
    items.push({ label: '', separator: true, onClick: () => {} });
    items.push({
      label: 'Marquer tout comme lu',
      icon: <MailCheck size={14} />,
      onClick: () => onMarkAllRead(account.id, folder.path),
    });
  }

  items.push({ label: '', separator: true, onClick: () => {} });
  items.push({
    label: 'Réinitialiser l\'ordre des dossiers',
    icon: <RotateCcw size={14} />,
    onClick: () => {
      setFolderOrder(account.id, []);
      onChange?.();
    },
  });

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Favorites section (unified inbox/sent + user-bookmarked folders)
// ─────────────────────────────────────────────────────────────────────────────
interface FavoritesSectionProps {
  accounts: MailAccount[];
  expanded: boolean;
  onToggleExpanded: () => void;
  virtualFolder: VirtualFolder;
  selectedAccountId: string | null;
  selectedFolder: string;
  onSelectVirtual: (v: VirtualFolder) => void;
  onSelectFavorite: (fav: FavoriteFolder) => void;
  onFavoriteContextMenu: (fav: FavoriteFolder, x: number, y: number) => void;
  prefsVersion: number;
  unreadPrefs: UnreadIndicatorPrefs;
  onChanged?: () => void;
  categoryFilter: string | null;
  onSelectCategoryFilter: (id: string | null) => void;
}

function FavoritesSection({
  accounts, expanded, onToggleExpanded, virtualFolder,
  selectedAccountId, selectedFolder,
  onSelectVirtual, onSelectFavorite, onFavoriteContextMenu, prefsVersion, onChanged,
  categoryFilter, onSelectCategoryFilter,
  unreadPrefs,
}: FavoritesSectionProps) {
  const favorites = useMemo(() => getFavoriteFolders(), [prefsVersion]);
  const unifiedInboxEnabled = useMemo(() => getUnifiedInboxEnabled(), [prefsVersion]);
  const unifiedSentEnabled = useMemo(() => getUnifiedSentEnabled(), [prefsVersion]);
  const unifiedAccountIds = useMemo(() => getUnifiedAccountIds(), [prefsVersion]);

  // Favourite categories — global, shown across every mailbox.
  const [catVersion, setCatVersion] = useState(0);
  useEffect(() => subscribeCategories(() => setCatVersion((n) => n + 1)), []);
  const favoriteCategories = useMemo<MailCategory[]>(
    () => getCategories().filter((c) => c.isFavorite),
    [catVersion],
  );

  // Fetch folders for every favourite's account so we can display labels.
  // Also include every account when the unified Inbox/Sent are visible so we
  // can resolve the per-account INBOX / Sent path and sum unread counts.
  const accountIds = useMemo(() => {
    const ids = new Set<string>(favorites.map((f) => f.accountId));
    if (unifiedInboxEnabled || unifiedSentEnabled) {
      accounts.forEach((a) => ids.add(a.id));
    }
    return Array.from(ids);
  }, [favorites, accounts, unifiedInboxEnabled, unifiedSentEnabled]);

  const foldersQueries = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: ['folders', id],
      queryFn: () => api.getFolders(id),
      staleTime: 1000 * 60 * 2,
    })),
  });

  const foldersByAccount = useMemo(() => {
    const map = new Map<string, MailFolder[]>();
    accountIds.forEach((id, i) => {
      const data = foldersQueries[i]?.data as MailFolder[] | undefined;
      if (data) map.set(id, data);
    });
    return map;
  }, [accountIds, foldersQueries.map((q) => q.data).join('|')]);

  // Per-account folder STATUS (unread / total / recent), keyed by folder path.
  // Only fetched when the user actually wants unread indicators in the
  // favourites section (or when its scope reaches it).
  const wantStatus =
    (unreadPrefs.showCount || unreadPrefs.showBold || unreadPrefs.showDot) &&
    unreadPrefs.scope !== 'inbox-only';
  // 'inbox-only' scope still needs unified-inbox totals if the unified inbox
  // is shown — that's literally the inbox of every account.
  const wantStatusForUnifiedInbox =
    (unreadPrefs.showCount || unreadPrefs.showBold || unreadPrefs.showDot) &&
    unifiedInboxEnabled;

  const statusQueries = useQueries({
    queries: accountIds.map((id) => ({
      queryKey: ['folder-status', id],
      queryFn: () => api.getFoldersStatus(id),
      enabled: wantStatus || wantStatusForUnifiedInbox,
      staleTime: 30_000,
      refetchInterval: (q: any) => {
        const d: any = q?.state?.data;
        if (d?.failed) return false;
        return 60_000;
      },
      refetchOnWindowFocus: true,
      retry: false,
    })),
  });

  const statusByAccount = useMemo(() => {
    const map = new Map<string, Record<string, { messages: number; unseen: number; recent: number }>>();
    accountIds.forEach((id, i) => {
      const data = statusQueries[i]?.data as
        | { folders: Record<string, { messages: number; unseen: number; recent: number }> }
        | undefined;
      if (data?.folders) map.set(id, data.folders);
    });
    return map;
  }, [accountIds, statusQueries.map((q) => q.data).join('|')]);

  const hasAnyItem =
    (unifiedInboxEnabled || unifiedSentEnabled) || favorites.length > 0 || favoriteCategories.length > 0;

  if (!hasAnyItem) return null;

  const isIncludedAccount = (id: string) => {
    if (!unifiedAccountIds.length) return true;
    return unifiedAccountIds.includes(id);
  };
  const hasIncludedAccounts = accounts.some((a) => isIncludedAccount(a.id));

  const showUnifiedInbox = unifiedInboxEnabled && hasIncludedAccounts;
  const showUnifiedSent = unifiedSentEnabled && hasIncludedAccounts;

  // Sum unread counts across "included" accounts for the unified Inbox / Sent
  // virtual folders.
  const wantAnyIndicator =
    unreadPrefs.showCount || unreadPrefs.showBold || unreadPrefs.showDot;
  const unifiedInboxUnseen = useMemo(() => {
    if (!showUnifiedInbox || !wantAnyIndicator) return 0;
    let total = 0;
    accounts.forEach((a) => {
      if (!isIncludedAccount(a.id)) return;
      const folders = foldersByAccount.get(a.id) || [];
      const inbox = findInboxFolderPath(folders);
      total += statusByAccount.get(a.id)?.[inbox]?.unseen || 0;
    });
    return total;
  }, [showUnifiedInbox, wantAnyIndicator, accounts, foldersByAccount, statusByAccount, unifiedAccountIds]);
  const unifiedSentUnseen = useMemo(() => {
    if (!showUnifiedSent || !wantAnyIndicator) return 0;
    if (unreadPrefs.scope === 'inbox-only') return 0; // sent ≠ inbox
    let total = 0;
    accounts.forEach((a) => {
      if (!isIncludedAccount(a.id)) return;
      const folders = foldersByAccount.get(a.id) || [];
      const sent = findSentFolderPath(folders);
      if (!sent) return;
      total += statusByAccount.get(a.id)?.[sent]?.unseen || 0;
    });
    return total;
  }, [showUnifiedSent, wantAnyIndicator, unreadPrefs.scope, accounts, foldersByAccount, statusByAccount, unifiedAccountIds]);

  // Drag & drop reorder for favourite folders (unified inbox/sent are fixed on top).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const reorderFavorites = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= favorites.length || to > favorites.length) return;
    const next = favorites.slice();
    const [moved] = next.splice(from, 1);
    const insertAt = to > from ? to - 1 : to;
    next.splice(insertAt, 0, moved);
    setFavoriteFolders(next);
    onChanged?.();
  };

  return (
    <div className="mb-2">
      <button
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-1.5 md:gap-1 px-2 py-2.5 md:py-1.5 min-h-[44px] md:min-h-0 text-xs font-semibold uppercase tracking-wide text-outlook-text-secondary hover:bg-outlook-bg-hover rounded"
      >
        {expanded ? <ChevronDown size={16} className="md:w-3 md:h-3" /> : <ChevronRight size={16} className="md:w-3 md:h-3" />}
        <Star size={14} className="md:w-3 md:h-3 text-outlook-blue fill-current" />
        <span>Favoris</span>
      </button>

      {expanded && (
        <div className="ml-1">
          {showUnifiedInbox && (
            <VirtualFolderButton
              icon={Inbox}
              label="Boîte de réception"
              active={virtualFolder === 'unified-inbox'}
              onClick={() => onSelectVirtual('unified-inbox')}
              unseen={unifiedInboxUnseen}
              unreadPrefs={unreadPrefs}
            />
          )}
          {showUnifiedSent && (
            <VirtualFolderButton
              icon={Send}
              label="Éléments envoyés"
              active={virtualFolder === 'unified-sent'}
              onClick={() => onSelectVirtual('unified-sent')}
              unseen={unifiedSentUnseen}
              unreadPrefs={unreadPrefs}
            />
          )}

          {favorites.map((fav, index) => {
            const account = accounts.find((a) => a.id === fav.accountId);
            if (!account) return null;
            const accountFolders = foldersByAccount.get(fav.accountId) || [];
            const folder = accountFolders.find((f) => f.path === fav.path);
            const label = folder ? getFolderLabel(folder) : fav.path.split(/[./]/).pop() || fav.path;
            const Icon = folder ? getFolderIcon(folder) : FolderIcon;
            const isActive =
              !virtualFolder &&
              selectedAccountId === fav.accountId &&
              selectedFolder === fav.path;
            const isDragging = dragIndex === index;
            const showDropBefore = dropIndex === index && dragIndex !== null && dragIndex !== index;
            const showDropAfter =
              dropIndex === favorites.length && index === favorites.length - 1 && dragIndex !== null;
            // Unread indicator for this favourite row.
            const inboxPathForAcc = findInboxFolderPath(accountFolders);
            const isFavInbox = fav.path === inboxPathForAcc;
            const favInScope =
              unreadPrefs.scope === 'inbox-only' ? isFavInbox : true;
            const favUnseen = statusByAccount.get(fav.accountId)?.[fav.path]?.unseen || 0;
            const favShowUnread = wantAnyIndicator && favInScope && favUnseen > 0;
            const favBold = favShowUnread && unreadPrefs.showBold;
            const favDot = favShowUnread && unreadPrefs.showDot;
            const favCount = favShowUnread && unreadPrefs.showCount;
            return (
              <div
                key={`${fav.accountId}:${fav.path}`}
                className="relative"
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const after = e.clientY - rect.top > rect.height / 2;
                  setDropIndex(after ? index + 1 : index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dropIndex !== null) {
                    reorderFavorites(dragIndex, dropIndex);
                  }
                  setDragIndex(null);
                  setDropIndex(null);
                }}
              >
                {showDropBefore && (
                  <div className="absolute left-2 right-2 top-0 h-0.5 bg-outlook-blue rounded pointer-events-none" />
                )}
                <button
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = 'move';
                    // Avoid native image artefact where possible.
                    try { e.dataTransfer.setData('text/plain', `${fav.accountId}:${fav.path}`); } catch { /* noop */ }
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onClick={() => onSelectFavorite(fav)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onFavoriteContextMenu(fav, e.clientX, e.clientY);
                  }}
                  className={`w-full flex items-center gap-2.5 md:gap-2 pl-3 pr-3 py-2.5 md:py-1 min-h-[40px] md:min-h-0 text-[length:inherit] rounded transition-colors
                    ${isActive
                      ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary'
                      : favBold
                        ? 'text-outlook-text-primary hover:bg-outlook-bg-hover'
                        : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}
                    ${isDragging ? 'opacity-50' : ''}`}
                  title={`${getAccountDisplayName(account)} · ${label}`}
                >
                  <Icon size={16} className={`md:w-3.5 md:h-3.5 flex-shrink-0 ${isActive ? 'text-outlook-blue' : ''}`} />
                  {favDot && (
                    <span
                      aria-hidden
                      className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"
                      title={`${favUnseen} non lu${favUnseen > 1 ? 's' : ''}`}
                    />
                  )}
                  <span className={`truncate flex-1 text-left ${favBold ? 'font-semibold' : ''}`}>{label}</span>
                  {favCount && (
                    <span
                      className={`flex-shrink-0 text-xs tabular-nums ${favBold ? 'font-semibold text-outlook-blue' : 'text-outlook-text-secondary'}`}
                      title={`${favUnseen} non lu${favUnseen > 1 ? 's' : ''}`}
                    >
                      {favUnseen}
                    </span>
                  )}
                  <span
                    className="w-2 h-2 md:w-1.5 md:h-1.5 rounded-full flex-shrink-0 opacity-70"
                    style={{ backgroundColor: getAccountColor(account) }}
                    title={getAccountDisplayName(account)}
                  />
                </button>
                {showDropAfter && (
                  <div className="absolute left-2 right-2 bottom-0 h-0.5 bg-outlook-blue rounded pointer-events-none" />
                )}
              </div>
            );
          })}

          {favoriteCategories.length > 0 && (
            <div className="mt-1">
              {favoriteCategories.map((cat) => {
                const active = categoryFilter === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => onSelectCategoryFilter(active ? null : cat.id)}
                    className={`w-full flex items-center gap-2.5 md:gap-2 pl-3 pr-3 py-2.5 md:py-1 min-h-[40px] md:min-h-0 text-[length:inherit] rounded transition-colors
                      ${active
                        ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary'
                        : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
                    title={`Filtrer par catégorie : ${cat.name}`}
                  >
                    <Tag size={16} className="md:w-3.5 md:h-3.5 flex-shrink-0" style={{ color: cat.color }} />
                    <span className="truncate flex-1 text-left">{cat.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VirtualFolderButton({
  icon: Icon, label, active, onClick, unseen, unreadPrefs,
}: {
  icon: any; label: string; active: boolean; onClick: () => void;
  unseen?: number; unreadPrefs?: UnreadIndicatorPrefs;
}) {
  const u = unseen || 0;
  const p = unreadPrefs;
  const wantAny = !!p && (p.showCount || p.showBold || p.showDot);
  const showUnread = wantAny && u > 0;
  const useBold = showUnread && !!p?.showBold;
  const showDot = showUnread && !!p?.showDot;
  const showCount = showUnread && !!p?.showCount;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 md:gap-2 pl-3 pr-3 py-2.5 md:py-1 min-h-[40px] md:min-h-0 text-[length:inherit] rounded transition-colors
        ${active
          ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary'
          : useBold
            ? 'text-outlook-text-primary hover:bg-outlook-bg-hover'
            : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
    >
      <Icon size={16} className={`md:w-3.5 md:h-3.5 flex-shrink-0 ${active ? 'text-outlook-blue' : ''}`} />
      {showDot && (
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"
          title={`${u} non lu${u > 1 ? 's' : ''}`}
        />
      )}
      <span className={`truncate flex-1 text-left ${useBold ? 'font-semibold' : ''}`}>{label}</span>
      {showCount && (
        <span
          className={`flex-shrink-0 text-xs tabular-nums ${useBold ? 'font-semibold text-outlook-blue' : 'text-outlook-text-secondary'}`}
          title={`${u} non lu${u > 1 ? 's' : ''}`}
        >
          {u}
        </span>
      )}
    </button>
  );
}