import { pool } from '../database/connection';
import { MailService } from './mail';
import { logger } from '../utils/logger';

/** Default cooldown between two replies to the same sender (days), used when
 *  the admin has not explicitly configured a value. RFC 3834-friendly. */
const DEFAULT_COOLDOWN_DAYS = 4;
/** Valid choices for the admin cooldown setting. 0 = always reply (no cooldown). */
export const VALID_RESPONDER_COOLDOWN_DAYS = new Set([0, 1, 2, 3, 4]);

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
  forward_to: string[] | null;
}

/** Loads the (cached) auto-responder for an account, or null when none/disabled. */
async function loadResponder(accountId: string): Promise<AutoResponderRow | null> {
  const result = await pool.query(
    `SELECT account_id, enabled, subject, body_html, body_text,
            scheduled, start_at, end_at, only_contacts, replied_log, forward_to
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

/** Reads the admin-configured cooldown (in days) between two replies to the
 *  same sender. 0 = always reply (no cooldown). Falls back to
 *  `DEFAULT_COOLDOWN_DAYS` if missing or invalid. */
async function getCooldownDays(): Promise<number> {
  try {
    const r = await pool.query(
      `SELECT value FROM admin_settings WHERE key = 'auto_responder_cooldown_days'`,
    );
    if (r.rowCount === 0) return DEFAULT_COOLDOWN_DAYS;
    const raw = String(r.rows[0].value || '').replace(/^"|"$/g, '').trim();
    const n = Number(raw);
    if (Number.isFinite(n) && VALID_RESPONDER_COOLDOWN_DAYS.has(n)) return n;
    return DEFAULT_COOLDOWN_DAYS;
  } catch {
    return DEFAULT_COOLDOWN_DAYS;
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
  // Single global gate: when the feature is disabled by the admin, no reply
  // and no forwarding happens.
  try {
    if (!(await isFeatureEnabled())) return;
  } catch {
    return;
  }

  const responder = await loadResponder(accountRow.id).catch(() => null);
  if (!responder || !isActive(responder)) return;

  const fromEmail: string | undefined = msg?.from?.address;
  if (!fromEmail) return;
  const fromLower = fromEmail.toLowerCase();
  if (fromLower === accountRow.email.toLowerCase()) return;
  if (!shouldReplyToHeaders(msg?.headersRaw || msg?.headers)) return;

  // ------------------------------------------------------------------
  // 1) Auto-reply path. Wrapped so its early returns / errors don't
  //    prevent the forwarding step that follows.
  // ------------------------------------------------------------------
  await (async () => {
    try {
      // Optional restriction: only known contacts.
      if (responder.only_contacts) {
        const known = await isContactOf(accountRow.user_id, fromEmail);
        if (!known) return;
      }

      // Per-recipient cooldown.
      const cooldownDays = await getCooldownDays();
      const log = responder.replied_log || {};
      if (cooldownDays > 0) {
        const lastIso = log[fromLower];
        if (lastIso) {
          const last = new Date(lastIso).getTime();
          const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
          if (Number.isFinite(last) && Date.now() - last < cooldownMs) return;
        }
      }

      const subjectOut = (responder.subject && responder.subject.trim())
        ? responder.subject.trim()
        : 'Réponse automatique';
      const replySubject = subjectOut;

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
  })();

  // ------------------------------------------------------------------
  // 2) Forwarding path. Independent of the cooldown and contacts filter:
  //    every fresh, non-automatic incoming message is mirrored to the
  //    addresses configured by the user while the responder is active.
  // ------------------------------------------------------------------
  try {
    const targets = Array.isArray(responder.forward_to) ? responder.forward_to : [];
    if (targets.length === 0) return;

    const ownLower = accountRow.email.toLowerCase();
    const recipients = Array.from(new Set(
      targets
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => !!e && e !== ownLower && e !== fromLower),
    ));

    if (recipients.length === 0) return;

    await forwardIncoming(accountRow, msg, mailService, recipients);
  } catch (err) {
    logger.warn({ err, accountId: accountRow.id }, 'auto-forward failed');
  }
}

/**
 * Forward the original incoming message to every recipient in `recipients`.
 * Adds anti-loop headers so downstream auto-responders won't reply.
 */
async function forwardIncoming(
  accountRow: { id: string; user_id: string; email: string; name: string },
  msg: any,
  mailService: MailService,
  recipients: string[],
): Promise<void> {
  const origSubject = (msg?.subject || '').toString().trim();
  const subject = /^fwd?:/i.test(origSubject) ? origSubject : `Fwd: ${origSubject || '(Sans objet)'}`;

  const fromName = msg?.from?.name || msg?.from?.address || '';
  const fromAddr = msg?.from?.address || '';
  const dateStr = msg?.date ? new Date(msg.date).toLocaleString('fr-FR') : '';
  const toList = Array.isArray(msg?.to)
    ? msg.to.map((t: any) => t?.address).filter(Boolean).join(', ')
    : '';

  const escape = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const headerHtml =
    `<div style="border-top:1px solid #ccc;margin-top:12px;padding-top:8px;font-family:Arial,sans-serif;font-size:13px;color:#333">` +
    `<p style="margin:0 0 6px 0"><b>---------- Message transféré ----------</b></p>` +
    `<p style="margin:0"><b>De&nbsp;:</b> ${escape(fromName)}${fromAddr ? ` &lt;${escape(fromAddr)}&gt;` : ''}</p>` +
    (dateStr ? `<p style="margin:0"><b>Date&nbsp;:</b> ${escape(dateStr)}</p>` : '') +
    `<p style="margin:0"><b>Objet&nbsp;:</b> ${escape(origSubject || '(Sans objet)')}</p>` +
    (toList ? `<p style="margin:0 0 8px 0"><b>À&nbsp;:</b> ${escape(toList)}</p>` : '<p style="margin:0 0 8px 0"></p>') +
    `</div>`;

  const headerText =
    `\n\n---------- Message transféré ----------\n` +
    `De : ${fromName}${fromAddr ? ` <${fromAddr}>` : ''}\n` +
    (dateStr ? `Date : ${dateStr}\n` : '') +
    `Objet : ${origSubject || '(Sans objet)'}\n` +
    (toList ? `À : ${toList}\n` : '') +
    `\n`;

  const bodyHtml = (msg?.bodyHtml || '').toString();
  const bodyText = (msg?.bodyText || '').toString();
  const html = `${headerHtml}${bodyHtml || `<pre style="white-space:pre-wrap;font-family:inherit">${escape(bodyText)}</pre>`}`;
  const text = `${headerText}${bodyText || stripHtml(bodyHtml)}`;

  const attachments = Array.isArray(msg?.attachments)
    ? msg.attachments.map((a: any) => ({
        filename: a.filename,
        content: a.content, // already base64 (sendMail decodes it)
        contentType: a.contentType,
        contentId: a.contentId,
      }))
    : [];

  for (const rcpt of recipients) {
    try {
      await mailService.sendMail({
        from: { email: accountRow.email, name: accountRow.name || accountRow.email },
        to: [{ email: rcpt }],
        subject,
        html,
        text,
        attachments,
        headers: {
          'Auto-Submitted': 'auto-forwarded',
          'X-Auto-Response-Suppress': 'All',
          Precedence: 'auto_reply',
          'X-Forwarded-For-Account': accountRow.email,
        },
        skipSentFolder: true,
      });
      logger.info(`Auto-forward sent for account ${accountRow.email} -> ${rcpt}`);
    } catch (err) {
      logger.warn({ err, accountId: accountRow.id, rcpt }, 'auto-forward recipient failed');
    }
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
