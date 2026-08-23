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
export async function buildAuthorizeUrl(
  provider: OAuthProvider,
  state: string,
  loginHint?: string,
  forceConsent?: boolean,
): Promise<string> {
  const cfg = await getConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: cfg.scope,
    state,
    // Use 'consent' when re-authenticating so Microsoft re-shows the permission
    // screen and re-grants all scopes (including IMAP.AccessAsUser.All).
    // Without this, a prior authorization without IMAP scope is silently reused.
    prompt: forceConsent ? 'consent' : 'select_account',
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

/**
 * Erreur du point de terminaison /token, enrichie de quoi la classer :
 * `oauthError` est le champ `error` de la réponse, `httpStatus` le code HTTP.
 * Quand les deux sont absents, la requête n'a jamais atteint le serveur
 * (DNS, réseau coupé, délai dépassé) — jamais la faute du compte.
 */
class OAuthTokenError extends Error {
  constructor(
    message: string,
    readonly oauthError?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'OAuthTokenError';
  }
}

/**
 * Coupe-circuit sur l'appel /token. Sans lui, une requête bloquée garderait le
 * verrou du compte (voir `refreshLocks`) et ferait patienter toutes les
 * requêtes qui visent la même boîte.
 */
const TOKEN_REQUEST_TIMEOUT_MS = 20_000;

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
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new OAuthTokenError(
      e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? `Délai dépassé en contactant ${cfg.tokenUrl}`
        : `Serveur OAuth injoignable : ${e?.message || e}`,
    );
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); }
  catch {
    throw new OAuthTokenError(
      `Réponse OAuth invalide (HTTP ${res.status}) : ${text.slice(0, 200)}`,
      undefined,
      res.status,
    );
  }
  if (!res.ok) {
    throw new OAuthTokenError(
      json.error_description || json.error || `OAuth ${res.status}`,
      json.error,
      res.status,
    );
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

// -- Santé du lien OAuth ---------------------------------------------------

/**
 * État persisté dans `mail_accounts.oauth_status`.
 *
 *  - `ok`           : dernier rafraîchissement réussi.
 *  - `degraded`     : échec passager (réseau, 5xx, throttling). Les jetons
 *                     sont conservés et on retente après un temps de repos.
 *  - `needs_reauth` : le grant est mort (jeton révoqué ou expiré, mot de passe
 *                     changé, consentement retiré). Seul un nouveau passage
 *                     par le popup OAuth répare. On cesse alors de rejouer le
 *                     refresh token : rejouer un jeton révoqué est précisément
 *                     ce qui pousse Microsoft à révoquer toute la famille.
 *  - `config_error` : l'inscription d'application est en cause (secret client
 *                     expiré, scope non consenti…). Relier les comptes un par
 *                     un n'y changerait rien — c'est la configuration Azure à
 *                     corriger, et le symptôme touche tous les comptes d'un
 *                     coup.
 */
export type OAuthAccountStatus = 'ok' | 'degraded' | 'needs_reauth' | 'config_error';

export const OAUTH_REAUTH_HINT =
  'Reconnectez le compte via Administration → Comptes mail → Modifier → « Se connecter avec Microsoft ».';
export const OAUTH_CONFIG_HINT =
  'Vérifiez Administration → Comptes mail → Configuration OAuth Microsoft : un secret client Azure expire au bout de 24 mois au maximum.';

interface RefreshFailure {
  status: Exclude<OAuthAccountStatus, 'ok'>;
  message: string;
}

/** Codes AADSTS imputables à l'inscription d'application, pas au compte. */
const CONFIG_AADSTS = new Set(['7000215', '7000222', '700016', '700027', '500011', '650057', '900023']);
/** Codes AADSTS qui exigent un nouveau consentement interactif. */
const REAUTH_AADSTS = new Set(['50173', '700082', '700081', '70008', '65001', '50076', '50078', '50058', '54005']);

/**
 * Traduit une erreur du point de terminaison /token en état de compte.
 *
 * Règle de prudence : tout ce qui n'est pas formellement identifié comme
 * définitif est classé `degraded`. Un faux « à reconnecter » enverrait
 * l'administrateur relier des comptes qui n'ont rien ; un faux « passager » ne
 * coûte qu'un délai avant d'afficher le bon message, et l'escalade après
 * `DEGRADED_ESCALATION_FAILURES` échecs finit par le corriger.
 */
function classifyRefreshError(err: any): RefreshFailure {
  const message = String(err?.message || err || 'Erreur inconnue');
  const oauthError = err instanceof OAuthTokenError ? err.oauthError : undefined;
  const httpStatus = err instanceof OAuthTokenError ? err.httpStatus : undefined;
  const aadsts = /AADSTS(\d{4,6})/.exec(message)?.[1];

  // Throttling ou panne côté Microsoft : sans rapport avec le compte.
  if (httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)) {
    return { status: 'degraded', message: `Microsoft indisponible (HTTP ${httpStatus}) : ${message}` };
  }
  // Aucun statut HTTP ni code d'erreur = le serveur n'a jamais été joint.
  if (httpStatus === undefined && !oauthError) {
    return { status: 'degraded', message };
  }

  if (
    oauthError === 'invalid_client' ||
    oauthError === 'unauthorized_client' ||
    oauthError === 'invalid_scope' ||
    (aadsts && CONFIG_AADSTS.has(aadsts))
  ) {
    return { status: 'config_error', message };
  }

  if (
    oauthError === 'invalid_grant' ||
    oauthError === 'interaction_required' ||
    oauthError === 'consent_required' ||
    oauthError === 'login_required' ||
    (aadsts && REAUTH_AADSTS.has(aadsts))
  ) {
    return { status: 'needs_reauth', message };
  }

  return { status: 'degraded', message };
}

/** Un échec « passager » qui dure n'en est plus un. */
const DEGRADED_ESCALATION_FAILURES = 8;

/** Temps de repos après un échec : 1 min, puis doublement, plafonné à 30 min. */
function cooldownMs(failures: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, failures - 1), 30 * 60_000);
}

function userFacingMessage(status: Exclude<OAuthAccountStatus, 'ok'>, detail: string): string {
  switch (status) {
    case 'needs_reauth':
      return `Le lien OAuth de ce compte n'est plus valide (${detail}). ${OAUTH_REAUTH_HINT}`;
    case 'config_error':
      return `Configuration OAuth Microsoft en cause (${detail}). ${OAUTH_CONFIG_HINT}`;
    default:
      return `Rafraîchissement du jeton OAuth momentanément impossible : ${detail}`;
  }
}

async function persistRefreshFailure(
  accountId: string,
  status: Exclude<OAuthAccountStatus, 'ok'>,
  message: string,
  failures: number,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE mail_accounts
          SET oauth_status = $1, oauth_last_error = $2, oauth_last_error_at = NOW(),
              oauth_refresh_failures = $3
        WHERE id = $4`,
      [status, message.slice(0, 500), failures, accountId],
    );
  } catch (e) {
    logger.error(e as Error, 'OAuth: enregistrement du statut du compte impossible');
  }
}

// -- Token hydration for a mail_accounts row ------------------------------

/**
 * Marge par défaut avant expiration. Elle est large pour que les requêtes HTTP
 * n'aient en pratique jamais à rafraîchir elles-mêmes : le rafraîchisseur de
 * fond (services/oauthTokenRefresher.ts) passe avant, seul et en série.
 */
const DEFAULT_REFRESH_MARGIN_MS = 10 * 60_000;

/**
 * Un rafraîchissement en cours par compte. C'est le cœur du correctif : sans
 * ce verrou, une rafale de requêtes concurrentes — typiquement au redémarrage
 * du serveur, quand tous les onglets rechargent en même temps — déclenchait
 * autant d'appels /token avec le MÊME refresh token. Microsoft fait tourner
 * ces jetons et détecte la réutilisation : la famille entière était révoquée,
 * et le compte devait être relié à la main.
 */
const refreshLocks = new Map<string, Promise<string>>();
/** Comptes au repos après un échec : { échéance, message à resservir }. */
const cooldownUntil = new Map<string, { until: number; message: string }>();

/** Efface l'état d'échec gardé en mémoire (après une reconnexion réussie). */
export function resetOAuthFailureState(accountId: string): void {
  cooldownUntil.delete(String(accountId));
}

function readCachedAccessToken(row: any, marginMs: number): string | null {
  if (!row.oauth_access_token_encrypted || !row.oauth_token_expires_at) return null;
  if (new Date(row.oauth_token_expires_at).getTime() - Date.now() <= marginMs) return null;
  try { return decrypt(row.oauth_access_token_encrypted); }
  catch { return null; }
}

/**
 * Given a raw `mail_accounts` row, returns a fresh access token if the row is
 * an OAuth account. Refreshes and persists the token (encrypted) when the
 * current one expires within `marginMs`.
 *
 * Returns `null` when the account doesn't use OAuth — callers should then
 * fall back to `decrypt(password_encrypted)` as usual.
 */
export async function ensureFreshAccessToken(
  accountRow: any,
  opts: { marginMs?: number } = {},
): Promise<string | null> {
  const provider = accountRow.oauth_provider as OAuthProvider | null;
  if (!provider) return null;
  const marginMs = opts.marginMs ?? DEFAULT_REFRESH_MARGIN_MS;

  // Voie rapide : jeton encore confortablement valide, ni verrou ni requête.
  const cached = readCachedAccessToken(accountRow, marginMs);
  if (cached) return cached;

  const accountId = String(accountRow.id);
  const pending = refreshLocks.get(accountId);
  if (pending) return pending;

  const p = refreshLocked(accountId, provider, marginMs)
    .finally(() => { refreshLocks.delete(accountId); });
  refreshLocks.set(accountId, p);
  return p;
}

async function refreshLocked(
  accountId: string,
  provider: OAuthProvider,
  marginMs: number,
): Promise<string> {
  // Relecture systématique de la ligne. Celle reçue par l'appelant peut dater
  // d'avant un rafraîchissement concurrent, et rejouer un refresh token périmé
  // est exactement ce qu'on cherche à éviter.
  const res = await pool.query(
    `SELECT id, oauth_provider, oauth_status, oauth_last_error, oauth_refresh_failures,
            oauth_refresh_token_encrypted, oauth_access_token_encrypted, oauth_token_expires_at
       FROM mail_accounts WHERE id = $1`,
    [accountId],
  );
  if (!res.rows.length) throw new Error('Compte mail introuvable.');
  const row = res.rows[0];
  const failures = Number(row.oauth_refresh_failures || 0);

  // Un autre appelant a pu rafraîchir pendant qu'on attendait le verrou.
  const alreadyFresh = readCachedAccessToken(row, marginMs);
  if (alreadyFresh) return alreadyFresh;

  if (!row.oauth_refresh_token_encrypted) {
    await persistRefreshFailure(accountId, 'needs_reauth', 'Compte OAuth sans refresh token.', failures + 1);
    throw new Error(userFacingMessage('needs_reauth', 'aucun refresh token enregistré'));
  }

  // Jeton déjà connu comme révoqué : ne pas le rejouer.
  if (row.oauth_status === 'needs_reauth') {
    throw new Error(userFacingMessage('needs_reauth', row.oauth_last_error || 'jeton révoqué'));
  }

  const cool = cooldownUntil.get(accountId);
  if (cool && Date.now() < cool.until) {
    // Le jeton courant est peut-être encore techniquement valide : mieux vaut
    // s'en servir jusqu'à sa vraie expiration que de faire échouer la requête.
    const stillUsable = readCachedAccessToken(row, 0);
    if (stillUsable) return stillUsable;
    throw new Error(cool.message);
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(row.oauth_refresh_token_encrypted);
  } catch {
    await persistRefreshFailure(
      accountId, 'needs_reauth',
      'Jeton illisible — ENCRYPTION_KEY différente de celle utilisée lors de la liaison ?',
      failures + 1,
    );
    throw new Error(userFacingMessage('needs_reauth', 'jeton illisible (ENCRYPTION_KEY modifiée ?)'));
  }

  let fresh: { accessToken: string; refreshToken: string; expiresAt: Date; scope: string };
  try {
    fresh = await refreshAccessToken(provider, refreshToken);
  } catch (err: any) {
    const failure = classifyRefreshError(err);
    const nextFailures = failures + 1;
    let status = failure.status;
    if (status === 'degraded' && nextFailures >= DEGRADED_ESCALATION_FAILURES) status = 'needs_reauth';
    await persistRefreshFailure(accountId, status, failure.message, nextFailures);
    const message = userFacingMessage(status, failure.message);
    logger.warn({ accountId, status, failures: nextFailures }, `OAuth refresh failed: ${failure.message}`);
    if (status !== 'needs_reauth') {
      cooldownUntil.set(accountId, { until: Date.now() + cooldownMs(nextFailures), message });
      const stillUsable = readCachedAccessToken(row, 0);
      if (stillUsable) return stillUsable;
    }
    throw new Error(message);
  }

  // Écriture gardée sur le refresh token qu'on vient d'utiliser : si un autre
  // écrivain l'a fait tourner entre-temps, l'UPDATE ne touche aucune ligne et
  // on n'écrase pas un jeton plus récent par un plus ancien.
  const upd = await pool.query(
    `UPDATE mail_accounts
        SET oauth_access_token_encrypted = $1,
            oauth_refresh_token_encrypted = $2,
            oauth_token_expires_at = $3,
            oauth_scope = $4,
            oauth_status = 'ok',
            oauth_last_error = NULL,
            oauth_last_error_at = NULL,
            oauth_refresh_failures = 0,
            oauth_last_refresh_at = NOW(),
            updated_at = NOW()
      WHERE id = $5 AND oauth_refresh_token_encrypted = $6
      RETURNING id`,
    [
      encrypt(fresh.accessToken),
      encrypt(fresh.refreshToken),
      fresh.expiresAt,
      fresh.scope,
      accountId,
      row.oauth_refresh_token_encrypted,
    ],
  );
  cooldownUntil.delete(accountId);
  if (upd.rowCount === 0) {
    // L'access token obtenu reste valable pour cet appel, on le sert quand même.
    logger.warn({ accountId }, 'OAuth: rafraîchissement concurrent détecté, écriture ignorée');
  }
  return fresh.accessToken;
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
