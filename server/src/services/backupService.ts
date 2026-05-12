import { pool } from '../database/connection';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { gzipSync, gunzipSync } from 'zlib';

export const BACKUPS_DIR = path.join(__dirname, '../../backups');

// Tables in FK dependency order (parents before children) — insert order during restore
export const BACKUP_TABLES = [
  'groups',
  'users',
  'user_groups',
  'user_preferences',
  'mail_accounts',
  'mailbox_assignments',
  'shared_mailbox_access',
  'contacts',
  'contact_groups',
  'contact_group_members',
  'distribution_lists',
  'calendars',
  'calendar_events',
  'shared_calendar_access',
  'external_calendar_shares',
  'auto_responders',
  'mail_templates',
  'mail_template_shares',
  'mail_rules',
  'nextcloud_users',
  'o2switch_accounts',
  'o2switch_email_links',
  'plugins',
  'plugin_assignments',
  'admin_settings',
  'ip_security_list',
  'log_alert_rules',
  'system_email_templates',
  'webauthn_credentials',
];

function ensureBackupDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

// ── Column type introspection ─────────────────────────────────────────────────

interface ColTypeInfo {
  jsonb: Set<string>; // json / jsonb columns
  bytea: Set<string>; // bytea columns
}

async function getColTypeInfo(
  client: { query: Function },
  tables: string[]
): Promise<Record<string, ColTypeInfo>> {
  const result = await client.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND data_type IN ('jsonb', 'json', 'bytea')
       AND table_name = ANY($1::text[])`,
    [tables]
  );
  const map: Record<string, ColTypeInfo> = {};
  for (const row of result.rows) {
    if (!map[row.table_name]) map[row.table_name] = { jsonb: new Set(), bytea: new Set() };
    if (row.data_type === 'jsonb' || row.data_type === 'json') {
      map[row.table_name].jsonb.add(row.column_name);
    } else if (row.data_type === 'bytea') {
      map[row.table_name].bytea.add(row.column_name);
    }
  }
  return map;
}

export interface BackupSettings {
  backup_auto_enabled: boolean;
  backup_frequency: 'daily' | 'weekly' | 'monthly';
  backup_time: string;
  backup_day_of_week: number;
  backup_day_of_month: number;
  backup_retention_daily: number;
  backup_retention_weekly: number;
  backup_retention_monthly: number;
  backup_retention_yearly: number;
  backup_last_auto_run?: string;
}

export async function getBackupSettings(): Promise<BackupSettings> {
  const defaults: BackupSettings = {
    backup_auto_enabled: false,
    backup_frequency: 'daily',
    backup_time: '02:00',
    backup_day_of_week: 1,
    backup_day_of_month: 1,
    backup_retention_daily: 7,
    backup_retention_weekly: 4,
    backup_retention_monthly: 12,
    backup_retention_yearly: 3,
  };
  const result = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key LIKE 'backup_%'`
  );
  for (const row of result.rows) {
    try {
      (defaults as any)[row.key] = JSON.parse(row.value);
    } catch {
      (defaults as any)[row.key] = row.value;
    }
  }
  return defaults;
}

export async function createBackupFile(
  label: string,
  type: 'manual' | 'auto'
): Promise<{ id: string; filename: string; sizeBytes: number }> {
  ensureBackupDir();

  // Get special column types so we can serialise them correctly in the JSON file
  const colInfo = await getColTypeInfo(pool, BACKUP_TABLES);

  const tables: Record<string, any[]> = {};
  for (const table of BACKUP_TABLES) {
    try {
      const result = await pool.query(`SELECT * FROM "${table}"`);
      const info = colInfo[table];
      // Normalise BYTEA → base64 so JSON.stringify can handle it
      tables[table] = result.rows.map(row => {
        if (!info?.bytea.size) return row;
        const newRow: Record<string, any> = { ...row };
        for (const col of info.bytea) {
          if (Buffer.isBuffer(newRow[col])) {
            newRow[col] = (newRow[col] as Buffer).toString('base64');
          }
        }
        return newRow;
      });
    } catch (err) {
      logger.warn(`Backup: skipping table "${table}": ${(err as Error).message}`);
      tables[table] = [];
    }
  }

  const pkgPath = path.join(__dirname, '../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const backupData = {
    format: 'webmail-backup',
    app_version: pkg.version,
    schema_version: 1,
    created_at: new Date().toISOString(),
    label,
    type,
    tables,
  };

  const json = JSON.stringify(backupData);
  const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 6 });

  const now = new Date();
  // Build filename: backup_2026-05-12T02-00-00_manual.json.gz
  const datePart = now.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '').replace('T', 'T');
  const filename = `backup_${datePart}_${type}.json.gz`;
  const filepath = path.join(BACKUPS_DIR, filename);
  fs.writeFileSync(filepath, compressed);

  const sizeBytes = compressed.length;
  const result = await pool.query(
    `INSERT INTO backup_records (filename, size_bytes, type, label) VALUES ($1, $2, $3, $4) RETURNING id`,
    [filename, sizeBytes, type, label]
  );
  return { id: result.rows[0].id, filename, sizeBytes };
}

export async function restoreFromBackup(data: Buffer): Promise<void> {
  let json: string;
  try {
    json = gunzipSync(data).toString('utf8');
  } catch {
    throw new Error('Le fichier ne peut pas être décompressé. Vérifiez qu\'il s\'agit d\'un fichier .json.gz valide.');
  }

  let backupData: any;
  try {
    backupData = JSON.parse(json);
  } catch {
    throw new Error('Le fichier de sauvegarde est corrompu (JSON invalide).');
  }

  if (backupData.format !== 'webmail-backup') {
    throw new Error('Format de sauvegarde invalide. Ce fichier n\'a pas été créé par cette application.');
  }
  if (!backupData.tables || typeof backupData.tables !== 'object') {
    throw new Error('Fichier de sauvegarde corrompu (section tables manquante).');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Introspect column types so we can re-encode values correctly on INSERT
    const colInfo = await getColTypeInfo(client, BACKUP_TABLES);

    // Truncate all tables at once — PostgreSQL resolves FK deps with CASCADE
    const tableList = BACKUP_TABLES.map(t => `"${t}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

    // Re-insert in FK dependency order (parents first)
    for (const table of BACKUP_TABLES) {
      const rows: any[] = backupData.tables[table];
      if (!rows || rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      if (columns.length === 0) continue;
      const info = colInfo[table];

      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const values: any[] = [];
        const rowPlaceholders = chunk.map((_row: any, ri: number) => {
          const offset = ri * columns.length;
          columns.forEach((col) => {
            const val = chunk[ri][col];
            if (val === null || val === undefined) {
              // SQL NULL — works for any column type
              values.push(null);
            } else if (info?.jsonb.has(col)) {
              // JSONB column: pg expects a JSON-serialised string.
              // pg auto-stringifies objects/arrays, but for scalar primitives
              // (strings, numbers, booleans) that came from a JSONB column we
              // must wrap them in JSON.stringify so PostgreSQL receives valid JSON.
              values.push(JSON.stringify(val));
            } else if (info?.bytea.has(col)) {
              // BYTEA column: was exported as base64, restore as Buffer
              values.push(Buffer.from(String(val), 'base64'));
            } else {
              values.push(val);
            }
          });
          return `(${columns.map((_c, ci) => `$${offset + ci + 1}`).join(', ')})`;
        });
        await client.query(
          `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES ${rowPlaceholders.join(', ')}`,
          values
        );
      }
    }

    await client.query('COMMIT');
    logger.info(`Database restore completed: ${backupData.label} (${backupData.created_at})`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function applyRetentionPolicy(settings: BackupSettings): Promise<void> {
  const dailyKeep = Math.max(1, Number(settings.backup_retention_daily ?? 7));
  const weeklyKeep = Math.max(0, Number(settings.backup_retention_weekly ?? 4));
  const monthlyKeep = Math.max(0, Number(settings.backup_retention_monthly ?? 12));
  const yearlyKeep = Math.max(0, Number(settings.backup_retention_yearly ?? 3));

  const result = await pool.query(
    `SELECT id, filename, created_at FROM backup_records WHERE type = 'auto' ORDER BY created_at DESC`
  );
  const allBackups = result.rows as { id: string; filename: string; created_at: Date }[];

  if (allBackups.length === 0) return;

  const keepIds = new Set<string>();
  const now = new Date();

  // Keep the most recent N backups (daily retention)
  allBackups.slice(0, dailyKeep).forEach(b => keepIds.add(b.id));

  // Keep one backup per ISO week for the last M weeks
  if (weeklyKeep > 0) {
    const weekSeen = new Set<string>();
    for (const b of allBackups) {
      const d = new Date(b.created_at);
      const weeksAgo = (now.getTime() - d.getTime()) / (7 * 24 * 3600 * 1000);
      if (weeksAgo > weeklyKeep) continue;
      const key = `${d.getUTCFullYear()}-W${String(getISOWeekNumber(d)).padStart(2, '0')}`;
      if (!weekSeen.has(key)) { weekSeen.add(key); keepIds.add(b.id); }
    }
  }

  // Keep one backup per month for the last P months
  if (monthlyKeep > 0) {
    const monthSeen = new Set<string>();
    for (const b of allBackups) {
      const d = new Date(b.created_at);
      const monthsAgo = (now.getTime() - d.getTime()) / (30.44 * 24 * 3600 * 1000);
      if (monthsAgo > monthlyKeep) continue;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!monthSeen.has(key)) { monthSeen.add(key); keepIds.add(b.id); }
    }
  }

  // Keep one backup per year for the last Q years
  if (yearlyKeep > 0) {
    const yearSeen = new Set<string>();
    for (const b of allBackups) {
      const d = new Date(b.created_at);
      const yearsAgo = (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (yearsAgo > yearlyKeep) continue;
      const key = `${d.getUTCFullYear()}`;
      if (!yearSeen.has(key)) { yearSeen.add(key); keepIds.add(b.id); }
    }
  }

  // Delete backups not marked for retention
  let deleted = 0;
  for (const b of allBackups) {
    if (!keepIds.has(b.id)) {
      const filepath = path.join(BACKUPS_DIR, b.filename);
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}
      await pool.query('DELETE FROM backup_records WHERE id = $1', [b.id]);
      deleted++;
    }
  }
  if (deleted > 0) {
    logger.info(`Retention policy: deleted ${deleted} old auto backup(s)`);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
