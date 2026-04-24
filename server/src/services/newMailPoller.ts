import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';
import { MailService } from './mail';
import { notifyWithPush, hasActiveWebSocket } from './websocket';
import { logger } from '../utils/logger';

/**
 * Periodically checks each mail account owned by users who have at least one
 * active push subscription or WebSocket, and notifies them of new INBOX
 * messages via WS (foreground) and/or Web Push (background).
 *
 * Keeps the highest seen UID per account in memory. On first run after boot,
 * the current highest UID is recorded as baseline and no notifications are sent.
 */

const lastSeenUid = new Map<string, number>(); // accountId -> highest UID
const INTERVAL_MS = Math.max(30_000, Number(process.env.NEW_MAIL_POLL_INTERVAL_MS) || 60_000);

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
    // Only poll accounts whose owner has at least one enabled push subscription
    // (keeps IMAP load low — users who don't use push won't trigger polling).
    const result = await pool.query(
      `SELECT ma.*
         FROM mail_accounts ma
        WHERE EXISTS (
          SELECT 1 FROM push_subscriptions ps
           WHERE ps.user_id = ma.user_id AND ps.enabled = true
        )`
    );

    if (result.rowCount === 0) return;

    // Limit concurrency — process accounts sequentially to avoid hammering IMAP.
    for (const row of result.rows) {
      await checkAccount(row).catch((err) => {
        logger.debug({ err, accountId: row.id }, 'checkAccount failed');
      });
    }
  } catch (err) {
    logger.error(err as Error, 'new-mail poll tick failed');
  }
}

let timer: NodeJS.Timeout | null = null;

export function startNewMailPoller() {
  if (timer) return;
  logger.info(`New-mail poller started (interval ${INTERVAL_MS}ms)`);
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
