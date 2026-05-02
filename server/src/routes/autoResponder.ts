import { Router } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export const autoResponderRouter = Router();

/** Returns the mail-account row when the user owns it (directly) or has been
 *  assigned the mailbox with `send_as` / `send_on_behalf` permission. Auto-
 *  responder settings are user-bound so we require at least visibility. */
async function getAccountForUser(accountId: string, userId: string) {
  const result = await pool.query(
    `SELECT ma.id, ma.email, ma.name
       FROM mail_accounts ma
      WHERE ma.id = $1
        AND (
          ma.user_id = $2
          OR EXISTS (
            SELECT 1 FROM mailbox_assignments mba
              WHERE mba.mail_account_id = ma.id AND mba.user_id = $2
          )
        )
      LIMIT 1`,
    [accountId, userId],
  );
  return result.rows[0] || null;
}

const upsertSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().trim().min(1).max(255),
  bodyHtml: z.string().max(50_000),
  bodyText: z.string().max(50_000).optional(),
  scheduled: z.boolean().default(false),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  onlyContacts: z.boolean().default(false),
});

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'b', 'i', 'u', 's', 'strong', 'em', 'strike', 'del', 'ins',
    'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'span', 'div', 'sub', 'sup', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'hr',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    span: ['style'],
    div: ['style'],
    p: ['style'],
    table: ['style'],
    td: ['style', 'colspan', 'rowspan'],
    th: ['style', 'colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
};

function plainTextFromHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** GET current settings (returns disabled defaults if none exist). */
autoResponderRouter.get('/account/:accountId', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const result = await pool.query(
      `SELECT id, account_id, enabled, subject, body_html, body_text,
              scheduled, start_at, end_at, only_contacts, updated_at
         FROM auto_responders WHERE account_id = $1`,
      [accountId],
    );

    if (result.rowCount === 0) {
      return res.json({
        accountId,
        enabled: false,
        subject: 'Réponse automatique',
        bodyHtml: '',
        bodyText: '',
        scheduled: false,
        startAt: null,
        endAt: null,
        onlyContacts: false,
        updatedAt: null,
      });
    }

    const row = result.rows[0];
    res.json({
      accountId: row.account_id,
      enabled: row.enabled,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      scheduled: row.scheduled,
      startAt: row.start_at,
      endAt: row.end_at,
      onlyContacts: row.only_contacts,
      updatedAt: row.updated_at,
    });
  } catch (error: any) {
    logger.error(error, 'auto-responder GET failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

/** PUT (upsert) settings for an account. */
autoResponderRouter.put('/account/:accountId', async (req: AuthRequest, res) => {
  try {
    const { accountId } = req.params;
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const data = upsertSchema.parse(req.body);

    if (data.scheduled) {
      if (!data.startAt) {
        return res.status(400).json({ error: 'Date de début requise' });
      }
      if (data.endAt && new Date(data.endAt) <= new Date(data.startAt)) {
        return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
      }
    }

    const cleanHtml = sanitizeHtml(data.bodyHtml || '', SANITIZE_OPTIONS);
    const fallbackText = (data.bodyText && data.bodyText.trim())
      ? data.bodyText
      : plainTextFromHtml(cleanHtml);

    if (data.enabled && !cleanHtml.trim() && !fallbackText.trim()) {
      return res.status(400).json({ error: 'Le message du répondeur ne peut pas être vide' });
    }

    await pool.query(
      `INSERT INTO auto_responders (
          account_id, enabled, subject, body_html, body_text,
          scheduled, start_at, end_at, only_contacts, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          subject = EXCLUDED.subject,
          body_html = EXCLUDED.body_html,
          body_text = EXCLUDED.body_text,
          scheduled = EXCLUDED.scheduled,
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          only_contacts = EXCLUDED.only_contacts,
          updated_at = NOW()`,
      [
        accountId,
        data.enabled,
        data.subject,
        cleanHtml,
        fallbackText,
        data.scheduled,
        data.scheduled ? data.startAt : null,
        data.scheduled ? data.endAt ?? null : null,
        data.onlyContacts,
      ],
    );

    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    logger.error(error, 'auto-responder PUT failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});
