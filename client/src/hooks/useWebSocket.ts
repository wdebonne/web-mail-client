import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

type MessageHandler = (data: any) => void;

const DEBUG = true;
// IMPORTANT: use `console.log` (not `console.debug`) so the WS lifecycle
// traces are visible at the default console level. With `console.debug`,
// the browser's "Default levels" filter hides them and you cannot tell
// whether a frame ever reached the page.
const log = (...args: any[]) => { if (DEBUG) console.log('[ws]', ...args); };

/** Always read the freshest access token. The api layer rotates the JWT in
 *  localStorage on every 401 retry but the Zustand `authStore.token` is only
 *  updated at explicit login points, so it can hold a JWT signed with an
 *  outdated secret. localStorage is the source of truth for transport. */
function readToken(): string | null {
  try {
    const stored = localStorage.getItem('auth_token');
    if (stored) return stored;
  } catch {}
  return useAuthStore.getState().token;
}

export function useWebSocket(handlers: Record<string, MessageHandler> = {}) {
  const ws = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const closedByClient = useRef(false);
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);

  const connect = useCallback(() => {
    const t = readToken();
    if (!t) { log('skip connect: no token'); return; }
    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      log('skip connect: socket already open/connecting');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    log('connecting →', url);

    closedByClient.current = false;
    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      log('open, sending auth');
      try { socket.send(JSON.stringify({ type: 'auth', token: readToken() })); } catch {}
    };

    socket.onmessage = (event) => {
      // Log every raw frame so we can confirm in DevTools that the server
      // actually pushes events (mail-moved, new-mail, …). Without this it is
      // impossible to tell whether the message never reaches the browser or
      // simply has no matching handler registered.
      log('frame ←', typeof event.data === 'string' ? event.data.slice(0, 300) : event.data);
      try {
        const message = JSON.parse(event.data);
        // Internal: surface auth status so we can see clearly in DevTools.
        if (message.type === 'auth') {
          if (message.status === 'ok') {
            log('authenticated');
          } else {
            log('auth failed:', message.reason || 'unknown');
            // Server will close us; let the onclose handler trigger a reconnect
            // (the auth store may have refreshed the token by then).
          }
          return;
        }
        if (message.type === 'connected') { log('handshake', message.message); return; }
        const handler = handlersRef.current[message.type];
        if (handler) {
          log('dispatch', message.type);
          handler(message.data);
        } else {
          log('no handler for', message.type, '— registered:', Object.keys(handlersRef.current));
        }
      } catch (err) {
        log('parse error', err);
      }
    };

    socket.onclose = (ev) => {
      log('close', ev.code, ev.reason);
      if (closedByClient.current) return;
      // 4001 = invalid_token (server side). Wait a bit longer so the auth
      // refresh interceptor has time to rotate the JWT.
      const delay = ev.code === 4001 ? 8000 : 5000;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    socket.onerror = (ev) => {
      log('error', ev);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      closedByClient.current = true;
      clearTimeout(reconnectTimer.current);
      try { ws.current?.close(1000, 'unmount'); } catch {}
    };
  }, [connect]);

  // If the token rotates (silent refresh), force a reconnection so the new
  // JWT is sent on the next handshake.
  useEffect(() => {
    if (!token) return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      log('token rotated, reconnecting with fresh token');
      try { ws.current.close(1000, 'token-rotation'); } catch {}
      // onclose will schedule a reconnect; force it sooner:
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 100);
    } else if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
      // Initial token after rehydration: kick off the first connect.
      connect();
    }
  }, [token, connect]);

  const send = useCallback((type: string, data?: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  return { send };
}
