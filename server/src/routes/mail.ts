import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MailService } from '../services/mail';
import { pool } from '../database/connection';
import { encrypt, decrypt } from '../utils/encryption';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

export const mailRouter = Router();

// Get folders for an account
mailRouter.get('/accounts/:accountId/folders', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    const folders = await mailService.getFolders();
    res.json(folders);
  } catch (error: any) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: error.message || 'Erreur de récupération des dossiers' });
  }
});

// Get messages from a folder
mailRouter.get('/accounts/:accountId/messages', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const folder = (req.query.folder as string) || 'INBOX';
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    const messages = await mailService.getMessages(folder, page, limit);

    // Cache messages for offline use
    await cacheMessages(accountId, folder, messages.messages);

    res.json(messages);
  } catch (error: any) {
    // Fallback to cached messages if IMAP fails
    try {
      const { accountId } = req.params;
      const folder = (req.query.folder as string) || 'INBOX';
      const cached = await getCachedMessages(accountId, folder);
      res.json({ messages: cached, fromCache: true });
    } catch {
      res.status(500).json({ error: error.message || 'Erreur de récupération des messages' });
    }
  }
});

// Get a single message
mailRouter.get('/accounts/:accountId/messages/:uid', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const folder = (req.query.folder as string) || 'INBOX';

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    const message = await mailService.getMessage(folder, parseInt(uid));

    res.json(message);
  } catch (error: any) {
    // Fallback to cache
    try {
      const { accountId, uid } = req.params;
      const cached = await pool.query(
        'SELECT * FROM cached_emails WHERE account_id = $1 AND uid = $2',
        [accountId, parseInt(uid)]
      );
      if (cached.rows.length > 0) {
        return res.json({ ...cached.rows[0], fromCache: true });
      }
    } catch {}
    res.status(500).json({ error: error.message || 'Erreur de récupération du message' });
  }
});

// Send an email
mailRouter.post('/send', async (req: AuthRequest, res) => {
  try {
    const sendSchema = z.object({
      accountId: z.string().uuid(),
      to: z.array(z.object({ email: z.string().email(), name: z.string().optional() })),
      cc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
      bcc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
      subject: z.string(),
      bodyHtml: z.string(),
      bodyText: z.string().optional(),
      attachments: z.array(z.any()).optional(),
      inReplyTo: z.string().optional(),
      references: z.string().optional(),
    });

    const data = sendSchema.parse(req.body);
    const account = await getAccountForUser(data.accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    // Check send permission
    if (account.send_permission === 'none') {
      return res.status(403).json({ error: 'Vous n\'avez pas la permission d\'envoyer depuis ce compte' });
    }

    // Sanitize HTML
    const cleanHtml = sanitizeHtml(data.bodyHtml, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'style', 'span', 'div', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th']),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        '*': ['style', 'class'],
        img: ['src', 'alt', 'width', 'height'],
        a: ['href', 'target', 'rel'],
      },
    });

    // Get sender info for "send on behalf of"
    let fromOptions: { email: string; name: string };
    let senderOptions: { email: string; name: string } | undefined;

    if (account.send_permission === 'send_on_behalf') {
      // Get user display name
      const userResult = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.userId]);
      const user = userResult.rows[0];
      const userName = user?.display_name || user?.email || '';

      fromOptions = { email: account.email, name: `${userName} de la part de ${account.name}` };
      senderOptions = { email: user?.email || account.email, name: userName };
    } else {
      // send_as: send directly as the account
      fromOptions = { email: account.email, name: account.name };
    }

    const mailService = new MailService(account);
    const result = await mailService.sendMail({
      from: fromOptions,
      sender: senderOptions,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      html: cleanHtml,
      text: data.bodyText,
      attachments: data.attachments,
      inReplyTo: data.inReplyTo,
      references: data.references,
    });

    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    console.error('Send mail error:', error);
    res.status(500).json({ error: error.message || 'Erreur d\'envoi' });
  }
});

// Save to outbox (for offline sending)
mailRouter.post('/outbox', async (req: AuthRequest, res) => {
  try {
    const { accountId, to, cc, bcc, subject, bodyHtml, bodyText, attachments } = req.body;

    const result = await pool.query(
      `INSERT INTO outbox (user_id, account_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, body_text, attachments, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING id`,
      [req.userId, accountId, JSON.stringify(to), JSON.stringify(cc), JSON.stringify(bcc), subject, bodyHtml, bodyText, JSON.stringify(attachments)]
    );

    res.json({ id: result.rows[0].id, status: 'pending' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Process outbox (send pending messages)
mailRouter.post('/outbox/process', async (req: AuthRequest, res) => {
  try {
    const pending = await pool.query(
      'SELECT * FROM outbox WHERE user_id = $1 AND status = $2',
      [req.userId, 'pending']
    );

    const results = [];
    for (const msg of pending.rows) {
      try {
        const account = await getAccountForUser(msg.account_id, req.userId!);
        if (!account) continue;
        if (account.send_permission === 'none') continue;

        let fromOptions: { email: string; name: string };
        let senderOptions: { email: string; name: string } | undefined;

        if (account.send_permission === 'send_on_behalf') {
          const userResult = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.userId]);
          const user = userResult.rows[0];
          const userName = user?.display_name || user?.email || '';
          fromOptions = { email: account.email, name: `${userName} de la part de ${account.name}` };
          senderOptions = { email: user?.email || account.email, name: userName };
        } else {
          fromOptions = { email: account.email, name: account.name };
        }

        const mailService = new MailService(account);
        await mailService.sendMail({
          from: fromOptions,
          sender: senderOptions,
          to: msg.to_addresses,
          cc: msg.cc_addresses,
          bcc: msg.bcc_addresses,
          subject: msg.subject,
          html: msg.body_html,
          text: msg.body_text,
          attachments: msg.attachments,
        });

        await pool.query('UPDATE outbox SET status = $1 WHERE id = $2', ['sent', msg.id]);
        results.push({ id: msg.id, status: 'sent' });
      } catch (error: any) {
        await pool.query('UPDATE outbox SET status = $1, error = $2 WHERE id = $3', ['error', error.message, msg.id]);
        results.push({ id: msg.id, status: 'error', error: error.message });
      }
    }

    res.json({ processed: results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mark message as read/unread
mailRouter.patch('/accounts/:accountId/messages/:uid/read', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const { isRead } = req.body;
    const folder = (req.query.folder as string) || 'INBOX';

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.setFlags(folder, parseInt(uid), { seen: isRead });

    // Update cache
    await pool.query(
      'UPDATE cached_emails SET is_read = $1 WHERE account_id = $2 AND uid = $3 AND folder = $4',
      [isRead, accountId, parseInt(uid), folder]
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Flag/unflag message
mailRouter.patch('/accounts/:accountId/messages/:uid/flag', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const { isFlagged } = req.body;
    const folder = (req.query.folder as string) || 'INBOX';

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.setFlags(folder, parseInt(uid), { flagged: isFlagged });

    await pool.query(
      'UPDATE cached_emails SET is_flagged = $1 WHERE account_id = $2 AND uid = $3 AND folder = $4',
      [isFlagged, accountId, parseInt(uid), folder]
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Move message
mailRouter.post('/accounts/:accountId/messages/:uid/move', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const { fromFolder, toFolder } = req.body;

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.moveMessage(fromFolder, parseInt(uid), toFolder);

    // Update cache
    await pool.query(
      'DELETE FROM cached_emails WHERE account_id = $1 AND uid = $2 AND folder = $3',
      [accountId, parseInt(uid), fromFolder]
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete message
mailRouter.delete('/accounts/:accountId/messages/:uid', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const folder = (req.query.folder as string) || 'INBOX';

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.deleteMessage(folder, parseInt(uid));

    await pool.query(
      'DELETE FROM cached_emails WHERE account_id = $1 AND uid = $2 AND folder = $3',
      [accountId, parseInt(uid), folder]
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper functions
async function getAccountForUser(accountId: string, userId: string) {
  // Check via mailbox_assignments first
  let result = await pool.query(
    `SELECT ma.*, mba.send_permission, mba.display_name as assigned_display_name
     FROM mail_accounts ma
     JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id
     WHERE ma.id = $1 AND mba.user_id = $2`,
    [accountId, userId]
  );

  // Fallback: check direct ownership
  if (result.rows.length === 0) {
    result = await pool.query(
      'SELECT *, \'send_as\' as send_permission, NULL as assigned_display_name FROM mail_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );
  }

  // Fallback: check shared_mailbox_access (legacy)
  if (result.rows.length === 0) {
    result = await pool.query(
      `SELECT ma.*, 'none' as send_permission, NULL as assigned_display_name 
       FROM mail_accounts ma 
       JOIN shared_mailbox_access sma ON sma.mail_account_id = ma.id 
       WHERE ma.id = $1 AND sma.user_id = $2`,
      [accountId, userId]
    );
  }

  if (result.rows.length === 0) return null;

  const account = result.rows[0];
  return {
    ...account,
    password: decrypt(account.password_encrypted),
  };
}

async function cacheMessages(accountId: string, folder: string, messages: any[]) {
  for (const msg of messages) {
    await pool.query(
      `INSERT INTO cached_emails (account_id, message_id, uid, folder, subject, from_address, from_name, to_addresses, cc_addresses, date, snippet, is_read, is_flagged, has_attachments, attachments, size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT DO NOTHING`,
      [accountId, msg.messageId, msg.uid, folder, msg.subject, msg.from?.address, msg.from?.name, JSON.stringify(msg.to), JSON.stringify(msg.cc), msg.date, msg.snippet, msg.flags?.seen, msg.flags?.flagged, msg.hasAttachments, JSON.stringify(msg.attachments), msg.size]
    );
  }
}

async function getCachedMessages(accountId: string, folder: string) {
  const result = await pool.query(
    'SELECT * FROM cached_emails WHERE account_id = $1 AND folder = $2 ORDER BY date DESC LIMIT 100',
    [accountId, folder]
  );
  return result.rows;
}
