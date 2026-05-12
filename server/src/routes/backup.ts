import { Router } from 'express';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { pool } from '../database/connection';
import { addLog } from '../services/auditLog';
import {
  createBackupFile,
  restoreFromBackup,
  getBackupSettings,
  applyRetentionPolicy,
  BACKUPS_DIR,
  BACKUP_TABLES,
  type UrlReplacement,
} from '../services/backupService';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

export const backupRouter = Router();
backupRouter.use(adminMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.json.gz') || file.mimetype === 'application/gzip' || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers .json.gz sont acceptés'));
    }
  },
});

// ---- List backups ----
backupRouter.get('/list', async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename, size_bytes, type, label, created_at
       FROM backup_records
       ORDER BY created_at DESC`
    );
    const backups = result.rows.map(row => ({
      ...row,
      file_exists: fs.existsSync(path.join(BACKUPS_DIR, row.filename)),
    }));
    res.json(backups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Create manual backup ----
backupRouter.post('/create', async (req: AuthRequest, res) => {
  try {
    const label = String(req.body.label || 'Sauvegarde manuelle').slice(0, 200);
    const result = await createBackupFile(label, 'manual');
    await addLog(req.userId, 'backup.created', 'backup', req, { filename: result.filename, size: result.sizeBytes });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Download backup ----
backupRouter.get('/download/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename FROM backup_records WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sauvegarde introuvable' });
    const record = result.rows[0];
    const filepath = path.join(BACKUPS_DIR, record.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier de sauvegarde introuvable sur le serveur' });
    await addLog(req.userId, 'backup.downloaded', 'backup', req, { filename: record.filename });
    res.download(filepath, record.filename);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Delete backup ----
backupRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, filename FROM backup_records WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Sauvegarde introuvable' });
    const record = result.rows[0];
    const filepath = path.join(BACKUPS_DIR, record.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    await pool.query('DELETE FROM backup_records WHERE id = $1', [req.params.id]);
    await addLog(req.userId, 'backup.deleted', 'backup', req, { filename: record.filename });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Restore from backup (upload) ----
backupRouter.post('/restore', upload.single('backup'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier de sauvegarde requis (champ "backup")' });
    const urlReplacement: UrlReplacement | undefined =
      req.body.oldUrl && req.body.newUrl
        ? { oldUrl: String(req.body.oldUrl), newUrl: String(req.body.newUrl) }
        : undefined;
    await restoreFromBackup(req.file.buffer, urlReplacement);
    await addLog(req.userId, 'backup.restored', 'backup', req, {
      filename: req.file.originalname,
      size: req.file.size,
      urlReplacement,
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Get backup settings ----
backupRouter.get('/settings', async (_req: AuthRequest, res) => {
  try {
    const settings = await getBackupSettings();
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Update backup settings ----
const ALLOWED_BACKUP_SETTINGS = [
  'backup_auto_enabled',
  'backup_frequency',
  'backup_time',
  'backup_day_of_week',
  'backup_day_of_month',
  'backup_retention_daily',
  'backup_retention_weekly',
  'backup_retention_monthly',
  'backup_retention_yearly',
];

backupRouter.put('/settings', async (req: AuthRequest, res) => {
  try {
    for (const key of ALLOWED_BACKUP_SETTINGS) {
      if (key in req.body) {
        await pool.query(
          `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
          [key, JSON.stringify(req.body[key])]
        );
      }
    }
    await addLog(req.userId, 'backup.settings_updated', 'backup', req, {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Get backup stats (table row counts) ----
backupRouter.get('/stats', async (_req: AuthRequest, res) => {
  try {
    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      try {
        const r = await pool.query(`SELECT COUNT(*) FROM "${table}"`);
        counts[table] = parseInt(r.rows[0].count);
      } catch {
        counts[table] = 0;
      }
    }
    // Disk usage
    let totalSize = 0;
    let fileCount = 0;
    if (fs.existsSync(BACKUPS_DIR)) {
      const files = fs.readdirSync(BACKUPS_DIR);
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(BACKUPS_DIR, f));
          totalSize += stat.size;
          fileCount++;
        } catch {}
      }
    }
    res.json({ table_counts: counts, disk_usage_bytes: totalSize, backup_file_count: fileCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
