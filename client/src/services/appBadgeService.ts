/**
 * Pastille de l'icône PWA (Web App Badging API).
 *
 * Affiche un compteur sur l'icône d'application — comme Outlook Mobile —
 * piloté par les préférences utilisateur (`notifications.prefs.v1` →
 * `appBadge`).
 *
 * Compatibilité :
 *   - Chrome / Edge desktop (PWA installée) ;
 *   - Chrome Android (PWA installée) ;
 *   - Non disponible sur Safari / iOS PWA — la fonction est alors no-op.
 *
 * Le décompte est obtenu côté serveur via `GET /api/mail/badge` (qui
 * utilise IMAP STATUS, très léger). Un cache TTL côté serveur évite les
 * connexions inutiles.
 */

import { api } from '../api';
import {
  getNotificationPrefs,
  NOTIFICATION_PREFS_CHANGED_EVENT,
  type AppBadgePrefs,
} from '../utils/notificationPrefs';

let scheduledTimer: number | null = null;
let started = false;
let inFlight = false;
let lastShown = -1;

function badgingSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
}

async function applyBadge(count: number, max: number) {
  if (!badgingSupported()) return;
  const value = Math.max(0, Math.min(count, max));
  try {
    if (value === 0) {
      await (navigator as any).clearAppBadge?.();
    } else {
      await (navigator as any).setAppBadge?.(value);
    }
    lastShown = value;
  } catch {
    /* Permission refusée ou plateforme non supportée — ignore. */
  }
}

async function refreshOnce(prefs: AppBadgePrefs) {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await api.getBadgeCount(prefs.source, prefs.scope);
    await applyBadge(res.count, prefs.maxCount);
  } catch {
    /* hors-ligne ou serveur indispo — on garde la dernière valeur. */
  } finally {
    inFlight = false;
  }
}

function clearScheduled() {
  if (scheduledTimer !== null) {
    window.clearInterval(scheduledTimer);
    scheduledTimer = null;
  }
}

async function reconfigure() {
  const prefs = getNotificationPrefs();
  const badge = prefs.appBadge;
  clearScheduled();

  if (!badge.enabled || !badgingSupported()) {
    if (badgingSupported() && lastShown !== 0) {
      try {
        await (navigator as any).clearAppBadge?.();
        lastShown = 0;
      } catch { /* noop */ }
    }
    return;
  }

  // Mise à jour immédiate.
  refreshOnce(badge).catch(() => {});

  // Cadence de fond.
  const intervalMs = Math.max(60_000, badge.refreshIntervalMinutes * 60_000);
  scheduledTimer = window.setInterval(() => {
    // On ne pousse pas le serveur quand l'onglet est en arrière-plan depuis
    // longtemps : la prochaine refocalisation déclenchera un refresh via le
    // listener `visibilitychange`.
    if (document.visibilityState === 'visible') {
      refreshOnce(badge).catch(() => {});
    }
  }, intervalMs);
}

/** Demande un rafraîchissement immédiat (à utiliser après un événement
 *  WebSocket `new-mail`, `mail-read`, `mail-archived`, etc.). */
export function requestAppBadgeRefresh() {
  const prefs = getNotificationPrefs();
  if (!prefs.appBadge.enabled || !badgingSupported()) return;
  refreshOnce(prefs.appBadge).catch(() => {});
}

/** À appeler une fois après login. Idempotent. */
export function startAppBadgeService() {
  if (started) return;
  started = true;

  reconfigure();

  // Réagir aux changements de préférences (Réglages → Notifications).
  window.addEventListener(NOTIFICATION_PREFS_CHANGED_EVENT, () => {
    reconfigure();
  });

  // Rafraîchir au retour au premier plan.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestAppBadgeRefresh();
    }
  });

  // Rafraîchir au retour de connexion réseau.
  window.addEventListener('online', () => {
    requestAppBadgeRefresh();
  });
}
