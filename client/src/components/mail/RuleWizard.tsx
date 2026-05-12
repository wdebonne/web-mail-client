import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeft, ArrowRight, Plus, Trash2, AlertCircle, ChevronDown } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  api, type MailRule, type MailRuleAction, type MailRuleActionType,
  type MailRuleCondition, type MailRuleConditionType, type MailRuleUpsert,
} from '../../api';
import {
  ACTION_GROUPS, ACTION_LABELS, CONDITION_GROUPS, CONDITION_LABELS,
  IMPORTANCE_LEVELS, SENSITIVITY_LEVELS,
  actionNeedsValue, conditionNeedsValue,
} from '../../utils/mailRules';
import { getCategories, subscribeCategories, type MailCategory } from '../../utils/categories';

interface RuleWizardProps {
  rule: MailRule | null;
  accounts: any[];
  defaultAccountId?: string | null;
  /** When true, save through admin endpoints (can target other users' rules). */
  isAdmin?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type Step = 1 | 2 | 3;

/**
 * Outlook-style 3-step wizard:
 *   1. Name (and target account)
 *   2. Conditions (one or many) + exceptions
 *   3. Actions (one or many)
 */
export default function RuleWizard({ rule, accounts, defaultAccountId, isAdmin, onClose, onSaved }: RuleWizardProps) {
  const editing = !!rule;
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState(rule?.name || '');
  const [accountId, setAccountId] = useState<string | null>(rule?.accountId ?? defaultAccountId ?? null);
  const [matchType, setMatchType] = useState<'all' | 'any'>(rule?.matchType || 'all');
  const [stopProcessing, setStopProcessing] = useState(rule?.stopProcessing ?? true);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [conditions, setConditions] = useState<MailRuleCondition[]>(rule?.conditions || []);
  const [exceptions, setExceptions] = useState<MailRuleCondition[]>(rule?.exceptions || []);
  const [actions, setActions] = useState<MailRuleAction[]>(rule?.actions || []);
  const [error, setError] = useState<string | null>(null);

  const { data: folders = [] } = useQuery({
    queryKey: ['mail-folders', accountId],
    queryFn: () => (accountId ? api.getFolders(accountId) : Promise.resolve([])),
    enabled: !!accountId,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['mail-templates'],
    queryFn: () => api.listMailTemplates(),
  });

  const folderPaths: string[] = useMemo(
    () => (folders as any[]).map((f) => f.path).filter(Boolean),
    [folders],
  );

  const saveM = useMutation({
    mutationFn: (data: MailRuleUpsert) => {
      if (editing) {
        return isAdmin ? api.adminUpdateMailRule(rule!.id, data) : api.updateMailRule(rule!.id, data);
      }
      return api.createMailRule(data);
    },
    onSuccess: () => {
      toast.success(editing ? 'Règle modifiée' : 'Règle créée');
      onSaved();
    },
    onError: (e: any) => {
      setError(e?.message || 'Erreur');
      toast.error(e?.message || 'Erreur');
    },
  });

  const validate = (): string | null => {
    if (!name.trim()) return 'Entrez un nom.';
    if (actions.length === 0) return 'Ajoutez au moins une action.';
    for (const c of conditions) {
      if (conditionNeedsValue(c.type) && !(c.value || '').trim()) {
        return `Renseignez la valeur de la condition « ${CONDITION_LABELS[c.type]} ».`;
      }
      if (c.type === 'headerContains' && !(c.headerName || '').trim()) {
        return "Indiquez le nom de l'en-tête à rechercher.";
      }
    }
    for (const a of actions) {
      const need = actionNeedsValue(a.type);
      if (need === 'folder' && !a.folder) return `Sélectionnez un dossier pour « ${ACTION_LABELS[a.type]} ».`;
      if (need === 'addresses' && !(a.to || '').trim()) return `Indiquez au moins une adresse pour « ${ACTION_LABELS[a.type]} ».`;
      if (need === 'template' && !a.templateId) return `Sélectionnez un modèle pour « ${ACTION_LABELS[a.type]} ».`;      if (need === 'category' && !a.categoryId) return `Sélectionnez une catégorie pour « ${ACTION_LABELS[a.type]} ».`;    }
    return null;
  };

  const submit = () => {
    const err = validate();
    if (err) { setError(err); return; }
    saveM.mutate({
      name: name.trim(),
      enabled,
      matchType,
      stopProcessing,
      accountId,
      conditions,
      exceptions,
      actions,
    });
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[10000] bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                   bg-white dark:bg-slate-900 rounded-lg shadow-2xl
                   w-[820px] max-w-[96vw] h-[78vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <h2 className="text-lg font-semibold">
            {editing ? `Modifier la règle — ${rule!.name}` : 'Nouvelle règle'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover">
            <X size={18} />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-outlook-border bg-outlook-bg-primary">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => setStep(n as Step)}
              className={`flex items-center gap-2 px-3 py-1 rounded text-sm
                ${step === n ? 'bg-outlook-blue text-white' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
            >
              <span className="w-5 h-5 rounded-full bg-white/20 inline-flex items-center justify-center text-xs">{n}</span>
              {n === 1 ? 'Nom' : n === 2 ? 'Conditions' : 'Actions'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-50 text-red-700 text-xs rounded flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 1 && (
            <Step1
              name={name} setName={setName}
              accountId={accountId} setAccountId={setAccountId}
              accounts={accounts}
              enabled={enabled} setEnabled={setEnabled}
              stopProcessing={stopProcessing} setStopProcessing={setStopProcessing}
              matchType={matchType} setMatchType={setMatchType}
            />
          )}
          {step === 2 && (
            <Step2
              conditions={conditions} setConditions={setConditions}
              exceptions={exceptions} setExceptions={setExceptions}
            />
          )}
          {step === 3 && (
            <Step3
              actions={actions} setActions={setActions}
              folderPaths={folderPaths}
              templates={templates}
              accountSelected={!!accountId}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-outlook-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover"
          >
            Abandonner
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              disabled={step === 1}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover disabled:opacity-40"
            >
              <ArrowLeft size={14} /> Précédent
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep((s) => Math.min(3, s + 1) as Step)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue/90"
              >
                Suivant <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={saveM.isPending}
                className="px-4 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue/90 disabled:opacity-60"
              >
                {saveM.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Account autocomplete ──────────────────────────────────────────
function AccountAutocomplete({ accountId, setAccountId, accounts }: {
  accountId: string | null;
  setAccountId: (v: string | null) => void;
  accounts: any[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accountId ? accounts.find((a: any) => a.id === accountId) : null;
  const selectedLabel = selectedAccount
    ? `${selectedAccount.name || selectedAccount.email} (${selectedAccount.email})`
    : 'Tous mes comptes';

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter((a: any) =>
      (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const handleSelect = (id: string | null) => {
    setAccountId(id);
    setOpen(false);
    setQuery('');
  };

  const handleOpen = () => {
    setOpen((v) => !v);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        className="w-full px-3 py-2 text-sm border border-outlook-border rounded flex items-center justify-between
                   bg-white dark:bg-slate-800 hover:border-outlook-blue focus:outline-none focus:ring-1 focus:ring-outlook-blue"
      >
        <span className={selectedAccount ? '' : 'text-outlook-text-secondary'}>{selectedLabel}</span>
        <ChevronDown size={14} className={`text-outlook-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[30]" onClick={() => { setOpen(false); setQuery(''); }} />
          <div className="absolute z-[40] mt-1 w-full bg-white dark:bg-slate-800 border border-outlook-border rounded shadow-lg">
            <div className="p-2 border-b border-outlook-border">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un compte…"
                className="w-full px-2 py-1 text-sm border border-outlook-border rounded
                           focus:outline-none focus:ring-1 focus:ring-outlook-blue"
              />
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {!query.trim() && (
                <button
                  onClick={() => handleSelect(null)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover
                    ${!accountId ? 'bg-outlook-blue/10 font-medium text-outlook-blue' : ''}`}
                >
                  Tous mes comptes
                </button>
              )}
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-outlook-text-disabled italic">Aucun résultat</div>
              )}
              {filtered.map((a: any) => (
                <button
                  key={a.id}
                  onClick={() => handleSelect(a.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover
                    ${accountId === a.id ? 'bg-outlook-blue/10 font-medium text-outlook-blue' : ''}`}
                >
                  <div>{a.name || a.email}</div>
                  {a.name && <div className="text-xs text-outlook-text-secondary">{a.email}</div>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 1: Name + scope ──────────────────────────────────────────
function Step1(props: {
  name: string; setName: (v: string) => void;
  accountId: string | null; setAccountId: (v: string | null) => void;
  accounts: any[];
  enabled: boolean; setEnabled: (v: boolean) => void;
  stopProcessing: boolean; setStopProcessing: (v: boolean) => void;
  matchType: 'all' | 'any'; setMatchType: (v: 'all' | 'any') => void;
}) {
  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <label className="block text-xs font-semibold text-outlook-text-secondary mb-1 uppercase tracking-wide">
          1. Donnez un nom à votre règle
        </label>
        <input
          autoFocus
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder="Donnez un nom à votre règle"
          className="w-full px-3 py-2 text-sm border border-outlook-border rounded
                     focus:outline-none focus:ring-1 focus:ring-outlook-blue"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-outlook-text-secondary mb-1 uppercase tracking-wide">
          Compte concerné
        </label>
        <AccountAutocomplete
          accountId={props.accountId}
          setAccountId={props.setAccountId}
          accounts={props.accounts}
        />
      </div>

      <div className="flex items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.enabled}
            onChange={(e) => props.setEnabled(e.target.checked)}
            className="w-4 h-4 accent-outlook-blue"
          />
          Activée
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.stopProcessing}
            onChange={(e) => props.setStopProcessing(e.target.checked)}
            className="w-4 h-4 accent-outlook-blue"
          />
          Ne plus traiter de règles
        </label>
      </div>

      <div>
        <label className="block text-xs font-semibold text-outlook-text-secondary mb-1 uppercase tracking-wide">
          Combinaison des conditions
        </label>
        <div className="flex items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="match" checked={props.matchType === 'all'} onChange={() => props.setMatchType('all')} />
            Toutes les conditions (ET)
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="match" checked={props.matchType === 'any'} onChange={() => props.setMatchType('any')} />
            Au moins une (OU)
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Conditions + exceptions ───────────────────────────────
function Step2(props: {
  conditions: MailRuleCondition[]; setConditions: (v: MailRuleCondition[]) => void;
  exceptions: MailRuleCondition[]; setExceptions: (v: MailRuleCondition[]) => void;
}) {
  return (
    <div className="space-y-5">
      <ConditionList
        title="2. Ajout d'une condition"
        items={props.conditions}
        onChange={props.setConditions}
        emptyHint="Sélectionnez une condition"
      />
      <ConditionList
        title="Ajouter une exception"
        items={props.exceptions}
        onChange={props.setExceptions}
        emptyHint="Aucune exception"
      />
    </div>
  );
}

function ConditionList({ title, items, onChange, emptyHint }: {
  title: string; items: MailRuleCondition[];
  onChange: (v: MailRuleCondition[]) => void; emptyHint: string;
}) {
  const update = (idx: number, patch: Partial<MailRuleCondition>) => {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addOfType = (type: MailRuleConditionType) => onChange([...items, { type, value: '' }]);

  return (
    <div>
      <div className="text-xs font-semibold text-outlook-text-secondary mb-2 uppercase tracking-wide">
        {title}
      </div>
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-outlook-text-disabled italic">{emptyHint}</div>
        )}
        {items.map((c, idx) => (
          <div key={idx} className="flex items-start gap-2 p-2 border border-outlook-border rounded bg-outlook-bg-primary">
            <select
              value={c.type}
              onChange={(e) => update(idx, { type: e.target.value as MailRuleConditionType, value: '', headerName: '', level: '', bytes: undefined })}
              className="px-2 py-1 text-sm border border-outlook-border rounded bg-white"
            >
              {CONDITION_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((t) => (
                    <option key={t} value={t}>{CONDITION_LABELS[t]}</option>
                  ))}
                </optgroup>
              ))}
            </select>

            <ConditionValueInput cond={c} onChange={(patch) => update(idx, patch)} />

            <button onClick={() => remove(idx)} className="p-1.5 rounded hover:bg-red-50 text-outlook-text-secondary hover:text-outlook-danger">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <ConditionPicker onPick={addOfType} />
    </div>
  );
}

function ConditionValueInput({ cond, onChange }: { cond: MailRuleCondition; onChange: (patch: Partial<MailRuleCondition>) => void }) {
  if (!conditionNeedsValue(cond.type)) {
    if (cond.type === 'importance') {
      return (
        <select
          value={cond.level || 'high'}
          onChange={(e) => onChange({ level: e.target.value })}
          className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
        >
          {IMPORTANCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      );
    }
    if (cond.type === 'sensitivity') {
      return (
        <select
          value={cond.level || 'confidential'}
          onChange={(e) => onChange({ level: e.target.value })}
          className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
        >
          {SENSITIVITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      );
    }
    if (cond.type === 'sizeAtLeast') {
      return (
        <input
          type="number"
          min={0}
          value={cond.bytes ?? ''}
          onChange={(e) => onChange({ bytes: Number(e.target.value) || 0 })}
          placeholder="Octets"
          className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
        />
      );
    }
    return <div className="flex-1 text-xs text-outlook-text-disabled italic px-2 py-1.5">Aucune valeur requise</div>;
  }

  if (cond.type === 'headerContains') {
    return (
      <div className="flex-1 flex items-center gap-2">
        <input
          value={cond.headerName || ''}
          onChange={(e) => onChange({ headerName: e.target.value })}
          placeholder="Nom de l'en-tête"
          className="w-40 px-2 py-1 text-sm border border-outlook-border rounded"
        />
        <input
          value={cond.value || ''}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Valeur"
          className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
        />
      </div>
    );
  }

  return (
    <input
      value={cond.value || ''}
      onChange={(e) => onChange({ value: e.target.value })}
      placeholder="Valeur recherchée"
      className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
    />
  );
}

function ConditionPicker({ onPick }: { onPick: (t: MailRuleConditionType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-dashed border-outlook-border rounded hover:bg-outlook-bg-hover text-outlook-blue"
      >
        <Plus size={12} /> Ajouter une condition
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[10] " onClick={() => setOpen(false)} />
          <div className="absolute z-[20] mt-1 bg-white border border-outlook-border rounded shadow-lg py-1 max-h-80 overflow-y-auto w-72">
            {CONDITION_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-outlook-blue">{g.label}</div>
                {g.types.map((t) => (
                  <button
                    key={t}
                    onClick={() => { onPick(t); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover"
                  >
                    {CONDITION_LABELS[t]}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 3: Actions ───────────────────────────────────────────────
function Step3(props: {
  actions: MailRuleAction[]; setActions: (v: MailRuleAction[]) => void;
  folderPaths: string[]; templates: any[];
  accountSelected: boolean;
}) {
  const update = (idx: number, patch: Partial<MailRuleAction>) => {
    const next = [...props.actions];
    next[idx] = { ...next[idx], ...patch };
    props.setActions(next);
  };
  const remove = (idx: number) => props.setActions(props.actions.filter((_, i) => i !== idx));
  const addOfType = (type: MailRuleActionType) => props.setActions([...props.actions, { type }]);

  // Categories live in localStorage — keep them reactive while the wizard is open.
  const [categories, setCategories] = useState<MailCategory[]>(() => getCategories());
  useEffect(() => subscribeCategories(() => setCategories(getCategories())), []);

  return (
    <div>
      <div className="text-xs font-semibold text-outlook-text-secondary mb-2 uppercase tracking-wide">
        3. Ajout d'une action
      </div>
      <div className="space-y-2">
        {props.actions.length === 0 && (
          <div className="text-xs text-outlook-text-disabled italic">Sélectionnez une action</div>
        )}
        {props.actions.map((a, idx) => {
          const need = actionNeedsValue(a.type);
          return (
            <div key={idx} className="flex items-start gap-2 p-2 border border-outlook-border rounded bg-outlook-bg-primary">
              <select
                value={a.type}
                onChange={(e) => update(idx, { type: e.target.value as MailRuleActionType, folder: '', to: '', templateId: undefined, categoryId: undefined, categoryName: undefined })}
                className="px-2 py-1 text-sm border border-outlook-border rounded bg-white"
              >
                {ACTION_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map((t) => (
                      <option key={t} value={t}>{ACTION_LABELS[t]}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {need === 'folder' && (
                <select
                  value={a.folder || ''}
                  onChange={(e) => update(idx, { folder: e.target.value })}
                  className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
                  disabled={!props.accountSelected}
                >
                  <option value="">{props.accountSelected ? '-- Choisir un dossier --' : 'Sélectionnez d\'abord un compte (étape 1)'}</option>
                  {props.folderPaths.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}

              {need === 'addresses' && (
                <input
                  value={a.to || ''}
                  onChange={(e) => update(idx, { to: e.target.value })}
                  placeholder="adresse1@exemple.fr, adresse2@exemple.fr"
                  className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
                />
              )}

              {need === 'template' && (
                <select
                  value={a.templateId || ''}
                  onChange={(e) => update(idx, { templateId: e.target.value })}
                  className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
                >
                  <option value="">-- Choisir un modèle --</option>
                  {props.templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}

              {need === 'category' && (
                <select
                  value={a.categoryId || ''}
                  onChange={(e) => {
                    const cat = categories.find((c) => c.id === e.target.value);
                    update(idx, { categoryId: e.target.value, categoryName: cat?.name });
                  }}
                  className="flex-1 px-2 py-1 text-sm border border-outlook-border rounded"
                >
                  <option value="">-- Choisir une catégorie --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  {a.categoryId && !categories.find((c) => c.id === a.categoryId) && a.categoryName && (
                    <option value={a.categoryId}>{a.categoryName} (inconnue ici)</option>
                  )}
                </select>
              )}

              {!need && <div className="flex-1 text-xs text-outlook-text-disabled italic px-2 py-1.5">Aucun paramètre</div>}

              <button onClick={() => remove(idx)} className="p-1.5 rounded hover:bg-red-50 text-outlook-text-secondary hover:text-outlook-danger">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <ActionPicker onPick={addOfType} />
    </div>
  );
}

function ActionPicker({ onPick }: { onPick: (t: MailRuleActionType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-dashed border-outlook-border rounded hover:bg-outlook-bg-hover text-outlook-blue"
      >
        <Plus size={12} /> Ajouter une action
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[10]" onClick={() => setOpen(false)} />
          <div className="absolute z-[20] mt-1 bg-white border border-outlook-border rounded shadow-lg py-1 max-h-80 overflow-y-auto w-72">
            {ACTION_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-outlook-blue">{g.label}</div>
                {g.types.map((t) => (
                  <button
                    key={t}
                    onClick={() => { onPick(t); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover"
                  >
                    {ACTION_LABELS[t]}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
