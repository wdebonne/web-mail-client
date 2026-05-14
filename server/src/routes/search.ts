import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';

export const searchRouter = Router();

// Global search across emails, contacts, events
searchRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const type = req.query.type as string; // 'all' | 'mail' | 'contacts' | 'events'
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Advanced mail filters
    const folder = req.query.folder as string;
    const accountId = req.query.accountId as string;
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;
    const fromFilter = req.query.from as string;
    const hasAttachment = req.query.hasAttachment as string;
    const isRead = req.query.isRead as string;

    if (!query || query.length < 2) {
      return res.json({ emails: [], contacts: [], events: [], totals: { emails: 0, contacts: 0, events: 0 } });
    }

    const results: any = { totals: { emails: 0, contacts: 0, events: 0 } };

    if (!type || type === 'all' || type === 'mail') {
      const conditions: string[] = [
        `ma.user_id = $1`,
        `(ce.subject ILIKE $2 OR ce.from_name ILIKE $2 OR ce.from_address ILIKE $2 OR ce.body_text ILIKE $2)`,
      ];
      const params: any[] = [req.userId, `%${query}%`];
      let idx = 3;

      if (folder) {
        conditions.push(`ce.folder = $${idx++}`);
        params.push(folder);
      }
      if (accountId) {
        conditions.push(`ce.account_id = $${idx++}`);
        params.push(accountId);
      }
      if (dateFrom) {
        conditions.push(`ce.date >= $${idx++}`);
        params.push(new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        conditions.push(`ce.date <= $${idx++}`);
        params.push(endDate.toISOString());
      }
      if (fromFilter) {
        conditions.push(`(ce.from_name ILIKE $${idx} OR ce.from_address ILIKE $${idx})`);
        params.push(`%${fromFilter}%`);
        idx++;
      }
      if (hasAttachment === 'true') {
        conditions.push(`ce.has_attachments = true`);
      } else if (hasAttachment === 'false') {
        conditions.push(`ce.has_attachments = false`);
      }
      if (isRead === 'true') {
        conditions.push(`ce.is_read = true`);
      } else if (isRead === 'false') {
        conditions.push(`ce.is_read = false`);
      }

      const where = conditions.join(' AND ');

      const countRes = await pool.query(
        `SELECT COUNT(*) FROM cached_emails ce JOIN mail_accounts ma ON ma.id = ce.account_id WHERE ${where}`,
        params,
      );
      results.totals.emails = parseInt(countRes.rows[0].count) || 0;

      const emails = await pool.query(
        `SELECT ce.id, ce.uid, ce.subject, ce.from_name, ce.from_address, ce.snippet, ce.date,
                ce.folder, ce.is_read, ce.is_flagged, ce.has_attachments, ce.account_id
         FROM cached_emails ce
         JOIN mail_accounts ma ON ma.id = ce.account_id
         WHERE ${where}
         ORDER BY ce.date DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      );
      results.emails = emails.rows;
    }

    if (!type || type === 'all' || type === 'contacts') {
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM contacts WHERE user_id = $1 AND (
           email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR
           display_name ILIKE $2 OR company ILIKE $2
         )`,
        [req.userId, `%${query}%`],
      );
      results.totals.contacts = parseInt(countRes.rows[0].count) || 0;

      const contacts = await pool.query(
        `SELECT id, email, first_name, last_name, display_name, company, avatar_url
         FROM contacts WHERE user_id = $1 AND (
           email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR
           display_name ILIKE $2 OR company ILIKE $2
         )
         ORDER BY display_name ASC
         LIMIT $3 OFFSET $4`,
        [req.userId, `%${query}%`, limit, offset],
      );
      results.contacts = contacts.rows;
    }

    if (!type || type === 'all' || type === 'events') {
      const calendarIdFilter = req.query.calendarId as string;
      const calConditions: string[] = [`c.user_id = $1`, `(ce.title ILIKE $2 OR ce.description ILIKE $2 OR ce.location ILIKE $2)`];
      const calParams: any[] = [req.userId, `%${query}%`];
      let calIdx = 3;

      if (calendarIdFilter) {
        calConditions.push(`c.id = $${calIdx++}`);
        calParams.push(calendarIdFilter);
      }
      if (dateFrom) {
        calConditions.push(`ce.start_date >= $${calIdx++}`);
        calParams.push(new Date(dateFrom).toISOString());
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        calConditions.push(`ce.start_date <= $${calIdx++}`);
        calParams.push(endDate.toISOString());
      }

      const calWhere = calConditions.join(' AND ');

      const calCountRes = await pool.query(
        `SELECT COUNT(*) FROM calendar_events ce JOIN calendars c ON c.id = ce.calendar_id WHERE ${calWhere}`,
        calParams,
      );
      results.totals.events = parseInt(calCountRes.rows[0].count) || 0;

      const events = await pool.query(
        `SELECT ce.id, ce.title, ce.description, ce.start_date, ce.end_date, ce.location,
                c.name as calendar_name, c.color as calendar_color
         FROM calendar_events ce
         JOIN calendars c ON c.id = ce.calendar_id
         WHERE ${calWhere}
         ORDER BY ce.start_date DESC
         LIMIT $${calIdx} OFFSET $${calIdx + 1}`,
        [...calParams, limit, offset],
      );
      results.events = events.rows;
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
