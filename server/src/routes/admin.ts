import { Router } from 'express';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { encrypt, decrypt } from '../utils/encryption';
import { O2SwitchService } from '../services/o2switch';
import { logger } from '../utils/logger';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { execSync } from 'child_process';
import { buildIcs } from '../utils/ical';

export const adminRouter = Router();

// All admin routes require admin access
adminRouter.use(adminMiddleware);

// ---- Admin Settings ----
adminRouter.get('/settings', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin_settings ORDER BY key');
    const settings: Record<string, any> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    const settings = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- User Management ----
adminRouter.get('/users', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.is_admin, u.language, u.created_at,
              ARRAY_AGG(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as groups,
              COUNT(DISTINCT ma.id) as account_count
       FROM users u
       LEFT JOIN user_groups ug ON ug.user_id = u.id
       LEFT JOIN groups g ON g.id = ug.group_id
       LEFT JOIN mail_accounts ma ON ma.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.post('/users', async (req: AuthRequest, res) => {
  try {
    const { email, password, displayName, role, isAdmin, groupIds } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role, is_admin)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, display_name, role, is_admin`,
      [email, passwordHash, displayName, role || 'user', isAdmin || false]
    );

    const userId = result.rows[0].id;

    // Add to groups
    if (groupIds?.length) {
      for (const groupId of groupIds) {
        await pool.query(
          'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, groupId]
        );
      }
    }

    // Create default calendar
    await pool.query(
      'INSERT INTO calendars (user_id, name, is_default) VALUES ($1, $2, true)',
      [userId, 'Mon calendrier']
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.put('/users/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { email, displayName, role, isAdmin, groupIds } = req.body;

    const result = await pool.query(
      `UPDATE users SET 
        email = COALESCE($1, email),
        display_name = COALESCE($2, display_name),
        role = COALESCE($3, role),
        is_admin = COALESCE($4, is_admin),
        updated_at = NOW()
       WHERE id = $5 RETURNING id, email, display_name, role, is_admin`,
      [email, displayName, role, isAdmin, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (groupIds) {
      await pool.query('DELETE FROM user_groups WHERE user_id = $1', [id]);
      for (const groupId of groupIds) {
        await pool.query('INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, groupId]);
      }
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.delete('/users/:id', async (req: AuthRequest, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.userId) {
      return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
    }
    
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reset user password
adminRouter.put('/users/:id/password', async (req: AuthRequest, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Groups ----
adminRouter.get('/groups', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*, COUNT(ug.user_id) as member_count
       FROM groups g
       LEFT JOIN user_groups ug ON ug.group_id = g.id
       GROUP BY g.id
       ORDER BY g.name`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.post('/groups', async (req: AuthRequest, res) => {
  try {
    const { name, description, color } = req.body;
    const result = await pool.query(
      'INSERT INTO groups (name, description, color) VALUES ($1, $2, $3) RETURNING *',
      [name, description, color || '#0078D4']
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.put('/groups/:id', async (req: AuthRequest, res) => {
  try {
    const { name, description, color } = req.body;
    const result = await pool.query(
      'UPDATE groups SET name = COALESCE($1, name), description = COALESCE($2, description), color = COALESCE($3, color) WHERE id = $4 RETURNING *',
      [name, description, color, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.delete('/groups/:id', async (req: AuthRequest, res) => {
  try {
    await pool.query('DELETE FROM groups WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- NextCloud Settings ----
adminRouter.get('/nextcloud/status', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      "SELECT key, value FROM admin_settings WHERE key LIKE 'nextcloud_%'"
    );
    const settings: Record<string, any> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.post('/nextcloud/test', async (req: AuthRequest, res) => {
  try {
    const { url, username, password } = req.body;
    // Test NextCloud connection
    const response = await fetch(`${url}/ocs/v2.php/cloud/capabilities?format=json`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
        'OCS-APIRequest': 'true',
      },
    });

    if (response.ok) {
      const data: any = await response.json();
      res.json({ success: true, version: data?.ocs?.data?.version });
    } else {
      res.json({ success: false, error: 'Impossible de se connecter à NextCloud' });
    }
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// ---- Mail Account Management (Admin) ----

const mailAccountSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  imapHost: z.string().min(1),
  imapPort: z.number().default(993),
  imapSecure: z.boolean().default(true),
  smtpHost: z.string().min(1),
  smtpPort: z.number().default(465),
  smtpSecure: z.boolean().default(true),
  username: z.string().min(1),
  password: z.string().min(1),
  isShared: z.boolean().default(false),
  signatureHtml: z.string().optional(),
  signatureText: z.string().optional(),
  color: z.string().default('#0078D4'),
});

// List all mail accounts
adminRouter.get('/mail-accounts', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT ma.id, ma.name, ma.email, ma.imap_host, ma.imap_port, ma.imap_secure,
              ma.smtp_host, ma.smtp_port, ma.smtp_secure, ma.username,
              ma.is_shared, ma.signature_html, ma.signature_text, ma.color, ma.created_at,
              COUNT(mba.id) as assignment_count
       FROM mail_accounts ma
       LEFT JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id
       GROUP BY ma.id
       ORDER BY ma.name`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create mail account (admin-managed)
adminRouter.post('/mail-accounts', async (req: AuthRequest, res) => {
  try {
    const data = mailAccountSchema.parse(req.body);
    const encryptedPassword = encrypt(data.password);

    const result = await pool.query(
      `INSERT INTO mail_accounts (user_id, name, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, password_encrypted, is_shared, signature_html, signature_text, color)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, name, email, imap_host, imap_port, smtp_host, smtp_port, is_shared, color`,
      [data.name, data.email, data.imapHost, data.imapPort, data.imapSecure, data.smtpHost, data.smtpPort, data.smtpSecure, data.username, encryptedPassword, data.isShared, data.signatureHtml, data.signatureText, data.color]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update mail account
adminRouter.put('/mail-accounts/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fields: Record<string, string> = {
      name: 'name', email: 'email', imapHost: 'imap_host', imapPort: 'imap_port',
      smtpHost: 'smtp_host', smtpPort: 'smtp_port', signatureHtml: 'signature_html',
      signatureText: 'signature_text', color: 'color', isShared: 'is_shared',
    };

    for (const [key, column] of Object.entries(fields)) {
      if (data[key] !== undefined) {
        updates.push(`${column} = $${paramIndex++}`);
        values.push(data[key]);
      }
    }

    if (data.password) {
      updates.push(`password_encrypted = $${paramIndex++}`);
      values.push(encrypt(data.password));
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE mail_accounts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte non trouvé' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete mail account
adminRouter.delete('/mail-accounts/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('DELETE FROM mail_accounts WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte non trouvé' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test mail account connection
adminRouter.post('/mail-accounts/:id/test', async (req: AuthRequest, res) => {
  try {
    const { MailService } = await import('../services/mail');
    const { decrypt } = await import('../utils/encryption');

    const result = await pool.query('SELECT * FROM mail_accounts WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte non trouvé' });

    const account = result.rows[0];
    const mailService = new MailService({
      ...account,
      password: decrypt(account.password_encrypted),
    });

    const folders = await mailService.getFolders();
    res.json({ success: true, folders: folders.length });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ---- Mailbox Assignments ----

// List assignments for a mail account
adminRouter.get('/mail-accounts/:id/assignments', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT mba.*, u.email as user_email, u.display_name as user_display_name
       FROM mailbox_assignments mba
       JOIN users u ON u.id = mba.user_id
       WHERE mba.mail_account_id = $1
       ORDER BY u.display_name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Assign account to user
adminRouter.post('/mail-accounts/:id/assignments', async (req: AuthRequest, res) => {
  try {
    const { userId, displayName, sendPermission, isDefault } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId requis' });

    const validPermissions = ['none', 'send_as', 'send_on_behalf'];
    if (sendPermission && !validPermissions.includes(sendPermission)) {
      return res.status(400).json({ error: 'Permission invalide' });
    }

    // If setting as default, unset other defaults for this user
    if (isDefault) {
      await pool.query('UPDATE mailbox_assignments SET is_default = false WHERE user_id = $1', [userId]);
    }

    const result = await pool.query(
      `INSERT INTO mailbox_assignments (mail_account_id, user_id, display_name, send_permission, is_default)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mail_account_id, user_id) DO UPDATE SET
         display_name = COALESCE($3, mailbox_assignments.display_name),
         send_permission = COALESCE($4, mailbox_assignments.send_permission),
         is_default = COALESCE($5, mailbox_assignments.is_default)
       RETURNING *`,
      [req.params.id, userId, displayName || null, sendPermission || 'none', isDefault || false]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update assignment
adminRouter.put('/mail-accounts/:id/assignments/:assignmentId', async (req: AuthRequest, res) => {
  try {
    const { displayName, sendPermission, isDefault } = req.body;

    const validPermissions = ['none', 'send_as', 'send_on_behalf'];
    if (sendPermission && !validPermissions.includes(sendPermission)) {
      return res.status(400).json({ error: 'Permission invalide' });
    }

    // If setting as default, unset other defaults for this user
    if (isDefault) {
      const assignment = await pool.query('SELECT user_id FROM mailbox_assignments WHERE id = $1', [req.params.assignmentId]);
      if (assignment.rows.length > 0) {
        await pool.query('UPDATE mailbox_assignments SET is_default = false WHERE user_id = $1', [assignment.rows[0].user_id]);
      }
    }

    const result = await pool.query(
      `UPDATE mailbox_assignments SET 
        display_name = COALESCE($1, display_name),
        send_permission = COALESCE($2, send_permission),
        is_default = COALESCE($3, is_default)
       WHERE id = $4 RETURNING *`,
      [displayName, sendPermission, isDefault, req.params.assignmentId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Attribution non trouvée' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove assignment
adminRouter.delete('/mail-accounts/:id/assignments/:assignmentId', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM mailbox_assignments WHERE id = $1 AND mail_account_id = $2 RETURNING id',
      [req.params.assignmentId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Attribution non trouvée' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// ---- Admin Audit Logs ----
// ========================================

async function addLog(userId: string | undefined, action: string, category: string, req: AuthRequest, details?: any, targetType?: string, targetId?: string) {
  try {
    await pool.query(
      `INSERT INTO admin_logs (user_id, action, category, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, action, category, targetType || null, targetId || null, JSON.stringify(details || {}),
       req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null, req.headers['user-agent'] || null]
    );
  } catch (error) {
    logger.error(error as Error, 'Failed to write audit log');
  }
}

adminRouter.get('/logs', async (req: AuthRequest, res) => {
  try {
    const { category, action, userId, from, to, page = '1', limit = '50', search } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (category) { conditions.push(`l.category = $${paramIndex++}`); values.push(category); }
    if (action) { conditions.push(`l.action ILIKE $${paramIndex++}`); values.push(`%${action}%`); }
    if (userId) { conditions.push(`l.user_id = $${paramIndex++}`); values.push(userId); }
    if (from) { conditions.push(`l.created_at >= $${paramIndex++}`); values.push(from); }
    if (to) { conditions.push(`l.created_at <= $${paramIndex++}`); values.push(to); }
    if (search) { conditions.push(`(l.action ILIKE $${paramIndex} OR l.details::text ILIKE $${paramIndex})`); values.push(`%${search}%`); paramIndex++; }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM admin_logs l ${where}`, values
    );

    values.push(limitNum);
    values.push(offset);

    const result = await pool.query(
      `SELECT l.*, u.email as user_email, u.display_name as user_display_name
       FROM admin_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      values
    );

    res.json({
      logs: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: pageNum,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

adminRouter.get('/logs/categories', async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT category FROM admin_logs ORDER BY category');
    res.json(result.rows.map((r: any) => r.category));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// ---- Admin Dashboard / Stats ----
// ========================================

adminRouter.get('/dashboard', async (req: AuthRequest, res) => {
  try {
    const [
      usersResult, groupsResult, accountsResult, contactsResult,
      calendarsResult, eventsResult, cachedEmailsResult, pluginsResult,
      logsResult, dbSizeResult,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM groups'),
      pool.query('SELECT COUNT(*) FROM mail_accounts'),
      pool.query('SELECT COUNT(*) FROM contacts'),
      pool.query('SELECT COUNT(*) FROM calendars'),
      pool.query('SELECT COUNT(*) FROM calendar_events'),
      pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN is_read THEN 1 ELSE 0 END) as read, SUM(CASE WHEN is_flagged THEN 1 ELSE 0 END) as flagged FROM cached_emails'),
      pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active FROM plugins'),
      pool.query('SELECT COUNT(*) FROM admin_logs WHERE created_at > NOW() - INTERVAL \'24 hours\''),
      pool.query("SELECT pg_database_size(current_database()) as size"),
    ]);

    // Docker stats
    let dockerStats: any = null;
    try {
      const containerName = process.env.HOSTNAME || 'web-mail-client';
      const stats = execSync(`cat /proc/1/cgroup 2>/dev/null || echo ""`, { encoding: 'utf8', timeout: 3000 });
      const memUsage = execSync('cat /sys/fs/cgroup/memory.current 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null || echo "0"', { encoding: 'utf8', timeout: 3000 }).trim();
      const memLimit = execSync('cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo "0"', { encoding: 'utf8', timeout: 3000 }).trim();

      dockerStats = {
        memoryUsed: parseInt(memUsage) || 0,
        memoryLimit: memLimit === 'max' ? 0 : (parseInt(memLimit) || 0),
        uptime: process.uptime(),
        nodeVersion: process.version,
        pid: process.pid,
      };
    } catch {
      dockerStats = {
        memoryUsed: process.memoryUsage().heapUsed,
        memoryLimit: 0,
        uptime: process.uptime(),
        nodeVersion: process.version,
        pid: process.pid,
      };
    }

    // O2Switch accounts summary
    let o2switchSummary = { total: 0, active: 0 };
    try {
      const o2Result = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active FROM o2switch_accounts');
      o2switchSummary = { total: parseInt(o2Result.rows[0].total), active: parseInt(o2Result.rows[0].active) || 0 };
    } catch { /* table might not exist yet */ }

    res.json({
      users: parseInt(usersResult.rows[0].count),
      groups: parseInt(groupsResult.rows[0].count),
      mailAccounts: parseInt(accountsResult.rows[0].count),
      contacts: parseInt(contactsResult.rows[0].count),
      calendars: parseInt(calendarsResult.rows[0].count),
      events: parseInt(eventsResult.rows[0].count),
      emails: {
        total: parseInt(cachedEmailsResult.rows[0].total) || 0,
        read: parseInt(cachedEmailsResult.rows[0].read) || 0,
        flagged: parseInt(cachedEmailsResult.rows[0].flagged) || 0,
      },
      plugins: {
        total: parseInt(pluginsResult.rows[0].total),
        active: parseInt(pluginsResult.rows[0].active) || 0,
      },
      logsLast24h: parseInt(logsResult.rows[0].count),
      databaseSize: parseInt(dbSizeResult.rows[0].size),
      docker: dockerStats,
      o2switch: o2switchSummary,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// ---- O2Switch cPanel Integration ----
// ========================================

// List O2Switch accounts
adminRouter.get('/o2switch/accounts', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'SELECT id, hostname, username, label, is_active, last_sync, created_at FROM o2switch_accounts ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add O2Switch account
adminRouter.post('/o2switch/accounts', async (req: AuthRequest, res) => {
  try {
    const { hostname, username, apiToken, label } = req.body;
    if (!hostname || !username || !apiToken) {
      return res.status(400).json({ error: 'hostname, username et apiToken sont requis' });
    }

    const encryptedToken = encrypt(apiToken);
    const result = await pool.query(
      `INSERT INTO o2switch_accounts (hostname, username, api_token_encrypted, label)
       VALUES ($1, $2, $3, $4) RETURNING id, hostname, username, label, is_active, created_at`,
      [hostname, username, encryptedToken, label || `${username}@${hostname}`]
    );

    await addLog(req.userId, 'o2switch_account_created', 'o2switch', req, { hostname, username }, 'o2switch_account', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update O2Switch account
adminRouter.put('/o2switch/accounts/:id', async (req: AuthRequest, res) => {
  try {
    const { hostname, username, apiToken, label, isActive } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (hostname !== undefined) { updates.push(`hostname = $${i++}`); values.push(hostname); }
    if (username !== undefined) { updates.push(`username = $${i++}`); values.push(username); }
    if (apiToken) { updates.push(`api_token_encrypted = $${i++}`); values.push(encrypt(apiToken)); }
    if (label !== undefined) { updates.push(`label = $${i++}`); values.push(label); }
    if (isActive !== undefined) { updates.push(`is_active = $${i++}`); values.push(isActive); }
    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE o2switch_accounts SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, hostname, username, label, is_active, last_sync, created_at`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte O2Switch non trouvé' });
    await addLog(req.userId, 'o2switch_account_updated', 'o2switch', req, { hostname, username }, 'o2switch_account', req.params.id);
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete O2Switch account
adminRouter.delete('/o2switch/accounts/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('DELETE FROM o2switch_accounts WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte non trouvé' });
    await addLog(req.userId, 'o2switch_account_deleted', 'o2switch', req, {}, 'o2switch_account', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: get O2Switch service instance from account ID
async function getO2SwitchService(accountId: string): Promise<O2SwitchService> {
  const result = await pool.query('SELECT * FROM o2switch_accounts WHERE id = $1', [accountId]);
  if (result.rows.length === 0) throw new Error('Compte O2Switch non trouvé');
  const acc = result.rows[0];
  return new O2SwitchService({
    apiToken: decrypt(acc.api_token_encrypted),
    hostname: acc.hostname,
    username: acc.username,
  });
}

// Test O2Switch connection
adminRouter.post('/o2switch/accounts/:id/test', async (req: AuthRequest, res) => {
  try {
    const service = await getO2SwitchService(req.params.id);
    const result = await service.testConnection();
    await addLog(req.userId, 'o2switch_connection_test', 'o2switch', req, result, 'o2switch_account', req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// List remote email accounts from O2Switch
adminRouter.get('/o2switch/accounts/:id/emails', async (req: AuthRequest, res) => {
  try {
    const service = await getO2SwitchService(req.params.id);
    const emails = await service.listEmailAccounts();

    // Get links to know which ones are linked locally
    const links = await pool.query(
      'SELECT remote_email, mail_account_id FROM o2switch_email_links WHERE o2switch_account_id = $1',
      [req.params.id]
    );
    const linkMap: Record<string, string> = {};
    for (const l of links.rows) linkMap[l.remote_email] = l.mail_account_id;

    const enriched = emails.map(e => ({ ...e, linkedMailAccountId: linkMap[e.email] || null }));
    res.json(enriched);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List O2Switch domains
adminRouter.get('/o2switch/accounts/:id/domains', async (req: AuthRequest, res) => {
  try {
    const service = await getO2SwitchService(req.params.id);
    const domains = await service.listDomains();
    res.json(domains);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create email on O2Switch
adminRouter.post('/o2switch/accounts/:id/emails', async (req: AuthRequest, res) => {
  try {
    const { email, password, quota } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email et password requis' });

    const service = await getO2SwitchService(req.params.id);
    await service.createEmailAccount(email, password, quota || 1024);

    await addLog(req.userId, 'o2switch_email_created', 'o2switch', req, { email }, 'o2switch_email', email);
    res.status(201).json({ success: true, email });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update email on O2Switch (password and/or quota)
adminRouter.put('/o2switch/accounts/:id/emails/:email', async (req: AuthRequest, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { password, quota } = req.body;

    const service = await getO2SwitchService(req.params.id);

    if (password) await service.changePassword(email, password);
    if (quota !== undefined) await service.changeQuota(email, quota);

    await addLog(req.userId, 'o2switch_email_updated', 'o2switch', req, { email, hasPassword: !!password, quota }, 'o2switch_email', email);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete email on O2Switch
adminRouter.delete('/o2switch/accounts/:id/emails/:email', async (req: AuthRequest, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const service = await getO2SwitchService(req.params.id);
    await service.deleteEmailAccount(email);

    // Remove any link
    await pool.query(
      'DELETE FROM o2switch_email_links WHERE o2switch_account_id = $1 AND remote_email = $2',
      [req.params.id, email]
    );

    await addLog(req.userId, 'o2switch_email_deleted', 'o2switch', req, { email }, 'o2switch_email', email);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sync O2Switch emails: import as local mail accounts
adminRouter.post('/o2switch/accounts/:id/sync', async (req: AuthRequest, res) => {
  try {
    const service = await getO2SwitchService(req.params.id);
    const remoteEmails = await service.listEmailAccounts();
    const o2account = (await pool.query('SELECT * FROM o2switch_accounts WHERE id = $1', [req.params.id])).rows[0];

    let created = 0;
    let skipped = 0;

    for (const remote of remoteEmails) {
      // Check if already linked
      const existing = await pool.query(
        'SELECT id FROM o2switch_email_links WHERE o2switch_account_id = $1 AND remote_email = $2',
        [req.params.id, remote.email]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Check if a local mail account already exists for this email
      const localExisting = await pool.query(
        'SELECT id FROM mail_accounts WHERE email = $1',
        [remote.email]
      );

      let mailAccountId = localExisting.rows[0]?.id || null;

      // No auto-creation of local accounts during sync — user needs to provide password
      // Just record the link with null mail_account_id
      await pool.query(
        `INSERT INTO o2switch_email_links (o2switch_account_id, remote_email, mail_account_id, auto_synced)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (o2switch_account_id, remote_email) DO UPDATE SET mail_account_id = $3, auto_synced = true`,
        [req.params.id, remote.email, mailAccountId]
      );

      created++;
    }

    // Update last_sync
    await pool.query('UPDATE o2switch_accounts SET last_sync = NOW() WHERE id = $1', [req.params.id]);
    await addLog(req.userId, 'o2switch_sync', 'o2switch', req, { created, skipped, total: remoteEmails.length }, 'o2switch_account', req.params.id);

    res.json({ success: true, created, skipped, total: remoteEmails.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Link an O2Switch email to a local mail account
adminRouter.post('/o2switch/accounts/:id/link', async (req: AuthRequest, res) => {
  try {
    const { remoteEmail, password, name, assignToUserIds, assignToGroupIds, autoSyncDav } = req.body;
    if (!remoteEmail || !password) return res.status(400).json({ error: 'remoteEmail et password requis' });

    const o2account = (await pool.query('SELECT * FROM o2switch_accounts WHERE id = $1', [req.params.id])).rows[0];
    if (!o2account) return res.status(404).json({ error: 'Compte O2Switch non trouvé' });

    const encryptedPassword = encrypt(password);

    // Create or update local mail account
    const existing = await pool.query('SELECT id FROM mail_accounts WHERE email = $1', [remoteEmail]);
    let mailAccountId: string;

    if (existing.rows.length > 0) {
      mailAccountId = existing.rows[0].id;
      await pool.query(
        `UPDATE mail_accounts SET imap_host = $1, smtp_host = $1, username = $2, password_encrypted = $3, is_shared = true, updated_at = NOW() WHERE id = $4`,
        [o2account.hostname, remoteEmail, encryptedPassword, mailAccountId]
      );
    } else {
      const result = await pool.query(
        `INSERT INTO mail_accounts (user_id, name, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, password_encrypted, is_shared)
         VALUES (NULL, $1, $2, $3, 993, true, $3, 465, true, $2, $4, true)
         RETURNING id`,
        [name || remoteEmail.split('@')[0], remoteEmail, o2account.hostname, encryptedPassword]
      );
      mailAccountId = result.rows[0].id;
    }

    // Update link
    await pool.query(
      `INSERT INTO o2switch_email_links (o2switch_account_id, remote_email, mail_account_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (o2switch_account_id, remote_email) DO UPDATE SET mail_account_id = $3`,
      [req.params.id, remoteEmail, mailAccountId]
    );

    // Auto-configure CalDAV + CardDAV for this o2switch mailbox (opt-in, default true).
    if (autoSyncDav !== false) {
      const cpanelHost = /o2switch\.net$/i.test(o2account.hostname) ? o2account.hostname : 'colorant.o2switch.net';
      const caldavUrl = `https://${cpanelHost}:2080/calendars/${remoteEmail}/calendar`;
      const carddavUrl = `https://${cpanelHost}:2080/addressbooks/${remoteEmail}/addressbook`;
      await pool.query(
        `UPDATE mail_accounts SET
           caldav_url = $1, caldav_username = $2, caldav_sync_enabled = true,
           carddav_url = $3, carddav_username = $2, carddav_sync_enabled = true,
           updated_at = NOW()
         WHERE id = $4`,
        [caldavUrl, remoteEmail, carddavUrl, mailAccountId]
      );

      // Initial background CalDAV pull for each assigned user (so calendars appear immediately).
      try {
        const { CalDAVService } = await import('../services/caldav');
        const svc = new CalDAVService({ baseUrl: caldavUrl, username: remoteEmail, password });
        for (const userId of (assignToUserIds || [])) {
          svc.syncForMailAccount(userId, mailAccountId)
            .catch(err => logger.error(err, `Initial CalDAV sync failed for user ${userId}`));
        }
      } catch (e) {
        logger.error(e as Error, 'CalDAV auto-sync bootstrap failed');
      }
    }

    // Assign to users
    if (assignToUserIds?.length) {
      for (const userId of assignToUserIds) {
        await pool.query(
          `INSERT INTO mailbox_assignments (mail_account_id, user_id, send_permission)
           VALUES ($1, $2, 'send_as')
           ON CONFLICT (mail_account_id, user_id) DO NOTHING`,
          [mailAccountId, userId]
        );
      }
    }

    // Assign to groups (assign to all members of those groups)
    if (assignToGroupIds?.length) {
      for (const groupId of assignToGroupIds) {
        const members = await pool.query('SELECT user_id FROM user_groups WHERE group_id = $1', [groupId]);
        for (const m of members.rows) {
          await pool.query(
            `INSERT INTO mailbox_assignments (mail_account_id, user_id, send_permission)
             VALUES ($1, $2, 'send_as')
             ON CONFLICT (mail_account_id, user_id) DO NOTHING`,
            [mailAccountId, m.user_id]
          );
        }
      }
    }

    await addLog(req.userId, 'o2switch_email_linked', 'o2switch', req, { remoteEmail, mailAccountId }, 'o2switch_email', remoteEmail);
    res.json({ success: true, mailAccountId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get O2Switch email links
adminRouter.get('/o2switch/accounts/:id/links', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, ma.name as account_name, ma.email as account_email
       FROM o2switch_email_links l
       LEFT JOIN mail_accounts ma ON ma.id = l.mail_account_id
       WHERE l.o2switch_account_id = $1
       ORDER BY l.remote_email`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// O2Switch disk usage
adminRouter.get('/o2switch/accounts/:id/disk', async (req: AuthRequest, res) => {
  try {
    const service = await getO2SwitchService(req.params.id);
    const disk = await service.getDiskUsage();
    res.json(disk);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});



// ========================================
// ---- Admin Calendars ----
// ========================================

// Permission levels (Outlook-like):
//   'none'       -> no access (row kept for explicit block)
//   'free_busy'  -> see only busy/free slots, no titles
//   'busy_title' -> see title + times only
//   'read'       -> read everything (details)
//   'write'      -> read + create/update/delete events
//   'owner'      -> full control (including sharing)
const VALID_CALENDAR_PERMISSIONS = ['none', 'free_busy', 'busy_title', 'read', 'write', 'owner'] as const;
type CalendarPermission = typeof VALID_CALENDAR_PERMISSIONS[number];

const calendarUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isVisible: z.boolean().optional(),
  isShared: z.boolean().optional(),
  userId: z.string().uuid().optional(), // re-assign to another owner
});

const calendarAssignmentSchema = z.object({
  userId: z.string().uuid(),
  permission: z.enum(VALID_CALENDAR_PERMISSIONS),
});

// List all calendars on the server (with owner + assignments)
adminRouter.get('/calendars', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.name, c.color, c.is_visible, c.is_default, c.is_shared,
             c.source, c.caldav_url, c.external_id, c.mail_account_id,
             c.created_at, c.updated_at,
             u.id as owner_id, u.email as owner_email, u.display_name as owner_display_name,
             ma.email as mail_account_email, ma.name as mail_account_name,
             (SELECT COUNT(*) FROM calendar_events ce WHERE ce.calendar_id = c.id) AS event_count,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'userId', sca.user_id,
                 'permission', sca.permission,
                 'email', au.email,
                 'displayName', au.display_name
               ))
                FROM shared_calendar_access sca
                JOIN users au ON au.id = sca.user_id
                WHERE sca.calendar_id = c.id),
               '[]'::json
             ) AS assignments
      FROM calendars c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN mail_accounts ma ON ma.id = c.mail_account_id
      ORDER BY u.email NULLS LAST, c.name ASC
    `);
    res.json(result.rows);
  } catch (error: any) {
    logger.error(error as Error, 'Admin list calendars failed');
    res.status(500).json({ error: error.message });
  }
});

// Update a calendar (name, color, visibility, re-assign owner)
adminRouter.put('/calendars/:id', async (req: AuthRequest, res) => {
  try {
    const data = calendarUpdateSchema.parse(req.body);
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (data.name !== undefined) { fields.push(`name = $${i++}`); values.push(data.name); }
    if (data.color !== undefined) { fields.push(`color = $${i++}`); values.push(data.color); }
    if (data.isVisible !== undefined) { fields.push(`is_visible = $${i++}`); values.push(data.isVisible); }
    if (data.isShared !== undefined) { fields.push(`is_shared = $${i++}`); values.push(data.isShared); }
    if (data.userId !== undefined) { fields.push(`user_id = $${i++}`); values.push(data.userId); }

    if (fields.length === 0) return res.status(400).json({ error: 'Aucune modification' });

    fields.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE calendars SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Calendrier introuvable' });

    await addLog(req.userId, 'calendar.update', 'calendars', req, { id: req.params.id, changes: data }, 'calendar', req.params.id);
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Données invalides', details: error.errors });
    res.status(500).json({ error: error.message });
  }
});

// Delete a calendar (admin override — cascades to events and assignments)
adminRouter.delete('/calendars/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('DELETE FROM calendars WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Calendrier introuvable' });
    await addLog(req.userId, 'calendar.delete', 'calendars', req, { id: req.params.id, name: result.rows[0].name }, 'calendar', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Calendar user assignments / sharing ----

// Upsert user access to a calendar
adminRouter.post('/calendars/:id/assignments', async (req: AuthRequest, res) => {
  try {
    const data = calendarAssignmentSchema.parse(req.body);

    // Ensure calendar exists
    const cal = await pool.query('SELECT id, user_id FROM calendars WHERE id = $1', [req.params.id]);
    if (cal.rows.length === 0) return res.status(404).json({ error: 'Calendrier introuvable' });

    if (data.userId === cal.rows[0].user_id) {
      return res.status(400).json({ error: 'Le propriétaire a déjà un accès complet' });
    }

    const result = await pool.query(
      `INSERT INTO shared_calendar_access (calendar_id, user_id, permission)
       VALUES ($1, $2, $3)
       ON CONFLICT (calendar_id, user_id) DO UPDATE SET permission = EXCLUDED.permission
       RETURNING *`,
      [req.params.id, data.userId, data.permission]
    );

    await pool.query('UPDATE calendars SET is_shared = true WHERE id = $1', [req.params.id]);
    await addLog(req.userId, 'calendar.share', 'calendars', req, { calendarId: req.params.id, ...data }, 'calendar', req.params.id);

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Permission invalide', details: error.errors });
    res.status(500).json({ error: error.message });
  }
});

// Update an existing assignment permission
adminRouter.put('/calendars/:id/assignments/:userId', async (req: AuthRequest, res) => {
  try {
    const permission: CalendarPermission = req.body.permission;
    if (!VALID_CALENDAR_PERMISSIONS.includes(permission)) {
      return res.status(400).json({ error: 'Permission invalide' });
    }
    const result = await pool.query(
      `UPDATE shared_calendar_access SET permission = $1
       WHERE calendar_id = $2 AND user_id = $3 RETURNING *`,
      [permission, req.params.id, req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Attribution introuvable' });
    await addLog(req.userId, 'calendar.share.update', 'calendars', req, { calendarId: req.params.id, userId: req.params.userId, permission }, 'calendar', req.params.id);
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove an assignment
adminRouter.delete('/calendars/:id/assignments/:userId', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM shared_calendar_access WHERE calendar_id = $1 AND user_id = $2 RETURNING calendar_id',
      [req.params.id, req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Attribution introuvable' });

    // If no more shares, unset is_shared
    const remaining = await pool.query('SELECT COUNT(*) FROM shared_calendar_access WHERE calendar_id = $1', [req.params.id]);
    if (parseInt(remaining.rows[0].count, 10) === 0) {
      await pool.query('UPDATE calendars SET is_shared = false WHERE id = $1', [req.params.id]);
    }

    await addLog(req.userId, 'calendar.share.remove', 'calendars', req, { calendarId: req.params.id, userId: req.params.userId }, 'calendar', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Backup / Restore / Export ----

// Export a single calendar as a standards-compliant .ics file
adminRouter.get('/calendars/:id/export.ics', async (req: AuthRequest, res) => {
  try {
    const cal = await pool.query('SELECT id, name FROM calendars WHERE id = $1', [req.params.id]);
    if (cal.rows.length === 0) return res.status(404).json({ error: 'Calendrier introuvable' });

    const events = await pool.query(
      `SELECT id, title, description, location, start_date, end_date, all_day,
              recurrence_rule, ical_uid, ical_data, status, attendees, organizer
       FROM calendar_events WHERE calendar_id = $1 ORDER BY start_date ASC`,
      [req.params.id]
    );

    const ics = buildIcs(cal.rows[0].name, events.rows);
    const safeName = String(cal.rows[0].name).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64) || 'calendar';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.ics"`);
    res.send(ics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Full JSON backup of ALL calendars + events + shares
// Purpose: off-site rescue. Can be re-imported via /admin/calendars/restore.
adminRouter.get('/calendars/backup', async (req: AuthRequest, res) => {
  try {
    const calendars = await pool.query(`
      SELECT c.*, u.email as owner_email
      FROM calendars c
      LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at ASC
    `);
    const events = await pool.query('SELECT * FROM calendar_events ORDER BY calendar_id, start_date');
    const shares = await pool.query(`
      SELECT sca.*, u.email as user_email
      FROM shared_calendar_access sca
      JOIN users u ON u.id = sca.user_id
    `);

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      calendars: calendars.rows,
      events: events.rows,
      shares: shares.rows,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="calendars-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    await addLog(req.userId, 'calendar.backup', 'calendars', req, { calendars: calendars.rows.length, events: events.rows.length });
    res.json(payload);
  } catch (error: any) {
    logger.error(error as Error, 'Calendar backup failed');
    res.status(500).json({ error: error.message });
  }
});

// Restore from a JSON backup produced by /admin/calendars/backup
// strategy: 'merge' (default, upsert by id) | 'replace' (delete all first)
adminRouter.post('/calendars/restore', async (req: AuthRequest, res) => {
  const client = await pool.connect();
  try {
    const { payload, strategy = 'merge' } = req.body || {};
    if (!payload || !Array.isArray(payload.calendars)) {
      return res.status(400).json({ error: 'Format de sauvegarde invalide' });
    }
    if (strategy !== 'merge' && strategy !== 'replace') {
      return res.status(400).json({ error: 'Stratégie invalide' });
    }

    await client.query('BEGIN');

    if (strategy === 'replace') {
      // Only wipe user calendars (not the system/default ones already present)
      await client.query('DELETE FROM calendar_events');
      await client.query('DELETE FROM shared_calendar_access');
      await client.query('DELETE FROM calendars');
    }

    let calCount = 0, evCount = 0, shareCount = 0;

    for (const c of payload.calendars) {
      // Resolve owner via email if id no longer matches
      let userId = c.user_id;
      if (c.owner_email) {
        const u = await client.query('SELECT id FROM users WHERE email = $1', [c.owner_email]);
        if (u.rows[0]) userId = u.rows[0].id;
      }
      if (!userId) continue;

      await client.query(
        `INSERT INTO calendars (id, user_id, name, color, is_visible, is_default, is_shared, source, caldav_url, external_id, sync_token, mail_account_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, color = EXCLUDED.color, is_visible = EXCLUDED.is_visible,
           is_shared = EXCLUDED.is_shared, source = EXCLUDED.source, caldav_url = EXCLUDED.caldav_url,
           external_id = EXCLUDED.external_id, updated_at = NOW()`,
        [c.id, userId, c.name, c.color, c.is_visible, c.is_default, c.is_shared, c.source || 'local',
         c.caldav_url, c.external_id, c.sync_token, c.mail_account_id, c.created_at, c.updated_at]
      );
      calCount++;
    }

    if (Array.isArray(payload.events)) {
      for (const e of payload.events) {
        await client.query(
          `INSERT INTO calendar_events (id, calendar_id, title, description, location, start_date, end_date, all_day, recurrence_rule, reminder_minutes, attendees, organizer, status, ical_uid, ical_data, is_recurring, external_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title, description = EXCLUDED.description, location = EXCLUDED.location,
             start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, all_day = EXCLUDED.all_day,
             recurrence_rule = EXCLUDED.recurrence_rule, attendees = EXCLUDED.attendees,
             status = EXCLUDED.status, ical_data = EXCLUDED.ical_data, updated_at = NOW()`,
          [e.id, e.calendar_id, e.title, e.description, e.location, e.start_date, e.end_date, e.all_day,
           e.recurrence_rule, e.reminder_minutes, e.attendees, e.organizer, e.status, e.ical_uid, e.ical_data,
           e.is_recurring, e.external_id, e.created_at, e.updated_at]
        );
        evCount++;
      }
    }

    if (Array.isArray(payload.shares)) {
      for (const s of payload.shares) {
        let uId = s.user_id;
        if (s.user_email) {
          const u = await client.query('SELECT id FROM users WHERE email = $1', [s.user_email]);
          if (u.rows[0]) uId = u.rows[0].id;
        }
        if (!uId) continue;
        await client.query(
          `INSERT INTO shared_calendar_access (calendar_id, user_id, permission)
           VALUES ($1,$2,$3)
           ON CONFLICT (calendar_id, user_id) DO UPDATE SET permission = EXCLUDED.permission`,
          [s.calendar_id, uId, s.permission || 'read']
        );
        shareCount++;
      }
    }

    await client.query('COMMIT');
    await addLog(req.userId, 'calendar.restore', 'calendars', req, { calendars: calCount, events: evCount, shares: shareCount, strategy });
    res.json({ ok: true, calendars: calCount, events: evCount, shares: shareCount });
  } catch (error: any) {
    await client.query('ROLLBACK');
    logger.error(error as Error, 'Calendar restore failed');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Push a calendar's events back to a remote CalDAV server (off-site rescue copy).
// Requires the target account to have caldav_url set. Creates a dedicated "Sauvegarde"
// collection-level .ics upload via PUT on a single file (basic safeguard copy).
adminRouter.post('/calendars/:id/push-to-caldav', async (req: AuthRequest, res) => {
  try {
    const { mailAccountId } = req.body || {};
    if (!mailAccountId) return res.status(400).json({ error: 'mailAccountId requis' });

    const cal = await pool.query('SELECT id, name FROM calendars WHERE id = $1', [req.params.id]);
    if (cal.rows.length === 0) return res.status(404).json({ error: 'Calendrier introuvable' });

    const acc = await pool.query(
      'SELECT caldav_url, caldav_username, username, password_encrypted FROM mail_accounts WHERE id = $1',
      [mailAccountId]
    );
    if (acc.rows.length === 0) return res.status(404).json({ error: 'Compte mail introuvable' });
    if (!acc.rows[0].caldav_url) return res.status(400).json({ error: 'CalDAV non configuré sur ce compte' });

    const events = await pool.query(
      `SELECT id, title, description, location, start_date, end_date, all_day,
              recurrence_rule, ical_uid, ical_data, status, attendees, organizer
       FROM calendar_events WHERE calendar_id = $1`,
      [req.params.id]
    );
    const ics = buildIcs(cal.rows[0].name, events.rows);

    const user = acc.rows[0].caldav_username || acc.rows[0].username;
    const password = decrypt(acc.rows[0].password_encrypted);
    const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

    const baseUrl = acc.rows[0].caldav_url.endsWith('/') ? acc.rows[0].caldav_url : acc.rows[0].caldav_url + '/';
    const target = `${baseUrl}backup-${req.params.id}.ics`;

    const r = await fetch(target, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/calendar; charset=utf-8' },
      body: ics,
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: `CalDAV PUT a échoué: ${r.status}`, details: text.slice(0, 300) });
    }

    await addLog(req.userId, 'calendar.push_remote', 'calendars', req, { calendarId: req.params.id, mailAccountId, url: target });
    res.json({ ok: true, url: target, events: events.rows.length });
  } catch (error: any) {
    logger.error(error as Error, 'Calendar push-to-caldav failed');
    res.status(500).json({ error: error.message });
  }
});
