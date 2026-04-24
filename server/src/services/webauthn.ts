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

function rpID(): string {
  return process.env.WEBAUTHN_RP_ID || 'localhost';
}

function rpName(): string {
  return process.env.WEBAUTHN_RP_NAME || 'Web Mail';
}

function origin(): string | string[] {
  const raw = process.env.WEBAUTHN_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
  return raw.split(',').map((s) => s.trim());
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
      residentKey: 'preferred',
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
