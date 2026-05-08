import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bold, Italic, Underline, List, ListOrdered, Link as LinkIcon, Save,
  Loader2, AlertCircle, X, Forward,
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
  /**
   * When true, the form targets the admin endpoints and edits *any* account,
   * skipping the writable-accounts filter. The single account to edit must be
   * provided through `accountId`, and `adminAccountLabel` is shown instead of
   * the account picker.
   */
  adminMode?: boolean;
  adminAccountLabel?: string;
}

interface ResponderState {
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  scheduled: boolean;
  startAt: string;       // 'YYYY-MM-DDTHH:mm' (local), or ''
  endAt: string;         // same
  onlyContacts: boolean;
  forwardEnabled: boolean;
  forwardTo: string[];
}

const DEFAULT_STATE: ResponderState = {
  enabled: false,
  subject: 'Réponse automatique',
  bodyHtml: '',
  scheduled: false,
  startAt: '',
  endAt: '',
  onlyContacts: false,
  forwardEnabled: false,
  forwardTo: [],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FORWARD_TARGETS = 20;

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

export default function AutoResponderForm({ accountId: initialId, accounts, onSaved, compact, adminMode, adminAccountLabel }: AutoResponderFormProps) {
  const writableAccounts = useMemo(
    () => accounts.filter(a => a.send_permission !== 'none'),
    [accounts],
  );

  const [accountId, setAccountId] = useState<string>(() => {
    if (initialId) return initialId;
    if (adminMode) return '';
    return writableAccounts[0]?.id || '';
  });

  useEffect(() => {
    if (adminMode) return;
    if (!accountId && writableAccounts.length > 0) setAccountId(writableAccounts[0].id);
  }, [accountId, writableAccounts, adminMode]);

  const [state, setState] = useState<ResponderState>(DEFAULT_STATE);
  const editorRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: [adminMode ? 'admin-auto-responder' : 'auto-responder', accountId],
    queryFn: () => (adminMode ? api.adminGetAutoResponder(accountId) : api.getAutoResponder(accountId)),
    enabled: !!accountId,
  });

  // Hydrate the form whenever the loaded settings change.
  useEffect(() => {
    if (!data) return;
    const incomingForward = Array.isArray((data as any).forwardTo) ? (data as any).forwardTo as string[] : [];
    setState({
      enabled: data.enabled,
      subject: data.subject || 'Réponse automatique',
      bodyHtml: data.bodyHtml || '',
      scheduled: data.scheduled,
      startAt: isoToLocalInput(data.startAt),
      endAt: isoToLocalInput(data.endAt),
      onlyContacts: data.onlyContacts,
      forwardEnabled: incomingForward.length > 0,
      forwardTo: incomingForward,
    });
    if (editorRef.current) {
      editorRef.current.innerHTML = data.bodyHtml || '';
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const html = editorRef.current?.innerHTML ?? state.bodyHtml;
      const forwardTo = state.forwardEnabled
        ? Array.from(new Set(state.forwardTo.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))))
        : [];
      const payload = {
        enabled: state.enabled,
        subject: state.subject.trim() || 'Réponse automatique',
        bodyHtml: html,
        scheduled: state.scheduled,
        startAt: state.scheduled ? localInputToIso(state.startAt) : null,
        endAt: state.scheduled && state.endAt ? localInputToIso(state.endAt) : null,
        onlyContacts: state.onlyContacts,
        forwardTo,
      };
      return adminMode
        ? api.adminSaveAutoResponder(accountId, payload)
        : api.saveAutoResponder(accountId, payload);
    },
    onSuccess: () => {
      toast.success('Répondeur enregistré');
      queryClient.invalidateQueries({ queryKey: [adminMode ? 'admin-auto-responder' : 'auto-responder', accountId] });
      if (adminMode) queryClient.invalidateQueries({ queryKey: ['admin-auto-responders'] });
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
      {adminMode ? (
        adminAccountLabel ? (
          <div className="flex items-center gap-2 text-sm text-outlook-text-secondary">
            <span className="min-w-[80px]">Compte</span>
            <span className="font-medium text-outlook-text-primary">{adminAccountLabel}</span>
          </div>
        ) : null
      ) : writableAccounts.length > 1 && (
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

        {/* Auto-forwarding */}
        <ForwardingSection
          enabled={state.forwardEnabled}
          recipients={state.forwardTo}
          onToggle={(checked) => setState(s => ({ ...s, forwardEnabled: checked }))}
          onChange={(list) => setState(s => ({ ...s, forwardTo: list }))}
        />
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

// ---------------------------------------------------------------------------
// Forwarding section — toggle + chips of email addresses + autocomplete input
// powered by the contacts directory. Also accepts free-form addresses entered
// manually (validated as standard emails) via Enter / comma / blur.
// ---------------------------------------------------------------------------

interface ForwardingSectionProps {
  enabled: boolean;
  recipients: string[];
  onToggle: (checked: boolean) => void;
  onChange: (next: string[]) => void;
}

function ForwardingSection({ enabled, recipients, onToggle, onChange }: ForwardingSectionProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ name?: string; email: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const atCap = recipients.length >= MAX_FORWARD_TARGETS;

  // Close the suggestion popover when clicking outside.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Debounced autocomplete search against the contacts API.
  useEffect(() => {
    if (!enabled || atCap) {
      setSuggestions([]);
      return;
    }
    const q = input.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const r = await api.searchContacts(q);
        const flat: Array<{ name?: string; email: string }> = [];
        for (const c of r.contacts || []) {
          const email = (c.email || '').trim();
          if (email) flat.push({ name: c.display_name || c.name || c.full_name, email });
        }
        // Drop already-selected and the empty ones; cap to 8.
        const picked = recipients.map((e) => e.toLowerCase());
        const filtered = flat
          .filter((s) => !picked.includes(s.email.toLowerCase()))
          .slice(0, 8);
        setSuggestions(filtered);
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [input, enabled, atCap, recipients]);

  const addRecipient = (raw: string) => {
    const candidate = raw.trim().toLowerCase();
    if (!candidate) return;
    if (!EMAIL_RE.test(candidate)) {
      toast.error('Adresse e-mail invalide');
      return;
    }
    if (recipients.some((e) => e.toLowerCase() === candidate)) {
      setInput('');
      return;
    }
    if (recipients.length >= MAX_FORWARD_TARGETS) {
      toast.error(`Maximum ${MAX_FORWARD_TARGETS} destinataires`);
      return;
    }
    onChange([...recipients, candidate]);
    setInput('');
    setSuggestions([]);
  };

  const removeAt = (idx: number) => {
    onChange(recipients.filter((_, i) => i !== idx));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      if (input.trim()) addRecipient(input);
    } else if (e.key === 'Backspace' && !input && recipients.length > 0) {
      removeAt(recipients.length - 1);
    }
  };

  return (
    <div className="mt-4 border-t border-outlook-border pt-3">
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="text-sm font-medium inline-flex items-center gap-1.5">
          <Forward size={14} className="text-outlook-text-secondary" />
          Transférer également les nouveaux mails reçus
        </span>
      </label>

      {enabled && (
        <div ref={containerRef} className="mt-2 pl-6 relative">
          <p className="text-xs text-outlook-text-secondary mb-2">
            Pendant que le répondeur est actif, chaque nouveau message reçu sera également envoyé
            à ces adresses (avec ses pièces jointes).
          </p>

          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border border-outlook-border rounded bg-white min-h-[36px]">
            {recipients.map((email, idx) => (
              <span
                key={`${email}-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-outlook-blue/10 text-outlook-blue"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeAt(idx)}
                  className="hover:bg-outlook-blue/20 rounded-full p-0.5"
                  aria-label={`Retirer ${email}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              type="email"
              value={input}
              onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
              onKeyDown={onKeyDown}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                // Auto-commit a typed address on blur if it looks like an email.
                if (input.trim() && EMAIL_RE.test(input.trim().toLowerCase())) {
                  addRecipient(input);
                }
              }}
              disabled={atCap}
              placeholder={atCap ? 'Limite atteinte' : (recipients.length === 0 ? 'Ajouter un destinataire…' : '')}
              className="flex-1 min-w-[160px] text-sm bg-transparent outline-none placeholder:text-outlook-text-disabled"
            />
          </div>

          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-20 left-6 right-0 mt-1 max-h-56 overflow-y-auto bg-white border border-outlook-border rounded shadow-lg">
              {suggestions.map((s) => (
                <li key={s.email}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addRecipient(s.email); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex flex-col"
                  >
                    {s.name && <span className="font-medium">{s.name}</span>}
                    <span className="text-xs text-outlook-text-secondary">{s.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-outlook-text-secondary mt-1">
            Astuce : appuyez sur <kbd className="px-1 py-0.5 bg-outlook-bg-secondary rounded border">Entrée</kbd> ou
            <kbd className="px-1 py-0.5 bg-outlook-bg-secondary rounded border ml-1">,</kbd> pour ajouter une adresse.
            Les messages déjà automatiques (listes de diffusion, autres répondeurs…) ne sont jamais transférés.
          </p>
        </div>
      )}
    </div>
  );
}
