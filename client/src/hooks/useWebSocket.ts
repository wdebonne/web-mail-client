import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

type MessageHandler = (data: any) => void;

const DEBUG = true;
const log = (...args: any[]) => { if (DEBUG) console.debug('[ws]', ...args); };

export function useWebSocket(handlers: Record<string, MessageHandler> = {}) {
  const ws = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const closedByClient = useRef(false);
  // Keep the latest handlers in a ref so swapping callbacks across renders
  // doesn't tear down and re-establish the WebSocket connection.
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);
  // Same trick for the token: we read the freshest one inside `connect`
  // without re-creating the callback every time the token rotates (which
  // would tear down a perfectly valid socket).
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const connect = useCallback(() => {
    const t = tokenRef.current;
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
      try { socket.send(JSON.stringify({ type: 'auth', token: tokenRef.current })); } catch {}
    };

    socket.onmessage = (event) => {
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
          handler(message.data);
        }
      } catch {}
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
