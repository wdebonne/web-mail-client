import { Request } from 'express';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { checkDeviceKnown } from './deviceSessions';
import { sendSystemEmail } from './systemEmail';

/**
 * Alerte « nouvelle connexion depuis un appareil inconnu ».
 *
 * Appelée par issueSession (routes/auth.ts) pour tous les modes de connexion
 * (mot de passe, LDAP, WebAuthn, passkey, SSO). L'email est envoyé à
 * l'utilisateur lui-même via le SMTP système, à partir du modèle
 * `new_device_alert` (modifiable dans Admin > SMTP & Emails).
 *
 * IMPORTANT : la détection doit être awaitée AVANT createDeviceSession —
 * la session fraîchement insérée rendrait l'appareil « connu ». La détection
 * est une unique requête EXISTS ; l'envoi SMTP, lui, part en tâche de fond
 * pour ne jamais ralentir ni bloquer le login.
 *
 * Garde-fous :
 *  - désactivable globalement (admin_settings.security_new_device_alert_enabled)
 *    et via le flag enabled du modèle d'email ;
 *  - silencieuse à la première connexion du compte (aucune session existante) ;
 *  - un appareil est « connu » dès qu'une session (même révoquée) a porté le
 *    même nom dérivé du User-Agent — les montées de version de navigateur ne
 *    déclenchent donc pas de fausses alertes.
 */
export async function checkAndNotifyNewDevice(
  req: Request,
  userId: string,
  userAgent: string | undefined,
  ip: string,
): Promise<void> {
  try {
    const { known, hasAnySession, deviceName } = await checkDeviceKnown(userId, userAgent);
    if (known || !hasAnySession) return;
    // Envoi en tâche de fond — jamais bloquant pour le login.
    sendNewDeviceAlert(req, userId, deviceName, ip).catch((err) => {
      logger.warn({ err, userId }, 'New device alert: failed to send');
    });
  } catch (err) {
    logger.warn({ err, userId }, 'New device alert: device check failed');
  }
}

async function sendNewDeviceAlert(
  req: Request,
  userId: string,
  deviceName: string,
  ip: string,
): Promise<void> {
  const setting = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'security_new_device_alert_enabled'"
  );
  const enabled = setting.rows[0]?.value === true || setting.rows[0]?.value === 'true';
  if (!enabled) return;

  const userRes = await pool.query(
    'SELECT email, display_name FROM users WHERE id = $1',
    [userId]
  );
  if (userRes.rows.length === 0) return;
  const user = userRes.rows[0];

  const tplRes = await pool.query(
    "SELECT * FROM system_email_templates WHERE slug = 'new_device_alert' AND enabled = true"
  );
  if (tplRes.rows.length === 0) return;
  const tpl = tplRes.rows[0];

  const vars: Record<string, string> = {
    user_name: user.display_name || user.email,
    user_email: user.email,
    device_name: deviceName,
    ip: ip || 'inconnue',
    date: new Date().toLocaleString('fr-FR'),
  };
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  await sendSystemEmail(user.email, render(tpl.subject), render(tpl.body_html), render(tpl.body_text));

  const { addLog } = await import('./auditLog');
  addLog(userId, 'user.login_new_device', 'security', req, {
    email: user.email,
    deviceName,
    ip,
  }).catch(() => {});
}
