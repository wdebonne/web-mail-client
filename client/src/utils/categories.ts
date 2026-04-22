// Mail categories — persisted in localStorage, unified across every mailbox.
// Categories are GLOBAL (not per-account); only message → category assignments
// carry the (accountId, folder, uid/messageId) tuple.

import type { Email } from '../types';

export interface MailCategory {
  id: string;
  name: string;
  color: string; // hex
  isFavorite?: boolean;
}

const KEY_CATEGORIES = 'mail.categories';
const KEY_ASSIGNMENTS = 'mail.messageCategories';
const EVENT_NAME = 'mail-categories-changed';

// Palette inspirée du sélecteur Outlook (24 couleurs).
export const CATEGORY_COLORS: string[] = [
  '#E8B4B8', '#F2B9AB', '#E8A87C', '#F0C987', '#F4E285', '#E2D0A9',
  '#C9B79C', '#B8A487', '#C7E0B4', '#A8D5A2', '#7FB77E', '#6BAE5F',
  '#B5DDD8', '#8EC6C5', '#6FA8D6', '#A5B5E8', '#B0A8E6', '#8B7FD6',
  '#E4B3DA', '#D48EC7', '#B5838D', '#A08B8B', '#BFBFBF', '#F2F2F2',
];

export const DEFAULT_CATEGORIES: MailCategory[] = [
  { id: 'cat-orange', name: 'Orange category', color: '#E8A87C' },
  { id: 'cat-blue',   name: 'Blue category',   color: '#6FA8D6' },
  { id: 'cat-green',  name: 'Green category',  color: '#7FB77E' },
  { id: 'cat-purple', name: 'Purple category', color: '#8B7FD6' },
  { id: 'cat-red',    name: 'Red category',    color: '#E8B4B8' },
  { id: 'cat-yellow', name: 'Yellow category', color: '#F4E285' },
];

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
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {}
}

// ─── Categories ─────────────────────────────────────────────────────────

export function getCategories(): MailCategory[] {
  const existing = readJSON<MailCategory[]>(KEY_CATEGORIES, []);
  if (existing.length === 0) {
    // Seed default set the first time.
    writeJSON(KEY_CATEGORIES, DEFAULT_CATEGORIES);
    return DEFAULT_CATEGORIES.slice();
  }
  return existing;
}

export function setCategories(list: MailCategory[]) {
  writeJSON(KEY_CATEGORIES, list);
}

export function createCategory(data: { name: string; color: string; isFavorite?: boolean }): MailCategory {
  const list = getCategories();
  const cat: MailCategory = {
    id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: data.name.trim() || 'Nouvelle catégorie',
    color: data.color,
    isFavorite: !!data.isFavorite,
  };
  list.push(cat);
  setCategories(list);
  return cat;
}

export function updateCategory(id: string, patch: Partial<Omit<MailCategory, 'id'>>) {
  const list = getCategories().map((c) =>
    c.id === id ? { ...c, ...patch, name: (patch.name ?? c.name).trim() || c.name } : c,
  );
  setCategories(list);
}

export function deleteCategory(id: string) {
  setCategories(getCategories().filter((c) => c.id !== id));
  // Also clean up every assignment that referenced it.
  const map = getAllAssignments();
  let changed = false;
  for (const key of Object.keys(map)) {
    const next = (map[key] || []).filter((cid) => cid !== id);
    if (next.length !== (map[key] || []).length) {
      if (next.length) map[key] = next;
      else delete map[key];
      changed = true;
    }
  }
  if (changed) writeJSON(KEY_ASSIGNMENTS, map);
}

export function toggleCategoryFavorite(id: string) {
  const list = getCategories();
  const next = list.map((c) => (c.id === id ? { ...c, isFavorite: !c.isFavorite } : c));
  setCategories(next);
}

export function getCategoryById(id: string): MailCategory | undefined {
  return getCategories().find((c) => c.id === id);
}

// ─── Assignments (message ↔ categories) ─────────────────────────────────

/** Stable key for a message. Prefers RFC822 Message-ID when available so the
 *  category travels with the message even after it is moved or re-synced. */
export function messageKey(
  message: Pick<Email, 'messageId' | 'uid' | '_accountId' | '_folder'> & { _accountId?: string; _folder?: string },
  fallbackAccountId?: string,
  fallbackFolder?: string,
): string {
  if (message.messageId) return `mid:${message.messageId}`;
  const acc = message._accountId || fallbackAccountId || 'unknown';
  const fld = message._folder || fallbackFolder || '';
  return `uid:${acc}:${fld}:${message.uid}`;
}

function getAllAssignments(): Record<string, string[]> {
  return readJSON<Record<string, string[]>>(KEY_ASSIGNMENTS, {});
}

export function getMessageCategories(
  message: Pick<Email, 'messageId' | 'uid' | '_accountId' | '_folder'>,
  accountId?: string,
  folder?: string,
): string[] {
  const map = getAllAssignments();
  // Prefer messageId-based key, fall back to uid-based key.
  const primary = map[messageKey(message, accountId, folder)] || [];
  if (primary.length) return primary;
  // Secondary lookup in case the message was first indexed by uid and later received a messageId.
  if (message.messageId) {
    const uidKey = `uid:${message._accountId || accountId || 'unknown'}:${message._folder || folder || ''}:${message.uid}`;
    return map[uidKey] || [];
  }
  return [];
}

export function setMessageCategories(
  message: Pick<Email, 'messageId' | 'uid' | '_accountId' | '_folder'>,
  categoryIds: string[],
  accountId?: string,
  folder?: string,
) {
  const map = getAllAssignments();
  const key = messageKey(message, accountId, folder);
  const clean = Array.from(new Set(categoryIds));
  if (clean.length) map[key] = clean;
  else delete map[key];
  writeJSON(KEY_ASSIGNMENTS, map);
}

export function toggleMessageCategory(
  message: Pick<Email, 'messageId' | 'uid' | '_accountId' | '_folder'>,
  categoryId: string,
  accountId?: string,
  folder?: string,
): string[] {
  const current = getMessageCategories(message, accountId, folder);
  const next = current.includes(categoryId)
    ? current.filter((c) => c !== categoryId)
    : [...current, categoryId];
  setMessageCategories(message, next, accountId, folder);
  return next;
}

export function clearMessageCategories(
  message: Pick<Email, 'messageId' | 'uid' | '_accountId' | '_folder'>,
  accountId?: string,
  folder?: string,
) {
  setMessageCategories(message, [], accountId, folder);
}

/** Returns true if the given message has at least one of the listed categories. */
export function messageHasAnyCategory(
  message: Pick<Email, 'messageId' | 'uid' | '_accountId' | '_folder'>,
  categoryIds: string[],
  accountId?: string,
  folder?: string,
): boolean {
  if (!categoryIds.length) return true;
  const mine = getMessageCategories(message, accountId, folder);
  return mine.some((id) => categoryIds.includes(id));
}

// ─── Change subscription (re-render helper) ─────────────────────────────

export function subscribeCategories(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  // Also react to cross-tab localStorage changes.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY_CATEGORIES || e.key === KEY_ASSIGNMENTS) cb();
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

/** Convert a hex color to a soft translucent row-tint (rgba with low alpha). */
export function categoryRowTint(color: string, alpha = 0.18): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
