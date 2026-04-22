import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Star, Pencil, Trash2, Plus, Search, Tag, Check, Settings,
} from 'lucide-react';
import {
  MailCategory, CATEGORY_COLORS,
  getCategories, createCategory, updateCategory, deleteCategory,
  toggleCategoryFavorite, subscribeCategories,
} from '../../utils/categories';

// ─────────────────────────────────────────────────────────────────────────
// Shared colour swatch grid used by both create & edit dialogs.
// ─────────────────────────────────────────────────────────────────────────
function ColorPalette({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="grid grid-cols-12 gap-2">
      {CATEGORY_COLORS.map((c) => {
        const active = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold transition-transform
              ${active ? 'ring-2 ring-offset-2 ring-outlook-blue scale-105' : 'hover:scale-105'}`}
            style={{ backgroundColor: c, color: 'rgba(0,0,0,0.55)' }}
            title={c}
          >
            A
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Create / Edit modal (same layout).
// ─────────────────────────────────────────────────────────────────────────
export interface CategoryEditorProps {
  mode: 'create' | 'edit';
  initial?: MailCategory;
  onClose: () => void;
  onSaved?: (cat: MailCategory) => void;
}

export function CategoryEditorModal({ mode, initial, onClose, onSaved }: CategoryEditorProps) {
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || CATEGORY_COLORS[0]);
  const [isFavorite, setIsFavorite] = useState(!!initial?.isFavorite);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const disabled = !name.trim();

  const submit = () => {
    if (disabled) return;
    if (mode === 'create') {
      const cat = createCategory({ name, color, isFavorite });
      onSaved?.(cat);
    } else if (initial) {
      updateCategory(initial.id, { name, color, isFavorite });
      onSaved?.({ ...initial, name, color, isFavorite });
    }
    onClose();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/30" onClick={onClose} />
      <div
        className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          bg-white rounded-lg shadow-xl w-[560px] max-w-[94vw] p-5"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-outlook-text-primary">
            {mode === 'create' ? 'Créer une catégorie' : 'Modifier la catégorie'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        <label className="block text-sm font-medium text-outlook-text-primary mb-1">Nom</label>
        <div className="flex items-center gap-2 mb-4">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Donner un nom à votre catégorie"
            className="flex-1 px-3 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:border-outlook-blue"
            maxLength={80}
          />
          <button
            type="button"
            onClick={() => setIsFavorite((v) => !v)}
            className={`p-1.5 rounded transition-colors ${isFavorite ? 'text-outlook-warning' : 'text-outlook-text-disabled hover:text-outlook-text-secondary'}`}
            title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>

        <label className="block text-sm font-medium text-outlook-text-primary mb-2">Couleur</label>
        <div className="mb-5 p-3 rounded border border-outlook-border bg-outlook-bg-primary">
          <ColorPalette value={color} onChange={setColor} />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={disabled}
            className={`px-4 py-1.5 text-sm rounded text-white transition-colors
              ${disabled ? 'bg-outlook-blue/40 cursor-not-allowed' : 'bg-outlook-blue hover:bg-outlook-blue-hover'}`}
          >
            Enregistrer
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Manage modal — list of all categories with favorite/edit/delete actions.
// ─────────────────────────────────────────────────────────────────────────
export interface CategoryManageProps {
  onClose: () => void;
  onCreate: () => void;
  onEdit: (cat: MailCategory) => void;
}

export function CategoryManageModal({ onClose, onCreate, onEdit }: CategoryManageProps) {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeCategories(() => setVersion((n) => n + 1)), []);
  const list = useMemo(() => getCategories(), [version]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/30" onClick={onClose} />
      <div
        className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          bg-white rounded-lg shadow-xl w-[620px] max-w-[94vw] max-h-[80vh] flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outlook-border">
          <h2 className="text-lg font-semibold text-outlook-text-primary">Catégories</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <p className="text-xs text-outlook-text-secondary max-w-sm">
            Le classement de votre courrier et de votre calendrier à l'aide de catégories peut
            vous aider à organiser et suivre les messages et événements liés à un projet, une
            tâche ou une personne. Vous pouvez créer des catégories et leur attribuer des noms
            et des couleurs.
          </p>
          <button
            onClick={onCreate}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
          >
            <Plus size={14} /> Créer
          </button>
        </div>

        <div className="px-5 pb-4 text-xs font-medium text-outlook-text-secondary">
          Nom de la catégorie
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
          {list.length === 0 ? (
            <div className="text-center text-outlook-text-disabled text-sm py-8">
              Aucune catégorie. Cliquez sur « Créer ».
            </div>
          ) : (
            list.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-3 px-3 py-2 mx-2 rounded hover:bg-outlook-bg-hover group"
              >
                <Tag size={14} style={{ color: cat.color }} />
                <span className="flex-1 text-sm text-outlook-text-primary truncate">{cat.name}</span>
                <button
                  onClick={() => toggleCategoryFavorite(cat.id)}
                  className={`p-1 rounded transition-colors ${cat.isFavorite ? 'text-outlook-warning' : 'text-outlook-text-disabled hover:text-outlook-warning'}`}
                  title={cat.isFavorite ? 'Retirer des favoris (supprime du volet dossiers)' : 'Ajouter aux favoris (afficher dans le volet dossiers)'}
                >
                  <Star size={15} fill={cat.isFavorite ? 'currentColor' : 'none'} />
                </button>
                <button
                  onClick={() => onEdit(cat)}
                  className="p-1 rounded text-outlook-text-disabled hover:text-outlook-blue"
                  title="Modifier"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Supprimer la catégorie « ${cat.name} » ?`)) {
                      deleteCategory(cat.id);
                    }
                  }}
                  className="p-1 rounded text-outlook-text-disabled hover:text-outlook-danger"
                  title="Supprimer"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Dropdown picker (the "Catégoriser" ribbon / context menu popup)
// ─────────────────────────────────────────────────────────────────────────
export interface CategoryPickerProps {
  top: number;
  left: number;
  assigned: string[]; // ids of categories already on the message
  onToggle: (id: string) => void;
  onClear: () => void;
  onCreate: () => void;
  onManage: () => void;
  onClose: () => void;
}

export function CategoryPicker({
  top, left, assigned, onToggle, onClear, onCreate, onManage, onClose,
}: CategoryPickerProps) {
  const [query, setQuery] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeCategories(() => setVersion((n) => n + 1)), []);
  const all = useMemo(() => getCategories(), [version]);
  const filtered = query
    ? all.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : all;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] bg-white border border-outlook-border rounded-md shadow-lg min-w-[240px] max-w-[300px] py-1"
        style={{ top, left }}
      >
        <div className="px-2 pb-1">
          <div className="flex items-center gap-1 px-2 py-1 border border-outlook-border rounded bg-outlook-bg-primary">
            <Search size={12} className="text-outlook-text-disabled" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une catégorie"
              className="flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-outlook-text-disabled">Aucun résultat</div>
          ) : (
            filtered.map((cat) => {
              const isOn = assigned.includes(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => onToggle(cat.id)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover"
                >
                  <span className="w-4 flex items-center justify-center">
                    {isOn && <Check size={12} className="text-outlook-blue" />}
                  </span>
                  <Tag size={14} style={{ color: cat.color }} />
                  <span className="flex-1 text-left truncate">{cat.name}</span>
                  {cat.isFavorite && (
                    <Star size={11} className="text-outlook-warning" fill="currentColor" />
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-outlook-border mt-1">
          <button
            onClick={onCreate}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover"
          >
            <Plus size={14} /> Nouvelle catégorie
          </button>
          <button
            onClick={onClear}
            disabled={!assigned.length}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover
              ${!assigned.length ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <X size={14} /> Effacer les catégories
          </button>
          <button
            onClick={onManage}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-outlook-bg-hover"
          >
            <Settings size={14} /> Gérer les catégories
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
