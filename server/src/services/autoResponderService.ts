import { pool } from '../database/connection';
import { MailService } from './mail';
import { logger } from '../utils/logger';

/** Cooldown between two replies to the same sender (ms). 4 days, RFC 3834-friendly. */
const REPLY_COOLDOWN_MS = 4 * 24 * 60 * 60 * 1000;

interface AutoResponderRow {
  account_id: string;
  enabled: boolean;
  subject: string;
  body_html: string;
  body_text: string;
  scheduled: boolean;
  start_at: Date | null;
  end_at: Date | null;
  only_contacts: boolean;
  replied_log: Record<string, string> | null;
}

/** Loads the (cached) auto-responder for an account, or null when none/disabled. */
async function loadResponder(accountId: string): Promise<AutoResponderRow | null> {
  const result = await pool.query(
    `SELECT account_id, enabled, subject, body_html, body_text,
            scheduled, start_at, end_at, only_contacts, replied_log
       FROM auto_responders WHERE account_id = $1`,
    [accountId],
  );
  if (result.rowCount === 0) return null;
  return result.rows[0] as AutoResponderRow;
}

/** Returns true when the admin globally enabled the auto-responder feature. */
async function isFeatureEnabled(): Promise<boolean> {
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

/** Whether the responder is active right now according to its schedule. */
function isActive(row: AutoResponderRow, now: Date = new Date()): boolean {
  if (!row.enabled) return false;
  if (!row.scheduled) return true;
  if (row.start_at && now < new Date(row.start_at)) return false;
  if (row.end_at && now > new Date(row.end_at)) return false;
  return true;
}

/**
 * RFC 3834 / RFC 2076 — refuse to reply to messages that look automatic
 * (other auto-responders, mailing lists, bounces, …) to prevent loops.
 */
function shouldReplyToHeaders(headers: Record<string, any> | null | undefined): boolean {
  if (!headers) return true;
  const get = (...names: string[]) => {
    for (const n of names) {
      const v = headers[n];
      if (typeof v === 'string' && v) return v.toLowerCase();
    }
    return '';
  };

  const autoSubmitted = get('autoSubmitted', 'auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return false;
  if (get('precedence').match(/(bulk|list|junk|auto_reply|auto-reply)/)) return false;
  if (get('xAutoResponseSuppress', 'x-auto-response-suppress')) return false;
  if (get('xAutorespond', 'x-autorespond')) return false;
  if (get('listId', 'list-id') || get('listUnsubscribe', 'list-unsubscribe')) return false;
  if (get('xLoop', 'x-loop')) return false;
  if (get('returnPath', 'return-path') === '<>') return false;
  return true;
}

async function isContactOf(userId: string, email: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM contacts WHERE user_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
    [userId, email],
  );
  return r.rowCount! > 0;
}

/**
 * Send an auto-reply for one incoming message if conditions are met.
 * Silent on any error to keep the poller resilient.
 *
 * @param accountRow  raw mail_accounts row (must include user_id, email, …)
 * @param msg         parsed message returned by MailService.getMessage
 * @param mailService a configured MailService bound to that account
 */
export async function maybeSendAutoReply(
  accountRow: { id: string; user_id: string; email: string; name: string },
  msg: any,
  mailService: MailService,
): Promise<void> {
  try {
    if (!(await isFeatureEnabled())) return;
    const responder = await loadResponder(accountRow.id);
    if (!responder || !isActive(responder)) return;

    const fromEmail: string | undefined = msg?.from?.address;
    if (!fromEmail) return;
    const fromLower = fromEmail.toLowerCase();

    // Never auto-reply to ourselves (would loop instantly through INBOX).
    if (fromLower === accountRow.email.toLowerCase()) return;

    // Mailing-list / auto-reply heuristics.
    if (!shouldReplyToHeaders(msg?.headersRaw || msg?.headers)) return;

    // Optional restriction: only known contacts.
    if (responder.only_contacts) {
      const known = await isContactOf(accountRow.user_id, fromEmail);
      if (!known) return;
    }

    // Per-recipient cooldown.
    const log = responder.replied_log || {};
    const lastIso = log[fromLower];
    if (lastIso) {
      const last = new Date(lastIso).getTime();
      if (Number.isFinite(last) && Date.now() - last < REPLY_COOLDOWN_MS) return;
    }

    const subjectIn = String(msg?.subject || '').trim();
    const subjectOut = responder.subject?.trim() || 'Réponse automatique';
    const replySubject = subjectIn
      ? (/^re\s*:/i.test(subjectIn) ? subjectIn : `Re: ${subjectIn}`)
      : subjectOut;

    const inReplyTo: string | undefined = msg?.messageId;
    const refsHeader: string | undefined = msg?.headers?.references;
    const references = [refsHeader, inReplyTo].filter(Boolean).join(' ').trim() || undefined;

    await mailService.sendMail({
      from: { email: accountRow.email, name: accountRow.name || accountRow.email },
      to: [{ email: fromEmail, name: msg?.from?.name }],
      subject: replySubject,
      html: responder.body_html || `<p>${escapeHtml(responder.body_text || '')}</p>`,
      text: responder.body_text || stripHtml(responder.body_html || ''),
      inReplyTo,
      references,
      headers: {
        'Auto-Submitted': 'auto-replied',
        'X-Auto-Response-Suppress': 'All',
        Precedence: 'auto_reply',
      },
      skipSentFolder: true,
    });

    // Persist cooldown.
    log[fromLower] = new Date().toISOString();
    await pool.query(
      `UPDATE auto_responders SET replied_log = $1, updated_at = NOW() WHERE account_id = $2`,
      [JSON.stringify(log), accountRow.id],
    );

    logger.info(`Auto-reply sent for account ${accountRow.email} -> ${fromEmail}`);
  } catch (err) {
    logger.warn({ err, accountId: accountRow.id }, 'auto-reply failed');
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
