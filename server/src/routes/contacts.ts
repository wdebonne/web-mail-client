import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { z } from 'zod';
import crypto from 'crypto';
import { CardDAVService } from '../services/carddav';
import { buildVCard } from '../utils/vcard';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

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

    if (source === 'nextcloud') {
      query += ` AND (c.nc_managed = true OR c.source = 'nextcloud')`;
    } else if (source) {
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

    // Get total count (mirrors same filters as main query)
    let countQuery = 'SELECT COUNT(DISTINCT c.id) FROM contacts c LEFT JOIN contact_group_members cgm ON cgm.contact_id = c.id WHERE c.user_id = $1';
    const countParams: any[] = [req.userId];
    let countParamIdx = 2;

    if (source === 'nextcloud') {
      countQuery += ` AND (c.nc_managed = true OR c.source = 'nextcloud')`;
    } else if (source) {
      countQuery += ` AND c.source = $${countParamIdx}`;
      countParams.push(source);
      countParamIdx++;
    }

    if (search) {
      countQuery += ` AND (c.email ILIKE $${countParamIdx} OR c.first_name ILIKE $${countParamIdx} OR c.last_name ILIKE $${countParamIdx} OR c.display_name ILIKE $${countParamIdx})`;
      countParams.push(`%${search}%`);
      countParamIdx++;
    }

    if (groupId) {
      countQuery += ` AND cgm.group_id = $${countParamIdx}`;
      countParams.push(groupId);
      countParamIdx++;
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

    // Allocate a stable UID used both as DB external id and as CardDAV item name.
    const uid = crypto.randomUUID();

    // Pick a CardDAV-enabled mail account (default one first) to anchor this contact.
    const davAccount = await findCardDAVAccount(req.userId!);

    // If no CardDAV mail account, try NextCloud default address book
    let ncAddressBookUrl: string | null = null;
    let ncManaged = false;
    if (!davAccount) {
      try {
        const { getUserClient, getNextCloudConfig } = await import('../services/nextcloudHelper');
        const cfg = await getNextCloudConfig(false);
        if (cfg?.enabled) {
          const nc = await getUserClient(req.userId!);
          if (nc) {
            ncAddressBookUrl = nc.getDefaultAddressBookUrl();
            ncManaged = true;
          }
        }
      } catch { /* best-effort */ }
    }

    const result = await pool.query(
      `INSERT INTO contacts (
         user_id, email, first_name, last_name, display_name, phone, mobile, company,
         job_title, department, avatar_url, notes, is_favorite,
         external_id, mail_account_id, carddav_url, nc_managed, nc_addressbook_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING *`,
      [
        req.userId, data.email, data.firstName, data.lastName, displayName,
        data.phone, data.mobile, data.company, data.jobTitle, data.department,
        data.avatarUrl, data.notes, data.isFavorite || false,
        uid, davAccount?.id || null, davAccount?.carddav_url || null,
        ncManaged, ncAddressBookUrl,
      ]
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

    // Fire-and-forget CardDAV push
    pushContactToCardDAV(result.rows[0].id).catch(err => logger.error(err, 'CardDAV push (create) failed'));

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
        metadata = CASE WHEN $13::jsonb IS NULL THEN metadata ELSE COALESCE(metadata, '{}'::jsonb) || $13::jsonb END,
        updated_at = NOW()
       WHERE id = $14 AND user_id = $15
       RETURNING *`,
      [data.email, data.firstName, data.lastName, data.displayName, data.phone, data.mobile, data.company, data.jobTitle, data.department, data.avatarUrl, data.notes, data.isFavorite, data.metadata ? JSON.stringify(data.metadata) : null, id, req.userId]
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

    pushContactToCardDAV(id).catch(err => logger.error(err, 'CardDAV push (update) failed'));

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete contact
contactRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    // Capture CardDAV info before deletion so we can also remove it remotely.
    const snap = await pool.query(
      `SELECT id, user_id, mail_account_id, carddav_url, carddav_href, external_id,
              nc_managed, nc_uri, nc_etag
       FROM contacts WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );

    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact non trouvé' });
    }

    const row = snap.rows[0];
    if (row?.nc_managed && row?.nc_uri) {
      (async () => {
        try {
          const { getUserClient } = await import('../services/nextcloudHelper');
          const nc = await getUserClient(row.user_id);
          if (nc) await nc.deleteContact(row.nc_uri, row.nc_etag || undefined);
        } catch (e) { logger.error(e as Error, 'NC contact delete failed'); }
      })();
    } else if (row?.mail_account_id && row?.carddav_url && (row?.carddav_href || row?.external_id)) {
      deleteContactFromCardDAV(row.mail_account_id, row.carddav_url, row.carddav_href || `${row.external_id}.vcf`)
        .catch(err => logger.error(err, 'CardDAV push (delete) failed'));
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

// Organization directory — list other app users for internal sharing.
// Optional `q` parameter filters by email / display_name.
contactRouter.get('/directory/users', async (req: AuthRequest, res) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() || '';
    const params: any[] = [req.userId];
    let where = 'u.id <> $1';
    if (q.length >= 1) {
      params.push(`%${q}%`);
      where += ` AND (u.email ILIKE $2 OR u.display_name ILIKE $2)`;
    }
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, nc.nc_username
         FROM users u
         LEFT JOIN nextcloud_users nc ON nc.user_id = u.id
        WHERE ${where}
        ORDER BY u.display_name NULLS LAST, u.email
        LIMIT 50`,
      params
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Search contacts (autocomplete for email compose)
contactRouter.get('/search/autocomplete', async (req: AuthRequest, res) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 1) {
      return res.json({ contacts: [], distributionLists: [] });
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

    // Also search distribution lists — fallback for pre-migration servers
    let lists;
    try {
      lists = await pool.query(
        `SELECT dl.id, dl.name, dl.description, dl.members FROM distribution_lists dl
         WHERE COALESCE(dl.is_deleted, false) = false AND dl.name ILIKE $2 AND (
           dl.user_id = $1
           OR COALESCE(dl.shared_with, '[]'::jsonb) @> jsonb_build_array(
                jsonb_build_object('type'::text, 'user'::text, 'id'::text, $1::text))
           OR EXISTS (
             SELECT 1 FROM user_groups ug
             WHERE ug.user_id = $1
               AND COALESCE(dl.shared_with, '[]'::jsonb) @> jsonb_build_array(
                     jsonb_build_object('type'::text, 'group'::text, 'id'::text, ug.group_id::text))
           )
         )
         LIMIT 5`,
        [req.userId, `%${query}%`]
      );
    } catch {
      lists = await pool.query(
        `SELECT id, name, description, members FROM distribution_lists
         WHERE user_id = $1 AND name ILIKE $2 LIMIT 5`,
        [req.userId, `%${query}%`]
      );
    }

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

// Auto-add unknown emails from a member list to the user's contacts
async function autoAddMemberContacts(userId: string, members: { email: string; name?: string }[]) {
  for (const m of members) {
    if (!m.email) continue;
    const existing = await pool.query(
      'SELECT id FROM contacts WHERE user_id = $1 AND LOWER(email) = $2 LIMIT 1',
      [userId, m.email.toLowerCase()]
    );
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO contacts (user_id, email, display_name, source, is_favorite)
         VALUES ($1, $2, $3, 'local', false)
         ON CONFLICT DO NOTHING`,
        [userId, m.email.toLowerCase(), m.name || m.email]
      );
    }
  }
}

contactRouter.get('/distribution-lists', async (req: AuthRequest, res) => {
  try {
    // Full query: requires is_deleted + shared_with columns (added by migration)
    const result = await pool.query(
      `SELECT dl.*, u.email as owner_email, u.display_name as owner_name
       FROM distribution_lists dl
       LEFT JOIN users u ON u.id = dl.user_id
       WHERE COALESCE(dl.is_deleted, false) = false AND (
         dl.user_id = $1
         OR COALESCE(dl.shared_with, '[]'::jsonb) @> jsonb_build_array(
              jsonb_build_object('type'::text, 'user'::text, 'id'::text, $1::text))
         OR EXISTS (
           SELECT 1 FROM user_groups ug
           WHERE ug.user_id = $1
             AND COALESCE(dl.shared_with, '[]'::jsonb) @> jsonb_build_array(
                   jsonb_build_object('type'::text, 'group'::text, 'id'::text, ug.group_id::text))
         )
       )
       ORDER BY dl.name ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch {
    // Fallback: migration columns not yet present (server not restarted after deploy)
    try {
      const fallback = await pool.query(
        `SELECT dl.*, u.email as owner_email, u.display_name as owner_name
         FROM distribution_lists dl
         LEFT JOIN users u ON u.id = dl.user_id
         WHERE dl.user_id = $1
         ORDER BY dl.name ASC`,
        [req.userId]
      );
      res.json(fallback.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
});

contactRouter.post('/distribution-lists', async (req: AuthRequest, res) => {
  try {
    const { name, description, members } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Le nom est requis' });
    const memberList: { email: string; name?: string }[] = Array.isArray(members) ? members : [];
    // Try with new columns first, fallback to base insert
    let result;
    try {
      result = await pool.query(
        `INSERT INTO distribution_lists (user_id, created_by, name, description, members)
         VALUES ($1, $1, $2, $3, $4) RETURNING *`,
        [req.userId, name.trim(), description || null, JSON.stringify(memberList)]
      );
    } catch {
      result = await pool.query(
        `INSERT INTO distribution_lists (user_id, name, description, members)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.userId, name.trim(), description || null, JSON.stringify(memberList)]
      );
    }
    autoAddMemberContacts(req.userId!, memberList).catch(() => {});
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

contactRouter.put('/distribution-lists/:id', async (req: AuthRequest, res) => {
  try {
    const { name, description, members, sharedWith } = req.body;
    // Allow update if owner OR if list is shared with user (but only owner can change sharedWith)
    const check = await pool.query(
      `SELECT id, user_id FROM distribution_lists
       WHERE id = $1 AND is_deleted = false AND (
         user_id = $2
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(shared_with) sw
           WHERE sw->>'type' = 'user' AND sw->>'id' = $2
         )
       )`,
      [req.params.id, req.userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Liste introuvable' });
    const isOwner = check.rows[0].user_id === req.userId;
    const memberList: { email: string; name?: string }[] = Array.isArray(members) ? members : [];

    const result = await pool.query(
      `UPDATE distribution_lists SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         members = COALESCE($3::jsonb, members),
         shared_with = CASE WHEN $5 THEN COALESCE($4::jsonb, shared_with) ELSE shared_with END,
         updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [
        name?.trim() || null,
        description !== undefined ? description : null,
        members !== undefined ? JSON.stringify(memberList) : null,
        sharedWith !== undefined ? JSON.stringify(sharedWith) : null,
        isOwner,
        req.params.id,
      ]
    );
    if (members !== undefined) autoAddMemberContacts(req.userId!, memberList).catch(() => {});
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Soft delete — admin can still see and restore/re-share the list
contactRouter.delete('/distribution-lists/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `UPDATE distribution_lists SET is_deleted = true, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Liste introuvable' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Share a distribution list with users/groups (owner only)
contactRouter.post('/distribution-lists/:id/share', async (req: AuthRequest, res) => {
  try {
    const { sharedWith } = req.body;
    const result = await pool.query(
      `UPDATE distribution_lists SET shared_with = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [JSON.stringify(sharedWith || []), req.params.id, req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Liste introuvable' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- CardDAV push helpers (fire-and-forget) ----

/** Find a CardDAV-enabled mail account owned by or assigned to the user. */
async function findCardDAVAccount(userId: string): Promise<{ id: string; carddav_url: string } | null> {
  const r = await pool.query(
    `SELECT ma.id, ma.carddav_url
     FROM mail_accounts ma
     LEFT JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id AND mba.user_id = $1
     WHERE (ma.user_id = $1 OR mba.user_id = $1)
       AND ma.carddav_sync_enabled = true
       AND ma.carddav_url IS NOT NULL
     ORDER BY ma.is_default DESC NULLS LAST, ma.created_at ASC
     LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function buildCardDAVServiceForAccount(mailAccountId: string, collectionUrl: string): Promise<CardDAVService | null> {
  const acc = await pool.query(
    'SELECT carddav_username, username, password_encrypted FROM mail_accounts WHERE id = $1',
    [mailAccountId]
  );
  if (acc.rows.length === 0) return null;
  const row = acc.rows[0];
  try {
    const password = decrypt(row.password_encrypted);
    return new CardDAVService({
      baseUrl: collectionUrl,
      username: row.carddav_username || row.username,
      password,
    });
  } catch {
    return null;
  }
}

async function pushContactToCardDAV(contactId: string): Promise<void> {
  const r = await pool.query(
    `SELECT id, user_id, email, first_name, last_name, display_name, phone, mobile, company,
            job_title, department, notes, external_id, mail_account_id, carddav_url, carddav_etag,
            nc_managed, nc_addressbook_url, nc_etag, nc_uri
     FROM contacts WHERE id = $1`,
    [contactId]
  );
  if (r.rows.length === 0) return;
  const c = r.rows[0];
  if (!c.external_id) return;

  const vcard = buildVCard({
    uid: c.external_id,
    email: c.email,
    first_name: c.first_name,
    last_name: c.last_name,
    display_name: c.display_name,
    phone: c.phone,
    mobile: c.mobile,
    company: c.company,
    job_title: c.job_title,
    department: c.department,
    notes: c.notes,
  });

  // NextCloud-managed → push via NC
  if (c.nc_managed && c.nc_addressbook_url) {
    try {
      const { getUserClient } = await import('../services/nextcloudHelper');
      const nc = await getUserClient(c.user_id);
      if (nc) {
        const out = await nc.putContact(c.nc_addressbook_url, c.external_id, vcard, c.nc_etag || undefined);
        await pool.query(
          'UPDATE contacts SET nc_uri = $1, nc_etag = $2, updated_at = NOW() WHERE id = $3',
          [out.href, out.etag || null, contactId]
        );
      }
    } catch (e) {
      logger.error(e as Error, 'NextCloud contact push failed');
    }
    return;
  }

  if (!c.mail_account_id || !c.carddav_url) return;

  const svc = await buildCardDAVServiceForAccount(c.mail_account_id, c.carddav_url);
  if (!svc) return;

  const out = await svc.putContact(c.external_id, vcard, c.carddav_etag || undefined);
  if (!out.ok) {
    logger.error(new Error(`PUT ${out.href} -> ${out.status}: ${out.error || ''}`), 'CardDAV push failed');
    return;
  }
  await pool.query(
    'UPDATE contacts SET carddav_href = $1, carddav_etag = $2, updated_at = NOW() WHERE id = $3',
    [out.href, out.etag || null, contactId]
  );
}

async function deleteContactFromCardDAV(mailAccountId: string, collectionUrl: string, hrefOrFile: string): Promise<void> {
  const svc = await buildCardDAVServiceForAccount(mailAccountId, collectionUrl);
  if (!svc) return;
  await svc.deleteContact(hrefOrFile);
}
