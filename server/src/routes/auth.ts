import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../database/connection';
import { generateToken, AuthRequest, authMiddleware } from '../middleware/auth';
import { z } from 'zod';

export const authRouter = Router();

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

    // Set session
    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;

    // Generate token for PWA/offline use
    const token = generateToken(user.id, user.is_admin);

    res.json({
      token,
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

    const token = generateToken(user.id, user.is_admin);

    res.status(201).json({
      token,
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

// Logout
authRouter.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Déconnecté' });
  });
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
