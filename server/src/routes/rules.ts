import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { CONDITION_TYPES, ACTION_TYPES } from '../services/mailRules';

export const rulesRouter = Router();
export const adminRulesRouter = Router();

const conditionSchema = z.object({
  type: z.enum(CONDITION_TYPES as [string, ...string[]]),
  value: z.string().max(2000).optional(),
  headerName: z.string().max(120).optional(),
  level: z.string().max(40).optional(),
  bytes: z.number().int().nonnegative().optional(),
});

const actionSchema = z.object({
  type: z.enum(ACTION_TYPES as [string, ...string[]]),
  folder: z.string().max(255).optional(),
  to: z.string().max(2000).optional(),
  templateId: z.string().uuid().optional(),
  categoryId: z.string().max(120).optional(),
  categoryName: z.string().max(255).optional(),
});

const ruleUpsertSchema = z.object({
  name: z.string().trim().min(1).max(255),
  enabled: z.boolean().optional().default(true),
  matchType: z.enum(['all', 'any']).optional().default('all'),
  stopProcessing: z.boolean().optional().default(true),
  accountId: z.string().uuid().nullable().optional(),
  conditions: z.array(conditionSchema).max(40).optional().default([]),
  exceptions: z.array(conditionSchema).max(40).optional().default([]),
  actions: z.array(actionSchema).min(1).max(20),
});

function rowToDto(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    name: row.name,
    enabled: !!row.enabled,
    position: Number(row.position) || 0,
    matchType: row.match_type,
    stopProcessing: !!row.stop_processing,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    exceptions: Array.isArray(row.exceptions) ? row.exceptions : [],
    actions: Array.isArray(row.actions) ? row.actions : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── User-scoped routes ─────────────────────────────────────────────

/** List rules owned by the current user + rules shared with them. */
rulesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT mr.*,
              (mr.user_id <> $1) AS shared_in,
              u.display_name AS owner_display_name,
              u.email AS owner_email
         FROM mail_rules mr
         JOIN users u ON u.id = mr.user_id
        WHERE mr.user_id = $1
           OR EXISTS (
                SELECT 1 FROM mail_rule_shares mrs
                  WHERE mrs.rule_id = mr.id AND mrs.user_id = $1)
           OR EXISTS (
                SELECT 1 FROM mail_rule_shares mrs
                  JOIN user_groups ug ON ug.group_id = mrs.group_id
                  WHERE mrs.rule_id = mr.id AND ug.user_id = $1)
        ORDER BY mr.position ASC, mr.created_at ASC`,
      [req.userId],
    );
    res.json(rows.map((r) => ({
      ...rowToDto(r),
      sharedIn: !!r.shared_in,
      ownerDisplayName: r.owner_display_name || null,
      ownerEmail: r.owner_email || null,
    })));
  } catch (error: any) {
    logger.error(error, 'rules list failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const data = ruleUpsertSchema.parse(req.body);
    const pos = await pool.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM mail_rules WHERE user_id = $1`,
      [req.userId],
    );
    const r = await pool.query(
      `INSERT INTO mail_rules (
         user_id, account_id, name, enabled, position, match_type,
         stop_processing, conditions, exceptions, actions
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)
       RETURNING *`,
      [
        req.userId, data.accountId ?? null, data.name, data.enabled, pos.rows[0].next,
        data.matchType, data.stopProcessing,
        JSON.stringify(data.conditions), JSON.stringify(data.exceptions),
        JSON.stringify(data.actions),
      ],
    );
    res.status(201).json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error(error, 'rules create failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

async function ensureOwned(ruleId: string, userId: string): Promise<any | null> {
  const r = await pool.query(
    `SELECT * FROM mail_rules WHERE id = $1 AND user_id = $2`,
    [ruleId, userId],
  );
  return r.rows[0] || null;
}

rulesRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    const data = ruleUpsertSchema.parse(req.body);
    const r = await pool.query(
      `UPDATE mail_rules SET
         name = $1, enabled = $2, match_type = $3, stop_processing = $4,
         account_id = $5, conditions = $6::jsonb, exceptions = $7::jsonb,
         actions = $8::jsonb, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        data.name, data.enabled, data.matchType, data.stopProcessing,
        data.accountId ?? null,
        JSON.stringify(data.conditions), JSON.stringify(data.exceptions),
        JSON.stringify(data.actions), req.params.id,
      ],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error(error, 'rules update failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.patch('/:id/toggle', async (req: AuthRequest, res) => {
  try {
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !owned.enabled;
    await pool.query(
      `UPDATE mail_rules SET enabled = $1, updated_at = NOW() WHERE id = $2`,
      [enabled, req.params.id],
    );
    res.json({ success: true, enabled });
  } catch (error: any) {
    logger.error(error, 'rules toggle failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.patch('/:id/rename', async (req: AuthRequest, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 255) return res.status(400).json({ error: 'Nom invalide' });
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    await pool.query(
      `UPDATE mail_rules SET name = $1, updated_at = NOW() WHERE id = $2`,
      [name, req.params.id],
    );
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'rules rename failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.post('/reorder', async (req: AuthRequest, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.every((x: any) => typeof x === 'string')) {
      return res.status(400).json({ error: 'Liste invalide' });
    }
    // Verify ownership of all listed rules
    const owned = await pool.query(
      `SELECT id FROM mail_rules WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [req.userId, ids],
    );
    const ownedSet = new Set(owned.rows.map((r) => r.id));
    if (ownedSet.size !== ids.length) {
      return res.status(403).json({ error: 'Une ou plusieurs règles ne vous appartiennent pas' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          `UPDATE mail_rules SET position = $1, updated_at = NOW() WHERE id = $2`,
          [i, ids[i]],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'rules reorder failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    await pool.query(`DELETE FROM mail_rules WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'rules delete failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

// Sharing
rulesRouter.get('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    const r = await pool.query(
      `SELECT mrs.id, mrs.user_id, mrs.group_id,
              u.email AS user_email, u.display_name AS user_display_name,
              g.name AS group_name
         FROM mail_rule_shares mrs
         LEFT JOIN users u ON u.id = mrs.user_id
         LEFT JOIN groups g ON g.id = mrs.group_id
         WHERE mrs.rule_id = $1
         ORDER BY mrs.created_at DESC`,
      [req.params.id],
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
    logger.error(error, 'rules shares list failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.post('/:id/shares', async (req: AuthRequest, res) => {
  try {
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    const userId = req.body?.userId || null;
    const groupId = req.body?.groupId || null;
    if ((userId && groupId) || (!userId && !groupId)) {
      return res.status(400).json({ error: 'Spécifiez userId OU groupId' });
    }
    const r = await pool.query(
      `INSERT INTO mail_rule_shares (rule_id, user_id, group_id) VALUES ($1, $2, $3) RETURNING id`,
      [req.params.id, userId, groupId],
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (error: any) {
    logger.error(error, 'rules share failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

rulesRouter.delete('/:id/shares/:shareId', async (req: AuthRequest, res) => {
  try {
    const owned = await ensureOwned(req.params.id, req.userId!);
    if (!owned) return res.status(404).json({ error: 'Règle introuvable' });
    await pool.query(`DELETE FROM mail_rule_shares WHERE id = $1 AND rule_id = $2`, [req.params.shareId, req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'rules unshare failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

// ─── Admin routes ───────────────────────────────────────────────────

adminRulesRouter.use(adminMiddleware);

adminRulesRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const view = String(req.query.view || 'all'); // all | user | group
    const userId = req.query.userId ? String(req.query.userId) : null;
    const groupId = req.query.groupId ? String(req.query.groupId) : null;

    const params: any[] = [];
    const where: string[] = [];

    if (userId) {
      params.push(userId);
      where.push(`mr.user_id = $${params.length}`);
    }
    if (groupId) {
      params.push(groupId);
      where.push(`mr.user_id IN (SELECT user_id FROM user_groups WHERE group_id = $${params.length})`);
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      const i = params.length;
      where.push(`(LOWER(mr.name) LIKE $${i} OR LOWER(u.email) LIKE $${i} OR LOWER(COALESCE(u.display_name, '')) LIKE $${i})`);
    }

    const sql = `
      SELECT mr.*,
             u.email AS user_email,
             u.display_name AS user_display_name,
             ARRAY(SELECT g.id::text FROM user_groups ug JOIN groups g ON g.id = ug.group_id WHERE ug.user_id = mr.user_id) AS group_ids,
             ARRAY(SELECT g.name FROM user_groups ug JOIN groups g ON g.id = ug.group_id WHERE ug.user_id = mr.user_id) AS group_names
        FROM mail_rules mr
        JOIN users u ON u.id = mr.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY u.email ASC, mr.position ASC, mr.created_at ASC
    `;
    const r = await pool.query(sql, params);

    const rules = r.rows.map((row) => ({
      ...rowToDto(row),
      userEmail: row.user_email,
      userDisplayName: row.user_display_name,
      groupIds: row.group_ids || [],
      groupNames: row.group_names || [],
    }));

    if (view === 'user') {
      const grouped = new Map<string, any>();
      for (const rule of rules) {
        if (!grouped.has(rule.userId)) {
          grouped.set(rule.userId, {
            kind: 'user',
            userId: rule.userId,
            userEmail: rule.userEmail,
            userDisplayName: rule.userDisplayName,
            rules: [],
          });
        }
        grouped.get(rule.userId).rules.push(rule);
      }
      return res.json({ view, groups: Array.from(grouped.values()) });
    }

    if (view === 'group') {
      // Build group buckets — a rule's user may belong to multiple groups, in
      // which case the rule appears under each group (Outlook-like behaviour).
      const groupMap = new Map<string, { kind: 'group'; groupId: string; groupName: string; rules: any[] }>();
      const ungrouped: any[] = [];
      for (const rule of rules) {
        if (!rule.groupIds || rule.groupIds.length === 0) {
          ungrouped.push(rule);
          continue;
        }
        rule.groupIds.forEach((gid: string, i: number) => {
          const gname = rule.groupNames?.[i] || gid;
          if (!groupMap.has(gid)) groupMap.set(gid, { kind: 'group', groupId: gid, groupName: gname, rules: [] });
          groupMap.get(gid)!.rules.push(rule);
        });
      }
      const groups = Array.from(groupMap.values());
      if (ungrouped.length) {
        groups.push({ kind: 'group', groupId: '', groupName: 'Sans groupe', rules: ungrouped });
      }
      return res.json({ view, groups });
    }

    res.json({ view, rules });
  } catch (error: any) {
    logger.error(error, 'admin rules list failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminRulesRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const data = ruleUpsertSchema.parse(req.body);
    const exists = await pool.query(`SELECT id FROM mail_rules WHERE id = $1`, [req.params.id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Règle introuvable' });
    const r = await pool.query(
      `UPDATE mail_rules SET
         name = $1, enabled = $2, match_type = $3, stop_processing = $4,
         account_id = $5, conditions = $6::jsonb, exceptions = $7::jsonb,
         actions = $8::jsonb, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        data.name, data.enabled, data.matchType, data.stopProcessing,
        data.accountId ?? null,
        JSON.stringify(data.conditions), JSON.stringify(data.exceptions),
        JSON.stringify(data.actions), req.params.id,
      ],
    );
    res.json(rowToDto(r.rows[0]));
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error(error, 'admin rules update failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminRulesRouter.patch('/:id/toggle', async (req: AuthRequest, res) => {
  try {
    const exists = await pool.query(`SELECT enabled FROM mail_rules WHERE id = $1`, [req.params.id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Règle introuvable' });
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : !exists.rows[0].enabled;
    await pool.query(
      `UPDATE mail_rules SET enabled = $1, updated_at = NOW() WHERE id = $2`,
      [enabled, req.params.id],
    );
    res.json({ success: true, enabled });
  } catch (error: any) {
    logger.error(error, 'admin rules toggle failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

adminRulesRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    await pool.query(`DELETE FROM mail_rules WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'admin rules delete failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

/** Lightweight users + groups listing for the autocomplete pickers. */
adminRulesRouter.get('/directory', async (_req: AuthRequest, res) => {
  try {
    const users = await pool.query(
      `SELECT id, email, display_name, is_admin FROM users ORDER BY email ASC`,
    );
    const groups = await pool.query(`SELECT id, name FROM groups ORDER BY name ASC`);
    res.json({
      users: users.rows.map((u) => ({
        id: u.id, email: u.email, displayName: u.display_name, isAdmin: !!u.is_admin,
      })),
      groups: groups.rows.map((g) => ({ id: g.id, name: g.name })),
    });
  } catch (error: any) {
    logger.error(error, 'admin rules directory failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});
