import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import DOMPurify from 'dompurify';
import {
  Reply, ReplyAll, Forward, Trash2, Star, MoreHorizontal,
  Paperclip, Download, Archive, Flag, FolderInput, Eye, X
} from 'lucide-react';
import { Email } from '../../types';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface MessageViewProps {
  message: Email | null;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDelete: () => void;
  onToggleFlag: () => void;
  onMove: (folder: string) => void;
  attachmentMinVisibleKb?: number;
}

export default function MessageView({
  message, onReply, onReplyAll, onForward, onDelete, onToggleFlag, onMove, attachmentMinVisibleKb = 0,
}: MessageViewProps) {
  const [showMore, setShowMore] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; url: string; contentType: string } | null>(null);

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
      {/* Subject bar */}
      <div className="px-6 py-3 border-b border-outlook-border flex-shrink-0">
        <h1 className="text-base font-semibold text-outlook-text-primary truncate">
          {message.subject || '(Sans objet)'}
        </h1>
      </div>

      {/* Message header — sender info left, actions right */}
      <div className="px-6 py-3 border-b border-outlook-border flex-shrink-0">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: getAvatarColor(message.from?.name, message.from?.address) }}
          >
            {getInitials(message.from?.name, message.from?.address)}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-sm text-outlook-text-primary">
                {message.from?.name || message.from?.address || 'Inconnu'}
              </span>
              {message.from?.name && (
                <span className="text-xs text-outlook-text-secondary">
                  &lt;{message.from.address}&gt;
                </span>
              )}
            </div>
            <div className="text-xs text-outlook-text-secondary mt-0.5">
              <span>À : </span>
              {message.to?.map((addr, i) => (
                <span key={i}>
                  {i > 0 && '; '}
                  <span className="text-outlook-blue">{addr.name || addr.address}</span>
                </span>
              ))}
            </div>
            {message.cc && message.cc.length > 0 && (
              <div className="text-xs text-outlook-text-secondary">
                <span>Cc : </span>
                {message.cc.map((addr, i) => (
                  <span key={i}>
                    {i > 0 && '; '}
                    {addr.name || addr.address}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right side: action buttons + date */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
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
                      <button onClick={() => { onMove('Archive'); setShowMore(false); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-outlook-bg-hover flex items-center gap-2">
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
      </div>

      {/* Attachments */}
      {visibleAttachments.length > 0 && (
        <div className="px-6 py-2 border-b border-outlook-border bg-outlook-bg-primary/30 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Paperclip size={14} className="text-outlook-text-secondary" />
            {visibleAttachments.map((att, i) => (
              <button
                key={i}
                onClick={() => {
                  if (att.content) {
                    const blob = new Blob([Uint8Array.from(atob(att.content), c => c.charCodeAt(0))], { type: att.contentType });
                    const url = URL.createObjectURL(blob);
                    if (previewAttachment?.url) {
                      URL.revokeObjectURL(previewAttachment.url);
                    }
                    setPreviewAttachment({
                      name: att.filename,
                      url,
                      contentType: att.contentType || 'application/octet-stream',
                    });
                  }
                }}
                className="flex items-center gap-1.5 bg-white border border-outlook-border rounded px-2 py-1 text-xs hover:bg-outlook-bg-hover transition-colors"
              >
                <Eye size={12} />
                <span className="truncate max-w-32">{att.filename}</span>
                <span className="text-outlook-text-disabled">
                  ({formatFileSize(att.size)})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {sanitizedHtml ? (
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

      <AnimatePresence>
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
                {previewAttachment.contentType.startsWith('image/') ? (
                  <img
                    src={previewAttachment.url}
                    alt={previewAttachment.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <iframe
                    src={previewAttachment.url}
                    title={previewAttachment.name}
                    className="w-full h-full rounded border border-white/15 bg-white"
                  />
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}
