// Minimal RFC 5545 iCalendar serializer for local events.
// Used for admin backup/export so calendars can be recovered outside the app.

export interface IcalEventRow {
  id: string;
  title: string | null;
  description?: string | null;
  location?: string | null;
  start_date: string | Date;
  end_date: string | Date;
  all_day?: boolean;
  recurrence_rule?: string | null;
  rdates?: any; // string[] ISO dates
  ical_uid?: string | null;
  ical_data?: string | null;
  status?: string | null;
  attendees?: any;
  organizer?: any;
  priority?: number | null;
  url?: string | null;
  categories?: any;
  transparency?: string | null;
  reminder_minutes?: number | null;
  attachments?: any;
}

function escapeText(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\n|\r/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
    i += 73;
  }
  return parts.join('\r\n');
}

function formatDate(d: Date, allDay = false): string {
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Build a full VCALENDAR for a list of events. */
export function buildIcs(calendarName: string, events: IcalEventRow[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WebMailClient//Calendar//FR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const ev of events) {
    // If we already have valid ical_data from CalDAV sync, reuse the VEVENT portion
    if (ev.ical_data && /BEGIN:VEVENT/i.test(ev.ical_data)) {
      const match = ev.ical_data.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/i);
      if (match) {
        lines.push(match[0].replace(/\r?\n/g, '\r\n'));
        continue;
      }
    }

    const start = typeof ev.start_date === 'string' ? new Date(ev.start_date) : ev.start_date;
    const end = typeof ev.end_date === 'string' ? new Date(ev.end_date) : ev.end_date;
    const allDay = !!ev.all_day;
    const uid = ev.ical_uid || `${ev.id}@webmail.local`;
    const now = formatDate(new Date());

    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${uid}`));
    lines.push(`DTSTAMP:${now}`);
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDate(start, true)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDate(end, true)}`);
    } else {
      lines.push(`DTSTART:${formatDate(start)}`);
      lines.push(`DTEND:${formatDate(end)}`);
    }
    lines.push(foldLine(`SUMMARY:${escapeText(ev.title || '(sans titre)')}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
    if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`));
    if (ev.status) lines.push(`STATUS:${String(ev.status).toUpperCase()}`);
    if (ev.recurrence_rule) lines.push(`RRULE:${ev.recurrence_rule}`);

    // RDATE (list of specific additional dates)
    const rdates = normalizeArray(ev.rdates);
    if (rdates.length > 0) {
      const formatted = rdates
        .map(v => {
          const d = v instanceof Date ? v : new Date(String(v));
          return Number.isNaN(d.getTime()) ? null : formatDate(d, allDay);
        })
        .filter((v): v is string => !!v);
      if (formatted.length > 0) {
        lines.push(foldLine(`RDATE${allDay ? ';VALUE=DATE' : ''}:${formatted.join(',')}`));
      }
    }

    // Transparency / "Show me as"
    if (ev.transparency) lines.push(`TRANSP:${ev.transparency === 'TRANSPARENT' ? 'TRANSPARENT' : 'OPAQUE'}`);

    // Priority (0 = undefined, 1 = highest, 9 = lowest per RFC 5545)
    if (typeof ev.priority === 'number' && ev.priority > 0) lines.push(`PRIORITY:${ev.priority}`);

    // Categories
    const cats = normalizeArray(ev.categories);
    if (cats.length > 0) {
      lines.push(foldLine(`CATEGORIES:${cats.map(escapeText).join(',')}`));
    }

    // URL
    if (ev.url) lines.push(foldLine(`URL:${ev.url}`));

    // Organizer
    const org = parseJson(ev.organizer);
    if (org?.email) {
      const cn = org.name ? `;CN=${escapeText(org.name)}` : '';
      lines.push(foldLine(`ORGANIZER${cn}:mailto:${org.email}`));
    }

    // Attendees
    const attendees = normalizeArray(ev.attendees) as any[];
    for (const att of attendees) {
      if (!att?.email) continue;
      const params: string[] = [];
      if (att.role) params.push(`ROLE=${att.role}`);
      if (att.status) params.push(`PARTSTAT=${mapPartStat(att.status)}`);
      if (att.rsvp) params.push('RSVP=TRUE');
      if (att.name) params.push(`CN=${escapeText(att.name)}`);
      const p = params.length ? ';' + params.join(';') : '';
      lines.push(foldLine(`ATTENDEE${p}:mailto:${att.email}`));
    }

    // Attachments
    const attach = normalizeArray(ev.attachments) as any[];
    for (const a of attach) {
      if (a?.url) {
        lines.push(foldLine(`ATTACH:${a.url}`));
      } else if (a?.data) {
        const mime = a.mime || 'application/octet-stream';
        lines.push(foldLine(`ATTACH;VALUE=BINARY;ENCODING=BASE64;FMTTYPE=${mime}:${a.data}`));
      }
    }

    // VALARM (reminder)
    if (typeof ev.reminder_minutes === 'number' && ev.reminder_minutes > 0) {
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(foldLine(`DESCRIPTION:${escapeText(ev.title || 'Rappel')}`));
      lines.push(`TRIGGER:-PT${ev.reminder_minutes}M`);
      lines.push('END:VALARM');
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function normalizeArray(v: any): any[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function parseJson(v: any): any {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}

function mapPartStat(status: string): string {
  const s = String(status || '').toLowerCase();
  if (s === 'accepted') return 'ACCEPTED';
  if (s === 'declined') return 'DECLINED';
  if (s === 'tentative') return 'TENTATIVE';
  if (s === 'delegated') return 'DELEGATED';
  return 'NEEDS-ACTION';
}
