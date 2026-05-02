import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Save,
  Loader2, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import type { MailAccount } from '../../types';

interface AutoResponderFormProps {
  /** Optional pre-selected account id. */
  accountId?: string;
  accounts: MailAccount[];
  onSaved?: () => void;
  /** When true, render in a more compact layout (used inside the Settings panel). */
  compact?: boolean;
}

interface ResponderState {
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  scheduled: boolean;
  startAt: string;       // 'YYYY-MM-DDTHH:mm' (local), or ''
  endAt: string;         // same
  onlyContacts: boolean;
}

const DEFAULT_STATE: ResponderState = {
  enabled: false,
  subject: 'Réponse automatique',
  bodyHtml: '',
  scheduled: false,
  startAt: '',
  endAt: '',
  onlyContacts: false,
};

/** Convert an ISO string to a `datetime-local` value (in the user's local zone). */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a `datetime-local` value (local time) into an ISO UTC string. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function AutoResponderForm({ accountId: initialId, accounts, onSaved, compact }: AutoResponderFormProps) {
  const writableAccounts = useMemo(
    () => accounts.filter(a => a.send_permission !== 'none'),
    [accounts],
  );

  const [accountId, setAccountId] = useState<string>(() => {
    if (initialId && writableAccounts.some(a => a.id === initialId)) return initialId;
    return writableAccounts[0]?.id || '';
  });

  useEffect(() => {
    if (!accountId && writableAccounts.length > 0) setAccountId(writableAccounts[0].id);
  }, [accountId, writableAccounts]);

  const [state, setState] = useState<ResponderState>(DEFAULT_STATE);
  const editorRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['auto-responder', accountId],
    queryFn: () => api.getAutoResponder(accountId),
    enabled: !!accountId,
  });

  // Hydrate the form whenever the loaded settings change.
  useEffect(() => {
    if (!data) return;
    setState({
      enabled: data.enabled,
      subject: data.subject || 'Réponse automatique',
      bodyHtml: data.bodyHtml || '',
      scheduled: data.scheduled,
      startAt: isoToLocalInput(data.startAt),
      endAt: isoToLocalInput(data.endAt),
      onlyContacts: data.onlyContacts,
    });
    if (editorRef.current) {
      editorRef.current.innerHTML = data.bodyHtml || '';
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const html = editorRef.current?.innerHTML ?? state.bodyHtml;
      return api.saveAutoResponder(accountId, {
        enabled: state.enabled,
        subject: state.subject.trim() || 'Réponse automatique',
        bodyHtml: html,
        scheduled: state.scheduled,
        startAt: state.scheduled ? localInputToIso(state.startAt) : null,
        endAt: state.scheduled && state.endAt ? localInputToIso(state.endAt) : null,
        onlyContacts: state.onlyContacts,
      });
    },
    onSuccess: () => {
      toast.success('Répondeur enregistré');
      queryClient.invalidateQueries({ queryKey: ['auto-responder', accountId] });
      onSaved?.();
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Échec de l\'enregistrement');
    },
  });

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const insertLink = () => {
    const url = prompt('URL du lien :');
    if (url) exec('createLink', url);
  };

  const canSave = !!accountId && !saveMutation.isPending;
  const scheduleInvalid = state.scheduled && state.endAt && state.startAt && new Date(state.endAt) <= new Date(state.startAt);

  return (
    <div className={`flex flex-col gap-4 ${compact ? '' : 'p-1'}`}>
      {/* Account picker (only when multiple writable accounts). */}
      {writableAccounts.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-outlook-text-secondary min-w-[80px]">Compte</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="flex-1 px-2 py-1.5 text-sm border border-outlook-border rounded bg-white text-outlook-text-primary"
          >
            {writableAccounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.assigned_display_name || a.name} — {a.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-sm text-outlook-text-secondary leading-relaxed">
        Utilisez les réponses automatiques pour prévenir d'autres personnes que vous êtes en vacances ou
        ne pouvez pas répondre à vos courriers. Vous pouvez configurer les réponses de manière à ce qu'elles
        commencent et se terminent à une heure précise. Sinon, elles continuent d'être envoyées jusqu'à ce
        que vous les désactiviez.
      </p>

      {/* Master toggle */}
      <label className="inline-flex items-center gap-3 cursor-pointer select-none">
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          onClick={() => setState(s => ({ ...s, enabled: !s.enabled }))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${state.enabled ? 'bg-outlook-blue' : 'bg-gray-300'}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${state.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
        <span className="text-sm text-outlook-text-primary">
          Réponses automatiques {state.enabled ? 'activées' : 'désactivées'}
        </span>
      </label>

      <div className={state.enabled ? '' : 'opacity-60 pointer-events-none'}>
        {/* Schedule */}
        <label className="flex items-start gap-2 mb-3">
          <input
            type="checkbox"
            checked={state.scheduled}
            onChange={(e) => setState(s => ({ ...s, scheduled: e.target.checked }))}
            className="mt-1"
          />
          <span className="text-sm">Envoyer des réponses uniquement pendant une période donnée</span>
        </label>

        {state.scheduled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 pl-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-outlook-text-secondary">Heure de début</label>
              <input
                type="datetime-local"
                value={state.startAt}
                onChange={(e) => setState(s => ({ ...s, startAt: e.target.value }))}
                className="px-2 py-1.5 text-sm border border-outlook-border rounded bg-white text-outlook-text-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-outlook-text-secondary">
                Heure de fin <span className="text-outlook-text-disabled">(facultatif)</span>
              </label>
              <input
                type="datetime-local"
                value={state.endAt}
                onChange={(e) => setState(s => ({ ...s, endAt: e.target.value }))}
                className="px-2 py-1.5 text-sm border border-outlook-border rounded bg-white text-outlook-text-primary"
              />
            </div>
            {scheduleInvalid && (
              <div className="sm:col-span-2 flex items-center gap-2 text-xs text-outlook-danger">
                <AlertCircle size={14} />
                La date de fin doit être après la date de début.
              </div>
            )}
          </div>
        )}

        {/* Subject */}
        <div className="flex flex-col gap-1 mb-3">
          <label className="text-xs text-outlook-text-secondary">Objet de la réponse</label>
          <input
            type="text"
            value={state.subject}
            onChange={(e) => setState(s => ({ ...s, subject: e.target.value }))}
            className="px-2 py-1.5 text-sm border border-outlook-border rounded bg-white text-outlook-text-primary"
            placeholder="Réponse automatique"
          />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 bg-outlook-bg-secondary border border-outlook-border rounded-t">
          <button type="button" onClick={() => exec('bold')} className="p-1.5 hover:bg-outlook-bg-hover rounded" title="Gras"><Bold size={14} /></button>
          <button type="button" onClick={() => exec('italic')} className="p-1.5 hover:bg-outlook-bg-hover rounded" title="Italique"><Italic size={14} /></button>
          <button type="button" onClick={() => exec('underline')} className="p-1.5 hover:bg-outlook-bg-hover rounded" title="Souligné"><Underline size={14} /></button>
          <span className="w-px h-5 bg-outlook-border mx-1" />
          <button type="button" onClick={() => exec('insertUnorderedList')} className="p-1.5 hover:bg-outlook-bg-hover rounded" title="Liste à puces"><List size={14} /></button>
          <button type="button" onClick={() => exec('insertOrderedList')} className="p-1.5 hover:bg-outlook-bg-hover rounded" title="Liste numérotée"><ListOrdered size={14} /></button>
          <span className="w-px h-5 bg-outlook-border mx-1" />
          <button type="button" onClick={insertLink} className="p-1.5 hover:bg-outlook-bg-hover rounded" title="Insérer un lien"><LinkIcon size={14} /></button>
        </div>

        {/* Editable body */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className={`min-h-[140px] ${compact ? 'max-h-[260px]' : 'max-h-[360px]'} overflow-y-auto px-3 py-2 text-sm border border-t-0 border-outlook-border rounded-b bg-white text-outlook-text-primary focus:outline-none focus:ring-1 focus:ring-outlook-blue`}
          onInput={(e) => setState(s => ({ ...s, bodyHtml: (e.target as HTMLDivElement).innerHTML }))}
          data-placeholder="Ajouter un message ici"
        />

        {/* Only contacts */}
        <label className="inline-flex items-center gap-2 mt-4">
          <input
            type="checkbox"
            checked={state.onlyContacts}
            onChange={(e) => setState(s => ({ ...s, onlyContacts: e.target.checked }))}
          />
          <span className="text-sm">Envoyer des réponses uniquement à mes contacts</span>
        </label>
      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-outlook-border">
        {isLoading && <Loader2 size={16} className="animate-spin text-outlook-text-secondary" />}
        <button
          type="button"
          disabled={!canSave || !!scheduleInvalid}
          onClick={() => saveMutation.mutate()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
