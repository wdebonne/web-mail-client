import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send, Search, X, RefreshCw, Settings2, ChevronDown, ChevronUp,
  Loader2, CheckCircle2, XCircle, PauseCircle, Clock, Ban,
  BarChart3, Users, Mail, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BulkJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';
  source: string;
  total: number;
  sent: number;
  errors: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  account_name: string;
  account_email: string;
  user_email: string;
  user_display_name: string | null;
}

interface AdminSettings {
  defaultRateLimit: number;
  defaultRateWindow: number;
  maxRateLimit: number;
  minRateWindow: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: BulkJob['status'] }) {
  const cfg: Record<BulkJob['status'], { label: string; icon: any; cls: string }> = {
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
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${sentPct}%` }} />
        <div className="bg-red-400 h-full transition-all" style={{ width: `${errPct}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
        {sent}/{total}
      </span>
    </div>
  );
}

function fmt(date: string) {
  return new Date(date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['admin-bulk-send-settings'],
    queryFn: () => api.adminGetBulkSendSettings(),
  });

  const [form, setForm] = useState<AdminSettings | null>(null);
  const current = form ?? settings;

  const saveMut = useMutation({
    mutationFn: (data: AdminSettings) => api.adminUpdateBulkSendSettings(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bulk-send-settings'] });
      toast.success('Paramètres sauvegardés');
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!current) return <div className="p-6 text-gray-400 text-sm">Chargement…</div>;

  return (
    <div className="border border-gray-200 rounded-lg p-5 mb-5 bg-gray-50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Settings2 size={16} /> Paramètres de débit par défaut
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        {[
          { label: 'Mails par défaut / fenêtre', key: 'defaultRateLimit', min: 1, max: 10000, hint: 'Nombre max de mails envoyés par fenêtre de temps' },
          { label: 'Fenêtre par défaut (min)', key: 'defaultRateWindow', min: 1, max: 1440, hint: 'Durée de la fenêtre de temps en minutes' },
          { label: 'Limite max utilisateur', key: 'maxRateLimit', min: 1, max: 10000, hint: 'Plafond que les utilisateurs ne peuvent pas dépasser' },
          { label: 'Fenêtre min utilisateur (min)', key: 'minRateWindow', min: 1, max: 60, hint: 'Fenêtre minimale qu\'un utilisateur peut configurer' },
        ].map(({ label, key, min, max, hint }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
            <input
              type="number" min={min} max={max}
              value={(current as any)[key]}
              onChange={e => setForm({ ...(current as AdminSettings), [key]: parseInt(e.target.value) || min })}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => saveMut.mutate(current as AdminSettings)}
          disabled={saveMut.isPending}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1"
        >
          {saveMut.isPending && <Loader2 size={13} className="animate-spin" />}
          Sauvegarder
        </button>
        <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminBulkSend() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-bulk-send-stats'],
    queryFn: () => api.adminGetBulkSendStats(),
    refetchInterval: 15000,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-bulk-send-jobs', search, statusFilter, page],
    queryFn: () => api.adminGetBulkSendJobs({ search: search || undefined, status: statusFilter || undefined, page, limit: 30 }),
    refetchInterval: 15000,
  });

  // Detail for expanded job (recipients)
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientStatus, setRecipientStatus] = useState('');
  const { data: jobDetail } = useQuery({
    queryKey: ['admin-bulk-send-job-detail', expandedJob, recipientSearch, recipientStatus],
    queryFn: () => expandedJob ? api.getBulkSendJob(expandedJob, { search: recipientSearch || undefined, status: recipientStatus || undefined }) : null,
    enabled: !!expandedJob,
    refetchInterval: expandedJob ? 10000 : false,
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.adminCancelBulkSendJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bulk-send-jobs'] });
      qc.invalidateQueries({ queryKey: ['admin-bulk-send-stats'] });
      toast.success('Job annulé');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSearch = useCallback((v: string) => { setSearch(v); setPage(1); }, []);
  const handleStatus = useCallback((v: string) => { setStatusFilter(v); setPage(1); }, []);

  const statCards = [
    { label: 'En attente', value: stats?.pending ?? '—', icon: Clock, color: 'text-yellow-600' },
    { label: 'En cours', value: stats?.running ?? '—', icon: Send, color: 'text-blue-600' },
    { label: 'En pause', value: stats?.paused ?? '—', icon: PauseCircle, color: 'text-orange-600' },
    { label: 'Envoyés (total)', value: stats?.total_sent ?? '—', icon: Mail, color: 'text-green-600' },
    { label: 'Erreurs (total)', value: stats?.total_errors ?? '—', icon: AlertTriangle, color: 'text-red-600' },
  ];

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Send size={20} /> File d'envoi en masse
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">Suivi et configuration des campagnes d'envoi</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50"
            title="Rafraîchir"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${showSettings ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <Settings2 size={15} /> Paramètres
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-3 flex items-center gap-3">
            <Icon size={20} className={color} />
            <div>
              <div className="text-lg font-bold text-gray-900">{value}</div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Settings panel */}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Rechercher par nom, utilisateur…"
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => handleSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={e => handleStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="running">En cours</option>
          <option value="paused">En pause</option>
          <option value="completed">Terminé</option>
          <option value="cancelled">Annulé</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-6"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campagne</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utilisateur</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progression</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Créé le</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400"><Loader2 size={20} className="animate-spin mx-auto" /></td></tr>
            ) : !data?.jobs.length ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun job trouvé</td></tr>
            ) : data.jobs.map((job: BulkJob) => (
              <>
                <tr key={job.id} className={`hover:bg-gray-50 transition-colors ${expandedJob === job.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {expandedJob === job.id ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{job.name}</div>
                    <div className="text-xs text-gray-400">{job.account_email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700">{job.user_display_name || job.user_email}</div>
                    <div className="text-xs text-gray-400">{job.user_email}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                  <td className="px-4 py-3"><ProgressBar sent={job.sent} errors={job.errors} total={job.total} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmt(job.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {!['completed', 'cancelled'].includes(job.status) && (
                      <button
                        onClick={() => { if (confirm('Annuler ce job ?')) cancelMut.mutate(job.id); }}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                      >
                        Annuler
                      </button>
                    )}
                  </td>
                </tr>
                {expandedJob === job.id && (
                  <tr key={`${job.id}-detail`}>
                    <td colSpan={7} className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                      <div className="mb-3 flex gap-3">
                        <div className="relative flex-1 max-w-xs">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            value={recipientSearch}
                            onChange={e => setRecipientSearch(e.target.value)}
                            placeholder="Filtrer par email…"
                            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <select
                          value={recipientStatus}
                          onChange={e => setRecipientStatus(e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Tous</option>
                          <option value="pending">En attente</option>
                          <option value="sent">Envoyé</option>
                          <option value="error">Erreur</option>
                          <option value="cancelled">Annulé</option>
                        </select>
                      </div>
                      <div className="overflow-auto max-h-64 rounded border border-blue-200 bg-white">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-gray-500">Email</th>
                              <th className="px-3 py-2 text-left text-gray-500">Objet</th>
                              <th className="px-3 py-2 text-left text-gray-500">Statut</th>
                              <th className="px-3 py-2 text-left text-gray-500">Tentatives</th>
                              <th className="px-3 py-2 text-left text-gray-500">Envoyé le</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {!jobDetail?.recipients?.length ? (
                              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Aucun destinataire</td></tr>
                            ) : jobDetail.recipients.map((r: any) => (
                              <tr key={r.id} className="hover:bg-gray-50">
                                <td className="px-3 py-1.5 text-gray-700">{r.display_name ? `${r.display_name} <${r.email}>` : r.email}</td>
                                <td className="px-3 py-1.5 text-gray-600 max-w-[200px] truncate" title={r.subject}>{r.subject}</td>
                                <td className="px-3 py-1.5">
                                  <StatusBadge status={r.status} />
                                  {r.error && <span className="ml-1 text-red-400 text-[10px]" title={r.error}>⚠</span>}
                                </td>
                                <td className="px-3 py-1.5 text-gray-500">{r.attempts}</td>
                                <td className="px-3 py-1.5 text-gray-400">{r.sent_at ? fmt(r.sent_at) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {jobDetail && jobDetail.total > 50 && (
                        <p className="text-xs text-gray-400 mt-1">{jobDetail.total} destinataires au total</p>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 30 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>{data.total} jobs</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">Précédent</button>
            <span className="px-3 py-1.5">Page {page} / {Math.ceil(data.total / 30)}</span>
            <button disabled={page >= Math.ceil(data.total / 30)} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40">Suivant</button>
          </div>
        </div>
      )}
    </div>
  );
}
