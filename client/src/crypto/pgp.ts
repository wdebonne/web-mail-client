/**
 * Thin wrappers around openpgpjs used throughout the app.
 *
 * All encrypt/sign operations produce **ASCII-armored** output ("inline mode") so the
 * encrypted/signed payload can travel in a regular `text/plain` or `multipart/alternative`
 * body without requiring a new MIME structure. Receiving clients that understand OpenPGP
 * (Thunderbird, Outlook + GPGOL, Apple Mail + GPG Suite, Proton Mail, K-9, ...) detect the
 * `-----BEGIN PGP ...-----` markers and decrypt/verify automatically.
 */
import * as openpgp from 'openpgp';

export interface GeneratedPgpKey {
  publicKey: string;
  privateKey: string;
  revocationCertificate: string;
  fingerprint: string;
}

export async function generateKey(options: {
  name?: string;
  email: string;
  passphrase: string;
  expiresInDays?: number;
}): Promise<GeneratedPgpKey> {
  const result = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    userIDs: [{ name: options.name, email: options.email }],
    passphrase: options.passphrase,
    format: 'armored',
    keyExpirationTime: options.expiresInDays ? options.expiresInDays * 86400 : 0,
  });
  const key = await openpgp.readKey({ armoredKey: result.publicKey });
  return {
    publicKey: result.publicKey,
    privateKey: result.privateKey,
    revocationCertificate: result.revocationCertificate,
    fingerprint: key.getFingerprint().toUpperCase(),
  };
}

export async function readPublicKey(armoredKey: string) {
  return openpgp.readKey({ armoredKey });
}

export async function readPrivateKey(armoredKey: string, passphrase: string) {
  const key = await openpgp.readPrivateKey({ armoredKey });
  return openpgp.decryptKey({ privateKey: key, passphrase });
}

/** Encrypt a plaintext body to one or more armored public keys, optionally signing. */
export async function encrypt(options: {
  plaintext: string;
  recipientPublicKeys: string[];
  signingPrivateKey?: openpgp.PrivateKey;
}): Promise<string> {
  const encryptionKeys = await Promise.all(
    options.recipientPublicKeys.map(pk => openpgp.readKey({ armoredKey: pk }))
  );
  const message = await openpgp.createMessage({ text: options.plaintext });
  const armored = await openpgp.encrypt({
    message,
    encryptionKeys,
    signingKeys: options.signingPrivateKey,
    format: 'armored',
  });
  return typeof armored === 'string' ? armored : new TextDecoder().decode(armored as any);
}

/** Produce an armored cleartext signed message (keeps the body readable). */
export async function signCleartext(plaintext: string, signingPrivateKey: openpgp.PrivateKey): Promise<string> {
  const message = await openpgp.createCleartextMessage({ text: plaintext });
  const signed = await openpgp.sign({
    message,
    signingKeys: signingPrivateKey,
    format: 'armored',
  });
  return typeof signed === 'string' ? signed : new TextDecoder().decode(signed as any);
}

export interface DecryptResult {
  plaintext: string;
  signedBy?: string;
  signatureValid?: boolean;
  signatureKeyId?: string;
}

/** Try to decrypt an armored PGP message. `verificationKeys` is optional. */
export async function decrypt(options: {
  armoredMessage: string;
  privateKey: openpgp.PrivateKey;
  verificationKeys?: string[];
}): Promise<DecryptResult> {
  const message = await openpgp.readMessage({ armoredMessage: options.armoredMessage });
  const verificationKeys = options.verificationKeys
    ? await Promise.all(options.verificationKeys.map(k => openpgp.readKey({ armoredKey: k })))
    : undefined;
  const { data, signatures } = await openpgp.decrypt({
    message,
    decryptionKeys: options.privateKey,
    verificationKeys,
    format: 'utf8',
  });
  const plaintext = typeof data === 'string' ? data : new TextDecoder().decode(data as any);
  const res: DecryptResult = { plaintext };
  if (signatures && signatures.length) {
    const sig = signatures[0];
    try {
      await sig.verified;
      res.signatureValid = true;
      res.signatureKeyId = sig.keyID.toHex().toUpperCase();
    } catch {
      res.signatureValid = false;
    }
  }
  return res;
}

export interface VerifyResult {
  plaintext: string;
  valid: boolean;
  signerKeyId?: string;
}

/** Verify an armored cleartext-signed message. */
export async function verifyCleartext(
  armoredSigned: string,
  verificationKeys?: string[]
): Promise<VerifyResult> {
  const message = await openpgp.readCleartextMessage({ cleartextMessage: armoredSigned });
  const keys = verificationKeys
    ? await Promise.all(verificationKeys.map(k => openpgp.readKey({ armoredKey: k })))
    : [];
  const { signatures, data } = await openpgp.verify({
    message,
    verificationKeys: keys,
    format: 'utf8',
  });
  const plaintext = typeof data === 'string' ? data : new TextDecoder().decode(data as any);
  let valid = false;
  let signerKeyId: string | undefined;
  if (signatures && signatures.length) {
    const sig = signatures[0];
    signerKeyId = sig.keyID.toHex().toUpperCase();
    try {
      await sig.verified;
      valid = true;
    } catch {
      valid = false;
    }
  }
  return { plaintext, valid, signerKeyId };
}

const PGP_MESSAGE_RE = /-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/;
const PGP_SIGNED_RE = /-----BEGIN PGP SIGNED MESSAGE-----[\s\S]*?-----END PGP SIGNATURE-----/;

export function detectArmor(input: string): 'message' | 'signed' | null {
  if (PGP_MESSAGE_RE.test(input)) return 'message';
  if (PGP_SIGNED_RE.test(input)) return 'signed';
  return null;
}

export function extractArmor(input: string, kind: 'message' | 'signed'): string | null {
  const re = kind === 'message' ? PGP_MESSAGE_RE : PGP_SIGNED_RE;
  const match = input.match(re);
  return match ? match[0] : null;
}
