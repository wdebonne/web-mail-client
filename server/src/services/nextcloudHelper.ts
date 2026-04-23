import { pool } from '../database/connection';
import { encrypt, decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';
import { NextCloudAdminService, NextCloudService, ProvisionedUser } from './nextcloud';

/**
 * Centralized helpers to interact with the global NextCloud configuration
 * stored in the `admin_settings` table.
 *
 * All credentials are encrypted at rest. This module is the only place that
 * decrypts them.
 */

export interface NextCloudGlobalConfig {
  enabled: boolean;
  url: string;
  adminUsername: string;
  adminPassword?: string; // decrypted on demand only
  autoProvision: boolean;
  autoCreateCalendars: boolean;
  syncIntervalMinutes: number;
}

const ENCRYPTED_KEYS = new Set(['nextcloud_admin_password_encrypted']);

function parseValue<T = any>(raw: any, fallback: T): T {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string') {
    // Stored as JSON-encoded string
    try { return JSON.parse(raw) as T; } catch { return raw as any; }
  }
  return raw as T;
}

/** Read the global NextCloud settings (without decrypting the password). */
export async function getNextCloudConfig(includeSecret = false): Promise<NextCloudGlobalConfig | null> {
  const result = await pool.query(
    "SELECT key, value FROM admin_settings WHERE key LIKE 'nextcloud_%'"
  );
  const map: Record<string, any> = {};
  for (const row of result.rows) map[row.key] = row.value;

  const enabled = parseValue<boolean>(map.nextcloud_enabled, false) === true
    || map.nextcloud_enabled === 'true';
  const url = parseValue<string>(map.nextcloud_url, '');
  const adminUsername = parseValue<string>(map.nextcloud_admin_username, '');
  const autoProvision = parseValue<boolean>(map.nextcloud_auto_provision, false) === true;
  const autoCreateCalendars = parseValue<boolean>(map.nextcloud_auto_create_calendars, true) !== false;
  const syncIntervalMinutes = parseValue<number>(map.nextcloud_sync_interval, 15);

  if (!url || !adminUsername) {
    return enabled || includeSecret ? { enabled, url, adminUsername, autoProvision, autoCreateCalendars, syncIntervalMinutes } : null;
  }

  let adminPassword: string | undefined;
  if (includeSecret) {
    const encrypted = parseValue<string>(map.nextcloud_admin_password_encrypted, '');
    if (encrypted) {
      try {
        adminPassword = decrypt(encrypted);
      } catch (e) {
        logger.error(e as Error, 'Failed to decrypt NextCloud admin password');
        adminPassword = undefined;
      }
    }
  }

  return { enabled, url, adminUsername, adminPassword, autoProvision, autoCreateCalendars, syncIntervalMinutes };
}

/** Save NextCloud config; encrypts the admin password automatically. */
export async function saveNextCloudConfig(input: {
  enabled?: boolean;
  url?: string;
  adminUsername?: string;
  adminPassword?: string; // plaintext; will be encrypted
  autoProvision?: boolean;
  autoCreateCalendars?: boolean;
  syncIntervalMinutes?: number;
}): Promise<void> {
  const updates: Array<[string, string]> = [];
  if (input.enabled !== undefined) updates.push(['nextcloud_enabled', JSON.stringify(input.enabled)]);
  if (input.url !== undefined) updates.push(['nextcloud_url', JSON.stringify(input.url)]);
  if (input.adminUsername !== undefined) updates.push(['nextcloud_admin_username', JSON.stringify(input.adminUsername)]);
  if (input.adminPassword !== undefined && input.adminPassword !== '') {
    updates.push(['nextcloud_admin_password_encrypted', JSON.stringify(encrypt(input.adminPassword))]);
  }
  if (input.autoProvision !== undefined) updates.push(['nextcloud_auto_provision', JSON.stringify(input.autoProvision)]);
  if (input.autoCreateCalendars !== undefined) updates.push(['nextcloud_auto_create_calendars', JSON.stringify(input.autoCreateCalendars)]);
  if (input.syncIntervalMinutes !== undefined) updates.push(['nextcloud_sync_interval', JSON.stringify(input.syncIntervalMinutes)]);

  for (const [key, value] of updates) {
    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  }
}

/** Build an admin client (returns null if config is incomplete). */
export async function getAdminClient(): Promise<NextCloudAdminService | null> {
  const cfg = await getNextCloudConfig(true);
  if (!cfg || !cfg.enabled || !cfg.url || !cfg.adminUsername || !cfg.adminPassword) return null;
  return new NextCloudAdminService({
    url: cfg.url,
    adminUsername: cfg.adminUsername,
    adminPassword: cfg.adminPassword,
  });
}

/**
 * Build a per-user client using stored NC credentials. Returns null if the
 * user has not been provisioned on NextCloud.
 */
export async function getUserClient(userId: string): Promise<NextCloudService | null> {
  const cfg = await getNextCloudConfig(false);
  if (!cfg || !cfg.enabled || !cfg.url) return null;
  const result = await pool.query(
    `SELECT nc_username, nc_password_encrypted, is_active FROM nextcloud_users WHERE user_id = $1`,
    [userId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!row.is_active) return null;
  let password: string;
  try { password = decrypt(row.nc_password_encrypted); } catch { return null; }
  return new NextCloudService({ url: cfg.url, username: row.nc_username, password });
}

/**
 * Provision a NextCloud user account for the given app user.
 * If the NC user already exists or already mapped, skip silently.
 * Stores the (encrypted) generated password for later DAV calls.
 */
export async function provisionUserIfNeeded(userId: string): Promise<ProvisionedUser | null> {
  const cfg = await getNextCloudConfig(true);
  if (!cfg || !cfg.enabled || !cfg.adminPassword) return null;

  // Already mapped?
  const existing = await pool.query(`SELECT id FROM nextcloud_users WHERE user_id = $1`, [userId]);
  if (existing.rows.length > 0) return null;

  // Load app user
  const userRes = await pool.query(`SELECT email, display_name FROM users WHERE id = $1`, [userId]);
  if (userRes.rows.length === 0) return null;
  const u = userRes.rows[0];

  const admin = new NextCloudAdminService({
    url: cfg.url,
    adminUsername: cfg.adminUsername,
    adminPassword: cfg.adminPassword,
  });

  // Derive NC username from email local-part (sanitized)
  const ncUsername = (u.email as string).split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);

  let provisioned: ProvisionedUser;
  try {
    if (await admin.userExists(ncUsername)) {
      // User already exists in NC: we cannot retrieve its password, so skip silently.
      // Admin can manually link credentials via the dedicated endpoint.
      logger.warn({ userId, ncUsername }, 'NextCloud user already exists; skipping auto-provision');
      return null;
    }
    provisioned = await admin.createUser({
      userId: ncUsername,
      displayName: u.display_name || undefined,
      email: u.email,
    });
  } catch (e) {
    logger.error({ err: e, userId, ncUsername }, 'NextCloud provisioning failed');
    return null;
  }

  await pool.query(
    `INSERT INTO nextcloud_users (user_id, nc_username, nc_password_encrypted, nc_display_name, nc_email)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, ncUsername, encrypt(provisioned.initialPassword!), u.display_name, u.email]
  );

  logger.info({ userId, ncUsername }, 'NextCloud user provisioned');
  return provisioned;
}

/** Manually link an existing NC user to an app user (admin-only). */
export async function linkExistingNcUser(userId: string, ncUsername: string, ncPassword: string): Promise<void> {
  await pool.query(
    `INSERT INTO nextcloud_users (user_id, nc_username, nc_password_encrypted)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET nc_username = $2, nc_password_encrypted = $3, updated_at = NOW()`,
    [userId, ncUsername, encrypt(ncPassword)]
  );
}

/** Remove the NC mapping (does not delete the NC user account itself). */
export async function unlinkNcUser(userId: string): Promise<void> {
  await pool.query(`DELETE FROM nextcloud_users WHERE user_id = $1`, [userId]);
}
