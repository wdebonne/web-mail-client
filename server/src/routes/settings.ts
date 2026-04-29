import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';

export const settingsRouter = Router();

// Get user settings
settingsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const [userResult, attachmentSetting] = await Promise.all([
      pool.query(
        'SELECT display_name, avatar_url, language, timezone, theme, attachment_action_mode FROM users WHERE id = $1',
        [req.userId]
      ),
      pool.query(
        "SELECT value FROM admin_settings WHERE key = 'attachment_visibility_min_kb' LIMIT 1"
      ),
    ]);

    const rawThreshold = attachmentSetting.rows[0]?.value;
    const parsedThreshold = Number(rawThreshold);
    const attachmentVisibilityMinKb = Number.isFinite(parsedThreshold) ? Math.max(0, parsedThreshold) : 10;

    res.json({
      ...(userResult.rows[0] || {}),
      attachment_visibility_min_kb: attachmentVisibilityMinKb,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update user settings
settingsRouter.put('/', async (req: AuthRequest, res) => {
  try {
    const { displayName, language, timezone, theme, attachmentActionMode } = req.body;

    const safeAttachmentMode = ['preview', 'download', 'menu'].includes(attachmentActionMode)
      ? attachmentActionMode
      : undefined;

    const result = await pool.query(
      `UPDATE users SET 
        display_name = COALESCE($1, display_name),
        language = COALESCE($2, language),
        timezone = COALESCE($3, timezone),
        theme = COALESCE($4, theme),
        attachment_action_mode = COALESCE($5, attachment_action_mode),
        updated_at = NOW()
       WHERE id = $6 RETURNING display_name, language, timezone, theme, attachment_action_mode`,
      [displayName, language, timezone, theme, safeAttachmentMode, req.userId]
    );
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Change password
settingsRouter.put('/password', async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const bcrypt = await import('bcryptjs');
    
    const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const valid = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });

    if (newPassword.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.userId]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update avatar
settingsRouter.put('/avatar', async (req: AuthRequest, res) => {
  try {
    const { avatarUrl } = req.body;
    await pool.query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, req.userId]);
    res.json({ success: true, avatarUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// User preferences — generic key/value store synchronised across devices.
//
// The client stores UI customisations (renamed folders, account ordering,
// calendar colours, layout preferences, etc.) in `localStorage`. To make
// these settings follow the user across PCs/phones/tablets, the same
// key/value pairs are mirrored server-side in the `user_preferences`
// table. Each row carries an `updated_at` timestamp; the client and the
// server merge using last-write-wins on that timestamp, so the most
// recent change on any device wins.
//
// Values are kept as plain strings — they are already JSON-encoded by the
// client (the `localStorage` API only stores strings). Length is capped
// to 64 KB per key to keep one user's payload bounded.
// ─────────────────────────────────────────────────────────────────────────

const MAX_PREF_VALUE_BYTES = 64 * 1024;
const MAX_PREFS_PER_USER = 500;
const KEY_REGEX = /^[a-zA-Z0-9_.\-:]{1,255}$/;

type IncomingPrefItem = { value: string | null; updatedAt?: string };

function parseIso(iso: unknown): Date | null {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

settingsRouter.get('/preferences', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query<{ key: string; value: string | null; updated_at: Date }>(
      'SELECT key, value, updated_at FROM user_preferences WHERE user_id = $1',
      [req.userId]
    );
    const items: Record<string, { value: string | null; updatedAt: string }> = {};
    for (const row of result.rows) {
      items[row.key] = {
        value: row.value,
        updatedAt: row.updated_at.toISOString(),
      };
    }
    res.json({ items });
  } catch (error: any) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: error.message || 'Erreur de récupération des préférences' });
  }
});

settingsRouter.put('/preferences', async (req: AuthRequest, res) => {
  try {
    const items = req.body?.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      return res.status(400).json({ error: 'Corps invalide : { items: { key: { value, updatedAt } } } attendu' });
    }
    const entries = Object.entries(items as Record<string, IncomingPrefItem>);
    if (entries.length === 0) return res.json({ accepted: 0, items: {} });
    if (entries.length > MAX_PREFS_PER_USER) {
      return res.status(413).json({ error: `Trop de préférences en une seule requête (max ${MAX_PREFS_PER_USER})` });
    }

    // Validate every entry up front so a partial commit never happens.
    const valid: Array<{ key: string; value: string | null; updatedAt: Date }> = [];
    for (const [key, raw] of entries) {
      if (!KEY_REGEX.test(key)) {
        return res.status(400).json({ error: `Clé invalide : ${key}` });
      }
      if (!raw || typeof raw !== 'object') {
        return res.status(400).json({ error: `Valeur invalide pour ${key}` });
      }
      const value = raw.value;
      if (value !== null && typeof value !== 'string') {
        return res.status(400).json({ error: `Valeur non-string pour ${key}` });
      }
      if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_PREF_VALUE_BYTES) {
        return res.status(413).json({ error: `Valeur trop volumineuse pour ${key} (max ${MAX_PREF_VALUE_BYTES} octets)` });
      }
      const updatedAt = parseIso(raw.updatedAt) || new Date();
      valid.push({ key, value: value ?? null, updatedAt });
    }

    // Upsert with last-write-wins. The WHERE clause inside the conflict
    // resolution drops the incoming row when the stored timestamp is newer.
    const accepted: Record<string, { value: string | null; updatedAt: string }> = {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of valid) {
        const result = await client.query<{ value: string | null; updated_at: Date }>(
          `INSERT INTO user_preferences (user_id, key, value, updated_at)
             VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, key) DO UPDATE
             SET value = EXCLUDED.value,
                 updated_at = EXCLUDED.updated_at
             WHERE user_preferences.updated_at < EXCLUDED.updated_at
           RETURNING value, updated_at`,
          [req.userId, item.key, item.value, item.updatedAt]
        );
        if (result.rows[0]) {
          accepted[item.key] = {
            value: result.rows[0].value,
            updatedAt: result.rows[0].updated_at.toISOString(),
          };
        }
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    res.json({ accepted: Object.keys(accepted).length, items: accepted });
  } catch (error: any) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: error.message || 'Erreur de mise à jour des préférences' });
  }
});

settingsRouter.delete('/preferences/:key', async (req: AuthRequest, res) => {
  try {
    const { key } = req.params;
    if (!KEY_REGEX.test(key)) return res.status(400).json({ error: 'Clé invalide' });
    await pool.query('DELETE FROM user_preferences WHERE user_id = $1 AND key = $2', [req.userId, key]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


