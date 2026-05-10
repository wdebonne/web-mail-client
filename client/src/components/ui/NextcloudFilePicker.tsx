import { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Folder, ChevronLeft, X, Home, Loader2, Check, Cloud, Search } from 'lucide-react';
import { api } from '../../api';

/**
 * Modal that lets the user browse their NextCloud drive and pick one or more
 * files to attach to a composition. Folders are navigated; files are selectable.
 * The parent receives the selected file metadata via `onPick` and is responsible
 * for downloading the content (via api.nextcloudFilesGet).
 */
export interface NextcloudFileItem {
  path: string;
  name: string;
  contentType?: string;
  size?: number;
}

export interface NextcloudFilePickerProps {
  open: boolean;
  onPick: (files: NextcloudFileItem[]) => void;
  onClose: () => void;
}

type Item = { name: string; path: string; isFolder: boolean; size?: number; contentType?: string };

function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function NextcloudFilePicker({ open, onPick, onClose }: NextcloudFilePickerProps) {
  const [path, setPath] = useState<string>('/');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const load = async (p: string) => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setSearch('');
    try {
      const res = await api.nextcloudFilesList(p);
      setItems(res.items);
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
      setSelected(new Set());
      setSearch('');
      load('/');
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [items, search]);

  if (!open) return null;

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
    load(segs.length ? '/' + segs.join('/') : '/');
  };

  const toggleSelect = (item: Item) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  };

  const selectedItems = items.filter(i => !i.isFolder && selected.has(i.path));

  const handleAttach = () => {
    if (selectedItems.length === 0) return;
    onPick(selectedItems.map(i => ({ path: i.path, name: i.name, contentType: i.contentType, size: i.size })));
  };

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
        <div className="px-4 py-3 border-b border-outlook-border flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-outlook-text-primary">
            <Cloud size={16} className="text-outlook-blue" />
            Joindre depuis Nextcloud
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
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher dans ce dossier…"
              className="w-full pl-7 pr-3 py-1.5 text-xs border border-outlook-border rounded focus:outline-none focus:border-outlook-blue bg-white"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled hover:text-outlook-text-primary">
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumb / nav */}
        <div className="px-4 py-2 border-b border-outlook-border bg-outlook-bg-primary/40 flex items-center gap-1 text-xs flex-shrink-0 overflow-x-auto">
          <button
            onClick={goUp}
            disabled={path === '/' || path === ''}
            className="p-1 rounded hover:bg-outlook-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Dossier parent"
          >
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => load('/')} className="p-1 rounded hover:bg-outlook-bg-hover" aria-label="Racine">
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

        {/* Listing */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-outlook-text-secondary">
              <Loader2 size={16} className="animate-spin mr-2" /> Chargement...
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-sm text-red-600">{error}</div>
          ) : filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-sm text-outlook-text-disabled text-center">
              {search ? `Aucun résultat pour « ${search} »` : 'Ce dossier est vide.'}
            </div>
          ) : (
            <ul>
              {filteredItems.map(item => {
                const isSelected = !item.isFolder && selected.has(item.path);
                return (
                  <li key={item.path}>
                    <button
                      onClick={() => item.isFolder ? load(item.path) : toggleSelect(item)}
                      className={`w-full text-left px-4 py-2 flex items-center gap-2 text-sm border-b border-outlook-border/50 transition-colors ${
                        isSelected
                          ? 'bg-outlook-blue/10 hover:bg-outlook-blue/15'
                          : 'hover:bg-outlook-bg-hover'
                      }`}
                    >
                      {item.isFolder ? (
                        <Folder size={14} className="text-outlook-blue flex-shrink-0" />
                      ) : (
                        <div className={`w-3.5 h-3.5 flex-shrink-0 rounded border flex items-center justify-center ${
                          isSelected ? 'bg-outlook-blue border-outlook-blue' : 'border-outlook-text-disabled'
                        }`}>
                          {isSelected && <Check size={9} className="text-white" />}
                        </div>
                      )}
                      <span className="truncate flex-1">{item.name}</span>
                      {!item.isFolder && item.size != null && (
                        <span className="text-xs text-outlook-text-disabled flex-shrink-0">{formatSize(item.size)}</span>
                      )}
                      {item.isFolder && (
                        <ChevronLeft size={12} className="rotate-180 text-outlook-text-disabled flex-shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-outlook-border flex items-center justify-between gap-2 flex-shrink-0 bg-outlook-bg-primary/30">
          <div className="text-xs text-outlook-text-secondary">
            {selected.size > 0
              ? `${selected.size} fichier${selected.size > 1 ? 's' : ''} sélectionné${selected.size > 1 ? 's' : ''}`
              : 'Cliquez sur un fichier pour le sélectionner'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-outlook-border hover:bg-outlook-bg-hover"
            >
              Annuler
            </button>
            <button
              onClick={handleAttach}
              disabled={selected.size === 0}
              className="px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:opacity-90 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={12} /> Joindre
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
