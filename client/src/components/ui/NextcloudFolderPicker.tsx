import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Folder, FolderPlus, ChevronLeft, X, CloudUpload, Home, Loader2, Check } from 'lucide-react';
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

export default function NextcloudFolderPicker({ open, title, subtitle, onPick, onClose }: NextcloudFolderPickerProps) {
  const [path, setPath] = useState<string>('/');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderInput, setNewFolderInput] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async (p: string) => {
    setLoading(true);
    setError(null);
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
      load('/');
    }
  }, [open]);

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

        {/* Listing */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-outlook-text-secondary">
              <Loader2 size={16} className="animate-spin mr-2" /> Chargement...
            </div>
          ) : error ? (
            <div className="px-4 py-6 text-sm text-red-600">{error}</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-8 text-sm text-outlook-text-disabled text-center">
              Aucun sous-dossier dans ce dossier.
            </div>
          ) : (
            <ul>
              {items.map(it => (
                <li key={it.path}>
                  <button
                    onClick={() => load(it.path)}
                    className="w-full text-left px-4 py-2 flex items-center gap-2 text-sm hover:bg-outlook-bg-hover border-b border-outlook-border/50"
                  >
                    <Folder size={14} className="text-outlook-blue flex-shrink-0" />
                    <span className="truncate">{it.name}</span>
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
