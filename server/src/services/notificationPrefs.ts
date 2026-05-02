/**
 * Construction côté serveur des charges utiles Web Push, à partir des
 * préférences utilisateur (table `user_preferences`, clé
 * `notifications.prefs.v1`) et des défauts administrateurs (table
 * `admin_settings`, clé `notification_defaults`).
 *
 * Les types reproduisent — sans dépendance circulaire — la forme déclarée
 * côté client dans `client/src/utils/notificationPrefs.ts`. Toute évolution
 * du schéma doit rester rétro-compatible (ajouts uniquement) car le
 * serveur peut recevoir d'anciens objets sérialisés depuis le navigateur.
 */

import { pool } from '../database/connection';
import type { PushPayload } from './push';

export type NotificationPlatform = 'desktop' | 'mobile' | 'tablet';
type ActionId = 'open' | 'dismiss' | 'archive' | 'delete' | 'reply' | 'markRead' | 'flag';
type SoundId = 'none' | 'system' | 'ding' | 'chime' | 'pop' | 'whistle' | 'custom';
type VibrateId = 'none' | 'short' | 'standard' | 'long' | 'double' | 'custom';

interface ActionConfig { id: ActionId; label?: string }

interface PlatformPrefs {
  enabled: boolean;
  titleTemplate: string;
  bodyTemplate: string;
  subjectMaxLength: number;
  previewMaxLength: number;
  showSender: boolean;
  showSenderEmail: boolean;
  showAccountEmail: boolean;
  showAccountName: boolean;
  showSubject: boolean;
  showPreview: boolean;
  showAppName: boolean;
  showSiteUrl: boolean;
  requireInteraction: boolean;
  silent: boolean;
  renotify: boolean;
  imageMode: 'none' | 'sender-avatar' | 'account-color';
  actions: ActionConfig[];
  sound: SoundId;
  soundVolume: number;
  customSoundUrl: string;
  vibrate: VibrateId;
  customVibratePattern: number[];
  tagStrategy: 'per-message' | 'per-account' | 'global';
}

export interface NotificationPrefs {
  enabled: boolean;
  appName: string;
  siteUrl: string;
  desktop: PlatformPrefs;
  mobile: PlatformPrefs;
  tablet: PlatformPrefs;
}

const ACTION_LABELS: Record<ActionId, string> = {
  open: 'Lire',
  dismiss: 'Ignorer',
  archive: 'Archiver',
  delete: 'Supprimer',
  reply: 'Répondre',
  markRead: 'Marquer comme lu',
  flag: 'Marquer comme important',
};

const VIBRATE_PATTERNS: Record<Exclude<VibrateId, 'custom'>, number[]> = {
  none: [],
  short: [60],
  standard: [120, 60, 120],
  long: [400, 100, 400],
  double: [80, 40, 80, 40, 80],
};

const BASE_PLATFORM: PlatformPrefs = {
  enabled: true,
  titleTemplate: '{sender} — {accountEmail}',
  bodyTemplate: '{subject}\n{preview}',
  subjectMaxLength: 140,
  previewMaxLength: 160,
  showSender: true,
  showSenderEmail: false,
  showAccountEmail: true,
  showAccountName: false,
  showSubject: true,
  showPreview: true,
  showAppName: false,
  showSiteUrl: false,
  requireInteraction: true,
  silent: false,
  renotify: true,
  imageMode: 'none',
  actions: [
    { id: 'open', label: 'Lire' },
    { id: 'dismiss', label: 'Ignorer' },
  ],
  sound: 'system',
  soundVolume: 0.6,
  customSoundUrl: '',
  vibrate: 'standard',
  customVibratePattern: [120, 60, 120],
  tagStrategy: 'per-message',
};

function defaultPrefs(): NotificationPrefs {
  const outlookActions: ActionConfig[] = [
    { id: 'archive', label: 'Archiver' },
    { id: 'delete', label: 'Supprimer' },
    { id: 'reply', label: 'Répondre' },
  ];
  return {
    enabled: true,
    appName: 'WebMail',
    siteUrl: '',
    desktop: { ...BASE_PLATFORM },
    mobile: { ...BASE_PLATFORM, actions: outlookActions },
    tablet: { ...BASE_PLATFORM, actions: outlookActions, vibrate: 'short' },
  };
}

function mergePrefs(base: NotificationPrefs, patch: any): NotificationPrefs {
  if (!patch || typeof patch !== 'object') return base;
  const out: NotificationPrefs = {
    ...base,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    appName: typeof patch.appName === 'string' ? patch.appName : base.appName,
    siteUrl: typeof patch.siteUrl === 'string' ? patch.siteUrl : base.siteUrl,
    desktop: { ...base.desktop, ...(patch.desktop || {}) },
    mobile: { ...base.mobile, ...(patch.mobile || {}) },
    tablet: { ...base.tablet, ...(patch.tablet || {}) },
  };
  for (const k of ['desktop', 'mobile', 'tablet'] as const) {
    if (patch[k]?.actions && Array.isArray(patch[k].actions)) {
      out[k].actions = patch[k].actions.filter(
        (a: any) => a && typeof a.id === 'string',
      ).map((a: any) => ({ id: a.id, label: a.label || '' }));
    }
    if (patch[k]?.customVibratePattern && Array.isArray(patch[k].customVibratePattern)) {
      out[k].customVibratePattern = patch[k].customVibratePattern
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 5000)
        .slice(0, 8);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Cache : on relit en base au plus une fois toutes les 60 s par utilisateur
// (les notifications sont émises en batch lors d'une arrivée de mail).
// ─────────────────────────────────────────────────────────────────────────
const userCache = new Map<string, { value: NotificationPrefs; at: number }>();
let adminDefaultsCache: { value: NotificationPrefs; at: number } | null = null;
const TTL_MS = 60_000;

function parseJSONValue(raw: any): any {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

async function loadAdminDefaults(): Promise<NotificationPrefs> {
  if (adminDefaultsCache && Date.now() - adminDefaultsCache.at < TTL_MS) {
    return adminDefaultsCache.value;
  }
  const r = await pool.query(
    "SELECT value FROM admin_settings WHERE key = 'notification_defaults' LIMIT 1",
  );
  const raw = r.rowCount! > 0 ? parseJSONValue(r.rows[0].value) : null;
  const value = mergePrefs(defaultPrefs(), raw);
  adminDefaultsCache = { value, at: Date.now() };
  return value;
}

export function invalidateNotificationPrefsCache(userId?: string) {
  if (userId) userCache.delete(userId);
  else { userCache.clear(); adminDefaultsCache = null; }
}

export async function loadUserNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const adminBase = await loadAdminDefaults();
  const r = await pool.query(
    "SELECT value FROM user_preferences WHERE user_id = $1 AND key = 'notifications.prefs.v1' LIMIT 1",
    [userId],
  );
  let userRaw: any = null;
  if (r.rowCount! > 0) {
    // The value column stores the user's localStorage string, which itself
    // is a JSON string. Double-decode defensively.
    let v: any = r.rows[0].value;
    if (typeof v === 'string') v = parseJSONValue(v);
    if (typeof v === 'string') v = parseJSONValue(v);
    userRaw = v;
  }
  const merged = userRaw ? mergePrefs(adminBase, userRaw) : adminBase;
  userCache.set(userId, { value: merged, at: Date.now() });
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────
// Template rendering
// ─────────────────────────────────────────────────────────────────────────

export interface NotificationContext {
  sender: string;
  senderEmail: string;
  accountEmail: string;
  accountName: string;
  appName: string;
  siteUrl: string;
  subject: string;
  preview: string;
}

function applyVisibility(ctx: NotificationContext, p: PlatformPrefs): NotificationContext {
  return {
    sender: p.showSender ? ctx.sender : '',
    senderEmail: p.showSenderEmail ? ctx.senderEmail : '',
    accountEmail: p.showAccountEmail ? ctx.accountEmail : '',
    accountName: p.showAccountName ? ctx.accountName : '',
    appName: p.showAppName ? ctx.appName : '',
    siteUrl: p.showSiteUrl ? ctx.siteUrl : '',
    subject: p.showSubject ? (ctx.subject || '').slice(0, p.subjectMaxLength) : '',
    preview: p.showPreview ? (ctx.preview || '').slice(0, p.previewMaxLength) : '',
  };
}

const PLACEHOLDER_RE =
  /\{(sender|senderEmail|accountEmail|accountName|appName|siteUrl|subject|preview)\}/g;

function renderTemplate(tpl: string, ctx: NotificationContext): string {
  return (tpl || '')
    .replace(PLACEHOLDER_RE, (_m, key) => (ctx as any)[key] ?? '')
    .replace(/\s*[—–-]\s*(?=$|\n|—)/g, '')
    .replace(/^[\s—–-]+|[\s—–-]+$/g, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function resolveVibrate(p: PlatformPrefs): number[] {
  if (p.vibrate === 'custom') return p.customVibratePattern.slice(0, 8);
  return VIBRATE_PATTERNS[p.vibrate as Exclude<VibrateId, 'custom'>] ?? VIBRATE_PATTERNS.standard;
}

function buildTag(prefs: PlatformPrefs, accountId: string, uid: number | string): string {
  switch (prefs.tagStrategy) {
    case 'per-account': return `mail-${accountId}`;
    case 'global':      return 'mail';
    default:            return `mail-${accountId}-${uid}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Platform classification from `push_subscriptions.platform` column
// ─────────────────────────────────────────────────────────────────────────
export function classifyPlatform(rawPlatform: string | null | undefined, ua?: string | null): NotificationPlatform {
  const p = (rawPlatform || '').toLowerCase();
  const u = (ua || '').toLowerCase();
  if (/ipad|tablet/.test(u) || /ipad|tablet/.test(p)) return 'tablet';
  if (/iphone|ipod|android.*mobile|mobi/.test(u) || p === 'android' || p === 'ios') return 'mobile';
  if (p === 'mac' || p === 'windows' || p === 'linux') return 'desktop';
  return 'desktop';
}

/**
 * Construit la charge utile Web Push pour une plateforme donnée.
 * Le résultat est consommé par `sw.ts` côté client.
 */
export function buildPlatformPayload(
  prefs: NotificationPrefs,
  platform: NotificationPlatform,
  ctx: NotificationContext,
  meta: { accountId: string; uid: number | string; folder?: string },
): PushPayload {
  const p = prefs[platform];
  const filledCtx: NotificationContext = {
    ...ctx,
    appName: prefs.appName || ctx.appName,
    siteUrl: prefs.siteUrl || ctx.siteUrl,
  };
  const visible = applyVisibility(filledCtx, p);
  const title = renderTemplate(p.titleTemplate, visible) || prefs.appName || 'Nouveau message';
  const body = renderTemplate(p.bodyTemplate, visible);

  const actions = (p.actions || [])
    .slice(0, platform === 'desktop' ? 2 : 3)
    .map((a) => ({
      action: a.id,
      title: a.label || ACTION_LABELS[a.id] || a.id,
    }));

  return {
    title,
    body,
    tag: buildTag(p, meta.accountId, meta.uid),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: `/mail/${meta.accountId}/${meta.folder || 'INBOX'}`,
    data: {
      accountId: meta.accountId,
      uid: meta.uid,
      folder: meta.folder || 'INBOX',
      sound: p.sound,
      soundVolume: p.soundVolume,
      customSoundUrl: p.sound === 'custom' ? p.customSoundUrl : undefined,
    },
    requireInteraction: p.requireInteraction,
    silent: p.silent || p.sound === 'none',
    renotify: p.renotify,
    actions,
    vibrate: platform === 'desktop' ? undefined : resolveVibrate(p),
    timestamp: Date.now(),
  } as PushPayload;
}
