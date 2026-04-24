import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderPlus, Search, X, Check } from 'lucide-react';
import { MailFolder } from '../../types';
import { sortFolders } from '../../utils/mailPreferences';

export interface FolderPickerDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  folders: MailFolder[];
  accountId?: string;
  /** Dossier initialement sélectionné (chemin IMAP). */
  initialPath?: string | null;
  /**
   * Appelé quand l'utilisateur crée un nouveau dossier. Doit retourner le
   * chemin final créé (ou null en cas d'échec) — permet de le pré-sélectionner.
   */
  onCreate?: (accountId: string, name: string, parentPath?: string) => Promise<string | null> | string | null | void;
  onPick: (folderPath: string) => void;
  onCancel: () => void;
}

/**
 * Modal de sélection d'un dossier IMAP avec champ de recherche et option
 * "Créer un dossier". Utilisé par les gestes de balayage (actions Déplacer /
 * Copier) quand aucun dossier cible n'a encore été configuré, ainsi que dans
 * les préférences pour définir ces cibles par compte.
 */
export default function FolderPickerDialog({
  open,
  title = 'Choisir un dossier',
  description,
  confirmLabel = 'Sélectionner',
  folders,
  accountId,
  initialPath,
  onCreate,
  onPick,
  onCancel,
}: FolderPickerDialogProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(initialPath ?? null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(initialPath ?? null);
    setSearch('');
    setCreating(false);
    setNewName('');
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, initialPath, onCancel]);

  const sorted = useMemo(() => sortFolders(folders, accountId), [folders, accountId]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(f =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  if (!open) return null;

  const canConfirm = !!selected;

  const handleCreate = async () => {
    if (!onCreate || !accountId || !newName.trim()) return;
    setBusy(true);
    try {
      const result = await onCreate(accountId, newName.trim());
      if (typeof result === 'string' && result) {
        setSelected(result);
      }
      setCreating(false);
      setNewName('');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h3 className="text-sm font-semibold text-outlook-text-primary">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {description && (
          <p className="px-4 pt-3 text-xs text-outlook-text-secondary">{description}</p>
        )}

        <div className="px-4 py-3 border-b border-outlook-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un dossier…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-outlook-border rounded-md focus:outline-none focus:ring-1 focus:ring-outlook-blue"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="text-center py-6 text-sm text-outlook-text-disabled">Aucun dossier</div>
          ) : (
            filtered.map(f => {
              const isSel = selected === f.path;
              return (
                <button
                  key={f.path}
                  onClick={() => setSelected(f.path)}
                  onDoubleClick={() => onPick(f.path)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left text-sm transition-colors
                    ${isSel ? 'bg-blue-50 text-outlook-blue font-medium' : 'hover:bg-outlook-bg-hover text-outlook-text-primary'}`}
                >
                  <Folder size={14} className="flex-shrink-0" />
                  <span className="flex-1 truncate" title={f.path}>{f.name}</span>
                  {isSel && <Check size={14} />}
                </button>
              );
            })
          )}
        </div>

        {onCreate && accountId && (
          <div className="px-4 py-2 border-t border-outlook-border">
            {creating ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
                    if (e.key === 'Escape') { e.preventDefault(); setCreating(false); setNewName(''); }
                  }}
                  placeholder="Nom du nouveau dossier"
                  autoFocus
                  className="flex-1 px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue"
                />
                <button
                  onClick={handleCreate}
                  disabled={busy || !newName.trim()}
                  className="px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
                >
                  Créer
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName(''); }}
                  className="px-2 py-1.5 text-xs rounded text-outlook-text-secondary hover:bg-outlook-bg-hover"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-2 text-sm text-outlook-blue hover:underline"
              >
                <FolderPlus size={14} />
                Créer un dossier
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-outlook-border bg-outlook-bg-primary/40">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded text-outlook-text-secondary hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
          <button
            onClick={() => selected && onPick(selected)}
            disabled={!canConfirm}
            className="px-4 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
