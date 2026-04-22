import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../database/connection';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

/**
 * Branding routes — allow admins to replace the app icons / favicon and expose
 * the current app name for dynamic browser tab title + manifest.
 *
 * Uploaded files are written to `server/uploads/branding/{filename}` with fixed
 * names so they can be served at the root (`/icon-192.png`, etc.) via
 * middleware registered in `index.ts`. When no custom file exists, the static
 * frontend asset bundled at build-time is used as fallback.
 */

export const BRANDING_DIR = path.join(__dirname, '../../uploads/branding');

export type BrandingType = 'favicon' | 'icon192' | 'icon512' | 'apple';

/** Maps a branding type to the actual filename served at the root. */
export const BRANDING_FILES: Record<BrandingType, string> = {
  favicon: 'favicon.ico',
  icon192: 'icon-192.png',
  icon512: 'icon-512.png',
  apple: 'apple-touch-icon.png',
};

// Ensure directory exists
try { fs.mkdirSync(BRANDING_DIR, { recursive: true }); } catch { /* noop */ }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Type de fichier non supporté') as any, false);
  },
});

/** Public router — mounted at `/api/branding`, no authentication. */
export const brandingPublicRouter = Router();

brandingPublicRouter.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM admin_settings WHERE key IN ('app_name')`
    );
    const settings: Record<string, any> = {};
    for (const row of result.rows) settings[row.key] = row.value;

    const appName = typeof settings.app_name === 'string' ? settings.app_name : 'WebMail';

    // Cache-busting: use mtime of each file (if present) so the browser refetches on change.
    const iconVersion = (file: string): string => {
      try {
        const full = path.join(BRANDING_DIR, file);
        return fs.statSync(full).mtimeMs.toString(36);
      } catch {
        return '0';
      }
    };

    res.json({
      app_name: appName,
      icons: {
        favicon: `/favicon.ico?v=${iconVersion('favicon.ico')}`,
        icon192: `/icon-192.png?v=${iconVersion('icon-192.png')}`,
        icon512: `/icon-512.png?v=${iconVersion('icon-512.png')}`,
        apple: `/apple-touch-icon.png?v=${iconVersion('apple-touch-icon.png')}`,
      },
      custom: {
        favicon: fs.existsSync(path.join(BRANDING_DIR, 'favicon.ico')),
        icon192: fs.existsSync(path.join(BRANDING_DIR, 'icon-192.png')),
        icon512: fs.existsSync(path.join(BRANDING_DIR, 'icon-512.png')),
        apple: fs.existsSync(path.join(BRANDING_DIR, 'apple-touch-icon.png')),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Admin router — mounted under `/api/admin/branding`, requires admin auth (parent middleware). */
export const brandingAdminRouter = Router();

brandingAdminRouter.use(adminMiddleware);

brandingAdminRouter.post('/:type', upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const type = req.params.type as BrandingType;
    const filename = BRANDING_FILES[type];
    if (!filename) return res.status(400).json({ error: 'Type inconnu' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

    fs.writeFileSync(path.join(BRANDING_DIR, filename), req.file.buffer);
    logger.info(`Branding updated: ${type} (${req.file.size} bytes)`);
    res.json({ success: true, filename, size: req.file.size });
  } catch (error: any) {
    logger.error(error, 'Branding upload failed');
    res.status(500).json({ error: error.message });
  }
});

brandingAdminRouter.delete('/:type', async (req: AuthRequest, res) => {
  try {
    const type = req.params.type as BrandingType;
    const filename = BRANDING_FILES[type];
    if (!filename) return res.status(400).json({ error: 'Type inconnu' });

    const full = path.join(BRANDING_DIR, filename);
    if (fs.existsSync(full)) fs.unlinkSync(full);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
