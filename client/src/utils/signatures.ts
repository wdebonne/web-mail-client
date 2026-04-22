/**
 * Gestion des signatures e-mail (style Outlook Web).
 *
 * Les signatures sont stockées côté client (localStorage) sous forme d'une liste
 * globale. Deux signatures par défaut peuvent être désignées : l'une pour les
 * nouveaux messages, l'autre pour les réponses et transferts.
 */

export interface MailSignature {
  id: string;
  name: string;
  /** HTML de la signature (rendu dans l'éditeur). */
  html: string;
  /** Timestamp de mise à jour (pour tri). */
  updatedAt: number;
}

const KEY_LIST = 'mail.signatures.v1';
const KEY_DEFAULT_NEW = 'mail.signatures.defaultNew';
const KEY_DEFAULT_REPLY = 'mail.signatures.defaultReply';
// Per-account defaults. Maps accountId → signatureId (or null to force "no signature").
const KEY_ACCOUNT_DEFAULT_NEW = 'mail.signatures.accountDefaultNew.v1';
const KEY_ACCOUNT_DEFAULT_REPLY = 'mail.signatures.accountDefaultReply.v1';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function genId(): string {
  return `sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getSignatures(): MailSignature[] {
  const list = readJSON<MailSignature[]>(KEY_LIST, []);
  return list.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

export function getSignatureById(id: string | null | undefined): MailSignature | null {
  if (!id) return null;
  return getSignatures().find(s => s.id === id) || null;
}

export function saveSignatures(signatures: MailSignature[]) {
  writeJSON(KEY_LIST, signatures);
  // Dispatch a custom event so listeners (Ribbon dropdown…) can refresh.
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch {}
}

export function upsertSignature(sig: { id?: string; name: string; html: string }): MailSignature {
  const list = readJSON<MailSignature[]>(KEY_LIST, []);
  const now = Date.now();
  if (sig.id) {
    const idx = list.findIndex(s => s.id === sig.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], name: sig.name, html: sig.html, updatedAt: now };
      saveSignatures(list);
      return list[idx];
    }
  }
  const created: MailSignature = {
    id: sig.id || genId(),
    name: sig.name,
    html: sig.html,
    updatedAt: now,
  };
  list.push(created);
  saveSignatures(list);
  return created;
}

export function deleteSignature(id: string) {
  const list = readJSON<MailSignature[]>(KEY_LIST, []).filter(s => s.id !== id);
  saveSignatures(list);
  // Nettoyer les valeurs par défaut pointant sur la signature supprimée.
  if (getDefaultNewId() === id) setDefaultNewId(null);
  if (getDefaultReplyId() === id) setDefaultReplyId(null);
  // Purge des overrides par compte qui pointaient sur cette signature.
  const mapNew = readJSON<Record<string, string | null>>(KEY_ACCOUNT_DEFAULT_NEW, {});
  const mapReply = readJSON<Record<string, string | null>>(KEY_ACCOUNT_DEFAULT_REPLY, {});
  let changed = false;
  for (const k of Object.keys(mapNew)) if (mapNew[k] === id) { delete mapNew[k]; changed = true; }
  for (const k of Object.keys(mapReply)) if (mapReply[k] === id) { delete mapReply[k]; changed = true; }
  if (changed) {
    writeJSON(KEY_ACCOUNT_DEFAULT_NEW, mapNew);
    writeJSON(KEY_ACCOUNT_DEFAULT_REPLY, mapReply);
    try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch {}
  }
}

// --- Valeurs par défaut ---
export function getDefaultNewId(): string | null {
  return localStorage.getItem(KEY_DEFAULT_NEW) || null;
}
export function setDefaultNewId(id: string | null) {
  if (id) localStorage.setItem(KEY_DEFAULT_NEW, id);
 

// ─── Valeurs par défaut par compte de messagerie ────────────────────────────
// Chaque compte (id) peut surcharger la signature par défaut globale :
//   • `undefined` dans la map   → suit la valeur globale,
//   • `null` dans la map        → "aucune signature" pour ce compte,
//   • `string` dans la map      → id de signature spécifique.
// Les helpers `resolveDefault*Id(accountId)` renvoient la valeur effective.

type SigOverrideMap = Record<string, string | null | undefined>;

function readOverrideMap(key: string): SigOverrideMap {
  return readJSON<SigOverrideMap>(key, {});
}

export function getAccountDefaultNewId(accountId: string | null | undefined): string | null | undefined {
  if (!accountId) return undefined;
  const map = readOverrideMap(KEY_ACCOUNT_DEFAULT_NEW);
  return Object.prototype.hasOwnProperty.call(map, accountId) ? map[accountId] : undefined;
}

export function getAccountDefaultReplyId(accountId: string | null | undefined): string | null | undefined {
  if (!accountId) return undefined;
  const map = readOverrideMap(KEY_ACCOUNT_DEFAULT_REPLY);
  return Object.prototype.hasOwnProperty.call(map, accountId) ? map[accountId] : undefined;
}

/**
 * Définit la signature par défaut pour les nouveaux messages d'un compte.
 *   • `id === undefined` : retire l'override (le compte suivra la valeur globale),
 *   • `id === null`      : "aucune signature" pour ce compte,
 *   • `id === string`    : id de signature.
 */
export function setAccountDefaultNewId(accountId: string, id: string | null | undefined) {
  const map = readOverrideMap(KEY_ACCOUNT_DEFAULT_NEW);
  if (id === undefined) delete map[accountId];
  else map[accountId] = id;
  writeJSON(KEY_ACCOUNT_DEFAULT_NEW, map);
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch {}
}

export function setAccountDefaultReplyId(accountId: string, id: string | null | undefined) {
  const map = readOverrideMap(KEY_ACCOUNT_DEFAULT_REPLY);
  if (id === undefined) delete map[accountId];
  else map[accountId] = id;
  writeJSON(KEY_ACCOUNT_DEFAULT_REPLY, map);
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch {}
}

/**
 * Résout la signature par défaut effective pour un compte donné (nouveau message).
 * Override du compte → valeur globale.
 */
export function resolveDefaultNewId(accountId: string | null | undefined): string | null {
  const override = getAccountDefaultNewId(accountId);
  if (override !== undefined) return override ?? null;
  return getDefaultNewId();
}

export function resolveDefaultReplyId(accountId: string | null | undefined): string | null {
  const override = getAccountDefaultReplyId(accountId);
  if (override !== undefined) return override ?? null;
  return getDefaultReplyId();
} else localStorage.removeItem(KEY_DEFAULT_NEW);
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch {}
}

export function getDefaultReplyId(): string | null {
  return localStorage.getItem(KEY_DEFAULT_REPLY) || null;
}
export function setDefaultReplyId(id: string | null) {
  if (id) localStorage.setItem(KEY_DEFAULT_REPLY, id);
  else localStorage.removeItem(KEY_DEFAULT_REPLY);
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch {}
}

/** Enveloppe la signature dans un bloc séparé (style Outlook). */
export function wrapSignatureHtml(html: string): string {
  return `<br><div class="outlook-signature" data-signature="true">${html}</div>`;
}
