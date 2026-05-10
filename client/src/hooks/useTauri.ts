/**
 * Intégration Tauri v2 — fonctionnalités natives Desktop.
 * Toutes les fonctions sont no-op si l'app tourne dans un navigateur normal.
 */

export const isTauri: boolean =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// Accès sécurisé à l'API Tauri globale
const tauri = () => (window as any).__TAURI__;

// ── Invocation de commandes Rust ─────────────────────────────────────────────

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  try {
    return await tauri()?.core?.invoke(cmd, args);
  } catch (e) {
    console.warn(`[tauri] invoke ${cmd}:`, e);
    return null;
  }
}

// ── Écoute d'événements Tauri ────────────────────────────────────────────────

type Unlisten = () => void;

async function listen(event: string, handler: (payload: any) => void): Promise<Unlisten> {
  if (!isTauri) return () => {};
  try {
    const unlisten = await tauri()?.event?.listen(event, (e: any) => handler(e.payload));
    return unlisten ?? (() => {});
  } catch {
    return () => {};
  }
}

// ── Badge tray (compteur non-lus) ────────────────────────────────────────────

export function updateTrayBadge(count: number): void {
  invoke('update_tray_badge', { count });
}

// ── Démarrage automatique ────────────────────────────────────────────────────

export async function getAutostart(): Promise<boolean> {
  return (await invoke<boolean>('get_autostart')) ?? false;
}

export async function setAutostart(enabled: boolean): Promise<void> {
  await invoke('set_autostart', { enabled });
}

// ── Hook : écoute du raccourci "Nouveau message" depuis le tray ──────────────

import { useEffect } from 'react';

export function useTauriCompose(onCompose: () => void) {
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: Unlisten = () => {};
    listen('tauri:compose', onCompose).then(fn => { unlisten = fn; });
    return () => unlisten();
  }, [onCompose]);
}

// ── Hook : écoute des deep links mailto: / webmail:// ───────────────────────

export interface MailtoData {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

function parseMailto(url: string): MailtoData {
  const raw = url.replace(/^mailto:/i, '');
  const [toRaw, queryRaw = ''] = raw.split('?');
  const params = new URLSearchParams(queryRaw);
  return {
    to:      decodeURIComponent(toRaw || ''),
    cc:      decodeURIComponent(params.get('cc')      || ''),
    bcc:     decodeURIComponent(params.get('bcc')     || ''),
    subject: decodeURIComponent(params.get('subject') || ''),
    body:    decodeURIComponent(params.get('body')    || ''),
  };
}

export function useTauriDeepLink(onMailto: (data: MailtoData) => void) {
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: Unlisten = () => {};

    // Événement du plugin deep-link (clic sur mailto: quand l'app est ouverte)
    listen('deep-link://new-url', (urls: string[]) => {
      for (const url of urls) {
        if (/^mailto:/i.test(url)) onMailto(parseMailto(url));
      }
    }).then(fn => { unlisten = fn; });

    // Événement relayé par single-instance (2e instance reçoit le mailto:)
    let unlisten2: Unlisten = () => {};
    listen('tauri:deep-link', (url: string) => {
      if (/^mailto:/i.test(url)) onMailto(parseMailto(url));
    }).then(fn => { unlisten2 = fn; });

    return () => { unlisten(); unlisten2(); };
  }, [onMailto]);
}

// ── Hook : démarrage automatique depuis les Paramètres ──────────────────────

import { useState } from 'react';

export function useAutostart() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    getAutostart().then(setEnabled);
  }, []);

  const toggle = async (value: boolean) => {
    await setAutostart(value);
    setEnabled(value);
  };

  return { enabled: enabled ?? false, toggle, ready: enabled !== null };
}
