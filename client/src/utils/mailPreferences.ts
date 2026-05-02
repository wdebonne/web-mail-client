import { MailAccount, MailFolder } from '../types';

// --- LocalStorage keys ---
const KEY_ACCOUNT_NAMES = 'mail.accountDisplayNames';
const KEY_ACCOUNT_COLORS = 'mail.accountColors';
const KEY_ACCOUNT_ORDER = 'mail.accountOrder';
const KEY_FOLDER_ORDER = 'mail.folderOrder'; // { [accountId]: string[] of folder paths }
const KEY_EXPANDED_ACCOUNTS = 'mail.expandedAccounts';
const KEY_FAVORITE_FOLDERS = 'mail.favoriteFolders'; // FavoriteFolder[]
const KEY_UNIFIED_ACCOUNTS = 'mail.unifiedAccounts'; // string[] (accountIds included in unified inbox/sent); empty = all
const KEY_FAVORITES_EXPANDED = 'mail.favoritesExpanded'; // boolean
const KEY_UNIFIED_INBOX_ENABLED = 'mail.unifiedInboxEnabled'; // boolean (default true)
const KEY_UNIFIED_SENT_ENABLED = 'mail.unifiedSentEnabled'; // boolean (default true)

export interface FavoriteFolder {
  accountId: string;
  path: string;
}

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

// --- Account display names ---
export function getAccountDisplayOverrides(): Record<string, string> {
  return readJSON<Record<string, string>>(KEY_ACCOUNT_NAMES, {});
}

export function setAccountDisplayOverride(accountId: string, name: string | null) {
  const map = getAccountDisplayOverrides();
  if (name && name.trim()) {
    map[accountId] = name.trim();
  } else {
    delete map[accountId];
  }
  writeJSON(KEY_ACCOUNT_NAMES, map);
}

export function getAccountDisplayName(account: MailAccount): string {
  const overrides = getAccountDisplayOverrides();
  return overrides[account.id] || account.assigned_display_name || account.name;
}

// --- Account colors ---
// Per-user colour override applied to the dot/avatar shown next to each
// account in FolderPane (and anywhere `account.color` is rendered). Falls
// back to the server-assigned `account.color` when no override is set.
export function getAccountColorOverrides(): Record<string, string> {
  return readJSON<Record<string, string>>(KEY_ACCOUNT_COLORS, {});
}

export function setAccountColorOverride(accountId: string, color: string | null) {
  const map = getAccountColorOverrides();
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    map[accountId] = color;
  } else {
    delete map[accountId];
  }
  writeJSON(KEY_ACCOUNT_COLORS, map);
}

export function getAccountColor(account: MailAccount): string | undefined {
  const overrides = getAccountColorOverrides();
  return overrides[account.id] || (account as any).color || undefined;
}

// --- Account ordering ---
export function getAccountOrder(): string[] {
  return readJSON<string[]>(KEY_ACCOUNT_ORDER, []);
}

export function setAccountOrder(order: string[]) {
  writeJSON(KEY_ACCOUNT_ORDER, order);
}

export function sortAccounts(accounts: MailAccount[]): MailAccount[] {
  const order = getAccountOrder();
  if (!order.length) return accounts;
  const indexOf = (id: string) => {
    const idx = order.indexOf(id);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  return [...accounts].sort((a, b) => indexOf(a.id) - indexOf(b.id));
}

// --- Folder ordering (per account) ---
export function getFolderOrderMap(): Record<string, string[]> {
  return readJSON<Record<string, string[]>>(KEY_FOLDER_ORDER, {});
}

export function getFolderOrder(accountId: string): string[] {
  return getFolderOrderMap()[accountId] || [];
}

export function setFolderOrder(accountId: string, order: string[]) {
  const map = getFolderOrderMap();
  map[accountId] = order;
  writeJSON(KEY_FOLDER_ORDER, map);
}

const FOLDER_PRIORITY: Record<string, number> = {
  '\\Inbox': 0,
  '\\Drafts': 1,
  '\\Sent': 2,
  '\\Junk': 3,
  '\\Trash': 4,
  '\\Archive': 5,
};

export function sortFolders(folders: MailFolder[], accountId?: string): MailFolder[] {
  const customOrder = accountId ? getFolderOrder(accountId) : [];

  if (customOrder.length) {
    const indexOf = (path: string) => {
      const idx = customOrder.indexOf(path);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    // Fold remaining unknown folders by default sort
    return [...folders].sort((a, b) => {
      const ia = indexOf(a.path);
      const ib = indexOf(b.path);
      if (ia !== ib) return ia - ib;
      return defaultFolderCompare(a, b);
    });
  }

  return [...folders].sort(defaultFolderCompare);
}

function defaultFolderCompare(a: MailFolder, b: MailFolder) {
  const pa = a.specialUse ? (FOLDER_PRIORITY[a.specialUse] ?? 10) : (a.name === 'INBOX' ? 0 : 10);
  const pb = b.specialUse ? (FOLDER_PRIORITY[b.specialUse] ?? 10) : (b.name === 'INBOX' ? 0 : 10);
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name);
}

// --- Expanded accounts persistence ---
export function getExpandedAccounts(): string[] {
  return readJSON<string[]>(KEY_EXPANDED_ACCOUNTS, []);
}

export function setExpandedAccounts(ids: string[]) {
  writeJSON(KEY_EXPANDED_ACCOUNTS, ids);
}

// --- Favorite folders ---
export function getFavoriteFolders(): FavoriteFolder[] {
  return readJSON<FavoriteFolder[]>(KEY_FAVORITE_FOLDERS, []);
}

export function setFavoriteFolders(favs: FavoriteFolder[]) {
  writeJSON(KEY_FAVORITE_FOLDERS, favs);
}

export function isFavoriteFolder(accountId: string, path: string): boolean {
  return getFavoriteFolders().some((f) => f.accountId === accountId && f.path === path);
}

export function addFavoriteFolder(accountId: string, path: string) {
  const favs = getFavoriteFolders();
  if (favs.some((f) => f.accountId === accountId && f.path === path)) return;
  favs.push({ accountId, path });
  setFavoriteFolders(favs);
}

export function removeFavoriteFolder(accountId: string, path: string) {
  const favs = getFavoriteFolders().filter(
    (f) => !(f.accountId === accountId && f.path === path),
  );
  setFavoriteFolders(favs);
}

export function toggleFavoriteFolder(accountId: string, path: string): boolean {
  if (isFavoriteFolder(accountId, path)) {
    removeFavoriteFolder(accountId, path);
    return false;
  }
  addFavoriteFolder(accountId, path);
  return true;
}

// --- Unified mailbox selection ---
/** Returns the set of account IDs included in unified inbox/sent.
 *  Empty array means "all accounts". */
export function getUnifiedAccountIds(): string[] {
  return readJSON<string[]>(KEY_UNIFIED_ACCOUNTS, []);
}

export function setUnifiedAccountIds(ids: string[]) {
  writeJSON(KEY_UNIFIED_ACCOUNTS, ids);
}

export function isAccountInUnified(accountId: string, allAccountIds: string[]): boolean {
  const selected = getUnifiedAccountIds();
  if (!selected.length) return true; // "all"
  return selected.includes(accountId) || !allAccountIds.includes(accountId) === false && selected.includes(accountId);
}

export function getUnifiedInboxEnabled(): boolean {
  const raw = localStorage.getItem(KEY_UNIFIED_INBOX_ENABLED);
  return raw === null ? true : raw === 'true';
}

export function setUnifiedInboxEnabled(enabled: boolean) {
  localStorage.setItem(KEY_UNIFIED_INBOX_ENABLED, String(enabled));
}

export function getUnifiedSentEnabled(): boolean {
  const raw = localStorage.getItem(KEY_UNIFIED_SENT_ENABLED);
  return raw === null ? true : raw === 'true';
}

export function setUnifiedSentEnabled(enabled: boolean) {
  localStorage.setItem(KEY_UNIFIED_SENT_ENABLED, String(enabled));
}

export function getFavoritesExpanded(): boolean {
  const raw = localStorage.getItem(KEY_FAVORITES_EXPANDED);
  return raw === null ? true : raw === 'true';
}

export function setFavoritesExpanded(expanded: boolean) {
  localStorage.setItem(KEY_FAVORITES_EXPANDED, String(expanded));
}

/** Return the Sent folder path for an account, preferring specialUse, then common names. */
export function findSentFolderPath(folders: MailFolder[]): string | null {
  const bySpecial = folders.find((f) => f.specialUse === '\\Sent');
  if (bySpecial) return bySpecial.path;
  const byName = folders.find((f) => {
    const n = f.name.toLowerCase();
    return n === 'sent' || n.includes('envoy') || n === 'sent items' || n === 'sent mail';
  });
  if (byName) return byName.path;
  const byPath = folders.find((f) => {
    const p = f.path.toLowerCase();
    return p === 'sent' || p === 'inbox.sent' || p.endsWith('.sent') || p.includes('envoy');
  });
  return byPath ? byPath.path : null;
}

/** Return the Inbox folder path for an account. */
export function findInboxFolderPath(folders: MailFolder[]): string {
  const bySpecial = folders.find((f) => f.specialUse === '\\Inbox');
  if (bySpecial) return bySpecial.path;
  const byName = folders.find((f) => f.name.toUpperCase() === 'INBOX');
  return byName ? byName.path : 'INBOX';
}

/** Return the Trash/Corbeille folder path for an account, preferring specialUse, then common names. */
export function findTrashFolderPath(folders: MailFolder[]): string | null {
  const bySpecial = folders.find((f) => f.specialUse === '\\Trash');
  if (bySpecial) return bySpecial.path;
  const byName = folders.find((f) => {
    const n = f.name.toLowerCase();
    return n === 'trash' || n === 'corbeille' || n.includes('corbeille')
      || n === 'deleted items' || n === 'deleted' || n.includes('éléments supprimés')
      || n.includes('elements supprimes') || n.includes('supprim');
  });
  if (byName) return byName.path;
  const byPath = folders.find((f) => {
    const p = f.path.toLowerCase();
    return p === 'trash' || p.endsWith('.trash') || p.includes('corbeille') || p.includes('deleted');
  });
  return byPath ? byPath.path : null;
}

/** Returns true when the given folder path is the Trash folder for this account. */
export function isTrashFolderPath(folders: MailFolder[], path: string): boolean {
  if (!path) return false;
  const trash = findTrashFolderPath(folders);
  if (trash && trash === path) return true;
  // Fallback — heuristics on path/name
  const p = path.toLowerCase();
  return p === 'trash' || p.endsWith('.trash') || p.includes('corbeille')
    || p.includes('deleted') || p.includes('supprim');
}

// --- Delete confirmation preference ---
const KEY_DELETE_CONFIRM = 'mail.deleteConfirmEnabled'; // boolean (default true)

export function getDeleteConfirmEnabled(): boolean {
  const raw = localStorage.getItem(KEY_DELETE_CONFIRM);
  return raw === null ? true : raw === 'true';
}

export function setDeleteConfirmEnabled(enabled: boolean) {
  localStorage.setItem(KEY_DELETE_CONFIRM, String(enabled));
}

// --- Auto-load all messages preference ---
//
// When enabled, every folder (and unified view) automatically pages through
// every remaining message after opening it, so client-side search covers the
// entire mailbox instead of only the first 50 messages. When disabled
// (default), the user keeps the manual « Charger plus » / « Tout charger »
// buttons at the bottom of the list.
const KEY_AUTO_LOAD_ALL = 'mail.autoLoadAll';

export function getAutoLoadAllEnabled(): boolean {
  const raw = localStorage.getItem(KEY_AUTO_LOAD_ALL);
  return raw === null ? false : raw === 'true';
}

export function setAutoLoadAllEnabled(enabled: boolean) {
  localStorage.setItem(KEY_AUTO_LOAD_ALL, String(enabled));
  try {
    window.dispatchEvent(new CustomEvent('mail-auto-load-all-changed', { detail: { enabled } }));
  } catch { /* noop */ }
}

// --- New-mail poll interval (server-side) ---
//
// Stored in localStorage AND mirrored to user_preferences so the server can
// read it for each user. The server-side newMailPoller ticks every 30s and
// only checks an account when its owner's preferred interval has elapsed
// since the last check. Value 0 = disabled (jamais).
export type NewMailPollMinutes = 0 | 1 | 5 | 15 | 30 | 60;

const KEY_NEW_MAIL_POLL_MINUTES = 'mail.newMailPollMinutes';
const VALID_POLL_VALUES: NewMailPollMinutes[] = [0, 1, 5, 15, 30, 60];
const DEFAULT_POLL_MINUTES: NewMailPollMinutes = 5;

export function getNewMailPollMinutes(): NewMailPollMinutes {
  const raw = localStorage.getItem(KEY_NEW_MAIL_POLL_MINUTES);
  if (raw === null) return DEFAULT_POLL_MINUTES;
  const n = Number(raw);
  return (VALID_POLL_VALUES as number[]).includes(n) ? (n as NewMailPollMinutes) : DEFAULT_POLL_MINUTES;
}

export function setNewMailPollMinutes(minutes: NewMailPollMinutes) {
  if (!(VALID_POLL_VALUES as number[]).includes(minutes)) return;
  localStorage.setItem(KEY_NEW_MAIL_POLL_MINUTES, String(minutes));
  try {
    window.dispatchEvent(new CustomEvent('mail-new-mail-poll-changed', { detail: { minutes } }));
  } catch { /* noop */ }
}

// --- Floating action button position (mobile/tablet) ---
//
// 9-cell grid (top/middle/bottom × left/center/right) used to position the
// floating "Nouveau message" / "Nouvel événement" buttons that appear on
// mobile and tablet. The same setting is shared by every page so the user
// has muscle memory for where to tap.
export type FabPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

const KEY_FAB_POSITION = 'ui.fabPosition';
const FAB_POSITION_EVENT = 'fab-position-changed';

export function getFabPosition(): FabPosition {
  const raw = localStorage.getItem(KEY_FAB_POSITION);
  const allowed: FabPosition[] = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'middle-center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ];
  return (allowed.includes(raw as FabPosition) ? raw : 'bottom-right') as FabPosition;
}

export function setFabPosition(position: FabPosition) {
  localStorage.setItem(KEY_FAB_POSITION, position);
  try {
    window.dispatchEvent(new CustomEvent(FAB_POSITION_EVENT, { detail: { position } }));
  } catch { /* noop */ }
}

export const FAB_POSITION_CHANGED_EVENT = FAB_POSITION_EVENT;

// --- Swipe gesture preferences (mobile / tablet) ---
/**
 * Actions qui peuvent être déclenchées par un balayage horizontal sur un
 * message dans la liste. 'none' désactive le côté correspondant.
 */
export type SwipeAction = 'none' | 'archive' | 'trash' | 'move' | 'copy' | 'flag' | 'read';

export interface SwipePrefs {
  /** Active les gestes de balayage sur mobile/tablette. */
  enabled: boolean;
  /** Action quand on glisse vers la gauche. */
  leftAction: SwipeAction;
  /** Action quand on glisse vers la droite. */
  rightAction: SwipeAction;
  /**
   * Dossier par défaut pour les actions "Déplacer" (par compte).
   * Clé = accountId, valeur = chemin IMAP du dossier cible.
   * Si vide ou si le dossier n'existe plus, l'utilisateur sera invité à choisir.
   */
  moveTargets: Record<string, string>;
  /** Idem pour l'action "Copier". */
  copyTargets: Record<string, string>;
}

const KEY_SWIPE_PREFS = 'mail.swipePrefs';

const DEFAULT_SWIPE_PREFS: SwipePrefs = {
  enabled: true,
  leftAction: 'archive',
  rightAction: 'trash',
  moveTargets: {},
  copyTargets: {},
};

export function getSwipePrefs(): SwipePrefs {
  const raw = readJSON<Partial<SwipePrefs> | null>(KEY_SWIPE_PREFS, null);
  if (!raw) return { ...DEFAULT_SWIPE_PREFS };
  return {
    enabled: raw.enabled ?? DEFAULT_SWIPE_PREFS.enabled,
    leftAction: (raw.leftAction as SwipeAction) ?? DEFAULT_SWIPE_PREFS.leftAction,
    rightAction: (raw.rightAction as SwipeAction) ?? DEFAULT_SWIPE_PREFS.rightAction,
    moveTargets: raw.moveTargets ?? {},
    copyTargets: raw.copyTargets ?? {},
  };
}

export function setSwipePrefs(prefs: SwipePrefs) {
  writeJSON(KEY_SWIPE_PREFS, prefs);
}

export function updateSwipePrefs(patch: Partial<SwipePrefs>) {
  setSwipePrefs({ ...getSwipePrefs(), ...patch });
}

export function getSwipeMoveTarget(accountId: string): string | null {
  return getSwipePrefs().moveTargets[accountId] || null;
}

export function setSwipeMoveTarget(accountId: string, folderPath: string | null) {
  const prefs = getSwipePrefs();
  if (folderPath) prefs.moveTargets[accountId] = folderPath;
  else delete prefs.moveTargets[accountId];
  setSwipePrefs(prefs);
}

export function getSwipeCopyTarget(accountId: string): string | null {
  return getSwipePrefs().copyTargets[accountId] || null;
}

export function setSwipeCopyTarget(accountId: string, folderPath: string | null) {
  const prefs = getSwipePrefs();
  if (folderPath) prefs.copyTargets[accountId] = folderPath;
  else delete prefs.copyTargets[accountId];
  setSwipePrefs(prefs);
}
