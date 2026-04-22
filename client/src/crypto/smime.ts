/**
 * Minimal S/MIME (RFC 5751) helpers built on pkijs: import a PKCS#12 bundle
 * (certificate + private key), produce signed and/or encrypted MIME parts, and
 * verify/decrypt inbound messages.
 *
 * The S/MIME types produced / consumed here follow the standard content types:
 *   - `multipart/signed; protocol="application/pkcs7-signature"` (detached signature)
 *   - `application/pkcs7-mime; smime-type=enveloped-data` (encrypted)
 *   - `application/pkcs7-mime; smime-type=signed-data` (opaque signed)
 *
 * The whole pipeline happens in the browser: private keys never leave the device.
 * Sending an S/MIME message uses the server's `POST /api/mail/send-raw` passthrough
 * to keep the RFC 822 MIME payload byte-identical on the wire.
 */
import * as asn1js from 'asn1js';
import {
  CertificationRequest, Certificate, PFX, PrivateKeyInfo,
  ContentInfo, SignedData, EncapsulatedContentInfo,
  SignerInfo, IssuerAndSerialNumber, Attribute,
  EnvelopedData, RecipientInfo, KeyTransRecipientInfo, AlgorithmIdentifier,
  EncryptedContentInfo, RecipientIdentifier,
} from 'pkijs';

/** Lightweight Node/Browser-safe base64 helpers. */
const b64 = {
  encode(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  },
  decode(str: string): ArrayBuffer {
    const clean = str.replace(/\s+/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  },
};

export function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '');
  return b64.decode(body);
}

export function derToPem(der: ArrayBuffer, label: string): string {
  const b = b64.encode(der);
  const lines = b.match(/.{1,64}/g)?.join('\n') || b;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

export interface ImportedP12 {
  certificatePem: string;
  privateKeyPkcs8Pem: string;
  subjectCN?: string;
  subjectEmail?: string;
  serialNumberHex: string;
}

/** Parse a PKCS#12 (.p12 / .pfx) and return the user certificate and unencrypted PKCS#8 key. */
export async function importP12(p12Data: ArrayBuffer, passphrase: string): Promise<ImportedP12> {
  const asn1 = asn1js.fromBER(p12Data);
  if (asn1.offset === -1) throw new Error('Fichier PKCS#12 invalide.');
  const pfx = new PFX({ schema: asn1.result });

  // Integrity check via MAC
  await pfx.parseInternalValues({
    password: stringToArrayBuffer(passphrase),
    checkIntegrity: true,
  });

  const authSafe = pfx.parsedValue?.authenticatedSafe;
  if (!authSafe) throw new Error('Archive PKCS#12 vide.');

  await authSafe.parseInternalValues({
    safeContents: (authSafe.safeContents || []).map(() => ({ password: stringToArrayBuffer(passphrase) })),
  });

  let certificate: Certificate | undefined;
  let privateKey: PrivateKeyInfo | undefined;

  for (const safeContent of authSafe.parsedValue?.safeContents || []) {
    for (const bag of safeContent.value?.safeBags || []) {
      const bagValue: any = bag.bagValue;
      if (bagValue?.parsedValue instanceof Certificate) certificate = bagValue.parsedValue;
      else if (bagValue instanceof Certificate) certificate = bagValue;
      else if (bagValue?.parsedValue instanceof PrivateKeyInfo) privateKey = bagValue.parsedValue;
      else if (bagValue instanceof PrivateKeyInfo) privateKey = bagValue;
    }
  }

  if (!certificate || !privateKey) throw new Error('Certificat ou clé privée introuvable dans le fichier .p12.');

  const certDer = certificate.toSchema(true).toBER(false);
  const keyDer = privateKey.toSchema().toBER(false);

  // Extract subject CN + email (from subject or SAN rfc822Name)
  let subjectCN: string | undefined;
  for (const tv of certificate.subject.typesAndValues) {
    if (tv.type === '2.5.4.3') subjectCN = (tv.value as any).valueBlock?.value;
  }
  let subjectEmail: string | undefined;
  try {
    for (const tv of certificate.subject.typesAndValues) {
      if (tv.type === '1.2.840.113549.1.9.1') subjectEmail = (tv.value as any).valueBlock?.value;
    }
    if (!subjectEmail && certificate.extensions) {
      for (const ext of certificate.extensions) {
        if (ext.extnID === '2.5.29.17' && ext.parsedValue) {
          for (const alt of (ext.parsedValue as any).altNames || []) {
            if (alt.type === 1) subjectEmail = alt.value; // rfc822Name
          }
        }
      }
    }
  } catch { /* optional */ }

  const serialHex = bufferToHex(certificate.serialNumber.valueBlock.valueHexView);

  return {
    certificatePem: derToPem(certDer, 'CERTIFICATE'),
    privateKeyPkcs8Pem: derToPem(keyDer, 'PRIVATE KEY'),
    subjectCN,
    subjectEmail,
    serialNumberHex: serialHex,
  };
}

function stringToArrayBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

function bufferToHex(view: Uint8Array): string {
  return Array.from(view, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function importRsaPrivateKey(pkcs8Pem: string, usage: 'sign' | 'decrypt'): Promise<CryptoKey> {
  const der = pemToDer(pkcs8Pem);
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    usage === 'sign'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    [usage]
  );
}

async function importRsaPublicKey(certPem: string): Promise<CryptoKey> {
  const der = pemToDer(certPem);
  const asn1 = asn1js.fromBER(der);
  const cert = new Certificate({ schema: asn1.result });
  const spki = cert.subjectPublicKeyInfo.toSchema().toBER(false);
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
}

/** Sign a pre-built MIME body (with its own MIME headers + CRLF separator) and return the
 *  `multipart/signed` envelope. This is the format expected by Outlook / Thunderbird / Mail.app.
 */
export async function signDetached(
  canonicalContent: string,
  certificatePem: string,
  privateKeyPkcs8Pem: string
): Promise<{ mime: string; boundary: string }> {
  const certAsn1 = asn1js.fromBER(pemToDer(certificatePem));
  const cert = new Certificate({ schema: certAsn1.result });

  const privateKey = await importRsaPrivateKey(privateKeyPkcs8Pem, 'sign');

  // RFC 5751 dictates CRLF line endings for the content that will be hashed.
  const contentBytes = new TextEncoder().encode(canonicalContent.replace(/\r?\n/g, '\r\n'));

  const encapContent = new EncapsulatedContentInfo({
    eContentType: '1.2.840.113549.1.7.1', // data
  });

  const signerInfo = new SignerInfo({
    version: 1,
    sid: new IssuerAndSerialNumber({
      issuer: cert.issuer,
      serialNumber: cert.serialNumber,
    }),
    digestAlgorithm: new AlgorithmIdentifier({ algorithmId: '2.16.840.1.101.3.4.2.1' }), // SHA-256
    signatureAlgorithm: new AlgorithmIdentifier({ algorithmId: '1.2.840.113549.1.1.1' }), // rsaEncryption
  });

  const signedData = new SignedData({
    version: 1,
    encapContentInfo: encapContent,
    signerInfos: [signerInfo],
    certificates: [cert],
    digestAlgorithms: [new AlgorithmIdentifier({ algorithmId: '2.16.840.1.101.3.4.2.1' })],
  });

  await signedData.sign(privateKey, 0, 'SHA-256', contentBytes.buffer);

  const cms = new ContentInfo({
    contentType: '1.2.840.113549.1.7.2',
    content: signedData.toSchema(true),
  });

  const signatureDer = cms.toSchema().toBER(false);
  const signatureB64 = b64.encode(signatureDer);
  const signatureLines = signatureB64.match(/.{1,76}/g)?.join('\r\n') || signatureB64;

  const boundary = `----=_smime-${crypto.randomUUID()}`;
  const mime =
    `Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; boundary="${boundary}"\r\n` +
    '\r\n' +
    `--${boundary}\r\n` +
    canonicalContent.replace(/\r?\n/g, '\r\n') + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/pkcs7-signature; name="smime.p7s"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    'Content-Disposition: attachment; filename="smime.p7s"\r\n' +
    '\r\n' +
    signatureLines + '\r\n' +
    `--${boundary}--\r\n`;

  return { mime, boundary };
}

/** Produce a CMS enveloped-data (`application/pkcs7-mime; smime-type=enveloped-data`) for one or
 *  more recipient certificates.
 */
export async function encryptEnveloped(
  canonicalContent: string,
  recipientCertificatesPem: string[]
): Promise<string> {
  const enveloped = new EnvelopedData({ version: 0 });

  for (const pem of recipientCertificatesPem) {
    const asn1 = asn1js.fromBER(pemToDer(pem));
    const cert = new Certificate({ schema: asn1.result });
    enveloped.addRecipientByCertificate(cert, { oaepHashAlgorithm: 'SHA-256' }, 1); // RSA-OAEP
  }

  const contentBytes = new TextEncoder().encode(canonicalContent.replace(/\r?\n/g, '\r\n'));
  await enveloped.encrypt(
    { name: 'AES-CBC', length: 256 } as any,
    contentBytes.buffer
  );

  const cms = new ContentInfo({
    contentType: '1.2.840.113549.1.7.3',
    content: enveloped.toSchema(),
  });

  const der = cms.toSchema().toBER(false);
  const b64Body = b64.encode(der);
  const lines = b64Body.match(/.{1,76}/g)?.join('\r\n') || b64Body;

  return (
    'Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    'Content-Disposition: attachment; filename="smime.p7m"\r\n' +
    '\r\n' +
    lines + '\r\n'
  );
}

export async function decryptEnveloped(
  cmsDer: ArrayBuffer,
  recipientCertificatePem: string,
  privateKeyPkcs8Pem: string
): Promise<string> {
  const asn1 = asn1js.fromBER(cmsDer);
  const cms = new ContentInfo({ schema: asn1.result });
  const enveloped = new EnvelopedData({ schema: cms.content });

  const certAsn1 = asn1js.fromBER(pemToDer(recipientCertificatePem));
  const cert = new Certificate({ schema: certAsn1.result });

  const privateKey = await importRsaPrivateKey(privateKeyPkcs8Pem, 'decrypt');
  const privateKeyRaw = await crypto.subtle.exportKey('pkcs8', privateKey);

  const plaintext = await enveloped.decrypt(0, {
    recipientCertificate: cert,
    recipientPrivateKey: privateKeyRaw,
  });
  return new TextDecoder().decode(plaintext);
}

export async function verifyDetached(
  signedContent: string,
  cmsSignatureDer: ArrayBuffer
): Promise<{ valid: boolean; signerCN?: string }> {
  const asn1 = asn1js.fromBER(cmsSignatureDer);
  const cms = new ContentInfo({ schema: asn1.result });
  const signedData = new SignedData({ schema: cms.content });
  const signerCert = signedData.certificates?.[0] as Certificate | undefined;

  const contentBytes = new TextEncoder().encode(signedContent.replace(/\r?\n/g, '\r\n'));

  const result = await signedData.verify({
    signer: 0,
    data: contentBytes.buffer,
    extendedMode: true,
  } as any);

  let signerCN: string | undefined;
  if (signerCert) {
    for (const tv of signerCert.subject.typesAndValues) {
      if (tv.type === '2.5.4.3') signerCN = (tv.value as any).valueBlock?.value;
    }
  }
  return { valid: !!(result as any).signatureVerified, signerCN };
}

// Intentionally unused imports kept for tree-shaking parity with pkijs ESM bundles.
void CertificationRequest;
void RecipientInfo;
void KeyTransRecipientInfo;
void EncryptedContentInfo;
void RecipientIdentifier;
void Attribute;
