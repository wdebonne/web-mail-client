import { Router } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export const mailTemplateRouter = Router();
export const adminMailTemplateRouter = Router();

// ─── Sanitize options (compose-grade HTML) ──────────────────────────────────
// Keep aligned with compose pipeline: rich content but no scripts / styles
// outside attribute whitelists.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'b', 'i', 'u', 's', 'strong', 'em', 'strike', 'del', 'ins',
    'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'sub', 'sup',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr', 'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    span: ['style'],
    div: ['style'],
    p: ['style'],
    table: ['style'],
    td: ['style', 'colspan', 'rowspan'],
    th: ['style', 'colspan', 'rowspan'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
};

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(255),
  subject: z.string().trim().max(998).optional().default(''),
  bodyHtml: z.string().max(200_000).optional().default(''),
});

const adminUpsertSchema = upsertSchema.extend({
  isGlobal: z.boolean().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
});

const shareSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
}).refine((d) => !!d.userId !== !!d.groupId, {
  message: 'Provide exactly one of userId or groupId',
});

type TemplateRow = {
  id: string;
  owner_user_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  is_global: boolean;
  created_at: string;
  updated_at: string;
};

function rowToDto(r: TemplateRow & {
  owner_email?: string | null;
  owner_display_name?: string | null;
  scope?: string;
}) {
  return {
    id: r.id,
    ownerUserId: r.owner_user_id,
    ownerEmail: r.owner_email ?? null,
    ownerDisplayName: r.owner_display_name ?? null,
    name: r.name,
    subject: r.subject,
    bodyHtml: r.body_html,
    isGlobal: r.is_global,
    scope: r.scope ?? (r.is_global ? 'global' : 'owned'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── User endpoints ─────────────────────────────────────────────────────────

/** List all templates accessible to the current user:
 *  - owned (owner_user_id = me)
 *  - global (is_global = true)
 *  - shared with me explicitly (user_id = me)
 *  - shared with one of my groups (group_id ∈ my groups)
 */
mailTemplateRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const r = await pool.query<TemplateRow & { scope: string; owner_email: string | null; owner_display_name: string | null }>(
      `WITH my_groups AS (
         SELECT group_id FROM user_groups WHERE user_id = $1
       )
       SELECT t.*, u.email AS owner_email, u.display_name AS owner_display_name,
         CASE
           WHEN t.owner_user_id = $1 THEN 'owned'
           WHEN t.is_global THEN 'global'
           ELSE 'shared'
         END AS scope
         FROM mail_templates t
         LEFT JOIN users u ON u.id = t.owner_user_id
        WHERE t.owner_user_id = $1
           OR t.is_global = true
           OR EXISTS (
             SELECT 1 FROM mail_template_shares s
              WHERE s.template_id = t.id
                AND (s.user_id = $1 OR s.group_id IN (SELECT group_id FROM my_groups))
           )
        ORDER BY t.name ASC`,
      [userId],
    );
    res.json(r.rows.map(rowToDto));
  } catch (error: any) {
    logger.error(error, 'mail-templates list failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

mailTemplateRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const data = upsertSchema.parse(req.body);
    const safeHtml = sanitizeHtml(data.bodyHtml, SANITIZE_OPTIONS);
    const r = await pool.query<TemplateRow>(
      `INSERT INTO mail_templates (owner_user_id, name, subject, body_html, is_global)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [userId, data.name, data.subject, safeHtml],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error?.issues) return res.status(400).json({ error: 'Données invalides', details: error.issues });
    logger.error(error, 'mail-templates create failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

/** Returns the row when the user is allowed to read it. The `forWrite` flag
 *  restricts to the owner (rename / edit / delete / share). */
async function getTemplateForUser(id: string, userId: string, forWrite: boolean) {
  if (forWrite) {
    const r = await pool.query<TemplateRow>(
      `SELECT * FROM mail_templates WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
      [id, userId],
    );
    return r.rows[0] || null;
  }
  const r = await pool.query<TemplateRow>(
    `SELECT t.* FROM mail_templates t
       LEFT JOIN user_groups ug ON ug.user_id = $2
       LEFT JOIN mail_template_shares s ON s.template_id = t.id
        AND (s.user_id = $2 OR s.group_id = ug.group_id)
      WHERE t.id = $1
        AND (t.owner_user_id = $2 OR t.is_global = true OR s.id IS NOT NULL)
      LIMIT 1`,
    [id, userId],
  );
  return r.rows[0] || null;
}

mailTemplateRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params.id;
    const data = upsertSchema.parse(req.body);
    const existing = await getTemplateForUser(id, userId, true);
    if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
    const safeHtml = sanitizeHtml(data.bodyHtml, SANITIZE_OPTIONS);
    const r = await pool.query<TemplateRow>(
      `UPDATE mail_templates
          SET name = $2, subject = $3, body_html = $4, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, data.name, data.subject, safeHtml],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error?.issues) return res.status(400).json({ error: 'Données invalides', details: error.issues });
    logger.error(error, 'mail-templates update failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

mailTemplateRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params.id;
    const existing = await getTemplateForUser(id, userId, true);
    if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
    await pool.query(`DELETE FROM mail_templates WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'mail-templates delete failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

/** List shares for a template owned by the current user. */
mailTemplateRouter.get('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params.id;
    const existing = await getTemplateForUser(id, userId, true);
    if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
    const r = await pool.query(
      `SELECT s.id, s.user_id, s.group_id,
              u.email AS user_email, u.display_name AS user_display_name,
              g.name AS group_name
         FROM mail_template_shares s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
        WHERE s.template_id = $1
        ORDER BY g.name NULLS LAST, u.email NULLS LAST`,
      [id],
    );
    res.json(r.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      groupId: row.group_id,
      userEmail: row.user_email,
      userDisplayName: row.user_display_name,
      groupName: row.group_name,
    })));
  } catch (error: any) {
    logger.error(error, 'mail-templates list shares failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

mailTemplateRouter.post('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params.id;
    const data = shareSchema.parse(req.body);
    const existing = await getTemplateForUser(id, userId, true);
    if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
    const r = await pool.query(
      `INSERT INTO mail_template_shares (template_id, user_id, group_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [id, data.userId || null, data.groupId || null],
    );
    res.json({ id: r.rows[0].id });
  } catch (error: any) {
    if (error?.issues) return res.status(400).json({ error: 'Données invalides', details: error.issues });
    logger.error(error, 'mail-templates create share failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

mailTemplateRouter.delete('/:id/shares/:shareId', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!;
    const { id, shareId } = req.params;
    const existing = await getTemplateForUser(id, userId, true);
    if (!existing) return res.status(404).json({ error: 'Modèle introuvable' });
    await pool.query(
      `DELETE FROM mail_template_shares WHERE id = $1 AND template_id = $2`,
      [shareId, id],
    );
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'mail-templates delete share failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

// ─── Admin endpoints ────────────────────────────────────────────────────────

adminMailTemplateRouter.use(adminMiddleware);

/** List EVERY template (global + per-user) with owner info. */
adminMailTemplateRouter.get('/', async (_req: AuthRequest, res) => {
  try {
    const r = await pool.query(
      `SELECT t.*, u.email AS owner_email, u.display_name AS owner_display_name,
              CASE WHEN t.is_global THEN 'global' ELSE 'owned' END AS scope
         FROM mail_templates t
         LEFT JOIN users u ON u.id = t.owner_user_id
        ORDER BY t.is_global DESC, u.email NULLS FIRST, t.name ASC`,
    );
    res.json(r.rows.map(rowToDto));
  } catch (error: any) {
    logger.error(error, 'admin mail-templates list failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminMailTemplateRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const data = adminUpsertSchema.parse(req.body);
    const safeHtml = sanitizeHtml(data.bodyHtml, SANITIZE_OPTIONS);
    const isGlobal = data.isGlobal === true;
    const ownerUserId = isGlobal ? null : (data.ownerUserId || req.userId!);
    if (!isGlobal && !ownerUserId) {
      return res.status(400).json({ error: 'Propriétaire requis pour un modèle non-global' });
    }
    const r = await pool.query<TemplateRow>(
      `INSERT INTO mail_templates (owner_user_id, name, subject, body_html, is_global)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ownerUserId, data.name, data.subject, safeHtml, isGlobal],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error?.issues) return res.status(400).json({ error: 'Données invalides', details: error.issues });
    logger.error(error, 'admin mail-templates create failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminMailTemplateRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;
    const data = adminUpsertSchema.parse(req.body);
    const existing = await pool.query<TemplateRow>(
      `SELECT * FROM mail_templates WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!existing.rowCount) return res.status(404).json({ error: 'Modèle introuvable' });
    const safeHtml = sanitizeHtml(data.bodyHtml, SANITIZE_OPTIONS);
    const isGlobal = data.isGlobal === true;
    const ownerUserId = isGlobal ? null : (data.ownerUserId || existing.rows[0].owner_user_id);
    if (!isGlobal && !ownerUserId) {
      return res.status(400).json({ error: 'Propriétaire requis pour un modèle non-global' });
    }
    const r = await pool.query<TemplateRow>(
      `UPDATE mail_templates
          SET name = $2, subject = $3, body_html = $4,
              is_global = $5, owner_user_id = $6, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, data.name, data.subject, safeHtml, isGlobal, ownerUserId],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error?.issues) return res.status(400).json({ error: 'Données invalides', details: error.issues });
    logger.error(error, 'admin mail-templates update failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminMailTemplateRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    await pool.query(`DELETE FROM mail_templates WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'admin mail-templates delete failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminMailTemplateRouter.get('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;
    const r = await pool.query(
      `SELECT s.id, s.user_id, s.group_id,
              u.email AS user_email, u.display_name AS user_display_name,
              g.name AS group_name
         FROM mail_template_shares s
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN groups g ON g.id = s.group_id
        WHERE s.template_id = $1
        ORDER BY g.name NULLS LAST, u.email NULLS LAST`,
      [id],
    );
    res.json(r.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      groupId: row.group_id,
      userEmail: row.user_email,
      userDisplayName: row.user_display_name,
      groupName: row.group_name,
    })));
  } catch (error: any) {
    logger.error(error, 'admin mail-templates list shares failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminMailTemplateRouter.post('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const id = req.params.id;
    const data = shareSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO mail_template_shares (template_id, user_id, group_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [id, data.userId || null, data.groupId || null],
    );
    res.json({ id: r.rows[0].id });
  } catch (error: any) {
    if (error?.issues) return res.status(400).json({ error: 'Données invalides', details: error.issues });
    logger.error(error, 'admin mail-templates create share failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminMailTemplateRouter.delete('/:id/shares/:shareId', async (req: AuthRequest, res) => {
  try {
    const { id, shareId } = req.params;
    await pool.query(
      `DELETE FROM mail_template_shares WHERE id = $1 AND template_id = $2`,
      [shareId, id],
    );
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'admin mail-templates delete share failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});
