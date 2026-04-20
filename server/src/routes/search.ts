import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';

export const searchRouter = Router();

// Global search across emails, contacts, events
searchRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    const type = req.query.type as string; // 'all' | 'mail' | 'contacts' | 'events'
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    if (!query || query.length < 2) {
      return res.json({ emails: [], contacts: [], events: [] });
    }

    const results: any = {};

    if (!type || type === 'all' || type === 'mail') {
      const emails = await pool.query(
        `SELECT ce.id, ce.subject, ce.from_name, ce.from_address, ce.snippet, ce.date, ce.folder, ce.is_read, ce.account_id
         FROM cached_emails ce
         JOIN mail_accounts ma ON ma.id = ce.account_id
         WHERE ma.user_id = $1 AND (
           ce.subject ILIKE $2 OR
           ce.from_name ILIKE $2 OR
           ce.from_address ILIKE $2 OR
           ce.body_text ILIKE $2
         )
         ORDER BY ce.date DESC
         LIMIT $3`,
        [req.userId, `%${query}%`, limit]
      );
      results.emails = emails.rows;
    }

    if (!type || type === 'all' || type === 'contacts') {
      const contacts = await pool.query(
        `SELECT id, email, first_name, last_name, display_name, company, avatar_url
         FROM contacts WHERE user_id = $1 AND (
           email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2 OR
           display_name ILIKE $2 OR company ILIKE $2
         )
         ORDER BY display_name ASC
         LIMIT $3`,
        [req.userId, `%${query}%`, limit]
      );
      results.contacts = contacts.rows;
    }

    if (!type || type === 'all' || type === 'events') {
      const events = await pool.query(
        `SELECT ce.id, ce.title, ce.description, ce.start_date, ce.end_date, ce.location, c.name as calendar_name, c.color as calendar_color
         FROM calendar_events ce
         JOIN calendars c ON c.id = ce.calendar_id
         WHERE c.user_id = $1 AND (
           ce.title ILIKE $2 OR ce.description ILIKE $2 OR ce.location ILIKE $2
         )
         ORDER BY ce.start_date DESC
         LIMIT $3`,
        [req.userId, `%${query}%`, limit]
      );
      results.events = events.rows;
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
