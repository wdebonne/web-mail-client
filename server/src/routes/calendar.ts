import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { z } from 'zod';
import { CalDAVService } from '../services/caldav';
import { getUserClient } from '../services/nextcloudHelper';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { buildIcs } from '../utils/ical';
import crypto from 'crypto';

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
  rdates: z.array(z.string()).optional(),
  reminderMinutes: z.number().int().optional().nullable(),
  attendees: z.array(z.object({
    email: z.string().email(),
    name: z.string().optional(),
    role: z.enum(['CHAIR', 'REQ-PARTICIPANT', 'OPT-PARTICIPANT', 'NON-PARTICIPANT']).optional(),
    status: z.string().default('pending'),
    rsvp: z.boolean().optional(),
    comment: z.string().optional(),
  })).optional(),
  organizer: z.object({ email: z.string().email(), name: z.string().optional() }).optional(),
  status: z.string().default('confirmed'),
  priority: z.number().int().min(0).max(9).optional().nullable(),
  url: z.string().url().optional().or(z.literal('')).transform((v) => v || undefined),
  categories: z.array(z.string()).optional(),
  transparency: z.enum(['OPAQUE', 'TRANSPARENT']).optional(),
  attachments: z.array(z.object({
    name: z.string(),
    mime: z.string().optional(),
    size: z.number().optional(),
    data: z.string().optional(), // base64 (for small attachments)
    url: z.string().optional(),
  })).optional(),
});

// Nextcloud status for the current user (is the user linked to a NC account?)
calendarRouter.get('/nextcloud-status', async (req: AuthRequest, res) => {
  try {
    const { getNextCloudConfig } = await import('../services/nextcloudHelper');
    const cfg = await getNextCloudConfig(false);
    if (!cfg?.enabled) return res.json({ enabled: false, linked: false });
    const r = await pool.query(
      `SELECT nc_username, nc_email, is_active FROM nextcloud_users WHERE user_id = $1`,
      [req.userId]
    );
    if (r.rows.length === 0 || !r.rows[0].is_active) {
      return res.json({ enabled: true, linked: false });
    }
    res.json({
      enabled: true,
      linked: true,
      ncUsername: r.rows[0].nc_username,
      ncEmail: r.rows[0].nc_email,
      autoCreateCalendars: !!cfg.autoCreateCalendars,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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
    const { name, color, mailAccountId, createOnCaldav } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name requis' });
    }
    const resolvedColor = color || '#0078D4';

    // Case 1: plain local calendar (optionally mirrored on NextCloud)
    if (!mailAccountId) {
      // Try NextCloud auto-creation when configured for this user
      let ncUrl: string | null = null;
      let ncManaged = false;
      try {
        const { getNextCloudConfig, getUserClient } = await import('../services/nextcloudHelper');
        const cfg = await getNextCloudConfig(false);
        if (cfg?.enabled && cfg.autoCreateCalendars) {
          const nc = await getUserClient(req.userId!);
          if (nc) {
            ncUrl = await nc.createCalendar(name, resolvedColor);
            ncManaged = true;
          }
        }
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'NC calendar creation failed, falling back to local-only');
      }

      const result = await pool.query(
        `INSERT INTO calendars (user_id, name, color, caldav_url, nc_managed, nc_principal_url)
         VALUES ($1, $2, $3, $4, $5, $4)
         RETURNING *`,
        [req.userId, name, resolvedColor, ncUrl, ncManaged]
      );
      return res.status(201).json(result.rows[0]);
    }

    // Case 2: calendar attached to a mail account (optionally created on CalDAV)
    const mailAcc = await pool.query(
      `SELECT ma.id, ma.caldav_url, ma.caldav_username, ma.caldav_sync_enabled, ma.username, ma.password_encrypted
         FROM mail_accounts ma
        WHERE ma.id = $1
          AND (ma.user_id = $2
               OR EXISTS (SELECT 1 FROM mailbox_assignments mba WHERE mba.mail_account_id = ma.id AND mba.user_id = $2))`,
      [mailAccountId, req.userId]
    );
    if (mailAcc.rows.length === 0) {
      return res.status(404).json({ error: 'Boîte mail introuvable ou inaccessible' });
    }
    const acc = mailAcc.rows[0];

    let caldavUrl: string | null = null;
    let externalId: string | null = null;
    let source: 'local' | 'caldav' = 'local';

    if (createOnCaldav) {
      if (!acc.caldav_url) {
        return res.status(400).json({ error: 'Cette boîte mail n\'a pas d\'URL CalDAV configurée.' });
      }
      try {
        const password = decrypt(acc.password_encrypted);
        const svc = new CalDAVService({
          baseUrl: acc.caldav_url,
          username: acc.caldav_username || acc.username,
          password,
        });
        const mk = await svc.createRemoteCalendar(name, resolvedColor);
        if (!mk.ok) {
          // If the server gave us a user-friendly, actionable message
          // (e.g. the cPanel/o2switch detection), surface it as-is. Otherwise
          // wrap the raw server payload with a generic prefix.
          const raw = mk.error || '';
          const looksFriendly = /\b(créez|créer|cpanel|interface|par URL|ne permet pas)\b/i.test(raw)
            && !/^<\?xml|<d:error|<D:error/i.test(raw.trim());
          return res.status(502).json({
            error: looksFriendly
              ? raw
              : `Création CalDAV échouée (${mk.status}) : ${raw || 'erreur inconnue'}`,
            serverSupportsCreation: !looksFriendly,
          });
        }
        caldavUrl = mk.href!;
        externalId = mk.href!;
        source = 'caldav';
      } catch (e: any) {
        logger.error(e, 'MKCALENDAR failed');
        return res.status(500).json({ error: e?.message || 'Erreur CalDAV' });
      }
    }

    const result = await pool.query(
      `INSERT INTO calendars (user_id, name, color, mail_account_id, source, caldav_url, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.userId, name, resolvedColor, mailAccountId, source, caldavUrl, externalId]
    );
    return res.status(201).json(result.rows[0]);
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
    // Read calendar info first (to trigger NC deletion if managed)
    const cal = await pool.query(
      `SELECT id, nc_managed, caldav_url, is_default FROM calendars WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (cal.rows.length === 0) {
      return res.status(404).json({ error: 'Calendrier non trouvé' });
    }
    if (cal.rows[0].is_default) {
      return res.status(400).json({ error: 'Impossible de supprimer le calendrier par défaut' });
    }

    // Best-effort NC deletion
    if (cal.rows[0].nc_managed && cal.rows[0].caldav_url) {
      try {
        const { getUserClient } = await import('../services/nextcloudHelper');
        const nc = await getUserClient(req.userId!);
        if (nc) await nc.deleteCalendar(cal.rows[0].caldav_url);
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'NC calendar deletion failed');
      }
    }

    await pool.query('DELETE FROM calendars WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Share calendar (internal NC user + local mirror)
calendarRouter.post('/:id/share', async (req: AuthRequest, res) => {
  try {
    const { userId, email, permission } = req.body || {};
    const perm = permission === 'write' || permission === 'read-write' ? 'read-write' : 'read';

    // Verify ownership + read NC info
    const check = await pool.query(
      `SELECT id, nc_managed, caldav_url FROM calendars WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });
    const cal = check.rows[0];

    let nextcloudShareId: string | null = null;

    // Resolve target user
    let targetUserId: string | null = userId || null;
    let targetEmail: string | null = email || null;
    if (!targetUserId && targetEmail) {
      const r = await pool.query(`SELECT id FROM users WHERE email = $1`, [targetEmail]);
      if (r.rows.length) targetUserId = r.rows[0].id;
    }
    if (targetUserId && !targetEmail) {
      const r = await pool.query(`SELECT email FROM users WHERE id = $1`, [targetUserId]);
      if (r.rows.length) targetEmail = r.rows[0].email;
    }

    // Propagate to NextCloud when calendar is NC-managed
    if (cal.nc_managed && cal.caldav_url) {
      try {
        const { getUserClient } = await import('../services/nextcloudHelper');
        const nc = await getUserClient(req.userId!);
        if (nc) {
          // Prefer internal principal if target user is also provisioned on NC
          let invitee = targetEmail ? `mailto:${targetEmail}` : null;
          if (targetUserId) {
            const r = await pool.query(`SELECT nc_username FROM nextcloud_users WHERE user_id = $1`, [targetUserId]);
            if (r.rows.length) invitee = `principal:principals/users/${r.rows[0].nc_username}`;
          }
          if (invitee) {
            await nc.shareCalendar(cal.caldav_url, invitee, perm);
            nextcloudShareId = invitee;
          }
        }
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'NC share failed (keeping local share)');
      }
    }

    if (targetUserId) {
      await pool.query(
        `INSERT INTO shared_calendar_access (calendar_id, user_id, permission, nextcloud_share_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (calendar_id, user_id)
         DO UPDATE SET permission = $3, nextcloud_share_id = $4`,
        [req.params.id, targetUserId, perm === 'read-write' ? 'write' : 'read', nextcloudShareId]
      );
    } else if (targetEmail) {
      // External: record in external_calendar_shares
      await pool.query(
        `INSERT INTO external_calendar_shares (calendar_id, share_type, recipient_email, permission, nextcloud_share_id, created_by)
         VALUES ($1, 'email', $2, $3, $4, $5)`,
        [req.params.id, targetEmail, perm === 'read-write' ? 'write' : 'read', nextcloudShareId, req.userId]
      );
    } else {
      return res.status(400).json({ error: 'userId ou email requis' });
    }

    await pool.query('UPDATE calendars SET is_shared = true WHERE id = $1', [req.params.id]);
    res.json({ success: true, nextcloudShareId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Revoke share
calendarRouter.delete('/:id/share', async (req: AuthRequest, res) => {
  try {
    const { userId, email } = req.body || req.query;
    const cal = await pool.query(
      `SELECT nc_managed, caldav_url FROM calendars WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (cal.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });

    let invitee: string | null = null;
    if (userId) {
      const r = await pool.query(
        `SELECT sca.nextcloud_share_id FROM shared_calendar_access sca WHERE sca.calendar_id = $1 AND sca.user_id = $2`,
        [req.params.id, userId]
      );
      invitee = r.rows[0]?.nextcloud_share_id || null;
    } else if (email) {
      const r = await pool.query(
        `SELECT nextcloud_share_id FROM external_calendar_shares WHERE calendar_id = $1 AND recipient_email = $2`,
        [req.params.id, email]
      );
      invitee = r.rows[0]?.nextcloud_share_id || `mailto:${email}`;
    }

    if (cal.rows[0].nc_managed && cal.rows[0].caldav_url && invitee) {
      try {
        const { getUserClient } = await import('../services/nextcloudHelper');
        const nc = await getUserClient(req.userId!);
        if (nc) await nc.unshareCalendar(cal.rows[0].caldav_url, invitee);
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'NC unshare failed');
      }
    }

    if (userId) await pool.query(`DELETE FROM shared_calendar_access WHERE calendar_id = $1 AND user_id = $2`, [req.params.id, userId]);
    if (email) await pool.query(`DELETE FROM external_calendar_shares WHERE calendar_id = $1 AND recipient_email = $2`, [req.params.id, email]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Publish calendar (public read-only link)
calendarRouter.post('/:id/publish', async (req: AuthRequest, res) => {
  try {
    const cal = await pool.query(
      `SELECT nc_managed, caldav_url FROM calendars WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (cal.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });
    if (!cal.rows[0].nc_managed || !cal.rows[0].caldav_url) {
      return res.status(400).json({ error: 'Publication disponible uniquement pour les calendriers NextCloud' });
    }
    const { getUserClient } = await import('../services/nextcloudHelper');
    const nc = await getUserClient(req.userId!);
    if (!nc) return res.status(400).json({ error: 'Compte NextCloud non lié' });
    const publicUrl = await nc.publishCalendar(cal.rows[0].caldav_url);
    if (!publicUrl) return res.status(500).json({ error: 'URL publique introuvable' });

    const token = publicUrl.split('/').filter(Boolean).pop() || crypto.randomBytes(16).toString('hex');
    await pool.query(
      `INSERT INTO external_calendar_shares (calendar_id, share_type, public_token, public_url, permission, created_by)
       VALUES ($1, 'public_link', $2, $3, 'read', $4)
       ON CONFLICT DO NOTHING`,
      [req.params.id, token, publicUrl, req.userId]
    );
    res.json({ success: true, publicUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Unpublish
calendarRouter.delete('/:id/publish', async (req: AuthRequest, res) => {
  try {
    const cal = await pool.query(
      `SELECT nc_managed, caldav_url FROM calendars WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (cal.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });
    if (cal.rows[0].nc_managed && cal.rows[0].caldav_url) {
      const { getUserClient } = await import('../services/nextcloudHelper');
      const nc = await getUserClient(req.userId!);
      if (nc) await nc.unpublishCalendar(cal.rows[0].caldav_url);
    }
    await pool.query(
      `DELETE FROM external_calendar_shares WHERE calendar_id = $1 AND share_type = 'public_link'`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List active shares on a calendar
calendarRouter.get('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const check = await pool.query(
      `SELECT 1 FROM calendars WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Calendrier non trouvé' });
    const internal = await pool.query(
      `SELECT sca.user_id, u.email, u.display_name, sca.permission, sca.nextcloud_share_id, sca.created_at
         FROM shared_calendar_access sca
         JOIN users u ON u.id = sca.user_id
        WHERE sca.calendar_id = $1`,
      [req.params.id]
    );
    const external = await pool.query(
      `SELECT id, share_type, recipient_email, public_url, public_token, permission, expires_at, created_at
         FROM external_calendar_shares WHERE calendar_id = $1`,
      [req.params.id]
    );
    res.json({ internal: internal.rows, external: external.rows });
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

    const icalUid = `${crypto.randomUUID()}@webmail.local`;
    const result = await pool.query(
      `INSERT INTO calendar_events
         (calendar_id, title, description, location, start_date, end_date, all_day,
          recurrence_rule, reminder_minutes, attendees, organizer, status, ical_uid,
          priority, url, categories, transparency, attachments, rdates)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        data.calendarId, data.title, data.description, data.location,
        data.startDate, data.endDate, data.allDay,
        data.recurrenceRule, data.reminderMinutes ?? null,
        JSON.stringify(data.attendees || []),
        data.organizer ? JSON.stringify(data.organizer) : null,
        data.status, icalUid,
        data.priority ?? null,
        data.url || null,
        JSON.stringify(data.categories || []),
        data.transparency || null,
        JSON.stringify(data.attachments || []),
        JSON.stringify(data.rdates || []),
      ]
    );

    // Fire-and-forget: push to remote CalDAV if the calendar is linked to a mail account
    pushEventToCalDAV(result.rows[0].id).catch(err => logger.error(err, 'CalDAV push (create) failed'));

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
        organizer = COALESCE($10, organizer),
        status = COALESCE($11, status),
        priority = COALESCE($12, priority),
        url = COALESCE($13, url),
        categories = COALESCE($14, categories),
        transparency = COALESCE($15, transparency),
        attachments = COALESCE($16, attachments),
        rdates = COALESCE($17, rdates),
        ical_data = NULL,
        updated_at = NOW()
       WHERE id = $18 AND calendar_id IN (
        SELECT c.id FROM calendars c
        LEFT JOIN shared_calendar_access sca ON sca.calendar_id = c.id
        WHERE c.user_id = $19 OR (sca.user_id = $19 AND sca.permission = 'write')
       )
       RETURNING *`,
      [
        data.title, data.description, data.location,
        data.startDate, data.endDate, data.allDay,
        data.recurrenceRule, data.reminderMinutes,
        data.attendees ? JSON.stringify(data.attendees) : null,
        data.organizer ? JSON.stringify(data.organizer) : null,
        data.status,
        data.priority ?? null,
        data.url ?? null,
        data.categories ? JSON.stringify(data.categories) : null,
        data.transparency ?? null,
        data.attachments ? JSON.stringify(data.attachments) : null,
        data.rdates ? JSON.stringify(data.rdates) : null,
        id, req.userId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Événement non trouvé' });
    }

    pushEventToCalDAV(result.rows[0].id).catch(err => logger.error(err, 'CalDAV push (update) failed'));

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete event
calendarRouter.delete('/events/:id', async (req: AuthRequest, res) => {
  try {
    // Grab ical_uid + calendar link info BEFORE deleting so we can also delete remotely.
    const snapshot = await pool.query(
      `SELECT ce.id, ce.ical_uid, ce.nc_uri, ce.nc_etag,
              c.caldav_url, c.mail_account_id, c.nc_managed, c.user_id AS owner_id
       FROM calendar_events ce
       JOIN calendars c ON c.id = ce.calendar_id
       WHERE ce.id = $1 AND (c.user_id = $2 OR c.id IN (
         SELECT calendar_id FROM shared_calendar_access WHERE user_id = $2 AND permission = 'write'
       ))`,
      [req.params.id, req.userId]
    );

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

    const snap = snapshot.rows[0];
    if (snap?.nc_managed && snap?.nc_uri) {
      (async () => {
        try {
          const { getUserClient } = await import('../services/nextcloudHelper');
          const nc = await getUserClient(snap.owner_id);
          if (nc) await nc.deleteEvent(snap.nc_uri, snap.nc_etag || undefined);
        } catch (e) { logger.error(e as Error, 'NC event delete failed'); }
      })();
    } else if (snap?.caldav_url && snap?.mail_account_id && snap?.ical_uid) {
      deleteEventFromCalDAV(snap.mail_account_id, snap.caldav_url, snap.ical_uid)
        .catch(err => logger.error(err, 'CalDAV push (delete) failed'));
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CalDAV push helpers (fire-and-forget) ----

async function buildCalDAVServiceForAccount(mailAccountId: string): Promise<{ service: CalDAVService; calendarUrlFallback?: string } | null> {
  const acc = await pool.query(
    'SELECT caldav_url, caldav_username, username, password_encrypted FROM mail_accounts WHERE id = $1',
    [mailAccountId]
  );
  if (acc.rows.length === 0 || !acc.rows[0].caldav_url) return null;
  const row = acc.rows[0];
  try {
    const password = decrypt(row.password_encrypted);
    const service = new CalDAVService({
      baseUrl: row.caldav_url,
      username: row.caldav_username || row.username,
      password,
    });
    return { service, calendarUrlFallback: row.caldav_url };
  } catch {
    return null;
  }
}

/** Build a minimal ICS for one event row and PUT it to remote CalDAV. */
async function pushEventToCalDAV(eventId: string): Promise<void> {
  const row = await pool.query(
    `SELECT ce.id, ce.title, ce.description, ce.location, ce.start_date, ce.end_date,
            ce.all_day, ce.recurrence_rule, ce.rdates, ce.ical_uid, ce.ical_data, ce.status,
            ce.attendees, ce.organizer, ce.priority, ce.url, ce.categories,
            ce.transparency, ce.attachments, ce.reminder_minutes, ce.nc_etag, ce.nc_uri,
            c.id AS calendar_id, c.name AS calendar_name, c.caldav_url, c.mail_account_id,
            c.nc_managed, c.user_id AS owner_id
     FROM calendar_events ce
     JOIN calendars c ON c.id = ce.calendar_id
     WHERE ce.id = $1`,
    [eventId]
  );
  if (row.rows.length === 0) return;
  const ev = row.rows[0];
  if (!ev.caldav_url || !ev.ical_uid) return;

  const ics = buildIcs(ev.calendar_name || 'Calendar', [ev]);

  // NextCloud-managed calendar → push via NC (sends iMIP invitations automatically)
  if (ev.nc_managed) {
    try {
      const { getUserClient } = await import('../services/nextcloudHelper');
      const nc = await getUserClient(ev.owner_id);
      if (nc) {
        const r = await nc.putEvent(ev.caldav_url, ev.ical_uid, ics, ev.nc_etag || undefined);
        await pool.query(
          `UPDATE calendar_events SET nc_etag = $1, nc_uri = $2 WHERE id = $3`,
          [r.etag, r.href, ev.id]
        );
      }
    } catch (e: any) {
      logger.error(e, 'NextCloud event push failed');
    }
    return;
  }

  // Fallback: legacy CalDAV account-based push
  if (!ev.mail_account_id) return;
  const built = await buildCalDAVServiceForAccount(ev.mail_account_id);
  if (!built) return;
  const result = await built.service.putEvent(ev.caldav_url, ev.ical_uid, ics);
  if (!result.ok) {
    logger.error(new Error(`PUT ${result.url} -> ${result.status}: ${result.error || ''}`), 'CalDAV push failed');
  }
}

async function deleteEventFromCalDAV(mailAccountId: string, calendarUrl: string, icalUid: string): Promise<void> {
  const built = await buildCalDAVServiceForAccount(mailAccountId);
  if (!built) return;
  await built.service.deleteEvent(calendarUrl, icalUid);
}

// ---- CalDAV sync linked to mail accounts ----

const caldavConfigSchema = z.object({
  caldavUrl: z.string().url().nullable().optional(),
  caldavUsername: z.string().nullable().optional(),
  caldavSyncEnabled: z.boolean().optional(),
});

/** Resolve a mail account the user can sync (owned or assigned). */
async function getAccessibleMailAccount(accountId: string, userId: string) {
  const result = await pool.query(
    `SELECT ma.* FROM mail_accounts ma
     WHERE ma.id = $1 AND (
       ma.user_id = $2
       OR EXISTS (SELECT 1 FROM mailbox_assignments mba WHERE mba.mail_account_id = ma.id AND mba.user_id = $2)
     )
     LIMIT 1`,
    [accountId, userId]
  );
  return result.rows[0] || null;
}

// List mail accounts with their CalDAV status, for the sync dialog
calendarRouter.get('/accounts', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT ma.id, ma.name, ma.email, ma.color, ma.username, ma.imap_host,
              ma.caldav_url, ma.caldav_username, ma.caldav_sync_enabled, ma.caldav_last_sync,
              (SELECT COUNT(*) FROM calendars c WHERE c.mail_account_id = ma.id) AS calendar_count
       FROM mail_accounts ma
       WHERE ma.user_id = $1
          OR EXISTS (SELECT 1 FROM mailbox_assignments mba WHERE mba.mail_account_id = ma.id AND mba.user_id = $1)
       ORDER BY ma.is_default DESC, ma.name ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update CalDAV config for a mail account
calendarRouter.put('/accounts/:accountId/caldav', async (req: AuthRequest, res) => {
  try {
    const account = await getAccessibleMailAccount(req.params.accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const data = caldavConfigSchema.parse(req.body);

    const result = await pool.query(
      `UPDATE mail_accounts SET
         caldav_url = COALESCE($1, caldav_url),
         caldav_username = COALESCE($2, caldav_username),
         caldav_sync_enabled = COALESCE($3, caldav_sync_enabled),
         updated_at = NOW()
       WHERE id = $4
       RETURNING id, caldav_url, caldav_username, caldav_sync_enabled, caldav_last_sync`,
      [data.caldavUrl ?? null, data.caldavUsername ?? null, data.caldavSyncEnabled ?? null, req.params.accountId]
    );

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

// Test CalDAV connectivity for a mail account (without saving)
calendarRouter.post('/accounts/:accountId/caldav/test', async (req: AuthRequest, res) => {
  try {
    const account = await getAccessibleMailAccount(req.params.accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const url: string | undefined = req.body?.caldavUrl || account.caldav_url;
    const username: string = req.body?.caldavUsername || account.caldav_username || account.username;
    if (!url) return res.status(400).json({ error: 'URL CalDAV manquante' });

    let password: string;
    try { password = decrypt(account.password_encrypted); }
    catch { return res.status(500).json({ error: 'Impossible de déchiffrer le mot de passe du compte' }); }

    const svc = new CalDAVService({ baseUrl: url, username, password });
    const test = await svc.testConnection();
    if (!test.ok) return res.status(400).json({ ok: false, status: test.status, error: test.error || 'Connexion CalDAV refusée' });

    // Also list calendars so user sees something was found
    try {
      const calendars = await svc.getCalendars();
      return res.json({ ok: true, calendars: calendars.map(c => ({ name: c.name, color: c.color })) });
    } catch (e: any) {
      return res.json({ ok: true, calendars: [], warning: e?.message });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger a CalDAV sync for a mail account
calendarRouter.post('/accounts/:accountId/sync', async (req: AuthRequest, res) => {
  try {
    const account = await getAccessibleMailAccount(req.params.accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });
    if (!account.caldav_url) return res.status(400).json({ error: 'CalDAV non configuré pour ce compte' });

    const username: string = account.caldav_username || account.username;
    let password: string;
    try { password = decrypt(account.password_encrypted); }
    catch { return res.status(500).json({ error: 'Impossible de déchiffrer le mot de passe du compte' }); }

    const svc = new CalDAVService({ baseUrl: account.caldav_url, username, password });
    const result = await svc.syncForMailAccount(req.userId!, account.id, account.color || undefined);

    logger.info(`CalDAV synced for account ${account.email}: ${result.calendars} calendars, ${result.events} events`);
    res.json({ ok: true, ...result });
  } catch (error: any) {
    logger.error(error, `CalDAV sync failed for account ${req.params.accountId}`);
    res.status(500).json({ error: error?.message || 'Erreur de synchronisation CalDAV', code: error?.code });
  }
});

// Sync all mail accounts with CalDAV enabled + NextCloud (if linked)
calendarRouter.post('/sync', async (req: AuthRequest, res) => {
  try {
    const accounts = await pool.query(
      `SELECT ma.* FROM mail_accounts ma
       WHERE (ma.user_id = $1
              OR EXISTS (SELECT 1 FROM mailbox_assignments mba WHERE mba.mail_account_id = ma.id AND mba.user_id = $1))
         AND ma.caldav_sync_enabled = true
         AND ma.caldav_url IS NOT NULL`,
      [req.userId]
    );

    const results: any[] = [];
    for (const account of accounts.rows) {
      try {
        const username: string = account.caldav_username || account.username;
        const password = decrypt(account.password_encrypted);
        const svc = new CalDAVService({ baseUrl: account.caldav_url, username, password });
        const r = await svc.syncForMailAccount(req.userId!, account.id, account.color || undefined);
        results.push({ accountId: account.id, email: account.email, ok: true, ...r });
      } catch (e: any) {
        results.push({ accountId: account.id, email: account.email, ok: false, error: e?.message });
      }
    }

    // NextCloud sync (calendars + contacts) if the user is provisioned
    let nextcloud: { ok: boolean; error?: string } | null = null;
    try {
      const nc = await getUserClient(req.userId!);
      if (nc) {
        await nc.syncCalendars(req.userId!);
        try { await nc.syncContacts(req.userId!); } catch { /* contacts optional */ }
        await pool.query(
          `UPDATE nextcloud_users SET last_sync_at = NOW(), last_sync_error = NULL WHERE user_id = $1`,
          [req.userId]
        );
        nextcloud = { ok: true };
      }
    } catch (e: any) {
      await pool.query(
        `UPDATE nextcloud_users SET last_sync_error = $1 WHERE user_id = $2`,
        [(e?.message || 'unknown').slice(0, 500), req.userId]
      ).catch(() => {});
      logger.warn({ err: e?.message, userId: req.userId }, 'NextCloud on-demand sync failed');
      nextcloud = { ok: false, error: e?.message || 'NextCloud sync failed' };
    }

    const syncedCount = results.filter(r => r.ok).length + (nextcloud?.ok ? 1 : 0);
    res.json({ ok: true, synced: syncedCount, results, nextcloud });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
