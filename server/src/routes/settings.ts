import { Router } from 'express';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';

export const settingsRouter = Router();

// Get user settings
settingsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const [userResult, attachmentSetting] = await Promise.all([
      pool.query(
        'SELECT display_name, avatar_url, language, timezone, theme FROM users WHERE id = $1',
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
    const { displayName, language, timezone, theme } = req.body;
    const result = await pool.query(
      `UPDATE users SET 
        display_name = COALESCE($1, display_name),
        language = COALESCE($2, language),
        timezone = COALESCE($3, timezone),
        theme = COALESCE($4, theme),
        updated_at = NOW()
       WHERE id = $5 RETURNING display_name, language, timezone, theme`,
      [displayName, language, timezone, theme, req.userId]
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
