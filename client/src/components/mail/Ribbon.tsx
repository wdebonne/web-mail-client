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
  Smile, Table as TableIcon, Minus as MinusIcon, PenLine, Calendar, Film,
  Star, ArrowLeftRight, AlignVerticalJustifyCenter, List as ListIcon,
  Tag,
} from 'lucide-react';
import { CategoryPicker } from './CategoryModals';
import type { TabMode } from '../../stores/mailStore';
import type { MailAccount } from '../../types';
import {
  getUnifiedAccountIds, setUnifiedAccountIds,
  getUnifiedInboxEnabled, setUnifiedInboxEnabled,
  getUnifiedSentEnabled, setUnifiedSentEnabled,
  getAccountDisplayName,
} from '../../utils/mailPreferences';

type RibbonTab = 'accueil' | 'afficher' | 'message' | 'inserer';
type RibbonMode = 'classic' | 'simplified';
type AttachmentActionMode = 'preview' | 'download' | 'menu';

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

  // Categories
  onCategorize?: (categoryId: string) => void;
  onClearCategories?: () => void;
  onNewCategory?: () => void;
  onManageCategories?: () => void;
  messageCategoryIds?: string[];
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
  onCategorize, onClearCategories, onNewCategory, onManageCategories,
  messageCategoryIds = [],
}: RibbonProps) {
  const [activeTab, setActiveTab] = useState<RibbonTab>('accueil');
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showFavoritesMenu, setShowFavoritesMenu] = useState(false);
  const [showReadingPaneMenu, setShowReadingPaneMenu] = useState(false);
  const [showDensityMenu, setShowDensityMenu] = useState(false);
  const [showListModeMenu, setShowListModeMenu] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const tabMenuBtnRef = useRef<HTMLButtonElement>(null);
  const attachmentMenuBtnRef = useRef<HTMLButtonElement>(null);
  const favoritesMenuBtnRef = useRef<HTMLButtonElement>(null);
  const readingPaneMenuBtnRef = useRef<HTMLButtonElement>(null);
  const densityMenuBtnRef = useRef<HTMLButtonElement>(null);
  const listModeMenuBtnRef = useRef<HTMLButtonElement>(null);
  const categoryMenuBtnRef = useRef<HTMLButtonElement>(null);
  const [tabMenuPos, setTabMenuPos] = useState({ top: 0, left: 0 });
  const [attachmentMenuPos, setAttachmentMenuPos] = useState({ top: 0, left: 0 });
  const [favoritesMenuPos, setFavoritesMenuPos] = useState({ top: 0, left: 0 });
  const [readingPaneMenuPos, setReadingPaneMenuPos] = useState({ top: 0, left: 0 });
  const [densityMenuPos, setDensityMenuPos] = useState({ top: 0, left: 0 });
  const [listModeMenuPos, setListModeMenuPos] = useState({ top: 0, left: 0 });
  const [categoryMenuPos, setCategoryMenuPos] = useState({ top: 0, left: 0 });
  const ribbonRef = useRef<HTMLDivElement>(null);
  // Re-render favorites menu when toggled
  const [favPrefsVersion, setFavPrefsVersion] = useState(0);
  const bumpFavPrefs = () => {
    setFavPrefsVersion((n) => n + 1);
    onFavoritesChanged?.();
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

  // Available tabs in display order
  const tabs: RibbonTab[] = [
    'accueil',
    'afficher',
    ...((isComposing ? ['message', 'inserer'] : []) as RibbonTab[]),
  ];
  const tabLabel = (t: RibbonTab) =>
    t === 'accueil' ? 'Accueil' : t === 'afficher' ? 'Afficher' : t === 'message' ? 'Message' : 'Insérer';

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

  const openDensityMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || densityMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setDensityMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowDensityMenu(v => !v);
  };

  const openListModeMenu = (e?: React.MouseEvent) => {
    const el = (e?.currentTarget as HTMLElement) || listModeMenuBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setListModeMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowListModeMenu(v => !v);
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

  // ─── Simplified ribbon ─────────────────────────────────────
  if (ribbonMode === 'simplified') {
    return (
      <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
        {renderTabBar(() => onChangeRibbonMode('classic'), 'Développer le ruban', false)}
        <div className="flex items-center px-2 py-0.5 gap-0.5 overflow-x-auto h-9">
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
                ref={densityMenuBtnRef}
                onClick={(e) => openDensityMenu(e)}
                className={`flex items-center gap-1 rounded transition-colors px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer ${showDensityMenu ? 'bg-outlook-blue/10 text-outlook-blue' : ''}`}
                title="Densité de la liste"
              >
                <AlignVerticalJustifyCenter size={14} />
                <span className="text-xs whitespace-nowrap">Densité</span>
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
            <InsererTabContent editorRef={composeEditorRef} onAttachFiles={onComposeAttachFiles} onToggleEmojiPanel={onToggleEmojiPanel} isEmojiPanelOpen={isEmojiPanelOpen} onToggleGifPanel={onToggleGifPanel} isGifPanelOpen={isGifPanelOpen} compact />
          )}
        </div>
      </div>
    );
  }

  // ─── Classic ribbon ─────────────────────────────────────────

  return (
    <div ref={ribbonRef} className="hidden md:flex flex-col flex-shrink-0 bg-white select-none">
      {renderTabBar(() => onChangeRibbonMode('simplified'), 'Réduire le ruban', true)}

      {/* Ribbon content — fixed height so all tabs share the same size */}
        <div className="flex items-center px-2 py-1 gap-1 overflow-x-auto overflow-y-hidden h-[80px]">
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
            <InsererTabContent editorRef={composeEditorRef} onAttachFiles={onComposeAttachFiles} onToggleEmojiPanel={onToggleEmojiPanel} isEmojiPanelOpen={isEmojiPanelOpen} onToggleGifPanel={onToggleGifPanel} isGifPanelOpen={isGifPanelOpen} />
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
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </RibbonGroup>
              <RibbonSeparator />

              {/* Synchroniser */}
              <RibbonGroup label="Messages">
                <RibbonButton icon={RefreshCw} label="Synchroniser" onClick={onSync} />
              </RibbonGroup>
            </>
          )}
        </div>

        {/* Favorites mailbox menu — rendered globally so it works from both classic & simplified Afficher tab */}
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

        {/* Reading pane mode menu — rendered globally so it works from both classic & simplified Afficher tab */}
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
function InsererTabContent({ editorRef, onAttachFiles, onToggleEmojiPanel, isEmojiPanelOpen = false, onToggleGifPanel, isGifPanelOpen = false, compact = false }: {
  editorRef?: React.RefObject<HTMLDivElement>;
  onAttachFiles?: (files: FileList | File[]) => void;
  onToggleEmojiPanel?: () => void;
  isEmojiPanelOpen?: boolean;
  onToggleGifPanel?: () => void;
  isGifPanelOpen?: boolean;
  compact?: boolean;
}) {
  const { exec, saveSelection, restoreSelection, insertHTML } = useEditorControl(editorRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkBtnRef = useRef<HTMLElement | null>(null);
  const emojiBtnRef = useRef<HTMLElement | null>(null);
  const tableBtnRef = useRef<HTMLElement | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(false);

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
    const url = prompt("URL de l'image :");
    if (url) exec('insertImage', url);
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
    </>
  );

  // ─── Compact (simplified) rendering ─────────────────────────────
  if (compact) {
    return (
      <>
        <input type="file" ref={fileInputRef} onChange={handleFiles} multiple className="hidden" />
        <SimplifiedButton icon={Paperclip} label="Joindre" onClick={triggerAttach} />
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
        {portals}
      </>
    );
  }

  // ─── Classic rendering ──────────────────────────────────────────
  return (
    <>
      <input type="file" ref={fileInputRef} onChange={handleFiles} multiple className="hidden" />

      {/* Inclure */}
      <RibbonGroup label="Inclure">
        <RibbonButton icon={Paperclip} label="Joindre un fichier" onClick={triggerAttach} />
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
