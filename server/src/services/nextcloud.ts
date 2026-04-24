import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import crypto from 'crypto';

interface NextCloudConfig {
  url: string;
  username: string;
  password: string;
}

/**
 * Strip trailing slash from a base URL.
 */
function trimUrl(u: string): string {
  return u.replace(/\/+$/, '');
}

export class NextCloudService {
  private config: NextCloudConfig;

  constructor(config: NextCloudConfig) {
    this.config = { ...config, url: trimUrl(config.url) };
  }

  private getAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
  }

  private ocsHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: this.getAuthHeader(),
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
      ...extra,
    };
  }

  private davBase(): string {
    return `${this.config.url}/remote.php/dav`;
  }

  private calendarsBase(): string {
    return `${this.davBase()}/calendars/${encodeURIComponent(this.config.username)}`;
  }

  private addressBooksBase(): string {
    return `${this.davBase()}/addressbooks/users/${encodeURIComponent(this.config.username)}`;
  }

  /** Absolute URL from a server-relative href returned by NextCloud. */
  private absolute(href: string): string {
    if (/^https?:\/\//i.test(href)) return href;
    return `${this.config.url}${href.startsWith('/') ? '' : '/'}${href}`;
  }

  // ---- CardDAV (Contacts) ----

  async getAddressBooks(): Promise<any[]> {
    const url = `${this.config.url}/remote.php/dav/addressbooks/users/${this.config.username}/`;
    
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Depth': '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
          <d:prop>
            <d:displayname />
            <d:resourcetype />
            <cs:getctag />
          </d:prop>
        </d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch address books: ${response.status}`);
    }

    const text = await response.text();
    return this.parseAddressBooks(text);
  }

  async getContacts(addressBookUrl: string): Promise<any[]> {
    const url = `${this.config.url}${addressBookUrl}`;
    
    const response = await fetch(url, {
      method: 'REPORT',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Depth': '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
          <d:prop>
            <d:getetag />
            <card:address-data />
          </d:prop>
        </card:addressbook-query>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch contacts: ${response.status}`);
    }

    const text = await response.text();
    return this.parseContacts(text);
  }

  async syncContacts(userId: string) {
    try {
      const addressBooks = await this.getAddressBooks();
      
      for (const book of addressBooks) {
        const contacts = await this.getContacts(book.href);
        
        for (const contact of contacts) {
          await pool.query(
            `INSERT INTO contacts (user_id, email, first_name, last_name, display_name, phone, mobile, company, job_title, department, avatar_data, source, external_id, vcard)
             VALUES ($1::uuid, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::varchar, $8::varchar, $9::varchar, $10::varchar, $11::text, 'nextcloud', $12::varchar, $13::text)
             ON CONFLICT (user_id, email) WHERE source = 'nextcloud' DO UPDATE SET
               first_name = $3, last_name = $4, display_name = $5, phone = $6, mobile = $7,
               company = $8, job_title = $9, department = $10, avatar_data = $11,
               vcard = $13, updated_at = NOW()`,
            [userId, contact.email, contact.firstName, contact.lastName, contact.displayName,
             contact.phone, contact.mobile, contact.company, contact.jobTitle, contact.department,
             contact.photo, contact.uid, contact.vcard]
          );
        }
      }

      logger.info(`NextCloud contacts synced for user ${userId}`);
    } catch (error) {
      logger.error(error as Error, 'NextCloud contact sync error');
      throw error;
    }
  }

  // ---- CalDAV (Calendars) ----

  async getCalendars(): Promise<any[]> {
    const url = `${this.config.url}/remote.php/dav/calendars/${this.config.username}/`;
    
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Depth': '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:apple="http://apple.com/ns/ical/">
          <d:prop>
            <d:displayname />
            <d:resourcetype />
            <apple:calendar-color />
            <cs:getctag />
            <d:sync-token />
          </d:prop>
        </d:propfind>`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch calendars: ${response.status}`);
    }

    const text = await response.text();
    return this.parseCalendars(text);
  }

  async getEvents(calendarUrl: string, start: Date, end: Date): Promise<any[]> {
    const url = `${this.config.url}${calendarUrl}`;
    
    const response = await fetch(url, {
      method: 'REPORT',
      headers: {
        'Authorization': this.getAuthHeader(),
        'Depth': '1',
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

    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.status}`);
    }

    const text = await response.text();
    return this.parseEvents(text);
  }

  async syncCalendars(userId: string) {
    try {
      const calendars = await this.getCalendars();
      const principal = `${this.config.url}/remote.php/dav/principals/users/${this.config.username}/`;

      for (const cal of calendars) {
        // Deduplicate with any pre-existing calendar row for this user that
        // points to the same CalDAV URL. Without this, a user whose mail
        // account already syncs via CalDAV to the same NextCloud server ends
        // up with two rows (source='caldav' and source='nextcloud') for the
        // same remote calendar, and every event is imported twice.
        const existing = await pool.query(
          `SELECT id, mail_account_id, source
             FROM calendars
            WHERE user_id = $1
              AND (caldav_url = $2 OR external_id = $2)
            ORDER BY (source = 'nextcloud') DESC, created_at ASC`,
          [userId, cal.href]
        );

        let calendarId: string;

        if (existing.rows.length > 0) {
          const keep = existing.rows[0];
          calendarId = keep.id;

          // Promote the kept row to NC-managed, but preserve any mail_account_id
          // link so the companion CalDAV sync keeps targeting the same row.
          await pool.query(
            `UPDATE calendars
                SET name = $1,
                    color = $2,
                    source = 'nextcloud',
                    caldav_url = $3,
                    external_id = $3,
                    nc_managed = TRUE,
                    nc_principal_url = $4,
                    last_sync_at = NOW(),
                    updated_at = NOW()
              WHERE id = $5`,
            [cal.name, cal.color || '#0078D4', cal.href, principal, calendarId]
          );

          // Merge siblings: move their events over (skipping duplicates by ical_uid),
          // then delete the now-empty duplicate calendar rows.
          for (const dup of existing.rows.slice(1)) {
            await pool.query(
              `UPDATE calendar_events ce
                  SET calendar_id = $1
                WHERE ce.calendar_id = $2
                  AND NOT EXISTS (
                    SELECT 1 FROM calendar_events ex
                     WHERE ex.calendar_id = $1
                       AND ex.ical_uid IS NOT NULL
                       AND ex.ical_uid = ce.ical_uid
                  )`,
              [calendarId, dup.id]
            );
            // If the kept row was missing a mail_account_id but the duplicate had one,
            // inherit it so CalDAV sync keeps working against the merged row.
            if (!keep.mail_account_id && dup.mail_account_id) {
              await pool.query(
                `UPDATE calendars SET mail_account_id = $1 WHERE id = $2 AND mail_account_id IS NULL`,
                [dup.mail_account_id, calendarId]
              );
              keep.mail_account_id = dup.mail_account_id;
            }
            await pool.query(`DELETE FROM calendars WHERE id = $1`, [dup.id]);
          }
        } else {
          // Upsert calendar — mark it as NC-managed so pushEventToCalDAV()
          // routes updates through this.putEvent() (with iMIP invitations).
          const calResult = await pool.query(
            `INSERT INTO calendars (user_id, name, color, source, caldav_url, external_id,
                                    nc_managed, nc_principal_url, last_sync_at)
             VALUES ($1, $2, $3, 'nextcloud', $4, $5, TRUE, $6, NOW())
             ON CONFLICT (user_id, external_id) WHERE source = 'nextcloud' DO UPDATE SET
               name = EXCLUDED.name,
               color = EXCLUDED.color,
               caldav_url = EXCLUDED.caldav_url,
               nc_managed = TRUE,
               nc_principal_url = EXCLUDED.nc_principal_url,
               last_sync_at = NOW(),
               updated_at = NOW()
             RETURNING id`,
            [userId, cal.name, cal.color || '#0078D4', cal.href, cal.href, principal]
          );
          calendarId = calResult.rows[0].id;
        }
        
        // Sync events (last 6 months to next 6 months)
        const start = new Date();
        start.setMonth(start.getMonth() - 6);
        const end = new Date();
        end.setMonth(end.getMonth() + 6);

        const events = await this.getEvents(cal.href, start, end);
        
        for (const event of events) {
          await pool.query(
            `INSERT INTO calendar_events
               (calendar_id, title, description, location, start_date, end_date, all_day,
                attendees, ical_uid, ical_data, external_id, nc_uri, nc_etag)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (calendar_id, ical_uid) WHERE external_id IS NOT NULL DO UPDATE SET
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               location = EXCLUDED.location,
               start_date = EXCLUDED.start_date,
               end_date = EXCLUDED.end_date,
               all_day = EXCLUDED.all_day,
               attendees = EXCLUDED.attendees,
               ical_data = EXCLUDED.ical_data,
               nc_uri = COALESCE(EXCLUDED.nc_uri, calendar_events.nc_uri),
               nc_etag = COALESCE(EXCLUDED.nc_etag, calendar_events.nc_etag),
               updated_at = NOW()`,
            [calendarId, event.title, event.description, event.location, event.startDate, event.endDate,
             event.allDay, JSON.stringify(event.attendees || []), event.uid, event.icalData, event.uid,
             event.href || null, event.etag || null]
          );
        }
      }

      // ── Final sweep: collapse any leftover duplicate calendar rows.
      // Rows are grouped by (caldav_url) and (ical_uid)-based dedup is
      // performed when merging events, so this is safe to run repeatedly.
      const groups = await pool.query(
        `SELECT caldav_url, array_agg(id ORDER BY (source = 'nextcloud') DESC, created_at ASC) AS ids
           FROM calendars
          WHERE user_id = $1 AND caldav_url IS NOT NULL
          GROUP BY caldav_url
         HAVING COUNT(*) > 1`,
        [userId]
      );
      for (const grp of groups.rows) {
        const [keepId, ...dupIds] = grp.ids as string[];
        for (const dupId of dupIds) {
          await pool.query(
            `UPDATE calendar_events ce
                SET calendar_id = $1
              WHERE ce.calendar_id = $2
                AND NOT EXISTS (
                  SELECT 1 FROM calendar_events ex
                   WHERE ex.calendar_id = $1
                     AND ex.ical_uid IS NOT NULL
                     AND ex.ical_uid = ce.ical_uid
                )`,
            [keepId, dupId]
          );
          // Inherit a mail_account_id link if the kept row had none.
          await pool.query(
            `UPDATE calendars k
                SET mail_account_id = d.mail_account_id
               FROM calendars d
              WHERE k.id = $1 AND d.id = $2
                AND k.mail_account_id IS NULL
                AND d.mail_account_id IS NOT NULL`,
            [keepId, dupId]
          );
          await pool.query(`DELETE FROM calendars WHERE id = $1`, [dupId]);
        }
      }

      logger.info(`NextCloud calendars synced for user ${userId}`);
    } catch (error) {
      logger.error(error as Error, 'NextCloud calendar sync error');
      throw error;
    }
  }

  // ---- User info / avatar ----

  async getUserAvatar(username: string): Promise<Buffer | null> {
    try {
      const response = await fetch(`${this.config.url}/avatar/${username}/128`, {
        headers: { 'Authorization': this.getAuthHeader() },
      });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer;
      }
    } catch {}
    return null;
  }

  async getUserInfo(username: string): Promise<any> {
    try {
      const response = await fetch(`${this.config.url}/ocs/v2.php/cloud/users/${username}?format=json`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'OCS-APIRequest': 'true',
        },
      });
      if (response.ok) {
        const data: any = await response.json();
        return data?.ocs?.data;
      }
    } catch {}
    return null;
  }

  // ---- Parsing helpers ----

  private parseAddressBooks(xml: string): any[] {
    // Simple XML parsing for address books
    const books: any[] = [];
    const regex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const href = this.extractTag(match[1], 'd:href');
      const name = this.extractTag(match[1], 'd:displayname');
      if (name && href && !href.endsWith('/')) continue;
      if (name) {
        books.push({ href, name });
      }
    }
    return books;
  }

  private parseContacts(xml: string): any[] {
    const contacts: any[] = [];
    const regex = /<card:address-data>([\s\S]*?)<\/card:address-data>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const vcard = match[1].trim();
      const contact = this.parseVCard(vcard);
      if (contact.email || contact.displayName) {
        contacts.push({ ...contact, vcard });
      }
    }
    return contacts;
  }

  private parseVCard(vcard: string): any {
    const get = (field: string) => {
      const match = vcard.match(new RegExp(`${field}[^:]*:(.+)`, 'i'));
      return match ? match[1].trim() : undefined;
    };

    const name = get('N');
    const nameParts = name?.split(';') || [];

    return {
      uid: get('UID'),
      displayName: get('FN'),
      lastName: nameParts[0],
      firstName: nameParts[1],
      email: get('EMAIL'),
      phone: get('TEL'),
      company: get('ORG'),
      jobTitle: get('TITLE'),
      department: get('DEPARTMENT'),
      photo: get('PHOTO'),
    };
  }

  private parseCalendars(xml: string): any[] {
    const calendars: any[] = [];
    const regex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const href = this.extractTag(match[1], 'd:href');
      const name = this.extractTag(match[1], 'd:displayname');
      const color = this.extractTag(match[1], 'apple:calendar-color');
      const isCalendar = match[1].includes('cal:calendar');
      if (name && isCalendar) {
        calendars.push({ href, name, color: color?.substring(0, 7) });
      }
    }
    return calendars;
  }

  private parseEvents(xml: string): any[] {
    const events: any[] = [];
    // Walk each <d:response> block to capture href + etag together with the ICS body.
    const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/g;
    let m: RegExpExecArray | null;
    while ((m = responseRegex.exec(xml)) !== null) {
      const block = m[1];
      const hrefMatch = block.match(/<d:href>([\s\S]*?)<\/d:href>/);
      const etagMatch = block.match(/<d:getetag>([\s\S]*?)<\/d:getetag>/);
      const calMatch = block.match(/<cal:calendar-data[^>]*>([\s\S]*?)<\/cal:calendar-data>/);
      if (!calMatch) continue;
      const icalData = calMatch[1].trim();
      const parsed = this.parseICalEvent(icalData);
      if (parsed) {
        events.push({
          ...parsed,
          icalData,
          href: hrefMatch ? hrefMatch[1].trim() : undefined,
          etag: etagMatch ? etagMatch[1].trim() : undefined,
        });
      }
    }
    return events;
  }

  private parseICalEvent(ical: string): any {
    const get = (field: string) => {
      const match = ical.match(new RegExp(`${field}[^:]*:(.+)`, 'i'));
      return match ? match[1].trim() : undefined;
    };

    const uid = get('UID');
    const title = get('SUMMARY');
    if (!title) return null;

    const dtstart = get('DTSTART');
    const dtend = get('DTEND');

    return {
      uid,
      title,
      description: get('DESCRIPTION'),
      location: get('LOCATION'),
      startDate: dtstart ? this.parseICalDate(dtstart) : null,
      endDate: dtend ? this.parseICalDate(dtend) : null,
      allDay: dtstart?.length === 8,
    };
  }

  private parseICalDate(dateStr: string): Date {
    if (dateStr.length === 8) {
      return new Date(`${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`);
    }
    // Format: 20240101T120000Z
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    const hour = dateStr.substring(9, 11);
    const min = dateStr.substring(11, 13);
    const sec = dateStr.substring(13, 15);
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`);
    const match = xml.match(regex);
    return match ? match[1].trim() : undefined;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Calendar CRUD (MKCALENDAR / PROPPATCH / DELETE)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Create a calendar collection on NextCloud using MKCALENDAR (RFC 4791).
   * Returns the absolute URL of the collection.
   *
   * Behaviour: the slug is derived from `slug` or `displayName`. If a collection
   * already exists at that slug (Sabre returns HTTP 405
   * "MethodNotAllowedOnCollection — The resource you tried to create already
   * exists"), the method *adopts* it instead of creating a new one and
   * returns the existing URL. Callers that need a freshly-created collection
   * should pass a unique `slug`.
   */
  async createCalendar(displayName: string, color: string = '#0078D4', slug?: string): Promise<string> {
    const safeSlug = (slug || this.slugify(displayName)) || `cal-${Date.now()}`;
    const url = `${this.calendarsBase()}/${encodeURIComponent(safeSlug)}/`;
    const nameXml = this.escapeXml(displayName);
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${nameXml}</D:displayname>
      <A:calendar-color>${this.escapeXml(color)}</A:calendar-color>
      <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;
    const res = await fetch(url, {
      method: 'MKCALENDAR',
      headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (res.ok) return url;

    // Adopt an existing collection sharing the same slug (typically the
    // user's default "personal" calendar when migrating a local one named
    // "Mon calendrier" → slug "mon-calendrier" on a server that already has
    // a matching collection).
    const txt = await res.text().catch(() => '');
    if (res.status === 405 && /already\s*exists|MethodNotAllowedOnCollection/i.test(txt)) {
      // Best effort: refresh displayname + color on the adopted collection so
      // the user's chosen labelling is reflected on NextCloud too.
      try { await this.renameCalendar(url, displayName, color); } catch { /* non-fatal */ }
      return url;
    }
    throw new Error(`MKCALENDAR failed (${res.status}): ${txt.slice(0, 300)}`);
  }

  async deleteCalendar(calendarUrl: string): Promise<void> {
    const res = await fetch(this.absolute(calendarUrl), {
      method: 'DELETE',
      headers: { Authorization: this.getAuthHeader() },
    });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => '');
      throw new Error(`DELETE calendar failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  async renameCalendar(calendarUrl: string, newName: string, newColor?: string): Promise<void> {
    const nameXml = this.escapeXml(newName);
    const colorXml = newColor ? `<A:calendar-color>${this.escapeXml(newColor)}</A:calendar-color>` : '';
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:propertyupdate xmlns:D="DAV:" xmlns:A="http://apple.com/ns/ical/">
  <D:set><D:prop><D:displayname>${nameXml}</D:displayname>${colorXml}</D:prop></D:set>
</D:propertyupdate>`;
    const res = await fetch(this.absolute(calendarUrl), {
      method: 'PROPPATCH',
      headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`PROPPATCH failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Event CRUD (PUT/DELETE .ics)
  // Includes ATTENDEE entries so NextCloud sends iMIP invitations.
  // ═══════════════════════════════════════════════════════════════════

  async putEvent(calendarUrl: string, uid: string, icalData: string, etag?: string): Promise<{ etag: string | null; href: string }> {
    const base = this.absolute(calendarUrl).replace(/\/+$/, '/');
    const href = `${base}${encodeURIComponent(uid)}.ics`;
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': 'text/calendar; charset=utf-8',
    };
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(href, { method: 'PUT', headers, body: icalData });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`PUT event failed (${res.status}): ${txt.slice(0, 200)}`);
    }
    return { etag: res.headers.get('etag'), href };
  }

  async deleteEvent(eventUrl: string, etag?: string): Promise<void> {
    const headers: Record<string, string> = { Authorization: this.getAuthHeader() };
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(this.absolute(eventUrl), { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => '');
      throw new Error(`DELETE event failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Contact CRUD (PUT/DELETE .vcf)
  // ═══════════════════════════════════════════════════════════════════

  async putContact(addressBookUrl: string, uid: string, vcard: string, etag?: string): Promise<{ etag: string | null; href: string }> {
    const base = this.absolute(addressBookUrl).replace(/\/+$/, '/');
    const href = `${base}${encodeURIComponent(uid)}.vcf`;
    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      'Content-Type': 'text/vcard; charset=utf-8',
    };
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(href, { method: 'PUT', headers, body: vcard });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`PUT contact failed (${res.status}): ${txt.slice(0, 200)}`);
    }
    return { etag: res.headers.get('etag'), href };
  }

  async deleteContact(contactUrl: string, etag?: string): Promise<void> {
    const headers: Record<string, string> = { Authorization: this.getAuthHeader() };
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(this.absolute(contactUrl), { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => '');
      throw new Error(`DELETE contact failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  /** Get the default address book URL (creates "contacts" default if present). */
  getDefaultAddressBookUrl(): string {
    return `${this.addressBooksBase()}/contacts/`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Calendar sharing (calendarserver-sharing extension)
  // NextCloud / SabreDAV supports the Apple sharing extension via POST.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Share a calendar with an invitee (internal user or external email).
   * `invitee` can be:
   *   - "principal:principals/users/<nc-username>" for an NC user
   *   - "mailto:user@example.com" for an email invitee (NC will send the invite)
   */
  async shareCalendar(
    calendarUrl: string,
    invitee: string,
    permission: 'read' | 'read-write' = 'read-write',
    summary?: string,
  ): Promise<void> {
    const permXml = permission === 'read-write' ? '<CS:read-write/>' : '<CS:read/>';
    const summaryXml = summary ? `<CS:summary>${this.escapeXml(summary)}</CS:summary>` : '';
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<CS:share xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">
  <CS:set>
    <D:href>${this.escapeXml(invitee)}</D:href>
    ${summaryXml}
    ${permXml}
  </CS:set>
</CS:share>`;
    const res = await fetch(this.absolute(calendarUrl), {
      method: 'POST',
      headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Share calendar failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  /** Revoke a calendar share. Pass the same invitee string used in `shareCalendar`. */
  async unshareCalendar(calendarUrl: string, invitee: string): Promise<void> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<CS:share xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">
  <CS:remove>
    <D:href>${this.escapeXml(invitee)}</D:href>
  </CS:remove>
</CS:share>`;
    const res = await fetch(this.absolute(calendarUrl), {
      method: 'POST',
      headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Unshare failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  /**
   * Publish a calendar as a public read-only link.
   * Returns the public URL that guests can subscribe to (webcal).
   */
  async publishCalendar(calendarUrl: string): Promise<string | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<CS:publish-calendar xmlns:CS="http://calendarserver.org/ns/"/>`;
    const res = await fetch(this.absolute(calendarUrl), {
      method: 'POST',
      headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Publish failed (${res.status}): ${txt.slice(0, 200)}`);
    }
    // Retrieve the publish-url property
    const propRes = await fetch(this.absolute(calendarUrl), {
      method: 'PROPFIND',
      headers: {
        Authorization: this.getAuthHeader(),
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/">
  <D:prop><CS:publish-url/></D:prop>
</D:propfind>`,
    });
    if (!propRes.ok) return null;
    const xml = await propRes.text();
    const match = xml.match(/<CS:publish-url[^>]*>\s*<D:href[^>]*>([^<]+)<\/D:href>/i)
      || xml.match(/<publish-url[^>]*>\s*<href[^>]*>([^<]+)<\/href>/i);
    return match ? match[1].trim() : null;
  }

  async unpublishCalendar(calendarUrl: string): Promise<void> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<CS:unpublish-calendar xmlns:CS="http://calendarserver.org/ns/"/>`;
    const res = await fetch(this.absolute(calendarUrl), {
      method: 'POST',
      headers: { Authorization: this.getAuthHeader(), 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Unpublish failed (${res.status}): ${txt.slice(0, 200)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════════

  private escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  private slugify(s: string): string {
    const ascii = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }
}

// ═════════════════════════════════════════════════════════════════════
// NextCloudAdminService — provisioning via OCS (admin credentials).
// ═════════════════════════════════════════════════════════════════════

interface NextCloudAdminConfig {
  url: string;
  adminUsername: string;
  adminPassword: string; // admin app-password or password
}

export interface ProvisionedUser {
  userId: string;
  displayName?: string;
  email?: string;
  initialPassword?: string; // only returned on creation
}

export class NextCloudAdminService {
  private config: NextCloudAdminConfig;

  constructor(config: NextCloudAdminConfig) {
    this.config = { ...config, url: trimUrl(config.url) };
  }

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.config.adminUsername}:${this.config.adminPassword}`).toString('base64');
  }

  private ocsUrl(path: string): string {
    return `${this.config.url}/ocs/v2.php${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async ocsCall(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(this.ocsUrl(path), {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
        ...(init.headers || {}),
      } as any,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    const ocsStatus = data?.ocs?.meta?.statuscode;
    if (!res.ok || (ocsStatus && ocsStatus >= 300)) {
      const msg = data?.ocs?.meta?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`OCS ${path} failed: ${msg}`);
    }
    return data?.ocs?.data ?? data;
  }

  /** Test the admin connection. Returns server version info. */
  async testConnection(): Promise<{ version: string }> {
    const data = await this.ocsCall('/cloud/capabilities?format=json');
    return { version: data?.version?.string || 'unknown' };
  }

  /**
   * Create a NextCloud user via OCS Provisioning API.
   * If `password` is omitted, a random one is generated.
   */
  async createUser(params: {
    userId: string;
    password?: string;
    displayName?: string;
    email?: string;
    groups?: string[];
    quota?: string;
  }): Promise<ProvisionedUser> {
    const password = params.password || this.generatePassword();
    const body = new URLSearchParams();
    body.set('userid', params.userId);
    body.set('password', password);
    if (params.displayName) body.set('displayName', params.displayName);
    if (params.email) body.set('email', params.email);
    if (params.quota) body.set('quota', params.quota);
    for (const g of params.groups || []) body.append('groups[]', g);

    await this.ocsCall('/cloud/users?format=json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    return {
      userId: params.userId,
      displayName: params.displayName,
      email: params.email,
      initialPassword: password,
    };
  }

  async getUser(userId: string): Promise<any | null> {
    try {
      return await this.ocsCall(`/cloud/users/${encodeURIComponent(userId)}?format=json`);
    } catch (e: any) {
      if (/998|not found/i.test(e.message)) return null;
      throw e;
    }
  }

  async userExists(userId: string): Promise<boolean> {
    const u = await this.getUser(userId);
    return !!u;
  }

  async updateUser(userId: string, fields: { displayname?: string; email?: string; password?: string; quota?: string }): Promise<void> {
    const calls: Array<{ key: string; value: string }> = [];
    if (fields.displayname) calls.push({ key: 'displayname', value: fields.displayname });
    if (fields.email) calls.push({ key: 'email', value: fields.email });
    if (fields.password) calls.push({ key: 'password', value: fields.password });
    if (fields.quota) calls.push({ key: 'quota', value: fields.quota });
    for (const { key, value } of calls) {
      const body = new URLSearchParams({ key, value });
      await this.ocsCall(`/cloud/users/${encodeURIComponent(userId)}?format=json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    }
  }

  async disableUser(userId: string): Promise<void> {
    await this.ocsCall(`/cloud/users/${encodeURIComponent(userId)}/disable?format=json`, { method: 'PUT' });
  }

  async enableUser(userId: string): Promise<void> {
    await this.ocsCall(`/cloud/users/${encodeURIComponent(userId)}/enable?format=json`, { method: 'PUT' });
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.ocsCall(`/cloud/users/${encodeURIComponent(userId)}?format=json`, { method: 'DELETE' });
    } catch (e: any) {
      if (/998|not found/i.test(e.message)) return;
      throw e;
    }
  }

  /** Generate a cryptographically secure password. */
  private generatePassword(): string {
    // 24 bytes base64url → ~32 characters, strong entropy
    return crypto.randomBytes(24).toString('base64url');
  }
}

