/**
 * Compose-time security pipeline. Transforms the composed body (plain text + HTML) into
 * either an inline PGP-armored payload (for the regular `/api/mail/send` route) or a fully
 * built RFC 822 S/MIME message (for the `/api/mail/send-raw` route).
 *
 * The pipeline is intentionally lossy-aware: when signing or encrypting, the HTML body is
 * collapsed to plain text first (PGP cleartext messages cannot preserve rich formatting
 * without PGP/MIME which would require a MIME rewrite pipeline). Users who need rich-text
 * preservation should send without encryption, or import a PGP/MIME-capable relay.
 */
import * as pgp from './pgp';
import * as smime from './smime';
import { keystore, StoredKey } from './keystore';
import { useSecurityStore } from '../stores/securityStore';

export type SecurityMode =
  | 'none'
  | 'pgp-sign' | 'pgp-encrypt' | 'pgp-sign-encrypt'
  | 'smime-sign' | 'smime-encrypt' | 'smime-sign-encrypt';

export interface ComposeSecurityInput {
  mode: SecurityMode;
  senderEmail: string;
  senderName?: string;
  recipients: { email: string; name?: string }[];
  ccRecipients: { email: string; name?: string }[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments?: { filename: string; contentType?: string; content: string }[];
  inReplyTo?: string;
  references?: string;
}

export type ComposeSecurityOutput =
  | { kind: 'inline'; bodyText: string; bodyHtml: string }
  | { kind: 'raw'; rawMime: string };

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>(\s)?/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r?\n\s*\r?\n/g, '\n\n')
    .trim();
}

export async function prepareSecureSend(input: ComposeSecurityInput): Promise<ComposeSecurityOutput> {
  if (input.mode === 'none') {
    return { kind: 'inline', bodyText: input.bodyText, bodyHtml: input.bodyHtml };
  }

  const plain = input.bodyText?.trim() ? input.bodyText : htmlToPlain(input.bodyHtml);
  const { unlockedPgp, unlockedSmime } = useSecurityStore.getState();

  // -------- OpenPGP pipelines --------
  if (input.mode.startsWith('pgp')) {
    const senderKey = Object.values(unlockedPgp).find(e => e.email.toLowerCase() === input.senderEmail.toLowerCase())
      || Object.values(unlockedPgp)[0];
    const needSign = input.mode !== 'pgp-encrypt';
    const needEncrypt = input.mode !== 'pgp-sign';

    if (needSign && !senderKey) {
      throw new Error('Aucune clé OpenPGP déverrouillée pour la signature. Déverrouillez une clé dans Sécurité → OpenPGP.');
    }

    let recipientPublicKeys: string[] = [];
    if (needEncrypt) {
      const all = [...input.recipients, ...input.ccRecipients];
      const missing: string[] = [];
      for (const r of all) {
        const found = await keystore.findByEmail(r.email, 'pgp');
        if (found) recipientPublicKeys.push(found.publicData);
        else missing.push(r.email);
      }
      // Encrypt to self as well so the sender can re-read the Sent copy.
      if (senderKey) recipientPublicKeys.push(senderKey.publicArmored);
      if (missing.length) {
        throw new Error(`Clé publique OpenPGP introuvable pour: ${missing.join(', ')}. Importez-la dans Sécurité → OpenPGP avant l'envoi.`);
      }
    }

    let armored: string;
    if (needEncrypt) {
      armored = await pgp.encrypt({
        plaintext: plain,
        recipientPublicKeys,
        signingPrivateKey: needSign ? senderKey!.privateKey : undefined,
      });
    } else {
      armored = await pgp.signCleartext(plain, senderKey!.privateKey);
    }

    return {
      kind: 'inline',
      bodyText: armored,
      bodyHtml: `<pre style="font-family:monospace;white-space:pre-wrap;word-break:break-all">${escapeHtml(armored)}</pre>`,
    };
  }

  // -------- S/MIME pipelines --------
  if (input.mode.startsWith('smime')) {
    const senderCert = Object.values(unlockedSmime).find(e => e.email.toLowerCase() === input.senderEmail.toLowerCase())
      || Object.values(unlockedSmime)[0];
    const needSign = input.mode !== 'smime-encrypt';
    const needEncrypt = input.mode !== 'smime-sign';

    if ((needSign || needEncrypt) && !senderCert) {
      throw new Error('Aucun certificat S/MIME déverrouillé. Déverrouillez un certificat dans Sécurité → S/MIME.');
    }

    const recipientCerts: string[] = [];
    if (needEncrypt) {
      const all = [...input.recipients, ...input.ccRecipients];
      const missing: string[] = [];
      for (const r of all) {
        const found = await keystore.findByEmail(r.email, 'smime');
        if (found) recipientCerts.push(found.publicData);
        else missing.push(r.email);
      }
      // Always include ourselves so we can decrypt Sent copies.
      recipientCerts.push(senderCert!.certificatePem);
      if (missing.length) {
        throw new Error(`Certificat S/MIME introuvable pour: ${missing.join(', ')}. Importez-le dans Sécurité → S/MIME ou demandez-le au destinataire.`);
      }
    }

    // Build the inner MIME body (text/plain for now; HTML can be added as multipart/alternative later).
    const innerContent =
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'Content-Transfer-Encoding: 7bit\r\n' +
      '\r\n' +
      plain + '\r\n';

    let innerMime: string;
    if (needSign && needEncrypt) {
      const signed = await smime.signDetached(innerContent, senderCert!.certificatePem, senderCert!.privateKeyPkcs8Pem);
      innerMime = await smime.encryptEnveloped(signed.mime, recipientCerts);
    } else if (needSign) {
      const signed = await smime.signDetached(innerContent, senderCert!.certificatePem, senderCert!.privateKeyPkcs8Pem);
      innerMime = signed.mime;
    } else {
      innerMime = await smime.encryptEnveloped(innerContent, recipientCerts);
    }

    // Wrap with outer RFC 822 headers
    const rawMime = buildOuterHeaders({
      fromEmail: input.senderEmail,
      fromName: input.senderName,
      to: input.recipients,
      cc: input.ccRecipients,
      subject: input.subject,
      inReplyTo: input.inReplyTo,
      references: input.references,
    }) + innerMime;

    return { kind: 'raw', rawMime };
  }

  return { kind: 'inline', bodyText: input.bodyText, bodyHtml: input.bodyHtml };
}

function buildOuterHeaders(params: {
  fromEmail: string; fromName?: string;
  to: { email: string; name?: string }[];
  cc: { email: string; name?: string }[];
  subject: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const fmt = (a: { email: string; name?: string }) => a.name ? `"${a.name.replace(/"/g, '')}" <${a.email}>` : a.email;
  const lines = [
    `From: ${fmt({ email: params.fromEmail, name: params.fromName })}`,
    `To: ${params.to.map(fmt).join(', ')}`,
    params.cc.length ? `Cc: ${params.cc.map(fmt).join(', ')}` : '',
    `Subject: ${encodeHeader(params.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${(params.fromEmail.split('@')[1] || 'localhost')}>`,
    'MIME-Version: 1.0',
    params.inReplyTo ? `In-Reply-To: ${params.inReplyTo}` : '',
    params.references ? `References: ${params.references}` : '',
  ].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word for non-ASCII subjects.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const b64 = btoa(unescape(encodeURIComponent(value)));
  return `=?UTF-8?B?${b64}?=`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export async function availableSecurityModes(senderEmail: string): Promise<{
  pgpSignReady: boolean;
  pgpEncryptReady: boolean; // means at least a default PGP key exists; recipients checked at send time
  smimeSignReady: boolean;
  smimeEncryptReady: boolean;
  defaultPgp?: StoredKey;
  defaultSmime?: StoredKey;
}> {
  const pgpKeys = await keystore.list('pgp');
  const smimeKeys = await keystore.list('smime');
  const pgpSelf = pgpKeys.find(k => k.email.toLowerCase() === senderEmail.toLowerCase()) || pgpKeys.find(k => k.isDefault) || pgpKeys[0];
  const smimeSelf = smimeKeys.find(k => k.email.toLowerCase() === senderEmail.toLowerCase()) || smimeKeys.find(k => k.isDefault) || smimeKeys[0];
  return {
    pgpSignReady: !!pgpSelf?.privateCiphertext,
    pgpEncryptReady: pgpKeys.length > 0,
    smimeSignReady: !!smimeSelf?.privateCiphertext,
    smimeEncryptReady: smimeKeys.length > 0,
    defaultPgp: pgpSelf,
    defaultSmime: smimeSelf,
  };
}
