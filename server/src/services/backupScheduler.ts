import { pool } from '../database/connection';
import { createBackupFile, applyRetentionPolicy, getBackupSettings } from './backupService';
import { logger } from '../utils/logger';
import { markServiceStarted, markServiceStopped, markServiceTick } from './serviceStatus';

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

const SERVICE_NAME = 'backupScheduler';

function runCheck() {
  Promise.resolve(checkAndRunAutoBackup())
    .then(() => markServiceTick(SERVICE_NAME))
    .catch((err) => markServiceTick(SERVICE_NAME, err));
}

export function startBackupScheduler(): void {
  if (schedulerInterval) return;
  // Check every minute whether an auto backup is due
  schedulerInterval = setInterval(runCheck, 60 * 1000);
  markServiceStarted(SERVICE_NAME, 'Sauvegarde automatique', 60 * 1000);
  logger.info('Backup scheduler started');
}

export function stopBackupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    markServiceStopped(SERVICE_NAME);
  }
}

async function checkAndRunAutoBackup(): Promise<void> {
  if (isRunning) return;
  try {
    const settings = await getBackupSettings();
    if (!settings.backup_auto_enabled) return;

    const now = new Date();
    const [targetH, targetM] = String(settings.backup_time || '02:00').split(':').map(Number);

    // Only fire in the exact minute window
    if (now.getUTCHours() !== targetH || now.getUTCMinutes() !== targetM) return;

    // Avoid running twice in the same minute
    if (settings.backup_last_auto_run) {
      const lastRun = new Date(settings.backup_last_auto_run);
      const diffMinutes = (now.getTime() - lastRun.getTime()) / 60_000;
      if (diffMinutes < 1) return;
    }

    // Check day-of-week / day-of-month for weekly/monthly frequencies
    const freq = settings.backup_frequency || 'daily';
    if (freq === 'weekly') {
      if (now.getUTCDay() !== Number(settings.backup_day_of_week ?? 1)) return;
    } else if (freq === 'monthly') {
      if (now.getUTCDate() !== Number(settings.backup_day_of_month ?? 1)) return;
    }

    isRunning = true;

    // Persist "last run" immediately to prevent a concurrent instance from firing
    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at) VALUES ('backup_last_auto_run', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(now.toISOString())]
    );

    logger.info('Auto backup starting...');
    await createBackupFile('Sauvegarde automatique', 'auto');
    await applyRetentionPolicy(settings);
    logger.info('Auto backup completed');
    await clearAutoBackupError();
  } catch (err) {
    logger.error(err, 'Auto backup failed');
    await recordAutoBackupError(err);
  } finally {
    isRunning = false;
  }
}

// Trace persistée du dernier échec de sauvegarde auto — lue par le vérificateur
// d'alertes (systemAlerts.ts) et par la page « État du système ». Effacée au
// prochain succès.
async function recordAutoBackupError(err: unknown): Promise<void> {
  try {
    const payload = {
      at: new Date().toISOString(),
      message: String((err as any)?.message ?? err).slice(0, 300),
    };
    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at) VALUES ('backup_last_auto_error', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(payload)]
    );
  } catch (e) {
    logger.warn(e, 'Unable to record auto backup error');
  }
}

async function clearAutoBackupError(): Promise<void> {
  try {
    await pool.query(`DELETE FROM admin_settings WHERE key = 'backup_last_auto_error'`);
  } catch (e) {
    logger.warn(e, 'Unable to clear auto backup error');
  }
}
