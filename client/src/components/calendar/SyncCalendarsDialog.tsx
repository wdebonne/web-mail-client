import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, RefreshCw, CheckCircle2, AlertCircle, Calendar as CalendarIcon, Plug, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { api } from '../../api';

interface SyncCalendarsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface AccountRow {
  id: string;
  name: string;
  email: string;
  color?: string;
  username?: string;
  imap_host?: string;
  caldav_url?: string | null;
  caldav_username?: string | null;
  caldav_sync_enabled?: boolean;
  caldav_last_sync?: string | null;
  calendar_count?: number | string;
}

function suggestCaldavUrl(account: AccountRow): string {
  const host = account.imap_host || '';
  const u = account.username || account.email;
  // Heuristics for common providers
  if (/\bnextcloud\b/i.test(host) || /\bnc\./i.test(host)) {
    const base = host.replace(/^imap\./i, '').replace(/^mail\./i, '');
    return `https://${base}/remote.php/dav/calendars/${u}/`;
  }
  if (/o2switch|sogo/i.test(host)) {
    const base = host.replace(/^imap\./i, 'mail.');
    return `https://${base}/SOGo/dav/${u}/Calendar/`;
  }
  // Generic SOGo pattern
  const base = host.replace(/^imap\./i, 'mail.');
  return `https://${base}/SOGo/dav/${u}/`;
}

export function SyncCalendarsDialog({ open, onClose }: SyncCalendarsDialogProps) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { caldavUrl?: string; caldavUsername?: string; caldavSyncEnabled?: boolean }>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['calendar-accounts'],
    queryFn: () => api.getCalendarAccounts(),
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const payload = edits[accountId] || {};
      return api.updateAccountCaldav(accountId, payload);
    },
    onSuccess: (_, accountId) => {
      toast.success('Configuration enregistrée');
      setEdits(prev => { const n = { ...prev }; delete n[accountId]; return n; });
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] });
    },
    onError: (err: any) => toast.error(err.message || 'Échec de l\'enregistrement'),
  });

  const syncMutation = useMutation({
    mutationFn: async (accountId: string) => api.syncAccountCalendars(accountId),
    onSuccess: (data: any, accountId) => {
      toast.success(`${data.calendars} calendrier(s), ${data.events} événement(s) synchronisés`);
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] });
      qc.invalidateQueries({ queryKey: ['calendars'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      void accountId;
    },
    onError: (err: any) => toast.error(err.message || 'Échec de la synchronisation'),
  });

  const syncAllMutation = useMutation({
    mutationFn: () => api.syncAllCalendars(),
    onSuccess: (data: any) => {
      toast.success(`Synchronisation terminée (${data.synced} compte(s))`);
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] });
      qc.invalidateQueries({ queryKey: ['calendars'] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err: any) => toast.error(err.message || 'Échec de la synchronisation'),
  });

  const handleTest = async (account: AccountRow) => {
    const edit = edits[account.id] || {};
    const url = edit.caldavUrl ?? account.caldav_url ?? suggestCaldavUrl(account);
    const username = edit.caldavUsername ?? account.caldav_username ?? undefined;
    setTesting(t => ({ ...t, [account.id]: true }));
    try {
      const res = await api.testAccountCaldav(account.id, { caldavUrl: url, caldavUsername: username });
      if (res.ok) {
        const count = res.calendars?.length || 0;
        setTestResult(r => ({ ...r, [account.id]: { ok: true, message: `Connexion OK — ${count} calendrier(s) détecté(s)` } }));
      } else {
        setTestResult(r => ({ ...r, [account.id]: { ok: false, message: res.error || 'Connexion refusée' } }));
      }
    } catch (e: any) {
      setTestResult(r => ({ ...r, [account.id]: { ok: false, message: e.message || 'Erreur' } }));
    } finally {
      setTesting(t => ({ ...t, [account.id]: false }));
    }
  };

  if (!open) return null;

  const getValue = (account: AccountRow, key: 'caldavUrl' | 'caldavUsername'): string => {
    const edit = edits[account.id];
    if (edit && edit[key] !== undefined) return edit[key] as string;
    if (key === 'caldavUrl') return account.caldav_url || '';
    return account.caldav_username || '';
  };

  const getEnabled = (account: AccountRow): boolean => {
    const edit = edits[account.id];
    if (edit && edit.caldavSyncEnabled !== undefined) return edit.caldavSyncEnabled;
    return !!account.caldav_sync_enabled;
  };

  const setEdit = (id: string, patch: Partial<{ caldavUrl: string; caldavUsername: string; caldavSyncEnabled: boolean }>) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const hasEdits = (id: string) => !!edits[id] && Object.keys(edits[id]).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border dark:border-outlook-border-dark">
          <div className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-outlook-blue" />
            <h2 className="text-lg font-semibold">Synchroniser les calendriers (CalDAV)</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-outlook-hover-dark">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-10 text-gray-500">Aucun compte mail configuré.</div>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Renseignez l'URL CalDAV de votre serveur (par ex. votre hébergeur mail, NextCloud, SOGo…). Les identifiants IMAP du compte sont réutilisés par défaut.
              </p>

              {accounts.map((account: AccountRow) => {
                const urlValue = getValue(account, 'caldavUrl');
                const enabled = getEnabled(account);
                const result = testResult[account.id];
                return (
                  <div
                    key={account.id}
                    className="border border-outlook-border dark:border-outlook-border-dark rounded-lg p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: account.color || '#0078D4' }} />
                        <div className="min-w-0">
                          <div className="font-medium truncate">{account.name}</div>
                          <div className="text-xs text-gray-500 truncate">{account.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {account.caldav_last_sync && (
                          <span className="text-xs text-gray-500">
                            Dernière sync : {format(new Date(account.caldav_last_sync), 'dd MMM HH:mm', { locale: fr })}
                          </span>
                        )}
                        <span className="text-xs bg-gray-100 dark:bg-outlook-hover-dark px-2 py-0.5 rounded">
                          <CalendarIcon className="w-3 h-3 inline mr-1" />
                          {account.calendar_count || 0}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL CalDAV</label>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            value={urlValue}
                            placeholder={suggestCaldavUrl(account)}
                            onChange={(e) => setEdit(account.id, { caldavUrl: e.target.value })}
                            className="flex-1 px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                          />
                          <button
                            type="button"
                            onClick={() => setEdit(account.id, { caldavUrl: suggestCaldavUrl(account) })}
                            className="px-3 py-1.5 text-xs border border-outlook-border dark:border-outlook-border-dark rounded hover:bg-gray-50 dark:hover:bg-outlook-hover-dark"
                          >
                            Suggérer
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          Utilisateur CalDAV (optionnel)
                        </label>
                        <input
                          type="text"
                          value={getValue(account, 'caldavUsername')}
                          placeholder={account.username || account.email}
                          onChange={(e) => setEdit(account.id, { caldavUsername: e.target.value })}
                          className="w-full px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                        />
                      </div>

                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => setEdit(account.id, { caldavSyncEnabled: e.target.checked })}
                            className="rounded"
                          />
                          Activer la synchronisation automatique
                        </label>
                      </div>
                    </div>

                    {result && (
                      <div className={`text-xs flex items-center gap-1 ${result.ok ? 'text-green-600' : 'text-red-600'}`}>
                        {result.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {result.message}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={testing[account.id]}
                        onClick={() => handleTest(account)}
                        className="px-3 py-1.5 text-xs border border-outlook-border dark:border-outlook-border-dark rounded hover:bg-gray-50 dark:hover:bg-outlook-hover-dark disabled:opacity-50"
                      >
                        {testing[account.id] ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                        Tester
                      </button>
                      <button
                        type="button"
                        disabled={!hasEdits(account.id) || saveMutation.isPending}
                        onClick={() => saveMutation.mutate(account.id)}
                        className="px-3 py-1.5 text-xs border border-outlook-border dark:border-outlook-border-dark rounded hover:bg-gray-50 dark:hover:bg-outlook-hover-dark disabled:opacity-50"
                      >
                        Enregistrer
                      </button>
                      <button
                        type="button"
                        disabled={!account.caldav_url || syncMutation.isPending}
                        onClick={() => syncMutation.mutate(account.id)}
                        className="px-3 py-1.5 text-xs bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${syncMutation.isPending && syncMutation.variables === account.id ? 'animate-spin' : ''}`} />
                        Synchroniser
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-outlook-border dark:border-outlook-border-dark">
          <button
            type="button"
            disabled={syncAllMutation.isPending}
            onClick={() => syncAllMutation.mutate()}
            className="px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded hover:bg-gray-50 dark:hover:bg-outlook-hover-dark disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${syncAllMutation.isPending ? 'animate-spin' : ''}`} />
            Synchroniser tous les comptes actifs
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
