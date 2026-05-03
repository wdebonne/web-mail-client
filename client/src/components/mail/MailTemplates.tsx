import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, X, FileText, Plus, Edit2, Trash2, Share2, Globe, User as UserIcon,
  Users as UsersIcon, Loader2, Save,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, type MailTemplate, type MailTemplateShare } from '../../api';

export const TEMPLATES_CHANGED_EVENT = 'mail.templates.changed';

export function emitTemplatesChanged() {
  window.dispatchEvent(new CustomEvent(TEMPLATES_CHANGED_EVENT));
}

// ─────────────────────────────────────────────────────────────────────────────
// Picker — Insert a template into the current compose window.
// Called from the ribbon "Insérer > Modèles" button.
// ─────────────────────────────────────────────────────────────────────────────
export function MailTemplatePickerModal({
  onClose, onInsert, onOpenManager,
}: {
  onClose: () => void;
  onInsert: (tpl: MailTemplate) => void;
  onOpenManager: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['mail-templates'],
    queryFn: api.listMailTemplates,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t => {
      const hay = [t.name, t.subject].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [templates, query]);

  // Auto-pick the first match for keyboard-driven flow.
  useEffect(() => {
    if (!filtered.length) { setSelectedId(null); return; }
    if (!filtered.some(t => t.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find(t => t.id === selectedId) || null;
  const showPreviewCards = filtered.length > 0 && filtered.length <= 3;

  const insertSelected = () => {
    if (selected) {
      onInsert(selected);
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-outlook-border w-[640px] max-w-[95vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-outlook-border">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-outlook-blue" />
            <h2 className="text-sm font-semibold text-outlook-text-primary">Modèles de mail</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onOpenManager(); onClose(); }}
              className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
              title="Gérer mes modèles"
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
              title="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-4 pt-3 pb-2 border-b border-outlook-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); insertSelected(); }
                if (e.key === 'Escape') onClose();
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (filtered.length === 0) return;
                  const idx = filtered.findIndex(t => t.id === selectedId);
                  const next = e.key === 'ArrowDown'
                    ? Math.min(idx + 1, filtered.length - 1)
                    : Math.max(idx - 1, 0);
                  setSelectedId(filtered[next].id);
                }
              }}
              placeholder="Rechercher un modèle…"
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-outlook-border rounded bg-white focus:border-outlook-blue outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-outlook-text-secondary p-6 justify-center">
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-outlook-text-secondary">
              {templates.length === 0
                ? 'Aucun modèle. Vous pouvez en créer depuis la fenêtre de composition (menu « Plus » → « Enregistrer comme modèle »).'
                : 'Aucun modèle ne correspond à la recherche.'}
            </div>
          ) : showPreviewCards ? (
            <div className="p-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${filtered.length}, minmax(0, 1fr))` }}>
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  onDoubleClick={() => { onInsert(t); onClose(); }}
                  className={`text-left flex flex-col gap-1 border rounded p-2 hover:border-outlook-blue transition-colors
                    ${selectedId === t.id ? 'border-outlook-blue ring-2 ring-outlook-blue/20' : 'border-outlook-border'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm text-outlook-text-primary truncate flex-1">{t.name}</span>
                    <ScopeBadge scope={t.scope} />
                  </div>
                  {t.subject && (
                    <div className="text-xs text-outlook-text-secondary truncate" title={t.subject}>
                      <span className="text-outlook-text-disabled">Objet : </span>{t.subject}
                    </div>
                  )}
                  <div
                    className="mt-1 text-xs text-outlook-text-secondary border border-outlook-border rounded p-2 bg-outlook-bg-primary/40 overflow-hidden"
                    style={{ maxHeight: 180 }}
                    dangerouslySetInnerHTML={{ __html: t.bodyHtml || '<em class="text-outlook-text-disabled">Corps vide</em>' }}
                  />
                </button>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-outlook-border">
              {filtered.map(t => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    onDoubleClick={() => { onInsert(t); onClose(); }}
                    className={`w-full text-left flex items-center gap-2 px-4 py-2 hover:bg-outlook-bg-hover
                      ${selectedId === t.id ? 'bg-outlook-blue/5' : ''}`}
                  >
                    <FileText size={14} className="text-outlook-text-disabled flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-outlook-text-primary truncate">{t.name}</div>
                      {t.subject && (
                        <div className="text-xs text-outlook-text-secondary truncate">{t.subject}</div>
                      )}
                    </div>
                    <ScopeBadge scope={t.scope} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-outlook-border bg-outlook-bg-primary/40">
          <div className="text-xs text-outlook-text-secondary truncate">
            {selected ? selected.name : `${filtered.length} modèle(s)`}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover"
            >
              Annuler
            </button>
            <button
              onClick={insertSelected}
              disabled={!selected}
              className="px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
            >
              Insérer
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ScopeBadge({ scope }: { scope: 'owned' | 'global' | 'shared' }) {
  if (scope === 'global') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded bg-violet-100 text-violet-700">
        <Globe size={10} /> Global
      </span>
    );
  }
  if (scope === 'shared') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded bg-blue-100 text-blue-700">
        <Share2 size={10} /> Partagé
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded bg-emerald-100 text-emerald-700">
      <UserIcon size={10} /> Personnel
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager — Edit / rename / delete / share my templates.
// ─────────────────────────────────────────────────────────────────────────────
export function MailTemplatesManagerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<MailTemplate | null>(null);
  const [showSharing, setShowSharing] = useState<MailTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['mail-templates'],
    queryFn: api.listMailTemplates,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t => t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q));
  }, [templates, query]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteMailTemplate(id),
    onSuccess: () => {
      toast.success('Modèle supprimé');
      queryClient.invalidateQueries({ queryKey: ['mail-templates'] });
      emitTemplatesChanged();
    },
    onError: (e: any) => toast.error(e?.message || 'Échec de la suppression'),
  });

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl border border-outlook-border w-[760px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-outlook-border">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-outlook-blue" />
            <h2 className="text-sm font-semibold text-outlook-text-primary">Gérer mes modèles</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-outlook-bg-hover">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 border-b border-outlook-border flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue"
            />
          </div>
          <button
            onClick={() => setEditing({
              id: '', ownerUserId: null, ownerEmail: null, ownerDisplayName: null,
              name: '', subject: '', bodyHtml: '', isGlobal: false, scope: 'owned',
              createdAt: '', updatedAt: '',
            })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover"
          >
            <Plus size={14} /> Nouveau
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-outlook-text-secondary p-6 justify-center">
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-outlook-text-secondary">
              Aucun modèle.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-outlook-bg-secondary text-left text-xs uppercase text-outlook-text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">Nom</th>
                  <th className="px-3 py-2 font-medium">Objet</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const canEdit = t.scope === 'owned';
                  return (
                    <tr key={t.id} className="border-t border-outlook-border hover:bg-outlook-bg-hover">
                      <td className="px-3 py-2 font-medium text-outlook-text-primary">{t.name}</td>
                      <td className="px-3 py-2 text-outlook-text-secondary truncate max-w-[260px]" title={t.subject}>
                        {t.subject || <span className="text-outlook-text-disabled">—</span>}
                      </td>
                      <td className="px-3 py-2"><ScopeBadge scope={t.scope} /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditing(t)}
                            disabled={!canEdit}
                            className="p-1.5 rounded hover:bg-outlook-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
                            title={canEdit ? 'Modifier / renommer' : 'Lecture seule (modèle partagé ou global)'}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => setShowSharing(t)}
                            disabled={!canEdit}
                            className="p-1.5 rounded hover:bg-outlook-bg-hover disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Partager"
                          >
                            <Share2 size={14} />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Supprimer le modèle « ${t.name} » ?`)) deleteMut.mutate(t.id);
                            }}
                            disabled={!canEdit || deleteMut.isPending}
                            className="p-1.5 rounded hover:bg-red-50 hover:text-outlook-danger disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {editing && (
          <MailTemplateEditor
            template={editing}
            isAdmin={false}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              queryClient.invalidateQueries({ queryKey: ['mail-templates'] });
              emitTemplatesChanged();
            }}
          />
        )}

        {showSharing && (
          <MailTemplateShareEditor
            template={showSharing}
            isAdmin={false}
            onClose={() => setShowSharing(null)}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor — create / edit a template (used by user manager and admin panel).
// ─────────────────────────────────────────────────────────────────────────────
export function MailTemplateEditor({
  template, isAdmin, onClose, onSaved,
}: {
  template: MailTemplate;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !template.id;
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml);
  const [isGlobal, setIsGlobal] = useState(template.isGlobal);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(template.ownerUserId);

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users-for-templates'],
    queryFn: () => api.getAdminUsers(),
    enabled: isAdmin,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), subject: subject.trim(), bodyHtml };
      if (isAdmin) {
        const adminPayload = { ...payload, isGlobal, ownerUserId };
        return isCreate
          ? api.adminCreateMailTemplate(adminPayload)
          : api.adminUpdateMailTemplate(template.id, adminPayload);
      }
      return isCreate
        ? api.createMailTemplate(payload)
        : api.updateMailTemplate(template.id, payload);
    },
    onSuccess: () => {
      toast.success(isCreate ? 'Modèle créé' : 'Modèle mis à jour');
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl border border-outlook-border w-[720px] max-w-[95vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-outlook-border">
          <h2 className="text-sm font-semibold text-outlook-text-primary">
            {isCreate ? 'Nouveau modèle' : `Modifier le modèle : ${template.name}`}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-outlook-bg-hover">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-outlook-text-secondary mb-1">Nom *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex. Réponse demande de devis"
              className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-outlook-text-secondary mb-1">Objet</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objet du mail"
              className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-outlook-text-secondary mb-1">Corps</label>
            <div
              contentEditable
              suppressContentEditableWarning
              className="w-full min-h-[220px] px-3 py-2 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue overflow-y-auto"
              style={{ maxHeight: 320 }}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
              onBlur={(e) => setBodyHtml((e.target as HTMLDivElement).innerHTML)}
            />
            <p className="text-2xs text-outlook-text-disabled mt-1">
              Astuce : créez le contenu depuis la fenêtre de composition pour plus de mise en forme,
              puis enregistrez avec « Plus → Enregistrer comme modèle ».
            </p>
          </div>

          {isAdmin && (
            <div className="border-t border-outlook-border pt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isGlobal}
                  onChange={(e) => {
                    setIsGlobal(e.target.checked);
                    if (e.target.checked) setOwnerUserId(null);
                  }}
                />
                <Globe size={14} className="text-violet-600" />
                <span>Modèle global (visible par tous les utilisateurs)</span>
              </label>
              {!isGlobal && (
                <div>
                  <label className="block text-xs font-medium text-outlook-text-secondary mb-1">
                    Propriétaire
                  </label>
                  <select
                    value={ownerUserId || ''}
                    onChange={(e) => setOwnerUserId(e.target.value || null)}
                    className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded bg-white"
                  >
                    <option value="">— Sélectionner un utilisateur —</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name || u.email} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-outlook-border bg-outlook-bg-primary/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!name.trim() || saveMut.isPending || (isAdmin && !isGlobal && !ownerUserId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
          >
            {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Share editor — manage user/group shares for a template.
// ─────────────────────────────────────────────────────────────────────────────
export function MailTemplateShareEditor({
  template, isAdmin, onClose,
}: {
  template: MailTemplate;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const sharesKey = isAdmin ? ['admin-mail-template-shares', template.id] : ['mail-template-shares', template.id];
  const { data: shares = [], isLoading } = useQuery<MailTemplateShare[]>({
    queryKey: sharesKey,
    queryFn: () => isAdmin ? api.adminListMailTemplateShares(template.id) : api.listMailTemplateShares(template.id),
  });
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users-for-share'],
    queryFn: () => api.getAdminUsers(),
  });
  const { data: groups = [] } = useQuery({
    queryKey: ['admin-groups-for-share'],
    queryFn: () => api.getAdminGroups(),
  });

  const [pickType, setPickType] = useState<'user' | 'group'>('user');
  const [pickId, setPickId] = useState('');
  const [filter, setFilter] = useState('');

  const addMut = useMutation({
    mutationFn: () => {
      const payload = pickType === 'user'
        ? { userId: pickId, groupId: null }
        : { userId: null, groupId: pickId };
      return isAdmin
        ? api.adminShareMailTemplate(template.id, payload)
        : api.shareMailTemplate(template.id, payload);
    },
    onSuccess: () => {
      setPickId('');
      toast.success('Partage ajouté');
      queryClient.invalidateQueries({ queryKey: sharesKey });
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const removeMut = useMutation({
    mutationFn: (shareId: string) =>
      isAdmin ? api.adminUnshareMailTemplate(template.id, shareId) : api.unshareMailTemplate(template.id, shareId),
    onSuccess: () => {
      toast.success('Partage retiré');
      queryClient.invalidateQueries({ queryKey: sharesKey });
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u: any) =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q),
    );
  }, [users, filter]);
  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g: any) => (g.name || '').toLowerCase().includes(q));
  }, [groups, filter]);

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl border border-outlook-border w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-outlook-border">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-outlook-blue" />
            <h2 className="text-sm font-semibold text-outlook-text-primary">
              Partager : {template.name}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-outlook-bg-hover">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <div className="border border-outlook-border rounded p-3 space-y-2">
            <div className="text-xs font-medium text-outlook-text-secondary">Ajouter un partage</div>
            <div className="flex gap-2">
              <button
                onClick={() => { setPickType('user'); setPickId(''); }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded border
                  ${pickType === 'user' ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue' : 'border-outlook-border'}`}
              >
                <UserIcon size={12} /> Utilisateur
              </button>
              <button
                onClick={() => { setPickType('group'); setPickId(''); }}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 text-xs rounded border
                  ${pickType === 'group' ? 'border-outlook-blue bg-outlook-blue/10 text-outlook-blue' : 'border-outlook-border'}`}
              >
                <UsersIcon size={12} /> Groupe
              </button>
            </div>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrer…"
              className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue"
            />
            <select
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
              size={6}
              className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded bg-white"
            >
              {pickType === 'user'
                ? filteredUsers.map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name || u.email} ({u.email})
                    </option>
                  ))
                : filteredGroups.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))
              }
            </select>
            <button
              onClick={() => addMut.mutate()}
              disabled={!pickId || addMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
            >
              <Plus size={14} /> Partager
            </button>
          </div>

          <div>
            <div className="text-xs font-medium text-outlook-text-secondary mb-1">Partages actuels</div>
            {isLoading ? (
              <div className="text-sm text-outlook-text-secondary">Chargement…</div>
            ) : shares.length === 0 ? (
              <div className="text-sm text-outlook-text-secondary p-3 border border-dashed border-outlook-border rounded text-center">
                Ce modèle n'est partagé avec personne.
              </div>
            ) : (
              <ul className="border border-outlook-border rounded divide-y divide-outlook-border">
                {shares.map(s => (
                  <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      {s.userId ? <UserIcon size={14} className="text-outlook-text-disabled" />
                                 : <UsersIcon size={14} className="text-outlook-text-disabled" />}
                      <span className="truncate">
                        {s.userId
                          ? (s.userDisplayName || s.userEmail || s.userId)
                          : (s.groupName || s.groupId)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeMut.mutate(s.id)}
                      disabled={removeMut.isPending}
                      className="p-1.5 rounded hover:bg-red-50 hover:text-outlook-danger disabled:opacity-50"
                      title="Retirer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-outlook-border bg-outlook-bg-primary/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Save-as-template dialog — used from the compose "Plus" menu.
// ─────────────────────────────────────────────────────────────────────────────
export function SaveAsTemplateDialog({
  initialName, subject, bodyHtml, onClose, onSaved,
}: {
  initialName?: string;
  subject: string;
  bodyHtml: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName || subject || '');
  const queryClient = useQueryClient();
  const saveMut = useMutation({
    mutationFn: () => api.createMailTemplate({ name: name.trim(), subject, bodyHtml }),
    onSuccess: () => {
      toast.success('Modèle enregistré');
      queryClient.invalidateQueries({ queryKey: ['mail-templates'] });
      emitTemplatesChanged();
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl border border-outlook-border w-[420px] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-outlook-border">
          <h2 className="text-sm font-semibold">Enregistrer comme modèle</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-outlook-bg-hover">
            <X size={14} />
          </button>
        </div>
        <div className="p-4">
          <label className="block text-xs font-medium text-outlook-text-secondary mb-1">Nom du modèle *</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) saveMut.mutate();
              if (e.key === 'Escape') onClose();
            }}
            placeholder="ex. Réponse standard"
            className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue"
          />
          <p className="text-2xs text-outlook-text-disabled mt-2">
            L'objet et le corps actuel du mail seront enregistrés dans le modèle.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-outlook-border bg-outlook-bg-primary/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!name.trim() || saveMut.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
          >
            {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
