import { Router } from 'express';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { z } from 'zod';
import { logger } from '../utils/logger';

export const bulkSendRouter = Router();
export const adminBulkSendRouter = Router();

adminBulkSendRouter.use(adminMiddleware);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getAdminSettings(client: typeof pool): Promise<{
  defaultRateLimit: number;
  defaultRateWindow: number;
  maxRateLimit: number;
  minRateWindow: number;
}> {
  const res = await client.query(
    `SELECT key, value FROM admin_settings WHERE key IN (
      'bulk_send_default_rate_limit','bulk_send_default_rate_window',
      'bulk_send_max_rate_limit','bulk_send_min_rate_window'
    )`
  );
  const map: Record<string, number> = {};
  for (const row of res.rows) map[row.key] = Number(row.value);
  return {
    defaultRateLimit: map['bulk_send_default_rate_limit'] ?? 50,
    defaultRateWindow: map['bulk_send_default_rate_window'] ?? 5,
    maxRateLimit: map['bulk_send_max_rate_limit'] ?? 200,
    minRateWindow: map['bulk_send_min_rate_window'] ?? 1,
  };
}

// ─── User routes ─────────────────────────────────────────────────────────────

// GET /api/bulk-send/settings  — user effective settings
bulkSendRouter.get('/settings', async (req: AuthRequest, res) => {
  try {
    const adminCfg = await getAdminSettings(pool);
    const userRes = await pool.query(
      'SELECT rate_limit, rate_window_minutes FROM bulk_send_user_settings WHERE user_id = $1',
      [req.userId]
    );
    const row = userRes.rows[0];
    res.json({
      rateLimit: row?.rate_limit ?? null,
      rateWindowMinutes: row?.rate_window_minutes ?? null,
      effectiveRateLimit: row?.rate_limit ?? adminCfg.defaultRateLimit,
      effectiveRateWindow: row?.rate_window_minutes ?? adminCfg.defaultRateWindow,
      adminDefaults: adminCfg,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bulk-send/settings  — user updates their own rate limits
bulkSendRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const adminCfg = await getAdminSettings(pool);
    const schema = z.object({
      rateLimit: z.number().int().min(1).max(adminCfg.maxRateLimit).nullable(),
      rateWindowMinutes: z.number().int().min(adminCfg.minRateWindow).max(60).nullable(),
    });
    const { rateLimit, rateWindowMinutes } = schema.parse(req.body);
    await pool.query(
      `INSERT INTO bulk_send_user_settings (user_id, rate_limit, rate_window_minutes, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET rate_limit = $2, rate_window_minutes = $3, updated_at = NOW()`,
      [req.userId, rateLimit, rateWindowMinutes]
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/bulk-send/jobs  — create a new bulk send job
bulkSendRouter.post('/jobs', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      accountId: z.string().uuid(),
      name: z.string().min(1).max(255),
      source: z.enum(['mailmerge', 'distributionlist', 'manual']).default('mailmerge'),
      recipients: z.array(z.object({
        email: z.string().email(),
        displayName: z.string().optional(),
        subject: z.string(),
        bodyHtml: z.string(),
        bodyText: z.string().optional(),
        attachments: z.any().optional(),
      })).min(1).max(10000),
    });
    const { accountId, name, source, recipients } = schema.parse(req.body);

    // Verify account belongs to user (owner or assigned)
    const accRes = await pool.query(
      `SELECT ma.id FROM mail_accounts ma
       LEFT JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id AND mba.user_id = $2
       WHERE ma.id = $1 AND (ma.user_id = $2 OR mba.user_id = $2)`,
      [accountId, req.userId]
    );
    if (!accRes.rows.length) return res.status(403).json({ error: 'Compte non autorisé' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const jobRes = await client.query(
        `INSERT INTO bulk_send_jobs (user_id, account_id, name, source, total)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [req.userId, accountId, name, source, recipients.length]
      );
      const jobId = jobRes.rows[0].id;

      // Batch insert recipients
      const chunkSize = 500;
      for (let i = 0; i < recipients.length; i += chunkSize) {
        const chunk = recipients.slice(i, i + chunkSize);
        const values = chunk.map((r, idx) => {
          const base = i + idx;
          return `($${base * 8 + 1},$${base * 8 + 2},$${base * 8 + 3},$${base * 8 + 4},$${base * 8 + 5},$${base * 8 + 6},$${base * 8 + 7},$${base * 8 + 8})`;
        }).join(',');
        const params: any[] = [];
        chunk.forEach(r => {
          params.push(jobId, r.email, r.displayName ?? null, r.subject, r.bodyHtml, r.bodyText ?? null, r.attachments ? JSON.stringify(r.attachments) : null, 'pending');
        });
        await client.query(
          `INSERT INTO bulk_send_recipients (job_id, email, display_name, subject, body_html, body_text, attachments, status) VALUES ${values}`,
          params
        );
      }
      await client.query('COMMIT');
      res.json({ jobId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error(err, 'Create bulk send job failed');
    res.status(400).json({ error: err.message });
  }
});

// GET /api/bulk-send/jobs  — list user's jobs (paginated, filterable)
bulkSendRouter.get('/jobs', async (req: AuthRequest, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1')));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'))));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['j.user_id = $1'];
    const params: any[] = [req.userId];
    let p = 2;

    if (search) { conditions.push(`j.name ILIKE $${p++}`); params.push(`%${search}%`); }
    if (status) { conditions.push(`j.status = $${p++}`); params.push(status); }

    const where = conditions.join(' AND ');
    const [jobsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT j.id, j.name, j.status, j.source, j.total, j.sent, j.errors,
                j.created_at, j.updated_at, j.completed_at,
                ma.name AS account_name, ma.email AS account_email
         FROM bulk_send_jobs j
         JOIN mail_accounts ma ON ma.id = j.account_id
         WHERE ${where}
         ORDER BY j.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM bulk_send_jobs j WHERE ${where}`, params),
    ]);
    res.json({
      jobs: jobsRes.rows,
      total: parseInt(countRes.rows[0].count),
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bulk-send/jobs/:id  — job details + recipient list
bulkSendRouter.get('/jobs/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(String(req.query.page || '1')));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'))));
    const offset = (page - 1) * limit;
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();

    const jobRes = await pool.query(
      `SELECT j.*, ma.name AS account_name, ma.email AS account_email
       FROM bulk_send_jobs j JOIN mail_accounts ma ON ma.id = j.account_id
       WHERE j.id = $1 AND j.user_id = $2`,
      [id, req.userId]
    );
    if (!jobRes.rows.length) return res.status(404).json({ error: 'Job non trouvé' });

    const rconditions: string[] = ['r.job_id = $1'];
    const rparams: any[] = [id];
    let rp = 2;
    if (statusFilter) { rconditions.push(`r.status = $${rp++}`); rparams.push(statusFilter); }
    if (search) { rconditions.push(`r.email ILIKE $${rp++}`); rparams.push(`%${search}%`); }
    const rwhere = rconditions.join(' AND ');

    const [recipientsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, email, display_name, subject, status, error, attempts, sent_at, created_at
         FROM bulk_send_recipients r WHERE ${rwhere}
         ORDER BY created_at ASC LIMIT $${rp} OFFSET $${rp + 1}`,
        [...rparams, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM bulk_send_recipients r WHERE ${rwhere}`, rparams),
    ]);

    res.json({
      job: jobRes.rows[0],
      recipients: recipientsRes.rows,
      total: parseInt(countRes.rows[0].count),
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bulk-send/jobs/:id/pause
bulkSendRouter.post('/jobs/:id/pause', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `UPDATE bulk_send_jobs SET status = 'paused', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('pending','running')
       RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Job non trouvé ou déjà terminé' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bulk-send/jobs/:id/resume
bulkSendRouter.post('/jobs/:id/resume', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `UPDATE bulk_send_jobs SET status = 'pending', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'paused'
       RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Job non trouvé ou non en pause' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bulk-send/jobs/:id  — cancel a job
bulkSendRouter.delete('/jobs/:id', async (req: AuthRequest, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE bulk_send_jobs SET status = 'cancelled', updated_at = NOW(), completed_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status NOT IN ('completed','cancelled')
         RETURNING id`,
        [req.params.id, req.userId]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Job non trouvé ou déjà terminé' });
      await client.query(
        `UPDATE bulk_send_recipients SET status = 'cancelled'
         WHERE job_id = $1 AND status = 'pending'`,
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

// GET /api/admin/bulk-send/jobs — all jobs (all users)
adminBulkSendRouter.get('/jobs', async (req: AuthRequest, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const userId = String(req.query.userId || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1')));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '30'))));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let p = 1;

    if (search) { conditions.push(`(j.name ILIKE $${p} OR u.email ILIKE $${p} OR u.display_name ILIKE $${p})`); params.push(`%${search}%`); p++; }
    if (status) { conditions.push(`j.status = $${p++}`); params.push(status); }
    if (userId) { conditions.push(`j.user_id = $${p++}`); params.push(userId); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [jobsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT j.id, j.name, j.status, j.source, j.total, j.sent, j.errors,
                j.created_at, j.updated_at, j.completed_at,
                ma.name AS account_name, ma.email AS account_email,
                u.email AS user_email, u.display_name AS user_display_name
         FROM bulk_send_jobs j
         JOIN mail_accounts ma ON ma.id = j.account_id
         JOIN users u ON u.id = j.user_id
         ${where}
         ORDER BY j.created_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM bulk_send_jobs j JOIN users u ON u.id = j.user_id ${where}`,
        params
      ),
    ]);
    res.json({ jobs: jobsRes.rows, total: parseInt(countRes.rows[0].count), page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/bulk-send/settings
adminBulkSendRouter.get('/settings', async (req: AuthRequest, res) => {
  try {
    const settings = await getAdminSettings(pool);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/bulk-send/settings
adminBulkSendRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      defaultRateLimit: z.number().int().min(1).max(10000),
      defaultRateWindow: z.number().int().min(1).max(1440),
      maxRateLimit: z.number().int().min(1).max(10000),
      minRateWindow: z.number().int().min(1).max(60),
    });
    const cfg = schema.parse(req.body);
    await Promise.all([
      pool.query(`INSERT INTO admin_settings (key,value,updated_at) VALUES ('bulk_send_default_rate_limit',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1,updated_at=NOW()`, [JSON.stringify(cfg.defaultRateLimit)]),
      pool.query(`INSERT INTO admin_settings (key,value,updated_at) VALUES ('bulk_send_default_rate_window',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1,updated_at=NOW()`, [JSON.stringify(cfg.defaultRateWindow)]),
      pool.query(`INSERT INTO admin_settings (key,value,updated_at) VALUES ('bulk_send_max_rate_limit',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1,updated_at=NOW()`, [JSON.stringify(cfg.maxRateLimit)]),
      pool.query(`INSERT INTO admin_settings (key,value,updated_at) VALUES ('bulk_send_min_rate_window',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=$1,updated_at=NOW()`, [JSON.stringify(cfg.minRateWindow)]),
    ]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/bulk-send/jobs/:id/cancel — admin can cancel any job
adminBulkSendRouter.post('/jobs/:id/cancel', async (req: AuthRequest, res) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE bulk_send_jobs SET status = 'cancelled', updated_at = NOW(), completed_at = NOW()
         WHERE id = $1 AND status NOT IN ('completed','cancelled') RETURNING id`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Job non trouvé ou déjà terminé' });
      await client.query(
        `UPDATE bulk_send_recipients SET status = 'cancelled' WHERE job_id = $1 AND status = 'pending'`,
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/bulk-send/stats — aggregate stats for dashboard
adminBulkSendRouter.get('/stats', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COALESCE(SUM(sent), 0) AS total_sent,
        COALESCE(SUM(errors), 0) AS total_errors
      FROM bulk_send_jobs
    `);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
