import {
  format, isToday, isYesterday, isThisYear, isThisWeek, isThisMonth,
  subMonths, subWeeks, subYears, isSameMonth, isSameYear, isAfter,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Star, Paperclip, Trash2, Reply, ReplyAll, Forward, Mail, MailOpen,
  Flag, FolderInput, Copy, Archive, ChevronDown, ChevronRight,
  ArrowUpDown, ListFilter, Calendar, CheckSquare, FolderIcon,
  Check, MailCheck, PanelLeftOpen, PanelLeftClose,
  Tag, MessagesSquare,
} from 'lucide-react';
import { useMemo, useState, useRef, useEffect } from 'react';
import { Email, MailFolder } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import ContextMenu, { ContextMenuItem } from '../ui/ContextMenu';
import {
  getCategories, getMessageCategories, categoryRowTint,
  subscribeCategories, MailCategory,
} from '../../utils/categories';
import type { SwipeAction } from '../../utils/mailPreferences';

type SortField = 'date' | 'from' | 'subject' | 'size' | 'importance';
type SortOrder = 'asc' | 'desc';
type FilterType = 'all' | 'unread' | 'flagged' | 'attachments' | 'tome';
type DateFilter = 'all' | 'today' | 'yesterday' | 'lastweek' | 'lastmonth' | 'lastyear' | 'custom';

// Visual metadata for the swipe action backgrounds (icon, label, colour).
function swipeActionMeta(action: SwipeAction): { label: string; icon: JSX.Element; bg: string; fg: string } | null {
  switch (action) {
    case 'archive': return { label: 'Archiver', icon: <Archive size={20} />, bg: 'bg-emerald-500', fg: 'text-white' };
    case 'trash': return { label: 'Corbeille', icon: <Trash2 size={20} />, bg: 'bg-red-500', fg: 'text-white' };
    case 'move': return { label: 'Déplacer', icon: <FolderInput size={20} />, bg: 'bg-blue-500', fg: 'text-white' };
    case 'copy': return { label: 'Copier', icon: <Copy size={20} />, bg: 'bg-sky-500', fg: 'text-white' };
    case 'flag': return { label: 'Drapeau', icon: <Flag size={20} />, bg: 'bg-amber-500', fg: 'text-white' };
    case 'read': return { label: 'Lu / Non lu', icon: <MailOpen size={20} />, bg: 'bg-slate-500', fg: 'text-white' };
    case 'none':
    default: return null;
  }
}

interface MessageListProps {
  messages: Email[];
  selectedMessage: Email | null;
  loading: boolean;
  onSelectMessage: (message: Email) => void;
  onToggleFlag: (uid: number, flagged: boolean) => void;
  onDelete: (uid: number) => void;
  folder: string;
  draggable?: boolean;
  onReply?: (message: Email) => void;
  onReplyAll?: (message: Email) => void;
  onForward?: (message: Email) => void;
  onMarkRead?: (uid: number, isRead: boolean) => void;
  onMove?: (uid: number, toFolder: string) => void;
  onCopy?: (uid: number, toFolder: string) => void;
  /** Archive a message into the configured dated archive folder tree. */
  onArchive?: (uid: number) => void;
  folders?: MailFolder[];
  onToggleFolderPane?: () => void;
  showFolderPane?: boolean;
  listWidth?: number;
  attachmentMinVisibleKb?: number;
  accountId?: string;
  /** Density of list rows — affects row padding and inter-element spacing. */
  density?: 'spacious' | 'comfortable' | 'compact';
  /** Display mode for the message rows. 'auto' uses the list width; 'wide' forces single-line columns; 'compact' forces multi-line cards. */
  listDisplayMode?: 'auto' | 'wide' | 'compact';
  /** When enabled, group messages by conversation thread instead of by date. */
  conversationView?: boolean;
  /** How to group messages in the list. 'none' keeps the flat date-grouped layout;
   *  'conversation' collapses each thread into a single root row with an expandable
   *  set of children; 'branches' does the same but displays a subtle sub-thread
   *  indentation. The two grouping modes are visually identical at the moment. */
  conversationGrouping?: 'none' | 'conversation' | 'branches';
  /** Open the category picker for a given message (context menu entry). */
  onOpenCategoryPicker?: (message: Email, x: number, y: number) => void;
  /** Enable horizontal swipe gestures on touch devices. */
  swipeEnabled?: boolean;
  /** Action triggered when swiping a row to the left. */
  swipeLeftAction?: SwipeAction;
  /** Action triggered when swiping a row to the right. */
  swipeRightAction?: SwipeAction;
  /** Called when a row is fully swiped past the threshold. Parent resolves the action. */
  onSwipe?: (uid: number, direction: 'left' | 'right') => void;
}

interface MessageGroup {
  key: string;
  label: string;
  messages: Email[];
}

// --- Dropdown helper ---
function DropdownMenu({ open, onClose, children, className = '' }: {
  open: boolean; onClose: () => void; children: React.ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl py-1 z-50 ${className}`}>
      {children}
    </div>
  );
}

export default function MessageList({
  messages, selectedMessage, loading,
  onSelectMessage, onToggleFlag, onDelete, folder, draggable = true,
  onReply, onReplyAll, onForward, onMarkRead, onMove, onCopy, onArchive, folders,
  onToggleFolderPane, showFolderPane, listWidth,
  attachmentMinVisibleKb = 0,
  accountId,
  density = 'comfortable',
  listDisplayMode = 'auto',
  conversationView = false,
  conversationGrouping = 'none',
  onOpenCategoryPicker,
  swipeEnabled = false,
  swipeLeftAction = 'archive',
  swipeRightAction = 'trash',
  onSwipe,
}: MessageListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Email } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const toggleThread = (key: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const attachmentMinVisibleBytes = Math.max(0, attachmentMinVisibleKb) * 1024;

  // Categories — subscribe to changes so badges & tint refresh live.
  const [catsVersion, setCatsVersion] = useState(0);
  useEffect(() => subscribeCategories(() => setCatsVersion((n) => n + 1)), []);
  const categoriesMap = useMemo(() => {
    const map = new Map<string, MailCategory>();
    for (const c of getCategories()) map.set(c.id, c);
    return map;
  }, [catsVersion]);
  const getMessageCats = (m: Email): MailCategory[] => {
    const ids = getMessageCategories(m, accountId, folder);
    return ids.map((id) => categoriesMap.get(id)).filter(Boolean) as MailCategory[];
  };

  const hasVisibleAttachment = (message: Email) => {
    if (!message.hasAttachments) return false;
    if (typeof message.largestAttachmentSize === 'number') {
      return message.largestAttachmentSize >= attachmentMinVisibleBytes;
    }
    return message.hasAttachments;
  };

  // Dropdown visibility
  const [openDropdown, setOpenDropdown] = useState<'sort' | 'filter' | 'date' | null>(null);

  const toggleDropdown = (name: 'sort' | 'filter' | 'date') => {
    setOpenDropdown(prev => prev === name ? null : name);
  };

  // --- Swipe gestures (mobile/tablet only) ---
  // Detects a coarse pointer + narrow viewport. We intentionally exclude
  // desktop so the native HTML5 drag-and-drop (folder panel) keeps working.
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 1024px) and (pointer: coarse)');
    const update = () => setIsTouchDevice(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);
  const swipeActive = !!(swipeEnabled && onSwipe && isTouchDevice);
  // UID of the row currently being swiped past the commit threshold, used
  // to trigger an exit animation before the parent removes the message.
  const [committingSwipe, setCommittingSwipe] = useState<{ uid: number; dir: 'left' | 'right' } | null>(null);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleSelection = (uid: number) => {
    setSelectedUids(prev => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  };

  // Filter messages
  const filteredMessages = useMemo(() => {
    let result = messages;

    // Type filter
    switch (filterType) {
      case 'unread': result = result.filter(m => !m.flags?.seen); break;
      case 'flagged': result = result.filter(m => m.flags?.flagged); break;
      case 'attachments': result = result.filter(m => hasVisibleAttachment(m)); break;
      case 'tome': result = result; break; // placeholder — would require knowing user email
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date();
      let cutoff: Date;
      switch (dateFilter) {
        case 'today': cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case 'yesterday': cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); break;
        case 'lastweek': cutoff = subWeeks(now, 1); break;
        case 'lastmonth': cutoff = subMonths(now, 1); break;
        case 'lastyear': cutoff = subYears(now, 1); break;
        case 'custom':
          cutoff = customDate ? new Date(customDate) : new Date(0);
          break;
        default: cutoff = new Date(0);
      }
      result = result.filter(m => isAfter(new Date(m.date), cutoff));
    }

    return result;
  }, [messages, filterType, dateFilter, customDate, attachmentMinVisibleBytes]);

  // Sort messages
  const sortedMessages = useMemo(() => {
    const sorted = [...filteredMessages].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'from':
          cmp = (a.from?.name || a.from?.address || '').localeCompare(b.from?.name || b.from?.address || '');
          break;
        case 'subject':
          cmp = (a.subject || '').localeCompare(b.subject || '');
          break;
        case 'size':
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case 'importance':
          cmp = 0; // placeholder
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [filteredMessages, sortField, sortOrder]);

  // Group messages by time period
  const groupedMessages = useMemo(() => {
    const now = new Date();
    const groups: MessageGroup[] = [];
    const groupMap = new Map<string, Email[]>();

    for (const msg of sortedMessages) {
      const key = getGroupKey(new Date(msg.date), now, msg);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(msg);
    }

    const orderedKeys = getOrderedGroupKeys(now);
    for (const { key, label } of orderedKeys) {
      const msgs = groupMap.get(key);
      if (msgs && msgs.length > 0) {
        groups.push({ key, label, messages: msgs });
      }
    }

    for (const [key, msgs] of groupMap) {
      if (!groups.find(g => g.key === key)) {
        groups.push({ key, label: key, messages: msgs });
      }
    }

    return groups;
  }, [sortedMessages]);

  // Thread-size map used by the conversation indicator — computed only when conversation view is on.
  // Key is the normalised thread root (same logic as the server-side grouping would use).
  const threadKeyOf = (msg: Email): string => {
    const rawRefs: unknown = msg.headers?.references;
    const refs = (Array.isArray(rawRefs) ? rawRefs.join(' ') : (typeof rawRefs === 'string' ? rawRefs : '')).trim();
    if (refs) {
      const first = refs.split(/\s+/)[0];
      if (first) return first;
    }
    const rawIrt: unknown = msg.headers?.inReplyTo;
    const inReplyTo = (Array.isArray(rawIrt) ? rawIrt.join(' ') : (typeof rawIrt === 'string' ? rawIrt : '')).trim();
    if (inReplyTo) return inReplyTo;
    if (msg.messageId) return msg.messageId;
    return 'subj:' + (msg.subject || '').replace(/^\s*(re|fwd?|tr|rép|réf)\s*:\s*/gi, '').trim().toLowerCase();
  };
  const threadSizeMap = useMemo(() => {
    if (!conversationView) return null;
    const m = new Map<string, number>();
    for (const msg of messages) {
      const k = threadKeyOf(msg);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [messages, conversationView]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return format(date, 'HH:mm', { locale: fr });
    if (isYesterday(date)) return 'Hier';
    if (isThisYear(date)) return format(date, 'yyyy-MM-dd', { locale: fr });
    return format(date, 'yyyy-MM-dd', { locale: fr });
  };

  const formatFullDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'EEE yyyy-MM-dd HH:mm', { locale: fr });
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      const parts = name.split(' ');
      return parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
    }
    return (email || '?')[0].toUpperCase();
  };

  const getAvatarColor = (name?: string, email?: string) => {
    const str = name || email || '';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = ['#0078D4', '#107C10', '#D13438', '#FFB900', '#8764B8', '#00B7C3', '#E3008C', '#4F6BED'];
    return colors[Math.abs(hash) % colors.length];
  };

  const activeFilterCount = (filterType !== 'all' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0);

  if (loading) {
    return (
      <div className="bg-white flex-1 min-h-0 overflow-hidden w-full">
        <div className="p-3 border-b border-outlook-border">
          <div className="skeleton h-5 w-32 rounded" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="p-3 border-b border-outlook-border">
            <div className="flex gap-3">
              <div className="skeleton w-10 h-10 rounded-full flex-shrink-0" />
              <div className="flex-1">
                <div className="skeleton h-4 w-24 rounded mb-2" />
                <div className="skeleton h-3 w-48 rounded mb-1" />
                <div className="skeleton h-3 w-36 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white flex-1 min-h-0 flex flex-col overflow-hidden w-full border-r border-outlook-border">
      {/* Header: folder name + toolbar icons */}
      <div className="border-b border-outlook-border flex-shrink-0">
        <div className="px-2 pt-2 pb-1 flex items-center justify-between">
          {/* Left: folder pane toggle + folder name + star */}
          <div className="flex items-center gap-1 min-w-0">
            {onToggleFolderPane && (
              <button
                onClick={onToggleFolderPane}
                className={`p-1 rounded transition-colors flex-shrink-0 ${showFolderPane ? 'text-outlook-blue bg-outlook-blue/10' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-outlook-text-primary'}`}
                title={showFolderPane ? 'Masquer les dossiers' : 'Afficher les dossiers'}
              >
                {showFolderPane ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              </button>
            )}
            <h2 className="text-sm font-semibold text-outlook-text-primary truncate">
              {getFolderDisplayName(folder)}
            </h2>
            <Star size={13} className="text-outlook-text-disabled cursor-pointer hover:text-outlook-warning flex-shrink-0" />
          </div>

          {/* Right: toolbar icons */}
          <div className="flex items-center gap-0">
            {/* Selection mode toggle */}
            <button
              onClick={() => {
                setSelectionMode(!selectionMode);
                if (selectionMode) setSelectedUids(new Set());
              }}
              className={`p-1.5 rounded transition-colors ${selectionMode ? 'bg-outlook-blue/10 text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-outlook-text-primary'}`}
              title="Sélectionner"
            >
              <CheckSquare size={14} />
            </button>

            {/* Date filter */}
            <div className="relative">
              <button
                onClick={() => toggleDropdown('date')}
                className={`p-1.5 rounded transition-colors ${dateFilter !== 'all' ? 'bg-outlook-blue/10 text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-outlook-text-primary'}`}
                title="Filtrer par date"
              >
                <Calendar size={15} />
              </button>
              <DropdownMenu open={openDropdown === 'date'} onClose={() => setOpenDropdown(null)} className="right-0 min-w-[200px]">
                {([
                  ['all', 'Toutes les dates'],
                  ['today', 'Aujourd\'hui'],
                  ['yesterday', 'Hier'],
                  ['lastweek', 'La semaine dernière'],
                  ['lastmonth', 'Le mois dernier'],
                  ['lastyear', 'L\'année dernière'],
                ] as [DateFilter, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setDateFilter(value); if (value !== 'custom') setOpenDropdown(null); }}
                    className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover transition-colors
                      ${dateFilter === value ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
                  >
                    {dateFilter === value && <Check size={12} className="flex-shrink-0" />}
                    {dateFilter !== value && <span className="w-3 flex-shrink-0" />}
                    {label}
                  </button>
                ))}
                <div className="border-t border-gray-200 mt-1 pt-1 px-3 pb-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={customDate}
                      onChange={e => setCustomDate(e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 focus:outline-none focus:border-outlook-blue"
                    />
                    <button
                      onClick={() => { setDateFilter('custom'); setOpenDropdown(null); }}
                      className="text-xs bg-outlook-blue text-white px-2.5 py-1 rounded hover:bg-outlook-blue-dark transition-colors"
                    >
                      Go
                    </button>
                  </div>
                </div>
              </DropdownMenu>
            </div>

            {/* Filter */}
            <div className="relative">
              <button
                onClick={() => toggleDropdown('filter')}
                className={`p-1.5 rounded transition-colors ${filterType !== 'all' ? 'bg-outlook-blue/10 text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-outlook-text-primary'}`}
                title="Filtrer"
              >
                <ListFilter size={15} />
              </button>
              <DropdownMenu open={openDropdown === 'filter'} onClose={() => setOpenDropdown(null)} className="right-0 min-w-[200px]">
                {([
                  ['all', 'Tous', <MailCheck size={14} key="all" />],
                  ['unread', 'Non lu', <Mail size={14} key="unread" />],
                  ['flagged', 'Avec indicateur', <Flag size={14} key="flagged" />],
                  ['tome', 'À moi', <Reply size={14} key="tome" />],
                  ['attachments', 'Contient des fichiers', <Paperclip size={14} key="attach" />],
                ] as [FilterType, string, React.ReactNode][]).map(([value, label, icon]) => (
                  <button
                    key={value}
                    onClick={() => { setFilterType(value); setOpenDropdown(null); }}
                    className={`w-full flex items-center gap-2.5 text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover transition-colors
                      ${filterType === value ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
                  >
                    {filterType === value && <Check size={12} className="flex-shrink-0" />}
                    {filterType !== value && <span className="w-3 flex-shrink-0" />}
                    <span className="flex-shrink-0 text-outlook-text-secondary">{icon}</span>
                    {label}
                  </button>
                ))}
              </DropdownMenu>
            </div>

            {/* Sort */}
            <div className="relative">
              <button
                onClick={() => toggleDropdown('sort')}
                className={`p-1.5 rounded transition-colors text-outlook-text-secondary hover:bg-outlook-bg-hover hover:text-outlook-text-primary`}
                title="Trier"
              >
                <ArrowUpDown size={15} />
              </button>
              <DropdownMenu open={openDropdown === 'sort'} onClose={() => setOpenDropdown(null)} className="right-0 min-w-[260px]">
                <div className="px-3 py-1 text-xs font-semibold text-outlook-text-disabled uppercase tracking-wide">Trier par</div>
                {([
                  ['date', 'Date'],
                  ['from', 'De'],
                  ['subject', 'Objet'],
                  ['size', 'Taille'],
                  ['importance', 'Importance'],
                ] as [SortField, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => { setSortField(value); }}
                    className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover transition-colors
                      ${sortField === value ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
                  >
                    {sortField === value && <Check size={12} className="flex-shrink-0" />}
                    {sortField !== value && <span className="w-3 flex-shrink-0" />}
                    {label}
                  </button>
                ))}
                <div className="my-1 border-t border-gray-200" />
                <div className="px-3 py-1 text-xs font-semibold text-outlook-text-disabled uppercase tracking-wide">Ordre de tri</div>
                <button
                  onClick={() => { setSortOrder('asc'); setOpenDropdown(null); }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover transition-colors
                    ${sortOrder === 'asc' ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
                >
                  {sortOrder === 'asc' && <Check size={12} className="flex-shrink-0" />}
                  {sortOrder !== 'asc' && <span className="w-3 flex-shrink-0" />}
                  Par ordre chronologique croissant
                </button>
                <button
                  onClick={() => { setSortOrder('desc'); setOpenDropdown(null); }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover transition-colors
                    ${sortOrder === 'desc' ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
                >
                  {sortOrder === 'desc' && <Check size={12} className="flex-shrink-0" />}
                  {sortOrder !== 'desc' && <span className="w-3 flex-shrink-0" />}
                  Par ordre chronologique décroissant
                </button>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Active filters indicator */}
        {activeFilterCount > 0 && (
          <div className="px-3 pb-1.5 flex items-center gap-1.5">
            <span className="text-2xs text-outlook-text-secondary">Filtres actifs:</span>
            {filterType !== 'all' && (
              <button
                onClick={() => setFilterType('all')}
                className="text-2xs bg-outlook-blue/10 text-outlook-blue px-1.5 py-0.5 rounded-full hover:bg-outlook-blue/20 transition-colors"
              >
                {filterType === 'unread' ? 'Non lu' : filterType === 'flagged' ? 'Indicateur' : filterType === 'attachments' ? 'Fichiers' : 'À moi'} ✕
              </button>
            )}
            {dateFilter !== 'all' && (
              <button
                onClick={() => { setDateFilter('all'); setCustomDate(''); }}
                className="text-2xs bg-outlook-blue/10 text-outlook-blue px-1.5 py-0.5 rounded-full hover:bg-outlook-blue/20 transition-colors"
              >
                {dateFilter === 'today' ? "Aujourd'hui" : dateFilter === 'yesterday' ? 'Hier' : dateFilter === 'lastweek' ? 'Semaine' : dateFilter === 'lastmonth' ? 'Mois' : dateFilter === 'lastyear' ? 'Année' : customDate} ✕
              </button>
            )}
            <span className="text-2xs text-outlook-text-disabled ml-auto">
              {filteredMessages.length}/{messages.length}
            </span>
          </div>
        )}
      </div>

      {/* Column headers — wide mode only */}
      {(listDisplayMode === 'wide' || (listDisplayMode === 'auto' && (listWidth ?? 0) >= 400)) && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-outlook-border bg-outlook-bg-primary/50 text-2xs font-medium text-outlook-text-secondary">
          <span className="w-7 flex-shrink-0" />
          <span className="w-28 flex-shrink-0">De</span>
          <span className="flex-1 min-w-0">Objet</span>
          <span className="w-20 text-right flex-shrink-0">Reçu ▾</span>
        </div>
      )}

      {/* Grouped message list — scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <div className="text-center text-outlook-text-disabled py-12">
            <p className="text-sm">
              {activeFilterCount > 0 ? 'Aucun message correspondant aux filtres' : 'Aucun message'}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setFilterType('all'); setDateFilter('all'); setCustomDate(''); }}
                className="text-xs text-outlook-blue hover:underline mt-2"
              >
                Effacer les filtres
              </button>
            )}
          </div>
        ) : (
          groupedMessages.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);

            return (
              <div key={group.key}>
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 bg-outlook-bg-primary border-b border-outlook-border hover:bg-outlook-bg-hover transition-colors sticky top-0 z-10"
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} className="text-outlook-text-secondary flex-shrink-0" />
                  ) : (
                    <ChevronDown size={12} className="text-outlook-text-secondary flex-shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-outlook-text-secondary">
                    {group.label}
                  </span>
                  <span className="text-2xs text-outlook-text-disabled">
                    ({group.messages.length})
                  </span>
                </button>

                {/* Messages in group — threaded when conversation grouping is active. */}
                {!isCollapsed && (() => {
                  type ThreadItem = { msg: Email; role: 'single' | 'root' | 'child'; threadKey: string; childCount?: number };
                  const buildItems = (): ThreadItem[] => {
                    if (conversationGrouping === 'none') {
                      return group.messages.map((m): ThreadItem => ({ msg: m, role: 'single', threadKey: threadKeyOf(m) }));
                    }
                    const threads = new Map<string, Email[]>();
                    const order: string[] = [];
                    for (const m of group.messages) {
                      const k = threadKeyOf(m);
                      if (!threads.has(k)) { threads.set(k, []); order.push(k); }
                      threads.get(k)!.push(m);
                    }
                    const items: ThreadItem[] = [];
                    for (const k of order) {
                      const arr = threads.get(k)!;
                      if (arr.length === 1) {
                        items.push({ msg: arr[0], role: 'single', threadKey: k });
                      } else {
                        // Display order: newest first as the thread head, followed by the older
                        // messages indented beneath. `arr` already follows the outer sort order
                        // (date desc by default).
                        const [head, ...rest] = arr;
                        items.push({ msg: head, role: 'root', threadKey: k, childCount: arr.length });
                        if (expandedThreads.has(k)) {
                          for (const c of rest) items.push({ msg: c, role: 'child', threadKey: k });
                        }
                      }
                    }
                    return items;
                  };
                  const threadItems = buildItems();
                  return threadItems.map((item, msgIndex) => {
                  const message = item.msg;
                  const isThreadRoot = item.role === 'root';
                  const isThreadChild = item.role === 'child';
                  const isSelected = selectedMessage?.uid === message.uid;
                  const isUnread = !message.flags?.seen;
                  const isChecked = selectedUids.has(message.uid);
                  const isWide = listDisplayMode === 'wide'
                    ? true
                    : listDisplayMode === 'compact'
                      ? false
                      : (listWidth ?? 0) >= 400;
                  // Density-driven padding classes for the row
                  const densityWide = density === 'spacious' ? 'py-2.5' : density === 'compact' ? 'py-0.5' : 'py-1.5';
                  const densityCompact = density === 'spacious' ? 'py-3.5 gap-3' : density === 'compact' ? 'py-1 gap-2' : 'py-2.5 gap-3';
                  const msgCats = getMessageCats(message);
                  const primaryCatColor = msgCats[0]?.color;
                  const rowStyle: React.CSSProperties = primaryCatColor && !isSelected && !isChecked
                    ? { backgroundColor: categoryRowTint(primaryCatColor, 0.18) }
                    : {};

                  // --- Swipe metadata ---
                  const leftMeta = swipeActive ? swipeActionMeta(swipeLeftAction) : null;
                  const rightMeta = swipeActive ? swipeActionMeta(swipeRightAction) : null;
                  const canSwipe = swipeActive && !selectionMode && !isThreadChild && (!!leftMeta || !!rightMeta);
                  const committing = committingSwipe?.uid === message.uid ? committingSwipe.dir : null;

                  const rowNode = (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={committing
                        ? { opacity: 0, x: committing === 'left' ? -600 : 600, transition: { duration: 0.18 } }
                        : { opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(msgIndex * 0.02, 0.3), ease: 'easeOut' }}
                      onClick={() => {
                        if (selectionMode) {
                          toggleSelection(message.uid);
                        } else {
                          onSelectMessage(message);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, message });
                      }}
                      draggable={!canSwipe && draggable && !selectionMode}
                      onDragStartCapture={canSwipe ? undefined : (e: any) => {
                        e.dataTransfer.setData('text/x-mail-uid', String(message.uid));
                        if (accountId) {
                          e.dataTransfer.setData(
                            'application/x-mail-message',
                            JSON.stringify({ uid: message.uid, srcAccountId: accountId, srcFolder: folder }),
                          );
                        }
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      {...(canSwipe ? {
                        drag: 'x' as const,
                        dragDirectionLock: true,
                        dragElastic: 0.25,
                        dragMomentum: false,
                        dragConstraints: { left: 0, right: 0 },
                        onDragEnd: (_e: any, info: { offset: { x: number; y: number }; velocity: { x: number; y: number } }) => {
                          const dx = info.offset.x;
                          const vx = info.velocity.x;
                          const threshold = 90; // px
                          const fastFlick = Math.abs(vx) > 500 && Math.abs(dx) > 35;
                          // dx < 0 => swipe left => leftAction, dx > 0 => swipe right => rightAction
                          if ((dx <= -threshold || (fastFlick && dx < 0)) && leftMeta) {
                            setCommittingSwipe({ uid: message.uid, dir: 'left' });
                            // Give the exit animation a moment before delegating.
                            setTimeout(() => {
                              onSwipe?.(message.uid, 'left');
                              setCommittingSwipe((cur) => cur?.uid === message.uid ? null : cur);
                            }, 160);
                          } else if ((dx >= threshold || (fastFlick && dx > 0)) && rightMeta) {
                            setCommittingSwipe({ uid: message.uid, dir: 'right' });
                            setTimeout(() => {
                              onSwipe?.(message.uid, 'right');
                              setCommittingSwipe((cur) => cur?.uid === message.uid ? null : cur);
                            }, 160);
                          }
                        },
                      } : {})}
                      style={rowStyle}
                      className={`flex items-center gap-2 px-3 cursor-pointer border-b border-outlook-border transition-colors group relative
                        ${isWide ? densityWide : densityCompact}
                        ${isThreadChild ? 'pl-10 bg-outlook-bg-primary/40' : ''}
                        ${isSelected && !selectionMode ? 'bg-blue-50 border-l-2 border-l-outlook-blue' : 'border-l-2 border-l-transparent hover:bg-outlook-bg-hover'}
                        ${isChecked ? 'bg-blue-50' : ''}
                        ${isUnread && !primaryCatColor ? '' : (!primaryCatColor ? 'bg-outlook-bg-primary/30' : '')}`}
                    >
                      {/* Thread expansion chevron — only on root rows of a threaded conversation.
                          Clicking toggles the sub-list visibility without selecting the message. */}
                      {isThreadRoot && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleThread(item.threadKey); }}
                          className="flex-shrink-0 p-0.5 -ml-1 text-outlook-text-secondary hover:text-outlook-text-primary hover:bg-outlook-bg-hover rounded"
                          title={expandedThreads.has(item.threadKey) ? 'Réduire la conversation' : 'Développer la conversation'}
                        >
                          {expandedThreads.has(item.threadKey)
                            ? <ChevronDown size={14} />
                            : <ChevronRight size={14} />}
                        </button>
                      )}

                      {/* Checkbox (selection mode) or Avatar */}
                      {selectionMode ? (
                        <div className={`flex items-center justify-center flex-shrink-0 ${isWide ? 'w-7 h-7' : 'w-10 h-10 mt-0.5'}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelection(message.uid)}
                            className="w-4 h-4 rounded border-gray-300 text-outlook-blue focus:ring-outlook-blue cursor-pointer"
                            onClick={e => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        <div
                          className={`rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 ${isWide ? 'w-7 h-7 text-2xs' : 'w-10 h-10 text-xs mt-0.5'}`}
                          style={{ backgroundColor: getAvatarColor(message.from?.name, message.from?.address) }}
                        >
                          {getInitials(message.from?.name, message.from?.address)}
                        </div>
                      )}

                      {isWide ? (
                        /* ===== Wide mode: single-line row with columns ===== */
                        <>
                          {/* From */}
                          <span className={`w-28 flex-shrink-0 text-xs truncate ${isUnread ? 'font-semibold text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                            {message.from?.name || message.from?.address || 'Inconnu'}
                          </span>

                          {/* Subject + snippet */}
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className={`text-xs truncate ${isUnread ? 'font-medium text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                              {message.subject || '(Sans objet)'}
                            </span>
                            {isThreadRoot && item.childCount && item.childCount > 1 && (
                              <span className="text-[10px] px-1.5 py-[1px] rounded-full bg-outlook-blue/10 text-outlook-blue border border-outlook-blue/30 whitespace-nowrap" title={`${item.childCount} messages dans cette conversation`}>
                                {item.childCount}
                              </span>
                            )}
                            {isThreadChild && message._folder && (
                              <span className="text-[10px] px-1.5 py-[1px] rounded bg-outlook-bg-hover text-outlook-text-secondary border border-outlook-border whitespace-nowrap" title={message._folder}>
                                {message._folder.split(/[\/.]/).pop() || message._folder}
                              </span>
                            )}
                            {msgCats.slice(0, 2).map((c) => (
                              <span
                                key={c.id}
                                className="text-[10px] px-1.5 py-[1px] rounded-full whitespace-nowrap border"
                                style={{ backgroundColor: categoryRowTint(c.color, 0.35), borderColor: c.color, color: '#2d2d2d' }}
                                title={c.name}
                              >
                                {c.name}
                              </span>
                            ))}
                            {msgCats.length > 2 && (
                              <span className="text-[10px] text-outlook-text-disabled">+{msgCats.length - 2}</span>
                            )}
                            <span className="text-xs text-outlook-text-disabled truncate">
                              {message.snippet || ''}
                            </span>
                          </div>

                          {/* Status icons (conversation, replied, attachment) + Date — shown normally, hidden on hover */}
                          <div className="flex items-center gap-1 flex-shrink-0 group-hover:hidden">
                            {conversationView && (threadSizeMap?.get(threadKeyOf(message)) ?? 0) > 1 && (
                              <MessagesSquare size={11} className="text-outlook-blue" aria-label="Conversation en cours" />
                            )}
                            {message.flags?.answered && (
                              <Reply size={11} className="text-outlook-text-disabled" aria-label="Répondu" />
                            )}
                            {hasVisibleAttachment(message) && (
                              <Paperclip size={11} className="text-outlook-text-disabled" />
                            )}
                            <span
                              className="text-2xs text-outlook-text-secondary w-20 text-right"
                              title={formatFullDate(message.date)}
                            >
                              {formatDate(message.date)}
                            </span>
                          </div>

                          {/* Hover actions */}
                          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                            {onMarkRead && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onMarkRead(message.uid, !message.flags?.seen); }}
                                className="p-1 rounded hover:bg-gray-200 text-outlook-text-secondary hover:text-outlook-blue transition-colors"
                                title={message.flags?.seen ? 'Marquer comme non lu' : 'Marquer comme lu'}
                              >
                                {message.flags?.seen ? <Mail size={12} /> : <MailOpen size={12} />}
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleFlag(message.uid, !message.flags?.flagged); }}
                              className={`p-1 rounded hover:bg-gray-200 transition-colors ${message.flags?.flagged ? 'text-outlook-warning' : 'text-outlook-text-secondary hover:text-outlook-warning'}`}
                              title={message.flags?.flagged ? 'Retirer le drapeau' : 'Marquer d\'un drapeau'}
                            >
                              <Flag size={12} fill={message.flags?.flagged ? 'currentColor' : 'none'} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onDelete(message.uid); }}
                              className="p-1 rounded hover:bg-red-100 text-outlook-text-secondary hover:text-red-600 transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </>
                      ) : (
                        /* ===== Narrow mode: multi-line card ===== */
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 min-h-[22px]">
                            <span className={`text-sm truncate ${isUnread ? 'font-semibold text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                              {message.from?.name || message.from?.address || 'Inconnu'}
                            </span>

                            {/* Date — shown normally, hidden on hover */}
                            <span
                              className="text-2xs text-outlook-text-secondary flex-shrink-0 group-hover:hidden"
                              title={formatFullDate(message.date)}
                            >
                              {formatDate(message.date)}
                            </span>

                            {/* Hover actions */}
                            <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                              {onMarkRead && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); onMarkRead(message.uid, !message.flags?.seen); }}
                                  className="p-1 rounded hover:bg-gray-200 text-outlook-text-secondary hover:text-outlook-blue transition-colors"
                                  title={message.flags?.seen ? 'Marquer comme non lu' : 'Marquer comme lu'}
                                >
                                  {message.flags?.seen ? <Mail size={14} /> : <MailOpen size={14} />}
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleFlag(message.uid, !message.flags?.flagged); }}
                                className={`p-1 rounded hover:bg-gray-200 transition-colors
                                  ${message.flags?.flagged ? 'text-outlook-warning' : 'text-outlook-text-secondary hover:text-outlook-warning'}`}
                                title={message.flags?.flagged ? 'Retirer le drapeau' : 'Marquer d\'un drapeau'}
                              >
                                <Flag size={14} fill={message.flags?.flagged ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleFlag(message.uid, !message.flags?.flagged); }}
                                className={`p-1 rounded hover:bg-gray-200 transition-colors
                                  ${message.flags?.flagged ? 'text-outlook-warning' : 'text-outlook-text-secondary hover:text-outlook-warning'}`}
                                title={message.flags?.flagged ? 'Retirer le favori' : 'Marquer comme favori'}
                              >
                                <Star size={14} fill={message.flags?.flagged ? 'currentColor' : 'none'} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDelete(message.uid); }}
                                className="p-1 rounded hover:bg-red-100 text-outlook-text-secondary hover:text-red-600 transition-colors"
                                title="Supprimer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          <div className={`text-sm truncate ${isUnread ? 'font-medium text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                            {message.subject || '(Sans objet)'}
                          </div>

                          {(isThreadRoot && item.childCount && item.childCount > 1) || (isThreadChild && message._folder) ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              {isThreadRoot && item.childCount && item.childCount > 1 && (
                                <span className="text-[10px] px-1.5 py-[1px] rounded-full bg-outlook-blue/10 text-outlook-blue border border-outlook-blue/30 whitespace-nowrap">
                                  {item.childCount} messages
                                </span>
                              )}
                              {isThreadChild && message._folder && (
                                <span className="text-[10px] px-1.5 py-[1px] rounded bg-outlook-bg-hover text-outlook-text-secondary border border-outlook-border whitespace-nowrap" title={message._folder}>
                                  {message._folder.split(/[\/.]/).pop() || message._folder}
                                </span>
                              )}
                            </div>
                          ) : null}

                          {msgCats.length > 0 && (
                            <div className="flex items-center flex-wrap gap-1 mt-0.5">
                              {msgCats.slice(0, 3).map((c) => (
                                <span
                                  key={c.id}
                                  className="text-[10px] px-1.5 py-[1px] rounded-full whitespace-nowrap border"
                                  style={{ backgroundColor: categoryRowTint(c.color, 0.35), borderColor: c.color, color: '#2d2d2d' }}
                                  title={c.name}
                                >
                                  {c.name}
                                </span>
                              ))}
                              {msgCats.length > 3 && (
                                <span className="text-[10px] text-outlook-text-disabled">+{msgCats.length - 3}</span>
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-outlook-text-disabled truncate flex-1">
                              {message.snippet || ''}
                            </span>
                            
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {conversationView && (threadSizeMap?.get(threadKeyOf(message)) ?? 0) > 1 && (
                                <MessagesSquare size={12} className="text-outlook-blue" aria-label="Conversation en cours" />
                              )}
                              {hasVisibleAttachment(message) && (
                                <Paperclip size={12} className="text-outlook-text-disabled" />
                              )}
                              {message.flags?.answered && (
                                <Reply size={12} className="text-outlook-text-disabled" aria-label="Répondu" />
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );

                  if (!canSwipe) {
                    // Without swipe, give the motion.div the list key directly.
                    return <div key={message.uid} style={{ display: 'contents' }}>{rowNode}</div>;
                  }

                  return (
                    <div key={message.uid} className="relative overflow-hidden select-none">
                      {/* Background revealed while swiping — split into two halves so
                          the user can see at a glance which action each direction
                          triggers. Positioned behind the actual row (which sits on
                          top and translates horizontally via Framer Motion). */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        <div className={`flex-1 flex items-center justify-start pl-5 ${rightMeta ? rightMeta.bg : 'bg-outlook-bg-primary/40'} ${rightMeta ? rightMeta.fg : 'text-outlook-text-disabled'}`}>
                          {rightMeta ? (
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {rightMeta.icon}
                              <span>{rightMeta.label}</span>
                            </div>
                          ) : null}
                        </div>
                        <div className={`flex-1 flex items-center justify-end pr-5 ${leftMeta ? leftMeta.bg : 'bg-outlook-bg-primary/40'} ${leftMeta ? leftMeta.fg : 'text-outlook-text-disabled'}`}>
                          {leftMeta ? (
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <span>{leftMeta.label}</span>
                              {leftMeta.icon}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {rowNode}
                    </div>
                  );
                });
                })()}
              </div>
            );
          })
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={buildMessageContextMenu(contextMenu.message)}
        />
      )}
    </div>
  );

  function buildMessageContextMenu(message: Email): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    if (onReply) {
      items.push({
        label: 'Répondre',
        icon: <Reply size={14} />,
        onClick: () => onReply(message),
      });
    }
    if (onReplyAll) {
      items.push({
        label: 'Répondre à tous',
        icon: <ReplyAll size={14} />,
        onClick: () => onReplyAll(message),
      });
    }
    if (onForward) {
      items.push({
        label: 'Transférer',
        icon: <Forward size={14} />,
        onClick: () => onForward(message),
      });
    }

    items.push({ label: '', separator: true, onClick: () => {} });

    if (onMarkRead) {
      items.push({
        label: message.flags?.seen ? 'Marquer comme non lu' : 'Marquer comme lu',
        icon: message.flags?.seen ? <Mail size={14} /> : <MailOpen size={14} />,
        onClick: () => onMarkRead(message.uid, !message.flags?.seen),
      });
    }

    items.push({
      label: message.flags?.flagged ? 'Retirer le drapeau' : 'Marquer d\'un drapeau',
      icon: <Flag size={14} />,
      onClick: () => onToggleFlag(message.uid, !message.flags?.flagged),
    });

    if (onOpenCategoryPicker) {
      items.push({
        label: 'Catégoriser',
        icon: <Tag size={14} />,
        onClick: () => {
          // Use the current mouse position from the stored context menu, if any.
          const pos = contextMenu || { x: 0, y: 0 } as any;
          onOpenCategoryPicker(message, pos.x, pos.y);
        },
      });
    }

    items.push({ label: '', separator: true, onClick: () => {} });

    // Déplacer submenu
    if (onMove && folders && folders.length > 0) {
      const moveableFolders = folders.filter(f => f.path !== folder);
      items.push({
        label: 'Déplacer',
        icon: <FolderInput size={14} />,
        onClick: () => {},
        submenuSearchable: true,
        submenu: moveableFolders.map(f => ({
          label: getFolderDisplayName(f.path) !== f.path ? getFolderDisplayName(f.path) : f.name,
          icon: <FolderIcon size={14} />,
          onClick: () => onMove(message.uid, f.path),
        })),
      });
    }

    // Copier submenu
    if (onCopy && folders && folders.length > 0) {
      const copyableFolders = folders.filter(f => f.path !== folder);
      items.push({
        label: 'Copier',
        icon: <Copy size={14} />,
        onClick: () => {},
        submenuSearchable: true,
        submenu: copyableFolders.map(f => ({
          label: getFolderDisplayName(f.path) !== f.path ? getFolderDisplayName(f.path) : f.name,
          icon: <FolderIcon size={14} />,
          onClick: () => onCopy(message.uid, f.path),
        })),
      });
    }

    if (onArchive) {
      items.push({
        label: 'Archiver',
        icon: <Archive size={14} />,
        onClick: () => onArchive(message.uid),
      });
    } else if (onMove) {
      const archiveFolder = folders?.find(f => f.specialUse === '\\Archive' || f.name.toLowerCase().includes('archive'));
      if (archiveFolder && archiveFolder.path !== folder) {
        items.push({
          label: 'Archiver',
          icon: <Archive size={14} />,
          onClick: () => onMove(message.uid, archiveFolder.path),
        });
      }
    }

    items.push({ label: '', separator: true, onClick: () => {} });

    items.push({
      label: 'Supprimer',
      icon: <Trash2 size={14} />,
      onClick: () => onDelete(message.uid),
      danger: true,
    });

    return items;
  }
}

// --- Grouping helpers ---

function getGroupKey(date: Date, now: Date, message: Email): string {
  // Flagged messages go to "Épinglé" group
  if (message.flags?.flagged) return 'pinned';
  if (isToday(date)) return 'today';
  if (isYesterday(date)) return 'yesterday';

  // This week (but not today/yesterday)
  if (isThisWeek(date, { weekStartsOn: 1 }) && !isToday(date) && !isYesterday(date)) {
    return 'this-week';
  }

  // This month (but not this week)
  if (isThisMonth(date)) return 'this-month';

  // Last month
  const lastMonth = subMonths(now, 1);
  if (isSameMonth(date, lastMonth) && isSameYear(date, lastMonth)) {
    return 'last-month';
  }

  // Same year - group by month name
  if (isThisYear(date)) {
    return format(date, 'MMMM', { locale: fr });
  }

  // Older - group by year
  return format(date, 'yyyy');
}

function getOrderedGroupKeys(now: Date): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [
    { key: 'pinned', label: 'Épinglé' },
    { key: 'today', label: 'Aujourd\'hui' },
    { key: 'yesterday', label: 'Hier' },
    { key: 'this-week', label: 'La semaine dernière' },
    { key: 'this-month', label: 'Ce mois-ci' },
    { key: 'last-month', label: 'Mois dernier' },
  ];

  // Add previous months of the current year (before last month)
  const lastMonth = subMonths(now, 1);
  for (let i = 2; i < 12; i++) {
    const m = subMonths(now, i);
    if (!isThisYear(m)) break;
    if (isSameMonth(m, lastMonth)) continue;
    const label = format(m, 'MMMM', { locale: fr });
    const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
    keys.push({ key: label, label: capitalized });
  }

  // Add recent years
  const thisYear = now.getFullYear();
  for (let y = thisYear - 1; y >= thisYear - 5; y--) {
    keys.push({ key: String(y), label: String(y) });
  }

  return keys;
}

function getFolderDisplayName(folder: string): string {
  return resolveFolderDisplayName(folder);
}

export function resolveFolderDisplayName(folder: string): string {
  const names: Record<string, string> = {
    'INBOX': 'Boîte de réception',
    'Sent': 'Éléments envoyés',
    'Drafts': 'Brouillons',
    'Trash': 'Éléments supprimés',
    'Junk': 'Courrier indésirable',
    'Archive': 'Archives',
  };
  // Try leaf segment against common folder names (handles `.` and `/` delimiters).
  const segments = folder.split(/[./]/);
  const leaf = segments[segments.length - 1] || folder;
  const mapped = names[folder] || names[leaf];
  if (mapped) return mapped;

  // For any nested folder, display only the leaf name (e.g. "test sous" instead of "test.test sous").
  if (segments.length > 1) return leaf;

  if (folder.toUpperCase().startsWith('INBOX.')) {
    return folder.substring(6);
  }

  return folder;
}
