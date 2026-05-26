import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, Search, X, RefreshCw, Settings2, ChevronDown, ChevronUp,
  Loader2, CheckCircle2, XCircle, PauseCircle, Clock, Play,
  Ban, AlertTriangle, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';

// ─── Types ────────────────────────────────────────────────────────────────────

type JobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';

interface BulkJob {
  id: string;
  name: string;
  status: JobStatus;
  source: string;
  total: number;
  sent: number;
  errors: number;
  created_at: string;
  completed_at: string | null;
  account_name: string;
  account_email: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg: Record<JobStatus, { label: string; icon: any; cls: string }> = {
    pending:   { label: 'En attente',  icon: Clock,        cls: 'bg-yellow-100 text-yellow-700' },
    running:   { label: 'En cours',    icon: Loader2,      cls: 'bg-blue-100 text-blue-700' },
    paused:    { label: 'En pause',    icon: PauseCircle,  cls: 'bg-orange-100 text-orange-700' },
    completed: { label: 'Terminé',     icon: CheckCircle2, cls: 'bg-green-100 text-green-700' },
    cancelled: { label: 'Annulé',      icon: Ban,          cls: 'bg-gray-100 text-gray-500' },
  };
  const { label, icon: Icon, cls } = cfg[status] ?? cfg.cancelled;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {label}
    </span>
  );
}

function ProgressBar({ sent, errors, total }: { sent: number; errors: number; total: number }) {
  if (total === 0) return null;
  const sentPct = Math.round((sent / total) * 100);
  const errPct = Math.round((errors / total) * 100);
  return (
    <div className="mt-1">
      <div className="flex h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="bg-green-500 transition-all" style={{ width: `${sentPct}%` }} />
        <div className="bg-red-400 transition-all" style={{ width: `${errPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>{sent} envoyé{sent > 1 ? 's' : ''}{errors > 0 ? `, ${errors} erreur${errors > 1 ? 's' : ''}` : ''}</span>
        <span>{total} total</span>
      </div>
    </div>
  );
}

function fmt(date: string) {
  return new Date(date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── User settings modal ─────────────────────────────────────────────────────

function UserSettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['bulk-send-settings'],
    queryFn: () => api.getBulkSendSettings(),
  });

  const [rateLimit, setRateLimit] = useState<string>('');
  const [rateWindow, setRateWindow] = useState<string>('');

  const initialized = settings !== undefined;
  const displayRateLimit = rateLimit !== '' ? rateLimit : String(settings?.rateLimit ?? '');
  const displayRateWindow = rateWindow !== '' ? rateWindow : String(settings?.rateWindowMinutes ?? '');

  const saveMut = useMutation({
    mutationFn: () => api.updateBulkSendSettings({
      rateLimit: rateLimit !== '' ? parseInt(rateLimit) || null : settings?.rateLimit ?? null,
      rateWindowMinutes: rateWindow !== '' ? parseInt(rateWindow) || null : settings?.rateWindowMinutes ?? null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk-send-settings'] });
      toast.success('Paramètres sauvegardés');
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const resetMut = useMutation({
    mutationFn: () => api.updateBulkSendSettings({ rateLimit: null, rateWindowMinutes: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk-send-settings'] });
      toast.success('Paramètres réinitialisés aux valeurs par défaut');
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!initialized) return null;

  const admin = settings!.adminDefaults;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Settings2 size={18} /> Débit d'envoi</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-4 text-sm text-blue-700">
          Valeurs actuelles : <strong>{settings!.effectiveRateLimit} mails</strong> toutes les <strong>{settings!.effectiveRateWindow} min</strong>
          {settings?.rateLimit == null && ' (valeurs par défaut)'}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Mails max par fenêtre
            </label>
            <input
              type="number"
              min={1}
              max={admin.maxRateLimit}
              value={displayRateLimit}
              onChange={e => setRateLimit(e.target.value)}
              placeholder={`Défaut: ${admin.defaultRateLimit}`}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-0.5">Max: {admin.maxRateLimit}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Durée de la fenêtre (min)
            </label>
            <input
              type="number"
              min={admin.minRateWindow}
              max={60}
              value={displayRateWindow}
              onChange={e => setRateWindow(e.target.value)}
              placeholder={`Défaut: ${admin.defaultRateWindow}`}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-0.5">Min: {admin.minRateWindow} min</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {saveMut.isPending && <Loader2 size={13} className="animate-spin" />}
            Sauvegarder
          </button>
          <button
            onClick={() => resetMut.mutate()}
            disabled={resetMut.isPending}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60"
            title="Réinitialiser aux valeurs par défaut admin"
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Job detail panel ─────────────────────────────────────────────────────────

function JobDetailPanel({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['bulk-send-job-detail', jobId, search, statusFilter, page],
    queryFn: () => api.getBulkSendJob(jobId, { search: search || undefined, status: statusFilter || undefined, page }),
    refetchInterval: 10000,
  });

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Filtrer par email…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none"
        >
          <option value="">Tous</option>
          <option value="pending">En attente</option>
          <option value="sent">Envoyé</option>
          <option value="error">Erreur</option>
          <option value="cancelled">Annulé</option>
        </select>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={15} /></button>
      </div>

      {isLoading ? (
        <div className="text-center py-4 text-gray-400"><Loader2 size={18} className="animate-spin mx-auto" /></div>
      ) : (
        <div className="overflow-auto max-h-48 rounded border border-gray-200 bg-white text-xs">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500">Email</th>
                <th className="px-3 py-2 text-left text-gray-500">Objet</th>
                <th className="px-3 py-2 text-left text-gray-500">Statut</th>
                <th className="px-3 py-2 text-left text-gray-500">Essais</th>
                <th className="px-3 py-2 text-left text-gray-500">Envoyé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!data?.recipients?.length ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Aucun destinataire</td></tr>
              ) : data.recipients.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-gray-700">{r.display_name ? `${r.display_name} <${r.email}>` : r.email}</td>
                  <td className="px-3 py-1.5 text-gray-500 max-w-[180px] truncate" title={r.subject}>{r.subject}</td>
                  <td className="px-3 py-1.5">
                    <StatusBadge status={r.status} />
                    {r.error && (
                      <span className="ml-1 text-red-400" title={r.error}><AlertTriangle size={11} className="inline" /></span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">{r.attempts}</td>
                  <td className="px-3 py-1.5 text-gray-400">{r.sent_at ? fmt(r.sent_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 50 && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400">{data.total} destinataires</span>
          <div className="flex gap-1.5">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">‹</button>
            <span className="px-2 py-1 text-xs">p.{page}</span>
            <button disabled={page >= Math.ceil(data.total / 50)} onClick={() => setPage(p => p + 1)} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BulkSendQueuePanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['bulk-send-jobs', search, statusFilter, page],
    queryFn: () => api.getBulkSendJobs({ search: search || undefined, status: statusFilter || undefined, page, limit: 20 }),
    refetchInterval: 15000,
  });

  const pauseMut = useMutation({
    mutationFn: (id: string) => api.pauseBulkSendJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bulk-send-jobs'] }); toast.success('Job mis en pause'); },
    onError: (err: any) => toast.error(err.message),
  });
  const resumeMut = useMutation({
    mutationFn: (id: string) => api.resumeBulkSendJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bulk-send-jobs'] }); toast.success('Job relancé'); },
    onError: (err: any) => toast.error(err.message),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => api.cancelBulkSendJob(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bulk-send-jobs'] }); toast.success('Job annulé'); },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSearch = useCallback((v: string) => { setSearch(v); setPage(1); }, []);
  const handleStatus = useCallback((v: string) => { setStatusFilter(v); setPage(1); }, []);

  const activeCount = data?.jobs.filter((j: BulkJob) => ['pending', 'running', 'paused'].includes(j.status)).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <Send size={16} className="text-blue-600" />
          <span className="font-semibold text-gray-800 text-sm">File d'envoi en masse</span>
          {activeCount > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
              {activeCount} actif{activeCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => refetch()} className="p-1.5 text-gray-400 hover:text-gray-600 rounded" title="Rafraîchir">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:text-gray-800 border border-gray-200 rounded hover:bg-gray-50"
          >
            <Settings2 size={13} /> Débit
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 py-2 border-b border-gray-100 bg-white">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Rechercher une campagne…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && <button onClick={() => handleSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={12} /></button>}
        </div>
        <select
          value={statusFilter}
          onChange={e => handleStatus(e.target.value)}
          className="border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none"
        >
          <option value="">Tous</option>
          <option value="pending">En attente</option>
          <option value="running">En cours</option>
          <option value="paused">En pause</option>
          <option value="completed">Terminé</option>
          <option value="cancelled">Annulé</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : !data?.jobs.length ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
            <Mail size={24} />
            <p className="text-sm">Aucune campagne d'envoi</p>
            <p className="text-xs text-gray-300">Utilisez "Envoyer (file)" depuis une composition</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.jobs.map((job: BulkJob) => (
              <div key={job.id} className="bg-white">
                <div className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                        >
                          {expandedJob === job.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <span className="font-medium text-sm text-gray-900 truncate">{job.name}</span>
                        <StatusBadge status={job.status} />
                      </div>
                      <p className="text-xs text-gray-400 ml-5">{job.account_email} · {fmt(job.created_at)}</p>
                      <div className="ml-5 mt-1.5">
                        <ProgressBar sent={job.sent} errors={job.errors} total={job.total} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {job.status === 'running' || job.status === 'pending' ? (
                        <button
                          onClick={() => pauseMut.mutate(job.id)}
                          disabled={pauseMut.isPending}
                          className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded"
                          title="Mettre en pause"
                        >
                          <PauseCircle size={15} />
                        </button>
                      ) : job.status === 'paused' ? (
                        <button
                          onClick={() => resumeMut.mutate(job.id)}
                          disabled={resumeMut.isPending}
                          className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
                          title="Reprendre"
                        >
                          <Play size={15} />
                        </button>
                      ) : null}
                      {!['completed', 'cancelled'].includes(job.status) && (
                        <button
                          onClick={() => { if (confirm(`Annuler la campagne "${job.name}" ?`)) cancelMut.mutate(job.id); }}
                          disabled={cancelMut.isPending}
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Annuler"
                        >
                          <XCircle size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {expandedJob === job.id && (
                  <JobDetailPanel jobId={job.id} onClose={() => setExpandedJob(null)} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-white text-xs text-gray-500">
          <span>{data.total} campagnes</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40">‹</button>
            <span className="px-2 py-1">{page}/{Math.ceil(data.total / 20)}</span>
            <button disabled={page >= Math.ceil(data.total / 20)} onClick={() => setPage(p => p + 1)} className="px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40">›</button>
          </div>
        </div>
      )}
    </div>
  );
}
