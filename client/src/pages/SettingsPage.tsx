import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useThemeStore, type ThemeMode } from '../stores/themeStore';
import { api } from '../api';
import { useAuthStore } from '../stores/authStore';
import { useUIStore } from '../stores/uiStore';
import {
  User, Mail, Lock, Palette, Globe, Bell, Plug,
  Eye, EyeOff, Save, SlidersHorizontal, HardDrive, Download, Upload,
  FolderOpen, CheckCircle2, AlertCircle, RefreshCw, Monitor, Smartphone, Tablet, Trash2,
  Fingerprint, ShieldCheck, Database, ArrowLeftRight, Folder,
  Coffee,
} from 'lucide-react';
import toast from 'react-hot-toast';
import CacheSettings from '../components/CacheSettings';
import { APP_VERSION } from '../utils/version';
import AutoResponderForm from '../components/mail/AutoResponderForm';
import FolderPickerDialog from '../components/mail/FolderPickerDialog';
import {
  getSwipePrefs, setSwipePrefs, getDeleteConfirmEnabled, setDeleteConfirmEnabled,
  getAutoLoadAllEnabled, setAutoLoadAllEnabled,
  setSwipeMoveTarget, setSwipeCopyTarget, type SwipeAction,
  getFabPosition, setFabPosition, type FabPosition,
  getFolderPaneFontSize, setFolderPaneFontSize,
  type FolderPaneFontSize, FOLDER_PANE_FONT_SIZE_LABELS, FOLDER_PANE_FONT_SIZE_PX,
  getNewMailPollMinutes, setNewMailPollMinutes, type NewMailPollMinutes,
  getRecentMoveFoldersCount, setRecentMoveFoldersCount,
  getRecentCopyFoldersCount, setRecentCopyFoldersCount,
  type RecentFoldersCount, RECENT_FOLDERS_CHANGED_EVENT,
  getUnreadIndicatorPrefs, setUnreadIndicatorPrefs,
  type UnreadIndicatorPrefs, type UnreadIndicatorScope,
  UNREAD_INDICATORS_CHANGED_EVENT, UNREAD_SCOPE_LABELS,
} from '../utils/mailPreferences';
import type { MailAccount, MailFolder } from '../types';
import {
  collectBackup, downloadBackup, parseBackupFile, applyBackup,
  isAutoBackupEnabled, setAutoBackupEnabled,
  getAutoBackupFilename, setAutoBackupFilename, sanitizeFilename,
  isFileSystemAccessSupported, pickBackupDirectory, hasBackupDirectory,
  clearBackupDirectory, getBackupDirLabel,
  getLastBackupAt, getLastBackupError, runAutoBackup, subscribeBackupStatus,
} from '../utils/backup';
import {
  isPrefsSyncEnabled, setPrefsSyncEnabled, getLastSyncAt as getLastPrefsSyncAt,
  getLastSyncError as getLastPrefsSyncError, triggerPrefsSyncNow, PREFS_SYNC_EVENT,
} from '../services/prefsSync';
import {
  getNotificationPrefs, setNotificationPrefs,
  type NotificationPrefs, type NotificationPlatform,
} from '../utils/notificationPrefs';
import NotificationPreferencesEditor from '../components/notifications/NotificationPreferencesEditor';

const TIMEZONES: { value: string; label: string }[] = [
  // Europe
  { value: 'Europe/Paris',      label: 'Paris (France, Belgique, Suisse) — UTC+1/+2' },
  { value: 'Europe/London',     label: 'Londres — UTC+0/+1' },
  { value: 'Europe/Madrid',     label: 'Madrid — UTC+1/+2' },
  { value: 'Europe/Zurich',     label: 'Zurich — UTC+1/+2' },
  { value: 'Europe/Berlin',     label: 'Berlin — UTC+1/+2' },
  { value: 'Europe/Amsterdam',  label: 'Amsterdam — UTC+1/+2' },
  { value: 'Europe/Rome',       label: 'Rome — UTC+1/+2' },
  { value: 'Europe/Lisbon',     label: 'Lisbonne — UTC+0/+1' },
  { value: 'Europe/Helsinki',   label: 'Helsinki — UTC+2/+3' },
  { value: 'Europe/Moscow',     label: 'Moscou — UTC+3' },
  // Amérique
  { value: 'America/New_York',    label: 'New York (Est) — UTC-5/-4' },
  { value: 'America/Chicago',     label: 'Chicago (Centre) — UTC-6/-5' },
  { value: 'America/Denver',      label: 'Denver (Montagne) — UTC-7/-6' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (Pacifique) — UTC-8/-7' },
  { value: 'America/Toronto',     label: 'Toronto / Montréal — UTC-5/-4' },
  { value: 'America/Vancouver',   label: 'Vancouver — UTC-8/-7' },
  { value: 'America/Sao_Paulo',   label: 'São Paulo — UTC-3' },
  // Asie / Pacifique
  { value: 'Asia/Dubai',       label: 'Dubaï — UTC+4' },
  { value: 'Asia/Kolkata',     label: 'New Delhi — UTC+5:30' },
  { value: 'Asia/Bangkok',     label: 'Bangkok — UTC+7' },
  { value: 'Asia/Shanghai',    label: 'Shanghai — UTC+8' },
  { value: 'Asia/Tokyo',       label: 'Tokyo — UTC+9' },
  { value: 'Australia/Sydney', label: 'Sydney — UTC+10/+11' },
  { value: 'Pacific/Auckland', label: 'Auckland — UTC+12/+13' },
  { value: 'UTC',              label: 'UTC (Temps universel coordonné)' },
];

export function getUserTimezone(): string {
  try { return localStorage.getItem('user.timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'; }
  catch { return 'Europe/Paris'; }
}

type Tab = 'profile' | 'accounts' | 'mail' | 'autoresponder' | 'appearance' | 'notifications' | 'backup' | 'devices' | 'security' | 'cache';

export default function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('profile');
  // On mobile/tablet (< md), `mobileDetail` toggles between the list of
  // sections (false) and the selected section's content (true). On desktop
  // both are visible at the same time so the flag is ignored.
  const [mobileDetail, setMobileDetail] = useState(false);
  // The shared header hamburger increments this counter — toggle the master
  // list on each press so the user can come back to it from anywhere.
  const mobileSidebarSignal = useUIStore((s) => s.mobileSidebarSignal);
  const firstSignal = useRef(mobileSidebarSignal);
  useEffect(() => {
    if (mobileSidebarSignal === firstSignal.current) return;
    setMobileDetail((v) => !v);
  }, [mobileSidebarSignal]);

  const { data: arFeature } = useQuery({
    queryKey: ['auto-responder-feature-settings'],
    queryFn: api.getAutoResponderFeatureSettings,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const autoResponderFeatureEnabled = arFeature?.enabled !== false;

  const tabs = [
    { id: 'profile' as const,      icon: User,              label: t('settings.tab.profile'),      group: t('settings.group.account') },
    { id: 'accounts' as const,     icon: Mail,              label: t('settings.tab.accounts'),     group: t('settings.group.account') },
    { id: 'mail' as const,         icon: SlidersHorizontal, label: t('settings.tab.mail'),         group: t('settings.group.mail') },
    ...(autoResponderFeatureEnabled
      ? [{ id: 'autoresponder' as const, icon: Coffee, label: t('settings.tab.autoresponder'), group: t('settings.group.mail') }]
      : []),
    { id: 'appearance' as const,   icon: Palette,           label: t('settings.tab.appearance'),   group: t('settings.group.interface') },
    { id: 'notifications' as const,icon: Bell,              label: t('settings.tab.notifications'),group: t('settings.group.interface') },
    { id: 'security' as const,     icon: ShieldCheck,       label: t('settings.tab.security'),     group: t('settings.group.security') },
    { id: 'devices' as const,      icon: Monitor,           label: t('settings.tab.devices'),      group: t('settings.group.security') },
    { id: 'backup' as const,       icon: HardDrive,         label: t('settings.tab.backup'),       group: t('settings.group.data') },
    { id: 'cache' as const,        icon: Database,          label: t('settings.tab.cache'),        group: t('settings.group.data') },
  ];

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Mobile/tablet vertical list (master view) — full width when no
          section is selected. Hidden once the user picks one (the hamburger
          icon at the top of the detail brings it back). */}
      <div
        className={`md:hidden ${mobileDetail ? 'hidden' : 'flex'} flex-col flex-1 overflow-y-auto bg-outlook-bg-primary`}
      >
        <h2 className="text-lg font-semibold px-4 pt-4 pb-2 text-outlook-text-primary">{t('settings.title')}</h2>
        {tabs.map((tabItem, index) => {
          const Icon = tabItem.icon;
          const prevGroup = index > 0 ? tabs[index - 1].group : undefined;
          return (
            <div key={tabItem.id}>
              {tabItem.group !== prevGroup && (
                <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-outlook-text-disabled">
                  {tabItem.group}
                </div>
              )}
              <button
                onClick={() => { setTab(tabItem.id); setMobileDetail(true); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm border-b border-outlook-border transition-colors
                  ${tab === tabItem.id ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
              >
                <Icon size={18} /> {tabItem.label}
              </button>
            </div>
          );
        })}
        <div className="mt-auto px-4 py-3 text-[10px] text-outlook-text-disabled border-t border-outlook-border">
          v{APP_VERSION}
        </div>
      </div>

      {/* Desktop sidebar */}
      <div className="hidden md:block w-60 border-r border-outlook-border bg-outlook-bg-primary flex-shrink-0 py-4 overflow-y-auto flex flex-col">
        <h2 className="text-lg font-semibold px-4 mb-4 text-outlook-text-primary">{t('settings.title')}</h2>
        <div className="flex-1">
          {tabs.map((tabItem, index) => {
            const Icon = tabItem.icon;
            const prevGroup = index > 0 ? tabs[index - 1].group : undefined;
            return (
              <div key={tabItem.id}>
                {tabItem.group !== prevGroup && (
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-outlook-text-disabled">
                    {tabItem.group}
                  </div>
                )}
                <button
                  onClick={() => setTab(tabItem.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors
                    ${tab === tabItem.id ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary border-l-2 border-l-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
                >
                  <Icon size={16} /> {tabItem.label}
                </button>
              </div>
            );
          })}
        </div>
        <div className="px-4 pt-3 pb-2 text-[10px] text-outlook-text-disabled border-t border-outlook-border mt-4">
          v{APP_VERSION}
        </div>
      </div>

      {/* Content (detail view). Hidden on mobile until the user picks a
          section — then it takes the whole screen. Always visible on desktop.
          The header hamburger in <Layout> brings the master list back. */}
      <div
        className={`flex-1 ${mobileDetail ? 'flex' : 'hidden'} md:flex flex-col min-h-0`}
      >
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          <div className="max-w-2xl">
            {tab === 'profile' && <ProfileSettings />}
            {tab === 'accounts' && <AccountSettings />}
            {tab === 'mail' && <MailBehaviorSettings />}
            {tab === 'autoresponder' && <AutoResponderSettings />}
            {tab === 'appearance' && <AppearanceSettings />}
            {tab === 'notifications' && <NotificationSettings />}
            {tab === 'cache' && <CacheSettings />}
            {tab === 'devices' && <DevicesSettings />}
            {tab === 'security' && <SecuritySettings />}
            {tab === 'backup' && <BackupSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

function MailBehaviorSettings() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  });

  const [attachmentActionMode, setAttachmentActionMode] = useState<'preview' | 'download' | 'menu'>('preview');

  const updateMutation = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => toast.success('Préférences de messagerie sauvegardées'),
    onError: (e: any) => toast.error(e.message),
  });

  useEffect(() => {
    const mode = settings?.attachment_action_mode;
    if (mode === 'preview' || mode === 'download' || mode === 'menu') {
      setAttachmentActionMode(mode);
    }
  }, [settings?.attachment_action_mode]);

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Messagerie</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-outlook-text-secondary">Ouverture des pièces jointes</label>
          <select
            value={attachmentActionMode}
            onChange={(e) => setAttachmentActionMode(e.target.value as 'preview' | 'download' | 'menu')}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          >
            <option value="preview">Aperçu</option>
            <option value="download">Téléchargement</option>
            <option value="menu">Menu (Aperçu / Télécharger)</option>
          </select>
          <p className="text-xs text-outlook-text-disabled mt-1">
            Cette préférence est identique à l'option du ruban Afficher &gt; Pièce jointe.
          </p>
        </div>

        <div>
          <button
            onClick={() => updateMutation.mutate({ attachmentActionMode })}
            disabled={updateMutation.isPending}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={14} />
            {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <SwipeSettings />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balayage (swipe) sur mobile / tablette
// ---------------------------------------------------------------------------
const SWIPE_ACTIONS: { value: SwipeAction; label: string }[] = [
  { value: 'none',    label: 'Aucune action' },
  { value: 'archive', label: 'Archiver' },
  { value: 'trash',   label: 'Mettre à la corbeille' },
  { value: 'move',    label: 'Déplacer vers un dossier' },
  { value: 'copy',    label: 'Copier vers un dossier' },
  { value: 'flag',    label: 'Drapeau / Favori' },
  { value: 'read',    label: 'Marquer lu / non lu' },
];

function SwipeSettings() {
  const [prefs, setPrefs] = useState(() => getSwipePrefs());
  const [deleteConfirm, setDeleteConfirmLocal] = useState(() => getDeleteConfirmEnabled());
  const [autoLoadAll, setAutoLoadAllLocal] = useState(() => getAutoLoadAllEnabled());

  const { data: accounts = [] } = useQuery<MailAccount[]>({
    queryKey: ['mail-accounts'],
    queryFn: api.getAccounts,
  });

  // Fetch folders lazily per account, only when the user opens the picker —
  // keeps the settings page light when the user has many accounts.
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState<
    | { accountId: string; kind: 'move' | 'copy'; folders: MailFolder[]; initial: string | null }
    | null
  >(null);

  const persist = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setSwipePrefs(next);
    window.dispatchEvent(new Event('mail-swipe-prefs-changed'));
  };

  const openPicker = async (accountId: string, kind: 'move' | 'copy') => {
    let folders = queryClient.getQueryData<MailFolder[]>(['folders', accountId]);
    if (!folders) {
      try {
        folders = await queryClient.fetchQuery({
          queryKey: ['folders', accountId],
          queryFn: () => api.getFolders(accountId),
        });
      } catch (e: any) {
        toast.error(e?.message || 'Impossible de charger les dossiers');
        return;
      }
    }
    const initial = (kind === 'move' ? prefs.moveTargets : prefs.copyTargets)[accountId] || null;
    setPicker({ accountId, kind, folders: folders || [], initial });
  };

  const createFolderAwait = async (accountId: string, name: string): Promise<string | null> => {
    try {
      const sanitized = name.trim().replace(/[\\\/]/g, '');
      if (!sanitized) return null;
      await api.createFolder(accountId, sanitized);
      await queryClient.invalidateQueries({ queryKey: ['folders', accountId] });
      const fresh = await queryClient.fetchQuery({
        queryKey: ['folders', accountId],
        queryFn: () => api.getFolders(accountId),
      });
      if (picker) setPicker({ ...picker, folders: fresh });
      toast.success('Dossier créé');
      return fresh.find((f) => f.path === sanitized || f.name === sanitized)?.path ?? sanitized;
    } catch (e: any) {
      toast.error(e?.message || 'Erreur lors de la création du dossier');
      return null;
    }
  };

  const needsMoveTargets = prefs.leftAction === 'move' || prefs.rightAction === 'move';
  const needsCopyTargets = prefs.leftAction === 'copy' || prefs.rightAction === 'copy';

  return (
    <div className="mt-8 border-t border-outlook-border pt-6 space-y-5">
      <div>
        <h4 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
          <ArrowLeftRight size={14} />
          Balayage sur mobile et tablette
        </h4>
        <p className="text-xs text-outlook-text-secondary mt-1">
          Sur un écran tactile (téléphone ou tablette), faites glisser un e-mail vers la
          gauche ou vers la droite pour déclencher une action rapide. Sans effet sur ordinateur.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => persist({ enabled: e.target.checked })}
          className="w-4 h-4"
        />
        Activer le balayage
      </label>

      <div className={`grid sm:grid-cols-2 gap-4 ${prefs.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <div>
          <label className="text-sm text-outlook-text-secondary">Glissement vers la gauche</label>
          <select
            value={prefs.leftAction}
            onChange={(e) => persist({ leftAction: e.target.value as SwipeAction })}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          >
            {SWIPE_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-outlook-text-disabled mt-1">Par défaut : Archiver</p>
        </div>

        <div>
          <label className="text-sm text-outlook-text-secondary">Glissement vers la droite</label>
          <select
            value={prefs.rightAction}
            onChange={(e) => persist({ rightAction: e.target.value as SwipeAction })}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          >
            {SWIPE_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-outlook-text-disabled mt-1">Par défaut : Corbeille</p>
        </div>
      </div>

      {/* Confirmation de mise en corbeille (partagée avec le ruban). */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={deleteConfirm}
          onChange={(e) => { setDeleteConfirmLocal(e.target.checked); setDeleteConfirmEnabled(e.target.checked); }}
          className="w-4 h-4 mt-0.5"
        />
        <span>
          Demander confirmation avant de mettre à la corbeille
          <span className="block text-[11px] text-outlook-text-disabled">
            Désactivez cette option pour nettoyer vos mails très rapidement d'une seule main.
            (Cette préférence s'applique aussi au ruban et au menu contextuel.)
          </span>
        </span>
      </label>

      {/* Auto-load all messages — bypass the 50-messages-per-page limit on
          every folder so client-side search covers the entire mailbox. */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoLoadAll}
          onChange={(e) => {
            const next = e.target.checked;
            setAutoLoadAllLocal(next);
            setAutoLoadAllEnabled(next);
            toast.success(next
              ? 'Chargement automatique activé — les dossiers seront paginés jusqu\'à la fin'
              : 'Chargement automatique désactivé');
          }}
          className="w-4 h-4 mt-0.5"
        />
        <span>
          Charger automatiquement <strong>tous</strong> les messages de chaque dossier
          <span className="block text-[11px] text-outlook-text-disabled">
            Active la pagination automatique jusqu'à la fin du dossier dès son ouverture.
            La recherche locale couvre alors l'intégralité de la boîte mail (toutes les années,
            tous les dossiers) au lieu de la première page seulement. Désactivez si vous préférez
            le bouton manuel <em>Charger plus / Tout charger</em> au bas de la liste.
          </span>
        </span>
      </label>

      <RecentFoldersPicker />

      {/* Dossiers par défaut pour Déplacer / Copier — un par compte. */}
      {(needsMoveTargets || needsCopyTargets) && prefs.enabled && (
        <div className="border border-outlook-border rounded-md p-3 space-y-3">
          <div>
            <div className="text-sm font-medium text-outlook-text-primary">Dossiers de destination par défaut</div>
            <p className="text-[11px] text-outlook-text-secondary mt-0.5">
              Définissez un dossier cible par compte pour que le balayage l'exécute sans
              confirmation. Si aucun dossier n'est choisi, un sélecteur apparaîtra au moment
              du balayage (vous pourrez aussi en créer un nouveau, par exemple « À trier »).
            </p>
          </div>

          {accounts.length === 0 ? (
            <div className="text-xs text-outlook-text-disabled">Aucun compte mail configuré.</div>
          ) : accounts.map((acc) => (
            <div key={acc.id} className="border-t border-outlook-border pt-3 first:border-t-0 first:pt-0">
              <div className="text-xs font-medium text-outlook-text-primary mb-1">{acc.name || acc.email}</div>
              <div className="flex flex-col sm:flex-row gap-2">
                {needsMoveTargets && (
                  <FolderTargetRow
                    label="Déplacer"
                    path={prefs.moveTargets[acc.id]}
                    onPick={() => openPicker(acc.id, 'move')}
                    onClear={() => { setSwipeMoveTarget(acc.id, null); setPrefs(getSwipePrefs()); }}
                  />
                )}
                {needsCopyTargets && (
                  <FolderTargetRow
                    label="Copier"
                    path={prefs.copyTargets[acc.id]}
                    onPick={() => openPicker(acc.id, 'copy')}
                    onClear={() => { setSwipeCopyTarget(acc.id, null); setPrefs(getSwipePrefs()); }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <FolderPickerDialog
        open={!!picker}
        title={picker?.kind === 'move' ? 'Dossier pour « Déplacer »' : 'Dossier pour « Copier »'}
        description="Sélectionnez ou créez le dossier qui sera utilisé lors du balayage pour ce compte."
        confirmLabel="Définir par défaut"
        folders={picker?.folders || []}
        accountId={picker?.accountId}
        initialPath={picker?.initial ?? null}
        onCreate={createFolderAwait}
        onPick={(path) => {
          if (!picker) return;
          if (picker.kind === 'move') setSwipeMoveTarget(picker.accountId, path);
          else setSwipeCopyTarget(picker.accountId, path);
          setPrefs(getSwipePrefs());
          window.dispatchEvent(new Event('mail-swipe-prefs-changed'));
          setPicker(null);
          toast.success('Dossier par défaut enregistré');
        }}
        onCancel={() => setPicker(null)}
      />
    </div>
  );
}

function FolderTargetRow({
  label, path, onPick, onClear,
}: {
  label: string;
  path: string | undefined;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
      <span className="text-outlook-text-secondary w-16 flex-shrink-0">{label}</span>
      <button
        onClick={onPick}
        className="flex-1 flex items-center gap-1.5 min-w-0 px-2 py-1.5 border border-outlook-border rounded-md text-left hover:bg-outlook-bg-hover"
      >
        <Folder size={14} className="flex-shrink-0 text-outlook-text-secondary" />
        <span className="truncate">{path || <em className="text-outlook-text-disabled not-italic">Demander à chaque balayage</em>}</span>
      </button>
      {path && (
        <button
          onClick={onClear}
          className="text-xs text-outlook-text-secondary hover:text-red-600 px-1"
          title="Effacer"
        >
          ×
        </button>
      )}
    </div>
  );
}

function ProfileSettings() {
  const { user, updateUser } = useAuthStore();
  const { i18n } = useTranslation();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem('user.language') || i18n.language || 'fr'; } catch { return 'fr'; }
  });
  const [timezone, setTimezone] = useState(() => getUserTimezone());

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.updateSettings(data),
    onSuccess: () => {
      updateUser({ displayName });
      toast.success('Profil mis à jour');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Mot de passe modifié');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    try { localStorage.setItem('user.language', lang); } catch {}
    toast.success(lang === 'fr' ? 'Langue changée en Français' : 'Language changed to English');
  };

  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    try { localStorage.setItem('user.timezone', tz); } catch {}
    toast.success('Fuseau horaire mis à jour');
  };

  const passwordStrength = (() => {
    if (!newPassword) return null;
    if (newPassword.length < 8) return { level: 0, label: 'Trop court (min. 8 caractères)', color: 'bg-red-500' };
    const score = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(r => r.test(newPassword)).length;
    if (score <= 1) return { level: 1, label: 'Faible', color: 'bg-red-400' };
    if (score === 2) return { level: 2, label: 'Moyen', color: 'bg-amber-400' };
    if (score === 3) return { level: 3, label: 'Fort', color: 'bg-green-400' };
    return { level: 4, label: 'Très fort', color: 'bg-green-600' };
  })();

  return (
    <div className="space-y-6">
      {/* Informations du compte */}
      <section>
        <h3 className="text-base font-semibold mb-3">Informations du compte</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-outlook-text-secondary">Nom d'affichage</label>
            <input
              type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 focus:outline-none focus:border-outlook-blue"
            />
          </div>
          <div>
            <label className="text-sm text-outlook-text-secondary">Adresse e-mail</label>
            <input type="email" value={user?.email || ''} disabled
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 bg-outlook-bg-hover text-outlook-text-disabled cursor-not-allowed" />
            <p className="text-xs text-outlook-text-disabled mt-1">L'adresse e-mail est gérée par l'administrateur.</p>
          </div>
          <button
            onClick={() => updateMutation.mutate({ displayName })}
            disabled={updateMutation.isPending}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={14} /> {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </section>

      {/* Préférences régionales */}
      <section className="border-t border-outlook-border pt-6">
        <h3 className="text-base font-semibold mb-1">Préférences régionales</h3>
        <p className="text-sm text-outlook-text-secondary mb-4">
          Ces paramètres s'appliquent immédiatement et sont conservés entre les sessions sur cet appareil.
        </p>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-outlook-text-primary block mb-1">
              <Globe size={14} className="inline mr-1.5 -mt-0.5" />
              Langue de l'interface
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'fr', label: 'Français', flag: '🇫🇷' },
                { value: 'en', label: 'English',  flag: '🇬🇧' },
              ] as const).map(({ value, label, flag }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleLanguageChange(value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm transition-colors ${
                    language === value
                      ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue font-medium'
                      : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-primary'
                  }`}
                >
                  <span className="text-base">{flag}</span>
                  {label}
                  {language === value && <CheckCircle2 size={14} className="ml-auto text-outlook-blue" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-outlook-text-primary block mb-1">
              Fuseau horaire
            </label>
            <select
              value={timezone}
              onChange={(e) => handleTimezoneChange(e.target.value)}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            <p className="text-xs text-outlook-text-disabled mt-1">
              Fuseau détecté par le navigateur : <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong>
            </p>
          </div>
        </div>
      </section>

      {/* Changer le mot de passe */}
      <section className="border-t border-outlook-border pt-6">
        <h3 className="text-base font-semibold mb-3">Changer le mot de passe</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-outlook-text-secondary">Mot de passe actuel</label>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm pr-10 focus:outline-none focus:border-outlook-blue"
              />
              <button onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-outlook-text-disabled">
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm text-outlook-text-secondary">Nouveau mot de passe</label>
            <input
              type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 focus:outline-none focus:border-outlook-blue"
            />
            {passwordStrength && (
              <div className="mt-1.5">
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= passwordStrength.level ? passwordStrength.color : 'bg-outlook-border'}`} />
                  ))}
                </div>
                <span className="text-xs text-outlook-text-disabled">{passwordStrength.label}</span>
              </div>
            )}
          </div>
          <div>
            <label className="text-sm text-outlook-text-secondary">Confirmer le nouveau mot de passe</label>
            <input
              type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full border rounded-md px-3 py-2 text-sm mt-1 focus:outline-none focus:border-outlook-blue ${
                confirmPassword && confirmPassword !== newPassword ? 'border-red-400' : 'border-outlook-border'
              }`}
            />
            {confirmPassword && confirmPassword !== newPassword && (
              <p className="text-xs text-red-500 mt-1">Les mots de passe ne correspondent pas.</p>
            )}
          </div>
          <button
            onClick={() => passwordMutation.mutate()}
            disabled={!currentPassword || !newPassword || newPassword.length < 8 || newPassword !== confirmPassword || passwordMutation.isPending}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <Lock size={14} /> {passwordMutation.isPending ? 'Modification…' : 'Modifier le mot de passe'}
          </button>
        </div>
      </section>
    </div>
  );
}

function AutoResponderSettings() {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: api.getAccounts,
  });

  if (accounts.length === 0) {
    return (
      <div className="p-4 text-sm text-outlook-text-secondary">
        Ajoutez d'abord une boîte mail dans « Mes boîtes mail » pour configurer un répondeur automatique.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-outlook-text-primary">Répondeur automatique</h3>
      <AutoResponderForm accounts={accounts as any} compact />
    </div>
  );
}

function AccountSettings() {
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: api.getAccounts,
  });

  const PERM_LABELS: Record<string, string> = {
    none: 'Lecture seule',
    send_as: 'Envoyer de (send as)',
    send_on_behalf: 'Envoyer de la part de',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Mes boîtes mail</h3>
      </div>
      <p className="text-sm text-outlook-text-secondary mb-4">
        Les comptes mail sont gérés par l'administrateur. Contactez-le pour modifier vos accès.
      </p>

      <div className="space-y-3">
        {accounts.map((account: any) => (
          <div key={account.id} className="border border-outlook-border rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: account.color }} />
              <div>
                <div className="font-medium text-sm">{account.assigned_display_name || account.name}</div>
                <div className="text-xs text-outlook-text-secondary">{account.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {account.assigned_default && (
                <span className="text-xs bg-outlook-blue/10 text-outlook-blue px-2 py-0.5 rounded">Par défaut</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded ${
                account.send_permission === 'send_as' ? 'bg-green-50 text-green-700' :
                account.send_permission === 'send_on_behalf' ? 'bg-orange-50 text-orange-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {PERM_LABELS[account.send_permission] || 'Lecture seule'}
              </span>
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun compte mail attribué</div>
        )}
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const { mode, setMode } = useThemeStore();

  const themes: { value: ThemeMode; label: string; hint: string }[] = [
    { value: 'light',  label: 'Clair',   hint: 'Fond blanc, texte sombre.' },
    { value: 'dark',   label: 'Sombre',  hint: 'Fond sombre, texte clair.' },
    { value: 'system', label: 'Système', hint: 'Suit automatiquement les préférences du système d\'exploitation.' },
  ];

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Apparence</h3>
      <div className="space-y-6">

        {/* Thème */}
        <div>
          <label className="text-sm font-medium text-outlook-text-primary block mb-2">Thème de l'interface</label>
          <div className="grid grid-cols-3 gap-2">
            {themes.map(({ value, label, hint }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setMode(value); toast.success(`Thème ${label.toLowerCase()} activé`); }}
                className={`flex flex-col items-start p-3 rounded-md border text-left transition-colors ${
                  mode === value
                    ? 'border-outlook-blue bg-outlook-blue/10'
                    : 'border-outlook-border hover:bg-outlook-bg-hover'
                }`}
              >
                <span className={`text-sm font-medium ${mode === value ? 'text-outlook-blue' : 'text-outlook-text-primary'}`}>{label}</span>
                <span className="text-[11px] text-outlook-text-disabled mt-0.5 leading-tight">{hint}</span>
                {mode === value && <CheckCircle2 size={12} className="text-outlook-blue mt-1.5" />}
              </button>
            ))}
          </div>
          <p className="text-xs text-outlook-text-disabled mt-2">
            La langue et le fuseau horaire se configurent dans l'onglet <strong>Profil</strong>.
          </p>
        </div>

        {/* Mise en page mobile */}
        <div className="border-t border-outlook-border pt-4">
          <label className="text-sm font-medium text-outlook-text-primary block mb-1">Mise en page mobile</label>
          <p className="text-xs text-outlook-text-disabled mb-3">Options visuelles pour les écrans tactiles (téléphone et tablette).</p>
          <FabPositionPicker />
        </div>

        {/* Densité / lisibilité */}
        <div className="border-t border-outlook-border pt-4">
          <label className="text-sm font-medium text-outlook-text-primary block mb-1">Lisibilité</label>
          <p className="text-xs text-outlook-text-disabled mb-3">Taille du texte dans le volet des dossiers et indicateurs de messages non lus.</p>
          <div className="space-y-5">
            <FolderPaneFontSizePicker />
            <UnreadIndicatorsPicker />
          </div>
        </div>

      </div>
    </div>
  );
}

// 9-cell radio grid letting the user pick where the floating action button
// (Nouveau message / Nouvel événement) should appear on mobile and tablet.
function FabPositionPicker() {
  const [pos, setPos] = useState<FabPosition>(() => getFabPosition());
  const cells: FabPosition[] = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'middle-center', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ];
  const labels: Record<FabPosition, string> = {
    'top-left': 'Haut gauche', 'top-center': 'Haut centre', 'top-right': 'Haut droite',
    'middle-left': 'Milieu gauche', 'middle-center': 'Milieu centre', 'middle-right': 'Milieu droite',
    'bottom-left': 'Bas gauche', 'bottom-center': 'Bas centre', 'bottom-right': 'Bas droite',
  };
  const choose = (p: FabPosition) => {
    setPos(p);
    setFabPosition(p);
    toast.success('Position du bouton mise à jour');
  };
  return (
    <div>
      <label className="text-sm text-outlook-text-secondary block">
        Position du bouton flottant (mobile / tablette)
      </label>
      <p className="text-xs text-outlook-text-disabled mt-1 mb-2">
        Bouton « Nouveau message » et « Nouvel événement » sur mobile et tablette.
      </p>
      <div className="grid grid-cols-3 gap-2 max-w-xs">
        {cells.map((cell) => {
          const active = pos === cell;
          return (
            <button
              key={cell}
              type="button"
              onClick={() => choose(cell)}
              title={labels[cell]}
              className={`relative aspect-square border rounded-md flex items-center justify-center transition-colors ${
                active
                  ? 'border-outlook-blue bg-outlook-blue/10'
                  : 'border-outlook-border hover:bg-outlook-bg-hover'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full ${active ? 'bg-outlook-blue' : 'bg-outlook-text-disabled/40'}`}
              />
            </button>
          );
        })}
      </div>
      <p className="text-xs text-outlook-text-secondary mt-2">{labels[pos]}</p>
    </div>
  );
}

// Lets the user pick the font size of the mailbox/folder tree (FolderPane).
// Helpful on small screens or for users who prefer larger touch targets.
// Mirrored on desktop in the "Afficher" ribbon.
function FolderPaneFontSizePicker() {
  const [size, setSize] = useState<FolderPaneFontSize>(() => getFolderPaneFontSize());
  const sizes: FolderPaneFontSize[] = ['sm', 'md', 'lg', 'xl'];
  const choose = (s: FolderPaneFontSize) => {
    setSize(s);
    setFolderPaneFontSize(s);
    toast.success('Taille de la liste mise à jour');
  };
  return (
    <div>
      <label className="text-sm text-outlook-text-secondary block">
        Taille du texte de la liste des boîtes mail
      </label>
      <p className="text-xs text-outlook-text-disabled mt-1 mb-2">
        S'applique au volet « Dossiers » (comptes, favoris, boîtes IMAP). Pratique sur petit écran ou pour un usage tactile.
      </p>
      <div className="flex flex-wrap gap-2">
        {sizes.map((s) => {
          const active = size === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => choose(s)}
              className={`px-3 py-2 rounded-md border transition-colors flex items-center gap-2 min-h-[44px] ${
                active
                  ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue'
                  : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-primary'
              }`}
              style={{ fontSize: `${FOLDER_PANE_FONT_SIZE_PX[s]}px` }}
              title={`${FOLDER_PANE_FONT_SIZE_LABELS[s]} (${FOLDER_PANE_FONT_SIZE_PX[s]} px)`}
            >
              <span>Aa</span>
              <span className="text-xs">{FOLDER_PANE_FONT_SIZE_LABELS[s]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Lets the user choose how unread mails are indicated in the folder list:
// count at the end of the name (default), bold name, red dot — independent
// toggles. Also lets the user limit the indicators to a subset of folders
// (inbox only, favorites only, both, or all). Mirrored on desktop in the
// "Afficher" ribbon under "Non lus".
function UnreadIndicatorsPicker() {
  const [prefs, setPrefs] = useState<UnreadIndicatorPrefs>(() => getUnreadIndicatorPrefs());
  useEffect(() => {
    const handler = () => setPrefs(getUnreadIndicatorPrefs());
    window.addEventListener(UNREAD_INDICATORS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(UNREAD_INDICATORS_CHANGED_EVENT, handler);
  }, []);
  const update = (patch: Partial<UnreadIndicatorPrefs>) => {
    setUnreadIndicatorPrefs(patch);
    setPrefs((p) => ({ ...p, ...patch }));
    toast.success('Affichage des non lus mis à jour');
  };
  const toggles: { id: keyof Pick<UnreadIndicatorPrefs, 'showCount' | 'showBold' | 'showDot'>; label: string; hint: string }[] = [
    { id: 'showCount', label: 'Afficher le nombre à la fin du nom', hint: 'Comportement par défaut, identique à Outlook : « Boîte de réception (12) ».' },
    { id: 'showBold', label: 'Mettre le nom en gras', hint: 'Met en évidence les dossiers contenant des mails non lus.' },
    { id: 'showDot', label: 'Afficher une pastille rouge', hint: 'Petit point rouge à côté du nom.' },
  ];
  const scopes: UnreadIndicatorScope[] = ['inbox-only', 'favorites-only', 'inbox-and-favorites', 'all-folders'];
  return (
    <div>
      <label className="text-sm text-outlook-text-secondary block">
        Mails non lus — affichage dans la liste des dossiers
      </label>
      <p className="text-xs text-outlook-text-disabled mt-1 mb-2">
        Choisissez comment signaler la présence de mails non lus dans le volet
        « Dossiers ». Les trois indicateurs sont indépendants et peuvent être
        combinés.
      </p>
      <div className="space-y-2">
        {toggles.map((t) => {
          const active = prefs[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => update({ [t.id]: !active } as Partial<UnreadIndicatorPrefs>)}
              className={`w-full text-left px-3 py-2 rounded-md border transition-colors flex items-start gap-2 ${
                active
                  ? 'border-outlook-blue bg-outlook-blue/10'
                  : 'border-outlook-border hover:bg-outlook-bg-hover'
              }`}
            >
              <span className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 border rounded text-[11px] ${active ? 'bg-outlook-blue border-outlook-blue text-white' : 'border-outlook-border'}`}>
                {active ? '✓' : ''}
              </span>
              <span className="flex flex-col">
                <span className="text-sm text-outlook-text-primary">{t.label}</span>
                <span className="text-[11px] text-outlook-text-disabled">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3">
        <label className="text-xs text-outlook-text-secondary block mb-1">
          Appliquer aux dossiers
        </label>
        <div className="flex flex-wrap gap-2">
          {scopes.map((scope) => {
            const active = prefs.scope === scope;
            return (
              <button
                key={scope}
                type="button"
                onClick={() => update({ scope })}
                className={`px-3 py-2 rounded-md border text-sm transition-colors min-h-[40px] ${
                  active
                    ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue'
                    : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-primary'
                }`}
              >
                {UNREAD_SCOPE_LABELS[scope]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Lets the user enable a "recent folders" shortcut at the top of the
// "Déplacer" and "Copier" context-menu submenus, and pick how many entries
// to keep visible (0 = disabled, up to 3). Mirrored on desktop in the
// "Afficher" ribbon.
function RecentFoldersPicker() {
  const [moveCount, setMoveCount] = useState<RecentFoldersCount>(() => getRecentMoveFoldersCount());
  const [copyCount, setCopyCount] = useState<RecentFoldersCount>(() => getRecentCopyFoldersCount());

  useEffect(() => {
    const handler = () => {
      setMoveCount(getRecentMoveFoldersCount());
      setCopyCount(getRecentCopyFoldersCount());
    };
    window.addEventListener(RECENT_FOLDERS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(RECENT_FOLDERS_CHANGED_EVENT, handler);
  }, []);

  const counts: RecentFoldersCount[] = [0, 1, 2, 3];
  const updateMove = (n: RecentFoldersCount) => {
    setMoveCount(n);
    setRecentMoveFoldersCount(n);
    toast.success(n === 0
      ? 'Raccourci « Déplacer » désactivé'
      : `Raccourci « Déplacer » : ${n} dossier${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}`);
  };
  const updateCopy = (n: RecentFoldersCount) => {
    setCopyCount(n);
    setRecentCopyFoldersCount(n);
    toast.success(n === 0
      ? 'Raccourci « Copier » désactivé'
      : `Raccourci « Copier » : ${n} dossier${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}`);
  };

  const renderRow = (
    label: string,
    count: RecentFoldersCount,
    onChange: (n: RecentFoldersCount) => void,
  ) => (
    <div className="flex items-center gap-3">
      <span className="text-sm w-20 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1">
        {counts.map((n) => {
          const active = count === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className={`flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors ${
                active
                  ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue font-medium'
                  : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-primary'
              }`}
              title={n === 0 ? 'Désactivé' : `${n} dossier${n > 1 ? 's' : ''} récent${n > 1 ? 's' : ''}`}
            >
              {n === 0 ? 'Désactivé' : n}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="border border-outlook-border rounded-md p-3 space-y-3">
      <div>
        <div className="text-sm font-medium">Dossiers récents (Déplacer / Copier)</div>
        <p className="text-[11px] text-outlook-text-disabled mt-0.5">
          Affiche les derniers dossiers utilisés en haut des sous-menus contextuels
          « Déplacer » et « Copier », juste sous la barre de recherche, pour
          re-sélectionner rapidement la même destination. Réglez 0 pour désactiver
          le raccourci sur l'une ou l'autre des actions.
        </p>
      </div>
      {renderRow('Déplacer', moveCount, updateMove)}
      {renderRow('Copier', copyCount, updateCopy)}
    </div>
  );
}

function NotificationSettings() {
  const [supported] = useState(() =>
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [sound, setSound] = useState<boolean>(() => localStorage.getItem('notifications.sound') !== 'false');
  const [calendar, setCalendar] = useState<boolean>(() => localStorage.getItem('notifications.calendar') !== 'false');
  const [pollMinutes, setPollMinutes] = useState<NewMailPollMinutes>(() => getNewMailPollMinutes());

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getExistingSubscription } = await import('../pwa/push');
        const sub = await getExistingSubscription();
        if (mounted) setSubscribed(!!sub);
      } catch {
        /* ignore */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    localStorage.setItem('notifications.sound', String(sound));
  }, [sound]);
  useEffect(() => {
    localStorage.setItem('notifications.calendar', String(calendar));
  }, [calendar]);

  const toggle = async () => {
    try {
      const mod = await import('../pwa/push');
      if (subscribed) {
        await mod.unsubscribeFromPush();
        setSubscribed(false);
        toast.success('Notifications push désactivées');
      } else {
        await mod.subscribeToPush();
        setSubscribed(true);
        setPermission(Notification.permission);
        toast.success('Notifications push activées');
      }
    } catch (e: any) {
      toast.error(e.message || 'Échec de la mise à jour');
    }
  };

  const test = async () => {
    try {
      const { sendTestPush } = await import('../pwa/push');
      const sent = await sendTestPush();
      toast.success(sent > 0
        ? `Notification envoyée à ${sent} appareil${sent > 1 ? 's' : ''}`
        : 'Aucun appareil enregistré');
    } catch (e: any) {
      toast.error(e.message || 'Échec du test');
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-3">Notifications</h3>

      {!supported && (
        <div className="mb-4 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
          Votre navigateur ne prend pas en charge les notifications push natives.
          Sur iPhone / iPad, ajoutez l'application à l'écran d'accueil via Safari pour activer les notifications (iOS 16.4+).
        </div>
      )}

      {supported && permission === 'denied' && (
        <div className="mb-4 p-3 rounded border border-red-300 bg-red-50 text-red-900 text-sm">
          Les notifications sont bloquées dans les paramètres du navigateur. Autorisez-les manuellement pour cette application.
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <div className="min-w-0">
            <div className="text-sm font-medium">Notifications push natives</div>
            <div className="text-xs text-outlook-text-secondary mt-0.5">
              {subscribed
                ? 'Actives sur cet appareil — les nouveaux messages déclenchent une notification système.'
                : 'Recevez les nouveaux messages directement dans Windows, macOS, Android ou iOS (PWA installée).'}
            </div>
          </div>
          <button
            onClick={toggle}
            disabled={!supported || loading || permission === 'denied'}
            className={`ml-4 px-3 py-1.5 text-sm rounded font-medium transition-colors ${
              subscribed
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-outlook-blue hover:brightness-110 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {subscribed ? 'Désactiver' : 'Activer'}
          </button>
        </div>

        {subscribed && (
          <div className="pl-1">
            <button
              onClick={test}
              className="px-3 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
            >
              Envoyer une notification de test
            </button>
          </div>
        )}

        <label className="flex items-center justify-between">
          <span className="text-sm">Son de notification</span>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="rounded"
          />
        </label>
        <label className="flex items-center justify-between">
          <span className="text-sm">Notifications du calendrier</span>
          <input
            type="checkbox"
            checked={calendar}
            onChange={(e) => setCalendar(e.target.checked)}
            className="rounded"
          />
        </label>

        <div className="p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Vérification des nouveaux mails</div>
              <div className="text-xs text-outlook-text-secondary mt-0.5">
                Le serveur interroge votre boîte IMAP à cette fréquence et envoie une notification push dès qu'un nouveau message arrive.
              </div>
            </div>
            <select
              value={pollMinutes}
              onChange={(e) => {
                const v = Number(e.target.value) as NewMailPollMinutes;
                setPollMinutes(v);
                setNewMailPollMinutes(v);
                toast.success(
                  v === 0
                    ? 'Vérification automatique désactivée'
                    : `Vérification toutes les ${v === 60 ? '1 h' : v + ' min'}`
                );
              }}
              className="text-sm rounded border border-outlook-border bg-outlook-bg-primary px-2 py-1"
            >
              <option value={1}>Toutes les 1 minute</option>
              <option value={5}>Toutes les 5 minutes</option>
              <option value={15}>Toutes les 15 minutes</option>
              <option value={30}>Toutes les 30 minutes</option>
              <option value={60}>Toutes les heures</option>
              <option value={0}>Jamais (désactivé)</option>
            </select>
          </div>
          {pollMinutes !== 0 && !subscribed && (
            <div className="mt-2 text-xs text-amber-700">
              ⚠️ Activez d'abord les notifications push ci-dessus pour recevoir les alertes.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <NotificationPrefsSection />
      </div>

      <div className="mt-6 p-3 rounded border border-outlook-border bg-outlook-bg-secondary/40 text-xs text-outlook-text-secondary space-y-1">
        <div><strong>Astuce :</strong></div>
        <div>• <strong>Windows 11</strong> : installez l'application (Chrome/Edge/Vivaldi → icône d'installation <em>⊕</em> dans la barre d'adresse, ou menu → « Installer WebMail… »). Une fois installée, les notifications s'affichent sous le nom « WebMail » (et non plus « Chrome » / « Vivaldi ») avec son, bannière et icône dédiés — comme Outlook.</div>
        <div>• <strong>Vivaldi / Chrome / Edge — pas de son ou notification minuscule ?</strong> Activez les notifications système natives : ouvrez <code>vivaldi://flags/#enable-system-notifications</code> (ou <code>chrome://flags</code> / <code>edge://flags</code>), passez sur <em>Enabled</em> et redémarrez le navigateur.</div>
        <div>• <strong>Windows</strong> : vérifiez <em>Paramètres &gt; Système &gt; Notifications</em> — activez l'app (Vivaldi/Chrome/WebMail) et, en cliquant dessus, réglez <em>Son</em>, <em>Bannière</em> et <em>Priorité : Élevée</em>. Désactivez <em>« Ne pas déranger »</em> / Focus.</div>
        <div>• <strong>macOS</strong> : installez l'app, puis autorisez-la dans <em>Réglages Système &gt; Notifications</em> (style « Alertes » pour qu'elles restent affichées).</div>
        <div>• <strong>Android</strong> : menu « Ajouter à l'écran d'accueil » depuis Chrome.</div>
        <div>• <strong>iOS / iPadOS</strong> : Safari → Partager → « Sur l'écran d'accueil », puis activez les notifications ici (iOS 16.4+).</div>
      </div>
    </div>
  );
}

/**
 * Section "Personnalisation des notifications" — ajoute l'éditeur multi-
 * plateforme avec aperçu en direct et tests rendus / push réel. Persistée
 * dans `localStorage` (clé `notifications.prefs.v1`) et synchronisée
 * automatiquement entre appareils via le pipeline prefsSync.
 */
function NotificationPrefsSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => getNotificationPrefs());

  useEffect(() => {
    const handler = () => setPrefs(getNotificationPrefs());
    window.addEventListener('notification-prefs-changed', handler);
    return () => window.removeEventListener('notification-prefs-changed', handler);
  }, []);

  const update = (next: NotificationPrefs) => {
    setPrefs(next);
    setNotificationPrefs(next);
  };

  const sendServerTest = async (_platform: NotificationPlatform) => {
    // Le serveur ne sait pas encore cibler une plateforme spécifique pour le
    // test ; il envoie à tous les appareils inscrits. Le test local ci-dessus
    // permet en revanche de prévisualiser exactement le rendu choisi.
    const { sendTestPush } = await import('../pwa/push');
    await sendTestPush();
  };

  return (
    <details className="border border-outlook-border rounded-md" open>
      <summary className="px-3 py-2 text-sm font-semibold cursor-pointer flex items-center gap-2">
        <Bell size={14} /> Personnaliser le rendu des notifications
      </summary>
      <div className="p-3 border-t border-outlook-border">
        <NotificationPreferencesEditor
          value={prefs}
          onChange={update}
          mode="user"
          onSendServerTest={sendServerTest}
        />
      </div>
    </details>
  );
}

function BackupSettings() {
  const [autoEnabled, setAutoEnabled] = useState<boolean>(() => isAutoBackupEnabled());
  const [filename, setFilename] = useState<string>(() => getAutoBackupFilename());
  const [dirLabel, setDirLabel] = useState<string | null>(() => getBackupDirLabel());
  const [hasDir, setHasDir] = useState<boolean>(false);
  const [lastAt, setLastAt] = useState<Date | null>(() => getLastBackupAt());
  const [lastError, setLastError] = useState<string | null>(() => getLastBackupError());
  const [stats, setStats] = useState<{ keys: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fsaSupported = isFileSystemAccessSupported();

  const refreshStatus = () => {
    setLastAt(getLastBackupAt());
    setLastError(getLastBackupError());
    setDirLabel(getBackupDirLabel());
  };

  useEffect(() => {
    void hasBackupDirectory().then(setHasDir);
    const unsub = subscribeBackupStatus(() => {
      refreshStatus();
      void hasBackupDirectory().then(setHasDir);
    });
    try {
      const payload = collectBackup();
      setStats({ keys: Object.keys(payload.data).length });
    } catch { /* noop */ }
    return unsub;
  }, []);

  const handlePickDir = async () => {
    try {
      setBusy(true);
      const res = await pickBackupDirectory();
      if (res) {
        setDirLabel(res.label);
        setHasDir(true);
        toast.success(`Dossier sélectionné : ${res.label}`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Impossible de choisir le dossier');
    } finally {
      setBusy(false);
    }
  };

  const handleClearDir = async () => {
    await clearBackupDirectory();
    setDirLabel(null);
    setHasDir(false);
    toast.success('Dossier de sauvegarde oublié');
  };

  const handleSaveFilename = () => {
    const clean = sanitizeFilename(filename);
    setAutoBackupFilename(clean);
    setFilename(clean);
    toast.success('Nom de fichier enregistré');
  };

  const handleToggleAuto = (next: boolean) => {
    setAutoEnabled(next);
    setAutoBackupEnabled(next);
    if (next) {
      toast.success('Sauvegarde automatique activée');
      void runAutoBackup(false);
    } else {
      toast.success('Sauvegarde automatique désactivée');
    }
  };

  const handleExport = () => {
    try {
      const name = autoEnabled ? sanitizeFilename(filename) : undefined;
      downloadBackup(name);
      toast.success('Export téléchargé');
    } catch (e: any) {
      toast.error(e.message || 'Export impossible');
    }
  };

  const handleBackupNow = async () => {
    setBusy(true);
    const res = await runAutoBackup(true);
    setBusy(false);
    if (res.ok) {
      toast.success(
        res.mode === 'directory'
          ? `Sauvegarde écrite dans ${dirLabel || 'le dossier configuré'} (${res.filename})`
          : `Sauvegarde téléchargée (${res.filename})`
      );
    } else {
      toast.error(res.error || 'Échec de la sauvegarde');
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = await parseBackupFile(file);
      const confirmed = window.confirm(
        `Restaurer la sauvegarde du ${new Date(payload.createdAt).toLocaleString('fr-FR')} ?\n` +
        `${Object.keys(payload.data).length} paramètres seront remplacés.\n\n` +
        `Un rechargement de la page est nécessaire après restauration.`
      );
      if (!confirmed) {
        e.target.value = '';
        return;
      }
      const count = applyBackup(payload, { replace: true });
      toast.success(`${count} paramètres restaurés — rechargement…`);
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      toast.error(err.message || 'Import impossible');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold mb-1">Sauvegarde et restauration</h3>
        <p className="text-sm text-outlook-text-secondary">
          Sauvegardez la configuration <strong>locale</strong> à cet appareil : signatures, catégories, ordre et
          renommage des boîtes mail/dossiers, préférences d'affichage, thème, vues… Les courriels eux-mêmes
          restent sur votre serveur IMAP ; cette sauvegarde ne les contient pas.
        </p>
        {stats && (
          <p className="text-xs text-outlook-text-disabled mt-1">
            {stats.keys} paramètre{stats.keys > 1 ? 's' : ''} local{stats.keys > 1 ? 'aux' : ''} détecté{stats.keys > 1 ? 's' : ''}.
          </p>
        )}
      </section>

      <section className="border-t border-outlook-border pt-4">
        <h4 className="text-sm font-semibold mb-2">Sauvegarde manuelle</h4>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExport}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-2"
          >
            <Download size={14} /> Exporter (.json)
          </button>
          <button
            onClick={handleImportClick}
            className="border border-outlook-border hover:bg-outlook-bg-hover px-3 py-1.5 rounded-md text-sm flex items-center gap-2"
          >
            <Upload size={14} /> Restaurer depuis un fichier…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </section>

      <section className="border-t border-outlook-border pt-4">
        <h4 className="text-sm font-semibold mb-2">Sauvegarde automatique</h4>

        {!fsaSupported && (
          <div className="mb-3 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
            Votre navigateur ne permet pas l'écriture directe dans un dossier du PC.<br />
            Utilisez <strong>Chrome, Edge, Opera ou Vivaldi</strong> sur Windows ou Linux pour activer cette fonction.
            La sauvegarde automatique fonctionnera en « téléchargement » uniquement.
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-outlook-text-secondary">Nom du fichier de sauvegarde</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="web-mail-client-backup.json"
                className="flex-1 border border-outlook-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-outlook-blue"
              />
              <button
                onClick={handleSaveFilename}
                className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-2"
              >
                <Save size={14} /> Enregistrer
              </button>
            </div>
            <p className="text-xs text-outlook-text-disabled mt-1">
              Donnez-lui un nom explicite (ex : <code>Web-Mail-Client-NE-PAS-SUPPRIMER.json</code>) pour éviter les
              suppressions accidentelles. L'extension <code>.json</code> est ajoutée automatiquement.
            </p>
          </div>

          <div>
            <label className="text-sm text-outlook-text-secondary">Dossier de destination sur ce PC</label>
            <div className="mt-1 p-3 rounded border border-outlook-border bg-outlook-bg-primary flex items-center justify-between gap-3">
              <div className="min-w-0">
                {hasDir && dirLabel ? (
                  <>
                    <div className="text-sm flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-600" />
                      <span className="font-medium truncate">{dirLabel}</span>
                    </div>
                    <div className="text-xs text-outlook-text-disabled mt-0.5">
                      Recommandé : <em>Documents</em>, <em>Documents/Backups</em> ou tout dossier repris
                      par Duplicati / votre outil de sauvegarde.
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-outlook-text-secondary">
                    Aucun dossier configuré — l'auto-backup retombera sur un téléchargement.
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={handlePickDir}
                  disabled={!fsaSupported || busy}
                  className="border border-outlook-border hover:bg-outlook-bg-hover px-3 py-1.5 rounded-md text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  <FolderOpen size={14} /> {hasDir ? 'Changer…' : 'Choisir…'}
                </button>
                {hasDir && (
                  <button
                    onClick={handleClearDir}
                    className="border border-outlook-border hover:bg-outlook-bg-hover px-3 py-1.5 rounded-md text-sm text-red-600"
                  >
                    Oublier
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded border border-outlook-border bg-outlook-bg-primary">
            <div className="min-w-0">
              <div className="text-sm font-medium">Activer la sauvegarde automatique</div>
              <div className="text-xs text-outlook-text-secondary mt-0.5">
                Le fichier est réécrit (<strong>un seul fichier unique</strong>) à chaque modification locale :
                création/renommage de signature, catégorie, dossier ou boîte mail, changement d'affichage, etc.
                Les écritures sont regroupées pour éviter les accès trop fréquents.
              </div>
            </div>
            <button
              onClick={() => handleToggleAuto(!autoEnabled)}
              className={`ml-4 px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                autoEnabled
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-outlook-blue hover:brightness-110 text-white'
              }`}
            >
              {autoEnabled ? 'Désactiver' : 'Activer'}
            </button>
          </div>

          <div>
            <button
              onClick={handleBackupNow}
              disabled={busy}
              className="border border-outlook-border hover:bg-outlook-bg-hover px-3 py-1.5 rounded-md text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw size={14} /> Sauvegarder maintenant
            </button>
          </div>

          <div className="text-xs text-outlook-text-secondary space-y-1">
            {lastAt && (
              <div className="flex items-center gap-2">
                <CheckCircle2 size={12} className="text-green-600" />
                Dernière sauvegarde : {lastAt.toLocaleString('fr-FR')}
              </div>
            )}
            {lastError && (
              <div className="flex items-center gap-2 text-red-700">
                <AlertCircle size={12} />
                Dernière erreur : {lastError}
              </div>
            )}
            {!lastAt && !lastError && (
              <div className="text-outlook-text-disabled">Aucune sauvegarde effectuée pour l'instant.</div>
            )}
          </div>
        </div>
      </section>

      <CloudSyncSection />
    </div>
  );
}

/**
 * Cross-device synchronisation of UI customisations (renamed accounts/folders,
 * ordering, colours, layout, signatures, swipe actions, calendar prefs, theme…).
 *
 * Sits inside the "Sauvegarde" tab because it shares the same conceptual goal
 * as the local backup — making sure user settings are not lost — but applies
 * automatically to every device the user signs in on, using the per-user
 * `user_preferences` server table with last-write-wins reconciliation.
 */
function CloudSyncSection() {
  const [enabled, setEnabled] = useState<boolean>(() => isPrefsSyncEnabled());
  const [lastAt, setLastAt] = useState<string | null>(() => getLastPrefsSyncAt());
  const [lastError, setLastError] = useState<string | null>(() => getLastPrefsSyncError());
  const [status, setStatus] = useState<'idle' | 'pulling' | 'pushing' | 'error'>('idle');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      const next = e?.detail?.status;
      if (next) setStatus(next);
      setLastAt(getLastPrefsSyncAt());
      setLastError(getLastPrefsSyncError());
    };
    window.addEventListener(PREFS_SYNC_EVENT, handler as EventListener);
    return () => window.removeEventListener(PREFS_SYNC_EVENT, handler as EventListener);
  }, []);

  const onToggle = (next: boolean) => {
    setEnabled(next);
    setPrefsSyncEnabled(next);
    if (next) toast.success('Synchronisation cloud activée');
    else toast('Synchronisation cloud désactivée');
  };

  const onSyncNow = async () => {
    setBusy(true);
    try {
      await triggerPrefsSyncNow();
      toast.success('Préférences synchronisées');
    } catch (e: any) {
      toast.error(e?.message || 'Échec de la synchronisation');
    } finally {
      setBusy(false);
      setLastAt(getLastPrefsSyncAt());
      setLastError(getLastPrefsSyncError());
    }
  };

  const lastDate = lastAt ? new Date(lastAt) : null;

  return (
    <section className="mt-8 border-t border-outlook-border pt-6">
      <h3 className="text-base font-semibold mb-1">Synchronisation cloud des préférences</h3>
      <p className="text-xs text-outlook-text-secondary mb-4">
        Vos personnalisations (renommage des comptes/dossiers, ordre, couleurs, mise en page,
        signatures, catégories, actions de balayage, thème…) sont synchronisées automatiquement
        entre tous vos appareils connectés au même compte. La règle de fusion est « la dernière
        modification gagne ».
      </p>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Activer la synchronisation entre appareils</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-4 w-4"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={onSyncNow}
            disabled={!enabled || busy}
            className="px-3 py-1.5 text-sm rounded-md border border-outlook-border hover:bg-outlook-bg-hover disabled:opacity-50 inline-flex items-center gap-2"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            Synchroniser maintenant
          </button>
          <span className="text-xs text-outlook-text-secondary">
            {status === 'pulling' && 'Récupération…'}
            {status === 'pushing' && 'Envoi…'}
          </span>
        </div>

        <div className="text-xs space-y-1">
          {lastDate && !lastError && (
            <div className="flex items-center gap-1 text-outlook-text-secondary">
              <CheckCircle2 size={12} className="text-green-600" />
              Dernière synchronisation : {lastDate.toLocaleString()}
            </div>
          )}
          {lastError && (
            <div className="flex items-center gap-1 text-red-600">
              <AlertCircle size={12} />
              Dernière erreur : {lastError}
            </div>
          )}
          {!lastAt && !lastError && (
            <div className="text-outlook-text-disabled">Aucune synchronisation effectuée pour l'instant.</div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Devices settings — lists active device sessions so the user can see every
 * browser/PWA install signed into their account and revoke one remotely (e.g.
 * when a phone is lost). Built on top of the refresh-token rotation system.
 */
function DevicesSettings() {
  const qc = useQueryClient();
  const { data: devices, isLoading } = useQuery({
    queryKey: ['auth-devices'],
    queryFn: () => api.getDevices(),
    refetchOnWindowFocus: true,
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-devices'] });
      toast.success('Appareil déconnecté');
    },
    onError: () => toast.error('Impossible de déconnecter cet appareil'),
  });

  const handleRevoke = (id: string, isCurrent: boolean) => {
    const msg = isCurrent
      ? 'Déconnecter cet appareil ? Vous devrez vous reconnecter.'
      : 'Déconnecter cet appareil à distance ?';
    if (!window.confirm(msg)) return;
    revokeMutation.mutate(id);
  };

  const iconFor = (ua: string | null) => {
    const lower = (ua || '').toLowerCase();
    if (lower.includes('iphone') || lower.includes('android')) return Smartphone;
    if (lower.includes('ipad') || lower.includes('tablet')) return Tablet;
    return Monitor;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-lg font-semibold mb-1 text-outlook-text-primary">Mes appareils connectés</h3>
        <p className="text-sm text-outlook-text-secondary mb-4">
          Chaque appareil sur lequel vous vous connectez reste authentifié sans redemander votre mot de passe.
          Vous pouvez le déconnecter à distance ici en cas de perte ou de vol.
        </p>

        {isLoading && (
          <div className="text-sm text-outlook-text-secondary">Chargement…</div>
        )}

        {!isLoading && devices && devices.length === 0 && (
          <div className="text-sm text-outlook-text-secondary p-4 border border-dashed border-outlook-border rounded">
            Aucun appareil actif.
            <div className="text-xs text-outlook-text-disabled mt-1">
              Si vous êtes bien connecté ici, votre session a probablement été
              créée avant l'activation du suivi d'appareils. Déconnectez-vous
              puis reconnectez-vous pour que cet appareil apparaisse dans la liste.
            </div>
          </div>
        )}

        <div className="space-y-2">
          {devices?.map(device => {
            const Icon = iconFor(device.userAgent);
            return (
              <div
                key={device.id}
                className="flex items-start gap-3 p-3 border border-outlook-border rounded-md bg-white"
              >
                <div className="w-10 h-10 rounded-full bg-outlook-bg-hover flex items-center justify-center flex-shrink-0">
                  <Icon size={18} className="text-outlook-text-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-outlook-text-primary">
                      {device.deviceName || 'Appareil'}
                    </span>
                    {device.current && (
                      <span className="text-2xs uppercase tracking-wide px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                        Cet appareil
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-outlook-text-secondary mt-0.5">
                    Dernière utilisation : {formatDate(device.lastUsedAt)}
                    {device.ipLastSeen && <> · {device.ipLastSeen}</>}
                  </div>
                  <div className="text-xs text-outlook-text-disabled mt-0.5">
                    Connecté le {formatDate(device.createdAt)} · expire le {formatDate(device.expiresAt)}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(device.id, device.current)}
                  disabled={revokeMutation.isPending}
                  className="flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                  title="Déconnecter cet appareil"
                >
                  <Trash2 size={12} /> Déconnecter
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Security settings — passkeys / biometric enrolment
// ─────────────────────────────────────────────────────────────────────────────

function SecuritySettings() {
  const qc = useQueryClient();
  const { data: credentials, isLoading } = useQuery({
    queryKey: ['webauthn-credentials'],
    queryFn: () => api.webauthnCredentials(),
  });

  const [enrolling, setEnrolling] = useState(false);
  const [nickname, setNickname] = useState('');

  const enroll = async () => {
    setEnrolling(true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const options = await api.webauthnRegisterOptions();
      const response = await startRegistration({ optionsJSON: options });
      await api.webauthnRegisterVerify(response, nickname || undefined);
      setNickname('');
      qc.invalidateQueries({ queryKey: ['webauthn-credentials'] });
      toast.success('Clé biométrique enregistrée');
    } catch (err: any) {
      toast.error(err?.message || 'Enrôlement annulé');
    } finally {
      setEnrolling(false);
    }
  };

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.webauthnDeleteCredential(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webauthn-credentials'] });
      toast.success('Clé supprimée');
    },
    onError: (e: any) => toast.error(e?.message || 'Suppression impossible'),
  });

  const handleRemove = (id: string) => {
    if (!confirm('Supprimer cette clé biométrique ? Vous devrez en réenregistrer une pour réutiliser Touch ID / Face ID / Windows Hello.')) return;
    removeMutation.mutate(id);
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  };

  const supported = typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined';

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold text-outlook-text-primary mb-1 flex items-center gap-2">
          <Fingerprint size={18} /> Sécurité biométrique
        </h2>
        <p className="text-sm text-outlook-text-secondary mb-4">
          Enregistrez Touch ID, Face ID ou Windows Hello pour déverrouiller
          l'application rapidement et ajouter une seconde vérification lors
          des connexions depuis un nouvel appareil.
        </p>

        {!supported && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800 mb-4">
            Ce navigateur ne prend pas en charge WebAuthn. Utilisez un
            navigateur récent sur un appareil doté d'un capteur biométrique.
          </div>
        )}

        <div className="border border-outlook-border rounded-md p-4 bg-white mb-4">
          <label className="block text-sm font-medium text-outlook-text-primary mb-1">
            Nom de la clé (optionnel)
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Mon MacBook, iPhone perso…"
            className="w-full px-3 py-2 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue mb-3"
          />
          <button
            onClick={enroll}
            disabled={!supported || enrolling}
            className="inline-flex items-center gap-2 bg-outlook-blue hover:bg-outlook-blue-hover text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
          >
            <Fingerprint size={16} />
            {enrolling ? 'En attente du capteur…' : 'Ajouter une clé biométrique'}
          </button>
        </div>

        {isLoading && <p className="text-sm text-outlook-text-secondary">Chargement…</p>}
        {!isLoading && credentials && credentials.length === 0 && (
          <p className="text-sm text-outlook-text-secondary">
            Aucune clé enregistrée pour l'instant.
          </p>
        )}

        <div className="space-y-2">
          {credentials?.map((c) => (
            <div
              key={c.id}
              className="flex items-start gap-3 p-3 border border-outlook-border rounded-md bg-white"
            >
              <div className="w-10 h-10 rounded-full bg-outlook-bg-hover flex items-center justify-center flex-shrink-0">
                <Fingerprint size={18} className="text-outlook-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-outlook-text-primary flex items-center gap-2 flex-wrap">
                  {c.nickname || 'Clé biométrique'}
                  {c.backedUp && (
                    <span className="text-2xs uppercase tracking-wide px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                      Synchronisée
                    </span>
                  )}
                  {c.deviceType === 'singleDevice' && (
                    <span className="text-2xs uppercase tracking-wide px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded">
                      Liée à cet appareil
                    </span>
                  )}
                </div>
                <div className="text-xs text-outlook-text-secondary mt-0.5">
                  Créée le {formatDate(c.createdAt)}
                </div>
                <div className="text-xs text-outlook-text-disabled mt-0.5">
                  Dernière utilisation : {formatDate(c.lastUsedAt)}
                </div>
              </div>
              <button
                onClick={() => handleRemove(c.id)}
                disabled={removeMutation.isPending}
                className="flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                title="Supprimer cette clé"
              >
                <Trash2 size={12} /> Retirer
              </button>
            </div>
          ))}
        </div>

        <div className="mt-6 p-3 bg-outlook-bg-hover rounded-md text-xs text-outlook-text-secondary">
          <strong className="text-outlook-text-primary">Comment ça marche :</strong> une fois
          une clé enregistrée, la connexion par mot de passe demandera aussi
          une vérification biométrique (2FA). L'application vous demandera
          également votre empreinte / visage après plusieurs jours d'inactivité
          au lieu de votre mot de passe.
        </div>
      </section>
    </div>
  );
}
