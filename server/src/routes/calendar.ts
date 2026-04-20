import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { z } from 'zod';

export const calendarRouter = Router();

const eventSchema = z.object({
  calendarId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  allDay: z.boolean().default(false),
  recurrenceRule: z.string().optional(),
  reminderMinutes: z.number().optional(),
  attendees: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    status: z.string().default('pending'),
  })).optional(),
  status: z.string().default('confirmed'),
});

// List calendars
calendarRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT c.* FROM calendars c WHERE c.user_id = $1
       UNION
       SELECT c.* FROM calendars c
       JOIN shared_calendar_access sca ON sca.calendar_id = c.id
       WHERE sca.user_id = $1
       ORDER BY is_default DESC, name ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create calendar
calendarRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const { name, color } = req.body;
    const result = await pool.query(
      'INSERT INTO calendars (user_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, name, color || '#0078D4']
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update calendar
calendarRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { name, color, isVisible } = req.body;
    const result = await pool.query(
      `UPDATE calendars SET name = COALESCE($1, name), color = COALESCE($2, color), 
       is_visible = COALESCE($3, is_visible), updated_at = NOW()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [name, color, isVisible, req.params.id, req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calendrier non trouvé' });
    }
    
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete calendar
calendarRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM calendars WHERE id = $1 AND user_id = $2 AND is_default = false RETURNING id',
      [req.params.id, req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Impossible de supprimer le calendrier par défaut' });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Share calendar
calendarRouter.post('/:id/share', async (req: AuthRequest, res) => {
  try {
    const { userId, permission } = req.body;
    
    // Verify ownership
    const check = await pool.query('SELECT id FROM calendars WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });

    await pool.query(
      `INSERT INTO shared_calendar_access (calendar_id, user_id, permission)
       VALUES ($1, $2, $3) ON CONFLICT (calendar_id, user_id) DO UPDATE SET permission = $3`,
      [req.params.id, userId, permission || 'read']
    );

    await pool.query('UPDATE calendars SET is_shared = true WHERE id = $1', [req.params.id]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Events ----

// Get events for a date range
calendarRouter.get('/events', async (req: AuthRequest, res) => {
  try {
    const start = req.query.start as string;
    const end = req.query.end as string;
    const calendarIds = req.query.calendarIds as string;

    let query = `
      SELECT ce.*, c.name as calendar_name, c.color as calendar_color
      FROM calendar_events ce
      JOIN calendars c ON c.id = ce.calendar_id
      WHERE (c.user_id = $1 OR c.id IN (
        SELECT calendar_id FROM shared_calendar_access WHERE user_id = $1
      ))
      AND c.is_visible = true`;
    
    const params: any[] = [req.userId];
    let paramIdx = 2;

    if (start) {
      query += ` AND ce.end_date >= $${paramIdx}`;
      params.push(start);
      paramIdx++;
    }

    if (end) {
      query += ` AND ce.start_date <= $${paramIdx}`;
      params.push(end);
      paramIdx++;
    }

    if (calendarIds) {
      const ids = calendarIds.split(',');
      query += ` AND ce.calendar_id = ANY($${paramIdx}::uuid[])`;
      params.push(ids);
      paramIdx++;
    }

    query += ' ORDER BY ce.start_date ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create event
calendarRouter.post('/events', async (req: AuthRequest, res) => {
  try {
    const data = eventSchema.parse(req.body);

    // Verify calendar access
    const check = await pool.query(
      `SELECT id FROM calendars WHERE id = $1 AND (user_id = $2 OR id IN (
        SELECT calendar_id FROM shared_calendar_access WHERE user_id = $2 AND permission = 'write'
      ))`,
      [data.calendarId, req.userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });

    const result = await pool.query(
      `INSERT INTO calendar_events (calendar_id, title, description, location, start_date, end_date, all_day, recurrence_rule, reminder_minutes, attendees, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [data.calendarId, data.title, data.description, data.location, data.startDate, data.endDate, data.allDay, data.recurrenceRule, data.reminderMinutes, JSON.stringify(data.attendees || []), data.status]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update event
calendarRouter.put('/events/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const result = await pool.query(
      `UPDATE calendar_events SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        location = COALESCE($3, location),
        start_date = COALESCE($4, start_date),
        end_date = COALESCE($5, end_date),
        all_day = COALESCE($6, all_day),
        recurrence_rule = COALESCE($7, recurrence_rule),
        reminder_minutes = COALESCE($8, reminder_minutes),
        attendees = COALESCE($9, attendees),
        status = COALESCE($10, status),
        updated_at = NOW()
       WHERE id = $11 AND calendar_id IN (
        SELECT c.id FROM calendars c
        LEFT JOIN shared_calendar_access sca ON sca.calendar_id = c.id
        WHERE c.user_id = $12 OR (sca.user_id = $12 AND sca.permission = 'write')
       )
       RETURNING *`,
      [data.title, data.description, data.location, data.startDate, data.endDate, data.allDay, data.recurrenceRule, data.reminderMinutes, data.attendees ? JSON.stringify(data.attendees) : null, data.status, id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete event
calendarRouter.delete('/events/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM calendar_events WHERE id = $1 AND calendar_id IN (
        SELECT c.id FROM calendars c
        LEFT JOIN shared_calendar_access sca ON sca.calendar_id = c.id
        WHERE c.user_id = $2 OR (sca.user_id = $2 AND sca.permission = 'write')
      ) RETURNING id`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
