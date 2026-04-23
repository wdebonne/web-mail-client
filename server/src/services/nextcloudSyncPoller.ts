import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { getNextCloudConfig, getUserClient } from './nextcloudHelper';

/**
 * Periodic NextCloud → DB sync.
 * Pulls calendar events and contacts for each provisioned user.
 * Runs at an interval configured globally in admin_settings (default 15 min).
 */

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tickOne(userId: string): Promise<void> {
  const nc = await getUserClient(userId);
  if (!nc) return;
  try {
    await nc.syncCalendars(userId);
    await nc.syncContacts(userId);
    await pool.query(
      `UPDATE nextcloud_users SET last_sync_at = NOW(), last_sync_error = NULL WHERE user_id = $1`,
      [userId]
    );
  } catch (e: any) {
    await pool.query(
      `UPDATE nextcloud_users SET last_sync_error = $1 WHERE user_id = $2`,
      [(e?.message || 'unknown').slice(0, 500), userId]
    );
    logger.warn({ err: e?.message, userId }, 'NC sync tick failed for user');
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const cfg = await getNextCloudConfig(false);
    if (!cfg?.enabled) return;

    const users = await pool.query(
      `SELECT user_id FROM nextcloud_users WHERE is_active = true`
    );
    // Run serially to limit load on NC
    for (const u of users.rows) {
      await tickOne(u.user_id).catch(() => { /* already logged */ });
    }
  } catch (e: any) {
    logger.error(e as Error, 'NC sync poller tick failed');
  } finally {
    running = false;
  }
}

export async function startNextCloudSyncPoller() {
  if (timer) return;
  const cfg = await getNextCloudConfig(false).catch(() => null);
  const intervalMin = Math.max(5, cfg?.syncIntervalMinutes || 15);
  const intervalMs = intervalMin * 60_000;
  logger.info(`NextCloud sync poller started (interval ${intervalMin}min)`);
  setTimeout(() => { tick(); }, 30_000); // wait 30s after boot
  timer = setInterval(tick, intervalMs);
}

export function stopNextCloudSyncPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Trigger a sync for a single user on demand (used by admin routes). */
export async function syncUserNow(userId: string): Promise<void> {
  await tickOne(userId);
}
