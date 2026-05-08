import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

type MessageHandler = (data: any) => void;

export function useWebSocket(handlers: Record<string, MessageHandler> = {}) {
  const ws = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  // Keep the latest handlers in a ref so swapping callbacks across renders
  // doesn't tear down and re-establish the WebSocket connection.
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; }, [handlers]);

  const connect = useCallback(() => {
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      ws.current?.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const handler = handlersRef.current[message.type];
        if (handler) {
          handler(message.data);
        }
      } catch {}
    };

    ws.current.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    ws.current.onerror = () => {
      ws.current?.close();
    };
  }, [token]);

  useEffect(() => {
    connect();

    return () => {
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  const send = useCallback((type: string, data?: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  return { send };
}
