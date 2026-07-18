import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import { sendSystemEmail } from './systemEmail';
import {
  getServicesStatus,
  markServiceStarted,
  markServiceStopped,
  markServiceTick,
} from './serviceStatus';

/**
 * Alertes système par email — le chaînon entre la page « État du système »
 * (passive) et une vraie supervision : personne ne regarde l'admin à 3 h du
 * matin.
 *
 * Toutes les minutes, le vérificateur :
 *  - repère les services de fond « en retard » (dernier tick plus vieux que
 *    N × leur intervalle nominal, N = alerting_missed_ticks, avec un plancher
 *    de 5 min pour ne pas alerter sur un simple tick long) ;
 *  - repère un échec de la dernière sauvegarde automatique
 *    (admin_settings.backup_last_auto_error, posé par backupScheduler et
 *    effacé au prochain succès) ;
 * puis envoie UN email (modèle `system_alert`, éditable dans Admin > SMTP &
 * Emails) aux destinataires configurés — ou à tous les admins actifs si la
 * liste est vide. Un incident qui persiste est rappelé toutes les
 * `alerting_reminder_hours` heures ; un incident résolu déclenche un email de
 * rétablissement.
 *
 * Limite assumée de l'auto-supervision : si le processus entier est mort,
 * personne n'envoie rien — c'est le HEALTHCHECK Docker qui couvre ce cas.
 */

const TICK_MS = 60_000;
/** En dessous de ce retard, on n'alerte jamais (tick long ≠ service mort). */
const LATE_FLOOR_MS = 5 * 60_000;
/** Nouvel essai d'envoi si le SMTP a échoué avant la première notification. */
const RESEND_AFTER_FAILURE_MS = 10 * 60_000;

const SERVICE_NAME = 'systemAlertChecker';

interface Incident {
  key: string;
  title: string;
  detail: string;
}

interface TrackedIncident {
  title: string;
  firstSeenAt: number;
  /** Date du dernier email parti pour cet incident (null = jamais réussi). */
  lastNotifiedAt: number | null;
  /** Date de la dernière tentative d'envoi (même échouée). */
  lastAttemptAt: number | null;
}

const tracked = new Map<string, TrackedIncident>();

let checkerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startSystemAlertChecker(): void {
  if (checkerInterval) return;
  checkerInterval = setInterval(tick, TICK_MS);
  markServiceStarted(SERVICE_NAME, 'Alertes système', TICK_MS);
  logger.info('System alert checker started');
}

export function stopSystemAlertChecker(): void {
  if (checkerInterval) {
    clearInterval(checkerInterval);
    checkerInterval = null;
    markServiceStopped(SERVICE_NAME);
  }
}

async function tick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    await checkAndAlert();
    markServiceTick(SERVICE_NAME);
  } catch (err) {
    markServiceTick(SERVICE_NAME, err);
    logger.error(err, 'System alert checker tick error');
  } finally {
    isRunning = false;
  }
}

async function getAlertSettings(): Promise<Record<string, any>> {
  const res = await pool.query(
    `SELECT key, value FROM admin_settings
      WHERE key LIKE 'alerting_%' OR key = 'backup_last_auto_error'`
  );
  const s: Record<string, any> = {};
  for (const row of res.rows) s[row.key] = row.value;
  return s;
}

function formatAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.round(diff / 3_600_000)} h`;
  return `le ${new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
}

function detectIncidents(settings: Record<string, any>): Incident[] {
  const missedTicks = Math.max(2, Number(settings['alerting_missed_ticks']) || 3);
  const incidents: Incident[] = [];

  for (const s of getServicesStatus()) {
    if (s.name === SERVICE_NAME) continue; // ne s'auto-surveille pas
    if (!s.intervalMs) continue; // pas d'intervalle nominal → injugeable
    const ref = s.lastTickAt ?? s.startedAt;
    if (!ref) continue;
    const threshold = Math.max(s.intervalMs * missedTicks, LATE_FLOOR_MS);
    if (Date.now() - new Date(ref).getTime() > threshold) {
      const interval = s.intervalMs >= 60_000 ? `${Math.round(s.intervalMs / 60_000)} min` : `${Math.round(s.intervalMs / 1000)} s`;
      incidents.push({
        key: `service:${s.name}`,
        title: `Service « ${s.label} » en retard`,
        detail: `dernier cycle ${s.lastTickAt ? formatAgo(s.lastTickAt) : 'jamais (démarré ' + formatAgo(s.startedAt!) + ')'} — intervalle nominal ${interval}`
          + (s.lastError ? ` · dernière erreur : ${s.lastError}` : ''),
      });
    }
  }

  const backupError = settings['backup_last_auto_error'];
  if (backupError && typeof backupError === 'object' && backupError.message) {
    incidents.push({
      key: 'backup_auto_failed',
      title: 'Échec de la sauvegarde automatique',
      detail: `${backupError.message}${backupError.at ? ` (${formatAgo(backupError.at)})` : ''}`,
    });
  }

  return incidents;
}

async function checkAndAlert(): Promise<void> {
  const settings = await getAlertSettings();
  const enabled = settings['alerting_enabled'] === true || settings['alerting_enabled'] === 'true';
  if (!enabled) {
    // Désactivé = on repart de zéro : au ré-enclenchement, les incidents
    // encore présents seront signalés comme nouveaux.
    tracked.clear();
    return;
  }

  const now = Date.now();
  const reminderMs = Math.max(1, Number(settings['alerting_reminder_hours']) || 6) * 3_600_000;
  const incidents = detectIncidents(settings);
  const currentKeys = new Set(incidents.map((i) => i.key));

  const newOnes: Incident[] = [];
  const reminders: Incident[] = [];
  for (const inc of incidents) {
    const t = tracked.get(inc.key);
    if (!t) {
      tracked.set(inc.key, { title: inc.title, firstSeenAt: now, lastNotifiedAt: null, lastAttemptAt: null });
      newOnes.push(inc);
    } else if (t.lastNotifiedAt === null) {
      // L'envoi initial a échoué (SMTP KO ?) — on retente sans spammer les logs.
      if (!t.lastAttemptAt || now - t.lastAttemptAt >= RESEND_AFTER_FAILURE_MS) newOnes.push(inc);
    } else if (now - t.lastNotifiedAt >= reminderMs) {
      reminders.push(inc);
    }
  }

  const recoveries: { key: string; title: string }[] = [];
  for (const [key, t] of tracked) {
    if (currentKeys.has(key)) continue;
    // Rétablissement silencieux si l'alerte n'était jamais partie.
    if (t.lastNotifiedAt !== null) recoveries.push({ key, title: t.title });
    tracked.delete(key);
  }

  if (newOnes.length === 0 && reminders.length === 0 && recoveries.length === 0) return;

  const sent = await sendAlertEmail(settings, newOnes, reminders, recoveries);
  for (const inc of [...newOnes, ...reminders]) {
    const t = tracked.get(inc.key);
    if (!t) continue;
    t.lastAttemptAt = now;
    if (sent) t.lastNotifiedAt = now;
  }
}

async function resolveRecipients(settings: Record<string, any>): Promise<string[]> {
  const configured = String(settings['alerting_recipients'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
  if (configured.length > 0) return configured;

  const res = await pool.query(
    `SELECT email FROM users
      WHERE is_active = true AND (is_admin = true OR role = 'admin')`
  );
  return res.rows.map((r: any) => r.email).filter(Boolean);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendAlertEmail(
  settings: Record<string, any>,
  newOnes: Incident[],
  reminders: Incident[],
  recoveries: { key: string; title: string }[],
): Promise<boolean> {
  const tplRes = await pool.query(
    "SELECT * FROM system_email_templates WHERE slug = 'system_alert' AND enabled = true"
  );
  if (tplRes.rows.length === 0) return false;
  const tpl = tplRes.rows[0];

  const recipients = await resolveRecipients(settings);
  if (recipients.length === 0) {
    logger.warn('System alert: no recipient (no active admin and alerting_recipients empty)');
    return false;
  }

  const active = newOnes.length + reminders.length;
  const title =
    active > 0
      ? (newOnes[0] ?? reminders[0]).title + (active > 1 ? ` (+${active - 1} autre${active > 2 ? 's' : ''})` : '')
      : `Rétabli : ${recoveries[0].title}`;

  const textLines: string[] = [];
  const htmlItems: string[] = [];
  for (const inc of newOnes) {
    textLines.push(`- [NOUVEAU] ${inc.title} : ${inc.detail}`);
    htmlItems.push(`<li><span style="color:#e53935;font-weight:bold">[NOUVEAU]</span> ${escapeHtml(inc.title)} : ${escapeHtml(inc.detail)}</li>`);
  }
  for (const inc of reminders) {
    textLines.push(`- [TOUJOURS EN COURS] ${inc.title} : ${inc.detail}`);
    htmlItems.push(`<li><span style="color:#f57c00;font-weight:bold">[TOUJOURS EN COURS]</span> ${escapeHtml(inc.title)} : ${escapeHtml(inc.detail)}</li>`);
  }
  for (const rec of recoveries) {
    textLines.push(`- [RÉTABLI] ${rec.title}`);
    htmlItems.push(`<li><span style="color:#2e7d32;font-weight:bold">[RÉTABLI]</span> ${escapeHtml(rec.title)}</li>`);
  }

  const vars: Record<string, string> = {
    alert_title: title,
    alert_details: textLines.join('\n'),
    alert_details_html: `<ul style="padding-left:18px">${htmlItems.join('')}</ul>`,
    date: new Date().toLocaleString('fr-FR'),
  };
  const render = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  try {
    await sendSystemEmail(recipients.join(', '), render(tpl.subject), render(tpl.body_html), render(tpl.body_text));
    logger.warn(
      `System alert sent to ${recipients.length} recipient(s): ${newOnes.length} new, ${reminders.length} reminder(s), ${recoveries.length} recovered`
    );
    return true;
  } catch (err: any) {
    logger.warn({ err }, 'System alert: email send failed (will retry)');
    return false;
  }
}
