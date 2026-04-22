import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the primary action is rendered with a destructive (red) style. */
  danger?: boolean;
  /** Optional icon to replace the default warning/trash icon. */
  icon?: 'warning' | 'trash';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Small modal confirmation dialog. Promise-free on purpose: the caller owns
 * the open/close state so it can run async work on confirm and surface errors
 * through the usual toast pipeline.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  icon = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Auto-focus the primary button for quick keyboard confirmation.
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const Icon = icon === 'trash' ? Trash2 : AlertTriangle;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-outlook-border w-[420px] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-outlook-border">
          <div
            className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
              danger ? 'bg-red-50 text-outlook-danger' : 'bg-outlook-blue/10 text-outlook-blue'
            }`}
          >
            <Icon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-outlook-text-primary">{title}</h3>
            {description && (
              <p className="text-xs text-outlook-text-secondary mt-1 leading-relaxed whitespace-pre-line">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-outlook-bg-hover/40">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-outlook-border bg-white hover:bg-outlook-bg-hover text-outlook-text-primary"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            className={`px-3 py-1.5 text-xs rounded text-white font-medium transition-colors ${
              danger
                ? 'bg-outlook-danger hover:bg-red-700'
                : 'bg-outlook-blue hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
