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
  ical_uid?: string | null;
  ical_data?: string | null;
  status?: string | null;
  attendees?: any;
  organizer?: any;
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
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
