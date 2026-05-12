import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Archive, Download, Trash2, Plus, RefreshCw, Upload,
  Clock, Settings2, Shield, AlertTriangle, CheckCircle2,
  Database, RotateCcw, HardDrive, Zap, Calendar, ChevronDown,
  Info, Loader2,
} from 'lucide-react';

// ─── API helpers ─────────────────────────────────────────────────────────────

const BASE = '/api/admin/backup';

function authHeaders() {
  const token = localStorage.getItem('auth_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface BackupRecord {
  id: string;
  filename: string;
  size_bytes: number;
  type: 'manual' | 'auto';
  label: string;
  created_at: string;
  file_exists: boolean;
}

interface BackupSettings {
  backup_auto_enabled: boolean;
  backup_frequency: 'daily' | 'weekly' | 'monthly';
  backup_time: string;
  backup_day_of_week: number;
  backup_day_of_month: number;
  backup_retention_daily: number;
  backup_retention_weekly: number;
  backup_retention_monthly: number;
  backup_retention_yearly: number;
  backup_last_auto_run?: string;
}

async function fetchList(): Promise<BackupRecord[]> {
  const res = await fetch(`${BASE}/list`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchSettings(): Promise<BackupSettings> {
  const res = await fetch(`${BASE}/settings`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function createBackup(label: string): Promise<void> {
  const res = await fetch(`${BASE}/create`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ label }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
}

async function deleteBackup(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
}

async function saveSettings(settings: Partial<BackupSettings>): Promise<void> {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(settings),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
}

async function downloadBackup(id: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}/download/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` } });
  if (!res.ok) throw new Error('Téléchargement impossible');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function restoreBackup(file: File, oldUrl?: string, newUrl?: string): Promise<void> {
  const form = new FormData();
  form.append('backup', file);
  if (oldUrl && newUrl) {
    form.append('oldUrl', oldUrl);
    form.append('newUrl', newUrl);
  }
  const res = await fetch(`${BASE}/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` },
    body: form,
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const ORDINALS = ['', '1er', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28'];

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-outlook-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-outlook-bg-primary border-b border-outlook-border">
        <Icon size={16} className="text-outlook-blue" />
        <h3 className="font-semibold text-sm text-outlook-text-primary">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function NumberInput({
  label, value, onChange, min = 0, max = 999, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-outlook-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || 0)))}
          className="w-20 border border-outlook-border rounded px-2 py-1 text-sm text-center
                     focus:outline-none focus:border-outlook-blue"
        />
        {suffix && <span className="text-sm text-outlook-text-disabled whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteModal({ backup, onConfirm, onCancel, loading }: {
  backup: BackupRecord;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-red-100 p-2 rounded-full">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <h3 className="font-semibold text-outlook-text-primary">Supprimer la sauvegarde ?</h3>
        </div>
        <p className="text-sm text-outlook-text-secondary mb-1">
          <strong className="text-outlook-text-primary">{backup.label || backup.filename}</strong>
        </p>
        <p className="text-sm text-outlook-text-disabled mb-5">
          {formatDate(backup.created_at)} — {formatBytes(backup.size_bytes)}
        </p>
        <p className="text-sm text-red-600 mb-5">
          Cette action est irréversible. Le fichier de sauvegarde sera définitivement supprimé.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Restore confirmation modal ───────────────────────────────────────────────

function RestoreModal({ filename, onConfirm, onCancel, loading }: {
  filename: string;
  onConfirm: (oldUrl: string, newUrl: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [oldUrl, setOldUrl] = useState('');
  const [newUrl, setNewUrl] = useState('');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-orange-100 p-2 rounded-full">
            <AlertTriangle size={20} className="text-orange-600" />
          </div>
          <h3 className="font-semibold text-outlook-text-primary">Confirmer la restauration</h3>
        </div>
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-sm font-medium text-red-700 mb-1">Action destructive</p>
          <p className="text-sm text-red-600">
            Toutes les données actuelles (utilisateurs, paramètres, comptes mail, contacts, calendriers…)
            seront <strong>écrasées</strong> par le contenu de la sauvegarde.
            Cette opération est irréversible.
          </p>
        </div>
        <p className="text-sm text-outlook-text-secondary mb-4">
          Fichier : <strong className="text-outlook-text-primary">{filename}</strong>
        </p>

        {/* URL replacement (optional) */}
        <div className="border border-outlook-border rounded p-3 mb-5 space-y-3">
          <p className="text-xs font-medium text-outlook-text-primary flex items-center gap-1.5">
            <Info size={13} className="text-outlook-blue" />
            Remplacement d'URL <span className="font-normal text-outlook-text-disabled">(optionnel — si vous changez de serveur)</span>
          </p>
          <p className="text-xs text-outlook-text-disabled">
            Remplace automatiquement l'URL source dans tous les paramètres (public_url, WebAuthn RP ID, OAuth…).
            Laissez vide si vous restaurez sur le même serveur.
          </p>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-outlook-text-secondary block mb-1">URL source (sauvegarde)</label>
              <input
                type="text"
                placeholder="https://ml.kiriyama.ovh"
                value={oldUrl}
                onChange={e => setOldUrl(e.target.value)}
                className="w-full border border-outlook-border rounded px-2 py-1.5 text-sm
                           focus:outline-none focus:border-outlook-blue font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary block mb-1">URL cible (ce serveur)</label>
              <input
                type="text"
                placeholder="https://ml.dev.kiriyama.ovh"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                className="w-full border border-outlook-border rounded px-2 py-1.5 text-sm
                           focus:outline-none focus:border-outlook-blue font-mono"
              />
            </div>
          </div>
          {/* Dynamic passkey warning */}
          {(() => {
            try {
              const oh = new URL(oldUrl.startsWith('http') ? oldUrl : `https://${oldUrl}`).hostname;
              const nh = new URL(newUrl.startsWith('http') ? newUrl : `https://${newUrl}`).hostname;
              if (oldUrl && newUrl && oh !== nh) {
                return (
                  <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-700">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                    <span>
                      Le domaine change (<strong>{oh}</strong> → <strong>{nh}</strong>).
                      Les <strong>passkeys (clés d'accès)</strong> seront automatiquement supprimées
                      car elles sont liées à l'ancien domaine et bloqueraient la connexion.
                      Les utilisateurs pourront se reconnecter avec leur mot de passe et enregistrer
                      une nouvelle passkey.
                    </span>
                  </div>
                );
              }
              if (oldUrl && newUrl && oh === nh) {
                return (
                  <div className="flex gap-2 bg-green-50 border border-green-200 rounded p-2 text-xs text-green-700">
                    <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
                    <span>Même domaine — les passkeys seront conservées et resteront fonctionnelles.</span>
                  </div>
                );
              }
            } catch { /* URL pas encore complète */ }
            return null;
          })()}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={() => onConfirm(oldUrl, newUrl)}
            disabled={loading}
            className="px-4 py-2 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Restaurer quand même
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function AdminBackup() {
  const qc = useQueryClient();

  const { data: backups = [], isLoading: loadingList, refetch } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: fetchList,
  });

  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ['admin-backup-settings'],
    queryFn: fetchSettings,
  });

  // Local settings draft (only saved when user clicks "Enregistrer")
  const [draft, setDraft] = useState<Partial<BackupSettings>>({});
  const merged: BackupSettings = {
    backup_auto_enabled: false,
    backup_frequency: 'daily',
    backup_time: '02:00',
    backup_day_of_week: 1,
    backup_day_of_month: 1,
    backup_retention_daily: 7,
    backup_retention_weekly: 4,
    backup_retention_monthly: 12,
    backup_retention_yearly: 3,
    ...settings,
    ...draft,
  };

  const [createLabel, setCreateLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<BackupRecord | null>(null);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateDraft<K extends keyof BackupSettings>(key: K, value: BackupSettings[K]) {
    setDraft(d => ({ ...d, [key]: value }));
    setSettingsDirty(true);
  }

  // Mutations
  const createMut = useMutation({
    mutationFn: () => createBackup(createLabel || 'Sauvegarde manuelle'),
    onSuccess: () => {
      toast.success('Sauvegarde créée avec succès');
      setCreateLabel('');
      qc.invalidateQueries({ queryKey: ['admin-backups'] });
    },
    onError: (e: Error) => toast.error(`Erreur : ${e.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBackup(id),
    onSuccess: () => {
      toast.success('Sauvegarde supprimée');
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-backups'] });
    },
    onError: (e: Error) => toast.error(`Erreur : ${e.message}`),
  });

  const settingsMut = useMutation({
    mutationFn: () => saveSettings(draft),
    onSuccess: () => {
      toast.success('Paramètres enregistrés');
      setDraft({});
      setSettingsDirty(false);
      qc.invalidateQueries({ queryKey: ['admin-backup-settings'] });
    },
    onError: (e: Error) => toast.error(`Erreur : ${e.message}`),
  });

  const restoreMut = useMutation({
    mutationFn: ({ file, oldUrl, newUrl }: { file: File; oldUrl: string; newUrl: string }) =>
      restoreBackup(file, oldUrl || undefined, newUrl || undefined),
    onSuccess: () => {
      toast.success('Restauration réussie. Reconnectez-vous pour prendre en compte les nouveaux paramètres.', { duration: 8000 });
      setPendingRestoreFile(null);
      qc.invalidateQueries({ queryKey: ['admin-backups'] });
    },
    onError: (e: Error) => {
      toast.error(`Restauration échouée : ${e.message}`);
      setPendingRestoreFile(null);
    },
  });

  const handleDownload = useCallback(async (backup: BackupRecord) => {
    setDownloading(backup.id);
    try {
      await downloadBackup(backup.id, backup.filename);
    } catch (e: any) {
      toast.error(`Téléchargement impossible : ${e.message}`);
    } finally {
      setDownloading(null);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json.gz')) {
      toast.error('Seuls les fichiers .json.gz sont acceptés');
      return;
    }
    setPendingRestoreFile(file);
    e.target.value = '';
  };

  if (loadingList || loadingSettings) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-outlook-blue" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-outlook-text-primary">Sauvegarde &amp; Restauration</h2>
          <p className="text-sm text-outlook-text-secondary mt-0.5">
            Sauvegardez toute votre application (utilisateurs, comptes, paramètres, calendriers, contacts) pour migrer ou récupérer votre instance.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
        >
          <RefreshCw size={14} /> Actualiser
        </button>
      </div>

      {/* ── Create Backup ─────────────────────────────────────────────────── */}
      <Section title="Créer une sauvegarde manuelle" icon={Archive}>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Label (optionnel)"
            value={createLabel}
            onChange={e => setCreateLabel(e.target.value)}
            maxLength={200}
            className="flex-1 border border-outlook-border rounded px-3 py-2 text-sm
                       focus:outline-none focus:border-outlook-blue"
          />
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-outlook-blue text-white rounded
                       hover:bg-outlook-blue-hover disabled:opacity-50 whitespace-nowrap"
          >
            {createMut.isPending
              ? <><Loader2 size={14} className="animate-spin" /> Création…</>
              : <><Plus size={14} /> Créer la sauvegarde</>}
          </button>
        </div>
        <p className="text-xs text-outlook-text-disabled mt-2">
          La sauvegarde est un fichier .json.gz contenant toutes les tables critiques de votre base de données.
          Les emails mis en cache peuvent être resynchronisés depuis les serveurs IMAP et ne sont pas inclus.
        </p>
      </Section>

      {/* ── Backup List ───────────────────────────────────────────────────── */}
      <Section title={`Sauvegardes disponibles (${backups.length})`} icon={Database}>
        {backups.length === 0 ? (
          <div className="text-center py-8 text-outlook-text-disabled">
            <Archive size={32} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aucune sauvegarde pour l'instant.</p>
            <p className="text-xs mt-1">Créez votre première sauvegarde ci-dessus.</p>
          </div>
        ) : (
          <div className="divide-y divide-outlook-border -mx-4 -mb-4">
            {backups.map(backup => (
              <div
                key={backup.id}
                className={`flex items-center gap-3 px-4 py-3 hover:bg-outlook-bg-hover ${!backup.file_exists ? 'opacity-60' : ''}`}
              >
                {/* Type badge */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs
                  ${backup.type === 'auto' ? 'bg-blue-500' : 'bg-green-600'}`}>
                  {backup.type === 'auto' ? <Zap size={14} /> : <Archive size={14} />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-outlook-text-primary truncate">
                      {backup.label || 'Sauvegarde'}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium
                      ${backup.type === 'auto' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {backup.type === 'auto' ? 'Auto' : 'Manuel'}
                    </span>
                    {!backup.file_exists && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                        Fichier manquant
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-outlook-text-disabled flex items-center gap-1">
                      <Clock size={11} /> {formatDate(backup.created_at)}
                    </span>
                    <span className="text-xs text-outlook-text-disabled flex items-center gap-1">
                      <HardDrive size={11} /> {formatBytes(backup.size_bytes)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleDownload(backup)}
                    disabled={!backup.file_exists || downloading === backup.id}
                    title="Télécharger"
                    className="p-1.5 rounded hover:bg-outlook-bg-selected text-outlook-text-secondary
                               disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {downloading === backup.id
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Download size={16} />}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(backup)}
                    title="Supprimer"
                    className="p-1.5 rounded hover:bg-red-50 text-outlook-text-secondary hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Restore ──────────────────────────────────────────────────────── */}
      <Section title="Restaurer depuis un fichier" icon={RotateCcw}>
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 flex gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            La restauration remplace <strong>toutes les données actuelles</strong> par celles de la sauvegarde.
            Tous les utilisateurs seront déconnectés. Faites une sauvegarde préalable si nécessaire.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json.gz"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-outlook-border rounded
                       hover:bg-outlook-bg-hover text-outlook-text-primary"
          >
            <Upload size={14} /> Choisir un fichier .json.gz…
          </button>
          {pendingRestoreFile && (
            <span className="text-sm text-outlook-text-secondary">
              {pendingRestoreFile.name} ({formatBytes(pendingRestoreFile.size)})
            </span>
          )}
        </div>
      </Section>

      {/* ── Auto-backup Settings ──────────────────────────────────────────── */}
      <Section title="Sauvegarde automatique" icon={Settings2}>
        <div className="space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-outlook-text-primary">Activer la sauvegarde automatique</p>
              <p className="text-xs text-outlook-text-disabled mt-0.5">
                Le serveur effectuera une sauvegarde selon la fréquence configurée.
              </p>
            </div>
            <button
              onClick={() => updateDraft('backup_auto_enabled', !merged.backup_auto_enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                merged.backup_auto_enabled ? 'bg-outlook-blue' : 'bg-gray-300'
              }`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                merged.backup_auto_enabled ? 'left-6' : 'left-1'
              }`} />
            </button>
          </div>

          {merged.backup_auto_enabled && (
            <div className="space-y-4 border-t border-outlook-border pt-4">
              {/* Frequency */}
              <div>
                <label className="text-sm font-medium text-outlook-text-primary block mb-2">Fréquence</label>
                <div className="flex gap-2">
                  {(['daily', 'weekly', 'monthly'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => updateDraft('backup_frequency', f)}
                      className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                        merged.backup_frequency === f
                          ? 'bg-outlook-blue text-white border-outlook-blue'
                          : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-secondary'
                      }`}
                    >
                      {f === 'daily' ? 'Quotidien' : f === 'weekly' ? 'Hebdomadaire' : 'Mensuel'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time */}
              <div className="flex items-center gap-4">
                <label className="text-sm text-outlook-text-secondary whitespace-nowrap flex items-center gap-1.5">
                  <Clock size={14} /> Heure (UTC)
                </label>
                <input
                  type="time"
                  value={merged.backup_time}
                  onChange={e => updateDraft('backup_time', e.target.value)}
                  className="border border-outlook-border rounded px-2 py-1 text-sm focus:outline-none focus:border-outlook-blue"
                />
              </div>

              {/* Day of week (for weekly) */}
              {merged.backup_frequency === 'weekly' && (
                <div>
                  <label className="text-sm text-outlook-text-secondary block mb-2 flex items-center gap-1.5">
                    <Calendar size={14} /> Jour de la semaine
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {DAY_NAMES.map((name, idx) => (
                      <button
                        key={idx}
                        onClick={() => updateDraft('backup_day_of_week', idx)}
                        className={`px-3 py-1 text-xs rounded border transition-colors ${
                          merged.backup_day_of_week === idx
                            ? 'bg-outlook-blue text-white border-outlook-blue'
                            : 'border-outlook-border hover:bg-outlook-bg-hover text-outlook-text-secondary'
                        }`}
                      >
                        {name.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Day of month (for monthly) */}
              {merged.backup_frequency === 'monthly' && (
                <div>
                  <label className="text-sm text-outlook-text-secondary block mb-2 flex items-center gap-1.5">
                    <Calendar size={14} /> Jour du mois
                  </label>
                  <select
                    value={merged.backup_day_of_month}
                    onChange={e => updateDraft('backup_day_of_month', parseInt(e.target.value))}
                    className="border border-outlook-border rounded px-2 py-1 text-sm focus:outline-none focus:border-outlook-blue"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{ORDINALS[d] || `${d}`} du mois</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Last run info */}
              {settings?.backup_last_auto_run && (
                <p className="text-xs text-outlook-text-disabled flex items-center gap-1">
                  <CheckCircle2 size={12} className="text-green-500" />
                  Dernière exécution : {formatDate(settings.backup_last_auto_run)}
                </p>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── Retention Policy ──────────────────────────────────────────────── */}
      <Section title="Rétention intelligente des sauvegardes automatiques" icon={Shield}>
        <div className="mb-3 flex gap-2 text-xs text-outlook-text-disabled bg-outlook-bg-primary rounded p-2">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Les sauvegardes automatiques sont conservées selon ces règles cumulatives.
            Une sauvegarde peut compter dans plusieurs catégories (ex: la première du mois compte aussi pour le quota mensuel ET annuel).
          </span>
        </div>
        <div className="space-y-3">
          <NumberInput
            label="Dernières sauvegardes à conserver"
            value={merged.backup_retention_daily}
            onChange={v => updateDraft('backup_retention_daily', v)}
            min={1} max={365}
            suffix="sauvegardes"
          />
          <NumberInput
            label="Conserver 1 par semaine pendant"
            value={merged.backup_retention_weekly}
            onChange={v => updateDraft('backup_retention_weekly', v)}
            min={0} max={52}
            suffix="semaines"
          />
          <NumberInput
            label="Conserver 1 par mois pendant"
            value={merged.backup_retention_monthly}
            onChange={v => updateDraft('backup_retention_monthly', v)}
            min={0} max={120}
            suffix="mois"
          />
          <NumberInput
            label="Conserver 1 par an pendant"
            value={merged.backup_retention_yearly}
            onChange={v => updateDraft('backup_retention_yearly', v)}
            min={0} max={20}
            suffix="ans"
          />
        </div>

        {/* Retention summary */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded text-xs text-blue-700 space-y-0.5">
          <p className="font-medium mb-1">Résumé de la politique :</p>
          <p>• Toujours garder les <strong>{merged.backup_retention_daily}</strong> dernières sauvegardes</p>
          {merged.backup_retention_weekly > 0 && (
            <p>• Garder 1 sauvegarde par semaine sur les <strong>{merged.backup_retention_weekly}</strong> dernières semaines</p>
          )}
          {merged.backup_retention_monthly > 0 && (
            <p>• Garder 1 sauvegarde par mois sur les <strong>{merged.backup_retention_monthly}</strong> derniers mois</p>
          )}
          {merged.backup_retention_yearly > 0 && (
            <p>• Garder 1 sauvegarde par an sur les <strong>{merged.backup_retention_yearly}</strong> dernières années</p>
          )}
        </div>
      </Section>

      {/* ── Save Settings Button ──────────────────────────────────────────── */}
      {settingsDirty && (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => { setDraft({}); setSettingsDirty(false); }}
            className="px-4 py-2 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={() => settingsMut.mutate()}
            disabled={settingsMut.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-outlook-blue text-white rounded
                       hover:bg-outlook-blue-hover disabled:opacity-50"
          >
            {settingsMut.isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer les paramètres
          </button>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {confirmDelete && (
        <DeleteModal
          backup={confirmDelete}
          onConfirm={() => deleteMut.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
          loading={deleteMut.isPending}
        />
      )}

      {pendingRestoreFile && (
        <RestoreModal
          filename={pendingRestoreFile.name}
          onConfirm={(oldUrl, newUrl) =>
            restoreMut.mutate({ file: pendingRestoreFile, oldUrl, newUrl })
          }
          onCancel={() => setPendingRestoreFile(null)}
          loading={restoreMut.isPending}
        />
      )}
    </div>
  );
}
