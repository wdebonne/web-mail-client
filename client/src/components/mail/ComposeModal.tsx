import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Send, Paperclip, Minus, Maximize2, ChevronDown } from 'lucide-react';
import { ComposeData } from '../../stores/mailStore';
import { MailAccount, EmailAddress } from '../../types';
import { api } from '../../api';
import { offlineDB } from '../../pwa/offlineDB';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

interface ComposeModalProps {
  initialData: ComposeData;
  accounts: MailAccount[];
  selectedAccountId?: string;
  onSend: (data: any) => void;
  onClose: () => void;
  isSending: boolean;
}

export default function ComposeModal({
  initialData, accounts, selectedAccountId, onSend, onClose, isSending,
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

  // Contact autocomplete
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [activeField, setActiveField] = useState<'to' | 'cc' | 'bcc' | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Autocomplete search
  const searchContacts = useCallback(async (query: string) => {
    if (query.length < 2) {
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
    setter(prev => [...prev, address]);
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
  };

  const handleAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

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
  };

  const handleSend = () => {
    if (to.length === 0) return;
    
    const data = {
      accountId,
      to,
      cc: showCc ? cc : [],
      bcc: showBcc ? bcc : [],
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
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [to, cc, bcc, subject, bodyHtml, accountId]);

  const selectedAccount = accounts.find(a => a.id === accountId);

  if (isMinimized) {
    return (
      <div className="fixed bottom-0 right-4 w-80 bg-white border border-outlook-border rounded-t-lg shadow-lg z-50">
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
      </div>
    );
  }

  return (
    <div className={`fixed z-50 bg-white border border-outlook-border shadow-2xl flex flex-col
      ${isFullscreen
        ? 'inset-0'
        : 'bottom-0 right-4 w-[640px] h-[500px] rounded-t-lg'}`}>
      {/* Title bar */}
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

      {/* From account selector */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-outlook-border text-sm">
          <span className="text-outlook-text-secondary w-12">De :</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="flex-1 text-sm border-none outline-none bg-transparent"
          >
            {accounts.filter(a => a.send_permission !== 'none').map(a => (
              <option key={a.id} value={a.id}>
                {a.send_permission === 'send_on_behalf'
                  ? `De la part de ${a.assigned_display_name || a.name} (${a.email})`
                  : `${a.assigned_display_name || a.name} (${a.email})`
                }
              </option>
            ))}
          </select>
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
        onSelectSuggestion={(s) => addRecipient('to', { address: s.email, name: s.display_name })}
        onFocus={() => setActiveField('to')}
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
          onSelectSuggestion={(s) => addRecipient('cc', { address: s.email, name: s.display_name })}
          onFocus={() => setActiveField('cc')}
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
          onSelectSuggestion={(s) => addRecipient('bcc', { address: s.email, name: s.display_name })}
          onFocus={() => setActiveField('bcc')}
        />
      )}

      {/* Subject */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-outlook-border">
        <span className="text-outlook-text-secondary text-sm w-12">Objet :</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="flex-1 text-sm outline-none"
          placeholder="Objet du message"
        />
      </div>

      {/* Editor toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-outlook-border bg-outlook-bg-primary/50 flex-shrink-0">
        <EditorButton label="G" title="Gras" command="bold" />
        <EditorButton label="I" title="Italique" command="italic" style />
        <EditorButton label="S" title="Souligné" command="underline" underline />
        <div className="w-px h-4 bg-outlook-border mx-1" />
        <EditorButton label="•" title="Liste à puces" command="insertUnorderedList" />
        <EditorButton label="1." title="Liste numérotée" command="insertOrderedList" />
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
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

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-outlook-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={isSending || to.length === 0}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-1.5 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Send size={14} />
            {isSending ? 'Envoi...' : isOnline ? 'Envoyer' : 'Envoyer (hors-ligne)'}
          </button>
        </div>

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
    </div>
  );
}

function RecipientField({
  label, recipients, inputValue, onInputChange, onKeyDown, onRemove,
  suggestions, onSelectSuggestion, onFocus, extra,
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
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 px-4 py-1.5 border-b border-outlook-border relative">
      <span className="text-outlook-text-secondary text-sm w-12 pt-0.5">{label} :</span>
      <div className="flex-1 flex items-center gap-1 flex-wrap">
        {recipients.map((r, i) => (
          <span
            key={i}
            className="bg-outlook-bg-primary border border-outlook-border rounded px-2 py-0.5 text-xs flex items-center gap-1"
          >
            {r.name || r.address}
            <button onClick={() => onRemove(i)} className="text-outlook-text-disabled hover:text-outlook-danger">
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
          className="flex-1 text-sm outline-none min-w-20"
          placeholder={recipients.length === 0 ? 'Ajouter des destinataires' : ''}
        />
      </div>
      {extra}

      {/* Suggestions dropdown */}
      {suggestions.length > 0 && (
        <div className="absolute left-16 top-full bg-white border border-outlook-border rounded-md shadow-lg z-30 w-80 max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSelectSuggestion(s)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-outlook-bg-hover flex items-center gap-2"
            >
              <div className="w-8 h-8 rounded-full bg-outlook-blue/10 flex items-center justify-center text-outlook-blue text-xs font-semibold flex-shrink-0">
                {(s.display_name || s.email || s.name || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">{s.display_name || s.name}</div>
                <div className="text-xs text-outlook-text-secondary truncate">{s.email}</div>
                {s.company && <div className="text-xs text-outlook-text-disabled truncate">{s.company}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EditorButton({ label, title, command, style, underline }: {
  label: string; title: string; command: string; style?: boolean; underline?: boolean;
}) {
  return (
    <button
      onClick={() => document.execCommand(command)}
      className="w-7 h-7 flex items-center justify-center text-xs hover:bg-outlook-bg-hover rounded transition-colors text-outlook-text-secondary"
      title={title}
    >
      <span className={`${style ? 'italic' : ''} ${underline ? 'underline' : ''} font-semibold`}>
        {label}
      </span>
    </button>
  );
}
