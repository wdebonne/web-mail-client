import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { pool } from '../database/connection';
import { getPublicVapidKey, isPushConfigured, sendPushToUser } from '../services/push';
import {
  loadUserNotificationPrefs, classifyPlatform, buildPlatformPayload,
} from '../services/notificationPrefs';
import { logger } from '../utils/logger';

export const pushRouter = Router();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional(),
  platform: z.string().max(50).optional(),
});

// Public VAPID key — needed client-side to subscribe
pushRouter.get('/public-key', (_req, res) => {
  if (!isPushConfigured()) {
    return res.status(503).json({ error: 'Push service non configuré' });
  }
  res.json({ publicKey: getPublicVapidKey() });
});

// Register / upsert a push subscription for the authenticated user
pushRouter.post('/subscribe', async (req: AuthRequest, res) => {
  try {
    const data = subscribeSchema.parse(req.body);
    const userAgent = data.userAgent || req.headers['user-agent'] || null;

    await pool.query(
      `INSERT INTO push_subscriptions
        (user_id, endpoint, p256dh, auth_key, user_agent, platform, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth_key = EXCLUDED.auth_key,
         user_agent = EXCLUDED.user_agent,
         platform = EXCLUDED.platform,
         enabled = true,
         last_used_at = NOW()`,
      [req.userId, data.endpoint, data.keys.p256dh, data.keys.auth, userAgent, data.platform || null]
    );

    res.json({ ok: true });
  } catch (error: any) {
    logger.error(error, 'Push subscribe failed');
    res.status(400).json({ error: error.message || 'Inscription impossible' });
  }
});

// Remove a subscription (by endpoint)
pushRouter.post('/unsubscribe', async (req: AuthRequest, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'endpoint requis' });

    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.userId, endpoint]
    );
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Send a test push to current user (all devices)
pushRouter.post('/test', async (req: AuthRequest, res) => {
  try {
    const sent = await sendPushToUser(req.userId!, async ({ platform, userAgent }) => {
      const prefs = await loadUserNotificationPrefs(req.userId!);
      const target = classifyPlatform(platform, userAgent);
      return buildPlatformPayload(prefs, target, {
        sender: 'Expéditeur Test',
        senderEmail: 'expediteur@example.com',
        accountEmail: 'utilisateur@example.com',
        accountName: 'Pro',
        appName: prefs.appName,
        siteUrl: prefs.siteUrl,
        subject: 'Test objet',
        preview: 'Test Corp message Envoyé à partir de Outlook pour Android',
      }, { accountId: 'test', uid: 'test', folder: 'INBOX' });
    });
    res.json({ ok: true, sent });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List current user's subscriptions (for settings display)
pushRouter.get('/subscriptions', async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      `SELECT id, endpoint, user_agent, platform, enabled, created_at, last_used_at
         FROM push_subscriptions WHERE user_id = $1 ORDER BY last_used_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
