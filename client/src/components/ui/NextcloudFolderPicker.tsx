import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Folder, FolderPlus, ChevronLeft, X, CloudUpload, Home, Loader2, Check, Search } from 'lucide-react';
import { api } from '../../api';

/**
 * Modal that lets the user pick a folder in their NextCloud drive to save
 * one or several mail attachments. Supports creating subfolders on the fly
 * with a free-form path (slashes create the full hierarchy).
 *
 * The component does not perform the upload itself — once the user clicks
 * "Save here", the parent receives the chosen absolute path via `onPick`.
 */
export interface NextcloudFolderPickerProps {
  open: boolean;
  /** Optional title shown in the header. */
  title?: string;
  /** Optional subtitle (e.g. number/name of items being saved). */
  subtitle?: string;
  /** Called when the user picks a destination folder (absolute path, starts with '/'). */
  onPick: (folderPath: string) => void;
  onClose: () => void;
}

type Item = { name: string; path: string; isFolder: boolean };

function joinPath(base: string, segment: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const s = segment.startsWith('/') ? segment : '/' + segment;
  return (b + s) || '/';
}

function parentLabel(path: string): string {
  const segs = path.split('/').filter(Boolean);
  if (segs.length <= 1) return 'Racine';
  return segs.slice(0, -1).join(' / ');
}

export default function NextcloudFolderPicker({ open, title, subtitle, onPick, onClose }: NextcloudFolderPickerProps) {
  const [path, setPath] = useState<string>('/');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderInput, setNewFolderInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSearchMode = search.trim().length >= 2;

  const load = async (p: string) => {
    setLoading(true);
    setError(null);
    setSearch('');
    setSearchResults([]);
    try {
      const res = await api.nextcloudFilesList(p);
      // Only show folders to make navigation crisp; files are noise here.
      setItems(res.items.filter(i => i.isFolder));
      setPath(res.path || p);
    } catch (e: any) {
      setError(e?.message || 'Erreur de chargement');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setPath('/');
      setNewFolderInput('');
      setSearch('');
      setSearchResults([]);
      load('/');
    }
  }, [open]);

  // Debounced global search triggered when query reaches 2+ chars.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isSearchMode) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await api.nextcloudFilesSearch(search.trim());
        // Folder picker only needs folders.
        setSearchResults(res.items.filter(i => i.isFolder));
      } catch (e: any) {
        setSearchError(e?.message || 'Erreur de recherche');
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  if (!open) return null;

  const filteredBrowseItems = search.trim() && !isSearchMode
    ? items.filter(it => it.name.toLowerCase().includes(search.trim().toLowerCase()))
    : items;

  const visibleItems = isSearchMode ? searchResults : filteredBrowseItems;

  const breadcrumbs = (() => {
    const segs = path.split('/').filter(Boolean);
    const acc: Array<{ label: string; path: string }> = [{ label: 'Racine', path: '/' }];
    let cur = '';
    for (const s of segs) {
      cur = cur + '/' + s;
      acc.push({ label: s, path: cur });
    }
    return acc;
  })();

  const goUp = () => {
    if (path === '/' || path === '') return;
    const segs = path.split('/').filter(Boolean);
    segs.pop();
    const parent = segs.length ? '/' + segs.join('/') : '/';
    load(parent);
  };

  const handleCreateFolder = async () => {
    const name = newFolderInput.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const target = joinPath(path, name);
      await api.nextcloudFilesMkdir(target);
      setNewFolderInput('');
      await load(path);
    } catch (e: any) {
      setError(e?.message || 'Échec de création du dossier');
    } finally {
      setCreating(false);
    }
  };

  const isLoading = isSearchMode ? searchLoading : loading;
  const currentError = isSearchMode ? searchError : error;

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-lg shadow-xl border border-outlook-border overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-outlook-border flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-outlook-text-primary">
              <CloudUpload size={16} className="text-outlook-blue" />
              {title || 'Enregistrer dans Nextcloud'}
            </div>
            {subtitle && <div className="text-xs text-outlook-text-secondary mt-0.5 truncate">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-outlook-bg-hover" aria-label="Fermer">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-outlook-border flex-shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un dossier dans tout Nextcloud…"
              className="w-full pl-7 pr-3 py-1.5 text-xs border border-outlook-border rounded focus:outline-none focus:border-outlook-blue bg-white"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); searchRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled hover:text-outlook-text-primary"
                aria-label="Effacer la recherche"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumb / nav — hidden in global search mode */}
        {!isSearchMode && (
          <div className="px-4 py-2 border-b border-outlook-border bg-outlook-bg-primary/40 flex items-center gap-1 text-xs flex-shrink-0 overflow-x-auto">
            <button
              onClick={goUp}
              disabled={path === '/' || path === ''}
              className="p-1 rounded hover:bg-outlook-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Dossier parent"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => load('/')}
              className="p-1 rounded hover:bg-outlook-bg-hover"
              aria-label="Racine"
            >
              <Home size={13} />
            </button>
            <div className="flex items-center gap-0.5 min-w-0 flex-wrap">
              {breadcrumbs.map((b, idx) => (
                <span key={b.path} className="flex items-center gap-0.5">
                  {idx > 0 && <span className="text-outlook-text-disabled">/</span>}
                  <button
                    onClick={() => load(b.path)}
                    className={`px-1.5 py-0.5 rounded hover:bg-outlook-bg-hover truncate max-w-[120px] ${
                      idx === breadcrumbs.length - 1 ? 'font-medium text-outlook-text-primary' : 'text-outlook-text-secondary'
                    }`}
                  >
                    {b.label}
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Global search indicator */}
        {isSearchMode && (
          <div className="px-4 py-1.5 border-b border-outlook-border bg-outlook-blue/5 flex items-center gap-1.5 text-xs text-outlook-text-secondary flex-shrink-0">
            <Search size={11} className="text-outlook-blue flex-shrink-0" />
            {searchLoading
              ? 'Recherche en cours…'
              : `${searchResults.length} dossier${searchResults.length !== 1 ? 's' : ''} pour « ${search.trim()} »`}
          </div>
        )}

        {/* Listing */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-outlook-text-secondary">
              <Loader2 size={16} className="animate-spin mr-2" /> {isSearchMode ? 'Recherche…' : 'Chargement…'}
            </div>
          ) : currentError ? (
            <div className="px-4 py-6 text-sm text-red-600">{currentError}</div>
          ) : visibleItems.length === 0 ? (
            <div className="px-4 py-8 text-sm text-outlook-text-disabled text-center">
              {isSearchMode
                ? `Aucun dossier pour « ${search.trim()} ».`
                : search.trim()
                  ? `Aucun dossier correspondant à « ${search.trim()} ».`
                  : 'Aucun sous-dossier dans ce dossier.'}
            </div>
          ) : (
            <ul>
              {visibleItems.map(it => (
                <li key={it.path}>
                  <button
                    onClick={() => load(it.path)}
                    className="w-full text-left px-4 py-2 flex items-center gap-2 text-sm hover:bg-outlook-bg-hover border-b border-outlook-border/50"
                  >
                    <Folder size={14} className="text-outlook-blue flex-shrink-0" />
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{it.name}</span>
                      {isSearchMode && (
                        <span className="text-[10px] text-outlook-text-disabled truncate">{parentLabel(it.path)}</span>
                      )}
                    </span>
                    <ChevronLeft size={12} className="rotate-180 text-outlook-text-disabled flex-shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Create folder */}
        <div className="px-4 py-2 border-t border-outlook-border flex items-center gap-2 flex-shrink-0">
          <FolderPlus size={14} className="text-outlook-text-secondary flex-shrink-0" />
          <input
            type="text"
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
            placeholder="Nouveau dossier (autorise sous/dossiers)"
            className="flex-1 px-2 py-1 text-xs border border-outlook-border rounded focus:outline-none focus:border-outlook-blue"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderInput.trim() || creating}
            className="px-3 py-1 text-xs rounded bg-outlook-bg-hover hover:bg-outlook-bg-active disabled:opacity-40 flex items-center gap-1"
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
            Créer
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-outlook-border flex items-center justify-between gap-2 flex-shrink-0 bg-outlook-bg-primary/30">
          <div className="text-xs text-outlook-text-secondary truncate">
            Destination : <span className="font-medium text-outlook-text-primary">{path}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-outlook-border hover:bg-outlook-bg-hover"
            >
              Annuler
            </button>
            <button
              onClick={() => onPick(path)}
              className="px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:opacity-90 flex items-center gap-1"
            >
              <Check size={12} /> Enregistrer ici
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
