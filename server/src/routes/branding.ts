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
      `SELECT key, value FROM admin_settings WHERE key IN (
        'app_name',
        'login_title', 'login_subtitle',
        'login_background_color', 'login_background_image',
        'login_background_blur', 'login_background_overlay',
        'login_card_bg_color', 'login_card_text_color',
        'login_accent_color', 'login_accent_hover_color',
        'login_show_register', 'login_show_passkey_button',
        'login_forgot_password', 'registration_allowed_domains'
      )`
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

    // Login background: filename stored in settings (to preserve extension).
    const bgFile = typeof settings.login_background_image === 'string' ? settings.login_background_image : null;
    const bgExists = bgFile ? fs.existsSync(path.join(BRANDING_DIR, bgFile)) : false;
    const loginBackgroundUrl = bgExists
      ? `/uploads/branding/${bgFile}?v=${iconVersion(bgFile!)}`
      : null;

    const str = (v: any, fallback: string | null = null) =>
      typeof v === 'string' && v.trim() ? v : fallback;
    const num = (v: any, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const bool = (v: any, fallback: boolean) => {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return fallback;
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
      login_appearance: {
        title: str(settings.login_title, null),
        subtitle: str(settings.login_subtitle, null),
        backgroundColor: str(settings.login_background_color, null),
        backgroundImage: loginBackgroundUrl,
        backgroundBlur: num(settings.login_background_blur, 0),
        backgroundOverlay: str(settings.login_background_overlay, null),
        cardBgColor: str(settings.login_card_bg_color, null),
        cardTextColor: str(settings.login_card_text_color, null),
        accentColor: str(settings.login_accent_color, null),
        accentHoverColor: str(settings.login_accent_hover_color, null),
        showRegister: bool(settings.login_show_register, true),
        showPasskeyButton: bool(settings.login_show_passkey_button, true),
        showForgotPassword: bool(settings.login_forgot_password, false),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** Admin router — mounted under `/api/admin/branding`, requires admin auth (parent middleware). */
export const brandingAdminRouter = Router();

brandingAdminRouter.use(adminMiddleware);

/**
 * Login background image — stored under an arbitrary extension (png/jpg/webp)
 * and referenced from admin_settings.login_background_image. A separate
 * endpoint is used (rather than reusing BRANDING_FILES) because the filename
 * extension varies per upload.
 *
 * NOTE: These specific routes are declared BEFORE the `/:type` routes below,
 * otherwise Express would match `/login-background/*` as `type=login-background`.
 */
const loginBgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Type de fichier non supporté (PNG, JPEG, WEBP, GIF)') as any, false);
  },
});

const loginBgFileName = (mime: string): string => {
  if (mime === 'image/png') return 'login-background.png';
  if (mime === 'image/webp') return 'login-background.webp';
  if (mime === 'image/gif') return 'login-background.gif';
  return 'login-background.jpg';
};

brandingAdminRouter.post('/login-background/upload', loginBgUpload.single('file'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
    const filename = loginBgFileName(req.file.mimetype);

    // Remove any previously uploaded background with a different extension.
    for (const f of ['login-background.png', 'login-background.jpg', 'login-background.webp', 'login-background.gif']) {
      if (f !== filename) {
        const p = path.join(BRANDING_DIR, f);
        if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* noop */ } }
      }
    }

    fs.writeFileSync(path.join(BRANDING_DIR, filename), req.file.buffer);

    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at) VALUES ('login_background_image', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(filename)]
    );

    logger.info(`Login background uploaded: ${filename} (${req.file.size} bytes)`);
    res.json({ success: true, filename, size: req.file.size });
  } catch (error: any) {
    logger.error(error, 'Login background upload failed');
    res.status(500).json({ error: error.message });
  }
});

brandingAdminRouter.delete('/login-background', async (_req: AuthRequest, res) => {
  try {
    for (const f of ['login-background.png', 'login-background.jpg', 'login-background.webp', 'login-background.gif']) {
      const p = path.join(BRANDING_DIR, f);
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* noop */ } }
    }
    await pool.query(`DELETE FROM admin_settings WHERE key = 'login_background_image'`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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
