/**
 * Device sessions — refresh-token rotation per device.
 *
 * Model:
 *   - Each physical device (browser profile, PWA install) owns one row in
 *     `device_sessions`. The row stores a SHA-256 hash of the current
 *     refresh token, never the plaintext.
 *   - Login/register issue a random 256-bit refresh token + a short-lived
 *     access JWT. The refresh token is delivered in an httpOnly cookie.
 *   - `/api/auth/refresh` rotates the refresh token: the old row is marked
 *     revoked (replaced_by) and a new row is inserted; the client receives
 *     a fresh cookie + access token.
 *   - Reuse detection: presenting a revoked refresh token means the token
 *     was likely stolen. The whole chain (all rows linked through
 *     replaced_by) is revoked and the user is forced to sign in again.
 *   - Sliding expiry: each rotation resets `expires_at` to now + 90 days.
 *
 * Security properties:
 *   - Stolen cookies lose value after first rotation (attacker and legitimate
 *     user race; the loser gets locked out).
 *   - Tokens are never stored in clear at rest — a DB dump does not grant
 *     session takeover.
 *   - Admins can list and revoke individual devices.
 */
import crypto from 'crypto';
import net from 'net';
import jwt from 'jsonwebtoken';
import { pool } from '../database/connection';

const REFRESH_TOKEN_BYTES = 32; // 256 bits of entropy
const REFRESH_TTL_DAYS = 90;
const ACCESS_TTL = '15m';
const DEVICE_COOKIE_DAYS = 365; // Chrome plafonne à 400 jours ; prolongé à chaque login/refresh

export const REFRESH_COOKIE_NAME = 'wm_refresh';
export const DEVICE_COOKIE_NAME = 'wm_device';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET (or SESSION_SECRET) must be set in production');
    }
    return 'dev-secret-change-me';
  }
  return secret;
}

export interface AccessTokenPayload {
  userId: string;
  isAdmin: boolean;
  sid: string; // device session id
}

export function generateAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AccessTokenPayload;
  } catch {
    return null;
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

function computeExpiresAt(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function truncate(str: string | undefined | null, max: number): string | null {
  if (!str) return null;
  return str.length > max ? str.slice(0, max) : str;
}

/** Derive a friendly device name from the User-Agent string. */
export function deriveDeviceName(ua: string | undefined): string {
  if (!ua) return 'Appareil inconnu';
  const lower = ua.toLowerCase();
  let os = 'Unknown';
  if (lower.includes('iphone')) os = 'iPhone';
  else if (lower.includes('ipad')) os = 'iPad';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('mac os x') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';

  let browser = 'Navigateur';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('chrome/') && !lower.includes('edg/')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/') && !lower.includes('chrome/')) browser = 'Safari';

  return `${browser} · ${os}`;
}

export interface DeviceSessionRow {
  id: string;
  user_id: string;
  device_name: string | null;
  user_agent: string | null;
  ip_last_seen: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface IssueResult {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Create a fresh device session for a user (typically on login/register). */
export async function createDeviceSession(
  userId: string,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<IssueResult> {
  const refreshToken = generateRefreshToken();
  const hash = hashToken(refreshToken);
  const expiresAt = computeExpiresAt();
  const deviceName = deriveDeviceName(userAgent);

  const result = await pool.query(
    `INSERT INTO device_sessions
       (user_id, refresh_token_hash, device_name, user_agent, ip_last_seen, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, hash, deviceName, truncate(userAgent, 512), truncate(ip, 45), expiresAt],
  );
  return { sessionId: result.rows[0].id, refreshToken, expiresAt };
}

/**
 * Rotate a refresh token: validate, revoke the current row, issue a new one.
 * On reuse (the presented token matches an already-revoked row), the entire
 * lineage is revoked to kick out a potential attacker.
 */
export async function rotateDeviceSession(
  presentedToken: string,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<(IssueResult & { userId: string; isAdmin: boolean }) | null> {
  const hash = hashToken(presentedToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lookup = await client.query(
      `SELECT ds.id, ds.user_id, ds.revoked_at, ds.expires_at, u.is_admin
         FROM device_sessions ds
         JOIN users u ON u.id = ds.user_id
        WHERE ds.refresh_token_hash = $1
        LIMIT 1`,
      [hash],
    );
    if (lookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = lookup.rows[0];

    // Reuse of an already-revoked token → possible theft. Kill the chain.
    if (row.revoked_at) {
      await client.query(
        `UPDATE device_sessions
            SET revoked_at = NOW()
          WHERE user_id = $1
            AND revoked_at IS NULL
            AND id IN (
              WITH RECURSIVE chain AS (
                SELECT id, replaced_by FROM device_sessions WHERE id = $2
                UNION ALL
                SELECT d.id, d.replaced_by
                  FROM device_sessions d
                  JOIN chain c ON d.id = c.replaced_by
              )
              SELECT id FROM chain
            )`,
        [row.user_id, row.id],
      );
      await client.query('COMMIT');
      return null;
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return null;
    }

    // Issue replacement
    const newToken = generateRefreshToken();
    const newHash = hashToken(newToken);
    const expiresAt = computeExpiresAt();
    const deviceName = deriveDeviceName(userAgent);

    const insert = await client.query(
      `INSERT INTO device_sessions
         (user_id, refresh_token_hash, device_name, user_agent, ip_last_seen, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [row.user_id, newHash, deviceName, truncate(userAgent, 512), truncate(ip, 45), expiresAt],
    );
    const newId = insert.rows[0].id;

    await client.query(
      `UPDATE device_sessions
          SET revoked_at = NOW(),
              replaced_by = $2,
              last_used_at = NOW(),
              ip_last_seen = COALESCE($3, ip_last_seen)
        WHERE id = $1`,
      [row.id, newId, truncate(ip, 45)],
    );

    await client.query('COMMIT');
    return {
      sessionId: newId,
      refreshToken: newToken,
      expiresAt,
      userId: row.user_id,
      isAdmin: row.is_admin,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a session as revoked (logout of that device). */
export async function revokeDeviceSession(sessionId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE device_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId],
  );
  return (result.rowCount || 0) > 0;
}

/** Revoke by presenting the token itself (used on logout with cookie). */
export async function revokeByToken(token: string): Promise<void> {
  const hash = hashToken(token);
  await pool.query(
    `UPDATE device_sessions SET revoked_at = NOW()
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
}

/** List active sessions for a user. */
export async function listDeviceSessions(userId: string): Promise<DeviceSessionRow[]> {
  const r = await pool.query(
    `SELECT id, user_id, device_name, user_agent, ip_last_seen,
            created_at, last_used_at, expires_at, revoked_at
       FROM device_sessions
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY last_used_at DESC`,
    [userId],
  );
  return r.rows;
}

export interface AdminDeviceSessionRow extends DeviceSessionRow {
  user_email: string;
  user_display_name: string | null;
  user_is_admin: boolean;
}

/** Admin-wide list of active device sessions joined with user info. */
export async function listAllActiveDeviceSessions(): Promise<AdminDeviceSessionRow[]> {
  const r = await pool.query(
    `SELECT ds.id, ds.user_id, ds.device_name, ds.user_agent, ds.ip_last_seen,
            ds.created_at, ds.last_used_at, ds.expires_at, ds.revoked_at,
            u.email AS user_email,
            u.display_name AS user_display_name,
            u.is_admin AS user_is_admin
       FROM device_sessions ds
       JOIN users u ON u.id = ds.user_id
      WHERE ds.revoked_at IS NULL
        AND ds.expires_at > NOW()
      ORDER BY u.display_name NULLS LAST, u.email, ds.last_used_at DESC`,
  );
  return r.rows;
}

/** Admin: revoke every active session of a single user. Returns count. */
export async function revokeAllUserDeviceSessions(userId: string): Promise<number> {
  const r = await pool.query(
    `UPDATE device_sessions
        SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return r.rowCount || 0;
}

/** Admin: revoke a single session without requiring ownership. */
export async function adminRevokeDeviceSession(sessionId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE device_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
  return (r.rowCount || 0) > 0;
}

/** Token de cookie d'appareil bien formé (base64url, 32 octets → 43 caractères). */
export function isValidDeviceToken(token: string | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{20,64}$/.test(token);
}

/**
 * Clé de sous-réseau pour la comparaison « même réseau » : /24 en IPv4,
 * /64 en IPv6 (les FAI attribuent généralement un /64 ou plus large par
 * client). Les adresses IPv4-mapped (::ffff:a.b.c.d) sont ramenées à l'IPv4.
 */
function subnetKey(ip: string | undefined | null): string | null {
  if (!ip) return null;
  let v = ip.trim();
  const pct = v.indexOf('%'); // zone IPv6 (fe80::1%eth0)
  if (pct >= 0) v = v.slice(0, pct);
  if (v.toLowerCase().startsWith('::ffff:') && v.includes('.')) v = v.slice(7);
  if (net.isIPv4(v)) {
    const parts = v.split('.');
    return `v4:${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  if (net.isIPv6(v)) {
    const halves = v.split('::');
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let groups: string[];
    if (halves.length === 1) {
      if (head.length !== 8) return null;
      groups = head;
    } else {
      const missing = 8 - head.length - tail.length;
      if (missing < 0) return null;
      groups = [...head, ...Array(missing).fill('0'), ...tail];
    }
    return `v6:${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}`;
  }
  return null;
}

function sameSubnet(a: string | undefined | null, b: string | undefined | null): boolean {
  const ka = subnetKey(a);
  return ka !== null && ka === subnetKey(b);
}

/**
 * « Cet appareil est-il déjà connu ? » — pour l'alerte de sécurité « nouvelle
 * connexion depuis un appareil inconnu ». Deux signaux, du plus fort au plus
 * faible :
 *  1. le cookie longue durée wm_device correspond à une ligne known_devices
 *     de cet utilisateur — identité du navigateur, insensible au User-Agent ;
 *  2. à défaut (migration depuis l'ancien schéma, cookies effacés) : le même
 *     nom d'appareil dérivé du User-Agent a déjà été vu depuis le même
 *     sous-réseau IP (/24 IPv4, /64 IPv6). Le nom seul ne suffit plus — un
 *     attaquant sous « Chrome · Windows » ne passe pas inaperçu pour autant.
 * À appeler AVANT createDeviceSession/registerKnownDevice, sinon la session
 * fraîchement créée rend l'appareil « connu ».
 * Renvoie aussi hasAnySession : false = première connexion de ce compte, où
 * l'alerte serait du bruit.
 */
export async function checkDeviceKnown(
  userId: string,
  userAgent: string | undefined,
  deviceToken: string | undefined,
  ip: string | undefined,
): Promise<{ known: boolean; hasAnySession: boolean; deviceName: string }> {
  const deviceName = deriveDeviceName(userAgent);

  const flags = await pool.query(
    `SELECT
       EXISTS(SELECT 1 FROM device_sessions WHERE user_id = $1) AS has_any,
       EXISTS(SELECT 1 FROM known_devices WHERE user_id = $1 AND token_hash = $2) AS cookie_known`,
    [userId, isValidDeviceToken(deviceToken) ? hashToken(deviceToken) : ''],
  );
  const hasAnySession = flags.rows[0].has_any === true;
  if (flags.rows[0].cookie_known === true) {
    return { known: true, hasAnySession, deviceName };
  }

  const ips = await pool.query(
    `SELECT DISTINCT ip_last_seen FROM device_sessions
      WHERE user_id = $1 AND device_name = $2 AND ip_last_seen IS NOT NULL`,
    [userId, deviceName],
  );
  const known = ips.rows.some((row) => sameSubnet(ip, row.ip_last_seen));
  return { known, hasAnySession, deviceName };
}

/**
 * Enregistre (ou rafraîchit) l'appareil courant comme connu, après un login
 * réussi. Réutilise le token présenté s'il est bien formé — il identifie le
 * navigateur, pas l'utilisateur : sur un poste partagé, chaque compte
 * enregistre le même token et personne ne reçoit de fausse alerte en
 * alternance. Renvoie le token à (re)poser en cookie wm_device.
 */
export async function registerKnownDevice(
  userId: string,
  presentedToken: string | undefined,
  userAgent: string | undefined,
  ip: string | undefined,
): Promise<string> {
  const token = isValidDeviceToken(presentedToken)
    ? presentedToken
    : crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  await pool.query(
    `INSERT INTO known_devices (user_id, token_hash, device_name, ip_last_seen)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, token_hash) DO UPDATE
       SET last_seen_at = NOW(),
           device_name = EXCLUDED.device_name,
           ip_last_seen = COALESCE(EXCLUDED.ip_last_seen, known_devices.ip_last_seen)`,
    [userId, hashToken(token), deriveDeviceName(userAgent), truncate(ip, 45)],
  );
  return token;
}

/** Look up a session id (used by the access-token middleware to verify it wasn't revoked). */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM device_sessions
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
      LIMIT 1`,
    [sessionId],
  );
  return r.rows.length > 0;
}

/** Parse a single cookie from the Cookie header without pulling in cookie-parser. */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return undefined;
}

/** Cookie options used everywhere we set/clear the refresh cookie. */
export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

/**
 * Options du cookie d'identité d'appareil (wm_device). Lax et non Strict :
 * le callback SSO est une navigation top-level venant de l'IdP — en Strict le
 * cookie ne serait pas envoyé et chaque login SSO déclencherait une fausse
 * alerte. Jamais effacé au logout : l'appareil reste connu entre deux sessions.
 */
export function deviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: DEVICE_COOKIE_DAYS * 24 * 60 * 60 * 1000,
  };
}
