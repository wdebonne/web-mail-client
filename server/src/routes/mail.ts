import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MailService } from '../services/mail';
import { pool } from '../database/connection';
import { encrypt, decrypt } from '../utils/encryption';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { logger } from '../utils/logger';

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

// Statut (compteurs) de tous les dossiers d'un compte — utilisé pour
// afficher le nombre de mails non lus à côté du nom du dossier.
// Mis en cache 20 s par utilisateur+compte pour limiter les commandes IMAP STATUS.
// Quand l'authentification IMAP échoue (token OAuth expiré, mot de passe
// changé, etc.), on renvoie un objet vide avec un cache plus long pour ne pas
// marteler le serveur IMAP toutes les 30 s.
const folderStatusCache = new Map<string, { value: Record<string, { messages: number; unseen: number; recent: number }>; at: number; failed?: boolean }>();
const FOLDER_STATUS_TTL_MS = 20_000;
const FOLDER_STATUS_FAIL_TTL_MS = 5 * 60_000;

mailRouter.get('/accounts/:accountId/folders/status', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const cacheKey = `${req.userId}:${accountId}`;
    const force = String(req.query.refresh || '') === '1';
    const cached = folderStatusCache.get(cacheKey);
    const ttl = cached?.failed ? FOLDER_STATUS_FAIL_TTL_MS : FOLDER_STATUS_TTL_MS;
    if (!force && cached && Date.now() - cached.at < ttl) {
      return res.json({ folders: cached.value, cached: true, failed: !!cached.failed });
    }

    const mailService = new MailService(account);
    try {
      const status = await mailService.getFoldersStatus();
      folderStatusCache.set(cacheKey, { value: status, at: Date.now() });
      res.json({ folders: status, cached: false });
    } catch (imapError: any) {
      // Auth failures (OAuth token expired, wrong password) and other IMAP
      // command errors must not flood the logs nor become 500s — counters are
      // a non-critical UI affordance. Cache an empty result for a few minutes.
      const isAuthFailure = !!imapError?.authenticationFailed
        || imapError?.responseStatus === 'NO'
        || /AUTHENTICATE failed/i.test(String(imapError?.responseText || imapError?.message || ''));
      folderStatusCache.set(cacheKey, { value: {}, at: Date.now(), failed: true });
      if (!isAuthFailure) {
        logger.warn({ err: imapError, accountId }, 'folder-status: IMAP error');
      }
      res.json({ folders: {}, cached: false, failed: true, reason: isAuthFailure ? 'auth' : 'imap' });
    }
  } catch (error: any) {
    console.error('Get folder status error:', error);
    res.status(500).json({ error: error.message || 'Erreur de récupération du statut' });
  }
});

// Create a folder
mailRouter.post('/accounts/:accountId/folders', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const { path } = z.object({ path: z.string().min(1).max(200) }).parse(req.body);
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.createFolder(path);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Nom de dossier invalide' });
    }
    console.error('Create folder error:', error);
    res.status(500).json({ error: error.message || 'Erreur de création du dossier' });
  }
});

// Rename a folder
mailRouter.patch('/accounts/:accountId/folders', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const { oldPath, newPath } = z.object({
      oldPath: z.string().min(1),
      newPath: z.string().min(1).max(200),
    }).parse(req.body);
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.renameFolder(oldPath, newPath);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides' });
    }
    console.error('Rename folder error:', error);
    res.status(500).json({ error: error.message || 'Erreur de renommage du dossier' });
  }
});

// Delete a folder
mailRouter.delete('/accounts/:accountId/folders', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const { path } = z.object({ path: z.string().min(1) }).parse(req.body);
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.deleteFolder(path);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides' });
    }
    console.error('Delete folder error:', error);
    res.status(500).json({ error: error.message || 'Erreur de suppression du dossier' });
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
      /** UID of the original message (same account) that this reply answers. When provided together
       *  with `inReplyToFolder`, the server will flag it as `\Answered` via IMAP after a successful send. */
      inReplyToUid: z.number().int().optional(),
      inReplyToFolder: z.string().optional(),
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
    let replyToOptions: { email: string; name?: string } | undefined;

    if (account.send_permission === 'send_on_behalf') {
      // Get user display name
      const userResult = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.userId]);
      const user = userResult.rows[0];
      const userName = user?.display_name || user?.email || '';
      const userEmail = user?.email || '';

      const fromDomain = (account.email.split('@')[1] || '').toLowerCase();
      const userDomain = (userEmail.split('@')[1] || '').toLowerCase();
      const sameDomain = !!fromDomain && fromDomain === userDomain;

      // Display the delegating user in From name while keeping mailbox email identity.
      fromOptions = { email: account.email, name: userName || account.assigned_display_name || account.name };
      if (sameDomain && userEmail) {
        // Safe for most receivers when domains align.
        senderOptions = { email: userEmail, name: userName };
      } else if (userEmail && userEmail !== account.email) {
        // Cross-domain Sender is often spam-scored; prefer Reply-To.
        replyToOptions = { email: userEmail, name: userName };
      }
    } else {
      // send_as: send directly as the account
      fromOptions = { email: account.email, name: account.assigned_display_name || account.name };
    }

    const mailService = new MailService(account);
    const result = await mailService.sendMail({
      from: fromOptions,
      sender: senderOptions,
      replyTo: replyToOptions,
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

    // If this was a reply, flag the original message as \Answered on the IMAP server so the
    // « répondu » indicator appears immediately in the list. Silent on failure — the mail
    // itself was sent successfully.
    if (data.inReplyToUid && data.inReplyToFolder) {
      try {
        await mailService.setFlags(data.inReplyToFolder, data.inReplyToUid, { answered: true });
      } catch (err: any) {
        logger.warn(`Unable to flag original message as answered (uid=${data.inReplyToUid}, folder=${data.inReplyToFolder}): ${err?.message || err}`);
      }
    }

    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    console.error('Send mail error:', error);
    res.status(500).json({ error: error.message || 'Erreur d\'envoi' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /send-raw — relay a pre-built RFC 822 MIME payload. Used by S/MIME and
// PGP/MIME composition flows which build the entire MIME tree client-side.
// The server only needs the SMTP envelope (MAIL FROM / RCPT TO) and forwards
// the raw bytes without parsing, sanitizing, or rewriting any header.
// ─────────────────────────────────────────────────────────────────────────────
mailRouter.post('/send-raw', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      accountId: z.string().uuid(),
      to: z.array(z.object({ email: z.string().email(), name: z.string().optional() })),
      cc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
      bcc: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
      rawMime: z.string().min(10),
      inReplyToUid: z.number().int().optional(),
      inReplyToFolder: z.string().optional(),
    });
    const data = schema.parse(req.body);
    const account = await getAccountForUser(data.accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });
    if (account.send_permission === 'none') {
      return res.status(403).json({ error: 'Vous n\'avez pas la permission d\'envoyer depuis ce compte' });
    }

    const mailService = new MailService(account);
    const result = await mailService.sendRaw({
      rawMime: data.rawMime,
      envelopeFrom: account.email,
      envelopeTo: data.to.map(r => r.email),
      envelopeCc: (data.cc || []).map(r => r.email),
      envelopeBcc: (data.bcc || []).map(r => r.email),
    });

    if (data.inReplyToUid && data.inReplyToFolder) {
      try {
        await mailService.setFlags(data.inReplyToFolder, data.inReplyToUid, { answered: true });
      } catch (err: any) {
        logger.warn(`Unable to flag original message as answered (uid=${data.inReplyToUid}): ${err?.message || err}`);
      }
    }

    res.json({ success: true, messageId: result.messageId });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    console.error('Send raw mail error:', error);
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
        let replyToOptions: { email: string; name?: string } | undefined;

        if (account.send_permission === 'send_on_behalf') {
          const userResult = await pool.query('SELECT display_name, email FROM users WHERE id = $1', [req.userId]);
          const user = userResult.rows[0];
          const userName = user?.display_name || user?.email || '';
          const userEmail = user?.email || '';
          const fromDomain = (account.email.split('@')[1] || '').toLowerCase();
          const userDomain = (userEmail.split('@')[1] || '').toLowerCase();
          const sameDomain = !!fromDomain && fromDomain === userDomain;

          fromOptions = { email: account.email, name: userName || account.assigned_display_name || account.name };
          if (sameDomain && userEmail) {
            senderOptions = { email: userEmail, name: userName };
          } else if (userEmail && userEmail !== account.email) {
            replyToOptions = { email: userEmail, name: userName };
          }
        } else {
          fromOptions = { email: account.email, name: account.assigned_display_name || account.name };
        }

        const mailService = new MailService(account);
        await mailService.sendMail({
          from: fromOptions,
          sender: senderOptions,
          replyTo: replyToOptions,
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

    if (!fromFolder || !toFolder) {
      return res.status(400).json({ error: 'fromFolder et toFolder sont requis' });
    }

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
    console.error('[mail] Move error', {
      accountId: req.params.accountId,
      uid: req.params.uid,
      fromFolder: req.body?.fromFolder,
      toFolder: req.body?.toFolder,
      message: error?.message,
      code: error?.code,
      response: error?.response,
    });
    res.status(500).json({
      error: error?.message || 'Erreur lors du déplacement du message',
    });
  }
});

// Copy message
mailRouter.post('/accounts/:accountId/messages/:uid/copy', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const { fromFolder, toFolder } = req.body;

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const mailService = new MailService(account);
    await mailService.copyMessage(fromFolder, parseInt(uid), toFolder);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Archive message into a dated subfolder tree (e.g. Archives/2026/04 - Avril).
// Uses admin settings for the root folder and subfolder pattern; safe defaults
// are used when settings are not configured.
mailRouter.post('/accounts/:accountId/messages/:uid/archive', async (req: AuthRequest, res) => {
  try {
    const { accountId, uid } = req.params;
    const { fromFolder } = z.object({ fromFolder: z.string().min(1) }).parse(req.body || {});

    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const settingsRes = await pool.query(
      `SELECT key, value FROM admin_settings
       WHERE key IN ('archive_root_folder', 'archive_subfolder_pattern')`
    );
    const settings: Record<string, any> = {};
    for (const row of settingsRes.rows) settings[row.key] = row.value;

    const rootFolder = typeof settings.archive_root_folder === 'string' && settings.archive_root_folder.trim()
      ? settings.archive_root_folder.trim()
      : 'Archives';
    const subfolderPattern = typeof settings.archive_subfolder_pattern === 'string' && settings.archive_subfolder_pattern.trim()
      ? settings.archive_subfolder_pattern.trim()
      : '{YYYY}/{MM} - {MMMM}';

    const mailService = new MailService(account);
    const { destFolder } = await mailService.archiveMessage(
      fromFolder,
      parseInt(uid),
      rootFolder,
      subfolderPattern,
    );

    await pool.query(
      'DELETE FROM cached_emails WHERE account_id = $1 AND uid = $2 AND folder = $3',
      [accountId, parseInt(uid), fromFolder]
    );

    res.json({ success: true, destFolder });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides' });
    }
    console.error('Archive error:', error);
    res.status(500).json({ error: error.message || 'Erreur d\'archivage' });
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

// --- Cross-account operations ---

// Copy/move a single message from one account to another (or within the same account).
// POST /mail/messages/transfer
mailRouter.post('/messages/transfer', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      srcAccountId: z.string().uuid(),
      srcFolder: z.string().min(1),
      uid: z.number().int().positive(),
      destAccountId: z.string().uuid(),
      destFolder: z.string().min(1),
      mode: z.enum(['copy', 'move']).default('copy'),
    });
    const data = schema.parse(req.body);

    const srcAccount = await getAccountForUser(data.srcAccountId, req.userId!);
    const destAccount = await getAccountForUser(data.destAccountId, req.userId!);
    if (!srcAccount || !destAccount) return res.status(404).json({ error: 'Compte non trouvé' });

    if (data.srcAccountId === data.destAccountId) {
      const svc = new MailService(srcAccount);
      if (data.mode === 'move') {
        await svc.moveMessage(data.srcFolder, data.uid, data.destFolder);
      } else {
        await svc.copyMessage(data.srcFolder, data.uid, data.destFolder);
      }
      return res.json({ success: true });
    }

    const srcSvc = new MailService(srcAccount);
    const destSvc = new MailService(destAccount);
    const raw = await srcSvc.fetchRawMessage(data.srcFolder, data.uid);
    await destSvc.appendRawMessage(data.destFolder, raw.source, raw.flags, raw.internalDate);

    if (data.mode === 'move') {
      await srcSvc.deleteMessage(data.srcFolder, data.uid);
      await pool.query(
        'DELETE FROM cached_emails WHERE account_id = $1 AND uid = $2 AND folder = $3',
        [data.srcAccountId, data.uid, data.srcFolder]
      );
    }

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides' });
    }
    console.error('Message transfer error:', error);
    res.status(500).json({ error: error.message || 'Erreur de transfert' });
  }
});

// Copy a whole folder (all messages) to another account/folder or within the same account.
// POST /mail/folders/copy
mailRouter.post('/folders/copy', async (req: AuthRequest, res) => {
  try {
    const schema = z.object({
      srcAccountId: z.string().uuid(),
      srcPath: z.string().min(1),
      destAccountId: z.string().uuid(),
      destPath: z.string().min(1).max(200),
    });
    const data = schema.parse(req.body);

    const srcAccount = await getAccountForUser(data.srcAccountId, req.userId!);
    const destAccount = await getAccountForUser(data.destAccountId, req.userId!);
    if (!srcAccount || !destAccount) return res.status(404).json({ error: 'Compte non trouvé' });

    const srcSvc = new MailService(srcAccount);

    if (data.srcAccountId === data.destAccountId) {
      await srcSvc.createFolder(data.destPath).catch(() => {});
      const uids = await srcSvc.listFolderUids(data.srcPath);
      let copied = 0;
      for (const uid of uids) {
        try {
          await srcSvc.copyMessage(data.srcPath, uid, data.destPath);
          copied++;
        } catch (err: any) {
          console.warn(`Copy message ${uid} failed:`, err?.message);
        }
      }
      return res.json({ success: true, copied, total: uids.length });
    }

    const destSvc = new MailService(destAccount);
    await destSvc.createFolder(data.destPath).catch(() => {});
    const uids = await srcSvc.listFolderUids(data.srcPath);
    let copied = 0;
    let failed = 0;
    for (const uid of uids) {
      try {
        const raw = await srcSvc.fetchRawMessage(data.srcPath, uid);
        await destSvc.appendRawMessage(data.destPath, raw.source, raw.flags, raw.internalDate);
        copied++;
      } catch (err: any) {
        failed++;
        console.warn(`Copy message uid ${uid} failed:`, err?.message);
      }
    }

    res.json({ success: true, copied, failed, total: uids.length });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides' });
    }
    console.error('Folder copy error:', error);
    res.status(500).json({ error: error.message || 'Erreur de copie du dossier' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// App badge — agrégation légère d'un compteur cross-comptes pour la
// pastille d'application (Web App Badging API). Utilise IMAP STATUS,
// très peu coûteux, et met en cache 30 s par utilisateur+source.
// ─────────────────────────────────────────────────────────────────────────
type BadgeSource = 'inbox-unread' | 'inbox-recent' | 'inbox-total';
const BADGE_TTL_MS = 30_000;
const badgeCache = new Map<string, { value: { count: number; perAccount: Array<{ accountId: string; count: number }> }; at: number }>();

mailRouter.get('/badge', async (req: AuthRequest, res) => {
  try {
    const sourceRaw = String(req.query.source || 'inbox-unread');
    const source: BadgeSource =
      sourceRaw === 'inbox-recent' || sourceRaw === 'inbox-total' ? sourceRaw : 'inbox-unread';
    const scope = String(req.query.scope || 'all') === 'default' ? 'default' : 'all';
    const cacheKey = `${req.userId}:${source}:${scope}`;
    const cached = badgeCache.get(cacheKey);
    if (cached && Date.now() - cached.at < BADGE_TTL_MS) {
      return res.json({ source, scope, ...cached.value, cached: true });
    }

    const accountsResult = await pool.query(
      `SELECT ma.id, ma.is_default
         FROM mail_accounts ma
         JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id
        WHERE mba.user_id = $1
        UNION
       SELECT ma.id, ma.is_default
         FROM mail_accounts ma
        WHERE ma.user_id = $1
          AND NOT EXISTS (SELECT 1 FROM mailbox_assignments mba2 WHERE mba2.mail_account_id = ma.id AND mba2.user_id = $1)`,
      [req.userId],
    );
    let accountIds: string[] = accountsResult.rows.map((r: any) => r.id);
    if (scope === 'default') {
      const def = accountsResult.rows.find((r: any) => r.is_default);
      accountIds = def ? [def.id] : accountIds.slice(0, 1);
    }

    const perAccount: Array<{ accountId: string; count: number }> = [];
    let total = 0;
    await Promise.all(
      accountIds.map(async (accountId) => {
        try {
          const account = await getAccountForUser(accountId, req.userId!);
          if (!account) return;
          const service = new MailService(account);
          const status = await service.getMailboxStatus('INBOX');
          const c =
            source === 'inbox-recent' ? status.recent
            : source === 'inbox-total' ? status.messages
            : status.unseen;
          perAccount.push({ accountId, count: c });
          total += c;
        } catch (err) {
          // Per-account failure shouldn't break the global badge.
          logger.debug({ err, accountId }, 'badge: account status failed');
        }
      }),
    );

    const value = { count: total, perAccount };
    badgeCache.set(cacheKey, { value, at: Date.now() });
    res.json({ source, scope, ...value });
  } catch (error: any) {
    console.error('Badge route error:', error);
    res.status(500).json({ error: error.message || 'Erreur calcul pastille' });
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
  // OAuth accounts: refresh access token if needed and attach it.
  // Non-OAuth accounts: decrypt the stored IMAP/SMTP password as before.
  if (account.oauth_provider) {
    const { ensureFreshAccessToken } = await import('../services/oauth');
    const accessToken = await ensureFreshAccessToken(account);
    return {
      ...account,
      username: account.username || account.email,
      access_token: accessToken,
      password: '',
    };
  }
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
