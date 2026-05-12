import nodemailer from 'nodemailer';
import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';

async function getSmtpSettings(): Promise<Record<string, any>> {
  const result = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key LIKE 'smtp_%'`
  );
  const s: Record<string, any> = {};
  for (const row of result.rows) s[row.key] = row.value;
  return s;
}

function buildSmtpTransport(s: Record<string, any>) {
  const host = s['smtp_host'] || '';
  const port = Number(s['smtp_port']) || 587;
  const mode = s['smtp_secure'] || 'starttls';
  const user = s['smtp_username'] || '';
  const rawPass = s['smtp_password_encrypted'] || '';
  const pass = rawPass ? (() => { try { return decrypt(rawPass); } catch { return ''; } })() : '';
  const secure = mode === 'ssl';
  const requireTLS = mode === 'starttls';
  return nodemailer.createTransport({
    host, port, secure, requireTLS,
    auth: (user && pass) ? { user, pass } : undefined,
  } as any);
}

export async function sendSystemEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const s = await getSmtpSettings();
  if (!s['smtp_host']) throw new Error('SMTP non configuré');
  const transport = buildSmtpTransport(s);
  const fromName = s['smtp_from_name'] || 'Mail Client';
  const fromEmail = s['smtp_from_email'] || s['smtp_username'] || '';
  await transport.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    html,
    text,
  });
}
