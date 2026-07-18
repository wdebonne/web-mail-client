import { useQuery } from '@tanstack/react-query';
import {
  Activity, Database, HardDrive, Clock, RefreshCw, CheckCircle2,
  AlertTriangle, Send, Loader2, MemoryStick,
} from 'lucide-react';
import { api } from '../../api';

/**
 * Admin > Système > État du système.
 *
 * Complément détaillé du /api/health public (utilisé par le HEALTHCHECK
 * Docker) : services de fond avec leur dernier tick, dernière sauvegarde,
 * files d'envoi (masse + programmés), latence et taille de la base.
 */

interface ServiceStatus {
  name: string;
  label: string;
  intervalMs: number | null;
  startedAt: string | null;
  lastTickAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}j ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `il y a ${Math.max(1, Math.round(diff / 1000))} s`;
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.round(diff / 3_600_000)} h`;
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Un service est « en retard » si son dernier tick date de plus de 3× son
 * intervalle nominal (marge pour les ticks longs) ; tant qu'il n'a jamais
 * tické (premier tick différé au boot), il est « démarré ».
 */
function serviceHealth(s: ServiceStatus): 'ok' | 'late' | 'starting' {
  if (!s.lastTickAt) return 'starting';
  if (s.intervalMs && Date.now() - new Date(s.lastTickAt).getTime() > s.intervalMs * 3) return 'late';
  return 'ok';
}

function Card({ icon: Icon, label, value, sub, color = 'bg-outlook-blue' }: {
  icon: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border border-outlook-border rounded-lg p-4 flex items-start gap-3">
      <div className={`${color} text-white p-2 rounded-lg`}><Icon size={20} /></div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-outlook-text-primary truncate">{value}</div>
        <div className="text-sm text-outlook-text-secondary">{label}</div>
        {sub && <div className="text-xs text-outlook-text-disabled mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function AdminSystemStatus() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-system-status'],
    queryFn: api.getSystemStatus,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-outlook-text-secondary">
        <Loader2 size={16} className="animate-spin" /> Chargement…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        Impossible de récupérer l'état du système : {(error as any)?.message || 'erreur inconnue'}
      </div>
    );
  }

  const services: ServiceStatus[] = data.services || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Activity size={18} className="text-outlook-blue" />
          État du système
        </h3>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-outlook-text-secondary hover:text-outlook-text-primary border border-outlook-border rounded hover:bg-outlook-bg-hover"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card icon={Clock} label="Uptime" value={formatUptime(data.uptime)} sub={`Node ${data.nodeVersion}`} color="bg-slate-600" />
        <Card icon={MemoryStick} label="Mémoire (RSS)" value={formatBytes(data.memory)} color="bg-slate-600" />
        <Card
          icon={Database}
          label="Base de données"
          value={data.db?.ok ? `${data.db.latencyMs} ms` : 'KO'}
          sub={data.db?.size ? formatBytes(data.db.size) : undefined}
          color={data.db?.ok ? 'bg-green-600' : 'bg-red-600'}
        />
        <Card
          icon={HardDrive}
          label="Dernière sauvegarde"
          value={data.lastBackup ? timeAgo(data.lastBackup.created_at) : 'Aucune'}
          sub={data.lastBackup ? `${data.lastBackup.type === 'auto' ? 'auto' : 'manuelle'} · ${formatBytes(Number(data.lastBackup.size_bytes))}` : 'Admin > Système > Sauvegarde'}
          color={data.lastBackup ? 'bg-teal-600' : 'bg-amber-600'}
        />
      </div>

      {/* Files d'envoi */}
      <h4 className="text-sm font-semibold mb-3 text-outlook-text-secondary">Files d'envoi</h4>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card
          icon={Send}
          label="Envoi en masse"
          value={String(data.bulkSendQueue?.activeJobs ?? 0)}
          sub={`campagne(s) active(s) · ${data.bulkSendQueue?.pendingRecipients ?? 0} mail(s) en attente`}
          color="bg-indigo-500"
        />
        <Card
          icon={Clock}
          label="Envois programmés"
          value={String(data.scheduledMessages?.scheduled ?? 0)}
          sub={`en attente · ${data.scheduledMessages?.sent24h ?? 0} envoyé(s) sur 24h`}
          color="bg-blue-600"
        />
        <Card
          icon={AlertTriangle}
          label="Programmés en erreur"
          value={String(data.scheduledMessages?.errors ?? 0)}
          color={(data.scheduledMessages?.errors ?? 0) > 0 ? 'bg-red-600' : 'bg-green-600'}
        />
      </div>

      {/* Services de fond */}
      <h4 className="text-sm font-semibold mb-3 text-outlook-text-secondary">Services de fond</h4>
      <div className="bg-white border border-outlook-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-outlook-bg-primary text-xs text-outlook-text-secondary">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Service</th>
              <th className="text-left px-4 py-2 font-medium">Statut</th>
              <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Démarré</th>
              <th className="text-left px-4 py-2 font-medium">Dernier cycle</th>
              <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Dernière erreur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outlook-border">
            {services.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-outlook-text-disabled">
                  Aucun service enregistré — le serveur vient probablement de démarrer.
                </td>
              </tr>
            ) : services.map((s) => {
              const health = serviceHealth(s);
              return (
                <tr key={s.name}>
                  <td className="px-4 py-2.5 text-outlook-text-primary">{s.label}</td>
                  <td className="px-4 py-2.5">
                    {health === 'ok' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <CheckCircle2 size={11} /> Actif
                      </span>
                    )}
                    {health === 'starting' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        <Loader2 size={11} className="animate-spin" /> Démarré
                      </span>
                    )}
                    {health === 'late' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        <AlertTriangle size={11} /> En retard
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-outlook-text-secondary hidden sm:table-cell">{timeAgo(s.startedAt)}</td>
                  <td className="px-4 py-2.5 text-outlook-text-secondary">{timeAgo(s.lastTickAt)}</td>
                  <td className="px-4 py-2.5 text-xs hidden md:table-cell">
                    {s.lastError ? (
                      <span className="text-red-600" title={s.lastError}>
                        {timeAgo(s.lastErrorAt)} — {s.lastError.slice(0, 60)}{s.lastError.length > 60 ? '…' : ''}
                      </span>
                    ) : (
                      <span className="text-outlook-text-disabled">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-outlook-text-disabled mt-2">
        Le conteneur Docker expose aussi <code>/api/health</code> (healthcheck) : un conteneur
        « unhealthy » signale un crash au démarrage au lieu de laisser le reverse proxy renvoyer des 502.
      </p>
    </div>
  );
}
