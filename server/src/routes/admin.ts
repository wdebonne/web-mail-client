import { Router } from 'express';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { encrypt } from '../utils/encryption';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

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
      `SELECT ma.id, ma.name, ma.email, ma.imap_host, ma.imap_port, ma.smtp_host, ma.smtp_port,
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
