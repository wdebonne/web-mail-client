import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Link2, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';

interface AddCalendarUrlDialogProps {
  open: boolean;
  onClose: () => void;
}

interface AccountRow {
  id: string;
  name: string;
  email: string;
  username?: string;
  imap_host?: string;
  caldav_url?: string | null;
  caldav_username?: string | null;
}

function suggestCaldavUrl(account: AccountRow): string {
  const host = account.imap_host || '';
  const email = account.email;
  const u = account.username || email;
  if (/o2switch/i.test(host)) {
    const cpanelHost = /o2switch\.net$/i.test(host) ? host : 'colorant.o2switch.net';
    return `https://${cpanelHost}:2080/calendars/${email}/calendar`;
  }
  if (/\bnextcloud\b/i.test(host) || /\bnc\./i.test(host)) {
    const base = host.replace(/^imap\./i, '').replace(/^mail\./i, '');
    return `https://${base}/remote.php/dav/calendars/${u}/`;
  }
  if (/sogo/i.test(host)) {
    const base = host.replace(/^imap\./i, 'mail.');
    return `https://${base}/SOGo/dav/${u}/Calendar/`;
  }
  const base = host.replace(/^imap\./i, 'mail.');
  return `https://${base}/SOGo/dav/${u}/`;
}

export function AddCalendarUrlDialog({ open, onClose }: AddCalendarUrlDialogProps) {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['calendar-accounts'],
    queryFn: () => api.getCalendarAccounts(),
    enabled: open,
  });

  const [accountId, setAccountId] = useState<string>('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');

  const selectedAccount = useMemo<AccountRow | undefined>(
    () => (accounts as AccountRow[]).find(a => a.id === accountId) || (accounts as AccountRow[])[0],
    [accounts, accountId],
  );

  const placeholderUrl = selectedAccount ? suggestCaldavUrl(selectedAccount) : '';
  const placeholderUser = selectedAccount ? (selectedAccount.username || selectedAccount.email) : '';

  const saveAndSync = useMutation({
    mutationFn: async () => {
      if (!selectedAccount) throw new Error('Aucun compte sélectionné');
      const finalUrl = url.trim() || placeholderUrl;
      if (!finalUrl) throw new Error('URL CalDAV requise');
      await api.updateAccountCaldav(selectedAccount.id, {
        caldavUrl: finalUrl,
        caldavUsername: username.trim() || undefined,
        caldavSyncEnabled: true,
      });
      return api.syncAccountCalendars(selectedAccount.id);
    },
    onSuccess: (data: any) => {
      toast.success(`Calendrier ajouté — ${data?.calendars ?? 0} calendrier(s), ${data?.events ?? 0} événement(s)`);
      qc.invalidateQueries({ queryKey: ['calendar-accounts'] });
      qc.invalidateQueries({ queryKey: ['calendars'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      setUrl('');
      setUsername('');
      onClose();
    },
    onError: (err: any) => toast.error(err.message || 'Échec de l\'ajout du calendrier'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg flex flex-col bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border dark:border-outlook-border-dark">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-outlook-blue" />
            <h2 className="text-base font-semibold">Ajouter un calendrier depuis une URL</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-outlook-hover-dark">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Chargement…
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm">Aucun compte mail configuré.</div>
          ) : (
            <>
              {accounts.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Compte mail</label>
                  <select
                    value={selectedAccount?.id || ''}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                  >
                    {(accounts as AccountRow[]).map(a => (
                      <option key={a.id} value={a.id}>{a.name} — {a.email}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">URL CalDAV</label>
                <input
                  type="url"
                  autoFocus
                  value={url}
                  placeholder={placeholderUrl}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                />
                <p className="text-[11px] text-gray-500 mt-1">Laissez vide pour utiliser la suggestion automatique.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Utilisateur (optionnel)
                </label>
                <input
                  type="text"
                  value={username}
                  placeholder={placeholderUser}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded bg-white dark:bg-outlook-bg-dark focus:outline-none focus:ring-2 focus:ring-outlook-blue"
                />
                <p className="text-[11px] text-gray-500 mt-1">Par défaut, les identifiants IMAP sont réutilisés.</p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-outlook-border dark:border-outlook-border-dark">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-outlook-border dark:border-outlook-border-dark rounded hover:bg-gray-50 dark:hover:bg-outlook-hover-dark"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!selectedAccount || saveAndSync.isPending}
            onClick={() => saveAndSync.mutate()}
            className="px-3 py-1.5 text-sm bg-outlook-blue text-white rounded hover:bg-outlook-blue-dark disabled:opacity-50 flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${saveAndSync.isPending ? 'animate-spin' : ''}`} />
            Ajouter & synchroniser
          </button>
        </div>
      </div>
    </div>
  );
}
