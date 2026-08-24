// Boîte de réception « Prioritaire / Autres » — façon Outlook.
//
// C'est un **partitionnement d'affichage** : aucun message n'est déplacé sur le
// serveur IMAP, contrairement au filtre du courrier indésirable. Repasser en vue
// combinée restitue instantanément la liste complète.
//
// Ordre de décision de `classifyMessage`, du plus fort au plus faible :
//   1. Exception sur l'adresse exacte ...... gagne toujours
//   2. Exception sur le domaine
//   3. Contact enregistré ................... focused   (si trustContacts)
//   4. Même domaine qu'un de mes comptes .... focused   (si trustOwnDomain,
//                                                        domaine non grand public)
//   5. Sinon ................................ other
//
// Deux clés localStorage, volontairement séparées :
//   • mail.focusedInbox.v1           — réglage d'affichage, **propre à l'appareil**
//                                      (absent de BACKUP_KEYS, donc non synchronisé)
//   • mail.focusedInbox.overrides.v1 — les exceptions, qui sont une donnée
//                                      utilisateur et suivent le compte
//                                      (présent dans BACKUP_KEYS)

import type { Email } from '../types';

export type FocusedTab = 'focused' | 'other';
export type FocusedMode = 'combined' | 'split';

export interface FocusedInboxPrefs {
  /** 'combined' = liste unique (défaut, comportement historique). */
  mode: FocusedMode;
  /** Onglet restauré au chargement. */
  activeTab: FocusedTab;
  /** Les contacts enregistrés vont en Prioritaire. */
  trustContacts: boolean;
  /** Les expéditeurs du même domaine que mes comptes vont en Prioritaire. */
  trustOwnDomain: boolean;
  /** Pages chargées automatiquement en vue séparée (0 = jamais). */
  autoLoadPages: number;
}

const KEY_PREFS = 'mail.focusedInbox.v1';
const KEY_OVERRIDES = 'mail.focusedInbox.overrides.v1';
const EVENT_NAME = 'mail-focused-inbox-changed';

export const FOCUSED_INBOX_CHANGED_EVENT = EVENT_NAME;

export const DEFAULT_FOCUSED_PREFS: FocusedInboxPrefs = {
  mode: 'combined',
  activeTab: 'focused',
  trustContacts: true,
  trustOwnDomain: true,
  autoLoadPages: 5,
};

export const FOCUSED_TAB_LABELS: Record<FocusedTab, string> = {
  focused: 'Prioritaire',
  other: 'Autres',
};

// Fournisseurs grand public : le critère « même domaine que mes comptes » ne
// doit jamais s'y appliquer, sinon un utilisateur sur Gmail verrait *tous* les
// expéditeurs Gmail passer en Prioritaire, ce qui viderait la règle de son sens.
const PUBLIC_DOMAINS = new Set<string>([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com',
  'free.fr', 'orange.fr', 'wanadoo.fr', 'sfr.fr', 'neuf.fr', 'laposte.net', 'bbox.fr',
  'gmx.com', 'gmx.fr', 'gmx.net', 'web.de',
  'proton.me', 'protonmail.com', 'pm.me',
  'zoho.com', 'yandex.com', 'mail.com', 'mail.ru',
]);

export function isPublicDomain(domain: string): boolean {
  return PUBLIC_DOMAINS.has(domain.toLowerCase());
}

/** « Nom <a@b.com> » → « a@b.com ». Renvoie '' si l'entrée n'est pas exploitable. */
export function normalizeAddress(raw?: string | null): string {
  if (!raw) return '';
  let v = String(raw).trim();
  const angle = v.match(/<([^>]+)>/);
  if (angle) v = angle[1];
  v = v.replace(/^<|>$/g, '').trim().toLowerCase();
  return v.includes('@') ? v : '';
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

/** Vrai pour la boîte de réception elle-même — pas ses sous-dossiers
 *  (« INBOX.Clients » reste une liste normale, comme dans Outlook). */
export function isInboxFolder(folder?: string | null): boolean {
  return (folder || '').trim().toUpperCase() === 'INBOX';
}

// ─── Préférences (par appareil) ─────────────────────────────────────────────

export function getFocusedInboxPrefs(): FocusedInboxPrefs {
  try {
    const raw = localStorage.getItem(KEY_PREFS);
    if (!raw) return { ...DEFAULT_FOCUSED_PREFS };
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode === 'split' ? 'split' : DEFAULT_FOCUSED_PREFS.mode,
      activeTab: parsed.activeTab === 'other' ? 'other' : DEFAULT_FOCUSED_PREFS.activeTab,
      trustContacts: typeof parsed.trustContacts === 'boolean' ? parsed.trustContacts : DEFAULT_FOCUSED_PREFS.trustContacts,
      trustOwnDomain: typeof parsed.trustOwnDomain === 'boolean' ? parsed.trustOwnDomain : DEFAULT_FOCUSED_PREFS.trustOwnDomain,
      autoLoadPages: Number.isFinite(parsed.autoLoadPages)
        ? Math.max(0, Math.min(20, Math.floor(parsed.autoLoadPages)))
        : DEFAULT_FOCUSED_PREFS.autoLoadPages,
    };
  } catch {
    return { ...DEFAULT_FOCUSED_PREFS };
  }
}

export function setFocusedInboxPrefs(prefs: Partial<FocusedInboxPrefs>) {
  const next = { ...getFocusedInboxPrefs(), ...prefs };
  try {
    localStorage.setItem(KEY_PREFS, JSON.stringify(next));
  } catch { /* quota — le réglage reste actif pour la session */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
  } catch { /* noop */ }
}

// ─── Exceptions par expéditeur (suivent le compte) ──────────────────────────

export type OverrideKind = 'address' | 'domain';

/** Clés de la forme `addr:a@b.com` ou `dom:b.com`. */
export type FocusedOverrides = Record<string, FocusedTab>;

export function overrideKey(kind: OverrideKind, pattern: string): string {
  return `${kind === 'domain' ? 'dom' : 'addr'}:${pattern.trim().toLowerCase()}`;
}

export function getFocusedOverrides(): FocusedOverrides {
  try {
    const raw = localStorage.getItem(KEY_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: FocusedOverrides = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'focused' || v === 'other') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeOverrides(map: FocusedOverrides) {
  try {
    localStorage.setItem(KEY_OVERRIDES, JSON.stringify(map));
  } catch { /* noop */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { overrides: map } }));
  } catch { /* noop */ }
}

/** Force un expéditeur (ou tout un domaine) dans l'onglet donné. */
export function setFocusedOverride(pattern: string, tab: FocusedTab, kind: OverrideKind = 'address') {
  const clean = kind === 'domain' ? pattern.trim().toLowerCase() : normalizeAddress(pattern);
  if (!clean) return;
  const map = getFocusedOverrides();
  map[overrideKey(kind, clean)] = tab;
  writeOverrides(map);
}

export function removeFocusedOverride(key: string) {
  const map = getFocusedOverrides();
  if (!(key in map)) return;
  delete map[key];
  writeOverrides(map);
}

export function clearFocusedOverrides() {
  writeOverrides({});
}

/** Découpe une clé d'exception pour l'affichage. */
export function parseOverrideKey(key: string): { kind: OverrideKind; pattern: string } {
  if (key.startsWith('dom:')) return { kind: 'domain', pattern: key.slice(4) };
  return { kind: 'address', pattern: key.startsWith('addr:') ? key.slice(5) : key };
}

// ─── Classement ─────────────────────────────────────────────────────────────

export interface FocusedContext {
  /** Adresses du carnet d'adresses, en minuscules (api.getKnownSenders). */
  knownEmails: Set<string>;
  /** Domaines des comptes mail de l'utilisateur. */
  ownDomains: Set<string>;
  overrides: FocusedOverrides;
  prefs: FocusedInboxPrefs;
}

export function classifyAddress(rawAddress: string | undefined | null, ctx: FocusedContext): FocusedTab {
  const address = normalizeAddress(rawAddress);
  if (!address) return 'other';

  // 1. Exception sur l'adresse exacte.
  const byAddress = ctx.overrides[overrideKey('address', address)];
  if (byAddress) return byAddress;

  const domain = domainOf(address);

  // 2. Exception sur le domaine.
  if (domain) {
    const byDomain = ctx.overrides[overrideKey('domain', domain)];
    if (byDomain) return byDomain;
  }

  // 3. Contact enregistré.
  if (ctx.prefs.trustContacts && ctx.knownEmails.has(address)) return 'focused';

  // 4. Même domaine que l'un de mes comptes (hors fournisseurs grand public).
  if (ctx.prefs.trustOwnDomain && domain && !isPublicDomain(domain) && ctx.ownDomains.has(domain)) {
    return 'focused';
  }

  return 'other';
}

export function classifyMessage(message: Pick<Email, 'from'>, ctx: FocusedContext): FocusedTab {
  return classifyAddress(message?.from?.address, ctx);
}

/** Domaines exploitables parmi les adresses des comptes de l'utilisateur. */
export function ownDomainsFrom(emails: Array<string | undefined | null>): Set<string> {
  const out = new Set<string>();
  for (const e of emails) {
    const addr = normalizeAddress(e);
    const d = domainOf(addr);
    if (d && !isPublicDomain(d)) out.add(d);
  }
  return out;
}

// ─── Abonnement aux changements ─────────────────────────────────────────────

export function subscribeFocusedInbox(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY_PREFS || e.key === KEY_OVERRIDES) cb();
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storageHandler);
  };
}
