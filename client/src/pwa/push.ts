/**
 * Web Push subscription helpers.
 * Requires the service worker to be registered (see ./register.ts).
 */

const LS_ENABLED = 'push.enabled';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.ready;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error('Push non supporté par ce navigateur');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permission de notification refusée');
  }

  const reg = await getRegistration();
  if (!reg) throw new Error('Service Worker non disponible');

  const keyRes = await fetch('/api/push/public-key', { headers: authHeaders(), credentials: 'include' });
  if (!keyRes.ok) throw new Error('Clé VAPID indisponible');
  const { publicKey } = await keyRes.json();

  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Verify the subscription's server key matches the current VAPID key;
    // if not, resubscribe.
    const existingKey = sub.options.applicationServerKey
      ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey as ArrayBuffer)))
      : '';
    const expectedKey = btoa(String.fromCharCode(...urlBase64ToUint8Array(publicKey)));
    if (existingKey !== expectedKey) {
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      sub = null;
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON() as PushSubscriptionJSON;
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
      platform: detectPlatform(),
    }),
  });
  if (!res.ok) throw new Error('Inscription serveur impossible');

  localStorage.setItem(LS_ENABLED, 'true');
  return sub;
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingSubscription();
  if (sub) {
    try {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch { /* ignore */ }
    try { await sub.unsubscribe(); } catch { /* ignore */ }
  }
  localStorage.setItem(LS_ENABLED, 'false');
}

export async function sendTestPush(): Promise<number> {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Envoi du test impossible');
  const data = await res.json();
  return data.sent || 0;
}

export function isPushLocallyEnabled(): boolean {
  return localStorage.getItem(LS_ENABLED) === 'true';
}

/**
 * Listen for service worker messages (e.g. notification clicks) and navigate.
 */
export function listenForNotificationClicks(onNavigate: (url: string) => void) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.type === 'notification-click' && typeof data.url === 'string') {
      onNavigate(data.url);
    } else if (data?.type === 'pushsubscriptionchange') {
      // Attempt transparent re-subscription
      subscribeToPush().catch(() => { /* ignore */ });
    }
  });
}
