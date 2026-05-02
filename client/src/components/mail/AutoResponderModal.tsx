import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import AutoResponderForm from './AutoResponderForm';
import type { MailAccount } from '../../types';

interface AutoResponderModalProps {
  onClose: () => void;
  accountId?: string;
  accounts: MailAccount[];
}

/**
 * Outlook-style modal that wraps the shared AutoResponderForm. Triggered from
 * the ribbon's "Afficher" tab so users can quickly configure their vacation
 * responder without leaving the mail page.
 */
export default function AutoResponderModal({ onClose, accountId, accounts }: AutoResponderModalProps) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998] bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-responder-title"
        className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          bg-white rounded-lg shadow-xl w-[760px] max-w-[94vw] max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outlook-border">
          <h2 id="auto-responder-title" className="text-lg font-semibold text-outlook-text-primary">
            Réponses automatiques (Répondeur)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-outlook-bg-hover"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AutoResponderForm
            accountId={accountId}
            accounts={accounts}
            onSaved={onClose}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
