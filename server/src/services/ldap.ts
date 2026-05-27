import { Client, InvalidCredentialsError } from 'ldapts';
import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';

export interface LdapConfig {
  enabled: boolean;
  url: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;           // e.g. (mail={{email}})
  displayNameAttr: string;      // e.g. displayName or cn
  adminGroupDn: string;         // optional: DN of LDAP group granting admin
  tlsRejectUnauthorized: boolean;
  fallbackLocal: boolean;       // allow local bcrypt if LDAP unreachable
}

export interface LdapUser {
  dn: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export async function getLdapConfig(): Promise<LdapConfig> {
  const result = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key LIKE 'ldap_%'`
  );
  const s: Record<string, any> = {};
  for (const row of result.rows) s[row.key] = row.value;

  let bindPassword = '';
  if (s['ldap_bind_password']) {
    try {
      bindPassword = decrypt(s['ldap_bind_password']);
    } catch {
      bindPassword = '';
    }
  }

  return {
    enabled: s['ldap_enabled'] === true || s['ldap_enabled'] === 'true',
    url: s['ldap_url'] ?? '',
    bindDn: s['ldap_bind_dn'] ?? '',
    bindPassword,
    baseDn: s['ldap_base_dn'] ?? '',
    userFilter: s['ldap_user_filter'] ?? '(mail={{email}})',
    displayNameAttr: s['ldap_display_name_attr'] ?? 'displayName',
    adminGroupDn: s['ldap_admin_group_dn'] ?? '',
    tlsRejectUnauthorized: s['ldap_tls_reject_unauthorized'] !== false && s['ldap_tls_reject_unauthorized'] !== 'false',
    fallbackLocal: s['ldap_fallback_local'] === true || s['ldap_fallback_local'] === 'true',
  };
}

function buildClient(cfg: LdapConfig): Client {
  return new Client({
    url: cfg.url,
    tlsOptions: { rejectUnauthorized: cfg.tlsRejectUnauthorized },
    connectTimeout: 5000,
    timeout: 10000,
  });
}

export async function testLdapConnection(cfg: LdapConfig): Promise<{ ok: boolean; message: string; userCount?: number }> {
  const client = buildClient(cfg);
  try {
    await client.bind(cfg.bindDn, cfg.bindPassword);
    const filter = cfg.userFilter.replace('{{email}}', '*');
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      sizeLimit: 5,
      attributes: ['dn', cfg.displayNameAttr, 'mail'],
    });
    return { ok: true, message: 'Connexion réussie', userCount: searchEntries.length };
  } catch (err: any) {
    return { ok: false, message: err.message ?? 'Erreur inconnue' };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function authenticateLdapUser(
  cfg: LdapConfig,
  email: string,
  password: string
): Promise<LdapUser | null> {
  const client = buildClient(cfg);
  try {
    // Bind with service account to find the user DN
    await client.bind(cfg.bindDn, cfg.bindPassword);

    const filter = cfg.userFilter.replace('{{email}}', email.replace(/[*()\\\x00]/g, '\\$&'));
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      sizeLimit: 1,
      attributes: ['dn', cfg.displayNameAttr, 'mail', 'memberOf'],
    });

    if (searchEntries.length === 0) return null;

    const entry = searchEntries[0];
    const userDn = entry.dn;

    // Bind with the user's credentials to verify password
    const userClient = buildClient(cfg);
    try {
      await userClient.bind(userDn, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) return null;
      throw err;
    } finally {
      await userClient.unbind().catch(() => {});
    }

    // Check admin group membership (if configured)
    let isAdmin = false;
    if (cfg.adminGroupDn) {
      const memberOf = entry['memberOf'];
      const groups = Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : [];
      isAdmin = groups.some((g) =>
        String(g).toLowerCase() === cfg.adminGroupDn.toLowerCase()
      );
    }

    const rawName = entry[cfg.displayNameAttr];
    const displayName = Array.isArray(rawName) ? rawName[0] : rawName ?? email;

    return { dn: userDn, email, displayName: String(displayName), isAdmin };
  } finally {
    await client.unbind().catch(() => {});
  }
}
