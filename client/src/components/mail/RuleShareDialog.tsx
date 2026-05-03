import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X, Plus, Trash2, User as UserIcon, Users as UsersIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, type MailRule, type MailRuleShare } from '../../api';

interface Props {
  rule: MailRule;
  onClose: () => void;
}

/** Share a rule with users or groups (Outlook-style). */
export default function RuleShareDialog({ rule, onClose }: Props) {
  const qc = useQueryClient();
  const sharesKey = ['mail-rule-shares', rule.id];
  const { data: shares = [], isLoading } = useQuery<MailRuleShare[]>({
    queryKey: sharesKey,
    queryFn: () => api.listMailRuleShares(rule.id),
  });
  const { data: users = [] } = useQuery({ queryKey: ['admin-users-for-share'], queryFn: () => api.getAdminUsers() });
  const { data: groups = [] } = useQuery({ queryKey: ['admin-groups-for-share'], queryFn: () => api.getAdminGroups() });

  const [pickType, setPickType] = useState<'user' | 'group'>('user');
  const [pickId, setPickId] = useState('');
  const [filter, setFilter] = useState('');

  const addMut = useMutation({
    mutationFn: () => api.shareMailRule(rule.id, pickType === 'user'
      ? { userId: pickId, groupId: null }
      : { userId: null, groupId: pickId }),
    onSuccess: () => {
      setPickId('');
      toast.success('Partage ajouté');
      qc.invalidateQueries({ queryKey: sharesKey });
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => api.unshareMailRule(rule.id, id),
    onSuccess: () => {
      toast.success('Partage retiré');
      qc.invalidateQueries({ queryKey: sharesKey });
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return (users as any[]).filter((u) =>
      (u.email || '').toLowerCase().includes(q)
      || (u.display_name || '').toLowerCase().includes(q));
  }, [users, filter]);
  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return (groups as any[]).filter((g) => (g.name || '').toLowerCase().includes(q));
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
            <h2 className="text-sm font-semibold text-outlook-text-primary">Partager : {rule.name}</h2>
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
                    <option key={u.id} value={u.id}>{u.display_name || u.email} ({u.email})</option>
                  ))
                : filteredGroups.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
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
                Cette règle n'est partagée avec personne.
              </div>
            ) : (
              <ul className="border border-outlook-border rounded divide-y divide-outlook-border">
                {shares.map((s) => (
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
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover">
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
