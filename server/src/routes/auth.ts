import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../database/connection';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import {
  generateAccessToken,
  createDeviceSession,
  rotateDeviceSession,
  revokeByToken,
  revokeDeviceSession,
  listDeviceSessions,
  parseCookie,
  refreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from '../services/deviceSessions';
import { z } from 'zod';

export const authRouter = Router();

/** Issue an access token + refresh cookie for a freshly-authenticated user. */
async function issueSession(req: Request, res: Response, userId: string, isAdmin: boolean) {
  const ua = req.headers['user-agent'] || '';
  const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) || req.ip || '';
  const session = await createDeviceSession(userId, ua, ip);
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions());
  const accessToken = generateAccessToken({ userId, isAdmin, sid: session.sessionId });
  return { accessToken, sessionId: session.sessionId };
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
});

// Login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    
    const result = await pool.query(
      'SELECT id, email, password_hash, display_name, avatar_url, role, is_admin, language, timezone, theme FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Keep the legacy session cookie active for backward compatibility.
    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;

    // Short-lived access token + refresh cookie (stay signed in per device).
    const { accessToken } = await issueSession(req, res, user.id, user.is_admin);

    res.json({
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        role: user.role,
        isAdmin: user.is_admin,
        language: user.language,
        timezone: user.timezone,
        theme: user.theme,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Register (if allowed by admin settings)
authRouter.post('/register', async (req, res) => {
  try {
    // Check if registration is allowed
    const settingResult = await pool.query(
      "SELECT value FROM admin_settings WHERE key = 'allow_registration'"
    );
    const registrationAllowed = settingResult.rows[0]?.value === true || settingResult.rows[0]?.value === 'true';
    
    // Allow first user creation (admin)
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const isFirstUser = parseInt(userCount.rows[0].count) === 0;

    if (!isFirstUser && !registrationAllowed) {
      return res.status(403).json({ error: 'Inscription désactivée' });
    }

    const { email, password, displayName } = registerSchema.parse(req.body);

    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Cet email est déjà utilisé' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, is_admin, role) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, email, display_name, is_admin, role, language, timezone, theme`,
      [email, passwordHash, displayName, isFirstUser, isFirstUser ? 'admin' : 'user']
    );

    const user = result.rows[0];

    // Create default calendar
    await pool.query(
      `INSERT INTO calendars (user_id, name, is_default) VALUES ($1, $2, true)`,
      [user.id, 'Mon calendrier']
    );

    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;

    const { accessToken } = await issueSession(req, res, user.id, user.is_admin);

    res.status(201).json({
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        isAdmin: user.is_admin,
        role: user.role,
        language: user.language,
        timezone: user.timezone,
        theme: user.theme,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Données invalides', details: error.errors });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Logout — revoke the current device's refresh token + destroy legacy session.
authRouter.post('/logout', async (req, res) => {
  const presented = parseCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
  if (presented) {
    try { await revokeByToken(presented); } catch { /* best effort */ }
  }
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Déconnecté' });
  });
});

/**
 * Silent refresh — rotates the httpOnly refresh cookie and returns a fresh
 * access token. Called automatically by the client on 401 and on boot.
 */
authRouter.post('/refresh', async (req, res) => {
  const presented = parseCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
  if (!presented) {
    return res.status(401).json({ error: 'Refresh token manquant', code: 'no_refresh' });
  }
  try {
    const ua = req.headers['user-agent'] || '';
    const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) || req.ip || '';
    const rotated = await rotateDeviceSession(presented, ua, ip);
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      return res.status(401).json({ error: 'Session expirée', code: 'refresh_invalid' });
    }
    res.cookie(REFRESH_COOKIE_NAME, rotated.refreshToken, refreshCookieOptions());
    const accessToken = generateAccessToken({
      userId: rotated.userId,
      isAdmin: rotated.isAdmin,
      sid: rotated.sessionId,
    });
    res.json({ token: accessToken });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// List the authenticated user's active devices.
authRouter.get('/devices', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const rows = await listDeviceSessions(req.userId!);
    res.json(rows.map((r) => ({
      id: r.id,
      deviceName: r.device_name,
      userAgent: r.user_agent,
      ipLastSeen: r.ip_last_seen,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
      current: r.id === req.sessionId,
    })));
  } catch (error) {
    console.error('List devices error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Revoke a specific device (sign it out remotely).
authRouter.delete('/devices/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ok = await revokeDeviceSession(req.params.id, req.userId!);
    if (!ok) return res.status(404).json({ error: 'Appareil introuvable' });
    if (req.sessionId && req.sessionId === req.params.id) {
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke device error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Get current user
authRouter.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.userId || req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, display_name, avatar_url, role, is_admin, language, timezone, theme FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      role: user.role,
      isAdmin: user.is_admin,
      language: user.language,
      timezone: user.timezone,
      theme: user.theme,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});
