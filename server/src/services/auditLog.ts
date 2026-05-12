import { Request } from 'express';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export async function addLog(
  userId: string | undefined,
  action: string,
  category: string,
  req: Request,
  details?: any,
  targetType?: string,
  targetId?: string,
) {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    await pool.query(
      `INSERT INTO admin_logs (user_id, action, category, target_type, target_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId ?? null, action, category, targetType ?? null, targetId ?? null, JSON.stringify(details ?? {}), ip, ua],
    );
    triggerLogAlerts({ userId, action, category, details, ip: String(ip || '') }).catch(() => {});
  } catch (error) {
    logger.error(error as Error, 'Failed to write audit log');
  }
}

async function triggerLogAlerts(log: { userId?: string; action: string; category: string; details?: any; ip: string }) {
  try {
    const rulesResult = await pool.query(`SELECT * FROM log_alert_rules WHERE enabled = true`);
    if (rulesResult.rows.length === 0) return;

    for (const rule of rulesResult.rows) {
      const catMatch = !rule.categories?.length || rule.categories.includes(log.category);
      const actMatch = !rule.actions?.length || rule.actions.some((a: string) => log.action.includes(a));
      if (!catMatch || !actMatch) continue;

      if (rule.last_triggered_at) {
        const elapsed = (Date.now() - new Date(rule.last_triggered_at).getTime()) / 60000;
        if (elapsed < rule.throttle_minutes) continue;
      }

      let userLabel = '—';
      if (log.userId) {
        const u = await pool.query('SELECT email FROM users WHERE id = $1', [log.userId]);
        if (u.rows.length > 0) userLabel = u.rows[0].email;
      }

      const subject = (rule.subject_template || 'Alerte log : {{action}}').replace('{{action}}', log.action);
      const html = `<p><strong>Action :</strong> ${log.action}</p>
<p><strong>Catégorie :</strong> ${log.category}</p>
<p><strong>Utilisateur :</strong> ${userLabel}</p>
<p><strong>IP :</strong> ${log.ip}</p>
<p><strong>Détails :</strong> <pre>${JSON.stringify(log.details || {}, null, 2)}</pre></p>`;
      const text = `Action: ${log.action}\nCatégorie: ${log.category}\nUtilisateur: ${userLabel}\nIP: ${log.ip}`;

      const { sendSystemEmail } = await import('./systemEmail');
      await sendSystemEmail(rule.recipient_email, subject, html, text);
      await pool.query(
        `UPDATE log_alert_rules SET last_triggered_at = NOW() WHERE id = $1`,
        [rule.id],
      );
    }
  } catch (err) {
    logger.error(err as Error, 'Failed to trigger log alerts');
  }
}
