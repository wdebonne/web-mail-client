/**
 * Inbound security pipeline — inspect a received message, attempt to verify / decrypt
 * depending on what we find, and return a normalised `SecurityVerdict` consumed by
 * `MessageView` to render the status badge and swap the displayed body.
 *
 * Supported inputs (via inline body inspection for now):
 *   - OpenPGP ASCII-armored message (`-----BEGIN PGP MESSAGE-----`)
 *   - OpenPGP cleartext-signed message (`-----BEGIN PGP SIGNED MESSAGE-----`)
 *
 * Full MIME-level detection (S/MIME `application/pkcs7-mime`, PGP/MIME
 * `multipart/encrypted`) requires the server to expose the raw MIME source — this is
 * left for a follow-up iteration. The inbound pipeline gracefully returns `kind: 'plain'`
 * when no security envelope is detected.
 */
import * as pgp from './pgp';
import { keystore } from './keystore';
import { useSecurityStore } from '../stores/securityStore';

export type SecurityVerdict =
  | { kind: 'plain' }
  | { kind: 'pgp-signed'; valid: boolean; signerKeyId?: string; plaintext: string }
  | { kind: 'pgp-encrypted'; plaintext: string; signedValid?: boolean; signerKeyId?: string }
  | { kind: 'pgp-encrypted-locked' } // a PGP message was found but no unlocked private key matches
  | { kind: 'pgp-encrypted-error'; message: string };

export async function inspectIncoming(messageText: string): Promise<SecurityVerdict> {
  if (!messageText) return { kind: 'plain' };
  const marker = pgp.detectArmor(messageText);
  if (!marker) return { kind: 'plain' };

  const armor = pgp.extractArmor(messageText, marker);
  if (!armor) return { kind: 'plain' };

  const { unlockedPgp } = useSecurityStore.getState();
  const verificationKeys = (await keystore.list('pgp')).map(k => k.publicData);

  if (marker === 'signed') {
    try {
      const res = await pgp.verifyCleartext(armor, verificationKeys);
      return { kind: 'pgp-signed', valid: res.valid, signerKeyId: res.signerKeyId, plaintext: res.plaintext };
    } catch {
      return { kind: 'pgp-signed', valid: false, plaintext: armor };
    }
  }

  // Encrypted: try each unlocked private key
  const unlocked = Object.values(unlockedPgp);
  if (unlocked.length === 0) return { kind: 'pgp-encrypted-locked' };

  for (const entry of unlocked) {
    try {
      const res = await pgp.decrypt({
        armoredMessage: armor,
        privateKey: entry.privateKey,
        verificationKeys,
      });
      return {
        kind: 'pgp-encrypted',
        plaintext: res.plaintext,
        signedValid: res.signatureValid,
        signerKeyId: res.signatureKeyId,
      };
    } catch {
      // try next key
    }
  }
  return { kind: 'pgp-encrypted-error', message: 'Aucune clé OpenPGP déverrouillée ne peut déchiffrer ce message.' };
}

/** Extract plaintext for display from a security verdict. */
export function plaintextOf(verdict: SecurityVerdict, fallback: string): string {
  switch (verdict.kind) {
    case 'pgp-signed':
    case 'pgp-encrypted':
      return verdict.plaintext;
    default:
      return fallback;
  }
}
