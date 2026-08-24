import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, ShieldAlert, X, Loader2 } from 'lucide-react';

export interface BlockSenderDialogProps {
  open: boolean;
  /** Adresse de l'expéditeur à bloquer. */
  address: string;
  /** Nom affiché de l'expéditeur, quand il est connu. */
  displayName?: string;
  /** Nombre de messages du même expéditeur visibles dans la liste courante. */
  knownCount?: number;
  busy?: boolean;
  onConfirm: (choice: { scope: 'address' | 'domain'; sweep: boolean }) => void;
  onCancel: () => void;
}

/**
 * Confirmation du blocage d'un expéditeur.
 *
 * Deux décisions seulement, formulées sans jargon : bloquer *cette personne*
 * ou *tout le domaine*, et faut-il aussi ranger les messages déjà reçus. Le
 * reste (liste, moteur, dossier de destination) est invisible pour
 * l'utilisateur — c'est tout l'objet de cette fonctionnalité.
 */
export default function BlockSenderDialog({
  open, address, displayName, knownCount = 0, busy = false, onConfirm, onCancel,
}: BlockSenderDialogProps) {
  const [scope, setScope] = useState<'address' | 'domain'>('address');
  const [sweep, setSweep] = useState(true);

  useEffect(() => {
    if (!open) return;
    setScope('address');
    setSweep(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const domain = address.includes('@') ? address.slice(address.lastIndexOf('@') + 1) : '';

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
      onClick={busy ? undefined : onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outlook-border">
          <h3 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
            <Ban size={15} className="text-red-600" />
            Bloquer cet expéditeur
          </h3>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary disabled:opacity-40"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-sm text-outlook-text-secondary">
            Ses prochains messages iront directement dans <strong>Courrier indésirable</strong>,
            sans passer par votre boîte de réception.
          </p>

          <div className="space-y-2">
            <label
              className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors
                ${scope === 'address' ? 'border-outlook-blue bg-blue-50' : 'border-outlook-border hover:bg-outlook-bg-hover'}`}
            >
              <input
                type="radio"
                name="block-scope"
                checked={scope === 'address'}
                onChange={() => setScope('address')}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm text-outlook-text-primary font-medium">
                  Cet expéditeur uniquement
                </span>
                <span className="block text-xs text-outlook-text-secondary truncate" title={address}>
                  {displayName ? `${displayName} — ` : ''}{address}
                </span>
              </span>
            </label>

            {domain && (
              <label
                className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors
                  ${scope === 'domain' ? 'border-outlook-blue bg-blue-50' : 'border-outlook-border hover:bg-outlook-bg-hover'}`}
              >
                <input
                  type="radio"
                  name="block-scope"
                  checked={scope === 'domain'}
                  onChange={() => setScope('domain')}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm text-outlook-text-primary font-medium">
                    Tout le domaine <span className="font-mono">@{domain}</span>
                  </span>
                  <span className="block text-xs text-outlook-text-secondary">
                    Toutes les adresses se terminant par @{domain}.
                  </span>
                </span>
              </label>
            )}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={sweep}
              onChange={(e) => setSweep(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm text-outlook-text-primary">
              Déplacer aussi les messages déjà reçus
              {knownCount > 1 && (
                <span className="text-outlook-text-secondary"> ({knownCount} visibles dans ce dossier)</span>
              )}
            </span>
          </label>

          {scope === 'domain' && (
            <div className="flex items-start gap-2 p-2.5 rounded bg-amber-50 border border-amber-200">
              <ShieldAlert size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Bloquer un domaine entier est radical : si @{domain} est un fournisseur grand public
                (gmail.com, orange.fr…), vous n'y recevrez plus rien.
              </p>
            </div>
          )}

          <p className="text-xs text-outlook-text-secondary">
            Réversible à tout moment : ouvrez un de ses messages dans Courrier indésirable et
            cliquez sur « Ce n'est pas indésirable ».
          </p>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-outlook-border">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded text-outlook-text-secondary hover:bg-outlook-bg-hover disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            onClick={() => onConfirm({ scope, sweep })}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Bloquer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
