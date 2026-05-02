import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Mail, CalendarDays, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { api } from '../../api';

interface UnifiedSearchDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called when an event result is clicked. The dialog closes automatically
   * afterwards. Receives the event id and its start date so the calendar
   * page can navigate to the right day.
   */
  onSelectEvent: (eventId: string, startDate: Date) => void;
}

interface EmailHit {
  id: string;
  subject: string;
  from_name: string;
  from_address: string;
  snippet: string;
  date: string;
  folder: string;
  is_read: boolean;
  account_id: string;
}

interface EventHit {
  id: string;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
  location?: string;
  calendar_name?: string;
  calendar_color?: string;
}

export default function UnifiedSearchDialog({ open, onClose, onSelectEvent }: UnifiedSearchDialogProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(false);
  const [emails, setEmails] = useState<EmailHit[]>([]);
  const [events, setEvents] = useState<EventHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the dialog opens / closes
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setEmails([]);
      setEvents([]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounce the query
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    if (debounced.length < 2) {
      setEmails([]);
      setEvents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.search(debounced)
      .then((res: any) => {
        if (cancelled) return;
        setEmails(Array.isArray(res?.emails) ? res.emails : []);
        setEvents(Array.isArray(res?.events) ? res.events : []);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || 'Erreur de recherche');
        setEmails([]);
        setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [debounced, open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const hasResults = emails.length > 0 || events.length > 0;

  const formattedEvents = useMemo(() => events.map(ev => {
    let start: Date;
    try { start = parseISO(ev.start_date); } catch { start = new Date(); }
    return { ev, start };
  }), [events]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Recherche unifiée"
    >
      <div
        className="bg-white w-full sm:max-w-2xl sm:rounded-lg shadow-xl flex flex-col max-h-full sm:max-h-[80vh] sm:mt-12"
        onClick={e => e.stopPropagation()}
      >
        {/* Header / input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-outlook-border">
          <Search size={18} className="text-outlook-text-secondary flex-shrink-0" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher des événements et des e-mails…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-outlook-text-disabled"
            autoComplete="off"
          />
          {loading && <Loader2 size={16} className="animate-spin text-outlook-text-secondary" />}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto">
          {debounced.length < 2 && (
            <div className="p-6 text-center text-sm text-outlook-text-secondary">
              Saisissez au moins 2 caractères pour rechercher dans tous vos agendas et boîtes mail.
            </div>
          )}

          {debounced.length >= 2 && error && (
            <div className="p-6 text-center text-sm text-red-600">{error}</div>
          )}

          {debounced.length >= 2 && !loading && !error && !hasResults && (
            <div className="p-6 text-center text-sm text-outlook-text-secondary">
              Aucun résultat pour « {debounced} ».
            </div>
          )}

          {events.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-outlook-text-secondary bg-outlook-bg-tertiary border-b border-outlook-border flex items-center gap-1.5">
                <CalendarDays size={12} />
                Événements ({events.length})
              </div>
              <ul>
                {formattedEvents.map(({ ev, start }) => (
                  <li key={`ev-${ev.id}`}>
                    <button
                      className="w-full text-left px-3 py-2.5 hover:bg-outlook-bg-hover border-b border-outlook-border/50 flex items-start gap-2.5"
                      onClick={() => { onSelectEvent(ev.id, start); onClose(); }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0"
                        style={{ backgroundColor: ev.calendar_color || '#6b7280' }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-outlook-text-primary truncate">
                          {ev.title || '(Sans titre)'}
                        </span>
                        <span className="block text-xs text-outlook-text-secondary truncate">
                          {format(start, "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </span>
                        {ev.calendar_name && (
                          <span className="block text-[11px] text-outlook-text-disabled truncate">
                            {ev.calendar_name}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {emails.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide font-semibold text-outlook-text-secondary bg-outlook-bg-tertiary border-b border-outlook-border flex items-center gap-1.5">
                <Mail size={12} />
                E-mails ({emails.length})
              </div>
              <ul>
                {emails.map((m) => {
                  let date: Date | null = null;
                  try { date = parseISO(m.date); } catch { /* ignore */ }
                  return (
                    <li key={`em-${m.id}`}>
                      <button
                        className="w-full text-left px-3 py-2.5 hover:bg-outlook-bg-hover border-b border-outlook-border/50 flex items-start gap-2.5"
                        onClick={() => {
                          navigate(`/mail?search=${encodeURIComponent(debounced)}`);
                          onClose();
                        }}
                      >
                        <Mail size={14} className="mt-1 flex-shrink-0 text-outlook-text-secondary" />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-outlook-text-primary truncate">
                            {m.subject || '(Sans objet)'}
                          </span>
                          <span className="block text-xs text-outlook-text-secondary truncate">
                            {(m.from_name || m.from_address) || ''}
                            {date ? ` · ${format(date, 'd MMM yyyy', { locale: fr })}` : ''}
                          </span>
                          {m.snippet && (
                            <span className="block text-[11px] text-outlook-text-disabled truncate">
                              {m.snippet}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
