import crypto from 'crypto';

/**
 * Password-reset tokens are stored as SHA-256 hashes: a database dump must
 * not be enough to take over accounts. The raw token only ever appears in
 * the reset URL sent to the user; lookups hash the presented value first.
 */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
