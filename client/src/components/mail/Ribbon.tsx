import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Mail, Reply, ReplyAll, Forward, Trash2, Archive, Flag,
  FolderInput, MailPlus, RefreshCw, ChevronDown, Printer,
  Download, Eye, EyeOff, PanelLeftOpen, PanelLeftClose,
  Columns2, Rows2, LayoutGrid, Settings, Info, FileDown,
  MoreHorizontal, Layers, Minus, Plus, Paperclip,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link as LinkIcon, Image as ImageIcon, Palette, Type, Indent, Outdent,
  Eraser, Subscript, Superscript, Quote, Code, Heading1, Heading2, Heading3,
  Smile, Table as TableIcon, Minus as MinusIcon, PenLine, Calendar, Film, PenTool,
  Star, ArrowLeftRight, AlignVerticalJustifyCenter, List as ListIcon,
  Tag, MessagesSquare, ShieldAlert, ShieldOff, Coffee,
  Maximize2, Minimize2,
  FileText, Settings as SettingsIcon, Filter,
  Clock, BellDot, Cloud,
  Search, X as XIcon, AtSign, FolderSearch,
} from 'lucide-react';
import { api } from '../../api';
import NextcloudFilePicker, { type NextcloudFileItem } from '../ui/NextcloudFilePicker';
import { CategoryPicker } from './CategoryModals';
import { SignaturesManagerModal } from './SignatureModals';
import { getSignatures, MailSignature, wrapSignatureHtml } from '../../utils/signatures';
import {
  getCategories as getMailCategories,
  toggleCategoryFavorite,
  subscribeCategories,
  type MailCategory,
} from '../../utils/categories';
import toast from 'react-hot-toast';
import type { TabMode } from '../../stores/mailStore';
import type { MailAccount } from '../../types';
import {
  getUnifiedAccountIds, setUnifiedAccountIds,
  getUnifiedInboxEnabled, setUnifiedInboxEnabled,
  getUnifiedSentEnabled, setUnifiedSentEnabled,
  getAccountDisplayName,
  getDeleteConfirmEnabled, setDeleteConfirmEnabled,
  getFolderPaneFontSize, setFolderPaneFontSize,
  type FolderPaneFontSize, FOLDER_PANE_FONT_SIZE_LABELS, FOLDER_PANE_FONT_SIZE_PX,
  FOLDER_PANE_FONT_SIZE_CHANGED_EVENT,
  getRecentMoveFoldersCount, setRecentMoveFoldersCount,
  getRecentCopyFoldersCount, setRecentCopyFoldersCount,
  type RecentFoldersCount, RECENT_FOLDERS_CHANGED_EVENT,
  getUnreadIndicatorPrefs, setUnreadIndicatorPrefs,
  type UnreadIndicatorPrefs, type UnreadIndicatorScope,
  UNREAD_INDICATORS_CHANGED_EVENT, UNREAD_SCOPE_LABELS,
} from '../../utils/mailPreferences';

type RibbonTab = 'accueil' | 'afficher' | 'message' | 'inserer' | 'recherche';
type RibbonMode = 'classic' | 'simplified';
type AttachmentActionMode = 'preview' | 'download' | 'menu' | 'nextcloud';

const FONT_FAMILIES = ['Arial', 'Calibri', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Trebuchet MS'];
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48', '72'];
const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#ffffff',
  '#ff0000', '#ff4500', '#ff9900', '#ffff00', '#00ff00', '#00ffff',
  '#0000ff', '#9900ff', '#ff00ff', '#e06666', '#f6b26b', '#ffd966',
  '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c8',
  '#674ea7', '#a64d79',
];
const EMOJI_LIST = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰',
  '😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏',
  '👍','👎','👌','✌️','🤞','🤟','🤘','👏','🙏','💪','🙌','👋','🤝','❤️','🧡','💛',
  '💚','💙','💜','🖤','🤍','💔','✨','⭐','🌟','💫','🔥','💯','✅','❌','⚠️','❓',
];

interface RibbonProps {
  // Accueil actions
  onNewMessage: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onToggleFlag: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSync: () => void;
  hasSelectedMessage: boolean;
  isFlagged: boolean;
  isRead: boolean;

  // Afficher actions
  showFolderPane: boolean;
  onToggleFolderPane: () => void;
  onPrint: () => void;
  onDownloadEml: () => void;
  attachmentActionMode: AttachmentActionMode;
  onChangeAttachmentActionMode: (mode: AttachmentActionMode) => void;

  // Ribbon visibility
  isCollapsed: boolean;
  onToggleCollapse: () => void;

  // Ribbon mode
  ribbonMode: RibbonMode;
  onChangeRibbonMode: (mode: RibbonMode) => void;

  // Tab settings
  tabMode: TabMode;
  maxTabs: number;
  onChangeTabMode: (mode: TabMode) => void;
  onChangeMaxTabs: (max: number) => void;

  // Compose (Message / Insérer tabs)
  isComposing?: boolean;
  composeEditorRef?: React.RefObject<HTMLDivElement>;
  onComposeAttachFiles?: (files: FileList | File[]) => void;
  onToggleEmojiPanel?: () => void;
  isEmojiPanelOpen?: boolean;
  onToggleGifPanel?: () => void;
  isGifPanelOpen?: boolean;

  // Favorites mailbox management (Afficher tab)
  accounts?: MailAccount[];
  onFavoritesChanged?: () => void;

  // Split view (side-by-side tabs)
  splitActive?: boolean;
  onSwapSplit?: () => void;
  splitKeepFolderPane?: boolean;
  onToggleSplitKeepFolderPane?: () => void;
  splitKeepMessageList?: boolean;
  onToggleSplitKeepMessageList?: () => void;
  splitComposeReply?: boolean;
  onToggleSplitComposeReply?: () => void;

  // Reading pane mode (Volet de lecture)
  readingPaneMode?: 'right' | 'bottom' | 'hidden';
  onChangeReadingPaneMode?: (mode: 'right' | 'bottom' | 'hidden') => void;

  // List density (Densité)
  listDensity?: 'spacious' | 'comfortable' | 'compact';
  onChangeListDensity?: (d: 'spacious' | 'comfortable' | 'compact') => void;

  // List display mode (Liste mail)
  listDisplayMode?: 'auto' | 'wide' | 'compact';
  onChangeListDisplayMode?: (m: 'auto' | 'wide' | 'compact') => void;

  // Mail body display mode (rendu corps du mail : natif vs étiré)
  mailDisplayMode?: 'native' | 'stretched';
  onChangeMailDisplayMode?: (m: 'native' | 'stretched') => void;

  // Conversation grouping (Outlook « Conversations » menu).
  // - 'none'         : Ne pas regrouper les messages (plat, par date).
  // - 'conversation' : Regrouper les messages par conversation (un seul nœud par thread).
  // - 'branches'     : Regrouper les messages par branches dans les conversations (thread + sous-fils).
  conversationGrouping?: 'none' | 'conversation' | 'branches';
  onChangeConversationGrouping?: (mode: 'none' | 'conversation' | 'branches') => void;
  // Reading pane thread behaviour. When false, the reading pane only shows the selected
  // message; when true, it shows all messages of the conversation (stacked cards).
  conversationShowAllInReadingPane?: boolean;
  onToggleConversationShowAllInReadingPane?: () => void;

  // Categories
  onCategorize?: (categoryId: string) => void;
  onClearCategories?: () => void;
  onNewCategory?: () => void;
  onManageCategories?: () => void;
  messageCategoryIds?: string[];

  // Auto-responder (vacation responder) modal trigger
  onOpenAutoResponder?: () => void;
  /** Whether the responder is currently enabled — drives the button's active state. */
  autoResponderEnabled?: boolean;

  // Mail rules modal trigger (Outlook-style rules manager)
  onOpenRules?: () => void;

  // Mail templates (Insérer tab > Modèles)
  onOpenTemplatesPicker?: () => void;
  onOpenTemplatesManager?: () => void;

  // Search ribbon tab
  isSearchMode?: boolean;
  searchQuery?: string;
  searchScope?: 'current-folder' | 'all-folders' | 'mailbox';
  searchAccountId?: string;
  searchDatePreset?: 'all' | 'today' | 'week' | 'month' | 'year';
  searchHasAttachment?: 'any' | 'yes' | 'no';
  searchIsRead?: 'any' | 'read' | 'unread';
  searchFrom?: string;
  onSearchScopeChange?: (s: 'current-folder' | 'all-folders' | 'mailbox') => void;
  onSearchAccountChange?: (id: string) => void;
  onSearchDatePresetChange?: (p: 'all' | 'today' | 'week' | 'month' | 'year') => void;
  onSearchHasAttachmentChange?: (v: 'any' | 'yes' | 'no') => void;
  onSearchIsReadChange?: (v: 'any' | 'read' | 'unread') => void;
  onSearchFromChange?: (v: string) => void;
  onSearchClear?: () => void;
  currentFolder?: string;
}

function RibbonButton({ icon: Icon, label, onClick, disabled, active, danger, small }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; danger?: boolean; small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px]
        ${small ? 'px-1.5 py-0.5 min-w-[40px]' : ''}
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}
        ${danger && !disabled ? 'hover:bg-red-50 hover:text-outlook-danger' : ''}`}
      title={label}
    >
      <Icon size={small ? 16 : 18} />
      <span className={`${small ? 'text-[9px]' : 'text-[10px]'} leading-tight text-center whitespace-nowrap`}>{label}</span>
    </button>
  );
}

function RibbonSeparator() {
  return <div className="w-px h-10 bg-outlook-border mx-1 self-center" />;
}

function SimplifiedButton({ icon: Icon, label, onClick, disabled, active, danger }: {
  icon: any; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded transition-colors px-2 py-1
        ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${active ? 'bg-outlook-blue/10 text-outlook-blue' : ''}
        ${danger && !disabled ? 'hover:bg-red-50 hover:text-outlook-danger' : ''}`}
      title={label}
    >
      <Icon size={14} />
      <span className="text-xs whitespace-nowrap">{label}</span>
    </button>
  );
}

function SimplifiedSep() {
  return <div className="w-px h-5 bg-outlook-border mx-0.5 self-center" />;
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-0.5 px-1 flex-1">
        {children}
      </div>
      <span className="text-[9px] text-outlook-text-disabled mt-0.5 leading-none">{label}</span>
    </div>
  );
}

// ─── Search Tab shared props ──────────────────────────────────────────────────
interface SearchTabProps {
  searchScope: 'current-folder' | 'all-folders' | 'mailbox';
  searchAccountId: string;
  searchDatePreset: 'all' | 'today' | 'week' | 'month' | 'year';
  searchHasAttachment: 'any' | 'yes' | 'no';
  searchIsRead: 'any' | 'read' | 'unread';
  searchFrom: string;
  accounts: MailAccount[];
  onSearchScopeChange?: (s: 'current-folder' | 'all-folders' | 'mailbox') => void;
  onSearchAccountChange?: (id: string) => void;
  onSearchDatePresetChange?: (p: 'all' | 'today' | 'week' | 'month' | 'year') => void;
  onSearchHasAttachmentChange?: (v: 'any' | 'yes' | 'no') => void;
  onSearchIsReadChange?: (v: 'any' | 'read' | 'unread') => void;
  onSearchFromChange?: (v: string) => void;
  onSearchClear?: () => void;
  currentFolder?: string;
}

function SearchChip<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const isActive = value !== options[0].value;

  const handleOpen = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors whitespace-nowrap
          ${isActive
            ? 'bg-outlook-blue text-white border-outlook-blue'
            : 'bg-outlook-bg-secondary text-outlook-text-primary border-outlook-border hover:border-outlook-blue/50 hover:bg-outlook-bg-hover'
          }`}
      >
        <span className="font-medium text-[10px] opacity-70">{label} :</span>
        <span>{current?.label}</span>
        <ChevronDown size={10} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && createPortal(
        <>
          {/* Overlay closes on click outside — use onMouseDown so option buttons fire first */}
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setOpen(false)} />
          <div
            className="fixed z-[9999] bg-outlook-bg-secondary border border-outlook-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ top: pos.top, left: pos.left }}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onMouseDown={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center justify-between
                  ${value === opt.value ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
              >
                {opt.label}
                {value === opt.value && <span className="text-outlook-blue">✓</span>}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// Small radio-style toggle used inside RibbonGroup for the Search tab (classic mode)
function SearchRadioGroup<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col justify-center gap-px py-0.5 h-full">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1 px-1.5 py-px rounded text-[10px] leading-tight transition-colors whitespace-nowrap
            ${value === opt.value ? 'bg-outlook-blue/10 text-outlook-blue font-semibold' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
        >
          <div className={`w-1.5 h-1.5 rounded-full border flex-shrink-0 ${value === opt.value ? 'bg-outlook-blue border-outlook-blue' : 'border-outlook-text-disabled'}`} />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SearchTabClassic(props: SearchTabProps) {
  const {
    searchScope, searchAccountId, searchDatePreset, searchHasAttachment, searchIsRead,
    searchFrom, accounts,
    onSearchScopeChange, onSearchAccountChange, onSearchDatePresetChange,
    onSearchHasAttachmentChange, onSearchIsReadChange, onSearchFromChange, onSearchClear,
    currentFolder,
  } = props;

  const folderShort = currentFolder ? (currentFolder.split('/').pop() || currentFolder) : 'actuel';

  return (
    <div className="flex items-stretch gap-1 w-full overflow-x-auto h-full">
      {/* Fermer */}
      <RibbonGroup label="Recherche">
        <RibbonButton icon={XIcon} label="Fermer" onClick={() => onSearchClear?.()} danger />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Portée */}
      <RibbonGroup label="Portée">
        <SearchRadioGroup<'current-folder' | 'all-folders' | 'mailbox'>
          value={searchScope}
          options={[
            { value: 'current-folder', label: `Dossier : ${folderShort}` },
            { value: 'all-folders', label: 'Toutes les boîtes' },
            { value: 'mailbox', label: 'Boîte actuelle' },
          ]}
          onChange={(v) => onSearchScopeChange?.(v)}
        />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Compte (multi-account only) */}
      {accounts.length > 1 && (
        <>
          <RibbonGroup label="Compte">
            <SearchRadioGroup<string>
              value={searchAccountId || '__all__'}
              options={[
                { value: '__all__', label: 'Tous les comptes' },
                ...accounts.slice(0, 3).map((a) => ({ value: a.id, label: getAccountDisplayName(a) })),
              ]}
              onChange={(v) => onSearchAccountChange?.(v === '__all__' ? '' : v)}
            />
          </RibbonGroup>
          <RibbonSeparator />
        </>
      )}

      {/* Période */}
      <RibbonGroup label="Période">
        <SearchRadioGroup<'all' | 'today' | 'week' | 'month' | 'year'>
          value={searchDatePreset}
          options={[
            { value: 'all', label: 'Tout' },
            { value: 'today', label: "Aujourd'hui" },
            { value: 'week', label: 'Cette semaine' },
            { value: 'month', label: 'Ce mois' },
            { value: 'year', label: 'Cette année' },
          ]}
          onChange={(v) => onSearchDatePresetChange?.(v)}
        />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Pièces jointes */}
      <RibbonGroup label="Pièces jointes">
        <SearchRadioGroup<'any' | 'yes' | 'no'>
          value={searchHasAttachment}
          options={[
            { value: 'any', label: 'Non filtré' },
            { value: 'yes', label: 'Avec PJ' },
            { value: 'no', label: 'Sans PJ' },
          ]}
          onChange={(v) => onSearchHasAttachmentChange?.(v)}
        />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Statut */}
      <RibbonGroup label="Statut">
        <SearchRadioGroup<'any' | 'read' | 'unread'>
          value={searchIsRead}
          options={[
            { value: 'any', label: 'Non filtré' },
            { value: 'unread', label: 'Non lu' },
            { value: 'read', label: 'Lu' },
          ]}
          onChange={(v) => onSearchIsReadChange?.(v)}
        />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Expéditeur */}
      <RibbonGroup label="Expéditeur">
        <div className="flex items-center gap-1 px-1.5 py-1 bg-outlook-bg-hover border border-outlook-border rounded">
          <AtSign size={11} className="text-outlook-text-secondary flex-shrink-0" />
          <input
            type="text"
            value={searchFrom}
            onChange={(e) => onSearchFromChange?.(e.target.value)}
            placeholder="Expéditeur…"
            className="w-28 text-[11px] outline-none bg-transparent text-outlook-text-primary placeholder-outlook-text-disabled"
          />
          {searchFrom && (
            <button onMouseDown={() => onSearchFromChange?.('')} className="text-outlook-text-disabled hover:text-outlook-text-secondary">
              <XIcon size={9} />
            </button>
          )}
        </div>
      </RibbonGroup>
    </div>
  );
}

function SearchTabSimplified(props: SearchTabProps) {
  const {
    searchScope, searchAccountId, searchDatePreset, searchHasAttachment, searchIsRead,
    accounts,
    onSearchScopeChange, onSearchAccountChange, onSearchDatePresetChange,
    onSearchHasAttachmentChange, onSearchIsReadChange, onSearchClear,
    currentFolder,
  } = props;

  const scopeLabel = currentFolder ? `Dossier : ${currentFolder.split('/').pop() || currentFolder}` : 'Dossier actuel';

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
      <button
        onClick={() => onSearchClear?.()}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-outlook-danger hover:bg-red-50 transition-colors whitespace-nowrap"
        title="Fermer la recherche"
      >
        <XIcon size={12} />
        Fermer
      </button>
      <SimplifiedSep />

      <SearchChip<'current-folder' | 'all-folders' | 'mailbox'>
        label="Portée"
        value={searchScope}
        options={[
          { value: 'current-folder', label: scopeLabel },
          { value: 'all-folders', label: 'Toutes les boîtes' },
          { value: 'mailbox', label: 'Boîte actuelle' },
        ]}
        onChange={(v) => onSearchScopeChange?.(v)}
      />

      {accounts.length > 1 && (
        <SearchChip<string>
          label="Compte"
          value={searchAccountId || '__all__'}
          options={[
            { value: '__all__', label: 'Tous les comptes' },
            ...accounts.map((a) => ({ value: a.id, label: getAccountDisplayName(a) })),
          ]}
          onChange={(v) => onSearchAccountChange?.(v === '__all__' ? '' : v)}
        />
      )}

      <SearchChip<'all' | 'today' | 'week' | 'month' | 'year'>
        label="Période"
        value={searchDatePreset}
        options={[
          { value: 'all', label: 'Tout' },
          { value: 'today', label: "Aujourd'hui" },
          { value: 'week', label: 'Cette semaine' },
          { value: 'month', label: 'Ce mois' },
          { value: 'year', label: 'Cette année' },
        ]}
        onChange={(v) => onSearchDatePresetChange?.(v)}
      />

      <SearchChip<'any' | 'yes' | 'no'>
        label="Pièces jointes"
        value={searchHasAttachment}
        options={[
          { value: 'any', label: 'Non filtré' },
          { value: 'yes', label: 'Avec' },
          { value: 'no', label: 'Sans' },
        ]}
        onChange={(v) => onSearchHasAttachmentChange?.(v)}
      />

      <SearchChip<'any' | 'read' | 'unread'>
        label="Statut"
        value={searchIsRead}
        options={[
          { value: 'any', label: 'Non filtré' },
          { value: 'unread', label: 'Non lu' },
          { value: 'read', label: 'Lu' },
        ]}
        onChange={(v) => onSearchIsReadChange?.(v)}
      />
    </div>
  );
}

export default function Ribbon({
  onNewMessage, onReply, onReplyAll, onForward, onDelete, onArchive,
  onToggleFlag, onMarkRead, onMarkUnread, onSync,
  hasSelectedMessage, isFlagged, isRead,
  showFolderPane, onToggleFolderPane, onPrint, onDownloadEml,
  attachmentActionMode, onChangeAttachmentActionMode,
  isCollapsed, onToggleCollapse,
  ribbonMode, onChangeRibbonMode,
  tabMode, maxTabs, onChangeTabMode, onChangeMaxTabs,
  isComposing = false, composeEditorRef, onComposeAttachFiles,
  onToggleEmojiPanel, isEmojiPanelOpen = false,
  onToggleGifPanel, isGifPanelOpen = false,
  accounts = [], onFavoritesChanged,
  splitActive = false, onSwapSplit,
  splitKeepFolderPane = false, onToggleSplitKeepFolderPane,
  splitKeepMessageList = false, onToggleSplitKeepMessageList,
  splitComposeReply = false, onToggleSplitComposeReply,
  readingPaneMode = 'right', onChangeReadingPaneMode,
  listDensity = 'comfortable', onChangeListDensity,
  listDisplayMode = 'auto', onChangeListDisplayMode,
  mailDisplayMode = 'native', onChangeMailDisplayMode,
  conversationGrouping = 'none', onChangeConversationGrouping,
  conversationShowAllInReadingPane = true, onToggleConversationShowAllInReadingPane,
  onCategorize, onClearCategories, onNewCategory, onManageCategories,
  messageCategoryIds = [],
  onOpenAutoResponder, autoResponderEnabled = false,
  onOpenRules,
  onOpenTemplatesPicker, onOpenTemplatesManager,
  isSearchMode = false,
  searchQuery = '',
  searchScope = 'current-folder',
  searchAccountId = '',
  searchDatePreset = 'all',
  searchHasAttachment = 'any',
  searchIsRead = 'any',
  searchFrom = '',
  onSearchScopeChange,
  onSearchAccountChange,
  onSearchDatePresetChange,
  onSearchHasAttachmentChange,
  onSearchIsReadChange,
  onSearchFromChange,
  onSearchClear,
  currentFolder,
}: RibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTab>('accueil');
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showFavoritesMenu, setShowFavoritesMenu] = useState(false);
  const [showReadingPaneMenu, setShowReadingPaneMenu] = useState(false);
  const [showDensityMenu, setShowDensityMenu] = useState(false);
  const [showListModeMenu, setShowListModeMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showConversationsMenu, setShowConversationsMenu] = useState(false);
  const [showFolderFontMenu, setShowFolderFontMenu] = useState(false);
  const [showMailDisplayMenu, setShowMailDisplayMenu] = useState(false);
  const [showRecentFoldersMenu, setShowRecentFoldersMenu] = useState(false);
  const [showUnreadMenu, setShowUnreadMenu] = useState(false);
  // Folder pane font size — synced with the global event so two ribbons stay
  // in sync if multiple windows/tabs are open.
  const [folderFontSize, setFolderFontSizeState] = useState<FolderPaneFontSize>(() => getFolderPaneFontSize());
  useEffect(() => {
    const handler = () => setFolderFontSizeState(getFolderPaneFontSize());
    window.addEventListener(FOLDER_PANE_FONT_SIZE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FOLDER_PANE_FONT_SIZE_CHANGED_EVENT, handler);
  }, []);

  // Unread indicators preferences (count / bold / dot + scope) — synced through
  // the global event so the pane and ribbon stay aligned.
  const [unreadPrefs, setUnreadPrefsState] = useState<UnreadIndicatorPrefs>(() => getUnreadIndicatorPrefs());
  useEffect(() => {
    const handler = () => setUnreadPrefsState(getUnreadIndicatorPrefs());
    window.addEventListener(UNREAD_INDICATORS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(UNREAD_INDICATORS_CHANGED_EVENT, handler);
  }, []);
  const updateUnreadPrefs = (patch: Partial<UnreadIndicatorPrefs>) => {
    setUnreadIndicatorPrefs(patch);
    setUnreadPrefsState((p) => ({ ...p, ...patch }));
  };
  const tabMenuBtnRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuBtnRef = useRef<HTMLButtonElement>(null);
  const favoritesMenuBtnRef = useRef<HTMLButtonElement>(null);
  const readingPaneMenuBtnRef = useRef<HTMLButtonElement>(null);
  const densityMenuBtnRef = useRef<HTMLButtonElement>(null);
  const listModeMenuBtnRef = useRef<HTMLButtonElement>(null);
  const categoryMenuBtnRef = useRef<HTMLButtonElement>(null);
  const conversationsMenuBtnRef = useRef<HTMLButtonElement>(null);
  const folderFontMenuBtnRef = useRef<HTMLButtonElement>(null);
  const mailDisplayMenuBtnRef = useRef<HTMLButtonElement>(null);
  const recentFoldersMenuBtnRef = useRef<HTMLButtonElement>(null);
  const unreadMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [tabMenuPos, setTabMenuPos] = useState({ top: 0, left: 0 });
  const [attachmentMenuPos, setAttachmentMenuPos] = useState({ top: 0, left: 0 });
  const [favoritesMenuPos, setFavoritesMenuPos] = useState({ top: 0, left: 0 });
  const [readingPaneMenuPos, setReadingPaneMenuPos] = useState({ top: 0, left: 0 });
  const [densityMenuPos, setDensityMenuPos] = useState({ top: 0, left: 0 });
  const [listModeMenuPos, setListModeMenuPos] = useState({ top: 0, left: 0 });
  const [categoryMenuPos, setCategoryMenuPos] = useState({ top: 0, left: 0 });
  const [conversationsMenuPos, setConversationsMenuPos] = useState({ top: 0, left: 0 });
  const [folderFontMenuPos, setFolderFontMenuPos] = useState({ top: 0, left: 0 });
  const [mailDisplayMenuPos, setMailDisplayMenuPos] = useState({ top: 0, left: 0 });
  const [recentFoldersMenuPos, setRecentFoldersMenuPos] = useState({ top: 0, left: 0 });
  const [unreadMenuPos, setUnreadMenuPos] = useState({ top: 0, left: 0 });
  const ribbonRef = useRef<HTMLDivElement>(null);
  // Re-render favorites menu when toggled
  const [favPrefsVersion, setFavPrefsVersion] = useState(0);
  const bumpFavPrefs = () => {
    setFavPrefsVersion((n) => n + 1);
    onFavoritesChanged?.();
  };

  // Delete confirmation preference (per-user, localStorage) — exposed as a
  // toggle in the "Afficher" tab so each user can opt-out of the dialog.
  const [deleteConfirmEnabled, setDeleteConfirmEnabledState] = useState<boolean>(
    () => getDeleteConfirmEnabled(),
  );
  const toggleDeleteConfirm = () => {
    const next = !deleteConfirmEnabled;
    setDeleteConfirmEnabled(next);
    setDeleteConfirmEnabledState(next);
  };

  // Recent move/copy folders shortcut counts — kept in sync with localStorage
  // through the global RECENT_FOLDERS_CHANGED_EVENT so the settings page and
  // the ribbon always show the same value.
  const [recentMoveCount, setRecentMoveCountState] = useState<RecentFoldersCount>(
    () => getRecentMoveFoldersCount(),
  );
  const [recentCopyCount, setRecentCopyCountState] = useState<RecentFoldersCount>(
    () => getRecentCopyFoldersCount(),
  );
  useEffect(() => {
    const handler = () => {
      setRecentMoveCountState(getRecentMoveFoldersCount());
      setRecentCopyCountState(getRecentCopyFoldersCount());
    };
    window.addEventListener(RECENT_FOLDERS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(RECENT_FOLDERS_CHANGED_EVENT, handler);
  }, []);
  const updateRecentMoveCount = (n: RecentFoldersCount) => {
    setRecentMoveCountState(n);
    setRecentMoveFoldersCount(n);
  };
  const updateRecentCopyCount = (n: RecentFoldersCount) => {
    setRecentCopyCountState(n);
    setRecentCopyFoldersCount(n);
  };

  // Auto-switch to Message tab when composing starts; go back to Accueil when it ends
  const prevComposingRef = useRef(isComposing);
  useEffect(() => {
    if (isComposing && !prevComposingRef.current) {
      setActiveTab('message');
    } else if (!isComposing && prevComposingRef.current && (activeTab === 'message' || activeTab === 'inserer')) {
      setActiveTab('accueil');
    }
    prevComposingRef.current = isComposing;
  }, [isComposing, activeTab]);

  // Auto-switch to Recherche tab when search mode activates
  const prevSearchModeRef = useRef(isSearchMode);
  useEffect(() => {
    if (isSearchMode && !prevSearchModeRef.current) {
      setActiveTab('recherche');
    } else if (!isSearchMode && prevSearchModeRef.current && activeTab === 'recherche') {
      setActiveTab('accueil');
    }
    prevSearchModeRef.current = isSearchMode;
  }, [isSearchMode, activeTab]);

  // Available tabs in display order
  const tabs: RibbonTab[] = [
    ...(isSearchMode ? ['recherche'] as RibbonTab[] : []),
    'accueil',
    'afficher',
    ...((isComposing ? ['message', 'inserer'] : []) as RibbonTab[]),
  ];
  const tabLabel = (t: RibbonTab) => {
    if (t === 'recherche') return 'Recherche';
    if (t === 'accueil') return 'Accueil';
    if (t === 'afficher') return 'Afficher';
    if (t === 'message') return 'Message';
    return 'Insérer';
  };

  const openTabMenu = () => {
    if (tabMenuBtnRef.current) {
      const rect = tabMenuBtnRef.current.getBoundingClientRect();
      setTabMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowTabMenu(v => !v);
  };

  const openAttachmentMenu = () => {
    if (attachmentMenuBtnRef.current) {
      const rect = attachmentMenuBtnRef.current.getBoundingClientRect();
      setAttachmentMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowAttachmentMenu(v => !v);
  };

  const openFavoritesMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || favoritesMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setFavoritesMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowFavoritesMenu(v => !v);
  };

  const openReadingPaneMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || readingPaneMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setReadingPaneMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowReadingPaneMenu(v => !v);
  };

  const openConversationsMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || conversationsMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setConversationsMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowConversationsMenu(v => !v);
  };

  const openDensityMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || densityMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setDensityMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowDensityMenu(v => !v);
  };

  const openFolderFontMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || folderFontMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setFolderFontMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowFolderFontMenu(v => !v);
  };

  const openRecentFoldersMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || recentFoldersMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setRecentFoldersMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowRecentFoldersMenu(v => !v);
  };

  const openUnreadMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || unreadMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setUnreadMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowUnreadMenu(v => !v);
  };

  const openListModeMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || listModeMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setListModeMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowListModeMenu(v => !v);
  };

  const openMailDisplayMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || mailDisplayMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setMailDisplayMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowMailDisplayMenu(v => !v);
  };

  const openCategoryMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || categoryMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setCategoryMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowCategoryMenu(v => !v);
  };

  // Auto-switch between classic and simplified based on width
  useEffect(() => {
    const el = ribbonRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width < 700 && ribbonMode === 'classic') {
          onChangeRibbonMode('simplified');
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ribbonMode, onChangeRibbonMode]);

  // ─── Shared tab bar (used by both classic and simplified modes) ──
  const renderTabBar = (onToggle: () => void, toggleTitle: string, toggleRotated: boolean) => (
    <div className="flex items-center gap-0 px-2 border-b border-outlook-border">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors relative
            ${activeTab === tab
              ? 'text-outlook-blue'
              : 'text-outlook-text-secondary hover:text-outlook-text-primary hover:bg-outlook-bg-hover'
            }`}
        >
          {tabLabel(tab)}
          {activeTab === tab && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-outlook-blue rounded-t" />
          )}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={onToggle}
        className="text-outlook-text-disabled hover:text-outlook-text-secondary p-1 rounded hover:bg-outlook-bg-hover"
        title={toggleTitle}
      >
        <ChevronDown size={12} className={toggleRotated ? 'transition-transform rotate-180' : 'transition-transform'} />
      </button>
    </div>
  );

  // ─── Shared popup menus (rendered by both classic & simplified ribbons) ──
  const sharedPopups = (
    <>
      {/* Favorites mailbox menu */}
      {showFavoritesMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowFavoritesMenu(false)} />
          <FavoritesMailboxMenu
            top={favoritesMenuPos.top}
            left={favoritesMenuPos.left}
            accounts={accounts}
            prefsVersion={favPrefsVersion}
            onChanged={bumpFavPrefs}
            onClose={() => setShowFavoritesMenu(false)}
          />
        </>,
        document.body
      )}

      {/* Category picker — Accueil tab */}
      {showCategoryMenu && (
        <CategoryPicker
          top={categoryMenuPos.top}
          left={categoryMenuPos.left}
          assigned={messageCategoryIds}
          onToggle={(id) => onCategorize?.(id)}
          onClear={() => { onClearCategories?.(); setShowCategoryMenu(false); }}
          onCreate={() => { setShowCategoryMenu(false); onNewCategory?.(); }}
          onManage={() => { setShowCategoryMenu(false); onManageCategories?.(); }}
          onClose={() => setShowCategoryMenu(false)}
        />
      )}

      {/* Reading pane mode menu */}
      {showReadingPaneMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowReadingPaneMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-64"
            style={{ top: readingPaneMenuPos.top, left: readingPaneMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Volet de lecture
            </div>
            {[
              { id: 'right' as const, label: 'Afficher à droite', icon: Columns2 },
              { id: 'bottom' as const, label: 'Afficher en bas', icon: Rows2 },
              { id: 'hidden' as const, label: 'Plein écran', icon: EyeOff },
            ].map((opt) => {
              const Icon = opt.icon;
              const active = readingPaneMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => { onChangeReadingPaneMode && onChangeReadingPaneMode(opt.id); setShowReadingPaneMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue">
                    {active ? '✓' : ''}
                  </span>
                  <Icon size={14} className="text-outlook-text-secondary" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Conversations menu */}
      {showConversationsMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowConversationsMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-80"
            style={{ top: conversationsMenuPos.top, left: conversationsMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Liste de messages
            </div>
            {[
              { id: 'conversation' as const, label: 'Regrouper les messages par conversation' },
              { id: 'branches' as const, label: 'Regrouper les messages par branches dans les conversations' },
              { id: 'none' as const, label: 'Ne pas regrouper les messages' },
            ].map((opt) => {
              const active = conversationGrouping === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => { onChangeConversationGrouping && onChangeConversationGrouping(opt.id); setShowConversationsMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue">
                    {active ? '✓' : ''}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
            <div className="border-t border-outlook-border my-1" />
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Volet de lecture — Organisation des messages
            </div>
            {[
              { show: true, label: 'Afficher tous les messages de la conversation sélectionnée' },
              { show: false, label: 'Afficher uniquement le message sélectionné' },
            ].map((opt) => {
              const active = conversationShowAllInReadingPane === opt.show;
              return (
                <button
                  key={String(opt.show)}
                  onClick={() => {
                    if (conversationShowAllInReadingPane !== opt.show) {
                      onToggleConversationShowAllInReadingPane && onToggleConversationShowAllInReadingPane();
                    }
                    setShowConversationsMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                  disabled={conversationGrouping === 'none'}
                  style={conversationGrouping === 'none' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue">
                    {active ? '✓' : ''}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Density menu */}
      {showDensityMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowDensityMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-56"
            style={{ top: densityMenuPos.top, left: densityMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Densité
            </div>
            {[
              { id: 'spacious' as const, label: 'Spacieux' },
              { id: 'comfortable' as const, label: 'Confortable' },
              { id: 'compact' as const, label: 'Compacte' },
            ].map((opt) => {
              const active = listDensity === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => { onChangeListDensity && onChangeListDensity(opt.id); setShowDensityMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue">
                    {active ? '✓' : ''}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Folder pane font size menu */}
      {showFolderFontMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowFolderFontMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-64"
            style={{ top: folderFontMenuPos.top, left: folderFontMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Texte du volet « Dossiers »
            </div>
            {(['sm', 'md', 'lg', 'xl'] as FolderPaneFontSize[]).map((s) => {
              const active = folderFontSize === s;
              return (
                <button
                  key={s}
                  onClick={() => {
                    setFolderPaneFontSize(s);
                    setFolderFontSizeState(s);
                    setShowFolderFontMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover flex items-center gap-2"
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue">
                    {active ? '✓' : ''}
                  </span>
                  <span style={{ fontSize: `${FOLDER_PANE_FONT_SIZE_PX[s]}px` }}>
                    {FOLDER_PANE_FONT_SIZE_LABELS[s]}
                  </span>
                  <span className="ml-auto text-xs text-outlook-text-disabled">
                    {FOLDER_PANE_FONT_SIZE_PX[s]} px
                  </span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* List display mode menu */}
      {showListModeMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowListModeMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-64"
            style={{ top: listModeMenuPos.top, left: listModeMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Liste des mails
            </div>
            {[
              { id: 'auto' as const, label: 'Automatique (selon la largeur)' },
              { id: 'wide' as const, label: 'Une seule ligne (colonnes)' },
              { id: 'compact' as const, label: 'Aperçu multi-lignes' },
            ].map((opt) => {
              const active = listDisplayMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => { onChangeListDisplayMode && onChangeListDisplayMode(opt.id); setShowListModeMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue">
                    {active ? '✓' : ''}
                  </span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Mail body display mode menu (natif vs étiré) */}
      {showMailDisplayMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowMailDisplayMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-72"
            style={{ top: mailDisplayMenuPos.top, left: mailDisplayMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Affichage du corps des mails
            </div>
            {[
              { id: 'native' as const, label: 'Natif (largeur de lecture)', icon: Minimize2, hint: 'Limite la largeur du contenu pour une lecture confortable.' },
              { id: 'stretched' as const, label: 'Étiré (toute la largeur)', icon: Maximize2, hint: 'Le contenu remplit toute la largeur du volet.' },
            ].map((opt) => {
              const active = mailDisplayMode === opt.id;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  onClick={() => { onChangeMailDisplayMode && onChangeMailDisplayMode(opt.id); setShowMailDisplayMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-start gap-2"
                >
                  <span className="w-4 flex items-center justify-center text-outlook-blue mt-0.5">
                    {active ? '✓' : ''}
                  </span>
                  <Icon size={14} className="mt-0.5 text-outlook-text-secondary flex-shrink-0" />
                  <span className="flex flex-col">
                    <span>{opt.label}</span>
                    <span className="text-[11px] text-outlook-text-disabled">{opt.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Recent Move/Copy folders menu */}
      {showRecentFoldersMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowRecentFoldersMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-72"
            style={{ top: recentFoldersMenuPos.top, left: recentFoldersMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Dossiers récents (Déplacer / Copier)
            </div>
            <div className="px-3 pt-1 pb-2 text-[11px] text-outlook-text-secondary">
              Affiche les derniers dossiers utilisés en haut des sous-menus
              « Déplacer » et « Copier » pour un accès plus rapide.
            </div>

            {([
              { label: 'Déplacer', count: recentMoveCount, onChange: updateRecentMoveCount },
              { label: 'Copier', count: recentCopyCount, onChange: updateRecentCopyCount },
            ] as const).map((row) => (
              <div key={row.label} className="px-3 py-1.5 border-t border-outlook-border first:border-t-0">
                <div className="text-xs font-medium text-outlook-text-primary mb-1.5">{row.label}</div>
                <div className="flex items-center gap-1">
                  {([0, 1, 2, 3] as RecentFoldersCount[]).map((n) => {
                    const active = row.count === n;
                    return (
                      <button
                        key={n}
                        onClick={() => row.onChange(n)}
                        className={`flex-1 px-2 py-1 text-xs rounded border transition-colors
                          ${active
                            ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue font-medium'
                            : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-primary'
                          }`}
                        title={n === 0 ? 'Désactivé' : `${n} dossier${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}`}
                      >
                        {n === 0 ? 'Off' : n}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* Unread indicators menu — count / bold / red dot + scope */}
      {showUnreadMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowUnreadMenu(false)} />
          <div
            className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-80"
            style={{ top: unreadMenuPos.top, left: unreadMenuPos.left }}
          >
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Mails non lus — Indicateurs
            </div>
            <div className="px-3 pt-1 pb-2 text-[11px] text-outlook-text-secondary">
              Choisissez comment signaler la présence de mails non lus dans la
              liste des dossiers. Les trois indicateurs sont indépendants.
            </div>
            {([
              { id: 'showCount' as const, label: 'Nombre à la fin du nom (12)', hint: 'Comportement par défaut, identique à Outlook.' },
              { id: 'showBold' as const, label: 'Nom du dossier en gras', hint: 'Met le nom en évidence quand il y a des mails non lus.' },
              { id: 'showDot' as const, label: 'Pastille rouge', hint: 'Petit point rouge à côté de l\u2019icône.' },
            ]).map((opt) => {
              const active = unreadPrefs[opt.id];
              return (
                <button
                  key={opt.id}
                  onClick={() => updateUnreadPrefs({ [opt.id]: !active } as Partial<UnreadIndicatorPrefs>)}
                  className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover flex items-start gap-2"
                >
                  <span className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 border rounded ${active ? 'bg-outlook-blue border-outlook-blue text-white' : 'border-outlook-border'}`}>
                    {active ? '✓' : ''}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm">{opt.label}</span>
                    <span className="text-[11px] text-outlook-text-disabled">{opt.hint}</span>
                  </span>
                </button>
              );
            })}
            <div className="border-t border-outlook-border my-1" />
            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
              Appliquer aux dossiers
            </div>
            {(['inbox-only', 'favorites-only', 'inbox-and-favorites', 'all-folders'] as UnreadIndicatorScope[]).map((scope) => {
              const active = unreadPrefs.scope === scope;
              return (
                <button
                  key={scope}
                  onClick={() => updateUnreadPrefs({ scope })}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                  {UNREAD_SCOPE_LABELS[scope]}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </>
  );
  if (ribbonMode === 'simplified') {
    return (
      <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
        {renderTabBar(() => onChangeRibbonMode('classic'), 'Développer le ruban', false)}
        <div className="flex items-center px-2 py-0.5 gap-0.5 overflow-x-auto h-9">
          {activeTab === 'recherche' && (
            <SearchTabSimplified
              searchScope={searchScope}
              searchAccountId={searchAccountId}
              searchDatePreset={searchDatePreset}
              searchHasAttachment={searchHasAttachment}
              searchIsRead={searchIsRead}
              searchFrom={searchFrom}
              accounts={accounts}
              onSearchScopeChange={onSearchScopeChange}
              onSearchAccountChange={onSearchAccountChange}
              onSearchDatePresetChange={onSearchDatePresetChange}
              onSearchHasAttachmentChange={onSearchHasAttachmentChange}
              onSearchIsReadChange={onSearchIsReadChange}
              onSearchFromChange={onSearchFromChange}
              onSearchClear={onSearchClear}
              currentFolder={currentFolder}
            />
          )}
          {activeTab === 'accueil' && (
            <>
              <SimplifiedButton icon={MailPlus} label="Nouveau" onClick={onNewMessage} />
              <SimplifiedSep />
              <SimplifiedButton icon={Reply} label="Répondre" onClick={onReply} disabled={!hasSelectedMessage} />
              <SimplifiedButton icon={ReplyAll} label="Répondre à tous" onClick={onReplyAll} disabled={!hasSelectedMessage} />
              <SimplifiedButton icon={Forward} label="Transférer" onClick={onForward} disabled={!hasSelectedMessage} />
              <SimplifiedSep />
              <SimplifiedButton icon={Trash2} label="Supprimer" onClick={onDelete} disabled={!hasSelectedMessage} danger />
              <SimplifiedButton icon={Archive} label="Archiver" onClick={onArchive} disabled={!hasSelectedMessage} />
              <SimplifiedButton icon={Flag} label="Indicateur" onClick={onToggleFlag} disabled={!hasSelectedMessage} active={isFlagged} />
              <button
                ref={categoryMenuBtnRef}
                onClick={(e) => openCategoryMenu(e)}
                disabled={!hasSelectedMessage}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1
                  ${!hasSelectedMessage ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
                  ${showCategoryMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Catégoriser"
              >
                <Tag size={14} />
                <span className="text-xs whitespace-nowrap">Catégoriser</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              <SimplifiedButton
                icon={isRead ? EyeOff : Eye}
                label={isRead ? 'Non lu' : 'Lu'}
                onClick={isRead ? onMarkUnread : onMarkRead}
                disabled={!hasSelectedMessage}
              />
              <SimplifiedSep />
              <SimplifiedButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              {onSwapSplit && splitActive && (
                <>
                  <SimplifiedSep />
                  <SimplifiedButton icon={ArrowLeftRight} label="Inverser les côtés" onClick={onSwapSplit} />
                </>
              )}
            </>
          )}

          {activeTab === 'afficher' && (
            <>
              <SimplifiedButton
                icon={showFolderPane ? PanelLeftClose : PanelLeftOpen}
                label="Volet Dossiers"
                onClick={onToggleFolderPane}
                active={showFolderPane}
              />
              <button
                ref={readingPaneMenuBtnRef}
                onClick={(e) => openReadingPaneMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showReadingPaneMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Volet de lecture"
              >
                {readingPaneMode === 'bottom' ? <Rows2 size={14} /> : readingPaneMode === 'hidden' ? <EyeOff size={14} /> : <Columns2 size={14} />}
                <span className="text-xs whitespace-nowrap">Volet de lecture</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={listModeMenuBtnRef}
                onClick={(e) => openListModeMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showListModeMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Affichage de la liste des mails"
              >
                <ListIcon size={14} />
                <span className="text-xs whitespace-nowrap">Liste mail</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={mailDisplayMenuBtnRef}
                onClick={(e) => openMailDisplayMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showMailDisplayMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Affichage du corps des mails (natif / étiré)"
              >
                {mailDisplayMode === 'stretched' ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                <span className="text-xs whitespace-nowrap">Affichage mail</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={densityMenuBtnRef}
                onClick={(e) => openDensityMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showDensityMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Densité de la liste"
              >
                <AlignVerticalJustifyCenter size={14} />
                <span className="text-xs whitespace-nowrap">Densité</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={folderFontMenuBtnRef}
                onClick={(e) => openFolderFontMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showFolderFontMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Taille du texte du volet Dossiers"
              >
                <Type size={14} />
                <span className="text-xs whitespace-nowrap">Texte volet</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={unreadMenuBtnRef}
                onClick={(e) => openUnreadMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showUnreadMenu || unreadPrefs.showBold || unreadPrefs.showDot ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Mails non lus — affichage dans la liste des dossiers"
              >
                <BellDot size={14} />
                <span className="text-xs whitespace-nowrap">Non lus</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              <button
                ref={conversationsMenuBtnRef}
                onClick={(e) => openConversationsMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showConversationsMenu || conversationGrouping !== 'none' ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Conversations"
              >
                <MessagesSquare size={14} />
                <span className="text-xs whitespace-nowrap">Conversations</span>
                <ChevronDown size={10} />
              </button>
              <button
                ref={recentFoldersMenuBtnRef}
                onClick={(e) => openRecentFoldersMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showRecentFoldersMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Dossiers récents (Déplacer / Copier)"
              >
                <Clock size={14} />
                <span className="text-xs whitespace-nowrap">Dossiers récents</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              <SimplifiedButton
                icon={PanelLeftOpen}
                label="Côte à côte : Dossiers"
                onClick={() => onToggleSplitKeepFolderPane && onToggleSplitKeepFolderPane()}
                active={splitKeepFolderPane}
              />
              <SimplifiedButton
                icon={Mail}
                label="Côte à côte : Liste"
                onClick={() => onToggleSplitKeepMessageList && onToggleSplitKeepMessageList()}
                active={splitKeepMessageList}
              />
              <SimplifiedButton
                icon={Reply}
                label="Réponse à côté"
                onClick={() => onToggleSplitComposeReply && onToggleSplitComposeReply()}
                active={splitComposeReply}
              />
              <SimplifiedSep />
              <button
                onClick={(e) => openFavoritesMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showFavoritesMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Boîtes favoris"
              >
                <Star size={14} />
                <span className="text-xs whitespace-nowrap">Boîtes favoris</span>
                <ChevronDown size={10} />
              </button>
              <SimplifiedSep />
              {onOpenAutoResponder && (
                <>
                  <SimplifiedButton
                    icon={Coffee}
                    label="Répondeur"
                    onClick={() => onOpenAutoResponder()}
                    active={autoResponderEnabled}
                  />
                  <SimplifiedSep />
                </>
              )}
              {onOpenRules && (
                <>
                  <SimplifiedButton
                    icon={Filter}
                    label="Règles"
                    onClick={() => onOpenRules()}
                  />
                  <SimplifiedSep />
                </>
              )}
              <SimplifiedButton icon={Printer} label="Imprimer" onClick={onPrint} disabled={!hasSelectedMessage} />
              <SimplifiedButton icon={FileDown} label="Télécharger" onClick={onDownloadEml} disabled={!hasSelectedMessage} />
              <SimplifiedButton icon={Paperclip} label="Pièce jointe" onClick={() => {/* no-op in simplified */}} />
              <SimplifiedSep />
              <SimplifiedButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
            </>
          )}

          {activeTab === 'message' && (
            <MessageTabContent editorRef={composeEditorRef} compact />
          )}

          {activeTab === 'inserer' && (
            <InsererTabContent editorRef={composeEditorRef} onAttachFiles={onComposeAttachFiles} onToggleEmojiPanel={onToggleEmojiPanel} isEmojiPanelOpen={isEmojiPanelOpen} onToggleGifPanel={onToggleGifPanel} isGifPanelOpen={isGifPanelOpen} accounts={accounts} onOpenTemplatesPicker={onOpenTemplatesPicker} onOpenTemplatesManager={onOpenTemplatesManager} compact />
          )}
        </div>
        {sharedPopups}
      </div>
    );
  }

  // ─── Classic ribbon ─────────────────────────────────────────

  return (
    <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
      {renderTabBar(() => onChangeRibbonMode('simplified'), 'Réduire le ruban', true)}

      {/* Ribbon content — fixed height for standard tabs; auto for search tab */}
        <div className={`flex items-center px-2 py-1 gap-1 overflow-x-auto overflow-y-hidden ${activeTab === 'recherche' ? 'min-h-[72px] h-auto' : 'h-[80px]'}`}>
          {activeTab === 'recherche' && (
            <SearchTabClassic
              searchScope={searchScope}
              searchAccountId={searchAccountId}
              searchDatePreset={searchDatePreset}
              searchHasAttachment={searchHasAttachment}
              searchIsRead={searchIsRead}
              searchFrom={searchFrom}
              accounts={accounts}
              onSearchScopeChange={onSearchScopeChange}
              onSearchAccountChange={onSearchAccountChange}
              onSearchDatePresetChange={onSearchDatePresetChange}
              onSearchHasAttachmentChange={onSearchHasAttachmentChange}
              onSearchIsReadChange={onSearchIsReadChange}
              onSearchFromChange={onSearchFromChange}
              onSearchClear={onSearchClear}
              currentFolder={currentFolder}
            />
          )}
          {activeTab === 'accueil' && (
            <>
              {/* Nouveau */}
              <RibbonGroup label="Nouveau">
                <RibbonButton icon={MailPlus} label="Nouveau message" onClick={onNewMessage} />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Répondre */}
              <RibbonGroup label="Répondre">
                <RibbonButton icon={Reply} label="Répondre" onClick={onReply} disabled={!hasSelectedMessage} />
                <RibbonButton icon={ReplyAll} label="Répondre à tous" onClick={onReplyAll} disabled={!hasSelectedMessage} />
                <RibbonButton icon={Forward} label="Transférer" onClick={onForward} disabled={!hasSelectedMessage} />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Actions */}
              <RibbonGroup label="Actions">
                <RibbonButton icon={Trash2} label="Supprimer" onClick={onDelete} disabled={!hasSelectedMessage} danger />
                <RibbonButton icon={Archive} label="Archiver" onClick={onArchive} disabled={!hasSelectedMessage} />
                <RibbonButton
                  icon={Flag}
                  label={isFlagged ? 'Désindiquer' : 'Indicateur'}
                  onClick={onToggleFlag}
                  disabled={!hasSelectedMessage}
                  active={isFlagged}
                />
                <div className="relative">
                  <button
                    ref={categoryMenuBtnRef}
                    onClick={(e) => openCategoryMenu(e)}
                    disabled={!hasSelectedMessage}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px]
                      ${!hasSelectedMessage ? 'opacity-40 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
                      ${showCategoryMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Catégoriser"
                  >
                    <Tag size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Catégoriser <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
              </RibbonGroup>
              <RibbonSeparator />

              {/* Marquer */}
              <RibbonGroup label="Marquer">
                <RibbonButton
                  icon={isRead ? EyeOff : Eye}
                  label={isRead ? 'Non lu' : 'Lu'}
                  onClick={isRead ? onMarkUnread : onMarkRead}
                  disabled={!hasSelectedMessage}
                />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Synchroniser */}
              <RibbonGroup label="Messages">
                <RibbonButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              </RibbonGroup>
              {onSwapSplit && splitActive && (
                <>
                  <RibbonSeparator />
                  <RibbonGroup label="Vue">
                    <RibbonButton icon={ArrowLeftRight} label="Inverser les côtés" onClick={onSwapSplit} />
                  </RibbonGroup>
                </>
              )}
            </>
          )}

          {activeTab === 'message' && (
            <MessageTabContent editorRef={composeEditorRef} />
          )}

          {activeTab === 'inserer' && (
            <InsererTabContent editorRef={composeEditorRef} onAttachFiles={onComposeAttachFiles} onToggleEmojiPanel={onToggleEmojiPanel} isEmojiPanelOpen={isEmojiPanelOpen} onToggleGifPanel={onToggleGifPanel} isGifPanelOpen={isGifPanelOpen} accounts={accounts} onOpenTemplatesPicker={onOpenTemplatesPicker} onOpenTemplatesManager={onOpenTemplatesManager} />
          )}

          {activeTab === 'afficher' && (
            <>
              {/* Disposition */}
              <RibbonGroup label="Disposition">
                <RibbonButton
                  icon={showFolderPane ? PanelLeftClose : PanelLeftOpen}
                  label="Volet Dossiers"
                  onClick={onToggleFolderPane}
                  active={showFolderPane}
                />
                <div className="relative">
                  <button
                    ref={readingPaneMenuBtnRef}
                    onClick={(e) => openReadingPaneMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showReadingPaneMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Volet de lecture"
                  >
                    {readingPaneMode === 'bottom' ? <Rows2 size={18} /> : readingPaneMode === 'hidden' ? <EyeOff size={18} /> : <Columns2 size={18} />}
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Volet de lecture <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={listModeMenuBtnRef}
                    onClick={(e) => openListModeMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showListModeMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Affichage de la liste des mails"
                  >
                    <ListIcon size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Liste mail <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={mailDisplayMenuBtnRef}
                    onClick={(e) => openMailDisplayMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showMailDisplayMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Affichage du corps des mails (natif / étiré)"
                  >
                    {mailDisplayMode === 'stretched' ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Affichage mail <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={densityMenuBtnRef}
                    onClick={(e) => openDensityMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showDensityMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Densité de la liste"
                  >
                    <AlignVerticalJustifyCenter size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Densité <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={folderFontMenuBtnRef}
                    onClick={(e) => openFolderFontMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showFolderFontMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Taille du texte du volet Dossiers"
                  >
                    <Type size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Texte volet <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={unreadMenuBtnRef}
                    onClick={(e) => openUnreadMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showUnreadMenu || unreadPrefs.showBold || unreadPrefs.showDot ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Mails non lus — affichage dans la liste des dossiers"
                  >
                    <BellDot size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Non lus <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={conversationsMenuBtnRef}
                    onClick={(e) => openConversationsMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showConversationsMenu || conversationGrouping !== 'none' ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Conversations"
                  >
                    <MessagesSquare size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Conversations <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
                <div className="relative">
                  <button
                    ref={recentFoldersMenuBtnRef}
                    onClick={(e) => openRecentFoldersMenu(e)}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer ${showRecentFoldersMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                    title="Dossiers récents pour Déplacer / Copier"
                  >
                    <Clock size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Dossiers récents <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
              </RibbonGroup>
              <RibbonSeparator />

              {/* Côte à côte — personnalisation des volets en vue split */}
              <RibbonGroup label="Côte à côte">
                <RibbonButton
                  icon={PanelLeftOpen}
                  label={splitKeepFolderPane ? 'Dossiers visibles' : 'Dossiers masqués'}
                  onClick={() => onToggleSplitKeepFolderPane && onToggleSplitKeepFolderPane()}
                  active={splitKeepFolderPane}
                  small
                />
                <RibbonButton
                  icon={Mail}
                  label={splitKeepMessageList ? 'Liste visible' : 'Liste masquée'}
                  onClick={() => onToggleSplitKeepMessageList && onToggleSplitKeepMessageList()}
                  active={splitKeepMessageList}
                  small
                />
                <RibbonButton
                  icon={Reply}
                  label={splitComposeReply ? 'Réponse à côté' : 'Réponse normale'}
                  onClick={() => onToggleSplitComposeReply && onToggleSplitComposeReply()}
                  active={splitComposeReply}
                  small
                />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Favoris — gérer les boîtes mails inclues dans les vues unifiées */}
              <RibbonGroup label="Favoris">
                <div className="relative">
                  <button
                    ref={favoritesMenuBtnRef}
                    onClick={(e) => openFavoritesMenu(e)}
                    className="flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer"
                    title="Gérer les boîtes mails pour les favoris"
                  >
                    <Star size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Boîtes favoris <ChevronDown size={8} />
                    </span>
                  </button>
                </div>
              </RibbonGroup>
              <RibbonSeparator />

              {/* Onglets */}
              <RibbonGroup label="Onglets">
                <div className="relative">
                  <button
                    ref={tabMenuBtnRef}
                    onClick={openTabMenu}
                    className={`flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px]
                      hover:bg-outlook-bg-hover cursor-pointer`}
                    title="Paramètres des onglets"
                  >
                    <Layers size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Onglets <ChevronDown size={8} />
                    </span>
                  </button>
                  {showTabMenu && createPortal(
                    <>
                      <div className="fixed inset-0 z-[9998]" onClick={() => setShowTabMenu(false)} />
                      <div
                        className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-56"
                        style={{ top: tabMenuPos.top, left: tabMenuPos.left }}
                      >
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
                          Mode d'ouverture
                        </div>
                        <button
                          onClick={() => { onChangeTabMode('drafts-only'); setShowTabMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                        >
                          <span className={`w-2 h-2 rounded-full ${tabMode === 'drafts-only' ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                          Brouillons uniquement
                        </button>
                        <button
                          onClick={() => { onChangeTabMode('all-opened'); setShowTabMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                        >
                          <span className={`w-2 h-2 rounded-full ${tabMode === 'all-opened' ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                          Tous les mails ouverts
                        </button>
                        {tabMode === 'all-opened' && (
                          <>
                            <div className="border-t border-outlook-border my-1" />
                            <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
                              Nombre max d'onglets
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <button
                                onClick={() => onChangeMaxTabs(Math.max(2, maxTabs - 1))}
                                className="p-0.5 rounded hover:bg-outlook-bg-hover"
                              >
                                <Minus size={14} />
                              </button>
                              <span className="text-sm font-medium w-6 text-center">{maxTabs}</span>
                              <button
                                onClick={() => onChangeMaxTabs(Math.min(20, maxTabs + 1))}
                                className="p-0.5 rounded hover:bg-outlook-bg-hover"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </RibbonGroup>
              <RibbonSeparator />

              {/* Actions sur le message */}
              <RibbonGroup label="Actions">
                <RibbonButton icon={Printer} label="Imprimer" onClick={onPrint} disabled={!hasSelectedMessage} />
                <RibbonButton icon={FileDown} label="Télécharger" onClick={onDownloadEml} disabled={!hasSelectedMessage} />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Répondeur (vacation responder) */}
              {onOpenAutoResponder && (
                <>
                  <RibbonGroup label="Absence">
                    <RibbonButton
                      icon={Coffee}
                      label="Répondeur"
                      onClick={() => onOpenAutoResponder()}
                      active={autoResponderEnabled}
                    />
                  </RibbonGroup>
                  <RibbonSeparator />
                </>
              )}

              {/* Règles */}
              {onOpenRules && (
                <>
                  <RibbonGroup label="Règles">
                    <RibbonButton
                      icon={Filter}
                      label="Règles"
                      onClick={() => onOpenRules()}
                    />
                  </RibbonGroup>
                  <RibbonSeparator />
                </>
              )}

              {/* Pièces jointes */}
              <RibbonGroup label="Pièce jointe">
                <div className="relative">
                  <button
                    ref={attachmentMenuBtnRef}
                    onClick={openAttachmentMenu}
                    className="flex flex-col items-center gap-0.5 rounded transition-colors px-2 py-1 min-w-[48px] hover:bg-outlook-bg-hover cursor-pointer"
                    title="Comportement des pièces jointes"
                  >
                    <Paperclip size={18} />
                    <span className="text-[10px] leading-tight text-center whitespace-nowrap flex items-center gap-0.5">
                      Pièce jointe <ChevronDown size={8} />
                    </span>
                  </button>
                  {showAttachmentMenu && createPortal(
                    <>
                      <div className="fixed inset-0 z-[9998]" onClick={() => setShowAttachmentMenu(false)} />
                      <div
                        className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-56"
                        style={{ top: attachmentMenuPos.top, left: attachmentMenuPos.left }}
                      >
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
                          Ouverture des pièces jointes
                        </div>
                        <button
                          onClick={() => { onChangeAttachmentActionMode('preview'); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                        >
                          <span className={`w-2 h-2 rounded-full ${attachmentActionMode === 'preview' ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                          Aperçu
                        </button>
                        <button
                          onClick={() => { onChangeAttachmentActionMode('download'); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                        >
                          <span className={`w-2 h-2 rounded-full ${attachmentActionMode === 'download' ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                          Téléchargement
                        </button>
                        <button
                          onClick={() => { onChangeAttachmentActionMode('menu'); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                        >
                          <span className={`w-2 h-2 rounded-full ${attachmentActionMode === 'menu' ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                          Menu (Aperçu / Téléchargement)
                        </button>
                        <button
                          onClick={() => { onChangeAttachmentActionMode('nextcloud'); setShowAttachmentMenu(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
                        >
                          <span className={`w-2 h-2 rounded-full ${attachmentActionMode === 'nextcloud' ? 'bg-outlook-blue' : 'bg-transparent border border-outlook-border'}`} />
                          Nextcloud
                        </button>
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </RibbonGroup>
              <RibbonSeparator />

              {/* Sécurité — confirmations et garde-fous utilisateur */}
              <RibbonGroup label="Sécurité">
                <RibbonButton
                  icon={deleteConfirmEnabled ? ShieldAlert : ShieldOff}
                  label={deleteConfirmEnabled ? 'Confirmer suppr.' : 'Suppr. directe'}
                  onClick={toggleDeleteConfirm}
                  active={deleteConfirmEnabled}
                />
              </RibbonGroup>
              <RibbonSeparator />

              {/* Synchroniser */}
              <RibbonGroup label="Messages">
                <RibbonButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              </RibbonGroup>
            </>
          )}
        </div>

        {/* Shared popup menus (favorites / category / reading pane / conversations / density / list mode) */}
        {sharedPopups}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Favorites mailbox management menu (Afficher tab)
// ─────────────────────────────────────────────────────────────────────────────
function FavoritesMailboxMenu({
  top, left, accounts, prefsVersion, onChanged, onClose,
}: {
  top: number; left: number; accounts: MailAccount[];
  prefsVersion: number; onChanged: () => void; onClose: () => void;
}) {
  // Read current state (re-read on each render because prefsVersion bumps)
  const unifiedInboxEnabled = getUnifiedInboxEnabled();
  const unifiedSentEnabled = getUnifiedSentEnabled();
  const selected = getUnifiedAccountIds();
  // Empty selection means "all accounts"
  const effectiveSet = new Set<string>(selected.length ? selected : accounts.map((a) => a.id));
  // Reference prefsVersion so the component re-renders when it changes
  void prefsVersion;

  // Live list of categories — re-renders when categories change in any tab.
  const [catVersion, setCatVersion] = useState(0);
  useEffect(() => subscribeCategories(() => setCatVersion((n) => n + 1)), []);
  const categories: MailCategory[] = (() => { void catVersion; return getMailCategories(); })();
  const favoriteCount = categories.filter((c) => c.isFavorite).length;

  const toggleAllCategories = () => {
    // If at least one category is not favorite → mark all favorites; else clear all.
    const allFavorite = categories.length > 0 && favoriteCount === categories.length;
    const list = getMailCategories();
    list.forEach((c) => {
      if (allFavorite ? c.isFavorite : !c.isFavorite) {
        toggleCategoryFavorite(c.id);
      }
    });
    onChanged();
  };

  const toggleAccount = (id: string) => {
    const current = getUnifiedAccountIds();
    const baseSet = new Set<string>(current.length ? current : accounts.map((a) => a.id));
    if (baseSet.has(id)) baseSet.delete(id);
    else baseSet.add(id);
    // If all accounts are selected, persist as empty ("all")
    const ids = Array.from(baseSet);
    if (ids.length === accounts.length) {
      setUnifiedAccountIds([]);
    } else {
      setUnifiedAccountIds(ids);
    }
    onChanged();
  };

  const selectAll = () => {
    setUnifiedAccountIds([]);
    onChanged();
  };

  return (
    <div
      className="fixed bg-white border border-outlook-border rounded-md shadow-lg py-1 z-[9999] min-w-72 max-w-80"
      style={{ top, left }}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
        Vues unifiées
      </div>
      <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover cursor-pointer">
        <input
          type="checkbox"
          checked={unifiedInboxEnabled}
          onChange={(e) => { setUnifiedInboxEnabled(e.target.checked); onChanged(); }}
        />
        <span>Afficher « Boîte de réception » dans les favoris</span>
      </label>
      <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover cursor-pointer">
        <input
          type="checkbox"
          checked={unifiedSentEnabled}
          onChange={(e) => { setUnifiedSentEnabled(e.target.checked); onChanged(); }}
        />
        <span>Afficher « Éléments envoyés » dans les favoris</span>
      </label>

      <div className="border-t border-outlook-border my-1" />
      <div className="flex items-center justify-between px-3 py-1 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
        <span>Boîtes mails incluses</span>
        <button
          onClick={selectAll}
          className="text-[10px] normal-case font-normal text-outlook-blue hover:underline"
          title="Inclure toutes les boîtes"
        >
          Tout inclure
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {accounts.length === 0 && (
          <div className="px-3 py-2 text-xs text-outlook-text-disabled">
            Aucune boîte mail configurée.
          </div>
        )}
        {accounts.map((account) => {
          const checked = effectiveSet.has(account.id);
          return (
            <label
              key={account.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover cursor-pointer"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleAccount(account.id)}
              />
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: account.color }}
              />
              <span className="truncate flex-1">{getAccountDisplayName(account)}</span>
            </label>
          );
        })}
      </div>

      <div className="border-t border-outlook-border my-1" />
      <div className="flex items-center justify-between px-3 py-1 text-[10px] font-semibold text-outlook-text-disabled uppercase tracking-wide">
        <span>Catégories dans les favoris</span>
        {categories.length > 0 && (
          <button
            onClick={toggleAllCategories}
            className="text-[10px] normal-case font-normal text-outlook-blue hover:underline"
            title={favoriteCount === categories.length ? 'Retirer toutes les catégories des favoris' : 'Ajouter toutes les catégories aux favoris'}
          >
            {favoriteCount === categories.length ? 'Tout retirer' : 'Tout inclure'}
          </button>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto">
        {categories.length === 0 && (
          <div className="px-3 py-2 text-xs text-outlook-text-disabled">
            Aucune catégorie. Créez-en depuis l'onglet Accueil.
          </div>
        )}
        {categories.map((cat) => {
          const checked = !!cat.isFavorite;
          return (
            <label
              key={cat.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover cursor-pointer"
              title="Afficher cette catégorie comme dossier unifié dans les favoris"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => { toggleCategoryFavorite(cat.id); onChanged(); }}
              />
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="truncate flex-1">{cat.name}</span>
            </label>
          );
        })}
      </div>

      <div className="border-t border-outlook-border my-1" />
      <button
        onClick={onClose}
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover text-outlook-text-secondary"
      >
        Fermer
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared editor helpers (hook used by Message & Insérer tabs)
// ─────────────────────────────────────────────────────────────────────────────
function useEditorControl(editorRef?: React.RefObject<HTMLDivElement>) {
  const savedRangeRef = useRef<Range | null>(null);
  const focusEditor = () => { editorRef?.current?.focus(); };
  const exec = (command: string, value?: string) => {
    focusEditor();
    document.execCommand(command, false, value);
  };
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef?.current?.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    }
  };
  const restoreSelection = () => {
    const range = savedRangeRef.current;
    focusEditor();
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };
  const insertHTML = (html: string) => {
    restoreSelection();
    document.execCommand('insertHTML', false, html);
  };
  return { exec, saveSelection, restoreSelection, insertHTML, focusEditor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Message tab — rich text formatting tools (Outlook-style, grouped)
// ─────────────────────────────────────────────────────────────────────────────
function MessageTabContent({ editorRef, compact = false }: { editorRef?: React.RefObject<HTMLDivElement>; compact?: boolean }) {
  const { exec, saveSelection, restoreSelection, insertHTML } = useEditorControl(editorRef);
  const [showFontFamily, setShowFontFamily] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);
  const [showTextColor, setShowTextColor] = useState(false);
  const [showBgColor, setShowBgColor] = useState(false);
  const [showStyles, setShowStyles] = useState(false);
  const [currentFont, setCurrentFont] = useState('Calibri');
  const [currentSize, setCurrentSize] = useState('12');
  const fontFamilyBtnRef = useRef<HTMLButtonElement | null>(null);
  const fontSizeBtnRef = useRef<HTMLButtonElement | null>(null);
  const stylesBtnRef = useRef<HTMLButtonElement | null>(null);
  const textColorBtnRef = useRef<HTMLButtonElement | null>(null);
  const bgColorBtnRef = useRef<HTMLButtonElement | null>(null);

  const applyFont = (font: string) => {
    restoreSelection();
    exec('fontName', font);
    setCurrentFont(font);
    setShowFontFamily(false);
  };

  const applySize = (size: string) => {
    restoreSelection();
    const sizeMap: Record<string, string> = {
      '8': '1', '9': '1', '10': '2', '11': '2', '12': '3', '14': '3',
      '16': '4', '18': '4', '20': '5', '24': '5', '28': '6', '36': '6', '48': '7', '72': '7',
    };
    exec('fontSize', sizeMap[size] || '3');
    setCurrentSize(size);
    setShowFontSize(false);
  };

  const applyStyle = (tag: string) => {
    restoreSelection();
    exec('formatBlock', tag);
    setShowStyles(false);
  };

  const closeAllDropdowns = () => {
    setShowFontFamily(false);
    setShowFontSize(false);
    setShowTextColor(false);
    setShowBgColor(false);
    setShowStyles(false);
  };

  const iconBtn = 'w-7 h-7 flex items-center justify-center rounded hover:bg-outlook-bg-hover transition-colors text-outlook-text-secondary hover:text-outlook-text-primary';
  const vDivider = <div className="w-px h-5 bg-outlook-border mx-0.5 self-center" />;

  // ─── Compact (simplified) rendering ─────────────────────────────
  if (compact) {
    return (
      <>
        <SimplifiedButton icon={Bold} label="Gras" onClick={() => exec('bold')} />
        <SimplifiedButton icon={Italic} label="Italique" onClick={() => exec('italic')} />
        <SimplifiedButton icon={Underline} label="Souligné" onClick={() => exec('underline')} />
        <SimplifiedButton icon={Strikethrough} label="Barré" onClick={() => exec('strikeThrough')} />
        <SimplifiedSep />
        <SimplifiedButton icon={List} label="Puces" onClick={() => exec('insertUnorderedList')} />
        <SimplifiedButton icon={ListOrdered} label="Numérotée" onClick={() => exec('insertOrderedList')} />
        <SimplifiedSep />
        <SimplifiedButton icon={AlignLeft} label="Gauche" onClick={() => exec('justifyLeft')} />
        <SimplifiedButton icon={AlignCenter} label="Centrer" onClick={() => exec('justifyCenter')} />
        <SimplifiedButton icon={AlignRight} label="Droite" onClick={() => exec('justifyRight')} />
        <SimplifiedSep />
        <SimplifiedButton icon={Quote} label="Citation" onClick={() => exec('formatBlock', 'blockquote')} />
        <SimplifiedButton icon={Code} label="Code" onClick={() => insertHTML('<code></code>')} />
        <SimplifiedButton icon={Eraser} label="Effacer" onClick={() => exec('removeFormat')} />
      </>
    );
  }

  // ─── Classic rendering ──────────────────────────────────────────
  return (
    <>
      {/* Presse-papiers */}
      <RibbonGroup label="Presse-papiers">
        <div className="flex items-center gap-0.5">
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('paste')}
            className="flex flex-col items-center gap-0.5 rounded hover:bg-outlook-bg-hover px-2 py-1 min-w-[40px]"
            title="Coller">
            <Paperclip size={18} className="opacity-0 hidden" />
            <span className="text-[11px] font-medium text-outlook-text-primary">Coller</span>
            <span className="text-[9px] leading-tight text-outlook-text-disabled">Ctrl+V</span>
          </button>
          <div className="flex flex-col gap-0.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('cut')}
              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary text-left"
              title="Couper (Ctrl+X)">
              Couper
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('copy')}
              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary text-left"
              title="Copier (Ctrl+C)">
              Copier
            </button>
          </div>
        </div>
      </RibbonGroup>
      <RibbonSeparator />

      {/* Texte de base */}
      <RibbonGroup label="Texte de base">
        <div className="flex flex-col gap-1 min-w-[280px]">
          {/* Row 1: font family, font size, clear */}
          <div className="flex items-center gap-1">
            <div>
              <button
                ref={fontFamilyBtnRef}
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowFontFamily(s => !s); }}
                className="flex items-center gap-1 text-xs border border-outlook-border rounded px-2 py-0.5 hover:bg-outlook-bg-hover min-w-[120px] justify-between bg-white"
              >
                <span style={{ fontFamily: currentFont }} className="truncate">{currentFont}</span>
                <ChevronDown size={10} className="flex-shrink-0" />
              </button>
              {showFontFamily && (
                <AnchoredPortal anchorEl={fontFamilyBtnRef.current} onClose={() => setShowFontFamily(false)}>
                  <div className="bg-white border border-outlook-border rounded shadow-lg min-w-44 max-h-64 overflow-y-auto">
                    {FONT_FAMILIES.map(f => (
                      <button key={f} onMouseDown={(e) => { e.preventDefault(); applyFont(f); }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover" style={{ fontFamily: f }}>
                        {f}
                      </button>
                    ))}
                  </div>
                </AnchoredPortal>
              )}
            </div>
            <div>
              <button
                ref={fontSizeBtnRef}
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowFontSize(s => !s); }}
                className="flex items-center gap-1 text-xs border border-outlook-border rounded px-2 py-0.5 hover:bg-outlook-bg-hover w-16 justify-between bg-white"
              >
                <span>{currentSize}</span>
                <ChevronDown size={10} />
              </button>
              {showFontSize && (
                <AnchoredPortal anchorEl={fontSizeBtnRef.current} onClose={() => setShowFontSize(false)}>
                  <div className="bg-white border border-outlook-border rounded shadow-lg w-16 max-h-64 overflow-y-auto">
                    {FONT_SIZES.map(s => (
                      <button key={s} onMouseDown={(e) => { e.preventDefault(); applySize(s); }}
                        className="w-full text-left px-3 py-1 text-xs hover:bg-outlook-bg-hover">
                        {s}
                      </button>
                    ))}
                  </div>
                </AnchoredPortal>
              )}
            </div>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} className={iconBtn} title="Effacer la mise en forme">
              <Eraser size={13} />
            </button>
            {vDivider}
            {/* Styles (headings) */}
            <div>
              <button
                ref={stylesBtnRef}
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowStyles(s => !s); }}
                className="flex items-center gap-1 text-xs border border-outlook-border rounded px-2 py-0.5 hover:bg-outlook-bg-hover bg-white"
                title="Styles"
              >
                <PenLine size={12} />
                <span>Styles</span>
                <ChevronDown size={10} />
              </button>
              {showStyles && (
                <AnchoredPortal anchorEl={stylesBtnRef.current} onClose={() => setShowStyles(false)}>
                  <div className="bg-white border border-outlook-border rounded shadow-lg min-w-40">
                  <button onMouseDown={(e) => { e.preventDefault(); applyStyle('p'); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover">
                    Paragraphe
                  </button>
                  <button onMouseDown={(e) => { e.preventDefault(); applyStyle('h1'); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover">
                    <span className="text-lg font-bold">Titre 1</span>
                  </button>
                  <button onMouseDown={(e) => { e.preventDefault(); applyStyle('h2'); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover">
                    <span className="text-base font-semibold">Titre 2</span>
                  </button>
                  <button onMouseDown={(e) => { e.preventDefault(); applyStyle('h3'); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover">
                    <span className="text-sm font-semibold">Titre 3</span>
                  </button>
                  <button onMouseDown={(e) => { e.preventDefault(); applyStyle('blockquote'); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover italic text-outlook-text-secondary">
                    Citation
                  </button>
                    <button onMouseDown={(e) => { e.preventDefault(); applyStyle('pre'); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover font-mono">
                      Code
                    </button>
                  </div>
                </AnchoredPortal>
              )}
            </div>
          </div>
          {/* Row 2: bold/italic/underline/strike + sub/sup + colors */}
          <div className="flex items-center gap-0.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} className={iconBtn} title="Gras (Ctrl+B)">
              <Bold size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} className={iconBtn} title="Italique (Ctrl+I)">
              <Italic size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} className={iconBtn} title="Souligné (Ctrl+U)">
              <Underline size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('strikeThrough')} className={iconBtn} title="Barré">
              <Strikethrough size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('subscript')} className={iconBtn} title="Indice">
              <Subscript size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('superscript')} className={iconBtn} title="Exposant">
              <Superscript size={13} />
            </button>
            {vDivider}
            {/* Text color */}
            <div>
              <button
                ref={textColorBtnRef}
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowTextColor(s => !s); }}
                className={`${iconBtn} flex-col gap-0`}
                title="Couleur du texte"
              >
                <Type size={11} />
                <div className="w-4 h-1 rounded-sm bg-red-500 mt-0.5" />
              </button>
              {showTextColor && (
                <AnchoredPortal anchorEl={textColorBtnRef.current} onClose={() => setShowTextColor(false)}>
                  <RibbonColorPickerPanel
                    onSelect={(color) => { restoreSelection(); exec('foreColor', color); setShowTextColor(false); }}
                  />
                </AnchoredPortal>
              )}
            </div>
            {/* Highlight color */}
            <div>
              <button
                ref={bgColorBtnRef}
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowBgColor(s => !s); }}
                className={`${iconBtn} flex-col gap-0`}
                title="Couleur de surlignage"
              >
                <Palette size={11} />
                <div className="w-4 h-1 rounded-sm bg-yellow-300 mt-0.5" />
              </button>
              {showBgColor && (
                <AnchoredPortal anchorEl={bgColorBtnRef.current} onClose={() => setShowBgColor(false)}>
                  <RibbonColorPickerPanel
                    onSelect={(color) => { restoreSelection(); exec('hiliteColor', color); setShowBgColor(false); }}
                  />
                </AnchoredPortal>
              )}
            </div>
          </div>
        </div>
      </RibbonGroup>
      <RibbonSeparator />

      {/* Paragraphe */}
      <RibbonGroup label="Paragraphe">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-0.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} className={iconBtn} title="Liste à puces">
              <List size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} className={iconBtn} title="Liste numérotée">
              <ListOrdered size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('outdent')} className={iconBtn} title="Diminuer le retrait">
              <Outdent size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('indent')} className={iconBtn} title="Augmenter le retrait">
              <Indent size={13} />
            </button>
            {vDivider}
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'blockquote')} className={iconBtn} title="Citation">
              <Quote size={13} />
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyLeft')} className={iconBtn} title="Aligner à gauche">
              <AlignLeft size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyCenter')} className={iconBtn} title="Centrer">
              <AlignCenter size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyRight')} className={iconBtn} title="Aligner à droite">
              <AlignRight size={13} />
            </button>
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyFull')} className={iconBtn} title="Justifier">
              <AlignJustify size={13} />
            </button>
          </div>
        </div>
      </RibbonGroup>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Insérer tab — Outlook-web-style insertion tools
// ─────────────────────────────────────────────────────────────────────────────
function InsererTabContent({ editorRef, onAttachFiles, onToggleEmojiPanel, isEmojiPanelOpen = false, onToggleGifPanel, isGifPanelOpen = false, compact = false, accounts = [], onOpenTemplatesPicker, onOpenTemplatesManager }: {
  editorRef?: React.RefObject<HTMLDivElement>;
  onAttachFiles?: (files: FileList | File[]) => void;
  onToggleEmojiPanel?: () => void;
  isEmojiPanelOpen?: boolean;
  onToggleGifPanel?: () => void;
  isGifPanelOpen?: boolean;
  compact?: boolean;
  accounts?: MailAccount[];
  onOpenTemplatesPicker?: () => void;
  onOpenTemplatesManager?: () => void;
}) {
  const { exec, saveSelection, restoreSelection, insertHTML } = useEditorControl(editorRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const linkBtnRef = useRef<HTMLElement | null>(null);
  const emojiBtnRef = useRef<HTMLElement | null>(null);
  const tableBtnRef = useRef<HTMLElement | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(false);

  // ── Nextcloud file picker ─────────────────────────────────────────────
  const [ncLinked, setNcLinked] = useState(false);
  const [showNcPicker, setShowNcPicker] = useState(false);
  const [ncAttaching, setNcAttaching] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Use the same status endpoint as the bottom status bar (more reliable than files/status).
    api.getUserNextcloudStatus()
      .then(s => { if (!cancelled) setNcLinked(!!(s.enabled && s.linked)); })
      .catch(() => { if (!cancelled) setNcLinked(false); });
    return () => { cancelled = true; };
  }, []);

  const handleNcPick = async (files: NextcloudFileItem[]) => {
    setShowNcPicker(false);
    if (!files.length || !onAttachFiles) return;
    setNcAttaching(true);
    try {
      const fileObjects: File[] = [];
      for (const item of files) {
        const res = await api.nextcloudFilesGet(item.path);
        const mimeType = (res.contentType || '').split(';')[0].trim() || 'application/octet-stream';
        const bytes = Uint8Array.from(atob(res.contentBase64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType });
        fileObjects.push(new File([blob], res.filename || item.name, { type: mimeType }));
      }
      onAttachFiles(fileObjects);
      toast.success(`${fileObjects.length} fichier${fileObjects.length > 1 ? 's' : ''} joint${fileObjects.length > 1 ? 's' : ''} depuis Nextcloud`);
    } catch (e: any) {
      toast.error(`Erreur Nextcloud : ${e?.message || 'Échec du téléchargement'}`);
    } finally {
      setNcAttaching(false);
    }
  };

  // ── Signatures ───────────────────────────────────────────────────────
  const signatureBtnRef = useRef<HTMLElement | null>(null);
  const [showSignatureMenu, setShowSignatureMenu] = useState(false);
  const [showSignaturesManager, setShowSignaturesManager] = useState(false);
  const [signatures, setSignatures] = useState<MailSignature[]>(() => getSignatures());
  useEffect(() => {
    const handler = () => setSignatures(getSignatures());
    window.addEventListener('mail.signatures.changed', handler);
    return () => window.removeEventListener('mail.signatures.changed', handler);
  }, []);

  const insertSignature = (sig: MailSignature) => {
    restoreSelection();
    insertHTML(wrapSignatureHtml(sig.html));
    setShowSignatureMenu(false);
  };

  const handleEmojiClick = () => {
    if (onToggleEmojiPanel) {
      saveSelection();
      onToggleEmojiPanel();
    } else {
      saveSelection();
      setShowEmoji(v => !v);
    }
  };

  const handleGifClick = () => {
    if (!onToggleGifPanel) return;
    saveSelection();
    onToggleGifPanel();
  };

  const triggerAttach = () => fileInputRef.current?.click();

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length && onAttachFiles) {
      onAttachFiles(files);
    }
    e.target.value = '';
  };

  const insertLink = () => {
    if (!linkUrl) return;
    restoreSelection();
    const url = linkUrl.startsWith('http') || linkUrl.startsWith('mailto:') ? linkUrl : `https://${linkUrl}`;
    if (linkText) {
      insertHTML(`<a href="${url}">${linkText.replace(/</g, '&lt;')}</a>`);
    } else {
      exec('createLink', url);
    }
    setShowLinkInput(false);
    setLinkUrl('');
    setLinkText('');
  };

  const insertImage = () => {
    imageInputRef.current?.click();
  };

  // Convert a picked image file to a data URI and insert it inline in the editor.
  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error("Ce fichier n'est pas une image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image trop volumineuse (max 5 Mo). Utilisez plutôt une pièce jointe.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      editorRef?.current?.focus();
      exec('insertImage', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const insertEmoji = (emoji: string) => {
    restoreSelection();
    insertHTML(emoji);
    setShowEmoji(false);
  };

  const insertTable = (rows: number, cols: number) => {
    let html = '<table style="border-collapse:collapse;width:100%;margin:4px 0;">';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += '<td style="border:1px solid #c0c0c0;padding:6px;min-width:40px;">&nbsp;</td>';
      }
      html += '</tr>';
    }
    html += '</table><p><br></p>';
    restoreSelection();
    insertHTML(html);
    setShowTableGrid(false);
  };

  const insertHorizontalRule = () => exec('insertHorizontalRule');

  const insertDate = () => {
    const now = new Date();
    const formatted = now.toLocaleString('fr-FR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    restoreSelection();
    insertHTML(formatted);
  };

  const portals = (
    <>
      {showSignatureMenu && (
        <AnchoredPortal anchorEl={signatureBtnRef.current} onClose={() => setShowSignatureMenu(false)}>
          <div className="bg-white border border-outlook-border rounded shadow-lg py-1 min-w-[200px] text-sm">
            {signatures.length === 0 ? (
              <div className="px-3 py-2 text-xs text-outlook-text-secondary">
                Aucune signature créée
              </div>
            ) : (
              signatures.map(sig => (
                <button
                  key={sig.id}
                  onMouseDown={(e) => { e.preventDefault(); insertSignature(sig); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover truncate"
                  title={sig.name}
                >
                  {sig.name}
                </button>
              ))
            )}
            <div className="border-t border-outlook-border my-1" />
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setShowSignatureMenu(false);
                setShowSignaturesManager(true);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover"
            >
              Signatures…
            </button>
          </div>
        </AnchoredPortal>
      )}
      {showSignaturesManager && (
        <SignaturesManagerModal
          onClose={() => setShowSignaturesManager(false)}
          accounts={accounts}
        />
      )}
      {showEmoji && (
        <AnchoredPortal anchorEl={emojiBtnRef.current} onClose={() => setShowEmoji(false)}>
          <div className="bg-white border border-outlook-border rounded shadow-lg p-2 w-64">
            <div className="grid grid-cols-8 gap-0.5 max-h-48 overflow-y-auto">
              {EMOJI_LIST.map(emoji => (
                <button
                  key={emoji}
                  onMouseDown={(e) => { e.preventDefault(); insertEmoji(emoji); }}
                  className="w-7 h-7 flex items-center justify-center text-lg rounded hover:bg-outlook-bg-hover"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </AnchoredPortal>
      )}
      {showTableGrid && (
        <AnchoredPortal anchorEl={tableBtnRef.current} onClose={() => setShowTableGrid(false)}>
          <TableGridPicker onSelect={insertTable} />
        </AnchoredPortal>
      )}
      {showLinkInput && (
        <AnchoredPortal
          anchorEl={linkBtnRef.current}
          onClose={() => { setShowLinkInput(false); setLinkUrl(''); setLinkText(''); }}
        >
          <div className="bg-white border border-outlook-border rounded shadow-lg p-2 flex flex-col gap-1 min-w-72">
            <input
              autoFocus
              type="text"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') insertLink(); if (e.key === 'Escape') setShowLinkInput(false); }}
              placeholder="Adresse (https://...)"
              className="text-xs border border-outlook-border rounded px-2 py-1 outline-none focus:border-outlook-blue"
            />
            <input
              type="text"
              value={linkText}
              onChange={e => setLinkText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') insertLink(); }}
              placeholder="Texte à afficher (optionnel)"
              className="text-xs border border-outlook-border rounded px-2 py-1 outline-none focus:border-outlook-blue"
            />
            <div className="flex justify-end gap-1">
              <button onClick={() => { setShowLinkInput(false); setLinkUrl(''); setLinkText(''); }} className="text-xs px-2 py-1 rounded hover:bg-outlook-bg-hover">Annuler</button>
              <button onMouseDown={(e) => { e.preventDefault(); insertLink(); }} className="bg-outlook-blue text-white text-xs px-3 py-1 rounded">Insérer</button>
            </div>
          </div>
        </AnchoredPortal>
      )}
      {showNcPicker && (
        <NextcloudFilePicker
          open={showNcPicker}
          onPick={handleNcPick}
          onClose={() => setShowNcPicker(false)}
        />
      )}
    </>
  );

  // ─── Compact (simplified) rendering ─────────────────────────────
  if (compact) {
    return (
      <>
        <input type="file" ref={fileInputRef} onChange={handleFiles} multiple className="hidden" />
        <input
          type="file"
          ref={imageInputRef}
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageFile(f);
            e.target.value = '';
          }}
        />
        <SimplifiedButton icon={Paperclip} label="Joindre" onClick={triggerAttach} />
        {ncLinked && (
          <SimplifiedButton icon={Cloud} label="Nextcloud" onClick={() => setShowNcPicker(true)} active={showNcPicker || ncAttaching} />
        )}
        <span ref={el => { linkBtnRef.current = el; }} className="inline-flex">
          <SimplifiedButton icon={LinkIcon} label="Lien" onClick={() => { saveSelection(); setShowLinkInput(v => !v); }} />
        </span>
        <SimplifiedButton icon={ImageIcon} label="Image" onClick={insertImage} />
        <span ref={el => { emojiBtnRef.current = el; }} className="inline-flex">
          <SimplifiedButton icon={Smile} label="Emoji" onClick={handleEmojiClick} active={isEmojiPanelOpen} />
        </span>
        {onToggleGifPanel && (
          <SimplifiedButton icon={Film} label="GIF" onClick={handleGifClick} active={isGifPanelOpen} />
        )}
        <span ref={el => { tableBtnRef.current = el; }} className="inline-flex">
          <SimplifiedButton icon={TableIcon} label="Tableau" onClick={() => { saveSelection(); setShowTableGrid(v => !v); }} />
        </span>
        <SimplifiedButton icon={MinusIcon} label="Ligne" onClick={insertHorizontalRule} />
        <SimplifiedButton icon={Calendar} label="Date" onClick={insertDate} />
        <span ref={el => { signatureBtnRef.current = el; }} className="inline-flex">
          <SimplifiedButton icon={PenTool} label="Signature" onClick={() => { saveSelection(); setShowSignatureMenu(v => !v); }} active={showSignatureMenu} />
        </span>
        {onOpenTemplatesPicker && (
          <span className="inline-flex items-center">
            <SimplifiedButton icon={FileText} label="Modèles" onClick={() => onOpenTemplatesPicker()} />
            {onOpenTemplatesManager && (
              <button
                onClick={() => onOpenTemplatesManager()}
                className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
                title="Gérer les modèles"
              >
                <SettingsIcon size={11} />
              </button>
            )}
          </span>
        )}
        {portals}
      </>
    );
  }

  // ─── Classic rendering ──────────────────────────────────────────
  return (
    <>
      <input type="file" ref={fileInputRef} onChange={handleFiles} multiple className="hidden" />
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImageFile(f);
          e.target.value = '';
        }}
      />

      {/* Inclure */}
      <RibbonGroup label="Inclure">
        <RibbonButton icon={Paperclip} label="Joindre un fichier" onClick={triggerAttach} />
        {ncLinked && (
          <RibbonButton
            icon={Cloud}
            label="Nextcloud"
            onClick={() => setShowNcPicker(true)}
            active={showNcPicker || ncAttaching}
          />
        )}
        <span ref={el => { linkBtnRef.current = el; }} className="inline-flex">
          <RibbonButton icon={LinkIcon} label="Lien" onClick={() => { saveSelection(); setShowLinkInput(s => !s); }} />
        </span>
        <RibbonButton icon={ImageIcon} label="Image" onClick={insertImage} />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Tableaux */}
      <RibbonGroup label="Tableaux">
        <span ref={el => { tableBtnRef.current = el; }} className="inline-flex">
          <RibbonButton icon={TableIcon} label="Tableau" onClick={() => { saveSelection(); setShowTableGrid(s => !s); }} />
        </span>
      </RibbonGroup>
      <RibbonSeparator />

      {/* Symboles */}
      <RibbonGroup label="Symboles">
        <span ref={el => { emojiBtnRef.current = el; }} className="inline-flex">
          <RibbonButton icon={Smile} label="Emoji" onClick={handleEmojiClick} active={isEmojiPanelOpen} />
        </span>
        {onToggleGifPanel && (
          <RibbonButton icon={Film} label="GIF" onClick={handleGifClick} active={isGifPanelOpen} />
        )}
        <RibbonButton icon={MinusIcon} label="Ligne horizontale" onClick={insertHorizontalRule} />
        <RibbonButton icon={Calendar} label="Date et heure" onClick={insertDate} />
      </RibbonGroup>
      <RibbonSeparator />

      {/* Signature */}
      <RibbonGroup label="Signature">
        <span ref={el => { signatureBtnRef.current = el; }} className="inline-flex">
          <RibbonButton icon={PenTool} label="Signature" onClick={() => { saveSelection(); setShowSignatureMenu(s => !s); }} active={showSignatureMenu} />
        </span>
      </RibbonGroup>
      {onOpenTemplatesPicker && (
        <>
          <RibbonSeparator />
          <RibbonGroup label="Modèles">
            <RibbonButton icon={FileText} label="Modèles" onClick={() => onOpenTemplatesPicker()} />
            {onOpenTemplatesManager && (
              <button
                onClick={() => onOpenTemplatesManager()}
                className="flex flex-col items-center gap-0.5 rounded transition-colors px-1.5 py-0.5 min-w-[40px] hover:bg-outlook-bg-hover cursor-pointer text-outlook-text-secondary"
                title="Gérer mes modèles"
              >
                <SettingsIcon size={14} />
                <span className="text-[9px] leading-tight text-center whitespace-nowrap">Gérer</span>
              </button>
            )}
          </RibbonGroup>
        </>
      )}
      {portals}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small pickers (portaled)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders `children` in a portal, positioned just below `anchorEl`, with a
 * transparent backdrop that closes the popover on outside clicks.
 */
function AnchoredPortal({ anchorEl, onClose, children }: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchorEl) return;
    const update = () => {
      const rect = anchorEl.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorEl]);

  if (!pos) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div className="fixed z-[9999]" style={{ top: pos.top, left: pos.left }}>
        {children}
      </div>
    </>,
    document.body,
  );
}

function RibbonColorPickerPanel({ onSelect }: { onSelect: (color: string) => void }) {
  return (
    <div className="bg-white border border-outlook-border rounded shadow-lg p-2">
      <div className="grid grid-cols-6 gap-0.5">
        {TEXT_COLORS.map(color => (
          <button
            key={color}
            onMouseDown={(e) => { e.preventDefault(); onSelect(color); }}
            className="w-5 h-5 rounded-sm border border-transparent hover:border-outlook-text-secondary transition-colors"
            style={{ background: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
}

function TableGridPicker({ onSelect }: { onSelect: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const ROWS = 8;
  const COLS = 10;
  return (
    <div className="bg-white border border-outlook-border rounded shadow-lg p-2">
      <div className="text-xs text-outlook-text-secondary mb-1 text-center">
        {hover ? `${hover.r + 1} × ${hover.c + 1}` : 'Insérer un tableau'}
      </div>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${COLS}, 16px)` }}>
        {Array.from({ length: ROWS * COLS }).map((_, i) => {
          const r = Math.floor(i / COLS);
          const c = i % COLS;
          const selected = hover && r <= hover.r && c <= hover.c;
          return (
            <button
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onMouseDown={(e) => { e.preventDefault(); onSelect(r + 1, c + 1); }}
              className={`w-4 h-4 border rounded-sm transition-colors ${selected ? 'bg-outlook-blue/30 border-outlook-blue' : 'bg-white border-outlook-border hover:border-outlook-blue/50'}`}
            />
          );
        })}
      </div>
    </div>
  );
}
