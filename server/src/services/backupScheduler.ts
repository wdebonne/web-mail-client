import { pool } from '../database/connection';
import { createBackupFile, applyRetentionPolicy, getBackupSettings } from './backupService';
import { logger } from '../utils/logger';

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startBackupScheduler(): void {
  if (schedulerInterval) return;
  // Check every minute whether an auto backup is due
  schedulerInterval = setInterval(checkAndRunAutoBackup, 60 * 1000);
  logger.info('Backup scheduler started');
}

export function stopBackupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
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
  } catch (err) {
    logger.error(err, 'Auto backup failed');
  } finally {
    isRunning = false;
  }
}
