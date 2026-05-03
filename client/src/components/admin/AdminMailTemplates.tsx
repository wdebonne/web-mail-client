import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Plus, Search, Edit2, Trash2, Share2, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, type MailTemplate } from '../../api';
import {
  MailTemplateEditor, MailTemplateShareEditor, emitTemplatesChanged,
} from '../mail/MailTemplates';

/**
 * Admin panel: full CRUD on every template (per user + global) and sharing.
 * Mirrors `AdminAutoResponders` patterns (header, search, table, modal editors).
 */
export default function AdminMailTemplates() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState<MailTemplate | null>(null);
  const [share, setShare] = useState<MailTemplate | null>(null);

  const { data: list = [], isLoading } = useQuery<MailTemplate[]>({
    queryKey: ['admin-mail-templates'],
    queryFn: () => api.adminListMailTemplates(),
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(t => {
      const hay = [t.name, t.subject, t.ownerEmail, t.ownerDisplayName].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [list, filter]);

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.adminDeleteMailTemplate(id),
    onSuccess: () => {
      toast.success('Modèle supprimé');
      queryClient.invalidateQueries({ queryKey: ['admin-mail-templates'] });
      queryClient.invalidateQueries({ queryKey: ['mail-templates'] });
      emitTemplatesChanged();
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const newTemplate: MailTemplate = {
    id: '', ownerUserId: null, ownerEmail: null, ownerDisplayName: null,
    name: '', subject: '', bodyHtml: '', isGlobal: false, scope: 'owned',
    createdAt: '', updatedAt: '',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-outlook-blue" />
          <h2 className="text-lg font-semibold text-outlook-text-primary">Modèles de mail</h2>
        </div>
        <button
          onClick={() => setEdit(newTemplate)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover"
        >
          <Plus size={14} /> Nouveau modèle
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer par nom, objet ou utilisateur…"
          className="w-full pl-8 pr-2 py-1.5 text-sm border border-outlook-border rounded outline-none focus:border-outlook-blue"
        />
      </div>

      <div className="border border-outlook-border rounded bg-white overflow-hidden">
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
                <th className="px-3 py-2 font-medium">Propriétaire</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-t border-outlook-border hover:bg-outlook-bg-hover">
                  <td className="px-3 py-2 font-medium text-outlook-text-primary">{t.name}</td>
                  <td className="px-3 py-2 text-outlook-text-secondary truncate max-w-[260px]" title={t.subject}>
                    {t.subject || <span className="text-outlook-text-disabled">—</span>}
                  </td>
                  <td className="px-3 py-2 text-outlook-text-secondary">
                    {t.isGlobal
                      ? <span className="text-violet-700">— Global —</span>
                      : (t.ownerDisplayName || t.ownerEmail || <span className="text-outlook-text-disabled">—</span>)}
                  </td>
                  <td className="px-3 py-2">
                    {t.isGlobal ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-2xs rounded bg-violet-100 text-violet-700">Global</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-2xs rounded bg-emerald-100 text-emerald-700">Personnel</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEdit(t)}
                        className="p-1.5 rounded hover:bg-outlook-bg-hover"
                        title="Modifier"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => setShare(t)}
                        className="p-1.5 rounded hover:bg-outlook-bg-hover"
                        title="Partager"
                        disabled={t.isGlobal}
                      >
                        <Share2 size={14} className={t.isGlobal ? 'opacity-30' : ''} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Supprimer le modèle « ${t.name} » ?`)) deleteMut.mutate(t.id);
                        }}
                        disabled={deleteMut.isPending}
                        className="p-1.5 rounded hover:bg-red-50 hover:text-outlook-danger disabled:opacity-30"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <MailTemplateEditor
          template={edit}
          isAdmin
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            queryClient.invalidateQueries({ queryKey: ['admin-mail-templates'] });
            queryClient.invalidateQueries({ queryKey: ['mail-templates'] });
            emitTemplatesChanged();
          }}
        />
      )}
      {share && (
        <MailTemplateShareEditor
          template={share}
          isAdmin
          onClose={() => setShare(null)}
        />
      )}
    </div>
  );
}
