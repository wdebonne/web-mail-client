import {
  format, isToday, isYesterday, isThisYear, isThisWeek, isThisMonth,
  startOfMonth, subMonths, isSameMonth, isSameYear, startOfYear,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Star, Paperclip, Trash2, Reply, ReplyAll, Forward, Mail, MailOpen,
  Flag, FolderInput, Copy, Archive, ChevronDown, ChevronRight,
  ArrowDownAZ, ArrowUpAZ, SlidersHorizontal, Filter, FolderIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Email, MailFolder } from '../../types';
import ContextMenu, { ContextMenuItem } from '../ui/ContextMenu';

type SortField = 'date' | 'from' | 'subject';
type SortOrder = 'asc' | 'desc';
type FilterType = 'all' | 'unread' | 'flagged' | 'attachments';

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
}

interface MessageGroup {
  key: string;
  label: string;
  messages: Email[];
}

export default function MessageList({
  messages, selectedMessage, loading,
  onSelectMessage, onToggleFlag, onDelete, folder, draggable = true,
  onReply, onReplyAll, onForward, onMarkRead, onMove, onCopy, folders,
}: MessageListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Email } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Filter messages
  const filteredMessages = useMemo(() => {
    switch (filterType) {
      case 'unread': return messages.filter(m => !m.flags?.seen);
      case 'flagged': return messages.filter(m => m.flags?.flagged);
      case 'attachments': return messages.filter(m => m.hasAttachments);
      default: return messages;
    }
  }, [messages, filterType]);

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

    // Build groups in display order
    const orderedKeys = getOrderedGroupKeys(now);
    for (const { key, label } of orderedKeys) {
      const msgs = groupMap.get(key);
      if (msgs && msgs.length > 0) {
        groups.push({ key, label, messages: msgs });
      }
    }

    // Catch any remaining groups (old years, etc.)
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
    if (isThisYear(date)) return format(date, 'd MMM', { locale: fr });
    return format(date, 'd MMM yyyy', { locale: fr });
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

  const sortLabel = sortField === 'date' ? 'Date' : sortField === 'from' ? 'Expéditeur' : 'Objet';
  const filterLabel = filterType === 'all' ? 'Tous' : filterType === 'unread' ? 'Non lus' : filterType === 'flagged' ? 'Suivis' : 'Pièces jointes';

  if (loading) {
    return (
      <div className="border-r border-outlook-border bg-white flex-shrink-0 overflow-hidden w-full">
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
    <div className="border-r border-outlook-border bg-white flex-shrink-0 flex flex-col overflow-hidden w-full">
      {/* Header with folder name + filter/sort toolbar */}
      <div className="border-b border-outlook-border flex-shrink-0">
        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-outlook-text-primary">
              {getFolderDisplayName(folder)}
            </h2>
            {filterType !== 'all' && (
              <span className="text-2xs bg-outlook-blue/10 text-outlook-blue px-1.5 py-0.5 rounded font-medium">
                {filterLabel}
              </span>
            )}
          </div>
          <span className="text-xs text-outlook-text-secondary">
            {filteredMessages.length}{filteredMessages.length !== messages.length ? `/${messages.length}` : ''} message{filteredMessages.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Sort & Filter bar */}
        <div className="px-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* Filter button */}
            <div className="relative">
              <button
                onClick={() => setShowFilterMenu(!showFilterMenu)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors
                  ${filterType !== 'all' ? 'bg-outlook-blue/10 text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
              >
                <Filter size={12} />
                <span>Filtrer</span>
              </button>
              {showFilterMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
                  {([
                    ['all', 'Tous les messages'],
                    ['unread', 'Non lus'],
                    ['flagged', 'Suivis (marqués)'],
                    ['attachments', 'Avec pièces jointes'],
                  ] as [FilterType, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => { setFilterType(value); setShowFilterMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover transition-colors
                        ${filterType === value ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Unread quick filter */}
            <button
              onClick={() => setFilterType(filterType === 'unread' ? 'all' : 'unread')}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors
                ${filterType === 'unread' ? 'bg-outlook-blue/10 text-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
            >
              <Mail size={12} />
              <span className="hidden sm:inline">Non lus</span>
            </button>
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="text-outlook-text-secondary hover:bg-outlook-bg-hover p-1 rounded transition-colors"
              title={sortOrder === 'desc' ? 'Plus récent d\'abord' : 'Plus ancien d\'abord'}
            >
              {sortOrder === 'desc' ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
            </button>
            <select
              value={sortField}
              onChange={e => setSortField(e.target.value as SortField)}
              className="text-xs text-outlook-text-secondary bg-transparent border-none cursor-pointer focus:outline-none hover:text-outlook-text-primary"
            >
              <option value="date">Par Date</option>
              <option value="from">Par Expéditeur</option>
              <option value="subject">Par Objet</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grouped message list */}
      <div className="flex-1 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <div className="text-center text-outlook-text-disabled py-12">
            <p className="text-sm">
              {filterType !== 'all' ? 'Aucun message correspondant au filtre' : 'Aucun message'}
            </p>
            {filterType !== 'all' && (
              <button
                onClick={() => setFilterType('all')}
                className="text-xs text-outlook-blue hover:underline mt-2"
              >
                Afficher tous les messages
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
                {!isCollapsed && group.messages.map((message) => {
                  const isSelected = selectedMessage?.uid === message.uid;
                  const isUnread = !message.flags?.seen;

                  return (
                    <div
                      key={message.uid}
                      onClick={() => onSelectMessage(message)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, message });
                      }}
                      draggable={draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/x-mail-uid', String(message.uid));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className={`flex gap-3 px-3 py-2.5 cursor-pointer border-b border-outlook-border transition-colors group
                        ${isSelected ? 'bg-blue-50 border-l-2 border-l-outlook-blue' : 'border-l-2 border-l-transparent hover:bg-outlook-bg-hover'}
                        ${isUnread ? 'bg-white' : 'bg-outlook-bg-primary/30'}`}
                    >
                      {/* Avatar */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: getAvatarColor(message.from?.name, message.from?.address) }}
                      >
                        {getInitials(message.from?.name, message.from?.address)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${isUnread ? 'font-semibold text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                            {message.from?.name || message.from?.address || 'Inconnu'}
                          </span>
                          <span className="text-2xs text-outlook-text-secondary flex-shrink-0">
                            {formatDate(message.date)}
                          </span>
                        </div>

                        <div className={`text-sm truncate ${isUnread ? 'font-medium text-outlook-text-primary' : 'text-outlook-text-secondary'}`}>
                          {message.subject || '(Sans objet)'}
                        </div>

                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-outlook-text-disabled truncate flex-1">
                            {message.snippet || ''}
                          </span>
                          
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {message.hasAttachments && (
                              <Paperclip size={12} className="text-outlook-text-disabled" />
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFlag(message.uid, !message.flags?.flagged);
                              }}
                              className={`p-0.5 rounded transition-colors
                                ${message.flags?.flagged
                                  ? 'text-outlook-warning'
                                  : 'text-transparent group-hover:text-outlook-text-disabled hover:text-outlook-warning'
                                }`}
                            >
                              <Star size={12} fill={message.flags?.flagged ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
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
  return names[folder] || names[folder.split('.').pop() || folder] || folder;
}
