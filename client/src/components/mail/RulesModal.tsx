import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Plus, Trash2, Pencil, Share2, Power, Search, Copy, GripVertical,
  ChevronUp, ChevronDown, Check, ListChecks,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, type MailRule } from '../../api';
import { summarizeRule } from '../../utils/mailRules';
import RuleWizard from './RuleWizard';
import RuleShareDialog from './RuleShareDialog';

interface RulesModalProps {
  onClose: () => void;
  /** Default account that pre-selects in the wizard. */
  defaultAccountId?: string | null;
}

/**
 * Outlook-style rules manager. Shows the user's rules with:
 *  - autocomplete search filter,
 *  - drag-and-drop reordering (also up/down arrows for accessibility),
 *  - inline toggle / rename / edit / share / duplicate / delete.
 * Triggers RuleWizard for create/edit (3-step Outlook flow).
 */
export default function RulesModal({ onClose, defaultAccountId }: RulesModalProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingRule, setEditingRule] = useState<MailRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [sharingRule, setSharingRule] = useState<MailRule | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['mail-rules'],
    queryFn: () => api.listMailRules(),
  });

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => api.getAccounts() });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const owned = rules.filter((r) => !r.sharedIn);
    if (!s) return owned;
    return owned.filter((r) =>
      r.name.toLowerCase().includes(s)
      || summarizeRule(r).toLowerCase().includes(s),
    );
  }, [rules, search]);

  const sharedWithMe = useMemo(() => rules.filter((r) => r.sharedIn), [rules]);

  const toggleM = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.toggleMailRule(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mail-rules'] }),
    onError: (e: any) => toast.error(e?.message || 'Erreur'),
  });

  const renameM = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameMailRule(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail-rules'] });
      setRenamingId(null);
    },
    onError: (e: any) => toast.error(e?.message || 'Erreur'),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => api.deleteMailRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail-rules'] });
      toast.success('Règle supprimée');
    },
    onError: (e: any) => toast.error(e?.message || 'Erreur'),
  });

  const reorderM = useMutation({
    mutationFn: (ids: string[]) => api.reorderMailRules(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ['mail-rules'] });
      const prev = qc.getQueryData<MailRule[]>(['mail-rules']);
      if (prev) {
        const map = new Map(prev.map((r) => [r.id, r]));
        const reordered = [
          ...ids.map((id, i) => ({ ...(map.get(id) as MailRule), position: i })).filter(Boolean),
          ...prev.filter((r) => !ids.includes(r.id)),
        ];
        qc.setQueryData<MailRule[]>(['mail-rules'], reordered);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['mail-rules'], ctx.prev);
      toast.error('Réorganisation impossible');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['mail-rules'] }),
  });

  const duplicateRule = async (rule: MailRule) => {
    try {
      await api.createMailRule({
        name: `${rule.name} (copie)`,
        enabled: false,
        matchType: rule.matchType,
        stopProcessing: rule.stopProcessing,
        accountId: rule.accountId,
        conditions: rule.conditions,
        exceptions: rule.exceptions,
        actions: rule.actions,
      });
      qc.invalidateQueries({ queryKey: ['mail-rules'] });
      toast.success('Règle dupliquée');
    } catch (e: any) {
      toast.error(e?.message || 'Erreur');
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const ids = filtered.map((r) => r.id);
    const idx = ids.indexOf(id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= ids.length) return;
    const reordered = [...ids];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    reorderM.mutate(reordered);
  };

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setHoverId(null);
      return;
    }
    const ids = filtered.map((r) => r.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggedId);
    setDraggedId(null);
    setHoverId(null);
    reorderM.mutate(reordered);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                   bg-white dark:bg-slate-900 rounded-lg shadow-xl
                   w-[920px] max-w-[96vw] h-[80vh] max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ListChecks size={18} /> Règles
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-b border-outlook-border">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une règle..."
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-outlook-border rounded
                         focus:outline-none focus:ring-1 focus:ring-outlook-blue"
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded
                       bg-outlook-blue text-white hover:bg-outlook-blue/90"
          >
            <Plus size={14} /> Nouvelle règle
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-6 text-sm text-outlook-text-secondary">Chargement…</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-outlook-text-secondary">
              {search ? 'Aucune règle ne correspond à votre recherche.' : 'Aucune règle. Créez-en une avec le bouton « Nouvelle règle ».'}
            </div>
          ) : (
            <ul className="divide-y divide-outlook-border">
              {filtered.map((rule, idx) => (
                <li
                  key={rule.id}
                  draggable
                  onDragStart={(e) => {
                    setDraggedId(rule.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHoverId(rule.id); }}
                  onDragLeave={() => setHoverId((h) => (h === rule.id ? null : h))}
                  onDrop={(e) => { e.preventDefault(); handleDrop(rule.id); }}
                  onDragEnd={() => { setDraggedId(null); setHoverId(null); }}
                  className={`flex items-start gap-2 px-3 py-2 ${hoverId === rule.id && draggedId !== rule.id ? 'bg-outlook-blue/5 outline outline-1 outline-outlook-blue/30' : ''} ${draggedId === rule.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex flex-col items-center pt-1.5 text-outlook-text-disabled cursor-grab">
                    <GripVertical size={14} />
                    <span className="text-[10px] mt-0.5">{idx + 1}</span>
                  </div>

                  <label className="flex items-center pt-1.5">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => toggleM.mutate({ id: rule.id, enabled: e.target.checked })}
                      className="w-4 h-4 accent-outlook-blue cursor-pointer"
                      title={rule.enabled ? 'Désactiver' : 'Activer'}
                    />
                  </label>

                  <div className="flex-1 min-w-0">
                    {renamingId === rule.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && renameValue.trim()) {
                              renameM.mutate({ id: rule.id, name: renameValue.trim() });
                            } else if (e.key === 'Escape') {
                              setRenamingId(null);
                            }
                          }}
                          className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
                        />
                        <button
                          onClick={() => renameValue.trim() && renameM.mutate({ id: rule.id, name: renameValue.trim() })}
                          className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-blue"
                        >
                          <Check size={14} />
                        </button>
                        <button onClick={() => setRenamingId(null)} className="p-1 rounded hover:bg-outlook-bg-hover">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="font-medium text-sm flex items-center gap-2">
                          <span className={rule.enabled ? '' : 'text-outlook-text-disabled line-through'}>{rule.name}</span>
                          {!rule.enabled && <span className="text-[10px] uppercase text-outlook-text-disabled">désactivée</span>}
                        </div>
                        <div className="text-xs text-outlook-text-secondary truncate">{summarizeRule(rule)}</div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <IconBtn title="Monter" onClick={() => move(rule.id, -1)} disabled={idx === 0}>
                      <ChevronUp size={14} />
                    </IconBtn>
                    <IconBtn title="Descendre" onClick={() => move(rule.id, 1)} disabled={idx === filtered.length - 1}>
                      <ChevronDown size={14} />
                    </IconBtn>
                    <IconBtn
                      title={rule.enabled ? 'Désactiver' : 'Activer'}
                      onClick={() => toggleM.mutate({ id: rule.id, enabled: !rule.enabled })}
                      active={rule.enabled}
                    >
                      <Power size={14} />
                    </IconBtn>
                    <IconBtn title="Modifier" onClick={() => setEditingRule(rule)}>
                      <Pencil size={14} />
                    </IconBtn>
                    <IconBtn
                      title="Renommer"
                      onClick={() => { setRenamingId(rule.id); setRenameValue(rule.name); }}
                    >
                      <span className="text-[11px] font-medium px-0.5">Aa</span>
                    </IconBtn>
                    <IconBtn title="Dupliquer" onClick={() => duplicateRule(rule)}>
                      <Copy size={14} />
                    </IconBtn>
                    <IconBtn title="Partager" onClick={() => setSharingRule(rule)}>
                      <Share2 size={14} />
                    </IconBtn>
                    <IconBtn
                      title="Supprimer"
                      onClick={() => {
                        if (confirm(`Supprimer la règle « ${rule.name} » ?`)) {
                          deleteM.mutate(rule.id);
                        }
                      }}
                      danger
                    >
                      <Trash2 size={14} />
                    </IconBtn>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {sharedWithMe.length > 0 && (
            <div className="px-3 py-2 border-t border-outlook-border bg-outlook-bg-primary">
              <div className="text-[10px] uppercase font-semibold text-outlook-text-disabled tracking-wide px-1">
                Règles partagées avec vous
              </div>
              <ul className="mt-1 space-y-0.5">
                {sharedWithMe.map((r) => (
                  <li key={r.id} className="text-xs text-outlook-text-secondary px-1 py-0.5">
                    <span className="font-medium">{r.name}</span> — <span className="italic">{r.ownerEmail || ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-5 py-2 border-t border-outlook-border flex items-center justify-between text-xs text-outlook-text-secondary">
          <span>{filtered.length} règle(s) — glissez-déposez pour modifier l'ordre</span>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            Fermer
          </button>
        </div>
      </div>

      {(creating || editingRule) && (
        <RuleWizard
          rule={editingRule}
          accounts={accounts}
          defaultAccountId={defaultAccountId || null}
          onClose={() => { setCreating(false); setEditingRule(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['mail-rules'] });
            setCreating(false);
            setEditingRule(null);
          }}
        />
      )}

      {sharingRule && (
        <RuleShareDialog
          rule={sharingRule}
          onClose={() => setSharingRule(null)}
        />
      )}
    </>,
    document.body,
  );
}

function IconBtn({
  children, onClick, title, disabled, danger, active,
}: {
  children: React.ReactNode; onClick: () => void; title: string;
  disabled?: boolean; danger?: boolean; active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors
        ${disabled ? 'opacity-30 cursor-default' : 'hover:bg-outlook-bg-hover cursor-pointer'}
        ${danger && !disabled ? 'hover:text-outlook-danger hover:bg-red-50' : ''}
        ${active ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`}
    >
      {children}
    </button>
  );
}
