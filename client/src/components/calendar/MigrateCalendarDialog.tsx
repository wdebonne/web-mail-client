import { useState } from 'react';
import { X, ArrowRight, AlertTriangle, Cloud, HardDrive, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { Calendar } from '../../types';

interface Props {
  calendar: Calendar;
  target: 'nextcloud' | 'local';
  onConfirm: (deleteRemote: boolean) => Promise<void> | void;
  onClose: () => void;
}

const GAINS_TO_NC = [
  'Synchronisation automatique entre vos appareils',
  'Partage externe via NextCloud (lien public, invitations email)',
  'Sauvegarde côté serveur NextCloud',
  'Compatible avec clients CalDAV tiers (Thunderbird, DAVx⁵…)',
];
const LOSSES_TO_NC = [
  'Les identifiants UID d\'événements sans UID seront générés automatiquement',
  'Si la migration échoue partiellement, certains événements peuvent manquer sur NextCloud',
];

const GAINS_TO_LOCAL = [
  'Calendrier stocké uniquement dans la base locale',
  'Aucune dépendance au serveur NextCloud',
];
const LOSSES_TO_LOCAL = [
  'Plus de synchronisation automatique entre appareils',
  'Perte du partage externe (liens publics, invitations NextCloud)',
  'Plus accessible via clients CalDAV tiers',
  'Vous pouvez choisir de supprimer ou conserver la copie sur NextCloud',
];

export default function MigrateCalendarDialog({ calendar, target, onConfirm, onClose }: Props) {
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [busy, setBusy] = useState(false);

  const isToNc = target === 'nextcloud';
  const gains = isToNc ? GAINS_TO_NC : GAINS_TO_LOCAL;
  const losses = isToNc ? LOSSES_TO_NC : LOSSES_TO_LOCAL;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(deleteRemote);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl bg-white dark:bg-outlook-bg-dark rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border dark:border-outlook-border-dark">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold">
              Migrer « {calendar.name} » {isToNc ? 'vers NextCloud' : 'en local'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-outlook-hover-dark">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="flex flex-col items-center gap-1 text-sm">
              {isToNc ? <HardDrive className="w-8 h-8 text-gray-500" /> : <Cloud className="w-8 h-8 text-blue-500" />}
              <span className="text-xs text-gray-500">{isToNc ? 'Local' : 'NextCloud'}</span>
            </div>
            <ArrowRight className="w-5 h-5 text-gray-400" />
            <div className="flex flex-col items-center gap-1 text-sm">
              {isToNc ? <Cloud className="w-8 h-8 text-blue-500" /> : <HardDrive className="w-8 h-8 text-gray-500" />}
              <span className="text-xs text-gray-500">{isToNc ? 'NextCloud' : 'Local'}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600 dark:text-green-400 mb-1.5">
              <CheckCircle2 className="w-4 h-4" /> Vous gagnez
            </div>
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {gains.map((g, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-green-500">✓</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400 mb-1.5">
              <XCircle className="w-4 h-4" /> À savoir
            </div>
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {losses.map((g, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-red-500">!</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </div>

          {!isToNc && (
            <label className="flex items-start gap-2 p-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={deleteRemote}
                onChange={(e) => setDeleteRemote(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Supprimer le calendrier sur NextCloud</strong> après la migration.
                <br />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  Si décoché, la copie NextCloud est conservée mais n'est plus liée à cette application.
                </span>
              </span>
            </label>
          )}

          {isToNc && (
            <div className="p-3 rounded border border-blue-300 bg-blue-50 dark:bg-blue-950/20 text-sm text-gray-700 dark:text-gray-300">
              Tous les événements du calendrier seront copiés sur NextCloud. Le calendrier local sera alors remplacé
              par sa copie synchronisée.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-outlook-border dark:border-outlook-border-dark">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 rounded border border-outlook-border hover:bg-gray-50 dark:hover:bg-outlook-hover-dark text-sm"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="px-4 py-1.5 rounded bg-outlook-blue text-white hover:bg-outlook-blue/90 text-sm flex items-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Migrer {isToNc ? 'vers NextCloud' : 'en local'}
          </button>
        </div>
      </div>
    </div>
  );
}
