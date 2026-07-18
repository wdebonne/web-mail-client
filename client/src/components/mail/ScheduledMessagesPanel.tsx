import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, X, Loader2, AlertTriangle, CheckCircle2, Ban, PencilLine,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import { useMailStore } from '../../stores/mailStore';

/**
 * « Messages programmés » — entrée du volet des dossiers + modal de gestion.
 *
 * L'entrée (ScheduledMessagesEntry) n'apparaît que s'il existe au moins un
 * message programmé actif (en attente, en cours d'envoi ou en erreur) pour ne
 * pas encombrer le volet. Le modal liste les envois différés, permet de les
 * annuler, et « Annuler et modifier » rouvre la composition avec le contenu.
 */

interface ScheduledMessage {
  id: string;
  account_id: string;
  to_addresses: Array<{ email: string; name?: string }>;
  subject: string;
  scheduled_at: string;
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'error';
  error: string | null;
  attempts: number;
  sent_at: string | null;
  account_email: string;
  account_name: string;
}

function fmt(date: string) {
  return new Date(date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusBadge({ status }: { status: ScheduledMessage['status'] }) {
  const cfg: Record<ScheduledMessage['status'], { label: string; icon: any; cls: string }> = {
    scheduled: { label: 'Programmé', icon: Clock,        cls: 'bg-blue-100 text-blue-700' },
    sending:   { label: 'Envoi…',    icon: Loader2,      cls: 'bg-yellow-100 text-yellow-700' },
    sent:      { label: 'Envoyé',    icon: CheckCircle2, cls: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Annulé',    icon: Ban,          cls: 'bg-gray-100 text-gray-500' },
    error:     { label: 'Erreur',    icon: AlertTriangle, cls: 'bg-red-100 text-red-700' },
  };
  const { label, icon: Icon, cls } = cfg[status] ?? cfg.cancelled;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <Icon size={10} className={status === 'sending' ? 'animate-spin' : ''} />
      {label}
    </span>
  );
}

function ScheduledMessagesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const openCompose = useMailStore((s) => s.openCompose);

  const { data: messages = [], isLoading } = useQuery<ScheduledMessage[]>({
    queryKey: ['scheduled-messages'],
    queryFn: () => api.getScheduledMessages(),
    refetchInterval: 15000,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.cancelScheduledMessage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
      toast.success('Envoi annulé');
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
      toast.error(e?.message || 'Trop tard : le message est déjà parti');
    },
  });

  const handleCancelAndEdit = async (id: string) => {
    try {
      const res = await api.cancelScheduledMessage(id);
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
      const m = res.message;
      onClose();
      openCompose({
        accountId: m.accountId,
        to: (m.to || []).map((r: any) => ({ address: r.email || r.address, name: r.name })),
        cc: (m.cc || []).map((r: any) => ({ address: r.email || r.address, name: r.name })),
        bcc: (m.bcc || []).map((r: any) => ({ address: r.email || r.address, name: r.name })),
        subject: m.subject || '',
        bodyHtml: m.bodyHtml || '',
        inReplyTo: m.inReplyTo || undefined,
        references: m.references || undefined,
        inReplyToUid: m.inReplyToUid || undefined,
        inReplyToFolder: m.inReplyToFolder || undefined,
      });
      if (m.attachments?.length) {
        toast('Les pièces jointes n\'ont pas été restaurées — rajoutez-les avant de renvoyer', { icon: '⚠️' });
      }
    } catch (e: any) {
      qc.invalidateQueries({ queryKey: ['scheduled-messages'] });
      toast.error(e?.message || 'Trop tard : le message est déjà parti');
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outlook-border">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Clock size={17} className="text-outlook-blue" /> Messages programmés
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
              <Clock size={24} />
              <p className="text-sm">Aucun message programmé</p>
              <p className="text-xs text-gray-300">Utilisez la flèche du bouton « Envoyer » pour différer un envoi</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {messages.map((m) => (
                <div key={m.id} className="px-5 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900 truncate">
                          {m.subject || '(sans objet)'}
                        </span>
                        <StatusBadge status={m.status} />
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        À : {(m.to_addresses || []).map((r) => r.name || r.email).join(', ')}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {m.status === 'sent' && m.sent_at
                          ? `Envoyé le ${fmt(m.sent_at)}`
                          : `Envoi prévu le ${fmt(m.scheduled_at)}`}
                        {' · '}{m.account_email}
                      </p>
                      {m.error && (
                        <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
                          <AlertTriangle size={11} /> {m.error}
                        </p>
                      )}
                    </div>
                    {(m.status === 'scheduled' || m.status === 'error') && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleCancelAndEdit(m.id)}
                          className="p-1.5 text-outlook-blue hover:bg-blue-50 rounded"
                          title={m.status === 'error' ? 'Reprendre dans une nouvelle composition' : 'Annuler et modifier'}
                        >
                          <PencilLine size={15} />
                        </button>
                        <button
                          onClick={() => cancelMut.mutate(m.id)}
                          disabled={cancelMut.isPending}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title={m.status === 'error' ? 'Abandonner ce message' : "Annuler l'envoi"}
                        >
                          <Ban size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Entrée compacte pour le volet des dossiers. Rendue uniquement quand il y a
 * des messages programmés actifs (en attente / envoi / erreur).
 */
export function ScheduledMessagesEntry() {
  const [open, setOpen] = useState(false);

  const { data: messages = [] } = useQuery<ScheduledMessage[]>({
    queryKey: ['scheduled-messages'],
    queryFn: () => api.getScheduledMessages(),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const active = messages.filter((m) => ['scheduled', 'sending', 'error'].includes(m.status));
  if (active.length === 0) return null;

  const hasError = active.some((m) => m.status === 'error');

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-1.5 mb-1 text-left rounded hover:bg-outlook-bg-hover text-outlook-text-primary"
        title="Messages programmés"
      >
        <Clock size={15} className={hasError ? 'text-red-500' : 'text-outlook-blue'} />
        <span className="flex-1 truncate">Programmés</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${hasError ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
          {active.length}
        </span>
      </button>
      {open && <ScheduledMessagesModal onClose={() => setOpen(false)} />}
    </>
  );
}
