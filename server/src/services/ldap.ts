import { Client, InvalidCredentialsError } from 'ldapts';
import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';

export interface LdapConfig {
  enabled: boolean;
  url: string;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
  displayNameAttr: string;
  adminGroupDn: string;           // explicit full DN (optional)
  adminGroupNames: string[];      // auto-detect by CN (default: admin, administrateur…)
  tlsRejectUnauthorized: boolean;
  fallbackLocal: boolean;
}

export interface LdapUser {
  dn: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  memberOfDns: string[];
}

const DEFAULT_ADMIN_GROUP_NAMES = ['admin', 'administrateur', 'administrators', 'admins'];

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

  let adminGroupNames: string[] = DEFAULT_ADMIN_GROUP_NAMES;
  if (s['ldap_admin_group_names']) {
    const raw = typeof s['ldap_admin_group_names'] === 'string'
      ? s['ldap_admin_group_names']
      : String(s['ldap_admin_group_names']);
    const parsed = raw.split(',').map((n: string) => n.trim().toLowerCase()).filter(Boolean);
    if (parsed.length > 0) adminGroupNames = parsed;
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
    adminGroupNames,
    tlsRejectUnauthorized: s['ldap_tls_reject_unauthorized'] !== false && s['ldap_tls_reject_unauthorized'] !== 'false',
    fallbackLocal: s['ldap_fallback_local'] === true || s['ldap_fallback_local'] === 'true',
  };
}

/** Extract the CN value from a DN string, e.g. "cn=admin,ou=groups,dc=example,dc=com" → "admin" */
function extractCn(dn: string): string {
  const match = dn.match(/^cn=([^,]+)/i);
  return match ? match[1].toLowerCase() : '';
}

/** Returns true if any of the group DNs matches the configured admin group (by full DN or by CN name). */
function isAdminByGroups(memberOfDns: string[], cfg: LdapConfig): boolean {
  for (const dn of memberOfDns) {
    const dnLower = dn.toLowerCase();
    if (cfg.adminGroupDn && dnLower === cfg.adminGroupDn.toLowerCase()) return true;
    if (cfg.adminGroupNames.includes(extractCn(dn))) return true;
  }
  return false;
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

/**
 * Full LDAP → app group sync for a user.
 *
 * Phase 1 — Manual mappings (ldap_group_mappings table, advanced overrides):
 *   Add/remove based on explicit DN → group_id entries.
 *
 * Phase 2 — Auto-sync by CN:
 *   For every LDAP group the user belongs to:
 *     - Find app group by ldap_dn match first, then by name (case-insensitive).
 *     - If found and ldap_dn not set yet: attach ldap_dn to that group.
 *     - If not found: create the group.
 *     - Add the user.
 *   Remove the user from app groups whose ldap_dn is set but is no longer
 *   in their current memberOf list (and not covered by a manual mapping).
 *
 * Phase 3 — Admin flag: updated from group membership.
 */
export async function syncLdapGroups(userId: string, memberOfDns: string[], cfg: LdapConfig): Promise<void> {
  const normalisedDns = memberOfDns.map(dn => dn.toLowerCase());

  // ── Phase 1: manual mappings ─────────────────────────────────────────────
  const manualMappings = await pool.query<{ ldap_dn: string; group_id: string }>(
    `SELECT ldap_dn, group_id FROM ldap_group_mappings`
  );
  const manualGroupIds = new Set<string>();

  for (const row of manualMappings.rows) {
    const isMember = normalisedDns.includes(row.ldap_dn.toLowerCase());
    manualGroupIds.add(row.group_id);
    if (isMember) {
      await pool.query(
        `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, row.group_id]
      );
    } else {
      await pool.query(
        `DELETE FROM user_groups WHERE user_id = $1 AND group_id = $2`,
        [userId, row.group_id]
      );
    }
  }

  // ── Phase 2: auto-sync by CN ──────────────────────────────────────────────
  for (const dn of memberOfDns) {
    const cn = extractCn(dn);
    if (!cn) continue;

    // Find by ldap_dn exact match OR by name (case-insensitive)
    const found = await pool.query<{ id: string; ldap_dn: string | null }>(
      `SELECT id, ldap_dn FROM groups WHERE ldap_dn = $1 OR LOWER(name) = LOWER($2) LIMIT 1`,
      [dn, cn]
    );

    let groupId: string;

    if (found.rows.length > 0) {
      groupId = found.rows[0].id;
      // Attach ldap_dn if not already set
      if (!found.rows[0].ldap_dn) {
        await pool.query(`UPDATE groups SET ldap_dn = $1 WHERE id = $2`, [dn, groupId]);
      }
    } else {
      // Create the group
      const created = await pool.query<{ id: string }>(
        `INSERT INTO groups (name, ldap_dn, color) VALUES ($1, $2, '#0078D4') RETURNING id`,
        [cn.charAt(0).toUpperCase() + cn.slice(1), dn]
      );
      groupId = created.rows[0].id;
    }

    await pool.query(
      `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, groupId]
    );
  }

  // Remove user from LDAP-sourced groups they are no longer a member of
  // (only groups with ldap_dn set, not covered by a manual mapping)
  await pool.query(
    `DELETE FROM user_groups ug
     USING groups g
     WHERE ug.user_id = $1
       AND ug.group_id = g.id
       AND g.ldap_dn IS NOT NULL
       AND LOWER(g.ldap_dn) <> ALL($2::text[])
       AND g.id <> ALL($3::uuid[])`,
    [
      userId,
      normalisedDns,
      manualGroupIds.size > 0 ? [...manualGroupIds] : ['00000000-0000-0000-0000-000000000000'],
    ]
  );

  // ── Phase 3: admin flag ───────────────────────────────────────────────────
  const shouldBeAdmin = isAdminByGroups(memberOfDns, cfg);
  await pool.query(
    `UPDATE users SET is_admin = $1, role = $2, updated_at = NOW() WHERE id = $3`,
    [shouldBeAdmin, shouldBeAdmin ? 'admin' : 'user', userId]
  );
}

export async function authenticateLdapUser(
  cfg: LdapConfig,
  email: string,
  password: string
): Promise<LdapUser | null> {
  const client = buildClient(cfg);
  try {
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

    const userClient = buildClient(cfg);
    try {
      await userClient.bind(userDn, password);
    } catch (err) {
      if (err instanceof InvalidCredentialsError) return null;
      throw err;
    } finally {
      await userClient.unbind().catch(() => {});
    }

    const memberOf = entry['memberOf'];
    const memberOfDns = (Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : []).map(String);

    const isAdmin = isAdminByGroups(memberOfDns, cfg);

    const rawName = entry[cfg.displayNameAttr];
    const displayName = Array.isArray(rawName) ? rawName[0] : rawName ?? email;

    return { dn: userDn, email, displayName: String(displayName), isAdmin, memberOfDns };
  } finally {
    await client.unbind().catch(() => {});
  }
}
