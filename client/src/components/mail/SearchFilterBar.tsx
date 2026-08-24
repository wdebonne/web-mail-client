// Barre de recherche « grand public ».
//
// Remplace l'ancien onglet Recherche du ruban (une grille de mini radios
// intitulées « Portée », « Non filtré », « Avec PJ »…) par une rangée de pastilles
// posées comme des questions : Où ? Quand ? De qui ? Tout est écrit en français
// courant, les dossiers portent leur nom lisible (« Boîte de réception » et non
// « INBOX ») et un filtre actif se voit — et se retire — d'un coup d'œil.
//
// Le fichier expose aussi les deux autres morceaux de l'expérience de recherche :
// l'en-tête de résultats (SearchResultsHeader) et l'écran vide (SearchEmptyState),
// qui partagent le même vocabulaire.

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, X as XIcon, ChevronDown, Check, Inbox, Mails, Globe2,
  CalendarDays, Paperclip, MailOpen, AtSign, RotateCcw, User,
  SlidersHorizontal,
} from 'lucide-react';
import type { MailAccount } from '../../types';
import { getAccountDisplayName } from '../../utils/mailPreferences';
import { resolveFolderDisplayName } from '../../utils/folderLabels';

export type SearchScope = 'current-folder' | 'all-folders' | 'mailbox';
export type SearchDatePreset = 'all' | 'today' | 'week' | 'month' | 'year';
export type SearchAttachment = 'any' | 'yes' | 'no';
export type SearchReadState = 'any' | 'read' | 'unread';

/** Valeurs retenues quand l'utilisateur n'a rien choisi — base du « Tout réinitialiser ». */
export const SEARCH_FILTER_DEFAULTS = {
  scope: 'current-folder' as SearchScope,
  accountId: '',
  datePreset: 'all' as SearchDatePreset,
  hasAttachment: 'any' as SearchAttachment,
  isRead: 'any' as SearchReadState,
  from: '',
};

export const DATE_PRESET_LABELS: Record<SearchDatePreset, string> = {
  all: "N'importe quand",
  today: "Aujourd'hui",
  week: 'Cette semaine',
  month: 'Ce mois-ci',
  year: 'Cette année',
};

export const ATTACHMENT_LABELS: Record<SearchAttachment, string> = {
  any: 'Peu importe',
  yes: 'Avec pièce jointe',
  no: 'Sans pièce jointe',
};

export const READ_STATE_LABELS: Record<SearchReadState, string> = {
  any: 'Tous',
  unread: 'Non lus',
  read: 'Déjà lus',
};

export function scopeValueLabel(scope: SearchScope, currentFolder?: string): string {
  if (scope === 'all-folders') return 'toutes mes boîtes';
  if (scope === 'mailbox') return 'toute cette boîte mail';
  return currentFolder ? resolveFolderDisplayName(currentFolder) : 'ce dossier';
}

// ─── Pastille déroulante ──────────────────────────────────────────────────────

interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Ligne d'explication sous le libellé, dans le menu. */
  hint?: string;
  icon?: any;
}

function FilterChip<T extends string>({
  icon: Icon, label, value, options, onChange, onClear, compact,
}: {
  icon: any;
  label: string;
  value: T;
  options: ChipOption<T>[];
  onChange: (v: T) => void;
  /** Présent = la pastille peut être remise à zéro par la petite croix. */
  onClear?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const current = options.find((o) => o.value === value) || options[0];
  const isActive = !!onClear;

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 264;
    const left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
    setPos({ top: rect.bottom + 6, left: Math.max(8, left) });
  };

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <div
        className={`flex items-center rounded-full border transition-all
          ${isActive
            ? 'bg-outlook-blue text-white border-outlook-blue shadow-sm'
            : 'bg-outlook-bg-secondary border-outlook-border text-outlook-text-primary hover:border-outlook-blue/60 hover:bg-outlook-bg-hover'}`}
      >
        <button
          type="button"
          onClick={() => { place(); setOpen((v) => !v); }}
          className={`flex items-center gap-1.5 ${compact ? 'pl-2.5 pr-2 py-1' : 'pl-3 pr-2 py-1.5'} rounded-full`}
          title={`${label} ${current?.label}`}
        >
          <Icon size={compact ? 13 : 14} className={isActive ? 'text-white' : 'text-outlook-text-secondary'} />
          <span className={`${compact ? 'text-[11px]' : 'text-xs'} whitespace-nowrap`}>
            <span className={isActive ? 'text-white/70' : 'text-outlook-text-secondary'}>{label} </span>
            <span className="font-semibold">{current?.label}</span>
          </span>
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''} ${isActive ? 'text-white/80' : 'text-outlook-text-disabled'}`} />
        </button>
        {onClear && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClear(); }}
            className="pr-2.5 pl-0.5 py-1.5 text-white/70 hover:text-white"
            title={`Retirer ce filtre`}
          >
            <XIcon size={12} />
          </button>
        )}
      </div>

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onMouseDown={() => setOpen(false)} />
          <div
            className="fixed z-[9999] w-[264px] bg-outlook-bg-secondary border border-outlook-border rounded-xl shadow-2xl py-1.5 animate-fade-in"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="px-3 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-outlook-text-disabled">
              {label.replace(/\s*:\s*$/, '')}
            </div>
            {options.map((opt) => {
              const OptIcon = opt.icon;
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors
                    ${selected ? 'bg-outlook-blue/10' : 'hover:bg-outlook-bg-hover'}`}
                >
                  {OptIcon
                    ? <OptIcon size={15} className={`mt-0.5 flex-shrink-0 ${selected ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`} />
                    : <span className="w-[15px] flex-shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] leading-tight ${selected ? 'text-outlook-blue font-semibold' : 'text-outlook-text-primary'}`}>
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span className="block text-[11px] leading-tight text-outlook-text-secondary mt-0.5">{opt.hint}</span>
                    )}
                  </span>
                  {selected && <Check size={14} className="text-outlook-blue flex-shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ─── Pastille « De qui ? » ────────────────────────────────────────────────────

function SenderChip({ value, onChange, compact }: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  const isActive = !!value.trim();
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border transition-all flex-shrink-0
        ${compact ? 'px-2.5 py-1' : 'px-3 py-1.5'}
        ${isActive
          ? 'bg-outlook-blue text-white border-outlook-blue shadow-sm'
          : 'bg-outlook-bg-secondary border-outlook-border hover:border-outlook-blue/60 focus-within:border-outlook-blue'}`}
    >
      <AtSign size={compact ? 13 : 14} className={isActive ? 'text-white/80' : 'text-outlook-text-secondary'} />
      <span className={`${compact ? 'text-[11px]' : 'text-xs'} whitespace-nowrap ${isActive ? 'text-white/70' : 'text-outlook-text-secondary'}`}>
        De qui :
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="nom ou adresse"
        className={`${compact ? 'w-24 text-[11px]' : 'w-32 text-xs'} bg-transparent outline-none
          ${isActive
            ? 'text-white placeholder-white/50 font-semibold'
            : 'text-outlook-text-primary placeholder-outlook-text-disabled'}`}
      />
      {isActive && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
          className="text-white/70 hover:text-white"
          title="Retirer ce filtre"
        >
          <XIcon size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Barre de filtres ─────────────────────────────────────────────────────────

export interface SearchFilterState {
  scope: SearchScope;
  accountId: string;
  datePreset: SearchDatePreset;
  hasAttachment: SearchAttachment;
  isRead: SearchReadState;
  from: string;
}

export interface SearchFilterHandlers {
  onScopeChange?: (v: SearchScope) => void;
  onAccountChange?: (v: string) => void;
  onDatePresetChange?: (v: SearchDatePreset) => void;
  onHasAttachmentChange?: (v: SearchAttachment) => void;
  onIsReadChange?: (v: SearchReadState) => void;
  onFromChange?: (v: string) => void;
}

export interface SearchFilterBarProps extends SearchFilterState, SearchFilterHandlers {
  /** 'full' = ruban classique (titre + pastilles) ; 'compact' = ruban simplifié / mobile. */
  variant?: 'full' | 'compact';
  accounts: MailAccount[];
  currentFolder?: string;
  onResetFilters?: () => void;
  onClose?: () => void;
}

/** Nombre de filtres qui restreignent réellement les résultats. */
export function countActiveFilters(s: SearchFilterState): number {
  let n = 0;
  if (s.scope !== SEARCH_FILTER_DEFAULTS.scope) n++;
  if (s.accountId) n++;
  if (s.datePreset !== 'all') n++;
  if (s.hasAttachment !== 'any') n++;
  if (s.isRead !== 'any') n++;
  if (s.from.trim()) n++;
  return n;
}

export default function SearchFilterBar(props: SearchFilterBarProps) {
  const {
    variant = 'full', accounts, currentFolder,
    scope, accountId, datePreset, hasAttachment, isRead, from,
    onScopeChange, onAccountChange, onDatePresetChange,
    onHasAttachmentChange, onIsReadChange, onFromChange,
    onResetFilters, onClose,
  } = props;

  const compact = variant === 'compact';
  const folderLabel = currentFolder ? resolveFolderDisplayName(currentFolder) : 'Ce dossier';
  const activeCount = countActiveFilters({ scope, accountId, datePreset, hasAttachment, isRead, from });
  const multiAccount = accounts.length > 1;

  const chips = (
    <>
      {/* Où chercher — du plus étroit au plus large, pour que « je ne trouve pas »
          se règle en descendant d'un cran dans la liste. */}
      <FilterChip<SearchScope>
        icon={Search}
        label="Où :"
        value={scope}
        onChange={(v) => onScopeChange?.(v)}
        onClear={scope !== 'current-folder' ? () => onScopeChange?.('current-folder') : undefined}
        compact={compact}
        options={[
          { value: 'current-folder', label: folderLabel, hint: 'Uniquement le dossier ouvert', icon: Inbox },
          { value: 'mailbox', label: 'Toute cette boîte', hint: 'Tous les dossiers du compte affiché', icon: Mails },
          { value: 'all-folders', label: 'Partout', hint: 'Tous mes comptes et tous mes dossiers', icon: Globe2 },
        ]}
      />

      {/* Compte — sans objet quand la recherche est limitée à un dossier précis. */}
      {multiAccount && scope !== 'current-folder' && (
        <FilterChip<string>
          icon={User}
          label="Compte :"
          value={accountId || '__all__'}
          onChange={(v) => onAccountChange?.(v === '__all__' ? '' : v)}
          onClear={accountId ? () => onAccountChange?.('') : undefined}
          compact={compact}
          options={[
            { value: '__all__', label: 'Tous les comptes', icon: Mails },
            ...accounts.map((a) => ({ value: a.id, label: getAccountDisplayName(a), hint: a.email, icon: Inbox })),
          ]}
        />
      )}

      <FilterChip<SearchDatePreset>
        icon={CalendarDays}
        label="Quand :"
        value={datePreset}
        onChange={(v) => onDatePresetChange?.(v)}
        onClear={datePreset !== 'all' ? () => onDatePresetChange?.('all') : undefined}
        compact={compact}
        options={[
          { value: 'all', label: DATE_PRESET_LABELS.all, hint: 'Aucune limite de date' },
          { value: 'today', label: DATE_PRESET_LABELS.today },
          { value: 'week', label: DATE_PRESET_LABELS.week },
          { value: 'month', label: DATE_PRESET_LABELS.month },
          { value: 'year', label: DATE_PRESET_LABELS.year },
        ]}
      />

      <SenderChip value={from} onChange={(v) => onFromChange?.(v)} compact={compact} />

      <FilterChip<SearchAttachment>
        icon={Paperclip}
        label="Fichier joint :"
        value={hasAttachment}
        onChange={(v) => onHasAttachmentChange?.(v)}
        onClear={hasAttachment !== 'any' ? () => onHasAttachmentChange?.('any') : undefined}
        compact={compact}
        options={[
          { value: 'any', label: 'Peu importe', hint: 'Avec ou sans fichier joint' },
          { value: 'yes', label: 'Oui', hint: 'Seulement les messages contenant un fichier' },
          { value: 'no', label: 'Non', hint: 'Seulement les messages sans fichier' },
        ]}
      />

      <FilterChip<SearchReadState>
        icon={MailOpen}
        label="Lecture :"
        value={isRead}
        onChange={(v) => onIsReadChange?.(v)}
        onClear={isRead !== 'any' ? () => onIsReadChange?.('any') : undefined}
        compact={compact}
        options={[
          { value: 'any', label: 'Tous', hint: 'Lus et non lus' },
          { value: 'unread', label: 'Non lus', hint: "Ce que je n'ai pas encore ouvert" },
          { value: 'read', label: 'Déjà lus', hint: "Ce que j'ai déjà ouvert" },
        ]}
      />
    </>
  );

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 w-full overflow-x-auto py-0.5">
        {chips}
        {activeCount > 0 && onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-outlook-text-secondary hover:text-outlook-blue hover:bg-outlook-bg-hover whitespace-nowrap flex-shrink-0"
          >
            <RotateCcw size={12} /> Réinitialiser
          </button>
        )}
        <div className="flex-1 min-w-[8px]" />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-outlook-text-secondary hover:bg-red-50 hover:text-outlook-danger whitespace-nowrap flex-shrink-0"
            title="Quitter la recherche"
          >
            <XIcon size={12} /> Quitter
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 w-full py-1">
      {/* Ligne de titre */}
      <div className="flex items-center gap-2 px-0.5">
        <SlidersHorizontal size={13} className="text-outlook-blue flex-shrink-0" />
        <span className="text-xs font-semibold text-outlook-text-primary whitespace-nowrap">Affiner la recherche</span>
        {activeCount > 0 && (
          <span className="px-1.5 py-px rounded-full bg-outlook-blue/15 text-outlook-blue text-[10px] font-semibold whitespace-nowrap">
            {activeCount} filtre{activeCount > 1 ? 's' : ''}
          </span>
        )}
        <span className="text-[11px] text-outlook-text-disabled hidden xl:inline truncate">
          Indiquez où et quand chercher — la liste se met à jour toute seule.
        </span>
        <div className="flex-1" />
        {activeCount > 0 && onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-outlook-text-secondary hover:text-outlook-blue hover:bg-outlook-bg-hover whitespace-nowrap"
          >
            <RotateCcw size={12} /> Tout réinitialiser
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1 rounded border border-outlook-border text-[11px] text-outlook-text-secondary hover:bg-red-50 hover:text-outlook-danger hover:border-outlook-danger/40 whitespace-nowrap transition-colors"
            title="Revenir à la liste des messages"
          >
            <XIcon size={12} /> Quitter la recherche
          </button>
        )}
      </div>

      {/* Pastilles */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 px-0.5">
        {chips}
      </div>
    </div>
  );
}

// ─── En-tête de résultats ─────────────────────────────────────────────────────

export interface ActiveFilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

/** Résumé lisible des filtres actifs, pour l'en-tête de résultats. */
export function buildActiveFilterChips(
  s: SearchFilterState,
  h: SearchFilterHandlers,
  opts: { accounts: MailAccount[]; currentFolder?: string },
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (s.scope !== 'current-folder') {
    chips.push({
      key: 'scope',
      label: s.scope === 'all-folders' ? 'Partout' : 'Toute cette boîte',
      onClear: () => h.onScopeChange?.('current-folder'),
    });
  }
  if (s.accountId) {
    const acc = opts.accounts.find((a) => a.id === s.accountId);
    chips.push({
      key: 'account',
      label: acc ? getAccountDisplayName(acc) : 'Compte',
      onClear: () => h.onAccountChange?.(''),
    });
  }
  if (s.datePreset !== 'all') {
    chips.push({ key: 'date', label: DATE_PRESET_LABELS[s.datePreset], onClear: () => h.onDatePresetChange?.('all') });
  }
  if (s.from.trim()) {
    chips.push({ key: 'from', label: `De : ${s.from.trim()}`, onClear: () => h.onFromChange?.('') });
  }
  if (s.hasAttachment !== 'any') {
    chips.push({ key: 'attach', label: ATTACHMENT_LABELS[s.hasAttachment], onClear: () => h.onHasAttachmentChange?.('any') });
  }
  if (s.isRead !== 'any') {
    chips.push({ key: 'read', label: READ_STATE_LABELS[s.isRead], onClear: () => h.onIsReadChange?.('any') });
  }
  return chips;
}

export function SearchResultsHeader({
  query, count, loading, chips, onClearAll, onClose, scopeLabel, children,
}: {
  query: string;
  count: number | null;
  loading?: boolean;
  chips: ActiveFilterChip[];
  onClearAll?: () => void;
  onClose?: () => void;
  scopeLabel: string;
  /** Rangée de filtres supplémentaire — utilisée sur mobile, où il n'y a pas de ruban. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex-shrink-0 border-b border-outlook-border bg-gradient-to-r from-outlook-blue/10 via-outlook-blue/5 to-transparent">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="w-7 h-7 rounded-full bg-outlook-blue/15 flex items-center justify-center flex-shrink-0">
          <Search size={14} className="text-outlook-blue" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-outlook-text-primary truncate">
              <span className="text-outlook-text-secondary">Recherche de </span>
              <span className="font-semibold">« {query} »</span>
            </span>
            {loading ? (
              <span className="flex items-center gap-1.5 text-[11px] text-outlook-text-secondary flex-shrink-0">
                <span className="w-3 h-3 border-[1.5px] border-outlook-blue border-t-transparent rounded-full animate-spin" />
                Recherche…
              </span>
            ) : count !== null && (
              <span className={`px-2 py-px rounded-full text-[11px] font-semibold flex-shrink-0
                ${count > 0 ? 'bg-outlook-blue text-white' : 'bg-outlook-bg-tertiary text-outlook-text-secondary'}`}>
                {count} message{count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="text-[11px] text-outlook-text-secondary truncate">dans {scopeLabel}</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-outlook-text-secondary hover:bg-red-50 hover:text-outlook-danger flex-shrink-0 transition-colors"
            title="Quitter la recherche"
          >
            <XIcon size={13} /> <span className="hidden sm:inline">Quitter</span>
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-outlook-text-disabled font-semibold">Filtres</span>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onClear}
              className="group flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full bg-outlook-bg-secondary border border-outlook-border text-[11px] text-outlook-text-primary hover:border-outlook-danger/50 hover:text-outlook-danger transition-colors"
              title={`Retirer « ${c.label} »`}
            >
              {c.label}
              <XIcon size={10} className="text-outlook-text-disabled group-hover:text-outlook-danger" />
            </button>
          ))}
          {onClearAll && chips.length > 1 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[11px] text-outlook-blue hover:underline ml-0.5"
            >
              Tout effacer
            </button>
          )}
        </div>
      )}

      {children && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

// ─── Écran « rien trouvé » ────────────────────────────────────────────────────

export function SearchEmptyState({
  query, scopeLabel, canWiden, elsewhereCount, onWiden, hasFilters, onClearFilters,
}: {
  query: string;
  scopeLabel: string;
  /** Vrai tant qu'il reste un cran plus large à essayer. */
  canWiden: boolean;
  /** Messages trouvés hors du périmètre courant (null = pas encore connu). */
  elsewhereCount: number | null;
  onWiden?: () => void;
  hasFilters: boolean;
  onClearFilters?: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12">
      <span className="w-14 h-14 rounded-full bg-outlook-bg-tertiary flex items-center justify-center mb-3">
        <Search size={24} className="text-outlook-text-disabled" />
      </span>
      <p className="text-sm font-semibold text-outlook-text-primary">
        Aucun message ne contient « {query} »
      </p>
      <p className="text-xs text-outlook-text-secondary mt-1 max-w-sm">
        La recherche portait sur {scopeLabel}.
      </p>

      {/* Le réflexe utile : élargir plutôt que renoncer. Quand on sait déjà
          combien de messages existent ailleurs, on le dit avant de cliquer. */}
      {canWiden && onWiden && (
        <button
          type="button"
          onClick={onWiden}
          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-full bg-outlook-blue text-white text-xs font-semibold shadow-sm hover:bg-outlook-blue-hover transition-colors"
        >
          <Globe2 size={14} />
          {elsewhereCount && elsewhereCount > 0
            ? `Voir les ${elsewhereCount} message${elsewhereCount > 1 ? 's' : ''} trouvé${elsewhereCount > 1 ? 's' : ''} en cherchant partout`
            : 'Chercher dans toutes mes boîtes'}
        </button>
      )}

      {hasFilters && onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 flex items-center gap-1.5 text-xs text-outlook-blue hover:underline"
        >
          <RotateCcw size={12} /> Retirer les filtres
        </button>
      )}

      <ul className="mt-5 text-[11px] text-outlook-text-disabled space-y-1">
        <li>Vérifiez l'orthographe du mot recherché</li>
        <li>Essayez un mot plus court, ou juste le nom de l'expéditeur</li>
      </ul>
    </div>
  );
}
