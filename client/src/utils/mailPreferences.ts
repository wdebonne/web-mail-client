import { MailAccount, MailFolder } from '../types';

// --- LocalStorage keys ---
const KEY_ACCOUNT_NAMES = 'mail.accountDisplayNames';
const KEY_ACCOUNT_ORDER = 'mail.accountOrder';
const KEY_FOLDER_ORDER = 'mail.folderOrder'; // { [accountId]: string[] of folder paths }
const KEY_EXPANDED_ACCOUNTS = 'mail.expandedAccounts';

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
