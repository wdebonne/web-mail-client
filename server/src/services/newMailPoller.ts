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
const lastCatchUpAt = new Map<string, number>(); // accountId -> ms epoch of responder.updated_at last catch-up
// Base tick frequency. The actual per-user check frequency is gated by the
// `mail.newMailPollMinutes` user preference (0=jamais, 1/5/15/30/60).
const INTERVAL_MS = Math.max(15_000, Number(process.env.NEW_MAIL_POLL_INTERVAL_MS) || 30_000);
const FALLBACK_DEFAULT_MINUTES = Math.max(0, Number(process.env.NEW_MAIL_POLL_DEFAULT_MINUTES) || 5);
const VALID_POLL_MINUTES = new Set([0, 1, 5, 15, 30, 60]);

/** Cache for admin-configured defaults (refreshed at every tick). */
let cachedDefaultMinutes = FALLBACK_DEFAULT_MINUTES;
let cachedFeatureEnabled = true;

async function refreshAdminDefaults(): Promise<void> {
  try {
    const r = await pool.query(
      `SELECT key, value FROM admin_settings
        WHERE key IN ('auto_responder_enabled', 'auto_responder_default_interval_minutes')`,
    );
    let enabled = true;
    let minutes = FALLBACK_DEFAULT_MINUTES;
    for (const row of r.rows) {
      const raw = String(row.value || '').replace(/^"|"$/g, '').trim();
      if (row.key === 'auto_responder_enabled') {
        enabled = raw !== 'false';
      } else if (row.key === 'auto_responder_default_interval_minutes') {
        const n = Number(raw);
        if (Number.isFinite(n) && VALID_POLL_MINUTES.has(n)) minutes = n;
      }
    }
    cachedFeatureEnabled = enabled;
    cachedDefaultMinutes = minutes;
  } catch {
    /* keep previous cached values on error */
  }
}

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

  // ------------------------------------------------------------------
  // Auto-responder catch-up. Runs whenever:
  //   (a) we have never observed this account in this process (prev === undefined), OR
  //   (b) an active auto-responder exists whose updated_at is newer than the
  //       last catch-up we ran for it (covers the case where the user/admin
  //       creates or edits a responder AFTER the baseline was taken).
  // The catch-up scans messages received since max(updated_at, start_at) and
  // calls maybeSendAutoReply for each, capped to 20 messages / 7 days.
  // ------------------------------------------------------------------
  let shouldRunCatchUp = prev === undefined;
  let responderUpdatedAtMs = 0;
  let catchUpResponder: any = null;
  try {
    const r = await pool.query(
      `SELECT enabled, scheduled, start_at, end_at, updated_at
         FROM auto_responders WHERE account_id = $1`,
      [row.id],
    );
    if (r.rowCount! > 0) {
      const ar = r.rows[0];
      const now = Date.now();
      const scheduleOk = !ar.scheduled
        || ((!ar.start_at || new Date(ar.start_at).getTime() <= now)
          && (!ar.end_at || new Date(ar.end_at).getTime() > now));
      if (ar.enabled && scheduleOk) {
        responderUpdatedAtMs = ar.updated_at ? new Date(ar.updated_at).getTime() : 0;
        const lastCatch = lastCatchUpAt.get(row.id) ?? 0;
        if (responderUpdatedAtMs > lastCatch) shouldRunCatchUp = true;
        catchUpResponder = ar;
      }
    }
  } catch (err) {
    logger.debug({ err, accountId: row.id }, 'auto-responder catch-up: load failed');
  }

  if (prev === undefined) {
    // Always baseline so we don't notify on existing mail in the regular path.
    lastSeenUid.set(row.id, maxUid);
  }

  if (shouldRunCatchUp && catchUpResponder) {
    try {
      const ar = catchUpResponder;
      const now = Date.now();
      const activatedAt = ar.updated_at ? new Date(ar.updated_at) : null;
      const startedAt = ar.start_at ? new Date(ar.start_at) : null;
      const sinceCandidates = [activatedAt, startedAt]
        .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
      const minSince = new Date(now - 7 * 24 * 60 * 60 * 1000);
      let since = sinceCandidates.length
        ? new Date(Math.max(...sinceCandidates.map((d) => d.getTime())))
        : minSince;
      if (since < minSince) since = minSince;

      const recent = await service.listFolderUidsSince('INBOX', since).catch((err) => {
        logger.debug({ err, accountId: row.id }, 'auto-responder catch-up: listFolderUidsSince failed');
        return [] as number[];
      });
      if (recent && recent.length > 0) {
        const sorted = [...recent].sort((a, b) => a - b);
        const tail = sorted.slice(-20);
        logger.info(`auto-responder catch-up for ${row.email}: ${tail.length} candidate(s) since ${since.toISOString()}`);
        for (const uid of tail) {
          try {
            const msg = await service.getMessage('INBOX', uid);
            await maybeSendAutoReply(
              { id: row.id, user_id: row.user_id, email: row.email, name: row.name },
              msg,
              service,
            );
          } catch (err) {
            logger.debug({ err, uid, accountId: row.id }, 'auto-responder catch-up: getMessage failed');
          }
        }
      }
      lastCatchUpAt.set(row.id, responderUpdatedAtMs || Date.now());
    } catch (err) {
      logger.debug({ err, accountId: row.id }, 'auto-responder catch-up failed');
    }
  }

  if (prev === undefined) return;

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
    await refreshAdminDefaults();

    // Pull the per-user `mail.newMailPollMinutes` preference for everyone who
    // has at least one enabled push subscription OR (when the auto-responder
    // feature is globally enabled) at least one mail account with an enabled
    // auto-responder. Users without the preference fall back to the
    // admin-configured default minutes.
    const eligibilityUnion = cachedFeatureEnabled
      ? `SELECT user_id FROM push_subscriptions WHERE enabled = true
         UNION
         SELECT ma.user_id
           FROM auto_responders ar
           JOIN mail_accounts ma ON ma.id = ar.account_id
          WHERE ar.enabled = true AND ma.user_id IS NOT NULL
         UNION
         SELECT mba.user_id
           FROM auto_responders ar
           JOIN mailbox_assignments mba ON mba.mail_account_id = ar.account_id
          WHERE ar.enabled = true AND mba.user_id IS NOT NULL`
      : `SELECT user_id FROM push_subscriptions WHERE enabled = true`;

    const prefRows = await pool.query(
      `WITH eligible AS (
         ${eligibilityUnion}
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
      let minutes = cachedDefaultMinutes;
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

    // Fetch every mail account belonging to the eligible users — including
    // shared mailboxes attached via `mailbox_assignments` (where
    // `mail_accounts.user_id` is NULL but the user has access).
    const result = await pool.query(
      `SELECT DISTINCT ma.*, COALESCE(ma.user_id, mba.user_id) AS user_id
         FROM mail_accounts ma
         LEFT JOIN mailbox_assignments mba ON mba.mail_account_id = ma.id
        WHERE ma.user_id = ANY($1::uuid[])
           OR mba.user_id = ANY($1::uuid[])`,
      [eligibleUserIds]
    );

    if (result.rowCount === 0) return;

    logger.debug(`new-mail poll tick: ${eligibleUserIds.length} user(s), ${result.rowCount} account(s)`);

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
  logger.info(`New-mail poller started (base tick ${INTERVAL_MS}ms, default user interval ${FALLBACK_DEFAULT_MINUTES}min)`);
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
