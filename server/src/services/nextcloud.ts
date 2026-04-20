import { pool } from '../database/connection';
import { logger } from '../utils/logger';

interface NextCloudConfig {
  url: string;
  username: string;
  password: string;
}

export class NextCloudService {
  private config: NextCloudConfig;

  constructor(config: NextCloudConfig) {
    this.config = config;
  }

  private getAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
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
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'nextcloud', $12, $13)
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
      
      for (const cal of calendars) {
        // Upsert calendar
        const calResult = await pool.query(
          `INSERT INTO calendars (user_id, name, color, source, caldav_url, external_id)
           VALUES ($1, $2, $3, 'nextcloud', $4, $5)
           ON CONFLICT (user_id, external_id) WHERE source = 'nextcloud' DO UPDATE SET
             name = $2, color = $3, caldav_url = $4, updated_at = NOW()
           RETURNING id`,
          [userId, cal.name, cal.color || '#0078D4', cal.href, cal.href]
        );

        const calendarId = calResult.rows[0].id;
        
        // Sync events (last 6 months to next 6 months)
        const start = new Date();
        start.setMonth(start.getMonth() - 6);
        const end = new Date();
        end.setMonth(end.getMonth() + 6);

        const events = await this.getEvents(cal.href, start, end);
        
        for (const event of events) {
          await pool.query(
            `INSERT INTO calendar_events (calendar_id, title, description, location, start_date, end_date, all_day, attendees, ical_uid, ical_data, external_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (calendar_id, ical_uid) WHERE external_id IS NOT NULL DO UPDATE SET
               title = $2, description = $3, location = $4, start_date = $5, end_date = $6,
               all_day = $7, attendees = $8, ical_data = $10, updated_at = NOW()`,
            [calendarId, event.title, event.description, event.location, event.startDate, event.endDate,
             event.allDay, JSON.stringify(event.attendees || []), event.uid, event.icalData, event.uid]
          );
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
    const regex = /<cal:calendar-data>([\s\S]*?)<\/cal:calendar-data>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const icalData = match[1].trim();
      const event = this.parseICalEvent(icalData);
      if (event) {
        events.push({ ...event, icalData });
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
}
