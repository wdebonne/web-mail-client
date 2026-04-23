import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, Trash2, Link2, Copy, Globe, X, Mail, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';
import type { Calendar } from '../../types';

/**
 * Full-featured calendar share dialog.
 *
 * Supports:
 *  - Internal share (another app user — propagates to NextCloud if both provisioned)
 *  - External share by email (NextCloud sends an invite)
 *  - Public read-only link (publish via NextCloud calendarserver extension)
 */
export default function ShareCalendarDialog({
  calendar,
  onClose,
}: {
  calendar: Calendar;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');

  const { data: shares, refetch } = useQuery({
    queryKey: ['calendar-shares', calendar.id],
    queryFn: () => api.listCalendarShares(calendar.id),
  });

  const shareMutation = useMutation({
    mutationFn: (payload: { userId?: string; email?: string; permission: 'read' | 'write' }) =>
      api.shareCalendar(calendar.id, payload),
    onSuccess: () => {
      toast.success('Calendrier partagé');
      setTarget('');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (payload: { userId?: string; email?: string }) => api.revokeShareCalendar(calendar.id, payload),
    onSuccess: () => { toast.success('Partage révoqué'); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.publishCalendar(calendar.id),
    onSuccess: (r: any) => {
      toast.success('Lien public créé');
      if (r?.publicUrl) navigator.clipboard?.writeText(r.publicUrl).catch(() => {});
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unpublishMutation = useMutation({
    mutationFn: () => api.unpublishCalendar(calendar.id),
    onSuccess: () => { toast.success('Lien public supprimé'); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const submit = () => {
    const isEmail = target.includes('@');
    shareMutation.mutate(
      isEmail ? { email: target, permission } : { userId: target, permission }
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const publicLink = shares?.external?.find((s: any) => s.share_type === 'public_link');

  const ncManaged = Boolean((calendar as any).nc_managed);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-outlook-border">
          <h3 className="font-semibold flex items-center gap-2">
            <Share2 size={18} className="text-outlook-blue" />
            Partager « {calendar.name} »
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Add share */}
          <section>
            <h4 className="text-xs font-semibold text-outlook-text-secondary mb-2 flex items-center gap-1">
              <UserPlus size={14} /> AJOUTER UN PARTAGE
            </h4>
            <div className="flex gap-2 items-start">
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="Email ou ID utilisateur"
                className="flex-1 border border-outlook-border rounded-md px-3 py-2 text-sm"
              />
              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'read' | 'write')}
                className="border border-outlook-border rounded-md px-2 py-2 text-sm"
              >
                <option value="read">Lecture</option>
                <option value="write">Lecture/écriture</option>
              </select>
              <button
                onClick={submit}
                disabled={!target || shareMutation.isPending}
                className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
              >
                Partager
              </button>
            </div>
            {!ncManaged && (
              <p className="text-[11px] text-amber-600 mt-1">
                Ce calendrier n'est pas NextCloud : le partage reste local (pas d'invitation par email envoyée).
              </p>
            )}
          </section>

          {/* Current internal shares */}
          <section>
            <h4 className="text-xs font-semibold text-outlook-text-secondary mb-2">PARTAGES INTERNES</h4>
            <div className="border border-outlook-border rounded divide-y">
              {(shares?.internal || []).map((s: any) => (
                <div key={s.user_id} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.display_name || s.email}</div>
                    <div className="text-xs text-outlook-text-secondary truncate">{s.email}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{s.permission === 'write' ? 'R/W' : 'R'}</span>
                  <button
                    onClick={() => revokeMutation.mutate({ userId: s.user_id })}
                    className="p-1 hover:bg-red-50 rounded text-red-600"
                    title="Révoquer"
                  ><Trash2 size={14} /></button>
                </div>
              ))}
              {(!shares?.internal || shares.internal.length === 0) && (
                <div className="px-3 py-4 text-center text-xs text-outlook-text-secondary">Aucun partage interne</div>
              )}
            </div>
          </section>

          {/* External shares */}
          <section>
            <h4 className="text-xs font-semibold text-outlook-text-secondary mb-2 flex items-center gap-1">
              <Mail size={14} /> INVITATIONS PAR EMAIL
            </h4>
            <div className="border border-outlook-border rounded divide-y">
              {(shares?.external || []).filter((s: any) => s.share_type === 'email').map((s: any) => (
                <div key={s.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <div className="flex-1 truncate">{s.recipient_email}</div>
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{s.permission === 'write' ? 'R/W' : 'R'}</span>
                  <button
                    onClick={() => revokeMutation.mutate({ email: s.recipient_email })}
                    className="p-1 hover:bg-red-50 rounded text-red-600"
                    title="Révoquer"
                  ><Trash2 size={14} /></button>
                </div>
              ))}
              {!(shares?.external || []).some((s: any) => s.share_type === 'email') && (
                <div className="px-3 py-4 text-center text-xs text-outlook-text-secondary">Aucune invitation par email</div>
              )}
            </div>
          </section>

          {/* Public link */}
          <section>
            <h4 className="text-xs font-semibold text-outlook-text-secondary mb-2 flex items-center gap-1">
              <Globe size={14} /> LIEN PUBLIC (LECTURE SEULE)
            </h4>
            {publicLink ? (
              <div className="border border-outlook-border rounded p-3 flex items-center gap-2">
                <Link2 size={14} className="text-outlook-blue" />
                <input
                  type="text"
                  readOnly
                  value={publicLink.public_url || ''}
                  className="flex-1 text-xs bg-gray-50 border border-outlook-border rounded px-2 py-1 font-mono"
                />
                <button
                  onClick={() => { navigator.clipboard?.writeText(publicLink.public_url || ''); toast.success('Lien copié'); }}
                  className="p-1 hover:bg-gray-100 rounded" title="Copier"
                ><Copy size={14} /></button>
                <button
                  onClick={() => confirm('Supprimer le lien public ?') && unpublishMutation.mutate()}
                  className="p-1 hover:bg-red-50 rounded text-red-600" title="Supprimer"
                ><Trash2 size={14} /></button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 border border-dashed border-outlook-border rounded p-3">
                <span className="text-xs text-outlook-text-secondary">
                  {ncManaged ? 'Publier ce calendrier en lecture seule via un lien accessible publiquement.' : 'Disponible uniquement pour les calendriers NextCloud.'}
                </span>
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={!ncManaged || publishMutation.isPending}
                  className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-xs disabled:opacity-50"
                >
                  Publier
                </button>
              </div>
            )}
          </section>
        </div>

        <div className="px-5 py-3 border-t border-outlook-border flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm rounded hover:bg-gray-100">Fermer</button>
        </div>
      </div>
    </div>
  );
}
