import { Issuer, generators, custom, type Client } from 'openid-client';
import https from 'https';
import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';

export interface SsoConfig {
  enabled: boolean;
  providerName: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tlsRejectUnauthorized: boolean;
}

export async function getSsoConfig(): Promise<SsoConfig> {
  const result = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key LIKE 'sso_%'`
  );
  const s: Record<string, any> = {};
  for (const row of result.rows) s[row.key] = row.value;

  let clientSecret = '';
  if (s['sso_client_secret']) {
    try {
      clientSecret = decrypt(s['sso_client_secret']);
    } catch {
      clientSecret = '';
    }
  }

  return {
    enabled: s['sso_enabled'] === true || s['sso_enabled'] === 'true',
    providerName: typeof s['sso_provider_name'] === 'string' ? s['sso_provider_name'] : 'Synology SSO',
    issuerUrl: typeof s['sso_issuer_url'] === 'string' ? s['sso_issuer_url'] : '',
    clientId: typeof s['sso_client_id'] === 'string' ? s['sso_client_id'] : '',
    clientSecret,
    redirectUri: typeof s['sso_redirect_uri'] === 'string' ? s['sso_redirect_uri'] : '',
    tlsRejectUnauthorized: s['sso_tls_reject_unauthorized'] !== false && s['sso_tls_reject_unauthorized'] !== 'false',
  };
}

// Cache OIDC clients to avoid re-discovering on every request.
// Keyed on every field that shapes the client (secret, redirectUri, TLS), so a
// config change or a different Host (dynamic redirectUri) never reuses a stale
// client. Bounded to avoid unbounded growth if Host headers vary wildly.
const _cache = new Map<string, Client>();
const CACHE_MAX = 10;

function cacheKey(cfg: SsoConfig): string {
  return [cfg.issuerUrl, cfg.clientId, cfg.clientSecret, cfg.redirectUri, String(cfg.tlsRejectUnauthorized)].join('\u0000');
}

export async function buildOidcClient(cfg: SsoConfig): Promise<Client> {
  const key = cacheKey(cfg);
  const cached = _cache.get(key);
  if (cached) return cached;

  const agent = new https.Agent({ rejectUnauthorized: cfg.tlsRejectUnauthorized });

  // Apply custom HTTP agent for self-signed certificate support
  const httpOptions = () => ({ agent });
  (Issuer as any)[custom.http_options] = httpOptions;

  const issuer = await Issuer.discover(cfg.issuerUrl);
  const client = new issuer.Client({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uris: [cfg.redirectUri],
    response_types: ['code'],
  });

  // Apply agent to client requests too
  (client as any)[custom.http_options] = httpOptions;

  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, client);
  return client;
}

/** Invalidate the OIDC client cache (call after config change). */
export function invalidateSsoCache() {
  _cache.clear();
}

export { generators };
