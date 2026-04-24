import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { encrypt } from '../utils/encryption';
import { z } from 'zod';
import { logger } from '../utils/logger';

export const accountRouter = Router();

const accountSchema = z.object({
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
  isDefault: z.boolean().default(false),
  signatureHtml: z.string().optional(),
  signatureText: z.string().optional(),
  color: z.string().default('#0078D4'),
  // Auto-configure CalDAV + CardDAV for o2switch cPanel hosts (https://<host>:2080/...).
  o2switchAutoSync: z.boolean().optional(),
});

/** Build default o2switch CalDAV/CardDAV collection URLs. */
function o2switchUrls(email: string, host?: string): { caldav: string; carddav: string } {
  const cpanelHost =
    host && /o2switch\.net$/i.test(host) ? host : 'colorant.o2switch.net';
  return {
    caldav: `https://${cpanelHost}:2080/calendars/${email}/calendar`,
    carddav: `https://${cpanelHost}:2080/addressbooks/${email}/addressbook`,
  };
}

// List accounts (via assignments + direct ownership)
accountRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT ma.id, ma.name, ma.email, ma.imap_host, ma.imap_port, ma.smtp_host, ma.smtp_port,
              ma.is_default, ma.is_shared, ma.signature_html, ma.signature_text, ma.color,
              ma.sync_interval, ma.last_sync, ma.created_at,
              mba.display_name as assigned_display_name, mba.send_permission, mba.is_default as assigned_default
       FROM mail_accounts ma
       JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id
       WHERE mba.user_id = $1
       UNION
       SELECT ma.id, ma.name, ma.email, ma.imap_host, ma.imap_port, ma.smtp_host, ma.smtp_port,
              ma.is_default, ma.is_shared, ma.signature_html, ma.signature_text, ma.color,
              ma.sync_interval, ma.last_sync, ma.created_at,
              NULL as assigned_display_name, 'send_as' as send_permission, ma.is_default as assigned_default
       FROM mail_accounts ma
       WHERE ma.user_id = $1
         AND NOT EXISTS (SELECT 1 FROM mailbox_assignments mba2 WHERE mba2.mail_account_id = ma.id AND mba2.user_id = $1)
       ORDER BY assigned_default DESC, created_at ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create account
accountRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const data = accountSchema.parse(req.body);
    const encryptedPassword = encrypt(data.password);

    // If setting as default, unset other defaults
    if (data.isDefault) {
      await pool.query('UPDATE mail_accounts SET is_default = false WHERE user_id = $1', [req.userId]);
    }

    const result = await pool.query(
      `INSERT INTO mail_accounts (user_id, name, email, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, password_encrypted, is_default, signature_html, signature_text, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, name, email, imap_host, imap_port, smtp_host, smtp_port, is_default, color`,
      [req.userId, data.name, data.email, data.imapHost, data.imapPort, data.imapSecure, data.smtpHost, data.smtpPort, data.smtpSecure, data.username, encryptedPassword, data.isDefault, data.signatureHtml, data.signatureText, data.color]
    );

    const accountId: string = result.rows[0].id;

    // O2switch auto-configuration: pre-fill CalDAV + CardDAV URLs.
    // CalDAV sync is intentionally LEFT DISABLED here: when the user is
    // also provisioned on NextCloud (which is the recommended setup, and
    // the case for o2switch tenants), the NextCloud sync already imports
    // the same collections. Enabling both creates duplicate calendar rows
    // (one source='caldav', one source='nextcloud') for the same href and
    // duplicates every event. The user can re-enable CalDAV sync from the
    // sync dialog if they don't use NextCloud.
    const isO2switch = data.o2switchAutoSync === true || /\.o2switch\.net$/i.test(data.imapHost);
    if (isO2switch) {
      const urls = o2switchUrls(data.email, data.imapHost);
      await pool.query(
        `UPDATE mail_accounts SET
           caldav_url = $1, caldav_username = $2, caldav_sync_enabled = false,
           carddav_url = $3, carddav_username = $2,  carddav_sync_enabled = true,
           updated_at = NOW()
         WHERE id = $4`,
        [urls.caldav, data.email, urls.carddav, accountId]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update account
accountRouter.put('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    // Verify ownership
    const check = await pool.query('SELECT id FROM mail_accounts WHERE id = $1 AND user_id = $2', [id, req.userId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Compte non trouvé' });

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fields: Record<string, string> = {
      name: 'name', email: 'email', imapHost: 'imap_host', imapPort: 'imap_port',
      smtpHost: 'smtp_host', smtpPort: 'smtp_port', signatureHtml: 'signature_html',
      signatureText: 'signature_text', color: 'color', syncInterval: 'sync_interval',
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

    if (data.isDefault) {
      await pool.query('UPDATE mail_accounts SET is_default = false WHERE user_id = $1', [req.userId]);
      updates.push(`is_default = $${paramIndex++}`);
      values.push(true);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE mail_accounts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete account
accountRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM mail_accounts WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Compte non trouvé' });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test account connection
accountRouter.post('/:id/test', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { MailService } = await import('../services/mail');
    
    const result = await pool.query(
      'SELECT * FROM mail_accounts WHERE id = $1 AND user_id = $2',
      [id, req.userId]
    );
    
    if (result.rows.length === 0) return res.status(404).json({ error: 'Compte non trouvé' });

    const account = result.rows[0];
    const { decrypt } = await import('../utils/encryption');
    let password = '';
    let accessToken: string | undefined;
    if (account.oauth_provider) {
      const { ensureFreshAccessToken } = await import('../services/oauth');
      accessToken = (await ensureFreshAccessToken(account)) || undefined;
    } else {
      password = decrypt(account.password_encrypted);
    }

    const mailService = new MailService({
      ...account,
      username: account.username || account.email,
      password,
      access_token: accessToken,
    });

    const folders = await mailService.getFolders();
    res.json({ success: true, folders: folders.length });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
