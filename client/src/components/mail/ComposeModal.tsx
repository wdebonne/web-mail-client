import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X, Send, Paperclip, Minus, Maximize2, ChevronDown,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Link as LinkIcon, Image, Palette, Type, Indent, Outdent,
  Users, Check,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ComposeData } from '../../stores/mailStore';
import { MailAccount, EmailAddress, Contact } from '../../types';
import { api } from '../../api';
import { offlineDB } from '../../pwa/offlineDB';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useQuery } from '@tanstack/react-query';

interface ComposeModalProps {
  initialData: ComposeData;
  accounts: MailAccount[];
  selectedAccountId?: string;
  onSend: (data: any) => void;
  onClose: () => void;
  isSending: boolean;
  inline?: boolean;
  /** External ref for the rich text editor (so the ribbon can drive formatting). */
  externalEditorRef?: React.RefObject<HTMLDivElement>;
  /** Hide the inline rich-text toolbar (used when the ribbon provides the Message tab instead). */
  hideInlineToolbar?: boolean;
  /** Shared API ref so the ribbon Insérer tab can call back into compose (attach files, etc.). */
  apiRef?: React.MutableRefObject<ComposeApi | null>;
}

export interface ComposeApi {
  addFiles: (files: FileList | File[]) => void;
}

export default function ComposeModal({
  initialData, accounts, selectedAccountId, onSend, onClose, isSending, inline = false,
  externalEditorRef, hideInlineToolbar = false, apiRef,
}: ComposeModalProps) {
  const isOnline = useNetworkStatus();
  const [accountId, setAccountId] = useState(initialData.accountId || selectedAccountId || accounts[0]?.id);
  const [to, setTo] = useState<EmailAddress[]>(initialData.to || []);
  const [cc, setCc] = useState<EmailAddress[]>(initialData.cc || []);
  const [bcc, setBcc] = useState<EmailAddress[]>(initialData.bcc || []);
  const [subject, setSubject] = useState(initialData.subject || '');
  const [bodyHtml, setBodyHtml] = useState(initialData.bodyHtml || '');
  const [showCc, setShowCc] = useState(initialData.cc?.length > 0);
  const [showBcc, setShowBcc] = useState(initialData.bcc?.length > 0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  // Contact autocomplete
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [activeField, setActiveField] = useState<'to' | 'cc' | 'bcc' | null>(null);

  // Contacts picker modal
  const [showContactPicker, setShowContactPicker] = useState<'to' | 'cc' | 'bcc' | null>(null);

  const internalEditorRef = useRef<HTMLDivElement>(null);
  const editorRef = externalEditorRef ?? internalEditorRef;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Autocomplete search
  const searchContacts = useCallback(async (query: string) => {
    if (query.length < 1) {
      setSuggestions([]);
      return;
    }
    try {
      if (isOnline) {
        const result = await api.searchContacts(query);
        setSuggestions([...result.contacts, ...result.distributionLists.map((dl: any) => ({
          ...dl,
          isDistributionList: true,
        }))]);
      } else {
        const cached = await offlineDB.searchContacts(query);
        setSuggestions(cached);
      }
    } catch {
      setSuggestions([]);
    }
  }, [isOnline]);

  const addRecipient = (field: 'to' | 'cc' | 'bcc', address: EmailAddress) => {
    const setter = field === 'to' ? setTo : field === 'cc' ? setCc : setBcc;
    const inputSetter = field === 'to' ? setToInput : field === 'cc' ? setCcInput : setBccInput;
    setter(prev => {
      if (prev.some(r => r.address === address.address)) return prev;
      return [...prev, address];
    });
    inputSetter('');
    setSuggestions([]);
  };

  const removeRecipient = (field: 'to' | 'cc' | 'bcc', index: number) => {
    const setter = field === 'to' ? setTo : field === 'cc' ? setCc : setBcc;
    setter(prev => prev.filter((_, i) => i !== index));
  };

  const handleInputKeyDown = (e: React.KeyboardEvent, field: 'to' | 'cc' | 'bcc', value: string) => {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      e.preventDefault();
      const trimmed = value.trim().replace(/,$/, '');
      if (trimmed && trimmed.includes('@')) {
        addRecipient(field, { address: trimmed });
      }
    }
    if (e.key === 'Escape') {
      setSuggestions([]);
      setActiveField(null);
    }
  };

  const handleAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    addFiles(files);
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setAttachments(prev => [...prev, {
          filename: file.name,
          contentType: file.type,
          size: file.size,
          content: base64,
        }]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // Expose API to the ribbon (Insérer > Joindre un fichier)
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { addFiles };
    return () => { if (apiRef) apiRef.current = null; };
  }, [apiRef, addFiles]);

  const handleSend = () => {
    // Auto-add pending recipients from input fields
    let finalTo = [...to];
    let finalCc = [...cc];
    let finalBcc = [...bcc];

    // Helper to add email if valid
    const addEmailIfValid = (email: string, field: EmailAddress[]) => {
      const trimmed = email.trim().replace(/,$/, '');
      if (trimmed && trimmed.includes('@')) {
        if (!field.some(r => r.address === trimmed)) {
          field.push({ address: trimmed });
        }
      }
    };

    // Process any pending input before sending
    if (toInput.trim()) addEmailIfValid(toInput, finalTo);
    if (ccInput.trim()) addEmailIfValid(ccInput, finalCc);
    if (bccInput.trim()) addEmailIfValid(bccInput, finalBcc);

    if (finalTo.length === 0) {
      alert('Veuillez ajouter au moins un destinataire');
      return;
    }
    
    const data = {
      accountId,
      to: finalTo,
      cc: showCc ? finalCc : [],
      bcc: showBcc ? finalBcc : [],
      subject,
      bodyHtml: editorRef.current?.innerHTML || bodyHtml,
      bodyText: editorRef.current?.innerText || '',
      attachments,
      inReplyTo: initialData.inReplyTo,
      references: initialData.references,
    };

    onSend(data);
  };

  // Auto-save draft periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (to.length > 0 || subject || bodyHtml) {
        offlineDB.saveDraft({
          accountId, to, cc, bcc, subject,
          bodyHtml: editorRef.current?.innerHTML || bodyHtml,
        });
        setLastSaved(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [to, cc, bcc, subject, bodyHtml, accountId]);

  const selectedAccount = accounts.find(a => a.id === accountId);
  const sendableAccounts = accounts.filter(a => a.send_permission !== 'none');

  const getAccountLabel = (a: MailAccount) => {
    const name = a.assigned_display_name || a.name;
    if (a.send_permission === 'send_on_behalf') return `De la part de ${name}`;
    return name;
  };

  if (isMinimized && !inline) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="fixed bottom-0 right-4 w-80 bg-white border border-outlook-border rounded-t-lg shadow-lg z-50">
        <div className="flex items-center justify-between px-3 py-2 bg-outlook-blue text-white rounded-t-lg cursor-pointer"
          onClick={() => setIsMinimized(false)}>
          <span className="text-sm font-medium truncate">{subject || 'Nouveau message'}</span>
          <div className="flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); setIsMinimized(false); }} className="hover:bg-white/20 p-0.5 rounded">
              <Maximize2 size={12} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="hover:bg-white/20 p-0.5 rounded">
              <X size={12} />
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  const containerClass = inline
    ? 'flex-1 flex flex-col bg-white overflow-hidden'
    : `fixed z-50 bg-white border border-outlook-border shadow-2xl flex flex-col ${isFullscreen ? 'inset-0' : 'bottom-0 right-0 md:right-4 w-full md:w-[680px] h-full md:h-[580px] md:rounded-t-lg'}`;

  return (
    <motion.div
      initial={inline ? false : { opacity: 0, y: 40, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 40, scale: 0.97 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={containerClass}>
      {/* Top toolbar — inline: send button + from + actions / modal: title bar */}
      {inline ? (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-outlook-border flex-shrink-0 bg-outlook-bg-primary/30">
          <button
            onClick={handleSend}
            disabled={isSending || (to.length === 0 && !toInput.trim())}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Send size={14} />
            {isSending ? 'Envoi...' : 'Envoyer'}
          </button>

          <AccountSelector
            accounts={sendableAccounts}
            accountId={accountId}
            onChange={setAccountId}
            getLabel={getAccountLabel}
            selectedAccount={selectedAccount}
          />

          <div className="flex-1" />

          <div className="flex items-center gap-0.5">
            <input type="file" ref={fileInputRef} onChange={handleAttachment} multiple className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-outlook-text-secondary hover:text-outlook-text-primary p-1.5 rounded hover:bg-outlook-bg-hover"
              title="Joindre un fichier"
            >
              <Paperclip size={15} />
            </button>
            <button
              onClick={onClose}
              className="text-outlook-text-secondary hover:text-outlook-danger p-1.5 rounded hover:bg-red-50"
              title="Annuler"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between px-4 py-2 bg-outlook-blue text-white rounded-t-lg flex-shrink-0">
          <span className="text-sm font-medium">{subject || 'Nouveau message'}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setIsMinimized(true)} className="hover:bg-white/20 p-1 rounded">
              <Minus size={14} />
            </button>
            <button onClick={() => setIsFullscreen(!isFullscreen)} className="hover:bg-white/20 p-1 rounded">
              <Maximize2 size={14} />
            </button>
            <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* From account selector — only in modal mode (inline has it in toolbar) */}
      {!inline && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-outlook-border text-sm flex-shrink-0">
          <span className="text-outlook-text-secondary w-12 flex-shrink-0">De :</span>
          <AccountSelector
            accounts={sendableAccounts}
            accountId={accountId}
            onChange={setAccountId}
            getLabel={getAccountLabel}
            selectedAccount={selectedAccount}
          />
        </div>
      )}

      {/* To field */}
      <RecipientField
        label="À"
        recipients={to}
        inputValue={toInput}
        onInputChange={(v) => { setToInput(v); setActiveField('to'); searchContacts(v); }}
        onKeyDown={(e) => handleInputKeyDown(e, 'to', toInput)}
        onRemove={(i) => removeRecipient('to', i)}
        suggestions={activeField === 'to' ? suggestions : []}
        onSelectSuggestion={(s) => addRecipient('to', { address: s.email, name: s.display_name || s.name })}
        onFocus={() => { setActiveField('to'); if (toInput.length >= 1) searchContacts(toInput); }}
        onBlur={() => setTimeout(() => { setSuggestions([]); setActiveField(null); }, 150)}
        onLabelClick={() => setShowContactPicker('to')}
        extra={
          <div className="flex gap-1 text-xs text-outlook-text-secondary">
            {!showCc && <button onClick={() => setShowCc(true)} className="hover:text-outlook-blue">Cc</button>}
            {!showBcc && <button onClick={() => setShowBcc(true)} className="hover:text-outlook-blue">Cci</button>}
          </div>
        }
      />

      {showCc && (
        <RecipientField
          label="Cc"
          recipients={cc}
          inputValue={ccInput}
          onInputChange={(v) => { setCcInput(v); setActiveField('cc'); searchContacts(v); }}
          onKeyDown={(e) => handleInputKeyDown(e, 'cc', ccInput)}
          onRemove={(i) => removeRecipient('cc', i)}
          suggestions={activeField === 'cc' ? suggestions : []}
          onSelectSuggestion={(s) => addRecipient('cc', { address: s.email, name: s.display_name || s.name })}
          onFocus={() => { setActiveField('cc'); if (ccInput.length >= 1) searchContacts(ccInput); }}
          onBlur={() => setTimeout(() => { setSuggestions([]); setActiveField(null); }, 150)}
          onLabelClick={() => setShowContactPicker('cc')}
        />
      )}

      {showBcc && (
        <RecipientField
          label="Cci"
          recipients={bcc}
          inputValue={bccInput}
          onInputChange={(v) => { setBccInput(v); setActiveField('bcc'); searchContacts(v); }}
          onKeyDown={(e) => handleInputKeyDown(e, 'bcc', bccInput)}
          onRemove={(i) => removeRecipient('bcc', i)}
          suggestions={activeField === 'bcc' ? suggestions : []}
          onSelectSuggestion={(s) => addRecipient('bcc', { address: s.email, name: s.display_name || s.name })}
          onFocus={() => { setActiveField('bcc'); if (bccInput.length >= 1) searchContacts(bccInput); }}
          onBlur={() => setTimeout(() => { setSuggestions([]); setActiveField(null); }, 150)}
          onLabelClick={() => setShowContactPicker('bcc')}
        />
      )}

      {/* Subject */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-outlook-border">
        {!inline && <span className="text-outlook-text-secondary text-sm w-12">Objet :</span>}
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="flex-1 text-sm outline-none"
          placeholder={inline ? 'Ajouter un objet' : 'Objet du message'}
        />
        {inline && lastSaved && (
          <span className="text-2xs text-outlook-text-disabled flex-shrink-0">
            Brouillon enregistré à {lastSaved}
          </span>
        )}
      </div>

      {/* Editor toolbar */}
      {!hideInlineToolbar && <RichTextToolbar editorRef={editorRef} />}
      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="flex-1 overflow-y-auto p-4 text-sm outline-none"
        style={{ minHeight: '100px' }}
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
        onFocus={() => setActiveField(null)}
      />

      {/* Signature */}
      {selectedAccount?.signature_html && (
        <div className="px-4 pb-2 text-xs text-outlook-text-secondary border-t border-outlook-border pt-2"
          dangerouslySetInnerHTML={{ __html: selectedAccount.signature_html }} />
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-outlook-border flex gap-2 flex-wrap">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-1 bg-outlook-bg-primary rounded px-2 py-1 text-xs">
              <Paperclip size={10} />
              <span className="truncate max-w-24">{att.filename}</span>
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-outlook-text-disabled hover:text-outlook-danger">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom toolbar — hidden in inline mode (actions are in top toolbar) */}
      {!inline && (
      <div className="flex items-center justify-between px-4 py-2 border-t border-outlook-border flex-shrink-0">
        <button
          onClick={handleSend}
          disabled={isSending || (to.length === 0 && !toInput.trim())}
          className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-5 py-2 rounded font-medium flex items-center gap-2 disabled:opacity-50 transition-colors shadow-sm hover:shadow-md"
        >
          <Send size={16} />
          {isSending ? 'Envoi...' : isOnline ? 'Envoyer' : 'Envoyer (hors-ligne)'}
        </button>

        <div className="flex items-center gap-1">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleAttachment}
            multiple
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-outlook-text-secondary hover:text-outlook-text-primary p-1.5 rounded hover:bg-outlook-bg-hover"
            title="Joindre un fichier"
          >
            <Paperclip size={16} />
          </button>
        </div>
      </div>
      )}

      {/* Contact picker modal */}
      {showContactPicker && (
        <ContactPickerModal
          field={showContactPicker}
          currentRecipients={showContactPicker === 'to' ? to : showContactPicker === 'cc' ? cc : bcc}
          onAdd={(addr) => addRecipient(showContactPicker!, addr)}
          onClose={() => setShowContactPicker(null)}
        />
      )}
    </motion.div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// AccountSelector
// ─────────────────────────────────────────────────────────────────────────────
function AccountSelector({
  accounts, accountId, onChange, getLabel, selectedAccount,
}: {
  accounts: MailAccount[];
  accountId: string;
  onChange: (id: string) => void;
  getLabel: (a: MailAccount) => string;
  selectedAccount?: MailAccount;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!selectedAccount) return null;

  if (accounts.length <= 1) {
    return (
      <span className="text-sm text-outlook-text-secondary flex items-center gap-1">
        <span className="font-medium text-outlook-text-primary">{getLabel(selectedAccount)}</span>
        <span className="text-outlook-text-disabled text-xs">‹{selectedAccount.email}›</span>
      </span>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm text-outlook-text-secondary hover:text-outlook-text-primary bg-outlook-bg-primary hover:bg-outlook-bg-hover border border-outlook-border rounded px-2 py-0.5 transition-colors"
      >
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selectedAccount.color || '#0078D4' }} />
        <span className="font-medium text-outlook-text-primary">{getLabel(selectedAccount)}</span>
        <span className="text-outlook-text-disabled text-xs">‹{selectedAccount.email}›</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-outlook-border rounded shadow-lg z-50 min-w-56 max-h-60 overflow-y-auto">
          {accounts.map(a => (
            <button
              key={a.id}
              onClick={() => { onChange(a.id); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
            >
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color || '#0078D4' }} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-outlook-text-primary truncate">{getLabel(a)}</div>
                <div className="text-xs text-outlook-text-disabled truncate">{a.email}</div>
              </div>
              {a.id === accountId && <Check size={12} className="text-outlook-blue flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RecipientField
// ─────────────────────────────────────────────────────────────────────────────
function RecipientField({
  label, recipients, inputValue, onInputChange, onKeyDown, onRemove,
  suggestions, onSelectSuggestion, onFocus, onBlur, extra, onLabelClick,
}: {
  label: string;
  recipients: EmailAddress[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onRemove: (index: number) => void;
  suggestions: any[];
  onSelectSuggestion: (suggestion: any) => void;
  onFocus: () => void;
  onBlur?: () => void;
  extra?: React.ReactNode;
  onLabelClick?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 px-4 py-1.5 border-b border-outlook-border relative flex-shrink-0">
      <button
        onClick={onLabelClick}
        className="text-outlook-blue text-sm w-12 pt-0.5 flex-shrink-0 hover:underline text-left font-medium"
        title={`Ouvrir le carnet d'adresses pour ${label}`}
      >
        {label} :
      </button>
      <div className="flex-1 flex items-center gap-1 flex-wrap min-w-0">
        {recipients.map((r, i) => (
          <span
            key={i}
            className="bg-outlook-blue/10 border border-outlook-blue/30 text-outlook-blue rounded-full px-2.5 py-0.5 text-xs flex items-center gap-1 max-w-48"
            title={r.address}
          >
            <span className="truncate">{r.name || r.address}</span>
            <button onClick={() => onRemove(i)} className="text-outlook-blue/60 hover:text-outlook-danger flex-shrink-0">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          className="flex-1 text-sm outline-none min-w-24"
          placeholder={recipients.length === 0 ? 'Ajouter des destinataires' : ''}
        />
      </div>
      {extra}

      {/* Suggestions dropdown */}
      {suggestions.length > 0 && (
        <div className="absolute left-16 top-full bg-white border border-outlook-border rounded-md shadow-xl z-40 w-80 max-h-56 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onMouseDown={(e) => { e.preventDefault(); onSelectSuggestion(s); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover flex items-center gap-2.5"
            >
              <div className="w-8 h-8 rounded-full bg-outlook-blue/10 flex items-center justify-center text-outlook-blue text-xs font-semibold flex-shrink-0">
                {s.isDistributionList
                  ? <Users size={14} />
                  : (s.display_name || s.email || s.name || '?')[0].toUpperCase()
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate text-outlook-text-primary">
                  {s.isDistributionList ? s.name : (s.display_name || s.name || s.email)}
                </div>
                {!s.isDistributionList && (
                  <div className="text-xs text-outlook-text-secondary truncate">{s.email}</div>
                )}
                {s.company && <div className="text-xs text-outlook-text-disabled truncate">{s.company}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactPickerModal
// ─────────────────────────────────────────────────────────────────────────────
function ContactPickerModal({
  field, currentRecipients, onAdd, onClose,
}: {
  field: 'to' | 'cc' | 'bcc';
  currentRecipients: EmailAddress[];
  onAdd: (addr: EmailAddress) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(currentRecipients.map(r => r.address)));

  const { data } = useQuery({
    queryKey: ['contacts-picker', search],
    queryFn: () => api.getContacts({ search: search || undefined, limit: 100 }),
    staleTime: 30000,
  });
  const contacts: Contact[] = data?.contacts || [];

  const toggle = (c: Contact) => {
    if (!c.email) return;
    const addr = c.email;
    if (selected.has(addr)) {
      setSelected(s => { const n = new Set(s); n.delete(addr); return n; });
    } else {
      setSelected(s => new Set([...s, addr]));
      onAdd({ address: addr, name: c.display_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || addr });
    }
  };

  const fieldLabel = field === 'to' ? 'À' : field === 'cc' ? 'Cc' : 'Cci';

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h2 className="font-semibold text-outlook-text-primary">Carnet d'adresses — {fieldLabel}</h2>
          <button onClick={onClose} className="p-1 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-outlook-border">
          <input
            autoFocus
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un contact..."
            className="w-full px-3 py-1.5 border border-outlook-border rounded text-sm focus:outline-none focus:border-outlook-blue"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun contact trouvé</div>
          ) : (
            contacts.map(c => {
              const isSelected = c.email ? selected.has(c.email) : false;
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c)}
                  disabled={!c.email}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-outlook-bg-hover transition-colors border-b border-outlook-border/50
                    ${isSelected ? 'bg-blue-50' : ''} ${!c.email ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0
                    ${isSelected ? 'bg-outlook-blue text-white' : 'bg-outlook-blue/10 text-outlook-blue'}`}>
                    {isSelected ? <Check size={14} /> : (c.display_name || c.first_name || c.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate text-outlook-text-primary">
                      {c.display_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email}
                    </div>
                    <div className="text-xs text-outlook-text-secondary truncate">{c.email}</div>
                    {c.company && <div className="text-xs text-outlook-text-disabled truncate">{c.company}</div>}
                  </div>
                  {c.source === 'sender' && (
                    <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full flex-shrink-0">Expéditeur</span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-3 border-t border-outlook-border flex justify-end">
          <button
            onClick={onClose}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            Terminé
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RichTextToolbar — Outlook-style
// ─────────────────────────────────────────────────────────────────────────────
const FONT_FAMILIES = ['Arial', 'Calibri', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Trebuchet MS'];
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48', '72'];
const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#ffffff',
  '#ff0000', '#ff4500', '#ff9900', '#ffff00', '#00ff00', '#00ffff',
  '#0000ff', '#9900ff', '#ff00ff', '#e06666', '#f6b26b', '#ffd966',
  '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c8',
  '#674ea7', '#a64d79',
];

function RichTextToolbar({ editorRef }: { editorRef: React.RefObject<HTMLDivElement> }) {
  const [showFontFamily, setShowFontFamily] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);
  const [showTextColor, setShowTextColor] = useState(false);
  const [showBgColor, setShowBgColor] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [currentFont, setCurrentFont] = useState('Calibri');
  const [currentSize, setCurrentSize] = useState('12');
  const [savedRange, setSavedRange] = useState<Range | null>(null);

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) setSavedRange(sel.getRangeAt(0).cloneRange());
  };

  const restoreSelection = () => {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(savedRange);
  };

  const applyFont = (font: string) => {
    restoreSelection();
    exec('fontName', font);
    setCurrentFont(font);
    setShowFontFamily(false);
    editorRef.current?.focus();
  };

  const applySize = (size: string) => {
    restoreSelection();
    const sizeMap: Record<string, string> = {
      '8': '1', '9': '1', '10': '2', '11': '2', '12': '3', '14': '3',
      '16': '4', '18': '4', '20': '5', '24': '5', '28': '6', '36': '6', '48': '7', '72': '7',
    };
    exec('fontSize', sizeMap[size] || '3');
    setCurrentSize(size);
    setShowFontSize(false);
    editorRef.current?.focus();
  };

  const insertLink = () => {
    if (!linkUrl) return;
    restoreSelection();
    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    exec('createLink', url);
    setShowLinkInput(false);
    setLinkUrl('');
    editorRef.current?.focus();
  };

  const insertImage = () => {
    const url = prompt('URL de l\'image :');
    if (url) exec('insertImage', url);
  };

  const closeAllDropdowns = () => {
    setShowFontFamily(false);
    setShowFontSize(false);
    setShowTextColor(false);
    setShowBgColor(false);
  };

  const btnClass = 'w-7 h-7 flex items-center justify-center hover:bg-outlook-bg-hover rounded transition-colors text-outlook-text-secondary hover:text-outlook-text-primary';
  const divider = <div className="w-px h-5 bg-outlook-border mx-0.5 flex-shrink-0" />;

  return (
    <div className="border-b border-outlook-border bg-outlook-bg-primary/50 flex-shrink-0">
      <div className="flex items-center gap-0.5 px-2 py-1 flex-wrap">
        {/* Font family */}
        <div className="relative">
          <button
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowFontFamily(s => !s); }}
            className="flex items-center gap-1 text-xs border border-outlook-border rounded px-2 py-0.5 hover:bg-outlook-bg-hover min-w-28 justify-between"
          >
            <span style={{ fontFamily: currentFont }} className="truncate">{currentFont}</span>
            <ChevronDown size={10} className="flex-shrink-0" />
          </button>
          {showFontFamily && (
            <div className="absolute top-full left-0 mt-0.5 bg-white border border-outlook-border rounded shadow-lg z-50 min-w-44 max-h-48 overflow-y-auto">
              {FONT_FAMILIES.map(f => (
                <button key={f} onMouseDown={(e) => { e.preventDefault(); applyFont(f); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover" style={{ fontFamily: f }}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font size */}
        <div className="relative ml-1">
          <button
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowFontSize(s => !s); }}
            className="flex items-center gap-1 text-xs border border-outlook-border rounded px-2 py-0.5 hover:bg-outlook-bg-hover w-14 justify-between"
          >
            <span>{currentSize}</span>
            <ChevronDown size={10} />
          </button>
          {showFontSize && (
            <div className="absolute top-full left-0 mt-0.5 bg-white border border-outlook-border rounded shadow-lg z-50 w-14 max-h-48 overflow-y-auto">
              {FONT_SIZES.map(s => (
                <button key={s} onMouseDown={(e) => { e.preventDefault(); applySize(s); }}
                  className="w-full text-left px-3 py-1 text-xs hover:bg-outlook-bg-hover">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {divider}

        {/* Bold, Italic, Underline, Strikethrough */}
        <button onClick={() => exec('bold')} className={btnClass} title="Gras (Ctrl+B)">
          <Bold size={13} />
        </button>
        <button onClick={() => exec('italic')} className={btnClass} title="Italique (Ctrl+I)">
          <Italic size={13} />
        </button>
        <button onClick={() => exec('underline')} className={btnClass} title="Souligné (Ctrl+U)">
          <Underline size={13} />
        </button>
        <button onClick={() => exec('strikeThrough')} className={btnClass} title="Barré">
          <Strikethrough size={13} />
        </button>

        {divider}

        {/* Text color */}
        <div className="relative">
          <button
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowTextColor(s => !s); }}
            className={`${btnClass} flex-col gap-0`}
            title="Couleur du texte"
          >
            <Type size={11} />
            <div className="w-4 h-1 rounded-sm bg-red-500 mt-0.5" />
          </button>
          {showTextColor && (
            <ColorPicker
              onSelect={(color) => { restoreSelection(); exec('foreColor', color); setShowTextColor(false); editorRef.current?.focus(); }}
              onClose={() => setShowTextColor(false)}
            />
          )}
        </div>

        {/* Background/highlight color */}
        <div className="relative">
          <button
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); closeAllDropdowns(); setShowBgColor(s => !s); }}
            className={`${btnClass} flex-col gap-0`}
            title="Couleur de surlignage"
          >
            <Palette size={11} />
            <div className="w-4 h-1 rounded-sm bg-yellow-300 mt-0.5" />
          </button>
          {showBgColor && (
            <ColorPicker
              onSelect={(color) => { restoreSelection(); exec('hiliteColor', color); setShowBgColor(false); editorRef.current?.focus(); }}
              onClose={() => setShowBgColor(false)}
            />
          )}
        </div>

        {divider}

        {/* Alignment */}
        <button onClick={() => exec('justifyLeft')} className={btnClass} title="Aligner à gauche">
          <AlignLeft size={13} />
        </button>
        <button onClick={() => exec('justifyCenter')} className={btnClass} title="Centrer">
          <AlignCenter size={13} />
        </button>
        <button onClick={() => exec('justifyRight')} className={btnClass} title="Aligner à droite">
          <AlignRight size={13} />
        </button>
        <button onClick={() => exec('justifyFull')} className={btnClass} title="Justifier">
          <AlignJustify size={13} />
        </button>

        {divider}

        {/* Lists */}
        <button onClick={() => exec('insertUnorderedList')} className={btnClass} title="Liste à puces">
          <List size={13} />
        </button>
        <button onClick={() => exec('insertOrderedList')} className={btnClass} title="Liste numérotée">
          <ListOrdered size={13} />
        </button>
        <button onClick={() => exec('indent')} className={btnClass} title="Augmenter le retrait">
          <Indent size={13} />
        </button>
        <button onClick={() => exec('outdent')} className={btnClass} title="Diminuer le retrait">
          <Outdent size={13} />
        </button>

        {divider}

        {/* Link */}
        <div className="relative">
          <button
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); setShowLinkInput(s => !s); }}
            className={btnClass}
            title="Insérer un lien"
          >
            <LinkIcon size={13} />
          </button>
          {showLinkInput && (
            <div className="absolute top-full left-0 mt-0.5 bg-white border border-outlook-border rounded shadow-lg z-50 p-2 flex gap-1 min-w-64">
              <input
                autoFocus
                type="text"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') insertLink(); if (e.key === 'Escape') setShowLinkInput(false); }}
                placeholder="https://..."
                className="flex-1 text-xs border border-outlook-border rounded px-2 py-1 outline-none focus:border-outlook-blue"
              />
              <button onMouseDown={(e) => { e.preventDefault(); insertLink(); }} className="bg-outlook-blue text-white text-xs px-2 py-1 rounded">OK</button>
            </div>
          )}
        </div>

        {/* Image */}
        <button onClick={insertImage} className={btnClass} title="Insérer une image">
          <Image size={13} />
        </button>

        {divider}

        {/* Clear formatting */}
        <button onClick={() => exec('removeFormat')} className={btnClass} title="Effacer la mise en forme">
          <span className="text-xs font-normal line-through opacity-60">A</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ColorPicker
// ─────────────────────────────────────────────────────────────────────────────
function ColorPicker({ onSelect, onClose }: { onSelect: (color: string) => void; onClose: () => void }) {
  return (
    <div className="absolute top-full left-0 mt-0.5 bg-white border border-outlook-border rounded shadow-lg z-50 p-2">
      <div className="grid grid-cols-6 gap-0.5">
        {TEXT_COLORS.map(color => (
          <button
            key={color}
            onMouseDown={(e) => { e.preventDefault(); onSelect(color); }}
            className="w-5 h-5 rounded-sm border border-transparent hover:border-outlook-text-secondary transition-colors"
            style={{ background: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
}
