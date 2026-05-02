/**
 * User-customisable notification preferences.
 *
 * Stored in `localStorage` under a single JSON key (`notifications.prefs.v1`)
 * so that the existing prefs-sync pipeline (BACKUP_KEYS → /settings/preferences)
 * mirrors them across PCs / phones / tablets without any extra plumbing.
 *
 * The same shape is used:
 *   • côté utilisateur dans `Réglages → Notifications`,
 *   • côté admin dans `Administration → Notifications` (qui agit comme
 *     valeur par défaut pour tous les utilisateurs n'ayant rien choisi),
 *   • côté serveur lors de la construction de la charge utile Web Push
 *     dans `newMailPoller` (templates, actions, son, vibration, …).
 *
 * Trois variantes par plateforme (Bureau / Mobile / Tablette) permettent
 * de coller au plus près au rendu natif de chaque support :
 *   – Windows/macOS/Linux : grande bannière Action Center, son discret,
 *     boutons « Archiver / Supprimer / Répondre » à la Outlook,
 *   – Android : carte avec actions inline + vibration,
 *   – iOS / iPadOS : actions par appui long uniquement.
 */

export type NotificationPlatform = 'desktop' | 'mobile' | 'tablet';

export type NotificationActionId =
  | 'open' | 'dismiss'
  | 'archive' | 'delete' | 'reply' | 'markRead' | 'flag';

export interface NotificationActionConfig {
  id: NotificationActionId;
  /** Étiquette affichée sur le bouton — vide ⇒ étiquette par défaut localisée. */
  label?: string;
}

/** Identifiants de sons préinstallés (générés via Web Audio — aucun fichier
 *  externe, fonctionne hors ligne et n'augmente pas la taille du bundle). */
export type BuiltinSoundId =
  | 'none'        // muet
  | 'system'      // son par défaut de l'OS (notification.silent = false)
  | 'ding'        // cloche courte
  | 'chime'       // arpège deux notes (style Outlook)
  | 'pop'         // bip court
  | 'whistle'     // sifflement montant
  | 'custom';     // URL fournie par l'utilisateur

export type VibratePresetId = 'none' | 'short' | 'standard' | 'long' | 'double' | 'custom';

export interface PlatformNotificationPrefs {
  /** Active la notification sur ce support. */
  enabled: boolean;

  /** Modèle du titre. Placeholders supportés : {sender}, {senderEmail},
   *  {accountEmail}, {accountName}, {appName}, {siteUrl}, {subject}, {preview}. */
  titleTemplate: string;
  /** Modèle du corps. Mêmes placeholders + sauts de ligne autorisés. */
  bodyTemplate: string;

  /** Bornes textuelles : empêche un sujet ou un aperçu de déborder. */
  subjectMaxLength: number;
  previewMaxLength: number;

  /** Drapeaux d'affichage (surchargent le contenu des templates si décochés). */
  showSender: boolean;
  showSenderEmail: boolean;
  showAccountEmail: boolean;
  showAccountName: boolean;
  showSubject: boolean;
  showPreview: boolean;
  showAppName: boolean;
  showSiteUrl: boolean;

  /** Apparence native. */
  requireInteraction: boolean;
  silent: boolean;
  renotify: boolean;
  /** Image héro affichée sous le corps (Android, certains navigateurs). */
  imageMode: 'none' | 'sender-avatar' | 'account-color';

  /** Boutons d'action — l'OS limite généralement à 2-3 boutons visibles. */
  actions: NotificationActionConfig[];

  /** Son joué côté client lorsqu'un message arrive avec l'app au premier plan,
   *  et indication au SW (`silent` true/false) lorsque l'app est fermée. */
  sound: BuiltinSoundId;
  /** Volume 0-1 pour les sons générés et le custom. */
  soundVolume: number;
  /** URL d'un fichier audio personnalisé (lu uniquement si `sound: 'custom'`). */
  customSoundUrl: string;

  /** Motif de vibration (mobile / tablette uniquement). */
  vibrate: VibratePresetId;
  /** Motif personnalisé en millisecondes (uniquement si vibrate === 'custom'). */
  customVibratePattern: number[];

  /** Le tag détermine si une notif chasse la précédente.
   *   - 'per-message' : chaque mail = une notif distincte (empilées),
   *   - 'per-account' : la dernière remplace la précédente du même compte,
   *   - 'global'      : une seule notif visible à la fois. */
  tagStrategy: 'per-message' | 'per-account' | 'global';
}

export interface NotificationPrefs {
  /** Globalement activé / désactivé pour tous les supports. */
  enabled: boolean;
  /** Nom de l'application affiché dans `{appName}`. */
  appName: string;
  /** URL du site affichée dans `{siteUrl}`. Auto-détectée si vide. */
  siteUrl: string;
  /** Personnalisations propres à chaque support. */
  desktop: PlatformNotificationPrefs;
  mobile: PlatformNotificationPrefs;
  tablet: PlatformNotificationPrefs;
  /** Pastille (badge) sur l'icône PWA — Web App Badging API. */
  appBadge: AppBadgePrefs;
}

/** Configuration de la pastille type Outlook (compteur sur l'icône PWA). */
export type AppBadgeSource = 'inbox-unread' | 'inbox-recent' | 'inbox-total';
export type AppBadgeScope = 'all' | 'default';

export interface AppBadgePrefs {
  /** Active la mise à jour de la pastille de l'icône PWA. */
  enabled: boolean;
  /** Information remontée par la pastille. */
  source: AppBadgeSource;
  /** Comptes pris en compte : tous (assignés et possédés) ou uniquement le compte par défaut. */
  scope: AppBadgeScope;
  /** Cadence de rafraîchissement en arrière-plan (1 à 60 minutes). */
  refreshIntervalMinutes: number;
  /** Quand l'utilisateur lit/archive un mail dans l'app, on tente une mise à jour immédiate. */
  liveUpdate: boolean;
  /** Plafond d'affichage : au-delà, l'OS affichera "+" (la spec gère 99+ tout seul mais on peut limiter). */
  maxCount: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────

/** Jeu d'actions inspiré d'Outlook mobile (Archiver / Supprimer / Répondre). */
const OUTLOOK_ACTIONS: NotificationActionConfig[] = [
  { id: 'archive', label: 'Archiver' },
  { id: 'delete', label: 'Supprimer' },
  { id: 'reply', label: 'Répondre' },
];

/** Jeu d'actions sobre — utilisé sur desktop par défaut. */
const READ_DISMISS_ACTIONS: NotificationActionConfig[] = [
  { id: 'open', label: 'Lire' },
  { id: 'dismiss', label: 'Ignorer' },
];

const BASE_PLATFORM: PlatformNotificationPrefs = {
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
  actions: READ_DISMISS_ACTIONS,
  sound: 'system',
  soundVolume: 0.6,
  customSoundUrl: '',
  vibrate: 'standard',
  customVibratePattern: [120, 60, 120],
  tagStrategy: 'per-message',
};

export function getDefaultNotificationPrefs(): NotificationPrefs {
  return {
    enabled: true,
    appName: 'WebMail',
    siteUrl: typeof window !== 'undefined' ? window.location.host : '',
    desktop: { ...BASE_PLATFORM, actions: READ_DISMISS_ACTIONS.map((a) => ({ ...a })) },
    mobile: { ...BASE_PLATFORM, actions: OUTLOOK_ACTIONS.map((a) => ({ ...a })), vibrate: 'standard' },
    tablet: { ...BASE_PLATFORM, actions: OUTLOOK_ACTIONS.map((a) => ({ ...a })), vibrate: 'short' },
    appBadge: {
      enabled: true,
      source: 'inbox-unread',
      scope: 'all',
      refreshIntervalMinutes: 5,
      liveUpdate: true,
      maxCount: 999,
    },
  };
}

const STORAGE_KEY = 'notifications.prefs.v1';
export const NOTIFICATION_PREFS_STORAGE_KEY = STORAGE_KEY;
export const NOTIFICATION_PREFS_CHANGED_EVENT = 'notification-prefs-changed';

/** Fusion non destructive (un nouveau champ ajouté garde son défaut). */
export function mergeNotificationPrefs(
  base: NotificationPrefs,
  patch: Partial<NotificationPrefs> | null | undefined,
): NotificationPrefs {
  if (!patch) return base;
  const out: NotificationPrefs = { ...base };
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
  if (typeof patch.appName === 'string') out.appName = patch.appName;
  if (typeof patch.siteUrl === 'string') out.siteUrl = patch.siteUrl;
  for (const k of ['desktop', 'mobile', 'tablet'] as const) {
    out[k] = { ...base[k], ...(patch[k] || {}) } as PlatformNotificationPrefs;
    if (patch[k]?.actions) out[k].actions = patch[k]!.actions!.map((a) => ({ ...a }));
    if (patch[k]?.customVibratePattern) out[k].customVibratePattern = [...patch[k]!.customVibratePattern!];
  }
  if (patch.appBadge) {
    out.appBadge = { ...base.appBadge, ...patch.appBadge };
    // Bornes de sécurité
    out.appBadge.refreshIntervalMinutes = Math.max(1, Math.min(60, Number(out.appBadge.refreshIntervalMinutes) || 5));
    out.appBadge.maxCount = Math.max(1, Math.min(99999, Number(out.appBadge.maxCount) || 999));
  }
  return out;
}

export function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultNotificationPrefs();
    const parsed = JSON.parse(raw);
    return mergeNotificationPrefs(getDefaultNotificationPrefs(), parsed);
  } catch {
    return getDefaultNotificationPrefs();
  }
}

export function setNotificationPrefs(prefs: NotificationPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFS_CHANGED_EVENT, { detail: prefs }));
  } catch {
    /* quota — ignore */
  }
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

/** Renvoie le contexte filtré selon les drapeaux `show*`. */
export function applyVisibility(
  ctx: NotificationContext,
  p: PlatformNotificationPrefs,
): NotificationContext {
  return {
    sender: p.showSender ? ctx.sender : '',
    senderEmail: p.showSenderEmail ? ctx.senderEmail : '',
    accountEmail: p.showAccountEmail ? ctx.accountEmail : '',
    accountName: p.showAccountName ? ctx.accountName : '',
    appName: p.showAppName ? ctx.appName : '',
    siteUrl: p.showSiteUrl ? ctx.siteUrl : '',
    subject: p.showSubject ? ctx.subject.slice(0, p.subjectMaxLength) : '',
    preview: p.showPreview ? ctx.preview.slice(0, p.previewMaxLength) : '',
  };
}

const PLACEHOLDER_RE = /\{(sender|senderEmail|accountEmail|accountName|appName|siteUrl|subject|preview)\}/g;

export function renderTemplate(tpl: string, ctx: NotificationContext): string {
  return tpl
    .replace(PLACEHOLDER_RE, (_m, key) => (ctx as any)[key] ?? '')
    // nettoyage : double séparateur quand un champ est vide
    .replace(/\s*[—–-]\s*(?=$|\n|—)/g, '')
    .replace(/^[\s—–-]+|[\s—–-]+$/g, '')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Construit le titre + le corps finaux pour un support donné. */
export function buildNotificationContent(
  prefs: NotificationPrefs,
  platform: NotificationPlatform,
  rawCtx: NotificationContext,
): { title: string; body: string } {
  const p = prefs[platform];
  const ctx: NotificationContext = {
    ...rawCtx,
    appName: prefs.appName || rawCtx.appName,
    siteUrl: prefs.siteUrl || rawCtx.siteUrl,
  };
  const visible = applyVisibility(ctx, p);
  return {
    title: renderTemplate(p.titleTemplate, visible) || prefs.appName || 'Nouveau message',
    body: renderTemplate(p.bodyTemplate, visible),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Vibration patterns
// ─────────────────────────────────────────────────────────────────────────

export const VIBRATE_PATTERNS: Record<Exclude<VibratePresetId, 'custom'>, number[]> = {
  none: [],
  short: [60],
  standard: [120, 60, 120],
  long: [400, 100, 400],
  double: [80, 40, 80, 40, 80],
};

export function resolveVibratePattern(p: PlatformNotificationPrefs): number[] {
  if (p.vibrate === 'custom') return p.customVibratePattern.slice(0, 8);
  return VIBRATE_PATTERNS[p.vibrate] ?? VIBRATE_PATTERNS.standard;
}

// ─────────────────────────────────────────────────────────────────────────
// Built-in sounds (Web Audio — no asset files)
// ─────────────────────────────────────────────────────────────────────────

interface ToneStep {
  freq: number;
  duration: number; // seconds
  type?: OscillatorType;
  gain?: number;
}

const TONE_PRESETS: Record<Exclude<BuiltinSoundId, 'none' | 'system' | 'custom'>, ToneStep[]> = {
  ding:    [{ freq: 880, duration: 0.18, type: 'sine' }],
  chime:   [
    { freq: 988, duration: 0.18, type: 'sine' },
    { freq: 1318, duration: 0.22, type: 'sine' },
  ],
  pop:     [{ freq: 660, duration: 0.08, type: 'square', gain: 0.3 }],
  whistle: [
    { freq: 600, duration: 0.10, type: 'triangle' },
    { freq: 1200, duration: 0.20, type: 'triangle' },
  ],
};

let cachedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (cachedAudioCtx && cachedAudioCtx.state !== 'closed') return cachedAudioCtx;
  const Ctor: typeof AudioContext | undefined =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  cachedAudioCtx = new Ctor();
  return cachedAudioCtx;
}

/** Joue un son préinstallé ou personnalisé (foreground only). */
export async function playNotificationSound(
  sound: BuiltinSoundId,
  volume = 0.6,
  customUrl = '',
): Promise<void> {
  if (sound === 'none' || sound === 'system') return;
  if (sound === 'custom') {
    if (!customUrl) return;
    try {
      const audio = new Audio(customUrl);
      audio.volume = Math.max(0, Math.min(1, volume));
      await audio.play();
    } catch {
      /* autoplay restrictions — silencer proprement */
    }
    return;
  }
  const ctx = getAudioCtx();
  const steps = TONE_PRESETS[sound];
  if (!ctx || !steps) return;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(ctx.destination);

  let when = ctx.currentTime;
  for (const step of steps) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = step.type || 'sine';
    osc.frequency.setValueAtTime(step.freq, when);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(step.gain ?? 0.4, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + step.duration);
    osc.connect(g).connect(master);
    osc.start(when);
    osc.stop(when + step.duration + 0.02);
    when += step.duration;
  }
}

/** Liste lisible des sons (utilisée par l'UI). */
export const SOUND_OPTIONS: { id: BuiltinSoundId; label: string; description?: string }[] = [
  { id: 'none', label: 'Aucun son' },
  { id: 'system', label: 'Son par défaut du système' },
  { id: 'ding', label: 'Cloche', description: 'Note unique courte' },
  { id: 'chime', label: 'Carillon', description: 'Deux notes — style Outlook' },
  { id: 'pop', label: 'Pop', description: 'Bip discret' },
  { id: 'whistle', label: 'Sifflement', description: 'Glissando montant' },
  { id: 'custom', label: 'URL personnalisée', description: 'Fichier .mp3, .ogg ou .wav' },
];

export const ACTION_LABELS: Record<NotificationActionId, string> = {
  open: 'Lire',
  dismiss: 'Ignorer',
  archive: 'Archiver',
  delete: 'Supprimer',
  reply: 'Répondre',
  markRead: 'Marquer comme lu',
  flag: 'Marquer comme important',
};

export const ACTION_PRESETS: { id: string; label: string; actions: NotificationActionConfig[] }[] = [
  { id: 'outlook', label: 'Outlook (Archiver, Supprimer, Répondre)', actions: OUTLOOK_ACTIONS },
  { id: 'simple', label: 'Lire / Ignorer', actions: READ_DISMISS_ACTIONS },
  { id: 'read-only', label: 'Marquer comme lu / Ignorer', actions: [
    { id: 'markRead', label: 'Marquer comme lu' },
    { id: 'dismiss', label: 'Ignorer' },
  ] },
  { id: 'minimal', label: 'Aucun bouton (clic uniquement)', actions: [] },
];

/** Détecte la plateforme courante pour le rendu de l'aperçu. */
export function detectCurrentPlatform(): NotificationPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Mobi/.test(ua)) return 'mobile';
  return 'desktop';
}
