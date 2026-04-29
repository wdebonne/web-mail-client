/**
 * WebAuthn / Passkeys — platform authenticators (Touch ID, Face ID, Windows
 * Hello, Android biometrics) used for two purposes:
 *
 *  1. **Local PWA unlock** after N days of inactivity — a biometric prompt
 *     releases a fresh access token without retyping the password.
 *  2. **Step-up 2FA** when an account has at least one registered credential:
 *     password alone is not enough, the user must also prove possession of
 *     their device.
 *
 * Challenges are stored server-side (short-lived rows) so the ceremony is
 * stateless from the client's point of view.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { pool } from '../database/connection';

const CHALLENGE_TTL_MINUTES = 5;

/**
 * Extract the hostname from a URL-ish string. Tolerates inputs that the user
 * copy-pasted with `https://`, a port, a trailing slash, or even just a bare
 * hostname. Returns null when nothing usable can be derived.
 */
function hostnameOf(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  // Try parsing as URL first (handles http://, https://, with/without port).
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return u.hostname || null;
  } catch {
    // Fallback: strip scheme/path/port manually.
    return trimmed
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .split(':')[0] || null;
  }
}

/**
 * Effective RP ID. Priority:
 *   1. `WEBAUTHN_RP_ID` env var (sanitized — scheme/port/slash stripped).
 *   2. Hostname derived from `WEBAUTHN_ORIGIN` (first entry).
 *   3. Hostname derived from `APP_URL`.
 *   4. `localhost` as last resort.
 */
function rpID(): string {
  const explicit = hostnameOf(process.env.WEBAUTHN_RP_ID);
  if (explicit) return explicit;
  const fromOrigin = hostnameOf((process.env.WEBAUTHN_ORIGIN || '').split(',')[0]);
  if (fromOrigin) return fromOrigin;
  const fromAppUrl = hostnameOf(process.env.APP_URL);
  if (fromAppUrl) return fromAppUrl;
  return 'localhost';
}

function rpName(): string {
  return process.env.WEBAUTHN_RP_NAME || 'Web Mail';
}

/** Diagnostic snapshot of the resolved WebAuthn config. */
export function getWebAuthnConfig(): { rpID: string; rpName: string; origins: string[] } {
  const o = origin();
  return {
    rpID: rpID(),
    rpName: rpName(),
    origins: Array.isArray(o) ? o : [o],
  };
}

/**
 * Build the list of accepted origins for verification. We always include both
 * `WEBAUTHN_ORIGIN` (comma-separated allowed) and `APP_URL`, plus the bare
 * `https://<rpID>` form so a user who only configured `WEBAUTHN_RP_ID` still
 * gets a working setup.
 */
function origin(): string | string[] {
  const candidates = new Set<string>();
  const add = (raw: string | undefined | null) => {
    if (!raw) return;
    raw.split(',').forEach((s) => {
      const v = s.trim().replace(/\/+$/, '');
      if (v) candidates.add(v);
    });
  };
  add(process.env.WEBAUTHN_ORIGIN);
  add(process.env.APP_URL);
  // Synthesize https://<rpID> as a fallback when only RP_ID was provided.
  const id = rpID();
  if (id && id !== 'localhost') candidates.add(`https://${id}`);
  if (candidates.size === 0) candidates.add('http://localhost:5173');
  return Array.from(candidates);
}

async function storeChallenge(userId: string | null, challenge: string, kind: 'register' | 'authenticate'): Promise<void> {
  await pool.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, kind, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${CHALLENGE_TTL_MINUTES} minutes')`,
    [userId, challenge, kind]
  );
  // Opportunistic cleanup
  await pool.query(`DELETE FROM webauthn_challenges WHERE expires_at < NOW()`);
}

async function consumeChallenge(challenge: string, kind: 'register' | 'authenticate'): Promise<{ userId: string | null } | null> {
  const res = await pool.query(
    `DELETE FROM webauthn_challenges WHERE challenge = $1 AND kind = $2 AND expires_at > NOW() RETURNING user_id`,
    [challenge, kind]
  );
  if (res.rows.length === 0) return null;
  return { userId: res.rows[0].user_id };
}

export interface StoredCredential {
  id: string;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}

async function getUserCredentials(userId: string): Promise<StoredCredential[]> {
  const res = await pool.query(
    `SELECT id, credential_id, public_key, counter, transports
     FROM webauthn_credentials WHERE user_id = $1`,
    [userId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    credentialId: r.credential_id,
    publicKey: r.public_key,
    counter: Number(r.counter),
    transports: r.transports ? (r.transports.split(',') as AuthenticatorTransportFuture[]) : undefined,
  }));
}

/** Generate registration options — enrolls a new passkey for a logged-in user. */
export async function beginRegistration(userId: string, userEmail: string, userName: string) {
  const existing = await getUserCredentials(userId);
  const options = await generateRegistrationOptions({
    rpName: rpName(),
    rpID: rpID(),
    userName: userEmail,
    userDisplayName: userName || userEmail,
    userID: Buffer.from(userId),
    attestationType: 'none',
    authenticatorSelection: {
      // `required` ensures the credential is a **discoverable** (resident) key,
      // which is mandatory for the passwordless passkey-login flow that does
      // not send an email/allowCredentials list.
      residentKey: 'required',
      userVerification: 'preferred',
      authenticatorAttachment: 'platform',
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  });
  await storeChallenge(userId, options.challenge, 'register');
  return options;
}

function extractChallenge(clientDataJSONb64: string): string {
  return JSON.parse(Buffer.from(clientDataJSONb64, 'base64url').toString()).challenge as string;
}

export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  nickname?: string
): Promise<{ id: string }> {
  const challenge = extractChallenge(response.response.clientDataJSON);
  const expected = await consumeChallenge(challenge, 'register');
  if (!expected || expected.userId !== userId) {
    throw new Error('Challenge invalide');
  }
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Vérification WebAuthn échouée');
  }
  const info = verification.registrationInfo;
  const cred = info.credential;
  const inserted = await pool.query(
    `INSERT INTO webauthn_credentials
       (user_id, credential_id, public_key, counter, transports, device_type, backed_up, nickname)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      cred.id,
      Buffer.from(cred.publicKey),
      cred.counter,
      cred.transports ? cred.transports.join(',') : null,
      info.credentialDeviceType,
      info.credentialBackedUp,
      nickname || null,
    ]
  );
  return { id: inserted.rows[0].id };
}

/**
 * Generate auth options for a user. Call this after password verification
 * (step-up 2FA) or during an "unlock" ceremony.
 */
export async function beginAuthentication(userId: string) {
  const creds = await getUserCredentials(userId);
  if (creds.length === 0) throw new Error('Aucun authentificateur enregistré');
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
  });
  await storeChallenge(userId, options.challenge, 'authenticate');
  return options;
}

export async function finishAuthentication(
  userId: string,
  response: AuthenticationResponseJSON
): Promise<{ credentialId: string }> {
  const expectedChallenge = extractChallenge(response.response.clientDataJSON);
  const consumed = await consumeChallenge(expectedChallenge, 'authenticate');
  if (!consumed || consumed.userId !== userId) {
    throw new Error('Challenge invalide');
  }
  const creds = await getUserCredentials(userId);
  const stored = creds.find((c) => c.credentialId === response.id);
  if (!stored) throw new Error('Credential inconnu');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports,
    },
    requireUserVerification: false,
  });
  if (!verification.verified) {
    throw new Error('Vérification WebAuthn échouée');
  }
  await pool.query(
    `UPDATE webauthn_credentials
     SET counter = $1, last_used_at = NOW() WHERE id = $2`,
    [verification.authenticationInfo.newCounter, stored.id]
  );
  return { credentialId: stored.credentialId };
}

export async function listCredentials(userId: string) {
  const res = await pool.query(
    `SELECT id, nickname, device_type, backed_up, created_at, last_used_at
     FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    deviceType: r.device_type,
    backedUp: r.backed_up,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function deleteCredential(userId: string, credId: string): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2`,
    [credId, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function hasCredentials(userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM webauthn_credentials WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows.length > 0;
}

/**
 * Generate options for a **discoverable credential** ceremony (passwordless
 * login). No `allowCredentials` is sent so the authenticator offers the user
 * any resident passkey bound to this RP. The challenge is stored with a NULL
 * user_id and resolved at verify time by looking up the credential.
 */
export async function beginDiscoverableAuthentication() {
  const options = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: 'preferred',
    // No allowCredentials ⇒ browser shows the account picker from resident keys.
  });
  await storeChallenge(null, options.challenge, 'authenticate');
  return options;
}

export async function finishDiscoverableAuthentication(
  response: AuthenticationResponseJSON
): Promise<{ userId: string }> {
  const expectedChallenge = extractChallenge(response.response.clientDataJSON);
  const consumed = await consumeChallenge(expectedChallenge, 'authenticate');
  // Discoverable ceremonies are stored with user_id = NULL.
  if (!consumed || consumed.userId !== null) {
    throw new Error('Challenge invalide');
  }

  // Resolve the owning user from the returned credential id.
  const row = await pool.query(
    `SELECT id, user_id, credential_id, public_key, counter, transports
     FROM webauthn_credentials WHERE credential_id = $1 LIMIT 1`,
    [response.id]
  );
  if (row.rows.length === 0) throw new Error('Credential inconnu');
  const stored = row.rows[0];

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin(),
    expectedRPID: rpID(),
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(stored.public_key),
      counter: Number(stored.counter),
      transports: stored.transports ? (stored.transports.split(',') as AuthenticatorTransportFuture[]) : undefined,
    },
    requireUserVerification: true, // passwordless ⇒ verifiable user presence is mandatory
  });
  if (!verification.verified) {
    throw new Error('Vérification WebAuthn échouée');
  }
  await pool.query(
    `UPDATE webauthn_credentials SET counter = $1, last_used_at = NOW() WHERE id = $2`,
    [verification.authenticationInfo.newCounter, stored.id]
  );
  return { userId: stored.user_id };
}
