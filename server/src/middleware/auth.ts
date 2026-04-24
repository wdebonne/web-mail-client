import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken, isSessionActive } from '../services/deviceSessions';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    isAdmin: boolean;
  }
}

export interface AuthRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
  sessionId?: string;
}

const LEGACY_JWT_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

/**
 * @deprecated Kept only so existing imports keep compiling. New login/register
 * flows issue short-lived access tokens via `generateAccessToken` from
 * `services/deviceSessions` paired with a refresh cookie.
 */
export function generateToken(userId: string, isAdmin: boolean): string {
  return jwt.sign({ userId, isAdmin }, LEGACY_JWT_SECRET, { expiresIn: '30d' });
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // 1. Session cookie (server-rendered flows)
  if (req.session?.userId) {
    req.userId = req.session.userId;
    req.isAdmin = req.session.isAdmin || false;
    return next();
  }

  // 2. Bearer access token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);

    // Preferred path: short-lived access token bound to a device session.
    const accessPayload = verifyAccessToken(token);
    if (accessPayload) {
      if (accessPayload.sid) {
        // Ensure the device session was not revoked (immediate effect for
        // "sign out of this device" even before the 15-min TTL elapses).
        const active = await isSessionActive(accessPayload.sid);
        if (!active) {
          return res.status(401).json({ error: 'Session révoquée', code: 'session_revoked' });
        }
      }
      req.userId = accessPayload.userId;
      req.isAdmin = accessPayload.isAdmin;
      req.sessionId = accessPayload.sid;
      return next();
    }

    // Legacy path: long-lived JWTs issued before the refresh-token rollout.
    try {
      const decoded = jwt.verify(token, LEGACY_JWT_SECRET) as { userId: string; isAdmin: boolean };
      req.userId = decoded.userId;
      req.isAdmin = decoded.isAdmin;
      return next();
    } catch {
      return res.status(401).json({ error: 'Token invalide', code: 'invalid_token' });
    }
  }

  return res.status(401).json({ error: 'Non authentifié', code: 'unauthenticated' });
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
}
