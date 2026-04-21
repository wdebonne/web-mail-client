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
} from 'lucide-react';
import { useMemo, useState, useRef, useEffect } from 'react';
import { Email, MailFolder } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import ContextMenu, { ContextMenuItem } from '../ui/ContextMenu';

type SortField = 'date' | 'from' | 'subject' | 'size' | 'importance';
type SortOrder = 'asc' | 'desc';
type FilterType = 'all' | 'unread' | 'flagged' | 'attachments' | 'tome';
type DateFilter = 'all' | 'today' | 'yesterday' | 'lastweek' | 'lastmonth' | 'lastyear' | 'custom';

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
  folders?: MailFolder[];
  onToggleFolderPane?: () => void;
  showFolderPane?: boolean;
  listWidth?: number;
  attachmentMinVisibleKb?: number;
  accountId?: string;
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
  onReply, onReplyAll, onForward, onMarkRead, onMove, onCopy, folders,
  onToggleFolderPane, showFolderPane, listWidth,
  attachmentMinVisibleKb = 0,
  accountId,
}: MessageListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Email } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const attachmentMinVisibleBytes = Math.max(0, attachmentMinVisibleKb) * 1024;

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
      {(listWidth ?? 0) >= 400 && (
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

                {/* Messages in group */}
                {!isCollapsed && group.messages.map((message, msgIndex) => {
                  const isSelected = selectedMessage?.uid === message.uid;
                  const isUnread = !message.flags?.seen;
                  const isChecked = selectedUids.has(message.uid);
                  const isWide = (listWidth ?? 0) >= 400;

                  return (
                    <motion.div
                      key={message.uid}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
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
                      draggable={draggable && !selectionMode}
                      onDragStartCapture={(e: any) => {
                        e.dataTransfer.setData('text/x-mail-uid', String(message.uid));
                        if (accountId) {
                          e.dataTransfer.setData(
                            'application/x-mail-message',
                            JSON.stringify({ uid: message.uid, srcAccountId: accountId, srcFolder: folder }),
                          );
                        }
                        e.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      className={`flex items-center gap-2 px-3 cursor-pointer border-b border-outlook-border transition-colors group relative
                        ${isWide ? 'py-1.5' : 'py-2.5 gap-3'}
                        ${isSelected && !selectionMode ? 'bg-blue-50 border-l-2 border-l-outlook-blue' : 'border-l-2 border-l-transparent hover:bg-outlook-bg-hover'}
                        ${isChecked ? 'bg-blue-50' : ''}
                        ${isUnread ? '' : 'bg-outlook-bg-primary/30'}`}
                    >
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

                          {/* Icons: replied, attachment */}
                          <div className="flex items-center gap-0.5 flex-shrink-0 w-8">
                            {message.flags?.answered && <Reply size={11} className="text-outlook-text-disabled" />}
                            {hasVisibleAttachment(message) && <Paperclip size={11} className="text-outlook-text-disabled" />}
                          </div>

                          {/* Subject + snippet */}
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className={`text-xs truncate ${isUnread ? 'font-medium text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                              {message.subject || '(Sans objet)'}
                            </span>
                            <span className="text-xs text-outlook-text-disabled truncate">
                              {message.snippet || ''}
                            </span>
                          </div>

                          {/* Date — shown normally, hidden on hover */}
                          <span
                            className="text-2xs text-outlook-text-secondary flex-shrink-0 w-20 text-right group-hover:hidden"
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
                          <div className="flex items-center justify-between gap-2">
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

                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-xs text-outlook-text-disabled truncate flex-1">
                              {message.snippet || ''}
                            </span>
                            
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {hasVisibleAttachment(message) && (
                                <Paperclip size={12} className="text-outlook-text-disabled" />
                              )}
                              {message.flags?.answered && (
                                <Reply size={12} className="text-outlook-text-disabled" />
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleFlag(message.uid, !message.flags?.flagged);
                                }}
                                className={`p-0.5 rounded transition-colors
                                  ${message.flags?.flagged
                                    ? 'text-outlook-warning'
                                    : 'text-transparent group-hover:text-outlook-text-disabled hover:!text-outlook-warning'
                                  }`}
                              >
                                <Star size={12} fill={message.flags?.flagged ? 'currentColor' : 'none'} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
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

    if (onMove) {
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
