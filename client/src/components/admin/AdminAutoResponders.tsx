import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Coffee, Plus, Search, X, Edit2, Power, Loader2, AlertCircle, CheckCircle2, Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import AutoResponderForm from '../mail/AutoResponderForm';

/**
 * Admin panel: list every auto-responder, filter by user/email/subject,
 * edit any of them, and create new ones for arbitrary users via an
 * autocompleted picker over the platform's mail accounts.
 */
export default function AdminAutoResponders() {
  const [filter, setFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [edit, setEdit] = useState<{ accountId: string; label: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const queryClient = useQueryClient();

  const { data: list = [], isLoading } = useQuery({
    queryKey: ['admin-auto-responders', activeOnly],
    queryFn: () => api.adminListAutoResponders(activeOnly),
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(r => {
      const haystack = [
        r.userEmail, r.userDisplayName, r.accountEmail, r.accountName, r.subject,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [list, filter]);

  const disableMutation = useMutation({
    mutationFn: (accountId: string) => api.adminDisableAutoResponder(accountId),
    onSuccess: () => {
      toast.success('Répondeur désactivé');
      queryClient.invalidateQueries({ queryKey: ['admin-auto-responders'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const isCurrentlyActive = (r: typeof list[number]): boolean => {
    if (!r.enabled) return false;
    if (!r.scheduled) return true;
    const now = Date.now();
    if (r.startAt && new Date(r.startAt).getTime() > now) return false;
    if (r.endAt && new Date(r.endAt).getTime() <= now) return false;
    return true;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Coffee size={20} className="text-outlook-blue" />
          <h2 className="text-lg font-semibold text-outlook-text-primary">Répondeurs automatiques</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover text-outlook-text-primary"
            title="Paramètres de la fonctionnalité"
          >
            <Settings size={14} /> Paramètres
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover"
          >
            <Plus size={14} /> Nouveau répondeur
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer (utilisateur, email, objet…)"
            className="w-full pl-7 pr-2 py-1.5 text-sm border border-outlook-border rounded bg-white"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-sm text-outlook-text-secondary">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Uniquement les répondeurs actifs
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-outlook-text-secondary">
          <Loader2 size={14} className="animate-spin" /> Chargement…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6 border border-dashed border-outlook-border rounded text-center text-sm text-outlook-text-secondary">
          Aucun répondeur {activeOnly ? 'actif' : 'configuré'}.
        </div>
      ) : (
        <div className="border border-outlook-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-outlook-bg-secondary text-left text-xs uppercase text-outlook-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Utilisateur</th>
                <th className="px-3 py-2 font-medium">Compte mail</th>
                <th className="px-3 py-2 font-medium">Objet</th>
                <th className="px-3 py-2 font-medium">Période</th>
                <th className="px-3 py-2 font-medium">État</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const live = isCurrentlyActive(r);
                return (
                  <tr key={r.id} className="border-t border-outlook-border hover:bg-outlook-bg-hover">
                    <td className="px-3 py-2">
                      <div className="font-medium text-outlook-text-primary">
                        {r.userDisplayName || r.userEmail}
                      </div>
                      {r.userDisplayName && (
                        <div className="text-xs text-outlook-text-secondary">{r.userEmail}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-outlook-text-primary">{r.accountEmail}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate" title={r.subject}>
                      {r.subject}
                    </td>
                    <td className="px-3 py-2 text-xs text-outlook-text-secondary whitespace-nowrap">
                      {r.scheduled ? (
                        <>
                          <div>Du {fmtDateTime(r.startAt)}</div>
                          <div>{r.endAt ? `au ${fmtDateTime(r.endAt)}` : 'jusqu\u2019à désactivation'}</div>
                        </>
                      ) : (
                        <div>Activé le {fmtDateTime(r.updatedAt || r.createdAt)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {live ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">
                          <CheckCircle2 size={12} /> Actif
                        </span>
                      ) : r.enabled ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800">
                          <AlertCircle size={12} /> Hors période
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-gray-200 text-gray-700">
                          Désactivé
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEdit({
                            accountId: r.accountId,
                            label: `${r.userDisplayName || r.userEmail} — ${r.accountEmail}`,
                          })}
                          className="p-1.5 hover:bg-outlook-bg-hover rounded"
                          title="Modifier"
                        >
                          <Edit2 size={14} />
                        </button>
                        {r.enabled && (
                          <button
                            onClick={() => {
                              if (confirm(`Désactiver le répondeur de ${r.accountEmail} ?`)) {
                                disableMutation.mutate(r.accountId);
                              }
                            }}
                            disabled={disableMutation.isPending}
                            className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-danger"
                            title="Désactiver"
                          >
                            <Power size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pickerOpen && (
        <CandidatePickerModal
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setPickerOpen(false);
            setEdit({
              accountId: c.accountId,
              label: `${c.userDisplayName || c.userEmail} — ${c.accountEmail}`,
            });
          }}
        />
      )}

      {edit && (
        <EditModal
          accountId={edit.accountId}
          label={edit.label}
          onClose={() => setEdit(null)}
        />
      )}

      {settingsOpen && <FeatureSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ----------------------------------------------------------------------------
// Candidate picker (autocomplete over all (user, mail-account) pairs).
// ----------------------------------------------------------------------------
function CandidatePickerModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (c: { accountId: string; userEmail: string; userDisplayName: string | null; accountEmail: string }) => void;
}) {
  const [q, setQ] = useState('');
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['admin-auto-responder-candidates', q],
    queryFn: () => api.adminListAutoResponderCandidates(q),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-xl mt-16"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h3 className="text-base font-semibold">Choisir un utilisateur / compte</h3>
          <button onClick={onClose} className="p-1 hover:bg-outlook-bg-hover rounded"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher par nom, email ou compte mail…"
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-outlook-border rounded bg-white"
            />
          </div>

          <div className="max-h-[50vh] overflow-y-auto border border-outlook-border rounded">
            {isLoading ? (
              <div className="p-4 text-sm text-outlook-text-secondary flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Recherche…
              </div>
            ) : candidates.length === 0 ? (
              <div className="p-4 text-sm text-outlook-text-secondary">Aucun résultat.</div>
            ) : (
              candidates.map(c => (
                <button
                  key={c.accountId}
                  onClick={() => onPick(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover border-b border-outlook-border last:border-b-0"
                >
                  <div className="font-medium text-outlook-text-primary">
                    {c.userDisplayName || c.userEmail}
                  </div>
                  <div className="text-xs text-outlook-text-secondary">
                    {c.userEmail !== c.accountEmail && <span>{c.userEmail} · </span>}
                    Compte : {c.accountEmail}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Edit modal: reuses AutoResponderForm in admin mode.
// ----------------------------------------------------------------------------
function EditModal({
  accountId,
  label,
  onClose,
}: {
  accountId: string;
  label: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl mt-8"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h3 className="text-base font-semibold">Répondeur — {label}</h3>
          <button onClick={onClose} className="p-1 hover:bg-outlook-bg-hover rounded"><X size={16} /></button>
        </div>
        <div className="p-4">
          <AutoResponderForm
            accountId={accountId}
            accounts={[]}
            adminMode
            adminAccountLabel={label}
            onSaved={onClose}
            compact
          />
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Feature settings modal: enable/disable globally + default check interval.
// ----------------------------------------------------------------------------
function FeatureSettingsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-auto-responder-feature-settings'],
    queryFn: api.adminGetAutoResponderFeatureSettings,
  });

  const [enabled, setEnabled] = useState(true);
  const [interval, setIntervalMin] = useState<number>(5);

  // Hydrate when data arrives.
  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setIntervalMin(data.defaultIntervalMinutes || 5);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.adminSaveAutoResponderFeatureSettings({
      enabled,
      defaultIntervalMinutes: interval,
    }),
    onSuccess: () => {
      toast.success('Paramètres enregistrés');
      queryClient.invalidateQueries({ queryKey: ['admin-auto-responder-feature-settings'] });
      queryClient.invalidateQueries({ queryKey: ['auto-responder-feature-settings'] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md mt-16"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h3 className="text-base font-semibold">Paramètres du Répondeur</h3>
          <button onClick={onClose} className="p-1 hover:bg-outlook-bg-hover rounded"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-outlook-text-secondary">
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => setEnabled(v => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-outlook-blue' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
                <span className="text-sm">
                  Fonction Répondeur {enabled ? 'activée' : 'désactivée'}
                </span>
              </label>
              <p className="text-xs text-outlook-text-secondary -mt-2 pl-14">
                Lorsqu'elle est désactivée, le bouton « Répondeur » du ruban et l'onglet
                « Répondeur » des paramètres utilisateur sont masqués, et aucune
                réponse automatique n'est envoyée.
              </p>

              <div className="flex flex-col gap-1">
                <label className="text-sm text-outlook-text-primary">
                  Durée par défaut entre chaque vérification
                </label>
                <select
                  value={interval}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  className="px-2 py-1.5 text-sm border border-outlook-border rounded bg-white"
                >
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes (recommandé)</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 heure</option>
                </select>
                <p className="text-xs text-outlook-text-secondary">
                  S'applique aux utilisateurs qui n'ont pas explicitement réglé
                  la fréquence dans leurs paramètres de messagerie.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-outlook-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
