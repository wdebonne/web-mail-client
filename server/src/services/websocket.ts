import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger';
import jwt from 'jsonwebtoken';
import { sendPushToUser, PushPayload } from './push';
import { verifyAccessToken } from './deviceSessions';

interface WsClient {
  ws: WebSocket;
  userId: string;
  isAlive: boolean;
}

const clients = new Map<string, WsClient[]>();

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req) => {
    let userId: string | null = null;

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Authentication message
        if (message.type === 'auth') {
          const token = message.token;
          // Try the modern access-token path first (signed with JWT_SECRET via
          // deviceSessions.getJwtSecret), then fall back to the legacy long-lived
          // JWT signed with SESSION_SECRET so older sessions keep working.
          let resolvedUserId: string | null = null;
          const accessPayload = verifyAccessToken(token);
          if (accessPayload?.userId) {
            resolvedUserId = accessPayload.userId;
          } else {
            try {
              const decoded = jwt.verify(token, process.env.SESSION_SECRET || 'dev-secret-change-me') as { userId: string };
              resolvedUserId = decoded?.userId ?? null;
            } catch (err) {
              logger.warn({ err: (err as Error).message }, 'WebSocket auth failed (invalid/expired token)');
            }
          }

          if (!resolvedUserId) {
            try { ws.send(JSON.stringify({ type: 'auth', status: 'error', reason: 'invalid_token' })); } catch {}
            ws.close(4001, 'invalid_token');
            return;
          }

          userId = resolvedUserId;
          if (!clients.has(userId)) {
            clients.set(userId, []);
          }
          clients.get(userId)!.push({ ws, userId, isAlive: true });

          ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
          logger.info(`WebSocket authenticated: ${userId}`);
        }

        // Ping/pong
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        logger.error(error as Error, 'WebSocket message error');
      }
    });

    ws.on('close', () => {
      if (userId && clients.has(userId)) {
        const userClients = clients.get(userId)!.filter(c => c.ws !== ws);
        if (userClients.length === 0) {
          clients.delete(userId);
        } else {
          clients.set(userId, userClients);
        }
      }
    });

    ws.on('error', (error) => {
      logger.error(error, 'WebSocket error');
    });

    // Send initial connection message
    ws.send(JSON.stringify({ type: 'connected', message: 'Connecté au serveur' }));
  });

  // Heartbeat check every 30 seconds
  setInterval(() => {
    for (const [userId, userClients] of clients.entries()) {
      const alive = userClients.filter(c => {
        if (c.ws.readyState === WebSocket.OPEN) {
          c.ws.ping();
          return true;
        }
        return false;
      });
      if (alive.length === 0) {
        clients.delete(userId);
      } else {
        clients.set(userId, alive);
      }
    }
  }, 30000);
}

// Notify a specific user
export function notifyUser(userId: string, event: string, data: any) {
  const userClients = clients.get(userId);
  if (!userClients) return;

  const message = JSON.stringify({ type: event, data, timestamp: new Date().toISOString() });
  
  for (const client of userClients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

// Notify all users
export function notifyAll(event: string, data: any) {
  const message = JSON.stringify({ type: event, data, timestamp: new Date().toISOString() });
  
  for (const userClients of clients.values()) {
    for (const client of userClients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

/** Returns true if the user currently has at least one live WS connection. */
export function hasActiveWebSocket(userId: string): boolean {
  const list = clients.get(userId);
  if (!list) return false;
  return list.some(c => c.ws.readyState === WebSocket.OPEN);
}

/**
 * Send a notification to a user: real-time via WebSocket if connected,
 * and/or a native Web Push to all registered devices.
 * Use `mode = 'both'` to do both (recommended for new-mail alerts so mobile
 * devices in background get the push even while the desktop is in foreground).
 */
export async function notifyWithPush(
  userId: string,
  event: string,
  data: any,
  push: PushPayload | ((row: { platform: string | null; userAgent: string | null }) => PushPayload | Promise<PushPayload>),
  mode: 'auto' | 'both' | 'push-only' = 'auto'
) {
  const hasWs = hasActiveWebSocket(userId);
  if (mode !== 'push-only' && hasWs) {
    notifyUser(userId, event, data);
  }
  if (mode === 'both' || mode === 'push-only' || !hasWs) {
    try {
      await sendPushToUser(userId, push as any);
    } catch (err) {
      logger.warn({ err }, 'Push fallback failed');
    }
  }
}
