/**
 * Sauvegarde et restauration des données locales utilisateur.
 *
 * Ce module exporte/importe toute la configuration stockée côté client
 * (signatures, catégories, préférences d'affichage, thème, ordre des
 * dossiers/comptes, etc.) — c'est-à-dire tout ce qui n'est PAS sauvegardé
 * côté serveur ni synchronisé via IMAP.
 *
 * Modes :
 *  • Manuel : export (téléchargement .json) / import (sélection d'un fichier)
 *  • Automatique : un unique fichier écrit dans un dossier du PC choisi
 *    par l'utilisateur (via File System Access API). Le nom du fichier est
 *    personnalisable pour éviter les suppressions accidentelles et pour
 *    faciliter la reprise par Duplicati ou tout autre outil de sauvegarde.
 *
 * Le File System Access API est disponible sur Chrome / Edge / Opera
 * (Windows, macOS, Linux, ChromeOS). Sur Firefox / Safari, l'auto-backup
 * retombe automatiquement sur un téléchargement.
 */

/** Liste blanche des clés localStorage sauvegardées.
 *  Un préfixe terminant par ":*" inclut toutes les clés débutant par ce préfixe.
 *  Les clés techniques (auth_token, backup.*) sont volontairement exclues. */
export const BACKUP_KEYS: string[] = [
  // Thème / apparence
  'theme.mode',
  // Signatures
  'mail.signatures.v1',
  'mail.signatures.defaultNew',
  'mail.signatures.defaultReply',
  'mail.signatures.accountDefaultNew.v1',
  'mail.signatures.accountDefaultReply.v1',
  // Catégories
  'mail.categories',
  'mail.messageCategories',
  // Organisation des comptes et dossiers
  'mail.accountDisplayNames',
  'mail.accountColors',
  'mail.accountOrder',
  'mail.folderOrder',
  'mail.expandedAccounts',
  'mail.favoriteFolders',
  'mail.favoritesExpanded',
  'mail.unifiedAccounts',
  'mail.unifiedInboxEnabled',
  'mail.unifiedSentEnabled',
  'mail.deleteConfirmEnabled',
  'mail.swipePrefs',
  'mail.autoLoadAll',
  'mail.newMailPollMinutes',
  // Personnalisation interface
  'ui.fabPosition',
  'ui.folderPaneFontSize',
  // Vues / mise en page
  'readingPaneMode',
  'listDensity',
  'listDisplayMode',
  'conversationView',
  'conversationGrouping',
  'conversationShowAllInReadingPane',
  'listHeight',
  'splitRatio',
  'splitKeepFolderPane',
  'splitKeepMessageList',
  'splitComposeReply',
  'ribbonCollapsed',
  'ribbonMode',
  'mailListWidth',
  'folderPaneWidth',
  'tabMode',
  'maxTabs',
  // Notifications (préférences locales)
  'notifications.sound',
  'notifications.calendar',
  'notifications.prefs.v1',
  // GIFs (clé API GIPHY perso si l'utilisateur en a saisi une)
  'giphyApiKey',
  // Divers
  'emoji-panel-recent',
  'contacts-sidebar-width',
];

/** Préfixes sauvegardés (toutes les clés débutant par ceux-ci). */
export const BACKUP_PREFIXES: string[] = [
  // Préférences calendrier (groupes, ordre, vue, surcharges nom/couleur,
  // calendriers masqués localement, ribbon, etc.).
  'calendar.',
];

/** Clés de config du module backup lui-même (jamais incluses dans l'export). */
export const BACKUP_CONFIG_KEYS = {
  autoEnabled: 'backup.auto.enabled',
  autoFilename: 'backup.auto.filename',
  lastBackupAt: 'backup.auto.lastAt',
  lastBackupError: 'backup.auto.lastError',
  dirLabel: 'backup.auto.dirLabel',
} as const;

const DEFAULT_FILENAME = 'web-mail-client-backup.json';
const BACKUP_FORMAT_VERSION = 1;
const APP_ID = 'web-mail-client';
const EVENT_LOCAL_CHANGED = 'local-settings-changed';
const EVENT_BACKUP_STATUS = 'backup-status-changed';

// ─────────────────────────────────────────────────────────────────────────
// IndexedDB — stockage du FileSystemDirectoryHandle (non sérialisable JSON)
// ─────────────────────────────────────────────────────────────────────────
const IDB_NAME = 'web-mail-client-backup';
const IDB_STORE = 'handles';
const IDB_KEY_DIR = 'dir-handle';

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Collecte / application du payload
// ─────────────────────────────────────────────────────────────────────────

export interface BackupPayload {
  app: typeof APP_ID;
  version: number;
  createdAt: string;
  userAgent?: string;
  data: Record<string, string>;
}

function isBackupableKey(key: string): boolean {
  if (BACKUP_KEYS.includes(key)) return true;
  return BACKUP_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Public alias for the same predicate (used by other modules like prefsSync). */
export const isSyncableKey = isBackupableKey;

/** Event name fired whenever a backupable localStorage key changes (set or removed). */
export const LOCAL_SETTINGS_CHANGED_EVENT = 'local-settings-changed';

/** Assemble un objet contenant toutes les valeurs locales à sauvegarder. */
export function collectBackup(): BackupPayload {
  const data: Record<string, string> = {};
  for (const key of BACKUP_KEYS) {
    const v = localStorage.getItem(key);
    if (v !== null) data[key] = v;
  }
  if (BACKUP_PREFIXES.length) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (data[k] !== undefined) continue;
      if (!isBackupableKey(k)) continue;
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    }
  }
  return {
    app: APP_ID,
    version: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    data,
  };
}

/** Valide un payload. Lève une erreur descriptive si invalide. */
function validatePayload(raw: unknown): asserts raw is BackupPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Fichier de sauvegarde invalide');
  const obj = raw as Partial<BackupPayload>;
  if (obj.app !== APP_ID) throw new Error("Ce fichier n'est pas une sauvegarde Web Mail Client");
  if (typeof obj.version !== 'number') throw new Error('Version de sauvegarde manquante');
  if (obj.version > BACKUP_FORMAT_VERSION) {
    throw new Error(`Sauvegarde créée par une version plus récente (v${obj.version})`);
  }
  if (!obj.data || typeof obj.data !== 'object') throw new Error('Aucune donnée dans la sauvegarde');
}

/** Applique un payload déjà analysé. Retourne le nombre de clés restaurées. */
export function applyBackup(raw: unknown, options?: { replace?: boolean }): number {
  validatePayload(raw);
  const payload = raw as BackupPayload;
  const replace = options?.replace !== false; // défaut : remplace complet

  if (replace) {
    for (const key of BACKUP_KEYS) localStorage.removeItem(key);
    if (BACKUP_PREFIXES.length) {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isBackupableKey(k)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }
  }

  let count = 0;
  for (const [key, value] of Object.entries(payload.data)) {
    if (typeof value !== 'string') continue;
    if (!isBackupableKey(key)) continue;
    localStorage.setItem(key, value);
    count++;
  }

  // Notifier les stores / composants qui écoutent ces clés.
  try { window.dispatchEvent(new Event('mail.signatures.changed')); } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('mail-categories-changed')); } catch { /* noop */ }
  return count;
}

/** Sérialise joliment un payload (JSON indenté). */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** Lit un fichier JSON et le parse en payload validé. */
export async function parseBackupFile(file: File): Promise<BackupPayload> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Fichier illisible (JSON invalide)");
  }
  validatePayload(json);
  return json as BackupPayload;
}

// ─────────────────────────────────────────────────────────────────────────
// Export manuel : téléchargement .json
// ─────────────────────────────────────────────────────────────────────────

export function downloadBackup(filename?: string): BackupPayload {
  const payload = collectBackup();
  const content = serializeBackup(payload);
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename || defaultDownloadName());
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}

function defaultDownloadName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `web-mail-client-backup-${stamp}.json`;
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-backup : File System Access API
// ─────────────────────────────────────────────────────────────────────────

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as any).showDirectoryPicker === 'function';
}

/** Nettoie un nom de fichier. Garantit l'extension .json. */
export function sanitizeFilename(name: string): string {
  let n = (name || '').trim();
  if (!n) n = DEFAULT_FILENAME;
  // Retire séparateurs de chemin et caractères interdits Windows/Linux.
  n = n.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
  // Retire les points/espaces en fin (Windows).
  n = n.replace(/[. ]+$/g, '');
  if (!/\.json$/i.test(n)) n += '.json';
  return n || DEFAULT_FILENAME;
}

export function getAutoBackupFilename(): string {
  return localStorage.getItem(BACKUP_CONFIG_KEYS.autoFilename) || DEFAULT_FILENAME;
}

export function setAutoBackupFilename(name: string) {
  const clean = sanitizeFilename(name);
  localStorage.setItem(BACKUP_CONFIG_KEYS.autoFilename, clean);
  emitBackupStatus();
}

export function isAutoBackupEnabled(): boolean {
  return localStorage.getItem(BACKUP_CONFIG_KEYS.autoEnabled) === 'true';
}

export function setAutoBackupEnabled(enabled: boolean) {
  localStorage.setItem(BACKUP_CONFIG_KEYS.autoEnabled, String(enabled));
  emitBackupStatus();
}

export function getLastBackupAt(): Date | null {
  const v = localStorage.getItem(BACKUP_CONFIG_KEYS.lastBackupAt);
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getLastBackupError(): string | null {
  return localStorage.getItem(BACKUP_CONFIG_KEYS.lastBackupError) || null;
}

export function getBackupDirLabel(): string | null {
  return localStorage.getItem(BACKUP_CONFIG_KEYS.dirLabel) || null;
}

function emitBackupStatus() {
  try { window.dispatchEvent(new Event(EVENT_BACKUP_STATUS)); } catch { /* noop */ }
}

export function subscribeBackupStatus(cb: () => void): () => void {
  window.addEventListener(EVENT_BACKUP_STATUS, cb);
  return () => window.removeEventListener(EVENT_BACKUP_STATUS, cb);
}

/** Demande à l'utilisateur de choisir un dossier et persiste le handle. */
export async function pickBackupDirectory(): Promise<{ label: string } | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "Votre navigateur ne permet pas d'écrire directement dans un dossier. " +
      "Utilisez Chrome, Edge ou Opera sur PC, ou servez-vous du bouton « Exporter » manuellement."
    );
  }
  const picker = (window as any).showDirectoryPicker;
  let handle: any;
  try {
    handle = await picker({ mode: 'readwrite', id: 'web-mail-client-backup', startIn: 'documents' });
  } catch (e: any) {
    if (e && (e.name === 'AbortError' || e.code === 20)) return null;
    throw e;
  }
  await idbSet(IDB_KEY_DIR, handle);
  const label = handle.name || 'dossier choisi';
  localStorage.setItem(BACKUP_CONFIG_KEYS.dirLabel, label);
  emitBackupStatus();
  return { label };
}

export async function hasBackupDirectory(): Promise<boolean> {
  if (!isFileSystemAccessSupported()) return false;
  const handle = await idbGet<any>(IDB_KEY_DIR);
  return !!handle;
}

export async function clearBackupDirectory(): Promise<void> {
  await idbDelete(IDB_KEY_DIR);
  localStorage.removeItem(BACKUP_CONFIG_KEYS.dirLabel);
  emitBackupStatus();
}

async function getBackupDirectoryHandle(interactive: boolean): Promise<any | null> {
  if (!isFileSystemAccessSupported()) return null;
  const handle = await idbGet<any>(IDB_KEY_DIR);
  if (!handle) return null;

  // Vérifie les permissions ; en non-interactif (auto-backup en arrière-plan),
  // on n'ose pas appeler request() qui exige un geste utilisateur.
  let perm: PermissionState = 'prompt';
  if (typeof handle.queryPermission === 'function') {
    perm = await handle.queryPermission({ mode: 'readwrite' });
  }
  if (perm === 'granted') return handle;
  if (!interactive) return null;
  if (typeof handle.requestPermission === 'function') {
    perm = await handle.requestPermission({ mode: 'readwrite' });
  }
  return perm === 'granted' ? handle : null;
}

/** Écrit le payload dans le dossier. Réessaie silencieusement les erreurs de permission en mode non interactif. */
async function writeBackupToHandle(handle: any, filename: string, content: string): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

export interface BackupRunResult {
  ok: boolean;
  mode: 'directory' | 'download' | 'skipped';
  filename: string;
  error?: string;
}

/** Exécute une sauvegarde automatique. Si interactive=false, échoue
 *  silencieusement quand la permission n'est plus accordée. */
export async function runAutoBackup(interactive: boolean = false): Promise<BackupRunResult> {
  const filename = sanitizeFilename(getAutoBackupFilename());
  const payload = collectBackup();
  const content = serializeBackup(payload);

  try {
    const handle = await getBackupDirectoryHandle(interactive);
    if (handle) {
      await writeBackupToHandle(handle, filename, content);
      localStorage.setItem(BACKUP_CONFIG_KEYS.lastBackupAt, payload.createdAt);
      localStorage.removeItem(BACKUP_CONFIG_KEYS.lastBackupError);
      emitBackupStatus();
      return { ok: true, mode: 'directory', filename };
    }
    if (interactive) {
      // Pas de dossier configuré mais l'utilisateur a demandé explicitement
      // la sauvegarde : on retombe sur le téléchargement.
      downloadBackup(filename);
      localStorage.setItem(BACKUP_CONFIG_KEYS.lastBackupAt, payload.createdAt);
      localStorage.removeItem(BACKUP_CONFIG_KEYS.lastBackupError);
      emitBackupStatus();
      return { ok: true, mode: 'download', filename };
    }
    return { ok: false, mode: 'skipped', filename, error: 'Aucun dossier accessible' };
  } catch (e: any) {
    const msg = e?.message || String(e);
    localStorage.setItem(BACKUP_CONFIG_KEYS.lastBackupError, msg);
    emitBackupStatus();
    return { ok: false, mode: 'skipped', filename, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Watcher : déclenche l'auto-backup sur modifications locales
// ─────────────────────────────────────────────────────────────────────────

let autoBackupTimer: ReturnType<typeof setTimeout> | null = null;
let autoBackupStarted = false;
const AUTO_BACKUP_DEBOUNCE_MS = 4000;

function scheduleAutoBackup() {
  if (!isAutoBackupEnabled()) return;
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(() => {
    autoBackupTimer = null;
    // Non-interactif : si la permission est perdue, on ne dérange pas
    // l'utilisateur ; il verra l'erreur dans l'onglet Sauvegarde.
    void runAutoBackup(false);
  }, AUTO_BACKUP_DEBOUNCE_MS);
}

/** Déclenche immédiatement une tentative d'auto-backup (ignore le debounce). */
export function triggerAutoBackupNow() {
  if (autoBackupTimer) { clearTimeout(autoBackupTimer); autoBackupTimer = null; }
  void runAutoBackup(false);
}

/** À appeler une fois au démarrage : pose un hook sur localStorage et écoute
 *  les événements applicatifs pour programmer les sauvegardes automatiques. */
export function startAutoBackupWatcher() {
  if (autoBackupStarted) return;
  autoBackupStarted = true;

  // Monkey-patch non invasif de localStorage pour détecter les écritures
  // sur des clés surveillées. Les clés de config backup.* sont ignorées
  // pour éviter toute boucle.
  try {
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const origSet = proto.setItem;
    const origRemove = proto.removeItem;
    const emitFor = (key: string) => {
      if (!key) return;
      if (key.startsWith('backup.')) return;
      if (!isBackupableKey(key)) return;
      try { window.dispatchEvent(new CustomEvent(EVENT_LOCAL_CHANGED, { detail: { key } })); } catch { /* noop */ }
    };
    proto.setItem = function patchedSetItem(key: string, value: string) {
      const prev = this.getItem(key);
      origSet.call(this, key, value);
      if (prev !== value) emitFor(key);
    };
    proto.removeItem = function patchedRemoveItem(key: string) {
      const existed = this.getItem(key) !== null;
      origRemove.call(this, key);
      if (existed) emitFor(key);
    };
  } catch { /* noop */ }

  // Déclenchement au moindre changement de paramètre local.
  window.addEventListener(EVENT_LOCAL_CHANGED, scheduleAutoBackup);
  // Événements spécifiques déjà émis par l'app.
  window.addEventListener('mail.signatures.changed', scheduleAutoBackup);
  window.addEventListener('mail-categories-changed', scheduleAutoBackup);
  // Changements venant d'un autre onglet.
  window.addEventListener('storage', (e) => {
    if (e.key && isBackupableKey(e.key)) scheduleAutoBackup();
  });
  // Sauvegarde opportuniste avant fermeture de l'onglet.
  window.addEventListener('beforeunload', () => {
    if (isAutoBackupEnabled() && autoBackupTimer) {
      clearTimeout(autoBackupTimer);
      autoBackupTimer = null;
      // Pas d'await possible ici ; on tente sans attendre.
      void runAutoBackup(false);
    }
  });
}
