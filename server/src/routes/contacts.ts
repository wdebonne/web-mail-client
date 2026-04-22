import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { z } from 'zod';

export const contactRouter = Router();

const contactSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  avatarUrl: z.string().optional(),
  notes: z.string().optional(),
  isFavorite: z.boolean().optional(),
  groupIds: z.array(z.string().uuid()).optional(),
});

// List contacts
contactRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const search = req.query.search as string;
    const groupId = req.query.groupId as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const source = req.query.source as string;

    let query = `SELECT c.*, 
                   ARRAY_AGG(DISTINCT cg.name) FILTER (WHERE cg.name IS NOT NULL) as group_names
                 FROM contacts c 
                 LEFT JOIN contact_group_members cgm ON cgm.contact_id = c.id
                 LEFT JOIN contact_groups cg ON cg.id = cgm.group_id
                 WHERE c.user_id = $1`;
    const params: any[] = [req.userId];
    let paramIdx = 2;

    if (source) {
      query += ` AND c.source = $${paramIdx}`;
      params.push(source);
      paramIdx++;
    } else {
      // By default, exclude sender contacts (shown separately)
      // Only if no explicit source filter — exclude 'sender' from main list
      // We keep sender contacts available via source='sender' filter
      // But if source is explicitly not provided and no groupId filter, include all
    }

    if (search) {
      query += ` AND (
        c.email ILIKE $${paramIdx} OR 
        c.first_name ILIKE $${paramIdx} OR 
        c.last_name ILIKE $${paramIdx} OR 
        c.display_name ILIKE $${paramIdx} OR
        c.company ILIKE $${paramIdx} OR
        CONCAT(c.first_name, ' ', c.last_name) ILIKE $${paramIdx}
      )`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (groupId) {
      query += ` AND cgm.group_id = $${paramIdx}`;
      params.push(groupId);
      paramIdx++;
    }

    query += ` GROUP BY c.id ORDER BY c.is_favorite DESC, c.last_name ASC, c.first_name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(DISTINCT c.id) FROM contacts c LEFT JOIN contact_group_members cgm ON cgm.contact_id = c.id WHERE c.user_id = $1';
    const countParams: any[] = [req.userId];
    
    if (search) {
      countQuery += ` AND (c.email ILIKE $2 OR c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.display_name ILIKE $2)`;
      countParams.push(`%${search}%`);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      contacts: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single contact
contactRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, 
         ARRAY_AGG(DISTINCT jsonb_build_object('id', cg.id, 'name', cg.name)) FILTER (WHERE cg.id IS NOT NULL) as groups
       FROM contacts c
       LEFT JOIN contact_group_members cgm ON cgm.contact_id = c.id
       LEFT JOIN contact_groups cg ON cg.id = cgm.group_id
       WHERE c.id = $1 AND c.user_id = $2
       GROUP BY c.id`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact non trouvé' });
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create contact
contactRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const data = contactSchema.parse(req.body);
    
    const displayName = data.displayName || [data.firstName, data.lastName].filter(Boolean).join(' ') || data.email;

    const result = await pool.query(
      `INSERT INTO contacts (user_id, email, first_name, last_name, display_name, phone, mobile, company, job_title, department, avatar_url, notes, is_favorite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [req.userId, data.email, data.firstName, data.lastName, displayName, data.phone, data.mobile, data.company, data.jobTitle, data.department, data.avatarUrl, data.notes, data.isFavorite || false]
    );

    // Add to groups
    if (data.groupIds?.length) {
      for (const groupId of data.groupIds) {
        await pool.query(
          'INSERT INTO contact_group_members (contact_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [result.rows[0].id, groupId]
        );
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update contact
contactRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const check = await pool.query('SELECT id FROM contacts WHERE id = $1 AND user_id = $2', [id, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Contact non trouvé' });

    const result = await pool.query(
      `UPDATE contacts SET
        email = COALESCE($1, email),
        first_name = COALESCE($2, first_name),
        last_name = COALESCE($3, last_name),
        display_name = COALESCE($4, display_name),
        phone = COALESCE($5, phone),
        mobile = COALESCE($6, mobile),
        company = COALESCE($7, company),
        job_title = COALESCE($8, job_title),
        department = COALESCE($9, department),
        avatar_url = COALESCE($10, avatar_url),
        notes = COALESCE($11, notes),
        is_favorite = COALESCE($12, is_favorite),
        updated_at = NOW()
       WHERE id = $13 AND user_id = $14
       RETURNING *`,
      [data.email, data.firstName, data.lastName, data.displayName, data.phone, data.mobile, data.company, data.jobTitle, data.department, data.avatarUrl, data.notes, data.isFavorite, id, req.userId]
    );

    // Update groups
    if (data.groupIds) {
      await pool.query('DELETE FROM contact_group_members WHERE contact_id = $1', [id]);
      for (const groupId of data.groupIds) {
        await pool.query(
          'INSERT INTO contact_group_members (contact_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, groupId]
        );
      }
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete contact
contactRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact non trouvé' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Record a sender (upsert with source='sender')
contactRouter.post('/senders/record', async (req: AuthRequest, res) => {
  try {
    const { email, name } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email requis' });
    }

    // Don't record if already a permanent contact
    const existing = await pool.query(
      `SELECT id, source FROM contacts WHERE user_id = $1 AND email = $2 LIMIT 1`,
      [req.userId, email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      // Already exists (permanent or sender), just update name if sender
      if (existing.rows[0].source === 'sender' && name) {
        await pool.query(
          `UPDATE contacts SET display_name = COALESCE(display_name, $1), updated_at = NOW() WHERE id = $2`,
          [name, existing.rows[0].id]
        );
      }
      return res.json({ created: false, id: existing.rows[0].id });
    }

    const displayName = name || email;
    const result = await pool.query(
      `INSERT INTO contacts (user_id, email, display_name, source, is_favorite)
       VALUES ($1, $2, $3, 'sender', false)
       RETURNING id`,
      [req.userId, email.toLowerCase(), displayName]
    );
    res.status(201).json({ created: true, id: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Promote a sender to permanent contact
contactRouter.post('/:id/promote', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE contacts SET source = 'local', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND source = 'sender'
       RETURNING *`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact non trouvé ou déjà enregistré' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Search contacts (autocomplete for email compose)
contactRouter.get('/search/autocomplete', async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT id, email, first_name, last_name, display_name, avatar_url, company, job_title
       FROM contacts 
       WHERE user_id = $1 AND (
         email ILIKE $2 OR 
         first_name ILIKE $2 OR 
         last_name ILIKE $2 OR 
         display_name ILIKE $2 OR
         CONCAT(first_name, ' ', last_name) ILIKE $2
       )
       ORDER BY is_favorite DESC, display_name ASC
       LIMIT 10`,
      [req.userId, `%${query}%`]
    );

    // Also search distribution lists
    const lists = await pool.query(
      `SELECT id, name, description, members FROM distribution_lists
       WHERE user_id = $1 AND name ILIKE $2
       LIMIT 5`,
      [req.userId, `%${query}%`]
    );

    res.json({
      contacts: result.rows,
      distributionLists: lists.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Bulk Import ----
contactRouter.post('/import', async (req: AuthRequest, res) => {
  try {
    const items = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const mode = (req.body?.mode as 'merge' | 'skip' | 'replace') || 'merge';

    if (!items.length) {
      return res.status(400).json({ error: 'Aucun contact à importer' });
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const raw of items) {
      try {
        const email: string | undefined = raw.email ? String(raw.email).toLowerCase().trim() : undefined;
        const firstName = raw.firstName || raw.first_name || null;
        const lastName = raw.lastName || raw.last_name || null;
        const displayName = raw.displayName || raw.display_name
          || [firstName, lastName].filter(Boolean).join(' ')
          || email
          || null;

        if (!email && !displayName) { skipped++; continue; }

        const metadata: Record<string, any> = { ...(raw.metadata || {}) };
        if (raw.website) metadata.website = raw.website;
        if (raw.birthday) metadata.birthday = raw.birthday;
        if (raw.address) metadata.address = raw.address;

        // Dedup by email
        let existing = null;
        if (email) {
          const r = await pool.query(
            `SELECT id, source FROM contacts WHERE user_id = $1 AND LOWER(email) = $2 LIMIT 1`,
            [req.userId, email]
          );
          existing = r.rows[0] || null;
        }

        if (existing) {
          if (mode === 'skip') { skipped++; continue; }
          // merge or replace: update fields, promote sender -> local
          await pool.query(
            `UPDATE contacts SET
               first_name = COALESCE($1, first_name),
               last_name = COALESCE($2, last_name),
               display_name = COALESCE($3, display_name),
               phone = COALESCE($4, phone),
               mobile = COALESCE($5, mobile),
               company = COALESCE($6, company),
               job_title = COALESCE($7, job_title),
               department = COALESCE($8, department),
               avatar_url = COALESCE($9, avatar_url),
               notes = COALESCE($10, notes),
               metadata = COALESCE(metadata, '{}'::jsonb) || $11::jsonb,
               source = CASE WHEN source = 'sender' THEN 'local' ELSE source END,
               updated_at = NOW()
             WHERE id = $12`,
            [
              firstName, lastName, displayName,
              raw.phone || null, raw.mobile || null,
              raw.company || null, raw.jobTitle || raw.job_title || null, raw.department || null,
              raw.avatarUrl || raw.avatar_url || null,
              raw.notes || null,
              JSON.stringify(metadata),
              existing.id,
            ]
          );
          updated++;
        } else {
          await pool.query(
            `INSERT INTO contacts (
               user_id, email, first_name, last_name, display_name,
               phone, mobile, company, job_title, department,
               avatar_url, notes, metadata, source, is_favorite
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'local',false)`,
            [
              req.userId, email || null, firstName, lastName, displayName,
              raw.phone || null, raw.mobile || null,
              raw.company || null, raw.jobTitle || raw.job_title || null, raw.department || null,
              raw.avatarUrl || raw.avatar_url || null,
              raw.notes || null,
              JSON.stringify(metadata),
            ]
          );
          imported++;
        }
      } catch (e: any) {
        errors.push(e.message || 'erreur inconnue');
      }
    }

    res.json({ imported, updated, skipped, errors, total: items.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Contact Groups ----
contactRouter.get('/groups/list', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT cg.*, COUNT(cgm.contact_id) as member_count
       FROM contact_groups cg
       LEFT JOIN contact_group_members cgm ON cgm.group_id = cg.id
       WHERE cg.user_id = $1
       GROUP BY cg.id
       ORDER BY cg.name ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contactRouter.post('/groups', async (req: AuthRequest, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query(
      'INSERT INTO contact_groups (user_id, name) VALUES ($1, $2) RETURNING *',
      [req.userId, name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contactRouter.delete('/groups/:id', async (req: AuthRequest, res) => {
  try {
    await pool.query('DELETE FROM contact_groups WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Distribution Lists ----
contactRouter.get('/distribution-lists', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM distribution_lists WHERE user_id = $1 ORDER BY name ASC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contactRouter.post('/distribution-lists', async (req: AuthRequest, res) => {
  try {
    const { name, description, members } = req.body;
    const result = await pool.query(
      'INSERT INTO distribution_lists (user_id, name, description, members) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, name, description, JSON.stringify(members || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contactRouter.put('/distribution-lists/:id', async (req: AuthRequest, res) => {
  try {
    const { name, description, members } = req.body;
    const result = await pool.query(
      `UPDATE distribution_lists SET name = $1, description = $2, members = $3, updated_at = NOW()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [name, description, JSON.stringify(members), req.params.id, req.userId]
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contactRouter.delete('/distribution-lists/:id', async (req: AuthRequest, res) => {
  try {
    await pool.query('DELETE FROM distribution_lists WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
