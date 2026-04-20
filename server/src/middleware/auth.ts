import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../database/connection';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    isAdmin: boolean;
  }
}

export interface AuthRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

const JWT_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

export function generateToken(userId: string, isAdmin: boolean): string {
  return jwt.sign({ userId, isAdmin }, JWT_SECRET, { expiresIn: '30d' });
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  // Check session first
  if (req.session?.userId) {
    req.userId = req.session.userId;
    req.isAdmin = req.session.isAdmin || false;
    return next();
  }

  // Check JWT token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; isAdmin: boolean };
      req.userId = decoded.userId;
      req.isAdmin = decoded.isAdmin;
      return next();
    } catch {
      return res.status(401).json({ error: 'Token invalide' });
    }
  }

  return res.status(401).json({ error: 'Non authentifié' });
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'Accès administrateur requis' });
  }
  next();
}
