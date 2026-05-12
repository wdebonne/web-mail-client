import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../database/connection';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { sendSystemEmail } from '../services/systemEmail';
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
import {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
  listCredentials,
  deleteCredential,
  hasCredentials,
  beginDiscoverableAuthentication,
  finishDiscoverableAuthentication,
} from '../services/webauthn';
import { z } from 'zod';
import { addLog } from '../services/auditLog';

const PENDING_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'change-me';

/** Short-lived token bridging step 1 (password) and step 2 (biometric). */
function issuePendingToken(userId: string, isAdmin: boolean): string {
  return jwt.sign({ userId, isAdmin, purpose: '2fa' }, PENDING_SECRET, { expiresIn: '5m' });
}

function verifyPendingToken(token: string): { userId: string; isAdmin: boolean } | null {
  try {
    const decoded = jwt.verify(token, PENDING_SECRET) as any;
    if (decoded.purpose !== '2fa') return null;
    return { userId: decoded.userId, isAdmin: decoded.isAdmin };
  } catch {
    return null;
  }
}

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

async function getSecuritySettings() {
  const result = await pool.query(
    `SELECT key, value FROM admin_settings WHERE key LIKE 'security_%'`
  );
  const s: Record<string, any> = {};
  for (const row of result.rows) s[row.key] = row.value;
  return {
    maxAttempts: Number(s['security_max_failed_attempts'] ?? 3),
    lockoutMinutes: Number(s['security_lockout_duration_minutes'] ?? 30),
    alertEnabled: s['security_email_alert_enabled'] === true || s['security_email_alert_enabled'] === 'true',
    alertThreshold: Number(s['security_email_alert_threshold'] ?? 3),
    alertRecipient: typeof s['security_email_alert_recipient'] === 'string'
      ? s['security_email_alert_recipient']
      : String(s['security_email_alert_recipient'] ?? ''),
    whitelistAlertEnabled: s['security_whitelist_alert_enabled'] === true || s['security_whitelist_alert_enabled'] === 'true',
  };
}

async function sendSecurityAlert(recipient: string, email: string, ip: string, attempts: number, whitelisted: boolean) {
  const subject = `[Sécurité] Tentatives de connexion échouées — ${email}`;
  const html = `<div style="font-family:sans-serif;max-width:600px">
    <h2 style="color:#e53935">Alerte de sécurité</h2>
    <p><strong>${attempts}</strong> tentative(s) de connexion échouée(s) pour le compte <strong>${email}</strong>.</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:6px;font-weight:bold">Email</td><td style="padding:6px">${email}</td></tr>
      <tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">IP</td><td style="padding:6px">${ip}</td></tr>
      <tr><td style="padding:6px;font-weight:bold">Tentatives</td><td style="padding:6px">${attempts}</td></tr>
      <tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">IP en liste blanche</td><td style="padding:6px">${whitelisted ? 'Oui (compte non verrouillé)' : 'Non'}</td></tr>
      <tr><td style="padding:6px;font-weight:bold">Date</td><td style="padding:6px">${new Date().toLocaleString('fr-FR')}</td></tr>
    </table>
  </div>`;
  const text = `Alerte sécurité\n${attempts} tentative(s) échouée(s) pour ${email} depuis ${ip}.\nIP liste blanche : ${whitelisted ? 'Oui' : 'Non'}\nDate : ${new Date().toLocaleString('fr-FR')}`;
  await sendSystemEmail(recipient, subject, html, text);
}

// Login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) || req.ip || '';
    const ua = req.headers['user-agent'] || '';

    // Load security settings
    const sec = await getSecuritySettings();

    // Check IP blacklist before any user lookup
    const blacklisted = await pool.query(
      `SELECT id FROM ip_security_list WHERE ip_address = $1 AND list_type = 'blacklist'`,
      [ip]
    );
    if (blacklisted.rows.length > 0) {
      await pool.query(
        `INSERT INTO login_attempts (email, ip_address, user_agent, success, block_reason)
         VALUES ($1, $2, $3, false, 'blacklist')`,
        [email, ip, ua]
      );
      addLog(undefined, 'user.login_blocked', 'auth', req, { email, reason: 'blacklist' }).catch(() => {});
      return res.status(403).json({ error: 'Accès refusé depuis cette adresse IP' });
    }

    // Check whitelist
    const whitelisted = await pool.query(
      `SELECT id FROM ip_security_list WHERE ip_address = $1 AND list_type = 'whitelist'`,
      [ip]
    );
    const isWhitelisted = whitelisted.rows.length > 0;

    const result = await pool.query(
      `SELECT id, email, password_hash, display_name, avatar_url, role, is_admin, is_active,
              language, timezone, theme, failed_attempts, locked_until
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      await pool.query(
        `INSERT INTO login_attempts (email, ip_address, user_agent, success, block_reason)
         VALUES ($1, $2, $3, false, 'unknown_email')`,
        [email, ip, ua]
      );
      addLog(undefined, 'user.login_failed', 'auth', req, { email, reason: 'unknown_email' }).catch(() => {});
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    // Check account lockout (whitelisted IPs bypass lockout)
    if (!isWhitelisted && user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      await pool.query(
        `INSERT INTO login_attempts (user_id, email, ip_address, user_agent, success, block_reason)
         VALUES ($1, $2, $3, $4, false, 'locked')`,
        [user.id, email, ip, ua]
      );
      addLog(user.id, 'user.login_blocked', 'auth', req, { email, reason: 'locked' }).catch(() => {});
      return res.status(423).json({
        error: minutesLeft > 60 * 24
          ? 'Compte verrouillé. Contactez un administrateur.'
          : `Compte verrouillé. Réessayez dans ${minutesLeft} minute(s) ou contactez un administrateur.`,
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      let lockedUntil: Date | null = null;

      if (!isWhitelisted && newAttempts >= sec.maxAttempts) {
        lockedUntil = sec.lockoutMinutes > 0
          ? new Date(Date.now() + sec.lockoutMinutes * 60 * 1000)
          : new Date('9999-12-31T23:59:59Z');
        await pool.query(
          'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
          [newAttempts, lockedUntil, user.id]
        );
      } else {
        await pool.query('UPDATE users SET failed_attempts = $1 WHERE id = $2', [newAttempts, user.id]);
      }

      await pool.query(
        `INSERT INTO login_attempts (user_id, email, ip_address, user_agent, success, block_reason)
         VALUES ($1, $2, $3, $4, false, $5)`,
        [user.id, email, ip, ua, lockedUntil ? 'locked' : null]
      );
      addLog(user.id, lockedUntil ? 'user.login_blocked' : 'user.login_failed', 'auth', req, {
        email,
        reason: lockedUntil ? 'locked_now' : 'bad_password',
        failedAttempts: newAttempts,
      }).catch(() => {});

      const shouldAlert =
        (sec.alertEnabled && newAttempts >= sec.alertThreshold) ||
        (isWhitelisted && sec.whitelistAlertEnabled && newAttempts >= sec.alertThreshold);
      if (shouldAlert && sec.alertRecipient) {
        sendSecurityAlert(sec.alertRecipient, email, ip, newAttempts, isWhitelisted).catch(() => {});
      }

      const remaining = !isWhitelisted ? Math.max(0, sec.maxAttempts - newAttempts) : null;
      if (lockedUntil) {
        const minutesLeft = sec.lockoutMinutes > 0 ? sec.lockoutMinutes : null;
        return res.status(401).json({
          error: minutesLeft
            ? `Compte verrouillé pour ${minutesLeft} minute(s). Contactez un administrateur si nécessaire.`
            : 'Compte verrouillé. Contactez un administrateur.',
        });
      }
      return res.status(401).json({
        error: remaining !== null && remaining > 0
          ? `Email ou mot de passe incorrect (${remaining} tentative(s) restante(s))`
          : 'Email ou mot de passe incorrect',
      });
    }

    if (user.is_active === false) {
      return res.status(403).json({ error: 'Ce compte est désactivé' });
    }

    // Reset failed attempts on successful login
    if (user.failed_attempts > 0 || user.locked_until) {
      await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
    }

    await pool.query(
      `INSERT INTO login_attempts (user_id, email, ip_address, user_agent, success)
       VALUES ($1, $2, $3, $4, true)`,
      [user.id, email, ip, ua]
    );
    addLog(user.id, 'user.login', 'auth', req, { email, method: 'password' }).catch(() => {});

    // Step-up 2FA: if the user has registered at least one passkey, force
    // biometric proof before issuing a full session.
    if (await hasCredentials(user.id)) {
      const pendingToken = issuePendingToken(user.id, user.is_admin);
      return res.json({
        requires2FA: true,
        pendingToken,
        userId: user.id,
      });
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

// Consume a password reset token (generated by admin)
authRouter.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Token et mot de passe (8 caractères min.) requis' });
    }

    const result = await pool.query(
      `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at
       FROM password_resets pr
       WHERE pr.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Lien invalide ou expiré' });
    }

    const reset = result.rows[0];
    if (reset.used_at) return res.status(400).json({ error: 'Ce lien a déjà été utilisé' });
    if (new Date(reset.expires_at) < new Date()) return res.status(400).json({ error: 'Lien expiré' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, reset.user_id]);
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Logout — revoke the current device's refresh token + destroy legacy session.
authRouter.post('/logout', async (req, res) => {
  const logoutUserId: string | undefined = (req.session as any)?.userId;
  const presented = parseCookie(req.headers.cookie, REFRESH_COOKIE_NAME);
  if (presented) {
    try { await revokeByToken(presented); } catch { /* best effort */ }
  }
  addLog(logoutUserId, 'user.logout', 'auth', req, {}).catch(() => {});
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

// ─────────────────────────────────────────────────────────────────────────────
// WebAuthn / passkeys
// ─────────────────────────────────────────────────────────────────────────────

/** Begin enrolment of a new passkey for the logged-in user. */
authRouter.post('/webauthn/register/options', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await pool.query(
      'SELECT email, display_name FROM users WHERE id = $1',
      [req.userId!]
    );
    if (user.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const options = await beginRegistration(
      req.userId!,
      user.rows[0].email,
      user.rows[0].display_name || user.rows[0].email
    );
    res.json(options);
  } catch (error) {
    console.error('WebAuthn register options error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

authRouter.post('/webauthn/register/verify', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname.slice(0, 80) : undefined;
    const response = req.body?.response;
    if (!response) return res.status(400).json({ error: 'Réponse manquante' });
    const saved = await finishRegistration(req.userId!, response, nickname);
    res.json({ success: true, id: saved.id });
  } catch (error: any) {
    console.error('WebAuthn register verify error:', error);
    res.status(400).json({ error: error?.message || 'Vérification échouée' });
  }
});

/** List registered passkeys. */
authRouter.get('/webauthn/credentials', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await listCredentials(req.userId!));
  } catch (error) {
    console.error('WebAuthn list error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

authRouter.delete('/webauthn/credentials/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const ok = await deleteCredential(req.userId!, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Credential introuvable' });
    res.json({ success: true });
  } catch (error) {
    console.error('WebAuthn delete error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Step-2 login: exchange a pending token + biometric proof for a full session.
 */
authRouter.post('/webauthn/login/options', async (req, res) => {
  try {
    const pending = typeof req.body?.pendingToken === 'string' ? req.body.pendingToken : '';
    const ctx = verifyPendingToken(pending);
    if (!ctx) return res.status(401).json({ error: 'Session de connexion expirée' });
    const options = await beginAuthentication(ctx.userId);
    res.json(options);
  } catch (error: any) {
    console.error('WebAuthn login options error:', error);
    res.status(400).json({ error: error?.message || 'Erreur' });
  }
});

authRouter.post('/webauthn/login/verify', async (req, res) => {
  try {
    const pending = typeof req.body?.pendingToken === 'string' ? req.body.pendingToken : '';
    const ctx = verifyPendingToken(pending);
    if (!ctx) return res.status(401).json({ error: 'Session de connexion expirée' });
    const response = req.body?.response;
    if (!response) return res.status(400).json({ error: 'Réponse manquante' });
    await finishAuthentication(ctx.userId, response);

    const userRes = await pool.query(
      'SELECT id, email, display_name, avatar_url, role, is_admin, language, timezone, theme FROM users WHERE id = $1',
      [ctx.userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = userRes.rows[0];

    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;

    const { accessToken } = await issueSession(req, res, user.id, user.is_admin);
    addLog(user.id, 'user.login', 'auth', req, { email: user.email, method: 'webauthn_2fa' }).catch(() => {});
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
  } catch (error: any) {
    console.error('WebAuthn login verify error:', error);
    res.status(400).json({ error: error?.message || 'Vérification échouée' });
  }
});

/**
 * PWA unlock — the authenticated user proves presence (biometric) to unlock
 * the app after a period of inactivity. Uses the current access token to
 * identify the user.
 */
authRouter.post('/webauthn/unlock/options', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const options = await beginAuthentication(req.userId!);
    res.json(options);
  } catch (error: any) {
    console.error('WebAuthn unlock options error:', error);
    res.status(400).json({ error: error?.message || 'Erreur' });
  }
});

authRouter.post('/webauthn/unlock/verify', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const response = req.body?.response;
    if (!response) return res.status(400).json({ error: 'Réponse manquante' });
    await finishAuthentication(req.userId!, response);
    res.json({ success: true });
  } catch (error: any) {
    console.error('WebAuthn unlock verify error:', error);
    res.status(400).json({ error: error?.message || 'Vérification échouée' });
  }
});

/**
 * Passwordless login with a discoverable passkey (FIDO2 resident credential).
 * The client calls `/options` without any identifier — the browser displays an
 * account picker of resident keys bound to this RP. On `/verify`, the server
 * resolves the user from the returned credential id and issues a full session.
 *
 * Public endpoints: by design, WebAuthn replaces the password in this flow.
 */
authRouter.post('/webauthn/passkey/options', async (_req, res) => {
  try {
    const options = await beginDiscoverableAuthentication();
    res.json(options);
  } catch (error: any) {
    console.error('WebAuthn passkey options error:', error);
    res.status(500).json({ error: error?.message || 'Erreur serveur' });
  }
});

authRouter.post('/webauthn/passkey/verify', async (req, res) => {
  try {
    const response = req.body?.response;
    if (!response) return res.status(400).json({ error: 'Réponse manquante' });
    const { userId } = await finishDiscoverableAuthentication(response);

    const userRes = await pool.query(
      'SELECT id, email, display_name, avatar_url, role, is_admin, language, timezone, theme FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = userRes.rows[0];

    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;

    const { accessToken } = await issueSession(req, res, user.id, user.is_admin);
    addLog(user.id, 'user.login', 'auth', req, { email: user.email, method: 'passkey' }).catch(() => {});
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
  } catch (error: any) {
    console.error('WebAuthn passkey verify error:', error);
    res.status(400).json({ error: error?.message || 'Vérification échouée' });
  }
});
