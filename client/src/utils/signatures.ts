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

export function upsertSignature(sig: Omit<MailSignature, 'updatedAt'> & { id?: string }): MailSignature {
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
}

// --- Valeurs par défaut ---
export function getDefaultNewId(): string | null {
  return localStorage.getItem(KEY_DEFAULT_NEW) || null;
}
export function setDefaultNewId(id: string | null) {
  if (id) localStorage.setItem(KEY_DEFAULT_NEW, id);
  else localStorage.removeItem(KEY_DEFAULT_NEW);
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
