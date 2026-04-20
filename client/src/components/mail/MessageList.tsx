import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Star, Paperclip, Trash2 } from 'lucide-react';
import { Email } from '../../types';

interface MessageListProps {
  messages: Email[];
  selectedMessage: Email | null;
  loading: boolean;
  onSelectMessage: (message: Email) => void;
  onToggleFlag: (uid: number, flagged: boolean) => void;
  onDelete: (uid: number) => void;
  folder: string;
}

export default function MessageList({
  messages, selectedMessage, loading,
  onSelectMessage, onToggleFlag, onDelete, folder,
}: MessageListProps) {
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

  if (loading) {
    return (
      <div className="w-96 border-r border-outlook-border bg-white flex-shrink-0 overflow-hidden">
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
    <div className="w-96 border-r border-outlook-border bg-white flex-shrink-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-outlook-border flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-semibold text-outlook-text-primary">
          {getFolderDisplayName(folder)}
        </h2>
        <span className="text-xs text-outlook-text-secondary">
          {messages.length} message{messages.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-center text-outlook-text-disabled py-12">
            <p className="text-sm">Aucun message</p>
          </div>
        ) : (
          messages.map((message) => {
            const isSelected = selectedMessage?.uid === message.uid;
            const isUnread = !message.flags?.seen;

            return (
              <div
                key={message.uid}
                onClick={() => onSelectMessage(message)}
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
          })
        )}
      </div>
    </div>
  );
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
