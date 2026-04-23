/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Precache build assets injected by Vite PWA
precacheAndRoute(self.__WB_MANIFEST || []);

// Runtime caches for API endpoints
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/mail/'),
  new NetworkFirst({ cacheName: 'mail-cache', networkTimeoutSeconds: 10 }),
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/contacts/'),
  new StaleWhileRevalidate({ cacheName: 'contacts-cache' }),
);
registerRoute(
  // Calendar events change often and must reflect mutations immediately.
  // Exclude them from any cache; let other calendar endpoints use NetworkFirst.
  ({ url }) => url.pathname.startsWith('/api/calendar/events'),
  new NetworkFirst({
    cacheName: 'calendar-events-nocache',
    networkTimeoutSeconds: 10,
    plugins: [{
      cacheWillUpdate: async () => null, // never store
    }],
  }),
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/calendar/'),
  new NetworkFirst({ cacheName: 'calendar-cache', networkTimeoutSeconds: 10 }),
);

// SPA fallback
try {
  registerRoute(new NavigationRoute(async () => {
    const cache = await caches.open('workbox-precache-v2');
    const match = await cache.match('/index.html');
    return match || fetch('/index.html');
  }, { allowlist: [/^\/(?!api\/).*/] }));
} catch {
  /* ignore */
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// --- Web Push handling --------------------------------------------------

interface PushPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
  renotify?: boolean;
  silent?: boolean;
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string; icon?: string }>;
  vibrate?: number[];
  timestamp?: number;
}

self.addEventListener('push', (event: PushEvent) => {
  let payload: PushPayload = {};
  if (event.data) {
    try { payload = event.data.json(); }
    catch { payload = { title: 'Nouveau message', body: event.data.text() }; }
  }

  const title = payload.title || 'WebMail';
  // Windows 11 / Chromium : sans `requireInteraction`, la notification disparaît après ~5s
  // et reste minuscule. Avec `actions`, Windows affiche une bannière plus grande avec boutons.
  const defaultActions = [
    { action: 'open', title: 'Ouvrir' },
    { action: 'dismiss', title: 'Ignorer' },
  ];

  const options: NotificationOptions & {
    image?: string;
    actions?: Array<{ action: string; title: string; icon?: string }>;
    vibrate?: number[];
    timestamp?: number;
    renotify?: boolean;
  } = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    image: payload.image,
    tag: payload.tag,
    // `renotify` force le son/bannière même si une notif avec le même tag existe déjà.
    renotify: payload.renotify ?? Boolean(payload.tag),
    silent: payload.silent ?? false,
    // Par défaut on garde la notification visible jusqu'à ce que l'utilisateur interagisse,
    // sauf si l'émetteur précise explicitement `requireInteraction: false` (ex: test).
    requireInteraction: payload.requireInteraction ?? true,
    actions: payload.actions ?? defaultActions,
    // Utile pour mobile ; ignoré sur desktop.
    vibrate: payload.vibrate ?? [120, 60, 120],
    timestamp: payload.timestamp ?? Date.now(),
    data: { url: payload.url || '/', ...(payload.data || {}) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  // L'action "dismiss" ferme simplement la notification sans focaliser la fenêtre.
  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && (event.notification.data as any).url) || '/';

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin) {
        await (client as WindowClient).focus();
        (client as WindowClient).postMessage({
          type: 'notification-click',
          url: targetUrl,
          action: event.action || 'open',
          data: event.notification.data,
        });
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('pushsubscriptionchange', (event: any) => {
  // Ask active pages to re-subscribe with the new subscription
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      client.postMessage({ type: 'pushsubscriptionchange' });
    }
  })());
});
