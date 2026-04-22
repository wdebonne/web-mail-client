import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Pencil, Trash2, MoreHorizontal, Plus, ChevronDown,
  Bold, Italic, Underline, Strikethrough, Link as LinkIcon,
  Image as ImageIcon, Palette, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react';
import {
  MailSignature,
  getSignatures,
  upsertSignature,
  deleteSignature,
  getDefaultNewId,
  setDefaultNewId,
  getDefaultReplyId,
  setDefaultReplyId,
  getAccountDefaultNewId,
  getAccountDefaultReplyId,
  setAccountDefaultNewId,
  setAccountDefaultReplyId,
} from '../../utils/signatures';
import { attachImageEditing } from '../../utils/imageEditing';
import type { MailAccount } from '../../types';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────────────────────────────────────────
// Hook : s'abonne aux changements de la liste des signatures.
// ─────────────────────────────────────────────────────────────────────────────
function useSignatures(): [MailSignature[], () => void] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const handler = () => setVersion(n => n + 1);
    window.addEventListener('mail.signatures.changed', handler);
    return () => window.removeEventListener('mail.signatures.changed', handler);
  }, []);
  const list = useMemo(() => getSignatures(), [version]);
  return [list, () => setVersion(n => n + 1)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Manager modal — "Signatures"
// ─────────────────────────────────────────────────────────────────────────────
export interface SignaturesManagerProps {
  onClose: () => void;
  accountEmail?: string;
  /** Liste des comptes de messagerie pour configurer les signatures par compte. */
  accounts?: MailAccount[];
}

export function SignaturesManagerModal({ onClose, accountEmail, accounts = [] }: SignaturesManagerProps) {
  const [list] = useSignatures();
  const [editing, setEditing] = useState<MailSignature | null>(null);
  const [creating, setCreating] = useState(false);
  const [defaultNew, setDefNew] = useState<string | null>(getDefaultNewId());
  const [defaultReply, setDefReply] = useState<string | null>(getDefaultReplyId());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Version bumped on any signatures change event — re-reads per-account overrides.
  const [, setAcctVersion] = useState(0);

  // Sync defaults on changes (e.g. when a signature used as default is removed).
  useEffect(() => {
    const handler = () => {
      setDefNew(getDefaultNewId());
      setDefReply(getDefaultReplyId());
      setAcctVersion(v => v + 1);
    };
    window.addEventListener('mail.signatures.changed', handler);
    return () => window.removeEventListener('mail.signatures.changed', handler);
  }, []);

  const handleDelete = (sig: MailSignature) => {
    if (!confirm(`Supprimer la signature « ${sig.name} » ?`)) return;
    deleteSignature(sig.id);
    toast.success('Signature supprimée');
  };

  const onChangeDefaultNew = (id: string) => {
    const v = id || null;
    setDefNew(v);
    setDefaultNewId(v);
  };
  const onChangeDefaultReply = (id: string) => {
    const v = id || null;
    setDefReply(v);
    setDefaultReplyId(v);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/30" onClick={onClose} />
      <div
        className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          bg-white rounded-lg shadow-xl w-[720px] max-w-[94vw] max-h-[85vh] flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-outlook-border">
          <h2 className="text-lg font-semibold text-outlook-text-primary">Signatures</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-4 mb-4">
            <p className="text-xs text-outlook-text-secondary max-w-md">
              Vous pouvez ajouter et modifier des signatures qui peuvent être ajoutées à
              vos e-mails. Vous pouvez également choisir la signature à ajouter par défaut
              à vos nouveaux courriers et réponses.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover whitespace-nowrap"
            >
              <Plus size={14} /> Ajouter une signature
            </button>
          </div>

          {/* Defaults */}
          <div className="border-t border-outlook-border pt-4 space-y-3 mb-4">
            <div className="flex items-center gap-3">
              <label className="text-sm text-outlook-text-primary flex-1">
                Valeur par défaut pour les nouveaux messages
              </label>
              <div className="relative w-64">
                <select
                  value={defaultNew ?? ''}
                  onChange={(e) => onChangeDefaultNew(e.target.value)}
                  className="w-full appearance-none text-sm border border-outlook-border rounded px-3 py-1.5 pr-8 bg-white focus:outline-none focus:border-outlook-blue"
                >
                  <option value="">(Aucune signature)</option>
                  {list.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-outlook-text-secondary" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-outlook-text-primary flex-1">
                Valeur par défaut pour les réponses et le transfert
              </label>
              <div className="relative w-64">
                <select
                  value={defaultReply ?? ''}
                  onChange={(e) => onChangeDefaultReply(e.target.value)}
                  className="w-full appearance-none text-sm border border-outlook-border rounded px-3 py-1.5 pr-8 bg-white focus:outline-none focus:border-outlook-blue"
                >
                  <option value="">(Aucune signature)</option>
                  {list.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-outlook-text-secondary" />
              </div>
            </div>
          </div>

          {/* Per-account defaults */}
          {accounts.length > 0 && (
            <div className="border-t border-outlook-border pt-4 space-y-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-outlook-text-primary">
                  Signature par compte de messagerie
                </h3>
                <p className="text-xs text-outlook-text-secondary mt-0.5">
                  Définissez une signature spécifique par boîte mail. Sinon, la valeur
                  par défaut globale ci-dessus est utilisée.
                </p>
              </div>

              <div className="space-y-3">
                {accounts.map((acc) => {
                  const overrideNew = getAccountDefaultNewId(acc.id);
                  const overrideReply = getAccountDefaultReplyId(acc.id);
                  const valNew =
                    overrideNew === undefined ? '' :
                    overrideNew === null ? '__none__' : overrideNew;
                  const valReply =
                    overrideReply === undefined ? '' :
                    overrideReply === null ? '__none__' : overrideReply;
                  const decode = (v: string): string | null | undefined => {
                    if (v === '') return undefined;
                    if (v === '__none__') return null;
                    return v;
                  };
                  return (
                    <div key={acc.id} className="border border-outlook-border rounded px-3 py-2">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: acc.color || '#888' }}
                        />
                        <span className="text-sm font-medium text-outlook-text-primary truncate">
                          {acc.name || acc.email}
                        </span>
                        {acc.name && acc.email && acc.name !== acc.email && (
                          <span className="text-xs text-outlook-text-secondary truncate">
                            &lt;{acc.email}&gt;
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="text-xs text-outlook-text-secondary flex flex-col gap-1">
                          Nouveaux messages
                          <div className="relative">
                            <select
                              value={valNew}
                              onChange={(e) => {
                                setAccountDefaultNewId(acc.id, decode(e.target.value));
                                setAcctVersion(v => v + 1);
                              }}
                              className="w-full appearance-none text-sm border border-outlook-border rounded px-2 py-1 pr-7 bg-white focus:outline-none focus:border-outlook-blue text-outlook-text-primary"
                            >
                              <option value="">(Valeur par défaut globale)</option>
                              <option value="__none__">(Aucune signature)</option>
                              {list.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-outlook-text-secondary" />
                          </div>
                        </label>
                        <label className="text-xs text-outlook-text-secondary flex flex-col gap-1">
                          Réponses et transferts
                          <div className="relative">
                            <select
                              value={valReply}
                              onChange={(e) => {
                                setAccountDefaultReplyId(acc.id, decode(e.target.value));
                                setAcctVersion(v => v + 1);
                              }}
                              className="w-full appearance-none text-sm border border-outlook-border rounded px-2 py-1 pr-7 bg-white focus:outline-none focus:border-outlook-blue text-outlook-text-primary"
                            >
                              <option value="">(Valeur par défaut globale)</option>
                              <option value="__none__">(Aucune signature)</option>
                              {list.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-outlook-text-secondary" />
                          </div>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* List */}
          <div className="border-t border-outlook-border">
            {list.length === 0 ? (
              <div className="py-8 text-center text-sm text-outlook-text-secondary">
                Aucune signature. Cliquez sur « Ajouter une signature » pour en créer une.
              </div>
            ) : (
              <ul className="divide-y divide-outlook-border">
                {list.map(sig => (
                  <li key={sig.id} className="flex items-center gap-2 py-3">
                    <span className="flex-1 text-sm text-outlook-text-primary truncate">
                      {sig.name}
                    </span>
                    <button
                      onClick={() => setEditing(sig)}
                      className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
                      title="Modifier"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(sig)}
                      className="p-1.5 rounded hover:bg-red-50 hover:text-outlook-danger text-outlook-text-secondary"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setMenuFor(menuFor === sig.id ? null : sig.id)}
                        className="p-1.5 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
                        title="Plus"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {menuFor === sig.id && (
                        <>
                          <div className="fixed inset-0 z-[9998]" onClick={() => setMenuFor(null)} />
                          <div className="absolute right-0 top-full mt-1 z-[9999] bg-white border border-outlook-border rounded shadow-lg py-1 w-64 text-sm">
                            <button
                              onClick={() => { onChangeDefaultNew(sig.id); setMenuFor(null); }}
                              className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover"
                            >
                              Définir par défaut pour les nouveaux messages
                            </button>
                            <button
                              onClick={() => { onChangeDefaultReply(sig.id); setMenuFor(null); }}
                              className="w-full text-left px-3 py-1.5 hover:bg-outlook-bg-hover"
                            >
                              Définir par défaut pour les réponses et transferts
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Editor modal (create / edit) */}
      {creating && (
        <SignatureEditorModal
          onClose={() => setCreating(false)}
          accountEmail={accountEmail}
        />
      )}
      {editing && (
        <SignatureEditorModal
          signature={editing}
          onClose={() => setEditing(null)}
          accountEmail={accountEmail}
        />
      )}
    </>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor modal — "Modifier la signature"
// ─────────────────────────────────────────────────────────────────────────────
export interface SignatureEditorProps {
  onClose: () => void;
  signature?: MailSignature;
  accountEmail?: string;
}

const SIG_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#ffffff',
  '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff',
  '#0000ff', '#9900ff', '#ff00ff',
];

export function SignatureEditorModal({ onClose, signature, accountEmail }: SignatureEditorProps) {
  const isEdit = !!signature;
  const [name, setName] = useState(signature?.name || '');
  const editorRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [setDefaultNew, setSetDefaultNew] = useState(
    isEdit ? getDefaultNewId() === signature!.id : false,
  );
  const [setDefaultReply, setSetDefaultReply] = useState(
    isEdit ? getDefaultReplyId() === signature!.id : false,
  );
  const [showColors, setShowColors] = useState(false);
  const [tab, setTab] = useState<'format' | 'insert'>('format');

  useEffect(() => {
    if (!isEdit) setTimeout(() => nameRef.current?.focus(), 50);
  }, [isEdit]);

  // Enable click-to-select + resize/align toolbar on images inside the editor.
  useEffect(() => {
    if (!editorRef.current) return;
    return attachImageEditing(editorRef.current);
  }, []);

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
  };

  const insertLink = () => {
    const url = prompt('Adresse du lien (https://…) :');
    if (!url) return;
    const href = url.startsWith('http') || url.startsWith('mailto:') ? url : `https://${url}`;
    exec('createLink', href);
  };

  const insertImage = () => {
    imageInputRef.current?.click();
  };

  // Hidden file input — reads the picked image as a data URI and inserts it inline.
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error("Ce fichier n'est pas une image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image trop volumineuse (max 2 Mo pour une signature)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      editorRef.current?.focus();
      exec('insertImage', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Veuillez saisir un nom de signature.');
      nameRef.current?.focus();
      return;
    }
    const html = editorRef.current?.innerHTML || '';
    const saved = upsertSignature({ id: signature?.id, name: trimmed, html });
    if (setDefaultNew) setDefaultNewId(saved.id);
    else if (isEdit && getDefaultNewId() === saved.id) setDefaultNewId(null);
    if (setDefaultReply) setDefaultReplyId(saved.id);
    else if (isEdit && getDefaultReplyId() === saved.id) setDefaultReplyId(null);
    toast.success(isEdit ? 'Signature enregistrée' : 'Signature créée');
    onClose();
  };

  const canSave = name.trim().length > 0;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/30" onClick={onClose} />
      <div
        className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          bg-white rounded-lg shadow-xl w-[760px] max-w-[94vw] max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <h2 className="text-base font-semibold text-outlook-text-primary">
            {isEdit ? 'Modifier la signature' : 'Nouvelle signature'}
          </h2>
          <div className="flex items-center gap-3">
            {accountEmail && (
              <span className="text-xs text-outlook-text-secondary">{accountEmail}</span>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
              aria-label="Fermer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-5 pt-2 text-sm border-b border-outlook-border">
          <button
            onClick={() => setTab('format')}
            className={`px-3 py-1.5 border-b-2 transition-colors ${
              tab === 'format'
                ? 'border-outlook-blue text-outlook-text-primary font-medium'
                : 'border-transparent text-outlook-text-secondary hover:text-outlook-text-primary'
            }`}
          >
            Mettre le texte en forme
          </button>
          <button
            onClick={() => setTab('insert')}
            className={`px-3 py-1.5 border-b-2 transition-colors ${
              tab === 'insert'
                ? 'border-outlook-blue text-outlook-text-primary font-medium'
                : 'border-transparent text-outlook-text-secondary hover:text-outlook-text-primary'
            }`}
          >
            Insérer
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-outlook-border bg-outlook-bg-primary text-outlook-text-secondary text-sm flex-wrap">
          {tab === 'format' ? (
            <>
              <ToolBtn icon={Bold} title="Gras" onClick={() => exec('bold')} />
              <ToolBtn icon={Italic} title="Italique" onClick={() => exec('italic')} />
              <ToolBtn icon={Underline} title="Souligné" onClick={() => exec('underline')} />
              <ToolBtn icon={Strikethrough} title="Barré" onClick={() => exec('strikeThrough')} />
              <Sep />
              <div className="relative">
                <ToolBtn icon={Palette} title="Couleur du texte" onClick={() => setShowColors(v => !v)} />
                {showColors && (
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => setShowColors(false)} />
                    <div className="absolute top-full left-0 mt-1 z-[9999] bg-white border border-outlook-border rounded shadow-lg p-2 grid grid-cols-7 gap-1">
                      {SIG_COLORS.map(c => (
                        <button
                          key={c}
                          onMouseDown={(e) => { e.preventDefault(); exec('foreColor', c); setShowColors(false); }}
                          className="w-5 h-5 rounded-sm border border-outlook-border hover:border-outlook-blue"
                          style={{ background: c }}
                          title={c}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              <Sep />
              <ToolBtn icon={List} title="Liste à puces" onClick={() => exec('insertUnorderedList')} />
              <ToolBtn icon={ListOrdered} title="Liste numérotée" onClick={() => exec('insertOrderedList')} />
              <Sep />
              <ToolBtn icon={AlignLeft} title="Aligner à gauche" onClick={() => exec('justifyLeft')} />
              <ToolBtn icon={AlignCenter} title="Centrer" onClick={() => exec('justifyCenter')} />
              <ToolBtn icon={AlignRight} title="Aligner à droite" onClick={() => exec('justifyRight')} />
            </>
          ) : (
            <>
              <ToolBtn icon={LinkIcon} title="Lien" onClick={insertLink} />
              <ToolBtn icon={ImageIcon} title="Image" onClick={insertImage} />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageFile(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>

        {/* Name field */}
        <div className="px-5 pt-3">
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom de la signature"
            className="w-full border-b border-outlook-border focus:border-outlook-blue outline-none px-1 py-1.5 text-sm"
            maxLength={120}
          />
        </div>

        {/* Editor */}
        <div className="px-5 py-3 flex-1 overflow-hidden flex flex-col">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="flex-1 min-h-[180px] max-h-[42vh] overflow-y-auto border border-outlook-border rounded p-3 text-sm outline-none focus:border-outlook-blue"
            dangerouslySetInnerHTML={{ __html: signature?.html || '' }}
          />
        </div>

        {/* Defaults toggles */}
        <div className="px-5 pb-3 space-y-1.5 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setDefaultNew}
              onChange={(e) => setSetDefaultNew(e.target.checked)}
            />
            Définir les valeurs par défaut des nouveaux messages
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={setDefaultReply}
              onChange={(e) => setSetDefaultReply(e.target.checked)}
            />
            Définir la valeur par défaut des réponses et des transferts
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-outlook-border">
          <button
            onClick={save}
            disabled={!canSave}
            className={`px-4 py-1.5 text-sm rounded text-white transition-colors ${
              canSave ? 'bg-outlook-blue hover:bg-outlook-blue-hover' : 'bg-outlook-blue/40 cursor-not-allowed'
            }`}
          >
            Enregistrer
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded border border-outlook-border hover:bg-outlook-bg-hover"
          >
            Annuler
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function ToolBtn({ icon: Icon, title, onClick }: { icon: any; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className="p-1.5 rounded hover:bg-outlook-bg-hover"
    >
      <Icon size={14} />
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-outlook-border mx-1" />;
}
