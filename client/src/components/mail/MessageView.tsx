import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import DOMPurify from 'dompurify';
import {
  Reply, ReplyAll, Forward, Trash2, Star, MoreHorizontal,
  Paperclip, Download, Archive, Flag, FolderInput, Eye, X, ChevronDown,
  ChevronRight, MessagesSquare, Lock, ShieldCheck, ShieldAlert, ShieldX, KeyRound,
} from 'lucide-react';
import { Email } from '../../types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../api';
import { inspectIncoming, SecurityVerdict } from '../../crypto/inbound';
import { useSecurityStore } from '../../stores/securityStore';

type AttachmentActionMode = 'preview' | 'download' | 'menu';

type PreviewAttachmentState = {
  name: string;
  contentType: string;
  renderMode: 'image' | 'iframe' | 'html' | 'unsupported';
  url?: string;
  html?: string;
  error?: string;
};

interface MessageViewProps {
  message: Email | null;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onToggleFlag: () => void;
  onMove: (folder: string) => void;
  /** Archive the message using the server-side dated folder tree. */
  onArchive?: () => void;
  attachmentMinVisibleKb?: number;
  attachmentActionMode?: AttachmentActionMode;
  /** All messages belonging to the same conversation thread as `message` (including `message` itself).
   *  When provided and length > 1, the view renders a clickable conversation strip. */
  conversationMessages?: Email[];
  /** Called when the user clicks on another message from the conversation strip. */
  onSelectThreadMessage?: (message: Email) => void;
}

export default function MessageView({
  message, onReply, onReplyAll, onForward, onDelete, onToggleFlag, onMove, onArchive, attachmentMinVisibleKb = 0, attachmentActionMode = 'preview',
  conversationMessages, onSelectThreadMessage,
}: MessageViewProps) {
  const [showMore, setShowMore] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<PreviewAttachmentState | null>(null);
  const [previewLoadingName, setPreviewLoadingName] = useState<string | null>(null);
  const [activeAttachmentMenuIndex, setActiveAttachmentMenuIndex] = useState<number | null>(null);

  // --- Conversation thread (expandable stack) ---
  const isThreadMode = !!(conversationMessages && conversationMessages.length > 1);
  const threadKeyOf = (m: Email) => `${m._accountId || ''}-${m.uid}-${m.messageId || ''}`;
  const sortedThread = useMemo(() => {
    if (!isThreadMode) return [] as Email[];
    return [...conversationMessages!].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [conversationMessages, isThreadMode]);
  const threadIdentity = sortedThread.map(threadKeyOf).join('|');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const lastThreadIdRef = useRef<string>('');
  useEffect(() => {
    if (!isThreadMode) return;
    // When the thread itself changes (different selected conversation), reset to « seul le plus
    // récent déplié ». When the thread content is unchanged but the user selects another message
    // of the same thread, simply ensure it's expanded without collapsing the others.
    if (lastThreadIdRef.current !== threadIdentity) {
      const newest = sortedThread[sortedThread.length - 1];
      const initial = new Set<string>();
      if (newest) initial.add(threadKeyOf(newest));
      if (message) initial.add(threadKeyOf(message));
      setExpandedKeys(initial);
      lastThreadIdRef.current = threadIdentity;
    } else if (message) {
      const k = threadKeyOf(message);
      setExpandedKeys(prev => (prev.has(k) ? prev : new Set(prev).add(k)));
    }
  }, [threadIdentity, message?.uid, message?._accountId, isThreadMode]);
  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sanitizedHtml = message?.bodyHtml
    ? DOMPurify.sanitize(message.bodyHtml, {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'img', 'div', 'span',
          'table', 'tr', 'td', 'th', 'thead', 'tbody', 'ul', 'ol', 'li', 'h1', 'h2', 'h3',
          'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'style', 'font', 'center'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'width', 'height', 'target',
          'color', 'size', 'face', 'align', 'valign', 'bgcolor', 'border', 'cellpadding',
          'cellspacing', 'colspan', 'rowspan', 'rel'],
        ALLOW_DATA_ATTR: false,
      })
    : '';

  // ───── Security pipeline — detect PGP armor in inbound message and verify/decrypt.
  // The verdict is re-evaluated whenever the viewed message changes or the unlocked-key
  // set changes (so unlocking a key live in the Security page retroactively decrypts).
  const unlockedPgpCount = useSecurityStore(s => Object.keys(s.unlockedPgp).length);
  const [verdict, setVerdict] = useState<SecurityVerdict>({ kind: 'plain' });
  useEffect(() => {
    let cancelled = false;
    const raw = message?.bodyText || message?.bodyHtml || '';
    if (!raw) { setVerdict({ kind: 'plain' }); return; }
    inspectIncoming(raw).then(v => { if (!cancelled) setVerdict(v); });
    return () => { cancelled = true; };
  }, [message?.uid, message?._accountId, message?.bodyText, unlockedPgpCount]);

  const securePlaintext = verdict.kind === 'pgp-signed' || verdict.kind === 'pgp-encrypted' ? verdict.plaintext : null;

  const attachmentMinVisibleBytes = Math.max(0, attachmentMinVisibleKb) * 1024;
  const visibleAttachments = useMemo(
    () => (message?.attachments || []).filter(att => (att.size || 0) >= attachmentMinVisibleBytes),
    [message?.attachments, attachmentMinVisibleBytes]
  );

  useEffect(() => {
    return () => {
      if (previewAttachment?.url) {
        URL.revokeObjectURL(previewAttachment.url);
      }
    };
  }, [previewAttachment]);

  // Auto-record the sender as an unregistered contact
  useEffect(() => {
    if (message?.from?.address) {
      api.recordSender(message.from.address, message.from.name).catch(() => {/* silent */});
    }
  }, [message?.uid]);

  useEffect(() => {
    if (!previewAttachment) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAttachmentPreview();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [previewAttachment]);

  const closeAttachmentPreview = () => {
    if (previewAttachment?.url) {
      URL.revokeObjectURL(previewAttachment.url);
    }
    setPreviewAttachment(null);
    setPreviewLoadingName(null);
  };

  const decodeBase64ToUint8Array = (b64: string) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const getFileExtension = (filename: string) => {
    const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  };

  const isHeic = (contentType: string, filename: string) => {
    const ext = getFileExtension(filename);
    return contentType.includes('image/heic') || contentType.includes('image/heif') || ext === 'heic' || ext === 'heif';
  };

  const isDocx = (contentType: string, filename: string) => {
    const ext = getFileExtension(filename);
    return contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || ext === 'docx';
  };

  const isXlsx = (contentType: string, filename: string) => {
    const ext = getFileExtension(filename);
    return contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') || ext === 'xlsx';
  };

  const downloadAttachment = (att: { filename: string; contentType?: string; content?: string }) => {
    if (!att.content) return;
    const bytes = decodeBase64ToUint8Array(att.content);
    const blob = new Blob([bytes], { type: att.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename || 'piece-jointe';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };

  const openAttachmentPreview = async (att: { filename: string; contentType?: string; content?: string }) => {
    if (!att.content) return;

    try {
      setPreviewLoadingName(att.filename);

      const bytes = decodeBase64ToUint8Array(att.content);
      const normalizedType = (att.contentType || '').toLowerCase();

      if (isHeic(normalizedType, att.filename)) {
        const { default: heic2any } = await import('heic2any');
        const heicBlob = new Blob([bytes], { type: normalizedType || 'image/heic' });
        const converted = await heic2any({ blob: heicBlob, toType: 'image/jpeg', quality: 0.9 });
        const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
        const url = URL.createObjectURL(jpegBlob as Blob);
        if (previewAttachment?.url) URL.revokeObjectURL(previewAttachment.url);
        setPreviewAttachment({
          name: att.filename,
          contentType: 'image/jpeg',
          renderMode: 'image',
          url,
        });
        return;
      }

      if (isDocx(normalizedType, att.filename)) {
        const mammoth = await import('mammoth');
        const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const { value } = await mammoth.convertToHtml({ arrayBuffer });
        if (previewAttachment?.url) URL.revokeObjectURL(previewAttachment.url);
        setPreviewAttachment({
          name: att.filename,
          contentType: normalizedType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          renderMode: 'html',
          html: DOMPurify.sanitize(value),
        });
        return;
      }

      if (isXlsx(normalizedType, att.filename)) {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(bytes, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const firstSheet = workbook.Sheets[firstSheetName];
        const sheetHtml = XLSX.utils.sheet_to_html(firstSheet, { editable: false });
        if (previewAttachment?.url) URL.revokeObjectURL(previewAttachment.url);
        setPreviewAttachment({
          name: att.filename,
          contentType: normalizedType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          renderMode: 'html',
          html: DOMPurify.sanitize(sheetHtml),
        });
        return;
      }

      const blob = new Blob([bytes], { type: normalizedType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const renderMode = (normalizedType.startsWith('image/')) ? 'image' : 'iframe';

      if (previewAttachment?.url) URL.revokeObjectURL(previewAttachment.url);
      setPreviewAttachment({
        name: att.filename,
        contentType: normalizedType || 'application/octet-stream',
        renderMode,
        url,
      });
    } catch {
      if (previewAttachment?.url) URL.revokeObjectURL(previewAttachment.url);
      setPreviewAttachment({
        name: att.filename,
        contentType: att.contentType || 'application/octet-stream',
        renderMode: 'unsupported',
        error: 'Aperçu non disponible pour ce fichier sur votre navigateur. Vous pouvez le télécharger.',
      });
    } finally {
      setPreviewLoadingName(null);
    }
  };

  const handleAttachmentOpen = async (att: { filename: string; contentType?: string; content?: string }, index: number) => {
    if (!att.content) return;
    if (attachmentActionMode === 'download') {
      downloadAttachment(att);
      return;
    }
    if (attachmentActionMode === 'menu') {
      setActiveAttachmentMenuIndex(prev => (prev === index ? null : index));
      return;
    }
    await openAttachmentPreview(att);
  };

  if (!message) {
    return (
      <div className="flex-1 flex items-center justify-center bg-outlook-bg-primary/20">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="text-center text-outlook-text-disabled"
        >
          <div className="text-6xl mb-4">📧</div>
          <p className="text-sm">Sélectionnez un message pour le lire</p>
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      key={message.uid}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Subject bar (shared across the whole conversation when in thread mode) */}
      <div className="px-3 sm:px-6 py-3 border-b border-outlook-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {isThreadMode && (
            <div className="flex items-center gap-1 text-outlook-blue flex-shrink-0" title="Vue conversation">
              <MessagesSquare size={14} />
              <span className="text-xs font-semibold">{sortedThread.length}</span>
            </div>
          )}
          <h1 className="text-base font-semibold text-outlook-text-primary truncate">
            {message.subject || '(Sans objet)'}
          </h1>
        </div>
      </div>

      {/* Message header — sender info left, actions right (single-message mode only) */}
      {!isThreadMode && (
      <div className="px-3 sm:px-6 py-3 border-b border-outlook-border flex-shrink-0">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: getAvatarColor(message.from?.name, message.from?.address) }}
          >
            {getInitials(message.from?.name, message.from?.address)}
          </div>

          <div className="flex-1 min-w-0">
            {/* Sender name + email — wraps on mobile to avoid overlap */}
            <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 min-w-0">
              <span className="font-semibold text-sm text-outlook-text-primary truncate max-w-full">
                {message.from?.name || message.from?.address || 'Inconnu'}
              </span>
              {message.from?.name && (
                <span className="text-xs text-outlook-text-secondary truncate max-w-full">
                  &lt;{message.from.address}&gt;
                </span>
              )}
            </div>
            <div className="text-xs text-outlook-text-secondary mt-0.5 truncate">
              <span>À : </span>
              {message.to?.map((addr, i) => (
                <span key={i}>
                  {i > 0 && '; '}
                  <span className="text-outlook-blue">{addr.name || addr.address}</span>
                </span>
              ))}
            </div>
            {message.cc && message.cc.length > 0 && (
              <div className="text-xs text-outlook-text-secondary truncate">
                <span>Cc : </span>
                {message.cc.map((addr, i) => (
                  <span key={i}>
                    {i > 0 && '; '}
                    {addr.name || addr.address}
                  </span>
                ))}
              </div>
            )}
            {/* Date — visible inline on mobile (where the action column is hidden) */}
            <div className="md:hidden text-2xs text-outlook-text-secondary mt-1">
              {format(new Date(message.date), "EEE dd/MM/yyyy HH:mm", { locale: fr })}
            </div>
          </div>

          {/* Right side: action buttons + date — desktop / large tablets only */}
          <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-center gap-0.5">
              <ActionButton icon={Reply} label="Répondre" onClick={onReply} />
              <ActionButton icon={ReplyAll} label="Répondre à tous" onClick={onReplyAll} />
              <ActionButton icon={Forward} label="Transférer" onClick={onForward} />
              <div className="w-px h-5 bg-outlook-border mx-0.5" />
              <ActionButton icon={Trash2} label="Supprimer" onClick={onDelete} danger />
              <ActionButton
                icon={Star}
                label={message.flags?.flagged ? 'Retirer' : 'Indicateur'}
                onClick={onToggleFlag}
                active={message.flags?.flagged}
              />
              <div className="relative">
                <ActionButton icon={MoreHorizontal} label="Plus" onClick={() => setShowMore(!showMore)} />
                {showMore && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowMore(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-white border border-outlook-border rounded-md shadow-lg py-1 z-20 min-w-48">
                      <button onClick={() => { (onArchive ? onArchive() : onMove('Archive')); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
                        <Archive size={14} /> Archiver
                      </button>
                      <button onClick={() => { onMove('Junk'); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
                        <Flag size={14} /> Marquer comme indésirable
                      </button>
                      <button onClick={() => { onMove('INBOX'); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
                        <FolderInput size={14} /> Déplacer vers...
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <span className="text-2xs text-outlook-text-secondary">
              {format(new Date(message.date), "EEE dd/MM/yyyy HH:mm", { locale: fr })}
            </span>
          </div>
        </div>

        {/* Mobile / small tablet action bar — full-width row below sender info */}
        <div className="md:hidden mt-2 -mx-1 flex items-center justify-between border-t border-outlook-border pt-2">
          <div className="flex items-center gap-0.5 overflow-x-auto">
            <ActionButton icon={Reply} label="Répondre" onClick={onReply} />
            <ActionButton icon={ReplyAll} label="Répondre à tous" onClick={onReplyAll} />
            <ActionButton icon={Forward} label="Transférer" onClick={onForward} />
          </div>
          <div className="flex items-center gap-0.5">
            <ActionButton
              icon={Star}
              label={message.flags?.flagged ? 'Retirer' : 'Indicateur'}
              onClick={onToggleFlag}
              active={message.flags?.flagged}
            />
            <ActionButton icon={Trash2} label="Supprimer" onClick={onDelete} danger />
            <div className="relative">
              <ActionButton icon={MoreHorizontal} label="Plus" onClick={() => setShowMore(!showMore)} />
              {showMore && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMore(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white border border-outlook-border rounded-md shadow-lg py-1 z-20 min-w-48">
                    <button onClick={() => { (onArchive ? onArchive() : onMove('Archive')); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
                      <Archive size={14} /> Archiver
                    </button>
                    <button onClick={() => { onMove('Junk'); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
                      <Flag size={14} /> Marquer comme indésirable
                    </button>
                    <button onClick={() => { onMove('INBOX'); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
                      <FolderInput size={14} /> Déplacer vers...
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Attachments (single-message mode only — in thread mode, each card has its own) */}
      {!isThreadMode && visibleAttachments.length > 0 && (
        <div className="px-6 py-2 border-b border-outlook-border bg-outlook-bg-primary/30 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Paperclip size={14} className="text-outlook-text-secondary" />
            {visibleAttachments.map((att, i) => (
              <div key={i} className="relative">
                <button
                  onClick={() => handleAttachmentOpen(att, i)}
                  className="flex items-center gap-1.5 bg-white border border-outlook-border rounded px-2 py-1 text-xs hover:bg-outlook-bg-hover transition-colors"
                >
                  {attachmentActionMode === 'download' ? <Download size={12} /> : <Eye size={12} />}
                  <span className="truncate max-w-32">{att.filename}</span>
                  <span className="text-outlook-text-disabled">
                    ({formatFileSize(att.size)})
                  </span>
                  {attachmentActionMode === 'menu' && <ChevronDown size={11} className="text-outlook-text-secondary" />}
                </button>

                {attachmentActionMode === 'menu' && activeAttachmentMenuIndex === i && (
                  <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-outlook-border rounded-md shadow-lg py-1 min-w-40">
                    <button
                      onClick={async () => {
                        setActiveAttachmentMenuIndex(null);
                        await openAttachmentPreview(att);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover flex items-center gap-2"
                    >
                      <Eye size={12} /> Aperçu
                    </button>
                    <button
                      onClick={() => {
                        setActiveAttachmentMenuIndex(null);
                        downloadAttachment(att);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-outlook-bg-hover flex items-center gap-2"
                    >
                      <Download size={12} /> Télécharger
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Message body — in thread mode, render a vertical stack of collapsible cards */}
      {isThreadMode ? (
        <div className="flex-1 overflow-y-auto bg-outlook-bg-primary/20">
          <div className="flex flex-col gap-2 p-3">
            {sortedThread.map((m, idx) => {
              const key = threadKeyOf(m);
              const isOpen = expandedKeys.has(key);
              const isLast = idx === sortedThread.length - 1;
              const bodyHtml = m.bodyHtml
                ? DOMPurify.sanitize(m.bodyHtml, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'img', 'div', 'span',
                      'table', 'tr', 'td', 'th', 'thead', 'tbody', 'ul', 'ol', 'li', 'h1', 'h2', 'h3',
                      'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'style', 'font', 'center'],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'width', 'height', 'target',
                      'color', 'size', 'face', 'align', 'valign', 'bgcolor', 'border', 'cellpadding',
                      'cellspacing', 'colspan', 'rowspan', 'rel'],
                    ALLOW_DATA_ATTR: false,
                  })
                : '';
              const cardAttachments = (m.attachments || []).filter(att => (att.size || 0) >= attachmentMinVisibleBytes);
              return (
                <div
                  key={key}
                  className={`bg-white border rounded-md overflow-hidden transition-shadow
                    ${isOpen ? 'border-outlook-border shadow-sm' : 'border-outlook-border'}`}
                >
                  {/* Collapsible header */}
                  <button
                    type="button"
                    onClick={() => {
                      toggleExpand(key);
                      if (!isOpen) onSelectThreadMessage?.(m);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                      ${isOpen ? 'bg-white' : 'hover:bg-outlook-bg-hover'}`}
                  >
                    {isOpen
                      ? <ChevronDown size={14} className="text-outlook-text-secondary flex-shrink-0" />
                      : <ChevronRight size={14} className="text-outlook-text-secondary flex-shrink-0" />}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ backgroundColor: getAvatarColor(m.from?.name, m.from?.address) }}
                    >
                      {getInitials(m.from?.name, m.from?.address)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-sm text-outlook-text-primary truncate">
                          {m.from?.name || m.from?.address || 'Inconnu'}
                        </span>
                        {!isOpen && (m.bodyText || m.bodyHtml) && (
                          <span className="text-xs text-outlook-text-secondary truncate">
                            {(m.bodyText || '').replace(/\s+/g, ' ').slice(0, 120)}
                          </span>
                        )}
                      </div>
                      {isOpen && (
                        <div className="text-xs text-outlook-text-secondary mt-0.5 truncate">
                          À : {m.to?.map((a: any) => a.name || a.address).join('; ')}
                          {m.cc && m.cc.length > 0 && (
                            <span> • Cc : {m.cc.map((a: any) => a.name || a.address).join('; ')}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 text-outlook-text-disabled">
                      {m.flags?.answered && <span title="Répondu" className="inline-flex"><Reply size={12} /></span>}
                      {m.hasAttachments && <span title="Pièce jointe" className="inline-flex"><Paperclip size={12} /></span>}
                      <span className="text-xs">
                        {format(new Date(m.date), isLast ? "EEE dd/MM/yyyy HH:mm" : 'dd/MM HH:mm', { locale: fr })}
                      </span>
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isOpen && (
                    <div className="border-t border-outlook-border">
                      {cardAttachments.length > 0 && (
                        <div className="px-4 py-2 border-b border-outlook-border bg-outlook-bg-primary/30">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Paperclip size={14} className="text-outlook-text-secondary" />
                            {cardAttachments.map((att, i) => (
                              <div key={i} className="relative">
                                <button
                                  onClick={() => handleAttachmentOpen(att, i)}
                                  className="flex items-center gap-1.5 bg-white border border-outlook-border rounded px-2 py-1 text-xs hover:bg-outlook-bg-hover transition-colors"
                                >
                                  {attachmentActionMode === 'download' ? <Download size={12} /> : <Eye size={12} />}
                                  <span className="truncate max-w-32">{att.filename}</span>
                                  <span className="text-outlook-text-disabled">({formatFileSize(att.size)})</span>
                                  {attachmentActionMode === 'menu' && <ChevronDown size={11} className="text-outlook-text-secondary" />}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="px-5 py-3">
                        {bodyHtml ? (
                          <div className="email-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                        ) : (
                          <pre className="whitespace-pre-wrap text-sm text-outlook-text-primary font-sans">
                            {m.bodyText || ''}
                          </pre>
                        )}
                        {isLast && (
                          <div className="flex items-center gap-2 mt-6 pt-4 border-t border-outlook-border">
                            <button
                              onClick={onReply}
                              className="flex items-center gap-2 px-4 py-2 text-sm text-outlook-text-secondary hover:text-outlook-text-primary border border-outlook-border rounded hover:bg-outlook-bg-hover transition-colors"
                            >
                              <Reply size={14} /> Répondre
                            </button>
                            <button
                              onClick={onForward}
                              className="flex items-center gap-2 px-4 py-2 text-sm text-outlook-text-secondary hover:text-outlook-text-primary border border-outlook-border rounded hover:bg-outlook-bg-hover transition-colors"
                            >
                              <Forward size={14} /> Transférer
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <SecurityBanner verdict={verdict} />
          {securePlaintext ? (
            <pre className="whitespace-pre-wrap text-sm text-outlook-text-primary font-sans">
              {securePlaintext}
            </pre>
          ) : sanitizedHtml ? (
            <div
              className="email-body"
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-outlook-text-primary font-sans">
              {message.bodyText || ''}
            </pre>
          )}

          {/* Bottom reply/forward buttons */}
          <div className="flex items-center gap-2 mt-6 pt-4 border-t border-outlook-border">
            <button
              onClick={onReply}
              className="flex items-center gap-2 px-4 py-2 text-sm text-outlook-text-secondary hover:text-outlook-text-primary border border-outlook-border rounded hover:bg-outlook-bg-hover transition-colors"
            >
              <Reply size={14} />
              Répondre
            </button>
            <button
              onClick={onForward}
              className="flex items-center gap-2 px-4 py-2 text-sm text-outlook-text-secondary hover:text-outlook-text-primary border border-outlook-border rounded hover:bg-outlook-bg-hover transition-colors"
            >
              <Forward size={14} />
              Transférer
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {activeAttachmentMenuIndex !== null && (
          <div className="fixed inset-0 z-20" onClick={() => setActiveAttachmentMenuIndex(null)} />
        )}
        {previewAttachment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/85"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeAttachmentPreview();
              }
            }}
          >
            <div className="h-full w-full flex flex-col">
              <div className="h-14 px-4 border-b border-white/20 text-white flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{previewAttachment.name}</p>
                  <p className="text-xs text-white/70 truncate">{previewAttachment.contentType}</p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={previewAttachment.url}
                    download={previewAttachment.name}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/15 hover:bg-white/25 text-xs"
                  >
                    <Download size={13} />
                    Télécharger
                  </a>
                  <button
                    onClick={closeAttachmentPreview}
                    className="p-2 rounded hover:bg-white/15"
                    aria-label="Fermer l'aperçu"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 p-3">
                {previewLoadingName ? (
                  <div className="h-full w-full flex items-center justify-center text-white text-sm">
                    Ouverture de {previewLoadingName}...
                  </div>
                ) : previewAttachment.renderMode === 'image' && previewAttachment.url ? (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    onClick={closeAttachmentPreview}
                  >
                    <img
                      src={previewAttachment.url}
                      alt={previewAttachment.name}
                      className="w-full h-full object-contain"
                      onClick={(event) => event.stopPropagation()}
                    />
                  </div>
                ) : previewAttachment.renderMode === 'html' && previewAttachment.html ? (
                  <div className="w-full h-full overflow-auto rounded border border-white/15 bg-white p-4">
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: previewAttachment.html }}
                    />
                  </div>
                ) : previewAttachment.renderMode === 'iframe' && previewAttachment.url ? (
                  <iframe
                    src={previewAttachment.url}
                    title={previewAttachment.name}
                    className="w-full h-full rounded border border-white/15 bg-white"
                  />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center text-white gap-3">
                    <p className="text-sm text-white/90">{previewAttachment.error || 'Aperçu non disponible'}</p>
                    {previewAttachment.url && (
                      <a
                        href={previewAttachment.url}
                        download={previewAttachment.name}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/15 hover:bg-white/25 text-xs"
                      >
                        <Download size={13} />
                        Télécharger le fichier
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionButton({
  icon: Icon, label, onClick, danger, active,
}: {
  icon: any; label: string; onClick: () => void; danger?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors
        ${danger ? 'hover:bg-red-50 hover:text-outlook-danger' : 
          active ? 'text-outlook-warning bg-amber-50' :
          'hover:bg-outlook-bg-hover text-outlook-text-secondary hover:text-outlook-text-primary'}`}
      title={label}
    >
      <Icon size={14} />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function getInitials(name?: string, email?: string) {
  if (name) return name.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();
  return (email || '?')[0].toUpperCase();
}

function getAvatarColor(name?: string, email?: string) {
  const str = name || email || '';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#0078D4', '#107C10', '#D13438', '#FFB900', '#8764B8', '#00B7C3', '#E3008C', '#4F6BED'];
  return colors[Math.abs(hash) % colors.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// SecurityBanner — renders the PGP/S/MIME status of the currently displayed
// message. The colour and icon reflect the verdict (verified, encrypted,
// locked, invalid). Hidden when the verdict is `plain`.
// ─────────────────────────────────────────────────────────────────────────────
function SecurityBanner({ verdict }: { verdict: SecurityVerdict }) {
  if (verdict.kind === 'plain') return null;

  let tone = 'bg-emerald-50 border-emerald-200 text-emerald-900';
  let Icon: any = ShieldCheck;
  let title = '';
  let subtitle = '';

  switch (verdict.kind) {
    case 'pgp-signed':
      if (verdict.valid) {
        title = 'Message signé OpenPGP — signature vérifiée';
        subtitle = verdict.signerKeyId ? `Clé signataire : ${verdict.signerKeyId}` : '';
      } else {
        tone = 'bg-amber-50 border-amber-200 text-amber-900';
        Icon = ShieldAlert;
        title = 'Message signé OpenPGP — signature invalide ou non vérifiée';
        subtitle = 'La clé publique du signataire n\'est pas dans votre trousseau.';
      }
      break;
    case 'pgp-encrypted':
      Icon = Lock;
      title = 'Message déchiffré (OpenPGP)';
      if (verdict.signedValid === true) subtitle = `Signature vérifiée · ${verdict.signerKeyId || ''}`;
      else if (verdict.signedValid === false) {
        tone = 'bg-amber-50 border-amber-200 text-amber-900';
        Icon = ShieldAlert;
        subtitle = 'Déchiffré, mais la signature n\'a pas pu être vérifiée.';
      } else subtitle = 'Message non signé';
      break;
    case 'pgp-encrypted-locked':
      tone = 'bg-blue-50 border-blue-200 text-blue-900';
      Icon = KeyRound;
      title = 'Message chiffré OpenPGP';
      subtitle = 'Déverrouillez votre clé privée dans Sécurité → OpenPGP pour lire ce message.';
      break;
    case 'pgp-encrypted-error':
      tone = 'bg-red-50 border-red-200 text-red-900';
      Icon = ShieldX;
      title = 'Échec du déchiffrement OpenPGP';
      subtitle = verdict.message;
      break;
  }

  return (
    <div className={`mb-4 flex items-start gap-2 px-3 py-2 border rounded ${tone}`}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <div className="text-xs">
        <div className="font-semibold">{title}</div>
        {subtitle && <div className="opacity-80 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}
