/**
 * OAuth2 authentication for mail accounts.
 *
 * Currently supports Microsoft identity platform (v2.0) so that Outlook /
 * Microsoft 365 accounts with Modern Authentication (MFA / Microsoft
 * Authenticator) can connect to IMAP + SMTP via XOAUTH2. Microsoft disabled
 * Basic Auth for Exchange Online in September 2022, so OAuth2 is the only
 * officially supported mechanism for third-party IMAP clients.
 *
 * The same building blocks (authorize URL, token exchange, refresh, XOAUTH2
 * bearer) are reused for Google in a follow-up.
 */

import crypto from 'crypto';
import { pool } from '../database/connection';
import { encrypt, decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

export type OAuthProvider = 'microsoft' | 'google';

// -- Provider config -------------------------------------------------------

// Microsoft endpoints are built from the tenant. 'common' accepts both
// personal (outlook.com/hotmail.com) and work/school accounts. The tenant
// can be overridden via env var or the admin UI.
function msAuthorizeUrl(tenant: string) {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}
function msTokenUrl(tenant: string) {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

// Scopes required for IMAP + SMTP + profile. `offline_access` is mandatory
// to receive a refresh_token.
const MS_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'profile',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

/**
 * Read a setting from `admin_settings` (fallback for env vars). Values are
 * stored as JSON-encoded strings to match the existing NextCloud pattern.
 */
async function readAdminSetting(key: string): Promise<string | undefined> {
  try {
    const res = await pool.query('SELECT value FROM admin_settings WHERE key = $1', [key]);
    if (!res.rows.length) return undefined;
    const raw = res.rows[0].value;
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'string') {
      try { const parsed = JSON.parse(raw); return typeof parsed === 'string' ? parsed : raw; }
      catch { return raw; }
    }
    return String(raw);
  } catch (e) {
    logger.error(e as Error, 'readAdminSetting failed');
    return undefined;
  }
}

/**
 * Resolve Microsoft OAuth configuration.
 *
 * Priority order (highest first):
 *   1. Environment variables (set e.g. through Portainer / Docker compose)
 *   2. `admin_settings` table (configured via Admin UI)
 *
 * `admin_settings` is used as a fallback only — individual fields can be
 * mixed: e.g. env sets the client_id, DB provides the secret.
 */
export async function getMicrosoftConfig(): Promise<OAuthConfig> {
  const envClientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const envClientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const envTenant = process.env.MICROSOFT_OAUTH_TENANT?.trim();
  const envRedirect = process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim();

  const dbClientId = envClientId ? undefined : await readAdminSetting('microsoft_oauth_client_id');
  const dbTenant = envTenant ? undefined : await readAdminSetting('microsoft_oauth_tenant');
  const dbRedirect = envRedirect ? undefined : await readAdminSetting('microsoft_oauth_redirect_uri');
  let dbSecret: string | undefined;
  if (!envClientSecret) {
    const encrypted = await readAdminSetting('microsoft_oauth_client_secret_encrypted');
    if (encrypted) {
      try { dbSecret = decrypt(encrypted); }
      catch (e) { logger.error(e as Error, 'Failed to decrypt MICROSOFT_OAUTH_CLIENT_SECRET from admin_settings'); }
    }
  }

  const clientId = envClientId || dbClientId;
  const clientSecret = envClientSecret || dbSecret;
  const tenant = (envTenant || dbTenant || 'common').trim();
  const redirectUri =
    (envRedirect || dbRedirect)?.trim() ||
    `${(process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/admin/mail-accounts/oauth/microsoft/callback`;

  if (!clientId || !clientSecret) {
    throw new Error(
      "OAuth Microsoft non configuré : renseignez MICROSOFT_OAUTH_CLIENT_ID et MICROSOFT_OAUTH_CLIENT_SECRET (via Portainer/.env prioritaire, ou via Administration → Comptes mail → Configuration OAuth Microsoft).",
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl: msAuthorizeUrl(tenant),
    tokenUrl: msTokenUrl(tenant),
    scope: MS_SCOPES,
  };
}

async function getConfig(provider: OAuthProvider): Promise<OAuthConfig> {
  switch (provider) {
    case 'microsoft':
      return getMicrosoftConfig();
    default:
      throw new Error(`Fournisseur OAuth non supporté : ${provider}`);
  }
}

// -- Authorize URL ---------------------------------------------------------

/**
 * Build the provider authorize URL for the given state + loginHint.
 * `prompt=select_account` lets the user pick the right MS account even if
 * they are already signed in.
 */
export async function buildAuthorizeUrl(provider: OAuthProvider, state: string, loginHint?: string): Promise<string> {
  const cfg = await getConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: cfg.scope,
    state,
    prompt: 'select_account',
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

// -- Token exchange / refresh ---------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

async function postTokenRequest(
  cfg: OAuthConfig,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    ...params,
  });
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Réponse OAuth invalide: ${text}`); }
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `OAuth ${res.status}`);
  }
  return json as TokenResponse;
}

/** Decode the `email` / `preferred_username` claims from an id_token (JWT). */
function decodeIdToken(idToken: string | undefined): { email?: string; name?: string } {
  if (!idToken) return {};
  const parts = idToken.split('.');
  if (parts.length !== 3) return {};
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return {
      email: payload.email || payload.preferred_username || payload.upn,
      name: payload.name,
    };
  } catch {
    return {};
  }
}

export interface ExchangedTokens {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  email?: string;
  name?: string;
}

export async function exchangeCode(provider: OAuthProvider, code: string): Promise<ExchangedTokens> {
  const cfg = await getConfig(provider);
  const tok = await postTokenRequest(cfg, { grant_type: 'authorization_code', code });
  if (!tok.refresh_token) {
    throw new Error(
      "Le fournisseur n'a pas retourné de refresh_token (offline_access manquant ou consentement incomplet).",
    );
  }
  const { email, name } = decodeIdToken(tok.id_token);
  return {
    provider,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000),
    scope: tok.scope || cfg.scope,
    email,
    name,
  };
}

async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; scope: string }> {
  const cfg = await getConfig(provider);
  const tok = await postTokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken });
  return {
    accessToken: tok.access_token,
    // Microsoft may or may not rotate the refresh token. Keep the new one if
    // provided, otherwise reuse the previous one.
    refreshToken: tok.refresh_token || refreshToken,
    expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000),
    scope: tok.scope || cfg.scope,
  };
}

// -- Token hydration for a mail_accounts row ------------------------------

/**
 * Given a raw `mail_accounts` row, returns a fresh access token if the row is
 * an OAuth account. Refreshes and persists the token (encrypted) if the
 * current one has expired or is expiring within 2 minutes.
 *
 * Returns `null` when the account doesn't use OAuth — callers should then
 * fall back to `decrypt(password_encrypted)` as usual.
 */
export async function ensureFreshAccessToken(accountRow: any): Promise<string | null> {
  const provider = accountRow.oauth_provider as OAuthProvider | null;
  if (!provider) return null;
  if (!accountRow.oauth_refresh_token_encrypted) {
    throw new Error('Compte OAuth sans refresh_token : reconnectez le compte.');
  }

  const expiresAt = accountRow.oauth_token_expires_at
    ? new Date(accountRow.oauth_token_expires_at)
    : new Date(0);
  const needsRefresh = !accountRow.oauth_access_token_encrypted || Date.now() > expiresAt.getTime() - 2 * 60 * 1000;

  if (!needsRefresh) {
    try { return decrypt(accountRow.oauth_access_token_encrypted); }
    catch { /* fall through to refresh */ }
  }

  const refreshToken = decrypt(accountRow.oauth_refresh_token_encrypted);
  try {
    const fresh = await refreshAccessToken(provider, refreshToken);
    await pool.query(
      `UPDATE mail_accounts
         SET oauth_access_token_encrypted = $1,
             oauth_refresh_token_encrypted = $2,
             oauth_token_expires_at = $3,
             oauth_scope = $4,
             updated_at = NOW()
       WHERE id = $5`,
      [
        encrypt(fresh.accessToken),
        encrypt(fresh.refreshToken),
        fresh.expiresAt,
        fresh.scope,
        accountRow.id,
      ],
    );
    return fresh.accessToken;
  } catch (err: any) {
    logger.error({ err, accountId: accountRow.id }, 'OAuth token refresh failed');
    throw new Error(`Échec du rafraîchissement du jeton OAuth : ${err.message}`);
  }
}

// -- Pending OAuth session store ------------------------------------------
//
// After the popup callback, we stash the freshly obtained tokens under a
// short-lived server-side id keyed by the admin's express session. The admin
// form later submits just that id and we materialize the mail_account row.
//
// Using an in-memory map is fine here because:
//   - the popup closes within seconds of the redirect,
//   - the admin is on the same server (no horizontal scaling concerns for
//     this flow),
//   - tokens never transit through the client.

interface PendingOAuth {
  provider: OAuthProvider;
  email: string;
  name?: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
  scope: string;
  createdAt: number;
}

const PENDING: Map<string, PendingOAuth> = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

export function storePendingOAuth(userId: string, tokens: ExchangedTokens): string {
  // Purge expired entries
  const now = Date.now();
  for (const [k, v] of PENDING.entries()) {
    if (now - v.createdAt > PENDING_TTL_MS) PENDING.delete(k);
  }
  const id = `${userId}:${crypto.randomBytes(16).toString('hex')}`;
  PENDING.set(id, {
    provider: tokens.provider,
    email: tokens.email || '',
    name: tokens.name,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    createdAt: now,
  });
  return id;
}

export function consumePendingOAuth(userId: string, id: string): PendingOAuth | null {
  const entry = PENDING.get(id);
  if (!entry) return null;
  if (!id.startsWith(`${userId}:`)) return null; // belongs to someone else
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) {
    PENDING.delete(id);
    return null;
  }
  PENDING.delete(id);
  return entry;
}

export function peekPendingOAuth(userId: string, id: string): PendingOAuth | null {
  const entry = PENDING.get(id);
  if (!entry) return null;
  if (!id.startsWith(`${userId}:`)) return null;
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) {
    PENDING.delete(id);
    return null;
  }
  return entry;
}

// -- Admin UI configuration (admin_settings fallback) ---------------------

export interface MicrosoftOAuthSettingsStatus {
  configured: boolean;
  // Effective values that will be used at runtime (env overrides DB).
  clientId: string;
  hasClientSecret: boolean;
  tenant: string;
  redirectUri: string;
  // Which source each field comes from ('env' = set via process.env,
  // 'db' = stored in admin_settings, 'none' = unset).
  sources: {
    clientId: 'env' | 'db' | 'none';
    clientSecret: 'env' | 'db' | 'none';
    tenant: 'env' | 'db' | 'default';
    redirectUri: 'env' | 'db' | 'default';
  };
  // Values the admin has saved in DB (separate from effective values so the
  // admin can see what they configured, even if env currently overrides it).
  db: {
    clientId: string;
    hasClientSecret: boolean;
    tenant: string;
    redirectUri: string;
  };
}

/** Describe the current Microsoft OAuth configuration for the admin UI. */
export async function getMicrosoftOAuthSettingsStatus(): Promise<MicrosoftOAuthSettingsStatus> {
  const envClientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const envClientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const envTenant = process.env.MICROSOFT_OAUTH_TENANT?.trim();
  const envRedirect = process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim();

  const dbClientId = (await readAdminSetting('microsoft_oauth_client_id')) || '';
  const dbTenant = (await readAdminSetting('microsoft_oauth_tenant')) || '';
  const dbRedirect = (await readAdminSetting('microsoft_oauth_redirect_uri')) || '';
  const dbSecretEncrypted = await readAdminSetting('microsoft_oauth_client_secret_encrypted');
  const hasDbSecret = !!dbSecretEncrypted;

  const effectiveClientId = envClientId || dbClientId;
  const effectiveTenant = envTenant || dbTenant || 'common';
  const effectiveRedirect =
    envRedirect ||
    dbRedirect ||
    `${(process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/admin/mail-accounts/oauth/microsoft/callback`;
  const hasSecret = !!envClientSecret || hasDbSecret;

  return {
    configured: !!effectiveClientId && hasSecret,
    clientId: effectiveClientId,
    hasClientSecret: hasSecret,
    tenant: effectiveTenant,
    redirectUri: effectiveRedirect,
    sources: {
      clientId: envClientId ? 'env' : dbClientId ? 'db' : 'none',
      clientSecret: envClientSecret ? 'env' : hasDbSecret ? 'db' : 'none',
      tenant: envTenant ? 'env' : dbTenant ? 'db' : 'default',
      redirectUri: envRedirect ? 'env' : dbRedirect ? 'db' : 'default',
    },
    db: {
      clientId: dbClientId,
      hasClientSecret: hasDbSecret,
      tenant: dbTenant,
      redirectUri: dbRedirect,
    },
  };
}

/** Upsert a single admin_settings row (value JSON-encoded, NextCloud pattern). */
async function upsertAdminSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await pool.query('DELETE FROM admin_settings WHERE key = $1', [key]);
    return;
  }
  await pool.query(
    `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

/**
 * Save Microsoft OAuth settings from the Admin UI. Fields set to empty
 * string are cleared. `clientSecret` is only persisted when a non-empty
 * value is provided (so admins can update other fields without re-entering
 * the secret). Use `clearClientSecret: true` to delete it.
 */
export async function saveMicrosoftOAuthSettings(input: {
  clientId?: string;
  clientSecret?: string;
  clearClientSecret?: boolean;
  tenant?: string;
  redirectUri?: string;
}): Promise<void> {
  if (input.clientId !== undefined) {
    await upsertAdminSetting('microsoft_oauth_client_id', input.clientId.trim() || null);
  }
  if (input.tenant !== undefined) {
    await upsertAdminSetting('microsoft_oauth_tenant', input.tenant.trim() || null);
  }
  if (input.redirectUri !== undefined) {
    await upsertAdminSetting('microsoft_oauth_redirect_uri', input.redirectUri.trim() || null);
  }
  if (input.clearClientSecret) {
    await upsertAdminSetting('microsoft_oauth_client_secret_encrypted', null);
  } else if (input.clientSecret !== undefined && input.clientSecret.trim() !== '') {
    await upsertAdminSetting(
      'microsoft_oauth_client_secret_encrypted',
      encrypt(input.clientSecret.trim()),
    );
  }
}
