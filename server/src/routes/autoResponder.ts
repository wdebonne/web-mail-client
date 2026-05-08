import { Router } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export const autoResponderRouter = Router();

/** Read-only feature flags for the user UI (controls visibility of the
 *  ribbon button and settings tab). */
autoResponderRouter.get('/feature-settings', async (_req: AuthRequest, res) => {
  try {
    const r = await pool.query(
      `SELECT key, value FROM admin_settings
        WHERE key IN ('auto_responder_enabled', 'auto_responder_default_interval_minutes')`,
    );
    let enabled = true;
    let defaultIntervalMinutes = 5;
    for (const row of r.rows) {
      const raw = String(row.value || '').replace(/^"|"$/g, '').trim();
      if (row.key === 'auto_responder_enabled') enabled = raw !== 'false';
      else if (row.key === 'auto_responder_default_interval_minutes') {
        const n = Number(raw);
        if (Number.isFinite(n)) defaultIntervalMinutes = n;
      }
    }
    res.json({ enabled, defaultIntervalMinutes });
  } catch (error: any) {
    logger.error(error, 'auto-responder feature-settings GET failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

async function isFeatureEnabledForUsers(): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'auto_responder_enabled'`,
    );
    if (r.rowCount === 0) return true;
    const raw = String(r.rows[0].value || '').replace(/^"|"$/g, '').trim();
    return raw !== 'false';
  } catch {
    return true;
  }
}

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

export const upsertSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().trim().min(1).max(255),
  bodyHtml: z.string().max(50_000),
  bodyText: z.string().max(50_000).optional(),
  scheduled: z.boolean().default(false),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  onlyContacts: z.boolean().default(false),
  /** Optional list of email addresses that should receive a copy of every
   *  incoming message while the responder is active. Capped to keep the
   *  forwarding fan-out reasonable. */
  forwardTo: z.array(z.string().trim().toLowerCase().email()).max(20).default([]),
});

export const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
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

export function plainTextFromHtml(html: string): string {
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
              scheduled, start_at, end_at, only_contacts, forward_to, updated_at
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
        forwardTo: [],
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
      forwardTo: Array.isArray(row.forward_to) ? row.forward_to : [],
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
    if (!(await isFeatureEnabledForUsers())) {
      return res.status(403).json({ error: 'La fonctionnalité Répondeur est désactivée par l\'administrateur' });
    }
    const { accountId } = req.params;
    const account = await getAccountForUser(accountId, req.userId!);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    const result = await upsertAutoResponderForAccount(accountId, req.body);
    if ('error' in result) {
      return res.status(result.status).json({ error: result.error, ...(result.details ? { details: result.details } : {}) });
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error(error, 'auto-responder PUT failed');
    res.status(500).json({ error: error.message || 'Erreur' });
  }
});

/**
 * Shared upsert used by both the per-user route and the admin route.
 * Returns either `{ success: true }` or `{ status, error, details? }`.
 */
export async function upsertAutoResponderForAccount(accountId: string, body: unknown):
  Promise<{ success: true } | { status: number; error: string; details?: any }>
{
  let data: z.infer<typeof upsertSchema>;
  try {
    data = upsertSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { status: 400, error: 'Données invalides', details: err.errors };
    }
    throw err;
  }

  if (data.scheduled) {
    if (!data.startAt) {
      return { status: 400, error: 'Date de début requise' };
    }
    if (data.endAt && new Date(data.endAt) <= new Date(data.startAt)) {
      return { status: 400, error: 'La date de fin doit être après la date de début' };
    }
  }

  const cleanHtml = sanitizeHtml(data.bodyHtml || '', SANITIZE_OPTIONS);
  const fallbackText = (data.bodyText && data.bodyText.trim())
    ? data.bodyText
    : plainTextFromHtml(cleanHtml);

  if (data.enabled && !cleanHtml.trim() && !fallbackText.trim()) {
    return { status: 400, error: 'Le message du répondeur ne peut pas être vide' };
  }

  // Deduplicate while preserving order; emails were already trimmed/lowercased by Zod.
  const forwardList = Array.from(new Set(data.forwardTo || []));

  await pool.query(
    `INSERT INTO auto_responders (
        account_id, enabled, subject, body_html, body_text,
        scheduled, start_at, end_at, only_contacts, forward_to, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (account_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        subject = EXCLUDED.subject,
        body_html = EXCLUDED.body_html,
        body_text = EXCLUDED.body_text,
        scheduled = EXCLUDED.scheduled,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        only_contacts = EXCLUDED.only_contacts,
        forward_to = EXCLUDED.forward_to,
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
      JSON.stringify(forwardList),
    ],
  );

  return { success: true };
}
