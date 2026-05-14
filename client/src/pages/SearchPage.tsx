import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import {
  Search, Mail, Calendar, Users, X, ChevronRight, Paperclip,
  ArrowLeft, Clock, MapPin, Building2,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

type SearchContext = 'all' | 'mail' | 'contacts' | 'events';
type DatePreset = 'all' | 'today' | 'week' | 'month' | 'year';

function dateRangeFromPreset(preset: DatePreset) {
  const now = new Date();
  const pad = (d: Date) => d.toISOString().split('T')[0];
  if (preset === 'today') return { dateFrom: pad(now), dateTo: pad(now) };
  if (preset === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
    return { dateFrom: pad(start), dateTo: pad(now) };
  }
  if (preset === 'month') {
    return { dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, dateTo: pad(now) };
  }
  if (preset === 'year') {
    return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: pad(now) };
  }
  return {};
}

function SearchFilterChip<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  const isActive = value !== options[0].value;
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors whitespace-nowrap
          ${isActive
            ? 'bg-outlook-blue text-white border-outlook-blue shadow-sm'
            : 'bg-white text-outlook-text-primary border-outlook-border hover:border-outlook-blue/60 hover:bg-blue-50/30'
          }`}
      >
        <span className={`text-xs ${isActive ? 'text-white/75' : 'text-outlook-text-secondary'}`}>{label} :</span>
        <span>{current?.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className={open ? 'rotate-180' : ''} style={{ transition: 'transform 0.15s' }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-outlook-border rounded-xl shadow-xl py-1 min-w-[180px]">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-outlook-bg-hover flex items-center justify-between
                  ${value === opt.value ? 'text-outlook-blue font-medium' : 'text-outlook-text-primary'}`}
              >
                {opt.label}
                {value === opt.value && <span className="text-outlook-blue text-base">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const [inputValue, setInputValue] = useState(query);

  const context = (searchParams.get('ctx') as SearchContext) || 'all';
  const datePreset = (searchParams.get('date') as DatePreset) || 'all';
  const hasAttachment = (searchParams.get('attach') as 'any' | 'yes' | 'no') || 'any';
  const isRead = (searchParams.get('read') as 'any' | 'read' | 'unread') || 'any';

  // Sync input with URL
  useEffect(() => { setInputValue(query); }, [query]);

  const updateParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value && value !== 'all' && value !== 'any') next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  const { dateFrom, dateTo } = useMemo(() => dateRangeFromPreset(datePreset), [datePreset]);

  const searchOpts = useMemo(() => ({
    type: context === 'all' ? undefined : context === 'events' ? 'events' : context,
    dateFrom,
    dateTo,
    hasAttachment: hasAttachment !== 'any' ? (hasAttachment === 'yes' ? 'true' as const : 'false' as const) : undefined,
    isRead: isRead !== 'any' ? (isRead === 'read' ? 'true' as const : 'false' as const) : undefined,
    limit: 30,
  }), [context, dateFrom, dateTo, hasAttachment, isRead]);

  const { data, isLoading } = useQuery({
    queryKey: ['global-search', query, searchOpts],
    queryFn: () => api.search(query, searchOpts),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('q', inputValue.trim());
        return next;
      }, { replace: true });
    }
  };

  const emails = data?.emails || [];
  const contacts = data?.contacts || [];
  const events = data?.events || [];
  const totals = data?.totals || { emails: 0, contacts: 0, events: 0 };

  const hasResults = emails.length > 0 || contacts.length > 0 || events.length > 0;
  const totalCount = (context === 'all' ? totals.emails + totals.contacts + totals.events
    : context === 'mail' ? totals.emails
    : context === 'contacts' ? totals.contacts
    : totals.events);

  return (
    <div className="h-full flex flex-col bg-outlook-bg-tertiary overflow-hidden">
      {/* Top search bar */}
      <div className="bg-white border-b border-outlook-border px-4 py-3 flex-shrink-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 rounded-lg hover:bg-outlook-bg-hover text-outlook-text-secondary transition-colors"
              title="Retour"
            >
              <ArrowLeft size={18} />
            </button>
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-outlook-text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Rechercher dans tous les e-mails, agendas et contacts…"
                  className="w-full bg-outlook-bg-hover border border-outlook-border rounded-xl px-4 py-2.5 pl-9 pr-9 text-sm text-outlook-text-primary placeholder-outlook-text-secondary focus:outline-none focus:border-outlook-blue focus:bg-white transition-all"
                  autoFocus
                />
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => setInputValue('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled hover:text-outlook-text-secondary"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Context tabs */}
            <div className="flex items-center bg-outlook-bg-hover rounded-lg p-0.5 gap-0.5 mr-1">
              {([
                { value: 'all', label: 'Tout', icon: Search },
                { value: 'mail', label: 'E-mails', icon: Mail },
                { value: 'events', label: 'Agendas', icon: Calendar },
                { value: 'contacts', label: 'Contacts', icon: Users },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => updateParam('ctx', value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors font-medium whitespace-nowrap
                    ${context === value
                      ? 'bg-white text-outlook-blue shadow-sm'
                      : 'text-outlook-text-secondary hover:text-outlook-text-primary'
                    }`}
                >
                  <Icon size={13} />
                  {label}
                  {query.trim().length >= 2 && value !== 'all' && (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${context === value ? 'bg-outlook-blue/10 text-outlook-blue' : 'bg-outlook-bg-tertiary text-outlook-text-disabled'}`}>
                      {value === 'mail' ? totals.emails : value === 'contacts' ? totals.contacts : totals.events}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <SearchFilterChip<DatePreset>
              label="Période"
              value={datePreset}
              options={[
                { value: 'all', label: 'Tout' },
                { value: 'today', label: "Aujourd'hui" },
                { value: 'week', label: 'Cette semaine' },
                { value: 'month', label: 'Ce mois' },
                { value: 'year', label: 'Cette année' },
              ]}
              onChange={(v) => updateParam('date', v)}
            />

            {(context === 'all' || context === 'mail') && (
              <>
                <SearchFilterChip<'any' | 'yes' | 'no'>
                  label="Pièces jointes"
                  value={hasAttachment}
                  options={[
                    { value: 'any', label: 'Non filtré' },
                    { value: 'yes', label: 'Avec' },
                    { value: 'no', label: 'Sans' },
                  ]}
                  onChange={(v) => updateParam('attach', v)}
                />
                <SearchFilterChip<'any' | 'read' | 'unread'>
                  label="Statut"
                  value={isRead}
                  options={[
                    { value: 'any', label: 'Non filtré' },
                    { value: 'unread', label: 'Non lu' },
                    { value: 'read', label: 'Lu' },
                  ]}
                  onChange={(v) => updateParam('read', v)}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-4">
          {/* Empty / loading state */}
          {query.trim().length < 2 && (
            <div className="flex flex-col items-center justify-center py-20 text-outlook-text-secondary">
              <Search size={40} className="mb-3 opacity-30" />
              <p className="text-base">Saisissez au moins 2 caractères pour rechercher</p>
            </div>
          )}

          {query.trim().length >= 2 && isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-outlook-text-secondary">
              <div className="w-8 h-8 border-2 border-outlook-blue border-t-transparent rounded-full animate-spin mb-3" />
              <p>Recherche en cours…</p>
            </div>
          )}

          {query.trim().length >= 2 && !isLoading && !hasResults && (
            <div className="flex flex-col items-center justify-center py-20 text-outlook-text-secondary">
              <Search size={40} className="mb-3 opacity-30" />
              <p className="text-base font-medium mb-1">Aucun résultat pour « {query} »</p>
              <p className="text-sm">Essayez avec d'autres mots-clés ou modifiez les filtres</p>
            </div>
          )}

          {query.trim().length >= 2 && !isLoading && hasResults && (
            <div className="space-y-6">
              {/* Results count */}
              <p className="text-sm text-outlook-text-secondary">
                {totalCount} résultat{totalCount !== 1 ? 's' : ''} pour « <span className="font-medium text-outlook-text-primary">{query}</span> »
              </p>

              {/* Email results */}
              {(context === 'all' || context === 'mail') && emails.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
                      <Mail size={14} className="text-outlook-blue" />
                      E-mails
                      <span className="text-xs font-normal text-outlook-text-secondary">({totals.emails})</span>
                    </h2>
                    {totals.emails > emails.length && (
                      <button
                        onClick={() => navigate(`/mail?search=${encodeURIComponent(query)}`)}
                        className="text-xs text-outlook-blue hover:underline flex items-center gap-0.5"
                      >
                        Voir tout <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                  <div className="bg-white rounded-xl border border-outlook-border overflow-hidden shadow-sm">
                    {emails.map((email, i) => (
                      <button
                        key={email.id}
                        onClick={() => navigate(`/mail?search=${encodeURIComponent(query)}&openUid=${email.uid}&accountId=${email.account_id}&folder=${encodeURIComponent(email.folder)}`)}
                        className={`w-full text-left px-4 py-3 hover:bg-outlook-bg-hover transition-colors flex items-start gap-3 group ${i > 0 ? 'border-t border-outlook-border' : ''}`}
                      >
                        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${email.is_read ? 'bg-transparent' : 'bg-outlook-blue'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-sm truncate ${email.is_read ? 'text-outlook-text-secondary' : 'text-outlook-text-primary font-semibold'}`}>
                              {email.subject || '(sans objet)'}
                            </span>
                            {email.has_attachments && <Paperclip size={12} className="text-outlook-text-disabled flex-shrink-0" />}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-outlook-text-secondary">
                            <span className="truncate">{email.from_name || email.from_address}</span>
                            <span>·</span>
                            <span className="truncate">{email.from_address}</span>
                          </div>
                          {email.snippet && (
                            <p className="text-xs text-outlook-text-disabled mt-0.5 line-clamp-1">{email.snippet}</p>
                          )}
                        </div>
                        <div className="text-xs text-outlook-text-disabled flex-shrink-0">
                          {format(parseISO(email.date), 'd MMM', { locale: fr })}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Contact results */}
              {(context === 'all' || context === 'contacts') && contacts.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
                      <Users size={14} className="text-outlook-blue" />
                      Contacts
                      <span className="text-xs font-normal text-outlook-text-secondary">({totals.contacts})</span>
                    </h2>
                    {totals.contacts > contacts.length && (
                      <button
                        onClick={() => navigate(`/contacts?search=${encodeURIComponent(query)}`)}
                        className="text-xs text-outlook-blue hover:underline flex items-center gap-0.5"
                      >
                        Voir tout <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                  <div className="bg-white rounded-xl border border-outlook-border overflow-hidden shadow-sm">
                    {contacts.map((contact, i) => (
                      <button
                        key={contact.id}
                        onClick={() => navigate(`/contacts?search=${encodeURIComponent(query)}`)}
                        className={`w-full text-left px-4 py-3 hover:bg-outlook-bg-hover transition-colors flex items-center gap-3 ${i > 0 ? 'border-t border-outlook-border' : ''}`}
                      >
                        <div className="w-9 h-9 rounded-full bg-outlook-blue/15 text-outlook-blue flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {(contact.display_name?.[0] || contact.email?.[0] || '?').toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-outlook-text-primary truncate">
                            {contact.display_name || contact.email}
                          </div>
                          <div className="text-xs text-outlook-text-secondary truncate flex items-center gap-2">
                            <span>{contact.email}</span>
                            {contact.company && (
                              <>
                                <span>·</span>
                                <Building2 size={10} />
                                <span>{contact.company}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Event results */}
              {(context === 'all' || context === 'events') && events.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
                      <Calendar size={14} className="text-outlook-blue" />
                      Événements
                      <span className="text-xs font-normal text-outlook-text-secondary">({totals.events})</span>
                    </h2>
                    {totals.events > events.length && (
                      <button
                        onClick={() => navigate(`/calendar?search=${encodeURIComponent(query)}`)}
                        className="text-xs text-outlook-blue hover:underline flex items-center gap-0.5"
                      >
                        Voir tout <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                  <div className="bg-white rounded-xl border border-outlook-border overflow-hidden shadow-sm">
                    {events.map((event, i) => (
                      <button
                        key={event.id}
                        onClick={() => navigate(`/calendar?search=${encodeURIComponent(query)}`)}
                        className={`w-full text-left px-4 py-3 hover:bg-outlook-bg-hover transition-colors flex items-start gap-3 ${i > 0 ? 'border-t border-outlook-border' : ''}`}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ background: event.calendar_color || '#3b82f6' }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-outlook-text-primary truncate">{event.title}</div>
                          <div className="text-xs text-outlook-text-secondary flex items-center gap-2 mt-0.5">
                            <Clock size={11} />
                            <span>
                              {format(parseISO(event.start_date), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                            </span>
                            {event.location && (
                              <>
                                <span>·</span>
                                <MapPin size={11} />
                                <span className="truncate">{event.location}</span>
                              </>
                            )}
                          </div>
                          {event.calendar_name && (
                            <div className="text-xs text-outlook-text-disabled mt-0.5">{event.calendar_name}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
