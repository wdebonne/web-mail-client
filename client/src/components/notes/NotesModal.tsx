import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import toast from 'react-hot-toast';
import {
  X, Search, Plus, StickyNote, Cloud, Loader2, Pin, Check, Trash2,
  Folder, ChevronLeft, Home, FileText, FileSpreadsheet, FileImage, File as FileIcon,
  Copy, Download, Mail, CornerDownLeft, Paperclip, Bold, Italic, Underline, List, ListOrdered,
  Link as LinkIcon, Palette, AlertCircle,
} from 'lucide-react';
import { api, type Note, type NoteColor } from '../../api';
import { useMailStore } from '../../stores/mailStore';
import {
  type NcItem, type ExtractedFile,
  classifyFile, extractNextcloudFile, nextcloudItemToFile,
  formatSize, noteExcerpt, relativeDate, htmlToPlainText,
  NOTE_COLORS, NOTE_COLOR_HEX, NOTE_COLOR_LABELS,
} from './notesShared';

/**
 * Grande modale « Notes & fichiers » — la version plein écran du panneau
 * latéral, ouverte depuis la barre du haut (à gauche de l'indicateur de cache)
 * ou depuis le bouton « Ouvrir en grand » du panneau.
 *
 * Colonne de gauche : la source (mes notes / mon Nextcloud) + la recherche.
 * Colonne de droite  : l'éditeur de note ou l'aperçu du fichier sélectionné.
 *
 * Hors composition (ouverte depuis la barre du haut), les actions d'insertion
 * sont remplacées par « Nouveau message avec ce contenu », qui pré-remplit une
 * fenêtre de composition via le store mail.
 */

export interface NotesModalProps {
  open: boolean;
  onClose: () => void;
  /** Fourni uniquement quand une composition est ouverte : insère au curseur. */
  onInsertHtml?: (html: string) => void;
  onAttachFiles?: (files: File[]) => void;
}

type Source = 'notes' | 'files';
type Selection =
  | { kind: 'note'; note: Note }
  | { kind: 'new' }
  | { kind: 'file'; item: NcItem }
  | null;

export default function NotesModal({ open, onClose, onInsertHtml, onAttachFiles }: NotesModalProps) {
  const [source, setSource] = useState<Source>('notes');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selection, setSelection] = useState<Selection>(null);
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

  useEffect(() => {
    if (!ncLinked && source === 'files') setSource('notes');
  }, [ncLinked, source]);

  // Échap ferme la modale, sauf si le focus est dans un champ de saisie où la
  // touche a déjà un sens local (annuler une recherche par exemple).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15 }}
        className="bg-outlook-bg-secondary rounded-lg shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden border border-outlook-border"
        role="dialog"
        aria-label="Notes et fichiers"
      >
        {/* Barre de titre */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-outlook-border flex-shrink-0">
          <StickyNote size={16} className="text-outlook-blue" />
          <h2 className="text-sm font-semibold text-outlook-text-primary">Notes &amp; fichiers</h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Colonne gauche */}
          <div className="w-80 flex-shrink-0 border-r border-outlook-border flex flex-col min-h-0">
            <div className="p-2 border-b border-outlook-border space-y-2">
              {ncLinked && (
                <div className="flex items-center gap-1">
                  <SourceButton
                    icon={StickyNote}
                    label="Mes notes"
                    active={source === 'notes'}
                    onClick={() => { setSource('notes'); setSelection(null); }}
                  />
                  <SourceButton
                    icon={Cloud}
                    label="Nextcloud"
                    active={source === 'files'}
                    onClick={() => { setSource('files'); setSelection(null); }}
                  />
                </div>
              )}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outlook-text-disabled pointer-events-none" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={source === 'notes' ? 'Rechercher dans mes notes…' : 'Rechercher dans mes fichiers…'}
                  className="w-full text-sm pl-8 pr-2 py-1.5 bg-outlook-bg-tertiary rounded border border-transparent focus:bg-outlook-bg-primary focus:border-outlook-blue outline-none text-outlook-text-primary"
                />
              </div>
              {source === 'notes' && (
                <button
                  onClick={() => setSelection({ kind: 'new' })}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover"
                >
                  <Plus size={14} />
                  Nouvelle note
                </button>
              )}
            </div>

            {source === 'notes' ? (
              <NotesList
                query={debouncedQuery}
                selectedId={selection?.kind === 'note' ? selection.note.id : null}
                onSelect={(note) => setSelection({ kind: 'note', note })}
              />
            ) : (
              <FilesList
                query={debouncedQuery}
                selectedPath={selection?.kind === 'file' ? selection.item.path : null}
                onSelect={(item) => setSelection({ kind: 'file', item })}
              />
            )}
          </div>

          {/* Colonne droite */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selection === null ? (
              <EmptyState source={source} />
            ) : selection.kind === 'file' ? (
              <FileDetail
                key={selection.item.path}
                item={selection.item}
                onInsertHtml={onInsertHtml}
                onAttachFiles={onAttachFiles}
                onClose={onClose}
              />
            ) : (
              <NoteEditor
                key={selection.kind === 'note' ? selection.note.id : 'new'}
                note={selection.kind === 'note' ? selection.note : null}
                onInsertHtml={onInsertHtml}
                onCreated={(note) => setSelection({ kind: 'note', note })}
                onDeleted={() => setSelection(null)}
                onClose={onClose}
              />
            )}
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function SourceButton({ icon: Icon, label, active, onClick }: {
  icon: typeof StickyNote; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
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

function EmptyState({ source }: { source: Source }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-outlook-text-secondary p-8 text-center">
      {source === 'notes' ? <StickyNote size={40} className="opacity-30 mb-3" /> : <Cloud size={40} className="opacity-30 mb-3" />}
      <p className="text-sm">
        {source === 'notes'
          ? 'Sélectionnez une note, ou créez-en une nouvelle.'
          : 'Parcourez ou recherchez un fichier pour en lire le contenu.'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Liste des notes
// ─────────────────────────────────────────────────────────────────────────

function NotesList({ query, selectedId, onSelect }: {
  query: string;
  selectedId: string | null;
  onSelect: (note: Note) => void;
}) {
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', query],
    queryFn: () => api.listNotes(query),
    staleTime: 30_000,
  });

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-outlook-text-secondary">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-outlook-text-secondary text-center py-10">
          {query ? 'Aucune note trouvée' : 'Aucune note pour le moment'}
        </p>
      ) : (
        notes.map(note => (
          <button
            key={note.id}
            onClick={() => onSelect(note)}
            className={`w-full text-left rounded px-2.5 py-2 transition-colors border ${
              selectedId === note.id
                ? 'bg-outlook-blue/10 border-outlook-blue'
                : 'border-transparent hover:bg-outlook-bg-hover'
            }`}
            style={{ borderLeft: `3px solid ${NOTE_COLOR_HEX[note.color] || NOTE_COLOR_HEX.default}` }}
          >
            <div className="flex items-center gap-1.5">
              {note.isPinned && <Pin size={11} className="text-outlook-blue flex-shrink-0" />}
              <span className="text-sm font-medium text-outlook-text-primary truncate flex-1">{note.title}</span>
            </div>
            {note.contentText && (
              <p className="text-xs text-outlook-text-secondary line-clamp-2 mt-0.5">
                {noteExcerpt(note.contentText, 120)}
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] text-outlook-text-disabled">{relativeDate(note.updatedAt)}</span>
              {note.sourcePath && (
                <span className="text-[10px] text-outlook-text-disabled flex items-center gap-0.5 truncate">
                  <Cloud size={9} /> {note.sourcePath.split('/').filter(Boolean).pop()}
                </span>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Éditeur de note
// ─────────────────────────────────────────────────────────────────────────

function NoteEditor({ note, onInsertHtml, onCreated, onDeleted, onClose }: {
  note: Note | null;
  onInsertHtml?: (html: string) => void;
  onCreated: (note: Note) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editorRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState(note?.title ?? '');
  const [color, setColor] = useState<NoteColor>(note?.color ?? 'default');
  const [isPinned, setIsPinned] = useState(note?.isPinned ?? false);
  const [dirty, setDirty] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Le contenu n'est écrit dans le DOM qu'au montage (la clé du composant est
  // l'id de la note) : réécrire innerHTML à chaque frappe détruirait le curseur.
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = note?.contentHtml ?? '';
  }, [note?.id]);

  const currentHtml = () => editorRef.current?.innerHTML ?? '';

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { title, contentHtml: currentHtml(), color, isPinned };
      return note ? api.updateNote(note.id, payload) : api.createNote(payload);
    },
    onSuccess: (saved) => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (!note) {
        toast.success('Note créée');
        onCreated(saved);
      } else {
        toast.success('Note enregistrée');
      }
    },
    onError: (e: any) => toast.error(e?.message || "Échec de l'enregistrement"),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.deleteNote(note!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Note supprimée');
      onDeleted();
    },
    onError: (e: any) => toast.error(e?.message || 'Échec de la suppression'),
  });

  // Ctrl+S enregistre sans quitter le champ.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveMut.mutate();
    }
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setDirty(true);
  };

  const insertLink = () => {
    const url = window.prompt('Adresse du lien :');
    if (!url) return;
    exec('createLink', url);
  };

  const composeWithNote = () => {
    const html = currentHtml();
    if (!html.trim()) {
      toast.error('Note vide');
      return;
    }
    useMailStore.getState().openCompose({ subject: title, bodyHtml: html });
    onClose();
    navigate('/mail');
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* En-tête : titre + actions */}
      <div className="px-4 pt-3 pb-2 border-b border-outlook-border">
        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            onKeyDown={onKeyDown}
            placeholder="Titre de la note"
            className="flex-1 text-base font-semibold bg-transparent outline-none text-outlook-text-primary placeholder:text-outlook-text-disabled"
          />
          <button
            onClick={() => { setIsPinned(v => !v); setDirty(true); }}
            className={`p-1.5 rounded hover:bg-outlook-bg-hover ${isPinned ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`}
            title={isPinned ? 'Désépingler' : 'Épingler en haut de la liste'}
          >
            <Pin size={15} />
          </button>
          <div className="relative">
            <button
              onClick={() => setShowColors(v => !v)}
              className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
              title="Couleur"
            >
              <Palette size={15} style={{ color: color === 'default' ? undefined : NOTE_COLOR_HEX[color] }} />
            </button>
            {showColors && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-outlook-bg-secondary border border-outlook-border rounded shadow-lg p-1.5 flex gap-1">
                {NOTE_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => { setColor(c); setDirty(true); setShowColors(false); }}
                    title={NOTE_COLOR_LABELS[c]}
                    className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-outlook-text-primary' : 'border-transparent'}`}
                    style={{ background: NOTE_COLOR_HEX[c] }}
                  />
                ))}
              </div>
            )}
          </div>
          {note && (
            <button
              onClick={() => (confirmDelete ? deleteMut.mutate() : setConfirmDelete(true))}
              onBlur={() => setConfirmDelete(false)}
              className={`p-1.5 rounded hover:bg-outlook-bg-hover ${confirmDelete ? 'text-red-600 bg-red-500/10' : 'text-outlook-text-secondary'}`}
              title={confirmDelete ? 'Cliquez à nouveau pour confirmer' : 'Supprimer'}
            >
              {deleteMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            </button>
          )}
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50"
          >
            {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {note ? 'Enregistrer' : 'Créer'}
          </button>
        </div>

        {/* Mini barre de format */}
        <div className="flex items-center gap-0.5 mt-2">
          <FormatButton icon={Bold} label="Gras" onClick={() => exec('bold')} />
          <FormatButton icon={Italic} label="Italique" onClick={() => exec('italic')} />
          <FormatButton icon={Underline} label="Souligné" onClick={() => exec('underline')} />
          <span className="w-px h-4 bg-outlook-border mx-1" />
          <FormatButton icon={List} label="Liste à puces" onClick={() => exec('insertUnorderedList')} />
          <FormatButton icon={ListOrdered} label="Liste numérotée" onClick={() => exec('insertOrderedList')} />
          <FormatButton icon={LinkIcon} label="Lien" onClick={insertLink} />
          <div className="flex-1" />
          {dirty && (
            <span className="text-[11px] text-amber-600 flex items-center gap-1">
              <AlertCircle size={11} /> Modifications non enregistrées
            </span>
          )}
        </div>
      </div>

      {/* Zone d'édition */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => setDirty(true)}
        onKeyDown={onKeyDown}
        className="note-editor flex-1 overflow-y-auto px-4 py-3 outline-none text-sm text-outlook-text-primary [&_img]:max-w-full [&_table]:border-collapse"
        data-placeholder="Écrivez votre note…"
      />

      {/* Pied : réutilisation du contenu */}
      <div className="border-t border-outlook-border px-4 py-2 flex items-center gap-2 flex-wrap">
        {onInsertHtml ? (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              onInsertHtml(currentHtml());
              toast.success('Note insérée dans le message');
              onClose();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover"
          >
            <CornerDownLeft size={12} />
            Insérer dans le message
          </button>
        ) : (
          <button
            onClick={composeWithNote}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover"
          >
            <Mail size={12} />
            Nouveau message avec cette note
          </button>
        )}
        <button
          onClick={() => {
            navigator.clipboard.writeText(htmlToPlainText(currentHtml()))
              .then(() => toast.success('Note copiée'))
              .catch(() => toast.error('Copie impossible'));
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded text-outlook-text-primary hover:bg-outlook-bg-hover border border-outlook-border"
        >
          <Copy size={12} />
          Copier le texte
        </button>
        {note?.sourcePath && (
          <span className="text-[11px] text-outlook-text-disabled flex items-center gap-1 ml-auto">
            <Cloud size={11} /> Créée depuis {note.sourcePath}
          </span>
        )}
      </div>
    </div>
  );
}

function FormatButton({ icon: Icon, label, onClick }: { icon: typeof Bold; label: string; onClick: () => void }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={label}
      aria-label={label}
      className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
    >
      <Icon size={13} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Liste et aperçu des fichiers Nextcloud
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

function FilesList({ query, selectedPath, onSelect }: {
  query: string;
  selectedPath: string | null;
  onSelect: (item: NcItem) => void;
}) {
  const [path, setPath] = useState('/');
  const [items, setItems] = useState<NcItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {!isSearching && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-outlook-border text-xs text-outlook-text-secondary flex-shrink-0">
          <button onClick={() => setPath('/')} className="p-0.5 rounded hover:bg-outlook-bg-hover" title="Racine">
            <Home size={13} />
          </button>
          {segments.length > 0 && (
            <>
              <button
                onClick={() => setPath('/' + segments.slice(0, -1).join('/'))}
                className="p-0.5 rounded hover:bg-outlook-bg-hover"
                title="Dossier parent"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="truncate">{segments.join(' / ')}</span>
            </>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-outlook-text-secondary">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="text-xs text-red-600 text-center py-10 px-2">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-outlook-text-secondary text-center py-10">
            {isSearching ? 'Aucun fichier trouvé' : 'Dossier vide'}
          </p>
        ) : (
          items.map(item => {
            const Icon = KIND_ICONS[classifyFile(item)];
            const active = selectedPath === item.path;
            return (
              <button
                key={item.path}
                onClick={() => (item.isFolder ? setPath(item.path) : onSelect(item))}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left ${
                  active ? 'bg-outlook-blue/10' : 'hover:bg-outlook-bg-hover'
                }`}
              >
                <Icon size={15} className={`flex-shrink-0 ${item.isFolder ? 'text-outlook-blue' : 'text-outlook-text-secondary'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-outlook-text-primary truncate">{item.name}</div>
                  {isSearching && (
                    <div className="text-[10px] text-outlook-text-disabled truncate">{item.path}</div>
                  )}
                </div>
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

function FileDetail({ item, onInsertHtml, onAttachFiles, onClose }: {
  item: NcItem;
  onInsertHtml?: (html: string) => void;
  onAttachFiles?: (files: File[]) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [extracted, setExtracted] = useState<ExtractedFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setLoading(true);
    setError(null);
    setExtracted(null);
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

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const file = await nextcloudItemToFile(item);
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch (e: any) {
      toast.error(e?.message || 'Échec du téléchargement');
    } finally {
      setBusy(false);
    }
  }, [item]);

  const attach = async () => {
    if (!onAttachFiles) return;
    setBusy(true);
    try {
      onAttachFiles([await nextcloudItemToFile(item)]);
      toast.success('Fichier joint au message');
    } catch (e: any) {
      toast.error(e?.message || 'Échec du téléchargement');
    } finally {
      setBusy(false);
    }
  };

  const composeWithFile = () => {
    if (!extracted?.html) return;
    useMailStore.getState().openCompose({ subject: item.name, bodyHtml: extracted.html });
    onClose();
    navigate('/mail');
  };

  const hasContent = !!extracted?.html;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b border-outlook-border flex items-center gap-2">
        <span className="text-sm font-medium text-outlook-text-primary truncate">{item.name}</span>
        <span className="text-[11px] text-outlook-text-disabled truncate">{item.path}</span>
        <div className="flex-1" />
        {item.size != null && (
          <span className="text-[11px] text-outlook-text-disabled flex-shrink-0">{formatSize(item.size)}</span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-outlook-text-secondary">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <>
            {extracted?.notice && (
              <div className="text-xs text-outlook-text-secondary bg-outlook-bg-tertiary rounded p-2.5 mb-3">
                {extracted.notice}
              </div>
            )}
            {hasContent && (
              <div
                className="text-sm text-outlook-text-primary bg-outlook-bg-primary border border-outlook-border rounded p-3 [&_img]:max-w-full [&_table]:text-xs"
                dangerouslySetInnerHTML={{ __html: extracted!.html }}
              />
            )}
            {/* PDF : aperçu natif du navigateur, le texte y reste sélectionnable. */}
            {!hasContent && extracted?.objectUrl && extracted.kind === 'pdf' && (
              <iframe
                src={extracted.objectUrl}
                title={item.name}
                className="w-full h-[55vh] border border-outlook-border rounded bg-white"
              />
            )}
          </>
        )}
      </div>

      <div className="border-t border-outlook-border px-4 py-2 flex items-center gap-2 flex-wrap">
        {onInsertHtml ? (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              if (!extracted?.html) return;
              onInsertHtml(extracted.html);
              toast.success('Contenu inséré dans le message');
              onClose();
            }}
            disabled={!hasContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-40"
          >
            <CornerDownLeft size={12} />
            Insérer dans le message
          </button>
        ) : (
          <button
            onClick={composeWithFile}
            disabled={!hasContent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-40"
          >
            <Mail size={12} />
            Nouveau message avec ce contenu
          </button>
        )}
        <FooterButton
          icon={Copy}
          label="Copier le texte"
          disabled={!extracted?.text}
          onClick={() => {
            navigator.clipboard.writeText(extracted?.text || '')
              .then(() => toast.success('Texte copié'))
              .catch(() => toast.error('Copie impossible'));
          }}
        />
        <FooterButton
          icon={StickyNote}
          label="Enregistrer comme note"
          disabled={!hasContent || saveAsNote.isPending}
          onClick={() => saveAsNote.mutate()}
        />
        {onAttachFiles && (
          <FooterButton icon={Paperclip} label="Joindre au message" disabled={busy} onClick={attach} />
        )}
        <FooterButton icon={Download} label="Télécharger" disabled={busy} onClick={download} />
      </div>
    </div>
  );
}

function FooterButton({ icon: Icon, label, onClick, disabled = false }: {
  icon: typeof Copy; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded text-outlook-text-primary hover:bg-outlook-bg-hover border border-outlook-border disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon size={12} />
      {label}
    </button>
  );
}
