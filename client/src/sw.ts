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
  // Do not call skipWaiting() — let vite-plugin-pwa's prompt flow control
  // when the new SW takes over, so the page never reloads unexpectedly.
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

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Si un client est ouvert au premier plan, on lui demande de jouer le son
    // configuré par l'utilisateur (Web Audio) — les sons custom ne sont pas
    // jouables depuis le Service Worker.
    const data: any = options.data || {};
    if (!options.silent && (data.sound || data.customSoundUrl)) {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        if ((client as WindowClient).focused) {
          (client as WindowClient).postMessage({
            type: 'play-notification-sound',
            sound: data.sound,
            customSoundUrl: data.customSoundUrl,
            volume: data.soundVolume,
          });
          break;
        }
      }
    }
  })());
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const action = event.action || 'open';

  // L'action "dismiss" ferme simplement la notification sans focaliser la fenêtre.
  if (action === 'dismiss') return;

  const data = (event.notification.data || {}) as Record<string, any>;
  const baseUrl = data.url || '/';

  // Pour les actions de type Outlook (archiver / supprimer / répondre /
  // marquer comme lu / flag), on ouvre l'app en lui transmettant l'action
  // via une querystring. La page MailPage détecte ces paramètres et
  // exécute l'opération via l'API authentifiée — exactement comme si
  // l'utilisateur avait cliqué dans la liste.
  let targetUrl = baseUrl;
  if (action !== 'open') {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const qs = new URLSearchParams({
      notifAction: action,
      notifUid: String(data.uid ?? ''),
      notifAccountId: String(data.accountId ?? ''),
      notifFolder: String(data.folder ?? 'INBOX'),
    }).toString();
    targetUrl = `${baseUrl}${sep}${qs}`;
  }

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin) {
        await (client as WindowClient).focus();
        (client as WindowClient).postMessage({
          type: 'notification-click',
          url: targetUrl,
          action,
          data,
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
