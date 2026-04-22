import { useState, useMemo, useRef } from 'react';
import { format, parseISO } from 'date-fns';
import {
  X, Paperclip, Plus, Trash2, Users, Repeat, FileText, Upload, Tag, Link as LinkIcon,
} from 'lucide-react';
import type { CalendarEvent, Calendar, EventAttendee } from '../../types';

/* ============================================================
 * Types
 * ==========================================================*/

type Tab = 'summary' | 'recurrence' | 'attendees' | 'attachments';

type Freq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';
type EndMode = 'never' | 'count' | 'until';
type MonthlyMode = 'bymonthday' | 'bysetpos';

interface Recurrence {
  freq: Freq;
  interval: number;
  byDay: string[];      // weekly (MO, TU, WE, TH, FR, SA, SU) OR monthly bysetpos day
  byMonthDay: number[]; // monthly "chaque" (1..31)
  byMonth: number[];    // yearly (1..12)
  monthlyMode: MonthlyMode;
  setPos: number;       // 1..5 or -1 (premier, deuxième, ..., dernier)
  endMode: EndMode;
  count: number;
  until: string;        // YYYY-MM-DD
  rdates: string[];     // for freq=CUSTOM
}

export interface EventModalData {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  recurrenceRule?: string;
  rdates?: string[];
  reminderMinutes?: number | null;
  attendees?: EventAttendee[];
  status: string;
  priority?: number | null;
  url?: string;
  categories?: string[];
  transparency?: 'OPAQUE' | 'TRANSPARENT';
  attachments?: Array<{ name: string; mime?: string; size?: number; data?: string; url?: string }>;
}

interface EventModalProps {
  calendars: Calendar[];
  initialDate: Date;
  editingEvent: CalendarEvent | null;
  onSubmit: (data: EventModalData) => void;
  onClose: () => void;
  isSubmitting: boolean;
  defaultOrganizerEmail?: string;
  /** Tab to activate when the modal opens. Defaults to `summary`. */
  initialTab?: Tab;
  /** Default duration in minutes for new events (fallback when no editingEvent). Defaults to 60. */
  defaultDurationMinutes?: number;
}

/* ============================================================
 * Constants
 * ==========================================================*/

const WEEKDAYS = [
  { key: 'MO', label: 'Lun' },
  { key: 'TU', label: 'Mar' },
  { key: 'WE', label: 'Mer' },
  { key: 'TH', label: 'Jeu' },
  { key: 'FR', label: 'Ven' },
  { key: 'SA', label: 'Sam' },
  { key: 'SU', label: 'Dim' },
];

const MONTHS = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
  'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc',
];

const REMINDER_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'Aucun' },
  { value: 0, label: 'À l\'heure de l\'événement' },
  { value: 5, label: '5 minutes avant' },
  { value: 10, label: '10 minutes avant' },
  { value: 15, label: '15 minutes avant' },
  { value: 30, label: '30 minutes avant' },
  { value: 60, label: '1 heure avant' },
  { value: 120, label: '2 heures avant' },
  { value: 1440, label: '1 jour avant' },
  { value: 2880, label: '2 jours avant' },
  { value: 10080, label: '1 semaine avant' },
];

const PRIORITY_LEVELS = [
  { value: 0, label: '—' },
  { value: 9, label: 'Basse' },
  { value: 5, label: 'Normale' },
  { value: 1, label: 'Haute' },
];

const STATUS_OPTIONS = [
  { value: 'confirmed', label: 'Confirmé' },
  { value: 'tentative', label: 'Provisoire' },
  { value: 'cancelled', label: 'Annulé' },
];

const SET_POS_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'premier' },
  { value: 2, label: 'deuxième' },
  { value: 3, label: 'troisième' },
  { value: 4, label: 'quatrième' },
  { value: -1, label: 'dernier' },
];

/* ============================================================
 * RRULE helpers
 * ==========================================================*/

function parseRRule(rule?: string): Partial<Recurrence> {
  if (!rule) return {};
  const out: Partial<Recurrence> = {};
  for (const part of rule.split(';')) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    switch (k.toUpperCase()) {
      case 'FREQ': out.freq = v.toUpperCase() as Freq; break;
      case 'INTERVAL': out.interval = parseInt(v, 10) || 1; break;
      case 'BYDAY': {
        const days = v.split(',');
        // Detect BYSETPOS style like "1MO" or "-1FR"
        const match = days[0].match(/^(-?\d+)([A-Z]{2})$/);
        if (match) {
          out.setPos = parseInt(match[1], 10);
          out.byDay = days.map(d => d.match(/[A-Z]{2}$/)?.[0] || '').filter(Boolean);
          out.monthlyMode = 'bysetpos';
        } else {
          out.byDay = days;
        }
        break;
      }
      case 'BYMONTHDAY': out.byMonthDay = v.split(',').map(n => parseInt(n, 10)); break;
      case 'BYMONTH': out.byMonth = v.split(',').map(n => parseInt(n, 10)); break;
      case 'COUNT': out.count = parseInt(v, 10); out.endMode = 'count'; break;
      case 'UNTIL': {
        const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
        if (m) { out.until = `${m[1]}-${m[2]}-${m[3]}`; out.endMode = 'until'; }
        break;
      }
    }
  }
  return out;
}

function buildRRule(r: Recurrence): string | undefined {
  if (r.freq === 'NONE' || r.freq === 'CUSTOM') return undefined;
  const parts: string[] = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);

  if (r.freq === 'WEEKLY' && r.byDay.length) {
    parts.push(`BYDAY=${r.byDay.join(',')}`);
  }
  if (r.freq === 'MONTHLY') {
    if (r.monthlyMode === 'bysetpos' && r.byDay.length) {
      parts.push(`BYDAY=${r.byDay.map(d => `${r.setPos}${d}`).join(',')}`);
    } else if (r.byMonthDay.length) {
      parts.push(`BYMONTHDAY=${r.byMonthDay.join(',')}`);
    }
  }
  if (r.freq === 'YEARLY' && r.byMonth.length) {
    parts.push(`BYMONTH=${r.byMonth.join(',')}`);
  }

  if (r.endMode === 'count' && r.count > 0) parts.push(`COUNT=${r.count}`);
  if (r.endMode === 'until' && r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959Z`);

  return parts.join(';');
}

function defaultRecurrence(): Recurrence {
  return {
    freq: 'NONE',
    interval: 1,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    monthlyMode: 'bymonthday',
    setPos: 1,
    endMode: 'never',
    count: 1,
    until: '',
    rdates: [],
  };
}

/* ============================================================
 * Component
 * ==========================================================*/

export default function EventModal({
  calendars, initialDate, editingEvent, onSubmit, onClose, isSubmitting, defaultOrganizerEmail,
  initialTab = 'summary', defaultDurationMinutes = 60,
}: EventModalProps) {
  const seedStart = editingEvent ? parseISO(editingEvent.start_date) : initialDate;
  const seedEnd = editingEvent
    ? parseISO(editingEvent.end_date)
    : new Date(initialDate.getTime() + Math.max(5, defaultDurationMinutes) * 60_000);

  const [tab, setTab] = useState<Tab>(initialTab);

  // ── Summary ──
  const [title, setTitle] = useState(editingEvent?.title || '');
  const [location, setLocation] = useState(editingEvent?.location || '');
  const [description, setDescription] = useState(editingEvent?.description || '');
  const [calendarId, setCalendarId] = useState(
    editingEvent?.calendar_id || calendars.find(c => c.is_default)?.id || calendars[0]?.id || ''
  );
  const [allDay, setAllDay] = useState(!!editingEvent?.all_day);
  const [startDate, setStartDate] = useState(format(seedStart, 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState(format(seedStart, 'HH:mm'));
  const [endDate, setEndDate] = useState(format(seedEnd, 'yyyy-MM-dd'));
  const [endTime, setEndTime] = useState(format(seedEnd, 'HH:mm'));
  const [reminder, setReminder] = useState<number | null>(editingEvent?.reminder_minutes ?? null);
  const [categories, setCategories] = useState<string[]>(editingEvent?.categories || []);
  const [categoryInput, setCategoryInput] = useState('');
  const [status, setStatus] = useState(editingEvent?.status || 'confirmed');
  const [transparency, setTransparency] = useState<'OPAQUE' | 'TRANSPARENT'>(
    editingEvent?.transparency || 'OPAQUE'
  );
  const [priority, setPriority] = useState<number>(editingEvent?.priority ?? 0);
  const [url, setUrl] = useState(editingEvent?.url || '');

  // ── Recurrence ──
  const [rec, setRec] = useState<Recurrence>(() => {
    const base = defaultRecurrence();
    const parsed = parseRRule(editingEvent?.recurrence_rule);
    const merged = { ...base, ...parsed };
    if (editingEvent?.rdates?.length) {
      merged.freq = 'CUSTOM';
      merged.rdates = editingEvent.rdates.map(d => d.split('T')[0]);
    }
    return merged;
  });

  // ── Attendees ──
  const organizerEmail = editingEvent?.organizer?.email || defaultOrganizerEmail || '';
  const [attendees, setAttendees] = useState<EventAttendee[]>(editingEvent?.attendees || []);
  const [attendeeInput, setAttendeeInput] = useState('');
  const [invitationComment, setInvitationComment] = useState('');

  // ── Attachments ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; mime?: string; size?: number; data?: string; url?: string }>>(
    editingEvent?.attachments || []
  );

  /* ── Derived ── */
  const selectedCalendar = useMemo(
    () => calendars.find(c => c.id === calendarId),
    [calendars, calendarId]
  );

  /* ── Handlers ── */
  const toggleWeekday = (key: string) => {
    setRec(r => ({
      ...r,
      byDay: r.byDay.includes(key) ? r.byDay.filter(d => d !== key) : [...r.byDay, key],
    }));
  };
  const toggleMonthDay = (n: number) => {
    setRec(r => ({
      ...r,
      byMonthDay: r.byMonthDay.includes(n) ? r.byMonthDay.filter(d => d !== n) : [...r.byMonthDay, n],
    }));
  };
  const toggleMonth = (n: number) => {
    setRec(r => ({
      ...r,
      byMonth: r.byMonth.includes(n) ? r.byMonth.filter(d => d !== n) : [...r.byMonth, n],
    }));
  };
  const addRdate = (date: string) => {
    if (!date) return;
    setRec(r => r.rdates.includes(date) ? r : { ...r, rdates: [...r.rdates, date].sort() });
  };
  const removeRdate = (date: string) => {
    setRec(r => ({ ...r, rdates: r.rdates.filter(d => d !== date) }));
  };

  const addCategory = () => {
    const v = categoryInput.trim();
    if (!v || categories.includes(v)) { setCategoryInput(''); return; }
    setCategories([...categories, v]);
    setCategoryInput('');
  };
  const removeCategory = (c: string) => setCategories(categories.filter(x => x !== c));

  const addAttendee = () => {
    const email = attendeeInput.trim();
    if (!email || !/^.+@.+\..+$/.test(email)) return;
    if (attendees.some(a => a.email === email)) return;
    setAttendees([...attendees, { email, role: 'REQ-PARTICIPANT', status: 'pending', rsvp: true }]);
    setAttendeeInput('');
  };
  const removeAttendee = (email: string) => setAttendees(attendees.filter(a => a.email !== email));
  const updateAttendee = (email: string, patch: Partial<EventAttendee>) =>
    setAttendees(attendees.map(a => a.email === email ? { ...a, ...patch } : a));

  const onFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const next: typeof attachments = [...attachments];
    for (const f of files) {
      if (f.size > 250 * 1024 * 1024) continue; // 250 Mo max
      const buf = await f.arrayBuffer();
      const b64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
      next.push({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size, data: b64 });
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const removeAttachment = (idx: number) => setAttachments(attachments.filter((_, i) => i !== idx));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !calendarId) return;

    const start = allDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`;
    const end = allDay
      ? `${endDate || startDate}T23:59:59`
      : `${endDate || startDate}T${endTime || startTime}:00`;

    const rrule = buildRRule(rec);
    const rdates = rec.freq === 'CUSTOM' ? rec.rdates.map(d => `${d}T00:00:00`) : undefined;

    const payload: EventModalData = {
      calendarId,
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      startDate: start,
      endDate: end,
      allDay,
      recurrenceRule: rrule,
      rdates,
      reminderMinutes: reminder,
      attendees: attendees.length ? attendees : undefined,
      status,
      priority: priority || null,
      url: url.trim() || undefined,
      categories: categories.length ? categories : undefined,
      transparency,
      attachments: attachments.length ? attachments : undefined,
    };

    // organizerComment could be passed via email dispatch — out of scope here.
    void invitationComment;
    onSubmit(payload);
  };

  /* ── Render ── */
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border flex-shrink-0">
          <h2 className="text-lg font-semibold">
            {editingEvent ? "Modifier l'événement" : 'Nouvel événement'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-outlook-border px-4 flex-shrink-0">
          <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')} icon={<FileText size={14} />}>Résumé</TabBtn>
          <TabBtn active={tab === 'recurrence'} onClick={() => setTab('recurrence')} icon={<Repeat size={14} />}>Récurrence</TabBtn>
          <TabBtn active={tab === 'attendees'} onClick={() => setTab('attendees')} icon={<Users size={14} />}>
            Participants {attendees.length > 0 && <span className="ml-1 text-xs bg-outlook-blue text-white rounded-full px-1.5">{attendees.length}</span>}
          </TabBtn>
          <TabBtn active={tab === 'attachments'} onClick={() => setTab('attachments')} icon={<Paperclip size={14} />}>
            Pièces jointes {attachments.length > 0 && <span className="ml-1 text-xs bg-outlook-blue text-white rounded-full px-1.5">{attachments.length}</span>}
          </TabBtn>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {tab === 'summary' && (
              <>
                <Field label="Résumé" required>
                  <input
                    autoFocus
                    required
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                    placeholder="Titre de l'événement"
                  />
                </Field>
                <Field label="Lieu">
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                  />
                </Field>

                <div className="grid grid-cols-[90px_1fr] items-start gap-3">
                  <label className="text-sm text-outlook-text-secondary pt-2">Début</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="border border-outlook-border rounded px-2 py-1.5 text-sm"
                    />
                    {!allDay && (
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="border border-outlook-border rounded px-2 py-1.5 text-sm"
                      />
                    )}
                    <label className="flex items-center gap-2 text-sm ml-2">
                      <ToggleSwitch checked={allDay} onChange={setAllDay} />
                      toute la journée
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-[90px_1fr] items-start gap-3">
                  <label className="text-sm text-outlook-text-secondary pt-2">Fin</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="border border-outlook-border rounded px-2 py-1.5 text-sm"
                    />
                    {!allDay && (
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="border border-outlook-border rounded px-2 py-1.5 text-sm"
                      />
                    )}
                  </div>
                </div>

                <Field label="Rappel">
                  <select
                    value={reminder === null ? '' : String(reminder)}
                    onChange={(e) => setReminder(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm bg-white dark:bg-outlook-bg-dark"
                  >
                    {REMINDER_OPTIONS.map(o => (
                      <option key={String(o.value)} value={o.value === null ? '' : String(o.value)}>{o.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Calendrier">
                  <select
                    value={calendarId}
                    onChange={(e) => setCalendarId(e.target.value)}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm bg-white dark:bg-outlook-bg-dark"
                  >
                    {calendars.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.source === 'caldav' ? ' (CalDAV)' : ''}
                      </option>
                    ))}
                  </select>
                  {selectedCalendar?.source === 'caldav' && (
                    <p className="text-xs text-outlook-text-secondary mt-1">
                      L'événement sera synchronisé automatiquement avec le serveur CalDAV.
                    </p>
                  )}
                </Field>

                <Field label="Catégorie">
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {categories.map(c => (
                      <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-outlook-blue/10 text-outlook-blue rounded-full text-xs">
                        <Tag size={10} />
                        {c}
                        <button type="button" onClick={() => removeCategory(c)} className="ml-1 hover:text-red-600">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={categoryInput}
                      onChange={(e) => setCategoryInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                      placeholder={categories.length ? 'Ajouter…' : '—'}
                      className="flex-1 min-w-[8rem] border border-outlook-border rounded px-2 py-1 text-xs"
                    />
                  </div>
                </Field>

                <Field label="Statut">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm bg-white dark:bg-outlook-bg-dark"
                  >
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>

                <Field label="Montrez-moi en tant que">
                  <select
                    value={transparency}
                    onChange={(e) => setTransparency(e.target.value as 'OPAQUE' | 'TRANSPARENT')}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm bg-white dark:bg-outlook-bg-dark"
                  >
                    <option value="OPAQUE">Occupé</option>
                    <option value="TRANSPARENT">Disponible</option>
                  </select>
                </Field>

                <Field label="Priorité">
                  <select
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm bg-white dark:bg-outlook-bg-dark"
                  >
                    {PRIORITY_LEVELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>

                <Field label="URL">
                  <div className="relative">
                    <LinkIcon size={14} className="absolute left-2 top-2.5 text-outlook-text-secondary" />
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://…"
                      className="w-full border border-outlook-border rounded pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                    />
                  </div>
                </Field>
              </>
            )}

            {tab === 'recurrence' && (
              <RecurrenceTab rec={rec} setRec={setRec}
                toggleWeekday={toggleWeekday}
                toggleMonthDay={toggleMonthDay}
                toggleMonth={toggleMonth}
                addRdate={addRdate}
                removeRdate={removeRdate}
              />
            )}

            {tab === 'attendees' && (
              <div className="space-y-3">
                <div className="grid grid-cols-[120px_1fr_auto] gap-2 text-xs font-medium text-outlook-text-secondary uppercase tracking-wide">
                  <div>Rôle</div>
                  <div>Participant</div>
                  <div></div>
                </div>
                {organizerEmail && (
                  <div className="grid grid-cols-[120px_1fr_auto] gap-2 items-center">
                    <input
                      type="text"
                      disabled
                      value="Organisateur"
                      className="border border-outlook-border bg-gray-50 rounded px-2 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      disabled
                      value={organizerEmail}
                      className="border border-outlook-border bg-gray-50 rounded px-2 py-1.5 text-sm"
                    />
                    <span className="text-outlook-text-secondary text-xs">—</span>
                  </div>
                )}
                {attendees.map(a => (
                  <div key={a.email} className="grid grid-cols-[120px_1fr_auto] gap-2 items-center">
                    <select
                      value={a.role || 'REQ-PARTICIPANT'}
                      onChange={(e) => updateAttendee(a.email, { role: e.target.value as any })}
                      className="border border-outlook-border rounded px-2 py-1.5 text-sm bg-white dark:bg-outlook-bg-dark"
                    >
                      <option value="REQ-PARTICIPANT">Requis</option>
                      <option value="OPT-PARTICIPANT">Optionnel</option>
                      <option value="CHAIR">Président</option>
                      <option value="NON-PARTICIPANT">Non participant</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        value={a.email}
                        readOnly
                        className="flex-1 border border-outlook-border rounded px-2 py-1.5 text-sm"
                      />
                      <select
                        value={a.status}
                        onChange={(e) => updateAttendee(a.email, { status: e.target.value })}
                        className="border border-outlook-border rounded px-1 py-1.5 text-xs bg-white dark:bg-outlook-bg-dark"
                      >
                        <option value="pending">En attente</option>
                        <option value="accepted">Accepté</option>
                        <option value="declined">Refusé</option>
                        <option value="tentative">Provisoire</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttendee(a.email)}
                      className="p-1 rounded hover:bg-red-50 text-red-600"
                      title="Retirer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-2 border-t border-outlook-border">
                  <input
                    type="email"
                    placeholder="email@exemple.com"
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttendee(); } }}
                    className="flex-1 border border-outlook-border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                  />
                  <button
                    type="button"
                    onClick={addAttendee}
                    className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1.5"
                  >
                    <Plus size={14} /> Ajouter
                  </button>
                </div>
                <Field label="Commentaire d'invitation ou de notification">
                  <textarea
                    value={invitationComment}
                    onChange={(e) => setInvitationComment(e.target.value)}
                    rows={3}
                    className="w-full border border-outlook-border rounded px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                    placeholder="Ce commentaire sera envoyé avec l'invitation par email."
                  />
                </Field>
              </div>
            )}

            {tab === 'attachments' && (
              <div className="space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={onFilePick}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-outlook-border rounded-lg p-6 text-center hover:bg-outlook-bg-hover transition-colors"
                >
                  <Upload size={28} className="mx-auto mb-2 text-outlook-text-secondary" />
                  <div className="text-sm font-medium">Joindre un fichier</div>
                  <div className="text-xs text-outlook-text-secondary mt-1">
                    Glissez-déposez ou cliquez. Taille maximale : 250 Mo par fichier.
                  </div>
                </button>
                {attachments.length > 0 && (
                  <ul className="divide-y divide-outlook-border border border-outlook-border rounded">
                    {attachments.map((a, i) => (
                      <li key={i} className="flex items-center gap-3 px-3 py-2">
                        <Paperclip size={14} className="text-outlook-text-secondary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{a.name}</div>
                          <div className="text-xs text-outlook-text-secondary">
                            {a.mime || 'application/octet-stream'} · {formatSize(a.size)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          className="p-1 rounded hover:bg-red-50 text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outlook-border flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !calendarId}
              className="px-4 py-2 text-sm bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded disabled:opacity-50"
            >
              {isSubmitting ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
 * Sub-components
 * ==========================================================*/

function TabBtn({ active, onClick, children, icon }: {
  active: boolean; onClick: () => void; children: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? 'border-outlook-blue text-outlook-blue font-medium'
          : 'border-transparent text-outlook-text-secondary hover:text-outlook-text-primary hover:bg-outlook-bg-hover'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-start gap-3">
      <label className="text-sm text-outlook-text-secondary pt-2">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      <div>{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${
        checked ? 'bg-outlook-blue' : 'bg-gray-300'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

function RecurrenceTab({ rec, setRec, toggleWeekday, toggleMonthDay, toggleMonth, addRdate, removeRdate }: {
  rec: Recurrence;
  setRec: React.Dispatch<React.SetStateAction<Recurrence>>;
  toggleWeekday: (k: string) => void;
  toggleMonthDay: (n: number) => void;
  toggleMonth: (n: number) => void;
  addRdate: (d: string) => void;
  removeRdate: (d: string) => void;
}) {
  const [newRdate, setNewRdate] = useState('');
  const unit = rec.freq === 'DAILY' ? 'jour(s)'
    : rec.freq === 'WEEKLY' ? 'semaine(s)'
    : rec.freq === 'MONTHLY' ? 'mois'
    : rec.freq === 'YEARLY' ? 'année(s) en :'
    : '';

  return (
    <div className="space-y-4">
      <Field label="Répéter">
        <select
          value={rec.freq}
          onChange={(e) => setRec(r => ({ ...r, freq: e.target.value as Freq }))}
          className="w-full border border-outlook-border rounded px-3 py-2 text-sm bg-white dark:bg-outlook-bg-dark"
        >
          <option value="NONE">jamais</option>
          <option value="DAILY">quotidienne</option>
          <option value="WEEKLY">hebdomadaire</option>
          <option value="MONTHLY">mensuelle</option>
          <option value="YEARLY">annuelle</option>
          <option value="CUSTOM">à certaines dates</option>
        </select>
      </Field>

      {rec.freq !== 'NONE' && rec.freq !== 'CUSTOM' && (
        <Field label="Tous les">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={rec.interval}
              onChange={(e) => setRec(r => ({ ...r, interval: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
              className="w-20 border border-outlook-border rounded px-2 py-1.5 text-sm"
            />
            <span className="text-sm text-outlook-text-secondary">{unit}</span>
          </div>
        </Field>
      )}

      {rec.freq === 'WEEKLY' && (
        <Field label="Le">
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map(d => (
              <label key={d.key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={rec.byDay.includes(d.key)}
                  onChange={() => toggleWeekday(d.key)}
                  className="rounded"
                />
                {d.label}
              </label>
            ))}
          </div>
        </Field>
      )}

      {rec.freq === 'MONTHLY' && (
        <Field label="Le">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={rec.monthlyMode === 'bymonthday'}
                onChange={() => setRec(r => ({ ...r, monthlyMode: 'bymonthday' }))}
              />
              Chaque
            </label>
            {rec.monthlyMode === 'bymonthday' && (
              <div className="grid grid-cols-7 gap-1.5 ml-6">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(n => (
                  <label key={n} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={rec.byMonthDay.includes(n)}
                      onChange={() => toggleMonthDay(n)}
                      className="rounded"
                    />
                    {n}
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={rec.monthlyMode === 'bysetpos'}
                onChange={() => setRec(r => ({ ...r, monthlyMode: 'bysetpos' }))}
              />
              Tous les
            </label>
            {rec.monthlyMode === 'bysetpos' && (
              <div className="flex gap-2 ml-6">
                <select
                  value={rec.setPos}
                  onChange={(e) => setRec(r => ({ ...r, setPos: parseInt(e.target.value, 10) }))}
                  className="border border-outlook-border rounded px-2 py-1.5 text-sm bg-white dark:bg-outlook-bg-dark"
                >
                  {SET_POS_LABELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={rec.byDay[0] || 'MO'}
                  onChange={(e) => setRec(r => ({ ...r, byDay: [e.target.value] }))}
                  className="border border-outlook-border rounded px-2 py-1.5 text-sm bg-white dark:bg-outlook-bg-dark"
                >
                  {WEEKDAYS.map(d => <option key={d.key} value={d.key}>{fullDayName(d.key)}</option>)}
                </select>
              </div>
            )}
          </div>
        </Field>
      )}

      {rec.freq === 'YEARLY' && (
        <Field label="Le">
          <div className="grid grid-cols-4 gap-2">
            {MONTHS.map((m, i) => (
              <label key={m} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={rec.byMonth.includes(i + 1)}
                  onChange={() => toggleMonth(i + 1)}
                  className="rounded"
                />
                {m}
              </label>
            ))}
          </div>
        </Field>
      )}

      {rec.freq === 'CUSTOM' && (
        <Field label="Le">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="date"
                value={newRdate}
                onChange={(e) => setNewRdate(e.target.value)}
                className="flex-1 border border-outlook-border rounded px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => { addRdate(newRdate); setNewRdate(''); }}
                className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
              >
                Ajoutez une date répétée
              </button>
            </div>
            {rec.rdates.length > 0 && (
              <ul className="space-y-1">
                {rec.rdates.map(d => (
                  <li key={d} className="flex items-center justify-between px-2 py-1 bg-outlook-bg-hover/30 rounded text-sm">
                    <span>{d}</span>
                    <button type="button" onClick={() => removeRdate(d)} className="text-red-600 hover:text-red-700">
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
      )}

      {rec.freq !== 'NONE' && rec.freq !== 'CUSTOM' && (
        <Field label="Jusqu'à">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={rec.endMode === 'never'}
                onChange={() => setRec(r => ({ ...r, endMode: 'never' }))}
              />
              toujours
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={rec.endMode === 'count'}
                onChange={() => setRec(r => ({ ...r, endMode: 'count' }))}
              />
              <span className="text-xs text-outlook-text-secondary w-8">for</span>
              <input
                type="number"
                min={1}
                disabled={rec.endMode !== 'count'}
                value={rec.count}
                onChange={(e) => setRec(r => ({ ...r, count: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                className="w-20 border border-outlook-border rounded px-2 py-1 text-sm disabled:bg-gray-50"
              />
              <span className="text-xs text-outlook-text-secondary">fois</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={rec.endMode === 'until'}
                onChange={() => setRec(r => ({ ...r, endMode: 'until' }))}
              />
              <span className="text-xs text-outlook-text-secondary w-8">le</span>
              <input
                type="date"
                disabled={rec.endMode !== 'until'}
                value={rec.until}
                onChange={(e) => setRec(r => ({ ...r, until: e.target.value }))}
                className="border border-outlook-border rounded px-2 py-1 text-sm disabled:bg-gray-50"
              />
            </label>
          </div>
        </Field>
      )}
    </div>
  );
}

/* ============================================================
 * Small helpers
 * ==========================================================*/

function fullDayName(k: string): string {
  return ({
    MO: 'Lundi', TU: 'Mardi', WE: 'Mercredi', TH: 'Jeudi',
    FR: 'Vendredi', SA: 'Samedi', SU: 'Dimanche',
  } as Record<string, string>)[k] || k;
}

function formatSize(n?: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} Go`;
}
