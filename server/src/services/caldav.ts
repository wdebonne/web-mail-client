import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export interface CalDAVConfig {
  baseUrl: string;   // full principal URL, e.g. https://host/remote.php/dav/calendars/user/
  username: string;
  password: string;
}

export interface ParsedCalendar {
  href: string;      // absolute or path relative to host
  name: string;
  color?: string;
}

export interface ParsedEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startDate: Date | null;
  endDate: Date | null;
  allDay: boolean;
  attendees?: any[];
  icalData: string;
}

/**
 * Generic CalDAV client. Works with any CalDAV-compliant server
 * (NextCloud, SOGo, Baïkal, Radicale, iCloud, Fastmail…).
 * The user provides the "calendars home" URL for their principal.
 */
export class CalDAVService {
  private config: CalDAVConfig;
  private origin: string;

  constructor(config: CalDAVConfig) {
    this.config = { ...config, baseUrl: config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/' };
    try {
      const u = new URL(this.config.baseUrl);
      this.origin = `${u.protocol}//${u.host}`;
    } catch {
      this.origin = '';
    }
  }

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
  }

  private absolute(href: string): string {
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith('/')) return this.origin + href;
    return this.config.baseUrl + href;
  }

  async testConnection(): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const res = await fetch(this.config.baseUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.authHeader(),
          Depth: '0',
          'Content-Type': 'application/xml',
        },
        body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
      });
      return { ok: res.ok, status: res.status };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'CalDAV error' };
    }
  }

  async getCalendars(): Promise<ParsedCalendar[]> {
    const res = await fetch(this.config.baseUrl, {
      method: 'PROPFIND',
      headers: {
        Authorization: this.authHeader(),
        Depth: '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:apple="http://apple.com/ns/ical/">
          <d:prop>
            <d:displayname />
            <d:resourcetype />
            <apple:calendar-color />
            <cs:getctag />
          </d:prop>
        </d:propfind>`,
    });
    if (!res.ok) {
      throw new Error(`CalDAV PROPFIND failed: ${res.status}`);
    }
    const xml = await res.text();
    return this.parseCalendars(xml);
  }

  async getEvents(calendarHref: string, start: Date, end: Date): Promise<ParsedEvent[]> {
    const url = this.absolute(calendarHref);
    const res = await fetch(url, {
      method: 'REPORT',
      headers: {
        Authorization: this.authHeader(),
        Depth: '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <cal:calendar-query xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
          <d:prop>
            <d:getetag />
            <cal:calendar-data />
          </d:prop>
          <cal:filter>
            <cal:comp-filter name="VCALENDAR">
              <cal:comp-filter name="VEVENT">
                <cal:time-range start="${this.formatDate(start)}" end="${this.formatDate(end)}" />
              </cal:comp-filter>
            </cal:comp-filter>
          </cal:filter>
        </cal:calendar-query>`,
    });
    if (!res.ok) {
      throw new Error(`CalDAV REPORT failed: ${res.status}`);
    }
    const xml = await res.text();
    return this.parseEvents(xml);
  }

  /** Sync all CalDAV calendars + their events for a mail account. */
  async syncForMailAccount(userId: string, mailAccountId: string, accountColor?: string): Promise<{ calendars: number; events: number }> {
    const calendars = await this.getCalendars();
    let eventCount = 0;

    // 6 months window (past 1 month -> next 6 months) — pragmatic
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    const end = new Date();
    end.setMonth(end.getMonth() + 6);

    // Find user's local default calendar to promote (link) it to the mail account's default remote calendar.
    const defaultLocal = await pool.query(
      `SELECT id FROM calendars
       WHERE user_id = $1 AND is_default = true
         AND (source = 'local' OR source IS NULL)
         AND (mail_account_id IS NULL OR mail_account_id = $2)
       ORDER BY created_at ASC LIMIT 1`,
      [userId, mailAccountId]
    );
    const localDefaultId: string | null = defaultLocal.rows[0]?.id || null;

    // Pick the "default" remote calendar: first one returned, OR one named /calendar|default/i
    const preferred =
      calendars.find(c => /^(calendar|default|agenda)$/i.test(c.name)) ||
      calendars[0];

    for (const cal of calendars) {
      let calendarId: string;

      if (localDefaultId && cal === preferred) {
        // Promote local default → linked CalDAV calendar (events will sync back/forth)
        const upd = await pool.query(
          `UPDATE calendars
             SET mail_account_id = $1,
                 source = 'caldav',
                 caldav_url = $2,
                 external_id = $3,
                 color = COALESCE(color, $4),
                 updated_at = NOW()
           WHERE id = $5
           RETURNING id`,
          [mailAccountId, cal.href, cal.href, cal.color || accountColor || '#0078D4', localDefaultId]
        );
        calendarId = upd.rows[0].id;
      } else {
        const calResult = await pool.query(
          `INSERT INTO calendars (user_id, mail_account_id, name, color, source, caldav_url, external_id)
           VALUES ($1, $2, $3, $4, 'caldav', $5, $6)
           ON CONFLICT (mail_account_id, external_id) WHERE mail_account_id IS NOT NULL AND external_id IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, caldav_url = EXCLUDED.caldav_url, updated_at = NOW()
           RETURNING id`,
          [userId, mailAccountId, cal.name, cal.color || accountColor || '#0078D4', cal.href, cal.href]
        );
        calendarId = calResult.rows[0].id;
      }

      let events: ParsedEvent[] = [];
      try {
        events = await this.getEvents(cal.href, start, end);
      } catch (e) {
        logger.error(e as Error, `CalDAV getEvents failed for ${cal.href}`);
        continue;
      }

      for (const ev of events) {
        if (!ev.startDate || !ev.endDate) continue;
        await pool.query(
          `INSERT INTO calendar_events (calendar_id, title, description, location, start_date, end_date, all_day, attendees, ical_uid, ical_data, external_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (calendar_id, ical_uid) WHERE external_id IS NOT NULL DO UPDATE SET
             title = EXCLUDED.title, description = EXCLUDED.description, location = EXCLUDED.location,
             start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
             all_day = EXCLUDED.all_day, attendees = EXCLUDED.attendees,
             ical_data = EXCLUDED.ical_data, updated_at = NOW()`,
          [calendarId, ev.title, ev.description, ev.location, ev.startDate, ev.endDate, ev.allDay,
           JSON.stringify(ev.attendees || []), ev.uid, ev.icalData, ev.uid]
        );
        eventCount++;
      }
    }

    await pool.query('UPDATE mail_accounts SET caldav_last_sync = NOW() WHERE id = $1', [mailAccountId]);

    return { calendars: calendars.length, events: eventCount };
  }

  /** PUT a single VEVENT as its own resource inside a CalDAV collection. */
  async putEvent(calendarHref: string, icalUid: string, icsBody: string): Promise<{ ok: boolean; status: number; url: string; error?: string }> {
    const baseUrl = this.absolute(calendarHref);
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const safeUid = encodeURIComponent(icalUid);
    const url = `${base}${safeUid}.ics`;
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'text/calendar; charset=utf-8',
        },
        body: icsBody,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, status: res.status, url, error: text.slice(0, 300) };
      }
      return { ok: true, status: res.status, url };
    } catch (e: any) {
      return { ok: false, status: 0, url, error: e?.message || 'network error' };
    }
  }

  /** DELETE a single VEVENT resource. */
  async deleteEvent(calendarHref: string, icalUid: string): Promise<{ ok: boolean; status: number }> {
    const baseUrl = this.absolute(calendarHref);
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const url = `${base}${encodeURIComponent(icalUid)}.ics`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: this.authHeader() },
      });
      // 404 means already gone - treat as OK
      return { ok: res.ok || res.status === 404, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  // ----- Parsing -----

  private parseCalendars(xml: string): ParsedCalendar[] {
    const out: ParsedCalendar[] = [];
    const regex = /<[a-z0-9]*:?response[\s>][\s\S]*?<\/[a-z0-9]*:?response>/gi;
    let m;
    while ((m = regex.exec(xml)) !== null) {
      const block = m[0];
      const href = this.extractTag(block, 'href');
      const name = this.extractTag(block, 'displayname');
      const color = this.extractTag(block, 'calendar-color');
      const isCalendar = /<[a-z0-9]*:?calendar\s*\/?>/i.test(block);
      if (href && name && isCalendar) {
        out.push({ href, name, color: color ? color.substring(0, 7) : undefined });
      }
    }
    return out;
  }

  private parseEvents(xml: string): ParsedEvent[] {
    const out: ParsedEvent[] = [];
    const regex = /<[a-z0-9]*:?calendar-data[^>]*>([\s\S]*?)<\/[a-z0-9]*:?calendar-data>/gi;
    let m;
    while ((m = regex.exec(xml)) !== null) {
      const icalData = this.decodeEntities(m[1].trim());
      const ev = this.parseICalEvent(icalData);
      if (ev) out.push({ ...ev, icalData });
    }
    return out;
  }

  private parseICalEvent(ical: string): ParsedEvent | null {
    const lines = this.unfold(ical).split(/\r?\n/);
    let inEvent = false;
    let uid = '', title = '', description = '', location = '';
    let dtstartRaw = '', dtendRaw = '';
    let dtstartAllDay = false, dtendAllDay = false;

    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') inEvent = true;
      else if (line === 'END:VEVENT') break;
      else if (!inEvent) continue;

      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const head = line.substring(0, colon);
      const value = line.substring(colon + 1);
      const name = head.split(';')[0].toUpperCase();
      const params = head.substring(name.length);

      switch (name) {
        case 'UID': uid = value; break;
        case 'SUMMARY': title = this.unescape(value); break;
        case 'DESCRIPTION': description = this.unescape(value); break;
        case 'LOCATION': location = this.unescape(value); break;
        case 'DTSTART':
          dtstartRaw = value;
          dtstartAllDay = /VALUE=DATE(?!-TIME)/i.test(params) || value.length === 8;
          break;
        case 'DTEND':
          dtendRaw = value;
          dtendAllDay = /VALUE=DATE(?!-TIME)/i.test(params) || value.length === 8;
          break;
      }
    }

    if (!uid || !title) return null;

    const startDate = dtstartRaw ? this.parseICalDate(dtstartRaw) : null;
    const endDate = dtendRaw ? this.parseICalDate(dtendRaw) : (startDate ? new Date(startDate.getTime() + 3600_000) : null);

    return {
      uid,
      title,
      description,
      location,
      startDate,
      endDate,
      allDay: dtstartAllDay || dtendAllDay,
      icalData: '',
    };
  }

  private parseICalDate(s: string): Date {
    if (/^\d{8}$/.test(s)) {
      return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00Z`);
    }
    // 20240101T120000Z or 20240101T120000
    const y = s.substring(0, 4), mo = s.substring(4, 6), d = s.substring(6, 8);
    const h = s.substring(9, 11) || '00', mi = s.substring(11, 13) || '00', se = s.substring(13, 15) || '00';
    const z = s.endsWith('Z') ? 'Z' : '';
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${z}`);
  }

  private unfold(s: string): string {
    return s.replace(/\r?\n[ \t]/g, '');
  }

  private unescape(s: string): string {
    return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  private formatDate(d: Date): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  private extractTag(xml: string, localName: string): string | undefined {
    const re = new RegExp(`<[a-z0-9]*:?${localName}(?:\\s[^>]*)?>([^<]*)<\\/[a-z0-9]*:?${localName}>`, 'i');
    const m = xml.match(re);
    return m ? m[1].trim() : undefined;
  }

  private decodeEntities(s: string): string {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
}
