import { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar as CalendarIcon, Trash2, Edit2, UserPlus, X, Download, Upload, Save,
  Eye, CloudUpload, CloudDownload, RefreshCw, Users as UsersIcon, AlertCircle, Check, Link2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';

type Permission = 'none' | 'free_busy' | 'busy_title' | 'read' | 'write' | 'owner';

const PERMISSION_LABELS: Record<Permission, string> = {
  none: 'Bloqué',
  free_busy: 'Disponibilité (occupé/libre)',
  busy_title: 'Occupé + titre',
  read: 'Lecture (détails)',
  write: 'Écriture (modifier)',
  owner: 'Propriétaire (partage)',
};

interface Assignment {
  userId: string;
  email: string;
  displayName?: string | null;
  permission: Permission;
}

interface AdminCalendar {
  id: string;
  name: string;
  color: string;
  is_visible: boolean;
  is_default: boolean;
  is_shared: boolean;
  source: string;
  caldav_url?: string | null;
  mail_account_id?: string | null;
  owner_id?: string | null;
  owner_email?: string | null;
  owner_display_name?: string | null;
  mail_account_email?: string | null;
  event_count: number | string;
  assignments: Assignment[];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminCalendarManagement() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assignDialogFor, setAssignDialogFor] = useState<AdminCalendar | null>(null);
  const [pushDialogFor, setPushDialogFor] = useState<AdminCalendar | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: calendars = [], isLoading } = useQuery<AdminCalendar[]>({
    queryKey: ['admin-calendars'],
    queryFn: () => api.getAdminCalendars(),
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.getAdminUsers(),
  });

  const { data: mailAccounts = [] } = useQuery<any[]>({
    queryKey: ['calendar-accounts'],
    queryFn: () => api.getCalendarAccounts(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateAdminCalendar(id, data),
    onSuccess: () => { toast.success('Calendrier mis à jour'); qc.invalidateQueries({ queryKey: ['admin-calendars'] }); setEditingId(null); },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAdminCalendar(id),
    onSuccess: () => { toast.success('Calendrier supprimé'); qc.invalidateQueries({ queryKey: ['admin-calendars'] }); },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return calendars;
    return calendars.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.owner_email || '').toLowerCase().includes(q) ||
      (c.mail_account_email || '').toLowerCase().includes(q)
    );
  }, [calendars, filter]);

  const handleBackup = async () => {
    try {
      const blob = await api.backupAdminCalendars();
      downloadBlob(blob, `calendars-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast.success('Sauvegarde téléchargée');
    } catch (e: any) {
      toast.error(e.message || 'Échec de la sauvegarde');
    }
  };

  const handleRestoreFile = async (file: File) => {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const strategy = window.confirm(
        'Remplacer toutes les données existantes (OK) ou fusionner (Annuler) ?'
      ) ? 'replace' : 'merge';
      const result = await api.restoreAdminCalendars(payload, strategy);
      toast.success(`Restauré : ${result.calendars} calendrier(s), ${result.events} événement(s)`);
      qc.invalidateQueries({ queryKey: ['admin-calendars'] });
    } catch (e: any) {
      toast.error(e.message || 'Restauration impossible');
    }
  };

  const handleExportIcs = async (cal: AdminCalendar) => {
    try {
      const blob = await api.exportAdminCalendarIcs(cal.id);
      downloadBlob(blob, `${cal.name.replace(/[^a-zA-Z0-9-]+/g, '_')}.ics`);
    } catch (e: any) {
      toast.error(e.message || 'Export impossible');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Gestion des calendriers</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportDialogOpen(true)}
            className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1.5"
          >
            <CloudDownload size={14} /> Ajouter via CalDAV
          </button>
          <button
            onClick={handleBackup}
            className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1.5"
          >
            <Download size={14} /> Sauvegarder tout
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1.5"
          >
            <Upload size={14} /> Restaurer
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleRestoreFile(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['admin-calendars'] })}
            className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3 mb-4 text-xs text-blue-900 dark:text-blue-200 flex gap-2">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <div>
          Les calendriers sont stockés dans la base PostgreSQL du serveur. Utilisez <b>Sauvegarder tout</b> pour télécharger un backup JSON complet (calendriers, événements, partages) et <b>Pousser vers CalDAV</b> pour déposer une copie .ics sur votre serveur O2Switch via CalDAV — sans perte de données.
        </div>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Rechercher par nom, propriétaire ou compte mail…"
        className="w-full mb-3 px-3 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
      />

      {isLoading ? (
        <div className="text-center py-8 text-outlook-text-secondary">Chargement…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-outlook-text-secondary">Aucun calendrier.</div>
      ) : (
        <div className="border border-outlook-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-outlook-bg-hover">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Calendrier</th>
                <th className="px-3 py-2 font-medium">Propriétaire</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Partages</th>
                <th className="px-3 py-2 font-medium">Événements</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(cal => (
                <AdminCalendarRow
                  key={cal.id}
                  cal={cal}
                  users={users}
                  editing={editingId === cal.id}
                  onStartEdit={() => setEditingId(cal.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(data) => updateMutation.mutate({ id: cal.id, data })}
                  onDelete={() => {
                    if (window.confirm(`Supprimer « ${cal.name} » et tous ses événements ?`)) {
                      deleteMutation.mutate(cal.id);
                    }
                  }}
                  onAssign={() => setAssignDialogFor(cal)}
                  onExport={() => handleExportIcs(cal)}
                  onPush={() => setPushDialogFor(cal)}
                  saving={updateMutation.isPending && updateMutation.variables?.id === cal.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assignDialogFor && (
        <AssignmentsDialog
          calendar={assignDialogFor}
          users={users}
          onClose={() => setAssignDialogFor(null)}
        />
      )}

      {pushDialogFor && (
        <PushToCalDAVDialog
          calendar={pushDialogFor}
          mailAccounts={mailAccounts}
          onClose={() => setPushDialogFor(null)}
        />
      )}

      {importDialogOpen && (
        <ImportCaldavDialog
          users={users}
          onClose={() => setImportDialogOpen(false)}
          onImported={() => qc.invalidateQueries({ queryKey: ['admin-calendars'] })}
        />
      )}
    </div>
  );
}

function AdminCalendarRow(props: {
  cal: AdminCalendar;
  users: any[];
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (data: any) => void;
  onDelete: () => void;
  onAssign: () => void;
  onExport: () => void;
  onPush: () => void;
}) {
  const { cal, users, editing, saving, onStartEdit, onCancelEdit, onSave, onDelete, onAssign, onExport, onPush } = props;
  const [name, setName] = useState(cal.name);
  const [color, setColor] = useState(cal.color);
  const [ownerId, setOwnerId] = useState(cal.owner_id || '');
  const [isVisible, setIsVisible] = useState(cal.is_visible);

  return (
    <tr className="border-t border-outlook-border hover:bg-outlook-bg-hover/40">
      <td className="px-3 py-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border border-outlook-border"
            />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: cal.color }} />
            <span className="font-medium">{cal.name}</span>
            {cal.is_default && <span className="text-[10px] bg-outlook-blue/10 text-outlook-blue px-1.5 py-0.5 rounded">défaut</span>}
            {cal.is_shared && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">partagé</span>}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {editing ? (
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark"
          >
            {users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-outlook-text-secondary">{cal.owner_email || '—'}</span>
        )}
      </td>
      <td className="px-3 py-2">
        <span className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-outlook-hover-dark">
          {cal.source === 'caldav' || cal.source === 'nextcloud' ? <CloudUpload size={10} /> : <CalendarIcon size={10} />}
          {cal.source}
        </span>
        {cal.mail_account_email && (
          <div className="text-[10px] text-outlook-text-secondary mt-0.5 truncate max-w-[180px]">{cal.mail_account_email}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <button
          onClick={onAssign}
          className="text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded border border-outlook-border hover:bg-outlook-bg-hover"
        >
          <UsersIcon size={11} /> {cal.assignments?.length || 0}
        </button>
      </td>
      <td className="px-3 py-2 text-xs text-outlook-text-secondary">{cal.event_count}</td>
      <td className="px-3 py-2 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => setIsVisible(v => !v)}
              title={isVisible ? 'Visible' : 'Masqué'}
              className={`p-1.5 rounded hover:bg-outlook-bg-hover ${isVisible ? '' : 'opacity-40'}`}
            ><Eye size={14} /></button>
            <button
              onClick={() => onSave({ name, color, userId: ownerId || undefined, isVisible })}
              disabled={saving}
              className="p-1.5 rounded hover:bg-outlook-bg-hover text-green-600"
            ><Save size={14} /></button>
            <button onClick={onCancelEdit} className="p-1.5 rounded hover:bg-outlook-bg-hover"><X size={14} /></button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            <button title="Exporter .ics" onClick={onExport} className="p-1.5 rounded hover:bg-outlook-bg-hover"><Download size={14} /></button>
            <button title="Pousser vers CalDAV" onClick={onPush} className="p-1.5 rounded hover:bg-outlook-bg-hover"><CloudUpload size={14} /></button>
            <button title="Partages" onClick={onAssign} className="p-1.5 rounded hover:bg-outlook-bg-hover"><UserPlus size={14} /></button>
            <button title="Modifier" onClick={onStartEdit} className="p-1.5 rounded hover:bg-outlook-bg-hover"><Edit2 size={14} /></button>
            <button title="Supprimer" onClick={onDelete} className="p-1.5 rounded hover:bg-outlook-bg-hover text-red-600" disabled={cal.is_default}><Trash2 size={14} /></button>
          </div>
        )}
      </td>
    </tr>
  );
}

function AssignmentsDialog({ calendar, users, onClose }: { calendar: AdminCalendar; users: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [newUserId, setNewUserId] = useState('');
  const [newPermission, setNewPermission] = useState<Permission>('read');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-calendars'] });
  };

  const addMut = useMutation({
    mutationFn: () => api.addAdminCalendarAssignment(calendar.id, newUserId, newPermission),
    onSuccess: () => { toast.success('Accès ajouté'); setNewUserId(''); invalidate(); },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });

  const updateMut = useMutation({
    mutationFn: ({ userId, permission }: { userId: string; permission: Permission }) =>
      api.updateAdminCalendarAssignment(calendar.id, userId, permission),
    onSuccess: () => { toast.success('Permission mise à jour'); invalidate(); },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });

  const removeMut = useMutation({
    mutationFn: (userId: string) => api.removeAdminCalendarAssignment(calendar.id, userId),
    onSuccess: () => { toast.success('Accès retiré'); invalidate(); },
    onError: (e: any) => toast.error(e.message || 'Erreur'),
  });

  const availableUsers = users.filter(u =>
    u.id !== calendar.owner_id &&
    !calendar.assignments?.some(a => a.userId === u.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <div>
            <h3 className="font-semibold">Partages — {calendar.name}</h3>
            <p className="text-xs text-outlook-text-secondary">Propriétaire : {calendar.owner_email}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Existing */}
          <div>
            <h4 className="text-xs font-semibold mb-2 text-outlook-text-secondary uppercase tracking-wide">Utilisateurs avec accès</h4>
            {(!calendar.assignments || calendar.assignments.length === 0) ? (
              <div className="text-xs text-outlook-text-secondary py-3">Aucun partage pour le moment.</div>
            ) : (
              <div className="space-y-2">
                {calendar.assignments.map(a => (
                  <div key={a.userId} className="flex items-center gap-2 p-2 border border-outlook-border rounded">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.displayName || a.email}</div>
                      <div className="text-xs text-outlook-text-secondary truncate">{a.email}</div>
                    </div>
                    <select
                      value={a.permission}
                      onChange={(e) => updateMut.mutate({ userId: a.userId, permission: e.target.value as Permission })}
                      className="text-xs px-2 py-1 border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark"
                    >
                      {Object.entries(PERMISSION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => removeMut.mutate(a.userId)}
                      className="p-1.5 rounded hover:bg-outlook-bg-hover text-red-600"
                    ><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add */}
          <div className="pt-3 border-t border-outlook-border">
            <h4 className="text-xs font-semibold mb-2 text-outlook-text-secondary uppercase tracking-wide">Ajouter un accès</h4>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark"
              >
                <option value="">— Sélectionner un utilisateur —</option>
                {availableUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.email}</option>
                ))}
              </select>
              <select
                value={newPermission}
                onChange={(e) => setNewPermission(e.target.value as Permission)}
                className="px-2 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark"
              >
                {Object.entries(PERMISSION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                disabled={!newUserId || addMut.isPending}
                onClick={() => addMut.mutate()}
                className="px-3 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark disabled:opacity-50 flex items-center gap-1"
              >
                <Check size={14} /> Ajouter
              </button>
            </div>
            <div className="mt-3 text-[11px] text-outlook-text-secondary leading-relaxed">
              <p><b>Bloqué</b> : aucun accès. <b>Disponibilité</b> : voit seulement occupé/libre. <b>Occupé + titre</b> : titre des événements visible, pas les détails. <b>Lecture</b> : voit tous les détails. <b>Écriture</b> : peut créer/modifier. <b>Propriétaire</b> : peut aussi gérer les partages.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PushToCalDAVDialog({ calendar, mailAccounts, onClose }: { calendar: AdminCalendar; mailAccounts: any[]; onClose: () => void }) {
  const [accountId, setAccountId] = useState('');
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);

  const eligible = mailAccounts.filter((m: any) => m.caldav_url);

  const pushMut = useMutation({
    mutationFn: () => api.pushAdminCalendarToCaldav(calendar.id, accountId),
    onSuccess: (r: any) => {
      setLastResult({ ok: true, message: `${r.events} événement(s) envoyés à ${r.url}` });
      toast.success('Copie déposée sur CalDAV');
    },
    onError: (e: any) => {
      setLastResult({ ok: false, message: e.message || 'Erreur' });
      toast.error(e.message || 'Erreur');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <h3 className="font-semibold">Pousser vers CalDAV — {calendar.name}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-outlook-text-secondary">
            Dépose une copie .ics complète du calendrier sur le serveur CalDAV d'un compte mail (ex. O2Switch/SOGo). En cas de perte, le calendrier reste récupérable depuis l'hébergeur.
          </p>
          {eligible.length === 0 ? (
            <div className="text-sm text-red-600 flex items-center gap-2">
              <AlertCircle size={14} /> Aucun compte mail n'a d'URL CalDAV configurée.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">Compte mail cible</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark"
                >
                  <option value="">— Sélectionner —</option>
                  {eligible.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.email} ({m.caldav_url})</option>
                  ))}
                </select>
              </div>
              {lastResult && (
                <div className={`text-xs p-2 rounded ${lastResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  {lastResult.message}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outlook-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Fermer</button>
          <button
            disabled={!accountId || pushMut.isPending}
            onClick={() => pushMut.mutate()}
            className="px-3 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark disabled:opacity-50 flex items-center gap-1"
          >
            <CloudUpload size={14} /> Pousser
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportCaldavDialog({ users, onClose, onImported }: {
  users: any[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [url, setUrl] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [color, setColor] = useState('#0078D4');

  const importMut = useMutation({
    mutationFn: () => api.importAdminCalendarCaldav({
      url: url.trim(),
      ownerId,
      username: username.trim() || undefined,
      password: password || undefined,
      color,
    }),
    onSuccess: (r: any) => {
      if (r?.needsAuth) {
        setNeedsAuth(true);
        toast('Authentification requise — renseignez l\'identifiant et le mot de passe.', { icon: '🔒' });
        return;
      }
      toast.success(`${r.calendars} calendrier(s), ${r.events} événement(s) importés`);
      onImported();
      onClose();
    },
    onError: (e: any) => toast.error(e.message || 'Import impossible'),
  });

  const disabled = !url.trim() || !ownerId || importMut.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-outlook-blue" />
            <h3 className="font-semibold">Ajouter un calendrier via CalDAV</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-outlook-text-secondary">
            Renseignez l'URL CalDAV complète (ex. <code>https://colorant.o2switch.net:2080/calendars/testmail@villepavilly.fr/calendar</code>). Si le serveur exige des identifiants, ils vous seront demandés automatiquement.
          </p>

          <div>
            <label className="block text-xs font-medium mb-1">URL CalDAV</label>
            <input
              type="url"
              autoFocus
              value={url}
              placeholder="https://…"
              onChange={(e) => { setUrl(e.target.value); setNeedsAuth(false); }}
              className="w-full px-3 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Propriétaire</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark"
              >
                <option value="">— Sélectionner —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Couleur par défaut</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-12 border border-outlook-border rounded cursor-pointer"
              />
            </div>
          </div>

          {needsAuth && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3 text-xs text-yellow-900 dark:text-yellow-200 flex gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>Le serveur CalDAV demande une authentification. Renseignez l'identifiant et le mot de passe, puis relancez l'import.</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Identifiant {needsAuth ? <span className="text-red-600">*</span> : <span className="text-outlook-text-secondary">(si requis)</span>}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Mot de passe {needsAuth ? <span className="text-red-600">*</span> : <span className="text-outlook-text-secondary">(si requis)</span>}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-outlook-border rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outlook-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">
            Annuler
          </button>
          <button
            disabled={disabled}
            onClick={() => importMut.mutate()}
            className="px-3 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark disabled:opacity-50 flex items-center gap-2"
          >
            <CloudDownload size={14} />
            {importMut.isPending ? 'Import…' : 'Importer'}
          </button>
        </div>
      </div>
    </div>
  );
}
