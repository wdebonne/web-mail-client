import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  X, Search, Plus, StickyNote, Cloud, Loader2, Pin, Maximize2, Check,
  Folder, ChevronLeft, Home, FileText, FileSpreadsheet, FileImage, File as FileIcon,
  Copy, Paperclip, CornerDownLeft,
} from 'lucide-react';
import { api, type Note } from '../../api';
import {
  type NcItem, type ExtractedFile,
  classifyFile, extractNextcloudFile, nextcloudItemToFile,
  formatSize, noteExcerpt, relativeDate, textToHtml, NOTE_COLOR_HEX,
} from './notesShared';

/**
 * Panneau latéral « Notes » — s'ouvre dans la fenêtre de composition, à côté
 * de l'éditeur, exactement comme le panneau emoji (voir EmojiPanel.tsx) : même
 * largeur, même chrome, même contrat d'insertion au curseur.
 *
 * Deux onglets :
 *  - Notes    : recherche / création rapide, un clic insère la note ;
 *  - Fichiers : navigation et recherche dans le Nextcloud de l'utilisateur,
 *               avec extraction du contenu pour le coller dans le message.
 *
 * L'onglet Fichiers n'apparaît que si le compte Nextcloud est lié.
 */

export interface NotesPanelProps {
  open: boolean;
  onClose: () => void;
  /** Insère du HTML au curseur dans l'éditeur de composition. */
  onInsertHtml: (html: string) => void;
  /** Joint des fichiers au message en cours (optionnel). */
  onAttachFiles?: (files: File[]) => void;
  /** Ouvre la grande modale (gestion complète). */
  onOpenFull?: () => void;
}

type Tab = 'notes' | 'files';

export default function NotesPanel({ open, onClose, onInsertHtml, onAttachFiles, onOpenFull }: NotesPanelProps) {
  const [tab, setTab] = useState<Tab>('notes');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [ncLinked, setNcLinked] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.getUserNextcloudStatus()
      .then(s => { if (!cancelled) setNcLinked(!!(s.enabled && s.linked)); })
      .catch(() => { if (!cancelled) setNcLinked(false); });
    return () => { cancelled = true; };
  }, [open]);

  // Un compte délié ne doit pas laisser l'utilisateur bloqué sur un onglet vide.
  useEffect(() => {
    if (!ncLinked && tab === 'files') setTab('notes');
  }, [ncLinked, tab]);

  if (!open) return null;

  return (
    <aside
      className="flex-shrink-0 w-80 h-full bg-white rounded-md shadow-sm overflow-hidden flex flex-col border border-outlook-border"
      aria-label="Panneau de notes et fichiers"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-outlook-border">
        <h3 className="text-sm font-semibold text-outlook-text-primary">Notes</h3>
        <div className="flex items-center gap-0.5">
          {onOpenFull && (
            <button
              onClick={onOpenFull}
              className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
              title="Ouvrir en grand"
            >
              <Maximize2 size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Onglets */}
      {ncLinked && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-outlook-border flex-shrink-0">
          <TabButton icon={StickyNote} label="Notes" active={tab === 'notes'} onClick={() => setTab('notes')} />
          <TabButton icon={Cloud} label="Fichiers" active={tab === 'files'} onClick={() => setTab('files')} />
        </div>
      )}

      {/* Recherche */}
      <div className="px-3 py-2 border-b border-outlook-border">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'notes' ? 'Rechercher dans mes notes' : 'Rechercher un fichier'}
            className="w-full text-xs pl-7 pr-2 py-1.5 bg-outlook-bg-tertiary rounded border border-transparent focus:bg-white focus:border-outlook-blue outline-none"
          />
        </div>
      </div>

      {tab === 'notes'
        ? <NotesTab query={debouncedQuery} onInsertHtml={onInsertHtml} />
        : <FilesTab query={debouncedQuery} onInsertHtml={onInsertHtml} onAttachFiles={onAttachFiles} />}
    </aside>
  );
}

function TabButton({ icon: Icon, label, active, onClick }: {
  icon: typeof StickyNote; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-outlook-blue/10 text-outlook-blue'
          : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Notes
// ─────────────────────────────────────────────────────────────────────────

function NotesTab({ query, onInsertHtml }: { query: string; onInsertHtml: (html: string) => void }) {
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', query],
    queryFn: () => api.listNotes(query),
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: (text: string) => api.createNote({ contentHtml: textToHtml(text) }),
    onSuccess: () => {
      setDraft('');
      setComposing(false);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Note créée');
    },
    onError: (e: any) => toast.error(e?.message || 'Échec de la création'),
  });

  const pinMut = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) => api.updateNote(id, { isPinned }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  useEffect(() => {
    if (composing) draftRef.current?.focus();
  }, [composing]);

  const insert = (note: Note) => {
    onInsertHtml(note.contentHtml);
    toast.success('Note insérée dans le message');
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Création rapide */}
      <div className="px-2 pt-2">
        {composing ? (
          <div className="border border-outlook-blue rounded p-2 bg-outlook-bg-tertiary">
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setComposing(false); setDraft(''); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) createMut.mutate(draft);
              }}
              rows={4}
              placeholder="Votre note… (Ctrl+Entrée pour enregistrer)"
              className="w-full text-xs bg-white rounded border border-outlook-border p-2 outline-none focus:border-outlook-blue resize-y"
            />
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                onClick={() => draft.trim() && createMut.mutate(draft)}
                disabled={!draft.trim() || createMut.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
              >
                {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Enregistrer
              </button>
              <button
                onClick={() => { setComposing(false); setDraft(''); }}
                className="px-2 py-1 text-xs rounded text-outlook-text-secondary hover:bg-outlook-bg-hover"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setComposing(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded border border-dashed border-outlook-border text-outlook-text-secondary hover:border-outlook-blue hover:text-outlook-blue transition-colors"
          >
            <Plus size={13} />
            Nouvelle note
          </button>
        )}
      </div>

      {/* Liste */}
      <div className="p-2 space-y-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-outlook-text-secondary">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : notes.length === 0 ? (
          <div className="text-xs text-outlook-text-secondary text-center py-8">
            {query ? 'Aucune note trouvée' : 'Aucune note pour le moment'}
          </div>
        ) : (
          notes.map(note => (
            <div
              key={note.id}
              className="group rounded border border-outlook-border hover:border-outlook-blue bg-white transition-colors overflow-hidden"
              style={{ borderLeft: `3px solid ${NOTE_COLOR_HEX[note.color] || NOTE_COLOR_HEX.default}` }}
            >
              <button
                // preventDefault : garde le curseur dans l'éditeur pour que
                // l'insertion atterrisse au bon endroit (cf. EmojiPanel).
                onMouseDown={(e) => { e.preventDefault(); insert(note); }}
                className="w-full text-left px-2 py-1.5"
                title="Insérer dans le message"
              >
                <div className="flex items-start gap-1">
                  {note.isPinned && <Pin size={10} className="text-outlook-blue mt-0.5 flex-shrink-0" />}
                  <span className="text-xs font-medium text-outlook-text-primary line-clamp-1">{note.title}</span>
                </div>
                {note.contentText && (
                  <p className="text-[11px] text-outlook-text-secondary line-clamp-2 mt-0.5">
                    {noteExcerpt(note.contentText, 100)}
                  </p>
                )}
              </button>
              <div className="flex items-center gap-0.5 px-2 pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <MiniAction
                  icon={CornerDownLeft}
                  label="Insérer"
                  onMouseDown={(e) => { e.preventDefault(); insert(note); }}
                />
                <MiniAction
                  icon={Copy}
                  label="Copier"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    navigator.clipboard.writeText(note.contentText)
                      .then(() => toast.success('Note copiée'))
                      .catch(() => toast.error('Copie impossible'));
                  }}
                />
                <MiniAction
                  icon={Pin}
                  label={note.isPinned ? 'Désépingler' : 'Épingler'}
                  active={note.isPinned}
                  onMouseDown={(e) => { e.preventDefault(); pinMut.mutate({ id: note.id, isPinned: !note.isPinned }); }}
                />
                <span className="ml-auto text-[10px] text-outlook-text-disabled">
                  {relativeDate(note.updatedAt)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MiniAction({ icon: Icon, label, onMouseDown, active = false }: {
  icon: typeof Copy;
  label: string;
  onMouseDown: (e: React.MouseEvent) => void;
  active?: boolean;
}) {
  return (
    <button
      onMouseDown={onMouseDown}
      title={label}
      aria-label={label}
      className={`p-1 rounded hover:bg-outlook-bg-hover ${active ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`}
    >
      <Icon size={11} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Onglet Fichiers (Nextcloud)
// ─────────────────────────────────────────────────────────────────────────

const KIND_ICONS = {
  folder: Folder,
  text: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  image: FileImage,
  pdf: FileText,
  other: FileIcon,
} as const;

function FilesTab({ query, onInsertHtml, onAttachFiles }: {
  query: string;
  onInsertHtml: (html: string) => void;
  onAttachFiles?: (files: File[]) => void;
}) {
  const [path, setPath] = useState('/');
  const [items, setItems] = useState<NcItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NcItem | null>(null);

  const isSearching = query.length >= 2;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const run = isSearching
      ? api.nextcloudFilesSearch(query).then(r => r.items)
      : api.nextcloudFilesList(path).then(r => r.items);
    run
      .then(list => { if (!cancelled) setItems(list); })
      .catch((e: any) => { if (!cancelled) { setError(e?.message || 'Erreur de chargement'); setItems([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, query, isSearching]);

  const segments = useMemo(() => path.split('/').filter(Boolean), [path]);

  if (selected) {
    return (
      <FilePreview
        item={selected}
        onBack={() => setSelected(null)}
        onInsertHtml={onInsertHtml}
        onAttachFiles={onAttachFiles}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Fil d'Ariane */}
      {!isSearching && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-outlook-border text-[11px] text-outlook-text-secondary">
          <button
            onClick={() => setPath('/')}
            className="p-0.5 rounded hover:bg-outlook-bg-hover"
            title="Racine"
          >
            <Home size={12} />
          </button>
          {segments.length > 0 && (
            <>
              <button
                onClick={() => setPath('/' + segments.slice(0, -1).join('/'))}
                className="p-0.5 rounded hover:bg-outlook-bg-hover"
                title="Dossier parent"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="truncate">{segments.join(' / ')}</span>
            </>
          )}
        </div>
      )}

      <div className="p-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-outlook-text-secondary">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="text-xs text-red-600 text-center py-8 px-2">{error}</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-outlook-text-secondary text-center py-8">
            {isSearching ? 'Aucun fichier trouvé' : 'Dossier vide'}
          </div>
        ) : (
          items.map(item => {
            const kind = classifyFile(item);
            const Icon = KIND_ICONS[kind];
            return (
              <button
                key={item.path}
                onClick={() => (item.isFolder ? setPath(item.path) : setSelected(item))}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-outlook-bg-hover text-left"
              >
                <Icon size={14} className={item.isFolder ? 'text-outlook-blue flex-shrink-0' : 'text-outlook-text-secondary flex-shrink-0'} />
                <span className="text-xs text-outlook-text-primary truncate flex-1">{item.name}</span>
                {!item.isFolder && item.size != null && (
                  <span className="text-[10px] text-outlook-text-disabled flex-shrink-0">{formatSize(item.size)}</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Aperçu d'un fichier : extrait son contenu puis propose les actions
 * d'insertion. Rendu dans le panneau lui-même (pas de sur-modale) pour rester
 * cohérent avec la logique « un panneau, une colonne ».
 */
function FilePreview({ item, onBack, onInsertHtml, onAttachFiles }: {
  item: NcItem;
  onBack: () => void;
  onInsertHtml: (html: string) => void;
  onAttachFiles?: (files: File[]) => void;
}) {
  const queryClient = useQueryClient();
  const [extracted, setExtracted] = useState<ExtractedFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setLoading(true);
    setError(null);
    extractNextcloudFile(item)
      .then(res => {
        if (cancelled) {
          if (res.objectUrl?.startsWith('blob:')) URL.revokeObjectURL(res.objectUrl);
          return;
        }
        url = res.objectUrl;
        setExtracted(res);
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || 'Lecture impossible'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [item.path]);

  const saveAsNote = useMutation({
    mutationFn: () => api.createNote({
      title: item.name,
      contentHtml: extracted?.html || '',
      sourcePath: item.path,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Enregistré dans vos notes');
    },
    onError: (e: any) => toast.error(e?.message || 'Échec'),
  });

  const attach = async () => {
    if (!onAttachFiles) return;
    setAttaching(true);
    try {
      onAttachFiles([await nextcloudItemToFile(item)]);
      toast.success('Fichier joint au message');
    } catch (e: any) {
      toast.error(e?.message || 'Échec du téléchargement');
    } finally {
      setAttaching(false);
    }
  };

  const hasContent = !!extracted?.html;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-outlook-border">
        <button onClick={onBack} className="p-0.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary" title="Retour">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-medium text-outlook-text-primary truncate flex-1">{item.name}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-outlook-text-secondary">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="text-xs text-red-600 py-4">{error}</div>
        ) : (
          <>
            {extracted?.notice && (
              <div className="text-[11px] text-outlook-text-secondary bg-outlook-bg-tertiary rounded p-2 mb-2">
                {extracted.notice}
              </div>
            )}
            {hasContent && (
              <div
                className="text-[11px] text-outlook-text-primary border border-outlook-border rounded p-2 max-h-64 overflow-auto [&_table]:text-[10px] [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: extracted!.html }}
              />
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-outlook-border p-2 space-y-1">
        <PanelAction
          icon={CornerDownLeft}
          label="Insérer le contenu"
          disabled={!hasContent}
          primary
          onMouseDown={(e) => {
            e.preventDefault();
            if (!extracted?.html) return;
            onInsertHtml(extracted.html);
            toast.success('Contenu inséré dans le message');
          }}
        />
        <PanelAction
          icon={Copy}
          label="Copier le texte"
          disabled={!extracted?.text}
          onMouseDown={(e) => {
            e.preventDefault();
            navigator.clipboard.writeText(extracted?.text || '')
              .then(() => toast.success('Texte copié'))
              .catch(() => toast.error('Copie impossible'));
          }}
        />
        {onAttachFiles && (
          <PanelAction
            icon={attaching ? Loader2 : Paperclip}
            label={attaching ? 'Téléchargement…' : 'Joindre le fichier'}
            disabled={attaching}
            spin={attaching}
            onMouseDown={(e) => { e.preventDefault(); attach(); }}
          />
        )}
        <PanelAction
          icon={StickyNote}
          label="Enregistrer comme note"
          disabled={!hasContent || saveAsNote.isPending}
          spin={saveAsNote.isPending}
          onMouseDown={(e) => { e.preventDefault(); saveAsNote.mutate(); }}
        />
      </div>
    </div>
  );
}

function PanelAction({ icon: Icon, label, onMouseDown, disabled = false, primary = false, spin = false }: {
  icon: typeof Copy;
  label: string;
  onMouseDown: (e: React.MouseEvent) => void;
  disabled?: boolean;
  primary?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      onMouseDown={(e) => { if (!disabled) onMouseDown(e); else e.preventDefault(); }}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        primary
          ? 'bg-outlook-blue text-white hover:bg-outlook-blue-hover'
          : 'text-outlook-text-primary hover:bg-outlook-bg-hover'
      }`}
    >
      <Icon size={12} className={spin ? 'animate-spin' : ''} />
      {label}
    </button>
  );
}
