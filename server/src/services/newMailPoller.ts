import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';
import { MailService } from './mail';
import { notifyWithPush, hasActiveWebSocket } from './websocket';
import { logger } from '../utils/logger';
import { maybeSendAutoReply } from './autoResponderService';

/**
 * Periodically checks each mail account owned by users who have at least one
 * active push subscription or WebSocket, and notifies them of new INBOX
 * messages via WS (foreground) and/or Web Push (background).
 *
 * Keeps the highest seen UID per account in memory. On first run after boot,
 * the current highest UID is recorded as baseline and no notifications are sent.
 */

const lastSeenUid = new Map<string, number>(); // accountId -> highest UID
const lastCheckedAt = new Map<string, number>(); // userId -> ms epoch of last check
// Base tick frequency. The actual per-user check frequency is gated by the
// `mail.newMailPollMinutes` user preference (0=jamais, 1/5/15/30/60).
const INTERVAL_MS = Math.max(15_000, Number(process.env.NEW_MAIL_POLL_INTERVAL_MS) || 30_000);
const DEFAULT_POLL_MINUTES = Math.max(0, Number(process.env.NEW_MAIL_POLL_DEFAULT_MINUTES) || 5);
const VALID_POLL_MINUTES = new Set([0, 1, 5, 15, 30, 60]);

function stripHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function checkAccount(row: any) {
  let accessToken: string | undefined;
  let password = '';
  if (row.oauth_provider) {
    const { ensureFreshAccessToken } = await import('./oauth');
    try {
      accessToken = (await ensureFreshAccessToken(row)) || undefined;
    } catch (err) {
      logger.debug({ err, accountId: row.id }, 'new-mail poll: OAuth refresh failed');
      return;
    }
  } else {
    try { password = decrypt(row.password_encrypted); }
    catch { return; }
  }

  const service = new MailService({
    email: row.email,
    name: row.name,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    imap_secure: row.imap_secure,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_secure: row.smtp_secure,
    username: row.username || row.email,
    password,
    access_token: accessToken,
  });

  const uids = await service.listFolderUids('INBOX').catch((err) => {
    logger.debug({ err, accountId: row.id }, 'new-mail poll: listFolderUids failed');
    return null;
  });
  if (!uids || uids.length === 0) return;

  const maxUid = Math.max(...uids);
  const prev = lastSeenUid.get(row.id);

  if (prev === undefined) {
    // First run: baseline only, no notification
    lastSeenUid.set(row.id, maxUid);
    return;
  }

  if (maxUid <= prev) {
    return;
  }

  const newUids = uids.filter((u) => u > prev).sort((a, b) => a - b);
  lastSeenUid.set(row.id, maxUid);

  // Cap notifications to avoid a flood on initial sync or bulk imports.
  const MAX_NOTIFICATIONS = 5;
  const toNotify = newUids.slice(-MAX_NOTIFICATIONS);

  for (const uid of toNotify) {
    try {
      const msg = await service.getMessage('INBOX', uid);
      const subject = (msg?.subject || '(Sans objet)').toString().slice(0, 140);
      const fromName = msg?.from?.name || msg?.from?.address || 'Expéditeur inconnu';
      const preview = stripHtml(msg?.bodyText || msg?.bodyHtml || '').slice(0, 160);

      // Fire-and-forget the auto-responder check (errors are swallowed inside).
      maybeSendAutoReply(
        { id: row.id, user_id: row.user_id, email: row.email, name: row.name },
        msg,
        service,
      ).catch(() => { /* already logged */ });

      await notifyWithPush(
        row.user_id,
        'new-mail',
        { accountId: row.id, uid, subject, from: msg?.from },
        {
          title: `${fromName} — ${row.email}`,
          body: `${subject}${preview ? '\n' + preview : ''}`,
          tag: `mail-${row.id}-${uid}`,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          url: `/mail/${row.id}/INBOX`,
          data: { accountId: row.id, uid, folder: 'INBOX' },
          requireInteraction: true,
          renotify: true,
          silent: false,
          timestamp: Date.now(),
          vibrate: [120, 60, 120],
          actions: [
            { action: 'open', title: 'Lire' },
            { action: 'dismiss', title: 'Ignorer' },
          ],
        },
        'both',
      );
    } catch (err) {
      logger.debug({ err, uid, accountId: row.id }, 'new-mail notify failed');
    }
  }

  if (newUids.length > toNotify.length && hasActiveWebSocket(row.user_id)) {
    logger.info(`${newUids.length - toNotify.length} new mails suppressed (flood protection) for account ${row.id}`);
  }
}

async function tick() {
  try {
    // Pull the per-user `mail.newMailPollMinutes` preference for everyone who
    // has at least one enabled push subscription OR at least one mail account
    // with an enabled auto-responder (the responder runs on the same poller
    // because both depend on detecting new INBOX UIDs). Users without the
    // preference fall back to DEFAULT_POLL_MINUTES.
    const prefRows = await pool.query(
      `WITH eligible AS (
         SELECT user_id FROM push_subscriptions WHERE enabled = true
         UNION
         SELECT ma.user_id
           FROM auto_responders ar
           JOIN mail_accounts ma ON ma.id = ar.account_id
          WHERE ar.enabled = true AND ma.user_id IS NOT NULL
       )
       SELECT DISTINCT e.user_id,
              COALESCE(up.value, '') AS pref_value
         FROM eligible e
         LEFT JOIN user_preferences up
           ON up.user_id = e.user_id AND up.key = 'mail.newMailPollMinutes'`
    );

    if (prefRows.rowCount === 0) return;

    const now = Date.now();
    const userIntervals = new Map<string, number>(); // userId -> required ms gap
    const eligibleUserIds: string[] = [];

    for (const row of prefRows.rows) {
      let minutes = DEFAULT_POLL_MINUTES;
      // Pref values are JSON-encoded by the client (always wrapped in quotes for strings).
      const raw = String(row.pref_value || '').replace(/^"|"$/g, '').trim();
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && VALID_POLL_MINUTES.has(parsed)) {
          minutes = parsed;
        }
      }
      if (minutes === 0) {
        // Never poll for this user — drop any in-memory state.
        lastCheckedAt.delete(row.user_id);
        continue;
      }

      const lastAt = lastCheckedAt.get(row.user_id) ?? 0;
      const requiredGapMs = minutes * 60_000;
      // Allow a 5s skew to compensate for jittered ticks.
      if (now - lastAt + 5_000 < requiredGapMs) continue;

      userIntervals.set(row.user_id, requiredGapMs);
      eligibleUserIds.push(row.user_id);
    }

    if (eligibleUserIds.length === 0) return;

    const result = await pool.query(
      `SELECT * FROM mail_accounts WHERE user_id = ANY($1::uuid[])`,
      [eligibleUserIds]
    );

    if (result.rowCount === 0) return;

    // Limit concurrency — process accounts sequentially to avoid hammering IMAP.
    const checkedUserIds = new Set<string>();
    for (const row of result.rows) {
      await checkAccount(row).catch((err) => {
        logger.debug({ err, accountId: row.id }, 'checkAccount failed');
      });
      checkedUserIds.add(row.user_id);
    }

    // Mark each user as checked at this tick start so the next eligibility test
    // uses a stable timestamp regardless of how long the IMAP round-trips took.
    for (const userId of checkedUserIds) {
      lastCheckedAt.set(userId, now);
    }
  } catch (err) {
    logger.error(err as Error, 'new-mail poll tick failed');
  }
}

let timer: NodeJS.Timeout | null = null;

export function startNewMailPoller() {
  if (timer) return;
  logger.info(`New-mail poller started (base tick ${INTERVAL_MS}ms, default user interval ${DEFAULT_POLL_MINUTES}min)`);
  // Delay first run slightly so the server finishes startup
  setTimeout(() => { tick(); }, 10_000);
  timer = setInterval(tick, INTERVAL_MS);
}

export function stopNewMailPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
