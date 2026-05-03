import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ChevronDown, ChevronRight, Filter, Pencil, Power, Trash2,
  User as UserIcon, Users as UsersIcon, ListChecks,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, type MailRule, type AdminMailRulesResponse } from '../../api';
import { summarizeRule } from '../../utils/mailRules';
import RuleWizard from '../mail/RuleWizard';

type View = 'all' | 'user' | 'group';

/**
 * Centralised admin view of every user's rules.
 *  - Toggle view: All / By user / By group
 *  - Autocomplete search (rule name + user/group hints)
 *  - Expandable accordion groups for clearer hierarchy.
 */
export default function AdminRulesManagement() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filterUserId, setFilterUserId] = useState<string | null>(null);
  const [filterGroupId, setFilterGroupId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSuggest, setShowSuggest] = useState(false);
  const [editingRule, setEditingRule] = useState<MailRule | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: directory } = useQuery({
    queryKey: ['admin-rules-directory'],
    queryFn: () => api.adminMailRulesDirectory(),
  });

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => api.getAccounts() });

  const { data, isLoading } = useQuery<AdminMailRulesResponse>({
    queryKey: ['admin-mail-rules', view, debounced, filterUserId, filterGroupId],
    queryFn: () => api.adminListMailRules({
      view,
      q: debounced || undefined,
      userId: filterUserId || undefined,
      groupId: filterGroupId || undefined,
    }),
  });

  const toggleM = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.adminToggleMailRule(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mail-rules'] }),
    onError: (e: any) => toast.error(e?.message || 'Erreur'),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => api.adminDeleteMailRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-mail-rules'] });
      toast.success('Règle supprimée');
    },
    onError: (e: any) => toast.error(e?.message || 'Erreur'),
  });

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !directory) return { users: [], groups: [] };
    return {
      users: (directory.users || [])
        .filter((u: any) => (u.email || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q))
        .slice(0, 5),
      groups: (directory.groups || [])
        .filter((g: any) => (g.name || '').toLowerCase().includes(q))
        .slice(0, 5),
    };
  }, [search, directory]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const clearFilters = () => {
    setFilterUserId(null);
    setFilterGroupId(null);
    setSearch('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ListChecks size={18} /> Règles — gestion centralisée
          </h2>
          <p className="text-xs text-outlook-text-secondary mt-0.5">
            Visualisez et administrez les règles de tous les utilisateurs et groupes.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[280px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            placeholder="Rechercher une règle, un utilisateur ou un groupe…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-outlook-border rounded
                       focus:outline-none focus:ring-1 focus:ring-outlook-blue"
          />
          {showSuggest && (suggestions.users.length > 0 || suggestions.groups.length > 0) && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-outlook-border rounded shadow-lg py-1 max-h-72 overflow-y-auto">
              {suggestions.users.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-outlook-blue">Utilisateurs</div>
                  {suggestions.users.map((u: any) => (
                    <button
                      key={u.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFilterUserId(u.id); setFilterGroupId(null);
                        setView('user'); setSearch(''); setShowSuggest(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover flex items-center gap-2"
                    >
                      <UserIcon size={12} /> {u.display_name || u.email} <span className="text-outlook-text-disabled">({u.email})</span>
                    </button>
                  ))}
                </>
              )}
              {suggestions.groups.length > 0 && (
                <>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-outlook-blue">Groupes</div>
                  {suggestions.groups.map((g: any) => (
                    <button
                      key={g.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFilterGroupId(g.id); setFilterUserId(null);
                        setView('group'); setSearch(''); setShowSuggest(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover flex items-center gap-2"
                    >
                      <UsersIcon size={12} /> {g.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 border border-outlook-border rounded">
          {(['all', 'user', 'group'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded transition
                ${view === v ? 'bg-outlook-blue text-white' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
            >
              {v === 'all' ? 'Toutes les règles' : v === 'user' ? 'Par utilisateur' : 'Par groupe'}
            </button>
          ))}
        </div>

        {(filterUserId || filterGroupId) && (
          <button
            onClick={clearFilters}
            className="px-2 py-1 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            Effacer le filtre
          </button>
        )}
      </div>

      {/* Body */}
      <div className="bg-white border border-outlook-border rounded">
        {isLoading || !data ? (
          <div className="px-4 py-6 text-sm text-outlook-text-secondary">Chargement…</div>
        ) : data.view === 'all' ? (
          <FlatRulesTable
            rules={data.rules}
            onToggle={(id, enabled) => toggleM.mutate({ id, enabled })}
            onDelete={(id, name) => { if (confirm(`Supprimer « ${name} » ?`)) deleteM.mutate(id); }}
            onEdit={(r) => setEditingRule(r)}
          />
        ) : (
          <ul className="divide-y divide-outlook-border">
            {(data.groups as any[]).length === 0 && (
              <li className="px-4 py-6 text-sm text-outlook-text-secondary">Aucun résultat.</li>
            )}
            {(data.groups as any[]).map((g) => {
              const key = data.view === 'user' ? `u:${g.userId}` : `g:${g.groupId || 'none'}`;
              const isOpen = expanded.has(key);
              const label = data.view === 'user'
                ? (g.userDisplayName || g.userEmail || g.userId)
                : (g.groupName || 'Sans groupe');
              return (
                <li key={key}>
                  <button
                    onClick={() => toggleExpand(key)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-outlook-bg-hover text-left"
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {data.view === 'user' ? <UserIcon size={14} /> : <UsersIcon size={14} />}
                    <span className="font-medium text-sm flex-1">{label}</span>
                    {data.view === 'user' && g.userEmail && g.userDisplayName && (
                      <span className="text-xs text-outlook-text-disabled">{g.userEmail}</span>
                    )}
                    <span className="text-xs px-2 py-0.5 bg-outlook-bg-primary text-outlook-text-secondary rounded">
                      {g.rules.length} règle(s)
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-outlook-border bg-outlook-bg-primary/30">
                      <FlatRulesTable
                        rules={g.rules}
                        compact
                        onToggle={(id, enabled) => toggleM.mutate({ id, enabled })}
                        onDelete={(id, name) => { if (confirm(`Supprimer « ${name} » ?`)) deleteM.mutate(id); }}
                        onEdit={(r) => setEditingRule(r)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editingRule && (
        <RuleWizard
          rule={editingRule}
          accounts={accounts}
          defaultAccountId={editingRule.accountId}
          isAdmin
          onClose={() => setEditingRule(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['admin-mail-rules'] });
            setEditingRule(null);
          }}
        />
      )}
    </div>
  );
}

function FlatRulesTable({
  rules, onToggle, onDelete, onEdit, compact,
}: {
  rules: MailRule[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string, name: string) => void;
  onEdit: (r: MailRule) => void;
  compact?: boolean;
}) {
  if (rules.length === 0) {
    return <div className="px-4 py-4 text-sm text-outlook-text-secondary italic">Aucune règle.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className={compact ? 'sr-only' : 'bg-outlook-bg-primary text-xs uppercase text-outlook-text-secondary'}>
        <tr>
          <th className="text-left px-3 py-2 font-medium">État</th>
          <th className="text-left px-3 py-2 font-medium">Nom</th>
          {!compact && <th className="text-left px-3 py-2 font-medium">Propriétaire</th>}
          <th className="text-left px-3 py-2 font-medium">Résumé</th>
          <th className="text-right px-3 py-2 font-medium">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-outlook-border">
        {rules.map((r) => (
          <tr key={r.id} className="hover:bg-outlook-bg-hover">
            <td className="px-3 py-2 w-12">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => onToggle(r.id, e.target.checked)}
                className="w-4 h-4 accent-outlook-blue cursor-pointer"
              />
            </td>
            <td className="px-3 py-2">
              <div className={`font-medium ${r.enabled ? '' : 'text-outlook-text-disabled line-through'}`}>{r.name}</div>
            </td>
            {!compact && (
              <td className="px-3 py-2 text-xs text-outlook-text-secondary">
                {r.ownerDisplayName || r.userDisplayName || r.ownerEmail || r.userEmail || '—'}
              </td>
            )}
            <td className="px-3 py-2 text-xs text-outlook-text-secondary truncate max-w-md">
              {summarizeRule(r)}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap">
              <button
                onClick={() => onToggle(r.id, !r.enabled)}
                title={r.enabled ? 'Désactiver' : 'Activer'}
                className={`p-1.5 rounded hover:bg-outlook-bg-hover ${r.enabled ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`}
              >
                <Power size={14} />
              </button>
              <button
                onClick={() => onEdit(r)}
                title="Modifier"
                className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => onDelete(r.id, r.name)}
                title="Supprimer"
                className="p-1.5 rounded hover:bg-red-50 text-outlook-text-secondary hover:text-outlook-danger"
              >
                <Trash2 size={14} />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
