import webpush from 'web-push';
import { pool } from '../database/connection';
import { logger } from '../utils/logger';

export interface PushPayload {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: Record<string, any>;
  renotify?: boolean;
  silent?: boolean;
  requireInteraction?: boolean;
}

let vapidConfigured = false;
let vapidPublicKey = '';
let vapidPrivateKey = '';

/**
 * Initialize VAPID keys. Reads from env vars; if missing, generates a new pair
 * and stores it in admin_settings so the same keys persist across restarts.
 */
export async function initPushService() {
  try {
    vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
    vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';

    if (!vapidPublicKey || !vapidPrivateKey) {
      const stored = await pool.query(
        "SELECT key, value FROM admin_settings WHERE key IN ('vapid_public_key','vapid_private_key')"
      );
      const map = new Map<string, string>();
      for (const row of stored.rows) {
        try { map.set(row.key, JSON.parse(row.value)); } catch { map.set(row.key, String(row.value)); }
      }
      vapidPublicKey = vapidPublicKey || map.get('vapid_public_key') || '';
      vapidPrivateKey = vapidPrivateKey || map.get('vapid_private_key') || '';

      if (!vapidPublicKey || !vapidPrivateKey) {
        const keys = webpush.generateVAPIDKeys();
        vapidPublicKey = keys.publicKey;
        vapidPrivateKey = keys.privateKey;
        await pool.query(
          `INSERT INTO admin_settings (key, value, description) VALUES
             ('vapid_public_key', $1::jsonb, 'Web Push VAPID public key'),
             ('vapid_private_key', $2::jsonb, 'Web Push VAPID private key')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [JSON.stringify(vapidPublicKey), JSON.stringify(vapidPrivateKey)]
        );
        logger.info('Generated new VAPID key pair for Web Push');
      }
    }

    const contact = process.env.VAPID_CONTACT || 'mailto:admin@example.com';
    webpush.setVapidDetails(contact, vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
    logger.info('Push service initialized');
  } catch (error) {
    logger.error(error as Error, 'Failed to initialize push service');
  }
}

export function getPublicVapidKey(): string {
  return vapidPublicKey;
}

export function isPushConfigured(): boolean {
  return vapidConfigured;
}

/**
 * Send a push notification to a specific user (all their registered devices).
 * Automatically prunes invalid/expired subscriptions.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!vapidConfigured) return 0;

  const result = await pool.query(
    `SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions
      WHERE user_id = $1 AND enabled = true`,
    [userId]
  );

  if (result.rowCount === 0) return 0;

  const json = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(result.rows.map(async (row) => {
    const sub = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth_key },
    };
    try {
      await webpush.sendNotification(sub, json, { TTL: 60 * 60 * 24 });
      sent++;
      await pool.query(
        'UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1',
        [row.id]
      );
    } catch (err: any) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        // Gone — remove stale subscription
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
      } else {
        logger.warn({ err, status }, 'Failed to send push notification');
      }
    }
  }));

  return sent;
}
