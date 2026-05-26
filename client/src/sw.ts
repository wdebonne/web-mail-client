/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

import { precacheAndRoute, matchPrecache } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Badge persistence via IndexedDB ─────────────────────────────────────────
// Les variables JS du SW sont effacées à chaque fois qu'Android tue le processus
// (toutes les ~30 s d'inactivité). IndexedDB persiste, lui.

const BADGE_DB = 'webmail-badge';
const BADGE_STORE = 'kv';

function openBadgeDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = self.indexedDB.open(BADGE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(BADGE_STORE)) {
        req.result.createObjectStore(BADGE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readBadgeCount(): Promise<number> {
  try {
    const db = await openBadgeDB();
    return new Promise((resolve) => {
      const tx = db.transaction(BADGE_STORE, 'readonly');
      const req = tx.objectStore(BADGE_STORE).get('count');
      req.onsuccess = () => { db.close(); resolve(typeof req.result === 'number' ? req.result : 0); };
      req.onerror = () => { db.close(); resolve(0); };
    });
  } catch { return 0; }
}

async function writeBadgeCount(count: number): Promise<void> {
  try {
    const db = await openBadgeDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(BADGE_STORE, 'readwrite');
      tx.objectStore(BADGE_STORE).put(count, 'count');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* noop */ }
}

async function applyBadgeFromDB(): Promise<void> {
  const count = await readBadgeCount();
  if (count > 0) {
    try { await (self.navigator as any).setAppBadge?.(count); } catch { /* noop */ }
  }
}

// ── Notification persistante silencieuse ────────────────────────────────────
// Sur Android Chrome, le badge est couplé au système de notifications Android.
// Zéro notification active = Android efface le badge (limitation navigateur).
// Solution identique à Gmail / Outlook Android : maintenir une notification
// silencieuse et invisible qui porte le compteur, remplacée à chaque changement.

const SUMMARY_TAG = 'unread-badge-summary';

async function updateSummaryNotification(count: number): Promise<void> {
  // Fermer toute notification-résumé existante (via `tag` elle sera remplacée
  // automatiquement si count > 0, mais on close explicitement si count = 0).
  if (count <= 0) {
    const existing = await self.registration.getNotifications({ tag: SUMMARY_TAG });
    for (const n of existing) n.close();
    return;
  }
  const label = count === 1 ? '1 mail non lu' : `${count} mails non lus`;
  await self.registration.showNotification(label, {
    body: 'WebMail — Appuyer pour ouvrir la boîte de réception',
    tag: SUMMARY_TAG,
    silent: true,
    requireInteraction: false,
    badge: '/icon-192.png',
    icon: '/icon-192.png',
    data: { isSummary: true, url: '/', count },
  } as any);
}

// Precache build assets injected by Vite PWA
precacheAndRoute(self.__WB_MANIFEST || []);

// Email images via the proxy — CacheFirst so images already seen are served
// instantly from Cache Storage without any network request.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/proxy/image'),
  new CacheFirst({
    cacheName: 'email-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 1000,
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 jours
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

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

// SPA fallback — matchPrecache resolves the real Workbox cache name and
// handles the revision hash appended to /index.html in the precache manifest.
registerRoute(
  new NavigationRoute(
    async () => (await matchPrecache('/index.html')) ?? fetch('/index.html'),
    { allowlist: [/^\/(?!api\/).*/] },
  ),
);

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
  /** Nombre total de mails non lus dans la boîte de réception (envoyé par le serveur). */
  unreadCount?: number;
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

    // Si le payload contient le nombre total de non-lus, on l'applique
    // immédiatement et on le persiste dans IndexedDB pour le notificationclose.
    if (typeof payload.unreadCount === 'number' && payload.unreadCount > 0) {
      await writeBadgeCount(payload.unreadCount);
      try { await (self.navigator as any).setAppBadge?.(payload.unreadCount); } catch { /* noop */ }
      await updateSummaryNotification(payload.unreadCount);
    }

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

self.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === 'badge-count-update') {
    const count: number = event.data.count ?? 0;
    // Persisté dans IndexedDB — survit aux redémarrages du SW.
    writeBadgeCount(count).catch(() => {});
    // Mettre à jour la notification silencieuse qui maintient le badge sur Android.
    updateSummaryNotification(count).catch(() => {});
  }
});

// Quand une notification est supprimée, Android efface le badge si c'était la
// dernière notification active. On ré-applique le badge ET on recrée la
// notification-résumé silencieuse pour le maintenir (comportement Gmail/Outlook).
self.addEventListener('notificationclose', (event: NotificationEvent) => {
  const data = (event.notification.data || {}) as Record<string, any>;
  event.waitUntil((async () => {
    // Ré-appliquer le badge depuis IDB dans tous les cas.
    await applyBadgeFromDB();

    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientsList.length > 0) {
      // L'app est ouverte : lui demander de rafraîchir le badge depuis le serveur.
      for (const client of clientsList) {
        (client as WindowClient).postMessage({ type: 'notification-dismissed-refresh' });
      }
    }

    // Recréer la notification-résumé pour maintenir le badge.
    // Si c'était la notification-résumé elle-même qui a été supprimée, on la
    // recrée immédiatement (comme Gmail quand on supprime son "X unread" badge).
    const count = await readBadgeCount();
    await updateSummaryNotification(count);
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
