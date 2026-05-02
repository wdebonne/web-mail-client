import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import {
  Users, Shield, Plug, Cloud, Settings, Plus, Trash2, X,
  Edit2, CheckCircle, XCircle, RefreshCw, Globe, Mail, UserPlus, TestTube,
  LayoutDashboard, ScrollText, Server, HardDrive, Database, Calendar,
  Contact, Search, Link, Palette, Monitor, Smartphone, Tablet,
  ChevronDown, ChevronRight, LogOut, Coffee, Bell,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useUIStore } from '../stores/uiStore';

import AdminCalendarManagement from '../components/admin/AdminCalendarManagement';
import AdminAutoResponders from '../components/admin/AdminAutoResponders';
import NotificationPreferencesEditor from '../components/notifications/NotificationPreferencesEditor';
import {
  getDefaultNotificationPrefs, mergeNotificationPrefs,
  type NotificationPrefs,
} from '../utils/notificationPrefs';

type Tab = 'dashboard' | 'users' | 'groups' | 'mailaccounts' | 'calendars' | 'autoresponders' | 'o2switch' | 'plugins' | 'nextcloud' | 'logs' | 'system' | 'loginAppearance' | 'devices' | 'notifications';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  // Master/detail toggle for mobile/tablet (< md). Ignored on desktop.
  const [mobileDetail, setMobileDetail] = useState(false);
  // Toggle from the shared header hamburger.
  const mobileSidebarSignal = useUIStore((s) => s.mobileSidebarSignal);
  const firstSignal = useRef(mobileSidebarSignal);
  useEffect(() => {
    if (mobileSidebarSignal === firstSignal.current) return;
    setMobileDetail((v) => !v);
  }, [mobileSidebarSignal]);

  const tabs = [
    { id: 'dashboard' as const, icon: LayoutDashboard, label: 'Tableau de bord' },
    { id: 'users' as const, icon: Users, label: 'Utilisateurs' },
    { id: 'groups' as const, icon: Shield, label: 'Groupes' },
    { id: 'mailaccounts' as const, icon: Mail, label: 'Comptes mail' },
    { id: 'autoresponders' as const, icon: Coffee, label: 'Répondeurs' },
    { id: 'calendars' as const, icon: Calendar, label: 'Calendriers' },
    { id: 'o2switch' as const, icon: Server, label: 'O2Switch' },
    { id: 'plugins' as const, icon: Plug, label: 'Plugins' },
    { id: 'nextcloud' as const, icon: Cloud, label: 'NextCloud' },
    { id: 'logs' as const, icon: ScrollText, label: 'Logs' },
    { id: 'loginAppearance' as const, icon: Palette, label: 'Apparence connexion' },
    { id: 'devices' as const, icon: Monitor, label: 'Appareils' },
    { id: 'notifications' as const, icon: Bell, label: 'Notifications' },
    { id: 'system' as const, icon: Settings, label: 'Système' },
  ];

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Mobile/tablet vertical list (master view) */}
      <div
        className={`md:hidden ${mobileDetail ? 'hidden' : 'flex'} flex-col flex-1 overflow-y-auto bg-outlook-bg-primary`}
      >
        <h2 className="text-lg font-semibold px-4 pt-4 pb-2 text-outlook-text-primary">Administration</h2>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setMobileDetail(true); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm border-b border-outlook-border transition-colors
                ${tab === t.id ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
            >
              <Icon size={18} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden md:block w-56 border-r border-outlook-border bg-outlook-bg-primary flex-shrink-0 py-4 overflow-y-auto">
        <h2 className="text-lg font-semibold px-4 mb-4 text-outlook-text-primary">Administration</h2>
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors
                ${tab === t.id ? 'bg-outlook-bg-selected font-medium text-outlook-text-primary border-l-2 border-l-outlook-blue' : 'text-outlook-text-secondary hover:bg-outlook-bg-hover'}`}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      <div
        className={`flex-1 ${mobileDetail ? 'flex' : 'hidden'} md:flex flex-col min-h-0`}
      >
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
          <div className="max-w-5xl">
            {tab === 'dashboard' && <DashboardPanel />}
            {tab === 'users' && <UserManagement />}
            {tab === 'groups' && <GroupManagement />}
            {tab === 'mailaccounts' && <MailAccountManagement />}
            {tab === 'autoresponders' && <AdminAutoResponders />}
            {tab === 'calendars' && <AdminCalendarManagement />}
            {tab === 'o2switch' && <O2SwitchManagement />}
            {tab === 'plugins' && <PluginManagement />}
            {tab === 'nextcloud' && <NextCloudSettings />}
            {tab === 'logs' && <LogsPanel />}
            {tab === 'loginAppearance' && <LoginAppearanceSettings />}
            {tab === 'devices' && <DeviceSessionsManagement />}
            {tab === 'notifications' && <AdminNotificationDefaults />}
            {tab === 'system' && <SystemSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ========================================
// Dashboard
// ========================================

function StatCard({ icon: Icon, label, value, sub, color = 'bg-outlook-blue' }: { icon: any; label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-outlook-border rounded-lg p-4 flex items-start gap-3">
      <div className={`${color} text-white p-2 rounded-lg`}><Icon size={20} /></div>
      <div>
        <div className="text-2xl font-bold text-outlook-text-primary">{value}</div>
        <div className="text-sm text-outlook-text-secondary">{label}</div>
        {sub && <div className="text-xs text-outlook-text-disabled mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
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

function DashboardPanel() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: api.getAdminDashboard,
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="text-sm text-outlook-text-secondary">Chargement...</div>;
  if (!stats) return null;

  return (
    <div>
      <h3 className="text-base font-semibold mb-4">Tableau de bord</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Users} label="Utilisateurs" value={stats.users} />
        <StatCard icon={Shield} label="Groupes" value={stats.groups} color="bg-purple-500" />
        <StatCard icon={Mail} label="Comptes mail" value={stats.mailAccounts} color="bg-green-600" />
        <StatCard icon={Contact} label="Contacts" value={stats.contacts} color="bg-orange-500" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Mail} label="Emails (cache)" value={stats.emails.total} sub={`${stats.emails.read} lus · ${stats.emails.flagged} marqués`} color="bg-blue-600" />
        <StatCard icon={Calendar} label="Calendriers" value={stats.calendars} sub={`${stats.events} événements`} color="bg-teal-600" />
        <StatCard icon={Plug} label="Plugins" value={`${stats.plugins.active}/${stats.plugins.total}`} sub="actifs" color="bg-indigo-500" />
        <StatCard icon={Server} label="O2Switch" value={stats.o2switch.active} sub={`${stats.o2switch.total} comptes`} color="bg-red-500" />
      </div>
      <h4 className="text-sm font-semibold mb-3 text-outlook-text-secondary">Infrastructure</h4>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Database} label="Base de données" value={formatBytes(stats.databaseSize)} color="bg-slate-600" />
        <StatCard icon={HardDrive} label="Mémoire app" value={formatBytes(stats.docker.memoryUsed)} sub={stats.docker.memoryLimit ? `/ ${formatBytes(stats.docker.memoryLimit)}` : 'illimité'} color="bg-slate-600" />
        <StatCard icon={RefreshCw} label="Uptime" value={formatUptime(stats.docker.uptime)} sub={`Node ${stats.docker.nodeVersion}`} color="bg-slate-600" />
        <StatCard icon={ScrollText} label="Logs (24h)" value={stats.logsLast24h} color="bg-amber-600" />
      </div>
    </div>
  );
}

// ========================================
// Logs
// ========================================

function LogsPanel() {
  const [filters, setFilters] = useState({ category: '', search: '', page: 1 });

  const { data: categories = [] } = useQuery({
    queryKey: ['admin-log-categories'],
    queryFn: api.getAdminLogCategories,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-logs', filters],
    queryFn: () => api.getAdminLogs({
      category: filters.category || undefined,
      search: filters.search || undefined,
      page: filters.page,
      limit: 50,
    }),
  });

  const categoryColors: Record<string, string> = {
    o2switch: 'bg-red-100 text-red-700',
    auth: 'bg-blue-100 text-blue-700',
    mail: 'bg-green-100 text-green-700',
    admin: 'bg-purple-100 text-purple-700',
    system: 'bg-gray-100 text-gray-700',
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-4">Logs d'activité</h3>
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
          <input type="text" placeholder="Rechercher dans les logs..." value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value, page: 1 })}
            className="w-full pl-7 pr-3 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
        </div>
        <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value, page: 1 })}
          className="text-sm border border-outlook-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-outlook-blue">
          <option value="">Toutes catégories</option>
          {categories.map((c: string) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {isLoading ? <div className="text-sm text-outlook-text-secondary">Chargement...</div> : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outlook-border text-left">
                <th className="py-2 px-3 font-medium text-outlook-text-secondary">Date</th>
                <th className="py-2 px-3 font-medium text-outlook-text-secondary">Catégorie</th>
                <th className="py-2 px-3 font-medium text-outlook-text-secondary">Action</th>
                <th className="py-2 px-3 font-medium text-outlook-text-secondary">Utilisateur</th>
                <th className="py-2 px-3 font-medium text-outlook-text-secondary">Détails</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs.map((log: any) => (
                <tr key={log.id} className="border-b border-outlook-border hover:bg-outlook-bg-hover">
                  <td className="py-2 px-3 text-xs text-outlook-text-secondary whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${categoryColors[log.category] || 'bg-gray-100 text-gray-700'}`}>{log.category}</span>
                  </td>
                  <td className="py-2 px-3 text-xs font-mono">{log.action}</td>
                  <td className="py-2 px-3 text-xs">{log.user_display_name || log.user_email || '—'}</td>
                  <td className="py-2 px-3 text-xs text-outlook-text-secondary max-w-[200px] truncate" title={JSON.stringify(log.details)}>
                    {Object.entries(log.details || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                  </td>
                </tr>
              ))}
              {data?.logs.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-outlook-text-disabled">Aucun log trouvé</td></tr>
              )}
            </tbody>
          </table>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-outlook-text-secondary">Page {data.page} / {data.totalPages} ({data.total} résultats)</span>
              <div className="flex gap-1">
                <button disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })} className="px-2 py-1 text-xs border border-outlook-border rounded disabled:opacity-40 hover:bg-outlook-bg-hover">Précédent</button>
                <button disabled={data.page >= data.totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })} className="px-2 py-1 text-xs border border-outlook-border rounded disabled:opacity-40 hover:bg-outlook-bg-hover">Suivant</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ========================================
// O2Switch Management
// ========================================

function O2SwitchManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showEmails, setShowEmails] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({ queryKey: ['o2switch-accounts'], queryFn: api.getO2SwitchAccounts });

  const createMutation = useMutation({
    mutationFn: api.createO2SwitchAccount,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['o2switch-accounts'] }); setShowForm(false); toast.success('Compte O2Switch ajouté'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteO2SwitchAccount,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['o2switch-accounts'] }); toast.success('Compte O2Switch supprimé'); },
    onError: (e: any) => toast.error(e.message),
  });

  const testMutation = useMutation({
    mutationFn: api.testO2SwitchConnection,
    onSuccess: (data: any) => { data.success ? toast.success('Connexion réussie !') : toast.error(`Échec : ${data.error}`); },
    onError: (e: any) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: api.syncO2Switch,
    onSuccess: (data: any) => { queryClient.invalidateQueries({ queryKey: ['o2switch-accounts'] }); toast.success(`Sync : ${data.created} nouveaux, ${data.skipped} existants sur ${data.total}`); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">O2Switch — Comptes cPanel</h3>
        <button onClick={() => setShowForm(true)} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Ajouter un compte
        </button>
      </div>

      {showForm && <O2SwitchAccountForm onSubmit={(data) => createMutation.mutate(data)} onCancel={() => setShowForm(false)} loading={createMutation.isPending} />}

      <div className="space-y-3">
        {accounts.map((acc: any) => (
          <div key={acc.id} className="border border-outlook-border rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${acc.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <div>
                  <div className="font-medium text-sm">{acc.label || acc.hostname}</div>
                  <div className="text-xs text-outlook-text-secondary">{acc.username}@{acc.hostname}</div>
                  {acc.last_sync && <div className="text-xs text-outlook-text-disabled">Dernière sync : {new Date(acc.last_sync).toLocaleString('fr-FR')}</div>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => testMutation.mutate(acc.id)} className="px-2 py-1 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1" title="Tester">
                  <TestTube size={12} /> Test
                </button>
                <button onClick={() => syncMutation.mutate(acc.id)} className="px-2 py-1 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1" title="Synchroniser">
                  <RefreshCw size={12} /> Sync
                </button>
                <button onClick={() => setShowEmails(showEmails === acc.id ? null : acc.id)} className="px-2 py-1 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover flex items-center gap-1">
                  <Mail size={12} /> Emails
                </button>
                <button onClick={() => { if (confirm('Supprimer ce compte O2Switch ?')) deleteMutation.mutate(acc.id); }} className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 flex items-center gap-1">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {showEmails === acc.id && <O2SwitchEmailList accountId={acc.id} />}
          </div>
        ))}
        {accounts.length === 0 && !showForm && (
          <div className="text-sm text-outlook-text-disabled text-center py-8">Aucun compte O2Switch configuré. Ajoutez un compte pour commencer.</div>
        )}
      </div>
    </div>
  );
}

function O2SwitchAccountForm({ onSubmit, onCancel, loading }: { onSubmit: (data: any) => void; onCancel: () => void; loading: boolean }) {
  const [form, setForm] = useState({ hostname: '', username: '', apiToken: '', label: '' });
  return (
    <div className="border border-outlook-border rounded-lg p-4 mb-4 bg-white">
      <h4 className="text-sm font-semibold mb-3">Nouveau compte O2Switch</h4>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-outlook-text-secondary block mb-1">Hostname cPanel *</label>
          <input value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })} placeholder="colorant.o2switch.net" className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" /></div>
        <div><label className="text-xs text-outlook-text-secondary block mb-1">Nom d'utilisateur cPanel *</label>
          <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="moncompte" className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" /></div>
        <div><label className="text-xs text-outlook-text-secondary block mb-1">Clé API cPanel *</label>
          <input type="password" value={form.apiToken} onChange={e => setForm({ ...form, apiToken: e.target.value })} placeholder="Clé API depuis cPanel" className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" /></div>
        <div><label className="text-xs text-outlook-text-secondary block mb-1">Libellé</label>
          <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Mon compte O2Switch" className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" /></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => onSubmit(form)} disabled={!form.hostname || !form.username || !form.apiToken || loading} className="bg-outlook-blue text-white px-3 py-1.5 text-sm rounded disabled:opacity-50 hover:bg-outlook-blue-hover">{loading ? 'Ajout...' : 'Ajouter'}</button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
      </div>
    </div>
  );
}

function O2SwitchEmailList({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [linkForm, setLinkForm] = useState<{ email: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: emails = [], isLoading } = useQuery({ queryKey: ['o2switch-emails', accountId], queryFn: () => api.getO2SwitchEmails(accountId) });
  const { data: users = [] } = useQuery({ queryKey: ['admin-users'], queryFn: api.getAdminUsers });
  const { data: groups = [] } = useQuery({ queryKey: ['admin-groups'], queryFn: api.getAdminGroups });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.createO2SwitchEmail(accountId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['o2switch-emails', accountId] }); setShowCreate(false); toast.success('Adresse créée sur O2Switch'); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (email: string) => api.deleteO2SwitchEmail(accountId, email),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['o2switch-emails', accountId] }); toast.success('Adresse supprimée'); },
    onError: (e: any) => toast.error(e.message),
  });

  const linkMutation = useMutation({
    mutationFn: (data: any) => api.linkO2SwitchEmail(accountId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['o2switch-emails', accountId] }); queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] }); setLinkForm(null); toast.success('Adresse liée'); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    if (!searchQuery) return emails;
    const q = searchQuery.toLowerCase();
    return emails.filter((e: any) => e.email.toLowerCase().includes(q) || e.domain?.toLowerCase().includes(q));
  }, [emails, searchQuery]);

  return (
    <div className="mt-4 border-t border-outlook-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-sm font-medium">Adresses mail ({emails.length})</h5>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input type="text" placeholder="Filtrer..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="pl-6 pr-2 py-1 text-xs border border-outlook-border rounded w-48 focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
          </div>
          <button onClick={() => setShowCreate(!showCreate)} className="text-xs text-outlook-blue hover:underline flex items-center gap-1"><Plus size={12} /> Créer</button>
        </div>
      </div>

      {showCreate && <O2SwitchCreateEmailForm onSubmit={(data) => createMutation.mutate(data)} onCancel={() => setShowCreate(false)} loading={createMutation.isPending} />}

      {isLoading ? <div className="text-xs text-outlook-text-secondary">Chargement...</div> : (
        <div className="space-y-1">
          {filtered.map((email: any) => (
            <div key={email.email} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-outlook-bg-hover text-sm">
              <div className="flex items-center gap-2">
                <Mail size={14} className={email.suspended ? 'text-red-400' : 'text-outlook-blue'} />
                <span className={email.suspended ? 'line-through text-outlook-text-disabled' : ''}>{email.email}</span>
                {email.linkedMailAccountId && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded flex items-center gap-0.5"><Link size={10} /> Lié</span>}
                {email.suspended && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Suspendu</span>}
              </div>
              <div className="flex items-center gap-1">
                {!email.linkedMailAccountId && (
                  <button onClick={() => setLinkForm({ email: email.email })} className="text-xs text-outlook-blue hover:underline flex items-center gap-0.5"><Link size={10} /> Lier</button>
                )}
                <button onClick={() => { if (confirm(`Supprimer ${email.email} de O2Switch ?`)) deleteMutation.mutate(email.email); }} className="text-xs text-red-500 hover:underline flex items-center gap-0.5"><Trash2 size={10} /></button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-xs text-outlook-text-disabled text-center py-4">Aucune adresse trouvée</div>}
        </div>
      )}

      {linkForm && <O2SwitchLinkForm email={linkForm.email} users={users} groups={groups} onSubmit={(data) => linkMutation.mutate(data)} onCancel={() => setLinkForm(null)} loading={linkMutation.isPending} />}
    </div>
  );
}

function O2SwitchCreateEmailForm({ onSubmit, onCancel, loading }: { onSubmit: (data: any) => void; onCancel: () => void; loading: boolean }) {
  const [form, setForm] = useState({ email: '', password: '', quota: '1024' });
  return (
    <div className="border border-outlook-border rounded p-3 mb-2 bg-gray-50">
      <div className="grid grid-cols-3 gap-2">
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="adresse@domaine.fr" className="px-2 py-1 text-xs border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
        <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Mot de passe" className="px-2 py-1 text-xs border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
        <input type="number" value={form.quota} onChange={e => setForm({ ...form, quota: e.target.value })} placeholder="Quota (MB)" className="px-2 py-1 text-xs border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={() => onSubmit({ ...form, quota: parseInt(form.quota) })} disabled={!form.email || !form.password || loading} className="bg-outlook-blue text-white px-2 py-1 text-xs rounded disabled:opacity-50">{loading ? 'Création...' : 'Créer'}</button>
        <button onClick={onCancel} className="px-2 py-1 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
      </div>
    </div>
  );
}

function O2SwitchLinkForm({ email, users, groups, onSubmit, onCancel, loading }: {
  email: string; users: any[]; groups: any[]; onSubmit: (data: any) => void; onCancel: () => void; loading: boolean;
}) {
  const [password, setPassword] = useState('');
  const [name, setName] = useState(email.split('@')[0]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [autoSyncDav, setAutoSyncDav] = useState(true);

  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase();
    return (q ? users.filter((u: any) => u.email?.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q)) : users).slice(0, 10);
  }, [users, userSearch]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.toLowerCase();
    return (q ? groups.filter((g: any) => g.name?.toLowerCase().includes(q)) : groups).slice(0, 10);
  }, [groups, groupSearch]);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-white rounded-lg p-5 w-[480px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h4 className="text-sm font-semibold mb-3">Lier {email} à un compte local</h4>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-outlook-text-secondary block mb-1">Nom du compte</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary block mb-1">Mot de passe IMAP/SMTP *</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mot de passe de la boite mail" className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary block mb-1">Attribuer aux utilisateurs</label>
            <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Rechercher un utilisateur..." className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded mb-1 focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
            <div className="max-h-32 overflow-y-auto border border-outlook-border rounded">
              {filteredUsers.map((u: any) => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer text-xs">
                  <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={e => {
                    if (e.target.checked) setSelectedUsers([...selectedUsers, u.id]);
                    else setSelectedUsers(selectedUsers.filter(id => id !== u.id));
                  }} />
                  {u.display_name || u.email}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary block mb-1">Attribuer aux groupes</label>
            <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)} placeholder="Rechercher un groupe..." className="w-full px-2 py-1.5 text-sm border border-outlook-border rounded mb-1 focus:outline-none focus:ring-1 focus:ring-outlook-blue" />
            <div className="max-h-32 overflow-y-auto border border-outlook-border rounded">
              {filteredGroups.map((g: any) => (
                <label key={g.id} className="flex items-center gap-2 px-2 py-1 hover:bg-outlook-bg-hover cursor-pointer text-xs">
                  <input type="checkbox" checked={selectedGroups.includes(g.id)} onChange={e => {
                    if (e.target.checked) setSelectedGroups([...selectedGroups, g.id]);
                    else setSelectedGroups(selectedGroups.filter(id => id !== g.id));
                  }} />
                  {g.name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 pt-2 border-t border-outlook-border text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={autoSyncDav}
              onChange={e => setAutoSyncDav(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Activer la synchronisation O2Switch (CalDAV + CardDAV)</span>
              <span className="block text-outlook-text-secondary mt-0.5">
                Configure automatiquement les calendriers et carnets d'adresses avec le même mot de passe que la boite mail.
              </span>
            </span>
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={() => onSubmit({ remoteEmail: email, password, name, assignToUserIds: selectedUsers, assignToGroupIds: selectedGroups, autoSyncDav })}
            disabled={!password || loading} className="bg-outlook-blue text-white px-3 py-1.5 text-sm rounded disabled:opacity-50 hover:bg-outlook-blue-hover">
            {loading ? 'Liaison...' : 'Lier et attribuer'}
          </button>
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-outlook-border rounded hover:bg-outlook-bg-hover">Annuler</button>
        </div>
      </div>
    </div>
  );
}

// ========================================
// User Management
// ========================================

function UserManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: api.getAdminUsers,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Utilisateur supprimé');
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createAdminUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowForm(false);
      toast.success('Utilisateur créé');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Utilisateurs ({users.length})</h3>
        <button onClick={() => setShowForm(true)} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Nouvel utilisateur
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-outlook-border text-left">
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Nom</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">E-mail</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Rôle</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Statut</th>
            <th className="py-2 px-3 font-medium text-outlook-text-secondary">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user: any) => (
            <tr key={user.id} className="border-b border-outlook-border hover:bg-outlook-bg-hover">
              <td className="py-2 px-3 font-medium">{user.display_name}</td>
              <td className="py-2 px-3 text-outlook-text-secondary">{user.email}</td>
              <td className="py-2 px-3">
                <span className={`text-xs px-2 py-0.5 rounded ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                  {user.role === 'admin' ? 'Admin' : 'Utilisateur'}
                </span>
              </td>
              <td className="py-2 px-3">
                {user.is_active ? (
                  <span className="text-outlook-success flex items-center gap-1 text-xs"><CheckCircle size={12} /> Actif</span>
                ) : (
                  <span className="text-outlook-danger flex items-center gap-1 text-xs"><XCircle size={12} /> Inactif</span>
                )}
              </td>
              <td className="py-2 px-3">
                <button onClick={() => confirm('Supprimer cet utilisateur ?') && deleteMutation.mutate(user.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl w-96 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nouvel utilisateur</h3>
            <UserForm onSubmit={(data) => createMutation.mutate(data)} onClose={() => setShowForm(false)} isSubmitting={createMutation.isPending} />
          </div>
        </div>
      )}
    </div>
  );
}

function UserForm({ onSubmit, onClose, isSubmitting }: { onSubmit: (data: any) => void; onClose: () => void; isSubmitting: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('user');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ email, password, displayName, role }); }} className="space-y-3">
      <div><label className="text-xs text-outlook-text-secondary">Nom</label><input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
      <div><label className="text-xs text-outlook-text-secondary">E-mail</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
      <div><label className="text-xs text-outlook-text-secondary">Mot de passe</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
      <div><label className="text-xs text-outlook-text-secondary">Rôle</label><select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm"><option value="user">Utilisateur</option><option value="admin">Administrateur</option></select></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">Annuler</button>
        <button type="submit" disabled={isSubmitting} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50">{isSubmitting ? 'Création...' : 'Créer'}</button>
      </div>
    </form>
  );
}

function GroupManagement() {
  const queryClient = useQueryClient();
  const { data: groups = [] } = useQuery({ queryKey: ['admin-groups'], queryFn: api.getAdminGroups });
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#0078D4');

  const createMutation = useMutation({
    mutationFn: api.createAdminGroup,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-groups'] }); setShowForm(false); setName(''); toast.success('Groupe créé'); },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdminGroup,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-groups'] }); toast.success('Groupe supprimé'); },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Groupes ({groups.length})</h3>
        <button onClick={() => setShowForm(!showForm)} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Nouveau groupe
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate({ name, description, color }); }} className="mb-4 p-4 border border-outlook-border rounded-lg flex items-end gap-3">
          <div className="flex-1"><label className="text-xs text-outlook-text-secondary">Nom</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
          <div className="flex-1"><label className="text-xs text-outlook-text-secondary">Description</label><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" /></div>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 border-0" />
          <button type="submit" className="bg-outlook-blue text-white px-4 py-2 rounded-md text-sm">Créer</button>
        </form>
      )}

      <div className="space-y-2">
        {groups.map((group: any) => (
          <div key={group.id} className="flex items-center justify-between p-3 border border-outlook-border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: group.color }} />
              <div>
                <div className="font-medium text-sm">{group.name}</div>
                {group.description && <div className="text-xs text-outlook-text-secondary">{group.description}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-outlook-text-disabled">{group.member_count || 0} membres</span>
              <button onClick={() => confirm('Supprimer ce groupe ?') && deleteMutation.mutate(group.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MailAccountManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [assigningAccount, setAssigningAccount] = useState<any>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['admin-mail-accounts'],
    queryFn: api.getAdminMailAccounts,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdminMailAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      toast.success('Compte mail supprimé');
    },
  });

  const testMutation = useMutation({
    mutationFn: api.testAdminMailAccount,
    onSuccess: (result) => {
      if (result.success) toast.success('Connexion réussie');
      else toast.error(`Erreur: ${result.error}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <MicrosoftOAuthSettings />

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold">Comptes mail ({accounts.length})</h3>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
          <Plus size={14} /> Nouveau compte
        </button>
      </div>

      <div className="space-y-3">
        {accounts.map((account: any) => (
          <div key={account.id} className="border border-outlook-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: account.color }} />
                <div>
                  <div className="font-medium text-sm">{account.name}</div>
                  <div className="text-xs text-outlook-text-secondary">{account.email}</div>
                  <div className="text-xs text-outlook-text-disabled">{account.imap_host} / {account.smtp_host}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {account.is_shared && (
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded mr-2">Partagé</span>
                )}
                <span className="text-xs text-outlook-text-disabled mr-2">{account.assignment_count || 0} utilisateur(s)</span>
                <button onClick={() => setAssigningAccount(account)} className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary" title="Gérer les attributions">
                  <UserPlus size={14} />
                </button>
                <button onClick={() => testMutation.mutate(account.id)} className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary" title="Tester">
                  <TestTube size={14} />
                </button>
                <button onClick={() => { setEditing(account); setShowForm(true); }} className="p-1.5 hover:bg-outlook-bg-hover rounded text-outlook-text-secondary" title="Modifier">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => confirm('Supprimer ce compte mail ?') && deleteMutation.mutate(account.id)} className="p-1.5 hover:bg-red-50 rounded text-outlook-text-secondary hover:text-outlook-danger" title="Supprimer">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun compte mail configuré</div>
        )}
      </div>

      {showForm && (
        <AdminMailAccountForm
          account={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {assigningAccount && (
        <AssignmentManager
          account={assigningAccount}
          onClose={() => setAssigningAccount(null)}
        />
      )}
    </div>
  );
}

type MailProviderId = 'outlook' | 'gmail' | 'yahoo' | 'icloud' | 'o2switch' | 'imap';

interface MailProviderPreset {
  id: MailProviderId;
  label: string;
  description: string;
  color: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  usernameIsEmail: boolean;
  hideServers: boolean;
  isO2Switch: boolean;
  // If set, the form offers a "Connect with ..." OAuth2 button instead of the
  // password field. Required for Microsoft 365 (Basic Auth disabled since 2022)
  // and recommended for Google Workspace.
  oauthProvider?: 'microsoft';
  note?: string;
  logo: React.ReactNode;
}

// --------------------------------------------------------------------------
// Microsoft OAuth settings (Azure AD / Microsoft Entra ID credentials)
// --------------------------------------------------------------------------
// Env vars (MICROSOFT_OAUTH_CLIENT_ID / _SECRET / _TENANT / _REDIRECT_URI)
// always win over values saved here. This panel lets admins configure the
// app registration without editing .env / restarting the container.
// --------------------------------------------------------------------------
function MicrosoftOAuthSettings() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenant, setTenant] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [dirty, setDirty] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['admin-oauth-microsoft'],
    queryFn: api.getMicrosoftOAuthSettings,
  });

  useEffect(() => {
    if (!status) return;
    // Prefill from what admin saved in DB (not the effective values, so the
    // admin sees exactly what they typed).
    setClientId(status.db.clientId || '');
    setTenant(status.db.tenant || '');
    setRedirectUri(status.db.redirectUri || '');
    setClientSecret('');
    setDirty(false);
  }, [status]);

  const saveMutation = useMutation({
    mutationFn: (payload: {
      clientId?: string;
      clientSecret?: string;
      clearClientSecret?: boolean;
      tenant?: string;
      redirectUri?: string;
    }) => api.saveMicrosoftOAuthSettings(payload),
    onSuccess: () => {
      toast.success('Configuration OAuth Microsoft enregistrée');
      queryClient.invalidateQueries({ queryKey: ['admin-oauth-microsoft'] });
      setClientSecret('');
      setDirty(false);
    },
    onError: (e: any) => toast.error(e.message || 'Échec'),
  });

  if (!status) return null;

  const hasEnvOverride =
    status.sources.clientId === 'env' ||
    status.sources.clientSecret === 'env' ||
    status.sources.tenant === 'env' ||
    status.sources.redirectUri === 'env';

  const sourceBadge = (src: 'env' | 'db' | 'default' | 'none') => {
    if (src === 'env') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Env (Portainer)</span>;
    if (src === 'db') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">UI Admin</span>;
    if (src === 'default') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-outlook-bg-hover text-outlook-text-secondary">Défaut</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">Non configuré</span>;
  };

  return (
    <div className="mb-6 border border-outlook-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-outlook-bg-hover hover:bg-outlook-bg-selected text-left"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Shield size={16} className="text-outlook-blue" />
          <span className="font-medium text-sm">Configuration OAuth Microsoft 365 / Outlook</span>
          {status.configured
            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">Configuré</span>
            : <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">À configurer</span>}
        </div>
        <span className="text-xs text-outlook-text-secondary">
          {hasEnvOverride ? 'Variables d\'environnement actives' : 'Configuré via l\'UI'}
        </span>
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-outlook-bg-primary">
          <div className="text-xs text-outlook-text-secondary space-y-2">
            <p>
              Nécessaire pour connecter les comptes <strong>Outlook.com / Hotmail / Live / Microsoft 365</strong>{' '}
              (Microsoft a désactivé l'authentification basique IMAP/SMTP en septembre 2022).
              Créez une App Registration sur{' '}
              <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer" className="text-outlook-blue hover:underline">entra.microsoft.com</a>
              {' '}(gratuit, même avec un compte perso — aucune entreprise requise).
            </p>
            <p>
              <strong>Priorité :</strong> les variables d'environnement{' '}
              <code className="px-1 rounded bg-outlook-bg-hover">MICROSOFT_OAUTH_*</code> (renseignées dans Portainer / .env)
              sont toujours prioritaires sur les valeurs saisies ici. Pratique pour verrouiller la config en prod.
            </p>
            <p>
              URI de redirection à configurer dans Azure (copiez la valeur exacte affichée ci-dessous) :{' '}
              <code className="px-1 rounded bg-outlook-bg-hover break-all">{status.redirectUri}</code>
            </p>
          </div>

          {hasEnvOverride && (
            <div className="text-xs p-3 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              Une ou plusieurs valeurs sont fournies par les variables d'environnement. Les champs correspondants ci-dessous sont modifiables mais n'auront effet que si vous retirez la variable d'environnement correspondante.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary flex items-center gap-2 mb-1">
                Client ID (Application ID) {sourceBadge(status.sources.clientId)}
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setDirty(true); }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-3 py-2 text-sm border border-outlook-border rounded bg-outlook-bg-secondary"
              />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary flex items-center gap-2 mb-1">
                Client Secret {sourceBadge(status.sources.clientSecret)}
                {status.db.hasClientSecret && <span className="text-[10px] text-green-700 dark:text-green-400">• Enregistré</span>}
              </label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => { setClientSecret(e.target.value); setDirty(true); }}
                placeholder={status.db.hasClientSecret ? '•••••••• (laisser vide pour conserver)' : 'Valeur du secret'}
                className="w-full px-3 py-2 text-sm border border-outlook-border rounded bg-outlook-bg-secondary"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary flex items-center gap-2 mb-1">
                Tenant {sourceBadge(status.sources.tenant)}
              </label>
              <input
                type="text"
                value={tenant}
                onChange={(e) => { setTenant(e.target.value); setDirty(true); }}
                placeholder="common"
                className="w-full px-3 py-2 text-sm border border-outlook-border rounded bg-outlook-bg-secondary"
              />
              <div className="text-[10px] text-outlook-text-secondary mt-1">
                <code>common</code> = perso + pro · <code>organizations</code> = pro uniquement · <code>consumers</code> = perso uniquement · ou un GUID de tenant
              </div>
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary flex items-center gap-2 mb-1">
                Redirect URI (optionnel) {sourceBadge(status.sources.redirectUri)}
              </label>
              <input
                type="text"
                value={redirectUri}
                onChange={(e) => { setRedirectUri(e.target.value); setDirty(true); }}
                placeholder={status.redirectUri}
                className="w-full px-3 py-2 text-sm border border-outlook-border rounded bg-outlook-bg-secondary"
              />
              <div className="text-[10px] text-outlook-text-secondary mt-1">
                Par défaut déduit de <code>PUBLIC_URL</code>. Ne surchargez que si nécessaire.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => saveMutation.mutate({
                clientId,
                clientSecret: clientSecret || undefined,
                tenant,
                redirectUri,
              })}
              disabled={!dirty || saveMutation.isPending}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status.db.hasClientSecret && (
              <button
                onClick={() => {
                  if (!confirm('Supprimer le Client Secret enregistré ?')) return;
                  saveMutation.mutate({ clearClientSecret: true });
                }}
                className="px-3 py-1.5 rounded-md text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                Supprimer le secret
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const MAIL_PROVIDERS: MailProviderPreset[] = [
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    description: 'outlook.com, hotmail.com, live.com, Microsoft 365',
    color: '#0078D4',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    usernameIsEmail: true,
    hideServers: true,
    isO2Switch: false,
    oauthProvider: 'microsoft',
    note: "Microsoft 365 / Outlook exige la connexion moderne (OAuth2). Cliquez sur « Se connecter avec Microsoft » ci-dessous pour autoriser l'accès via Microsoft Authenticator.",
    logo: (
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        <path fill="#0078D4" d="M44 12v24a2 2 0 0 1-2 2H22V10h20a2 2 0 0 1 2 2Z"/>
        <path fill="#fff" d="M33 20h6v2h-6zM33 24h6v2h-6zM33 28h6v2h-6z"/>
        <path fill="#106EBE" d="M22 10v28H8a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2h14Z"/>
        <circle cx="14" cy="24" r="5" fill="#fff"/>
      </svg>
    ),
  },
  {
    id: 'gmail',
    label: 'Gmail',
    description: 'gmail.com, Google Workspace',
    color: '#EA4335',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    usernameIsEmail: true,
    hideServers: true,
    isO2Switch: false,
    note: "Google exige un mot de passe d'application (IMAP doit être activé dans les paramètres Gmail).",
    logo: (
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        <path fill="#4285F4" d="M44 12v24a2 2 0 0 1-2 2h-4V18l-14 10L10 18v20H6a2 2 0 0 1-2-2V12l20 14Z"/>
        <path fill="#34A853" d="M38 38V18l-14 10L10 18v20h28Z" opacity=".0"/>
        <path fill="#EA4335" d="M4 12a2 2 0 0 1 2-2h4l14 10 14-10h4a2 2 0 0 1 2 2L24 26 4 12Z"/>
        <path fill="#FBBC04" d="M10 18v20H6a2 2 0 0 1-2-2V12l6 6Z"/>
        <path fill="#34A853" d="M38 18v20h4a2 2 0 0 0 2-2V12l-6 6Z"/>
      </svg>
    ),
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    description: 'yahoo.com, yahoo.fr, ymail.com',
    color: '#6001D2',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    usernameIsEmail: true,
    hideServers: true,
    isO2Switch: false,
    note: "Yahoo exige un mot de passe d'application à générer depuis la sécurité du compte.",
    logo: (
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        <rect width="48" height="48" rx="8" fill="#6001D2"/>
        <path fill="#fff" d="M13 15h5l4.5 7 4.5-7h5l-7 11v7h-5v-7L13 15Z"/>
        <circle cx="34" cy="30" r="2.5" fill="#fff"/>
      </svg>
    ),
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    description: 'icloud.com, me.com, mac.com',
    color: '#007AFF',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    usernameIsEmail: true,
    hideServers: true,
    isO2Switch: false,
    note: "Apple exige un mot de passe d'application généré depuis appleid.apple.com.",
    logo: (
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        <rect width="48" height="48" rx="8" fill="#e9ecef"/>
        <path fill="#6c757d" d="M36 28c0 3.5-2.8 6-6.5 6H17.5C13.4 34 10 30.8 10 26.8c0-3.6 2.7-6.5 6.2-6.9.8-3.5 4-6.1 7.8-6.1 3.5 0 6.5 2.1 7.6 5.2 2.6.4 4.4 2.6 4.4 5.3 0 .2 0 .4 0 .6 0 .4.1.7.1 1v.1Z"/>
      </svg>
    ),
  },
  {
    id: 'o2switch',
    label: 'O2Switch',
    description: 'Hébergement O2Switch (CalDAV/CardDAV inclus)',
    color: '#0C7C59',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 465,
    usernameIsEmail: true,
    hideServers: false,
    isO2Switch: true,
    note: "Renseignez les hôtes IMAP/SMTP fournis par O2Switch. La synchronisation CalDAV/CardDAV sera activée automatiquement.",
    logo: (
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        <rect width="48" height="48" rx="8" fill="#0C7C59"/>
        <path fill="#fff" d="M24 12a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm0 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"/>
      </svg>
    ),
  },
  {
    id: 'imap',
    label: 'IMAP / SMTP (autre)',
    description: 'Configuration manuelle pour tout autre fournisseur',
    color: '#6B7280',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 465,
    usernameIsEmail: false,
    hideServers: false,
    isO2Switch: false,
    logo: (
      <svg viewBox="0 0 48 48" className="w-8 h-8" aria-hidden="true">
        <rect width="48" height="48" rx="8" fill="#E5E7EB"/>
        <path fill="#374151" d="M10 16h28v16H10z" opacity=".15"/>
        <path fill="#374151" d="M10 16l14 10 14-10v2L24 28 10 18v-2Z"/>
        <path fill="none" stroke="#374151" strokeWidth="2" d="M10 16h28v16H10z"/>
      </svg>
    ),
  },
];

function detectProviderFromAccount(account: any): MailProviderPreset {
  if (!account) return MAIL_PROVIDERS[MAIL_PROVIDERS.length - 1];
  const imap = (account.imap_host || '').toLowerCase();
  const match = MAIL_PROVIDERS.find(
    (p) => p.imapHost && imap === p.imapHost.toLowerCase(),
  );
  return match || MAIL_PROVIDERS[MAIL_PROVIDERS.length - 1];
}

function AdminMailAccountForm({ account, onClose }: { account: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<MailProviderPreset | null>(
    account ? detectProviderFromAccount(account) : null,
  );
  const [name, setName] = useState(account?.name || '');
  const [email, setEmail] = useState(account?.email || '');
  const [imapHost, setImapHost] = useState(account?.imap_host || '');
  const [imapPort, setImapPort] = useState(account?.imap_port || 993);
  const [smtpHost, setSmtpHost] = useState(account?.smtp_host || '');
  const [smtpPort, setSmtpPort] = useState(account?.smtp_port || 465);
  const [username, setUsername] = useState(account?.username || '');
  const [password, setPassword] = useState('');
  const [isShared, setIsShared] = useState(account?.is_shared || false);
  const [color, setColor] = useState(account?.color || '#0078D4');
  const [o2switchAutoSync, setO2switchAutoSync] = useState<boolean>(
    account ? !!account.caldav_sync_enabled : true,
  );
  // OAuth (Microsoft, …): the popup flow returns a short-lived pending id we
  // submit alongside the form. If the account already uses OAuth, we don't
  // require the user to reconnect it to save other edits.
  const [oauthPendingId, setOauthPendingId] = useState<string | null>(null);
  const [oauthEmail, setOauthEmail] = useState<string | null>(null);
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const accountUsesOAuth = !!account?.oauth_provider;

  const selectProvider = (p: MailProviderPreset) => {
    setProvider(p);
    if (!account) {
      if (p.imapHost) setImapHost(p.imapHost);
      setImapPort(p.imapPort);
      if (p.smtpHost) setSmtpHost(p.smtpHost);
      setSmtpPort(p.smtpPort);
      setColor(p.color);
      setO2switchAutoSync(p.isO2Switch);
    }
  };

  const mutation = useMutation({
    mutationFn: (data: any) => account ? api.updateAdminMailAccount(account.id, data) : api.createAdminMailAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      onClose();
      toast.success(account ? 'Compte mis à jour' : 'Compte créé');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // For well-known providers we force the preset hosts/ports even if user didn't touch them.
    const effectiveImapHost = provider?.hideServers && provider.imapHost ? provider.imapHost : imapHost;
    const effectiveImapPort = provider?.hideServers ? provider.imapPort : imapPort;
    const effectiveSmtpHost = provider?.hideServers && provider.smtpHost ? provider.smtpHost : smtpHost;
    const effectiveSmtpPort = provider?.hideServers ? provider.smtpPort : smtpPort;
    const effectiveUsername = provider?.usernameIsEmail ? (username || email) : (username || email);

    // OAuth providers: require either a newly-obtained pending id (new
    // account, or re-authentication) OR an existing oauth_provider on the
    // account row (we're just editing non-credential fields).
    if (provider?.oauthProvider && !oauthPendingId && !accountUsesOAuth) {
      toast.error(`Cliquez sur « Se connecter avec ${provider.label.split(' ')[0]} » avant d'enregistrer.`);
      return;
    }

    mutation.mutate({
      name,
      email,
      imapHost: effectiveImapHost,
      imapPort: effectiveImapPort,
      smtpHost: effectiveSmtpHost,
      smtpPort: effectiveSmtpPort,
      username: effectiveUsername,
      password: provider?.oauthProvider ? undefined : (password || undefined),
      oauthPendingId: oauthPendingId || undefined,
      isShared,
      color,
      o2switchAutoSync: provider?.isO2Switch ? o2switchAutoSync : false,
    });
  };

  /** Opens a popup for the OAuth authorize URL and waits for the postMessage. */
  const handleOAuthConnect = async () => {
    if (!provider?.oauthProvider) return;
    setOauthConnecting(true);
    try {
      const { url } = await api.startAdminMailAccountOAuth(provider.oauthProvider, email || undefined);
      const width = 520;
      const height = 640;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        url,
        'mail-oauth',
        `width=${width},height=${height},left=${left},top=${top}`,
      );
      if (!popup) {
        toast.error("Impossible d'ouvrir la fenêtre de connexion (bloquée par le navigateur ?).");
        setOauthConnecting(false);
        return;
      }
      const origin = window.location.origin;
      const finalize = () => { setOauthConnecting(false); window.removeEventListener('message', listener); };
      const listener = (ev: MessageEvent) => {
        if (ev.origin !== origin) return;
        const msg = ev.data;
        if (!msg || msg.type !== 'mail-oauth') return;
        const payload = msg.payload;
        finalize();
        if (!payload?.ok) {
          toast.error(payload?.error || "Échec de la connexion OAuth");
          return;
        }
        setOauthPendingId(payload.pendingId);
        setOauthEmail(payload.email);
        if (!email && payload.email) setEmail(payload.email);
        if (!name && payload.name) setName(payload.name);
        toast.success(`Connecté en tant que ${payload.email}`);
      };
      window.addEventListener('message', listener);
      // Fallback: if the popup closes without posting, release the UI state.
      const closeWatch = setInterval(() => {
        if (popup.closed) {
          clearInterval(closeWatch);
          setTimeout(finalize, 500);
        }
      }, 500);
    } catch (err: any) {
      toast.error(err.message || 'Erreur OAuth');
      setOauthConnecting(false);
    }
  };

  // Step 1: provider picker (only for new accounts)
  if (!provider) {
    return (
      <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-lg font-semibold">Ajouter tous vos comptes de messagerie</h2>
            <button onClick={onClose}><X size={18} /></button>
          </div>
          <p className="text-sm text-outlook-text-secondary mb-4">
            Choisissez votre fournisseur. Les paramètres de connexion seront adaptés automatiquement.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {MAIL_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectProvider(p)}
                className="flex items-center gap-3 w-full text-left border border-outlook-border rounded-md p-3 hover:bg-outlook-bg-hover transition-colors"
              >
                <div className="flex-shrink-0">{p.logo}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-outlook-text-secondary truncate">{p.description}</div>
                </div>
                <ChevronRight size={16} className="text-outlook-text-disabled" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            {!account && (
              <button
                type="button"
                onClick={() => setProvider(null)}
                className="p-1 rounded hover:bg-outlook-bg-hover text-outlook-text-secondary"
                title="Changer de fournisseur"
              >
                <ChevronRight size={16} className="rotate-180" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="scale-75 origin-left">{provider.logo}</div>
              <h2 className="text-lg font-semibold">
                {account ? 'Modifier le compte' : `Nouveau compte ${provider.label}`}
              </h2>
            </div>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {provider.note && (
          <div className="mb-3 text-xs p-2 rounded border border-amber-200 bg-amber-50 text-amber-900">
            {provider.note}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-outlook-text-secondary">Nom du compte</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Adresse e-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
            </div>
          </div>
          {!provider.hideServers && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-outlook-text-secondary">Serveur IMAP</label>
                  <input type="text" value={imapHost} onChange={(e) => setImapHost(e.target.value)} required placeholder="imap.example.com" className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-outlook-text-secondary">Port IMAP</label>
                  <input type="number" value={imapPort} onChange={(e) => setImapPort(parseInt(e.target.value))} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-outlook-text-secondary">Serveur SMTP</label>
                  <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} required placeholder="smtp.example.com" className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-outlook-text-secondary">Port SMTP</label>
                  <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(parseInt(e.target.value))} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
            </>
          )}
          {provider.hideServers && (
            <div className="text-xs text-outlook-text-secondary p-2 rounded bg-outlook-bg-hover/50 border border-outlook-border">
              IMAP <code>{provider.imapHost}:{provider.imapPort}</code> · SMTP <code>{provider.smtpHost}:{provider.smtpPort}</code>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {!provider.usernameIsEmail && !provider.oauthProvider && (
              <div>
                <label className="text-xs text-outlook-text-secondary">Identifiant</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={email || 'email@example.com'} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
              </div>
            )}
            {!provider.oauthProvider && (
              <div className={provider.usernameIsEmail ? 'col-span-2' : ''}>
                <label className="text-xs text-outlook-text-secondary">
                  {provider.hideServers ? "Mot de passe (d'application si MFA)" : 'Mot de passe'}
                </label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!account} className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm" />
              </div>
            )}
            {provider.oauthProvider && (
              <div className="col-span-2 flex flex-col gap-2">
                <label className="text-xs text-outlook-text-secondary">Connexion sécurisée</label>
                {oauthPendingId ? (
                  <div className="flex items-center justify-between border border-green-200 bg-green-50 rounded-md px-3 py-2 text-sm text-green-900">
                    <span>✓ Connecté en tant que <strong>{oauthEmail}</strong></span>
                    <button type="button" onClick={() => { setOauthPendingId(null); setOauthEmail(null); }} className="text-xs underline">Reconnecter</button>
                  </div>
                ) : accountUsesOAuth ? (
                  <div className="flex items-center justify-between border border-outlook-border bg-outlook-bg-hover/30 rounded-md px-3 py-2 text-sm">
                    <span>Compte déjà connecté via OAuth ({account?.oauth_provider}).</span>
                    <button type="button" disabled={oauthConnecting} onClick={handleOAuthConnect} className="text-xs underline disabled:opacity-50">
                      {oauthConnecting ? 'Connexion…' : 'Reconnecter'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={oauthConnecting}
                    onClick={handleOAuthConnect}
                    className="inline-flex items-center justify-center gap-2 border border-outlook-border rounded-md px-3 py-2 text-sm font-medium hover:bg-outlook-bg-hover disabled:opacity-50"
                  >
                    {provider.logo}
                    <span>{oauthConnecting ? 'Connexion…' : `Se connecter avec ${provider.label.split(' ')[0]}`}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="rounded" />
              Boîte partagée
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs text-outlook-text-secondary">Couleur</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-8 border-0 cursor-pointer" />
            </div>
          </div>
          {provider.isO2Switch && (
            <label className="flex items-start gap-2 text-sm p-2 rounded border border-outlook-border bg-outlook-bg-hover/30">
              <input
                type="checkbox"
                checked={o2switchAutoSync}
                onChange={(e) => setO2switchAutoSync(e.target.checked)}
                className="rounded mt-0.5"
              />
              <span>
                <span className="font-medium">Synchronisation O2Switch (CalDAV + CardDAV)</span>
                <span className="block text-xs text-outlook-text-secondary">
                  Pré-remplit les URLs <code>https://&lt;cpanel&gt;:2080/calendars/&lt;email&gt;/calendar</code> et <code>/addressbooks/&lt;email&gt;/addressbook</code> et active la synchro immédiate pour les utilisateurs assignés.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md hover:bg-outlook-bg-hover">Annuler</button>
            <button type="submit" disabled={mutation.isPending} className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 text-sm rounded-md disabled:opacity-50">
              {mutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignmentManager({ account, onClose }: { account: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [sendPermission, setSendPermission] = useState('none');
  const [isDefault, setIsDefault] = useState(false);

  const { data: assignments = [] } = useQuery({
    queryKey: ['mail-assignments', account.id],
    queryFn: () => api.getMailAccountAssignments(account.id),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: api.getAdminUsers,
  });

  const assignMutation = useMutation({
    mutationFn: (data: any) => api.createMailAccountAssignment(account.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-assignments', account.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      setUserId('');
      setDisplayName('');
      setSendPermission('none');
      setIsDefault(false);
      toast.success('Attribution créée');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: any }) =>
      api.updateMailAccountAssignment(account.id, assignmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-assignments', account.id] });
      toast.success('Attribution mise à jour');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (assignmentId: string) => api.deleteMailAccountAssignment(account.id, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail-assignments', account.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-mail-accounts'] });
      toast.success('Attribution supprimée');
    },
  });

  const assignedUserIds = new Set(assignments.map((a: any) => a.user_id));
  const availableUsers = users.filter((u: any) => !assignedUserIds.has(u.id));

  const PERM_LABELS: Record<string, string> = {
    none: 'Lecture seule',
    send_as: 'Envoyer de (send as)',
    send_on_behalf: 'Envoyer de la part de',
  };

  return (
    <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[600px] max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-semibold">Attributions - {account.name}</h2>
            <p className="text-xs text-outlook-text-secondary">{account.email}</p>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {/* Add assignment form */}
        <div className="border border-outlook-border rounded-lg p-3 mb-4">
          <h4 className="text-sm font-medium mb-2">Nouvelle attribution</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-outlook-text-secondary">Utilisateur</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full border border-outlook-border rounded-md px-2 py-1.5 text-sm">
                <option value="">Sélectionner...</option>
                {availableUsers.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Nom affiché (navigation)</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={account.name} className="w-full border border-outlook-border rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-outlook-text-secondary">Permission d'envoi</label>
              <select value={sendPermission} onChange={(e) => setSendPermission(e.target.value)} className="w-full border border-outlook-border rounded-md px-2 py-1.5 text-sm">
                <option value="none">Lecture seule</option>
                <option value="send_as">Envoyer de (send as)</option>
                <option value="send_on_behalf">Envoyer de la part de</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm pb-1.5">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="rounded" />
                Par défaut
              </label>
              <button
                onClick={() => userId && assignMutation.mutate({ userId, displayName: displayName || null, sendPermission, isDefault })}
                disabled={!userId || assignMutation.isPending}
                className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                Attribuer
              </button>
            </div>
          </div>
        </div>

        {/* Current assignments */}
        <h4 className="text-sm font-medium mb-2">Utilisateurs assignés ({assignments.length})</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outlook-border text-left">
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Utilisateur</th>
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Nom affiché</th>
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Permission</th>
              <th className="py-1.5 px-2 font-medium text-outlook-text-secondary text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a: any) => (
              <tr key={a.id} className="border-b border-outlook-border hover:bg-outlook-bg-hover">
                <td className="py-1.5 px-2">
                  <div className="font-medium">{a.user_display_name}</div>
                  <div className="text-xs text-outlook-text-secondary">{a.user_email}</div>
                </td>
                <td className="py-1.5 px-2 text-outlook-text-secondary">{a.display_name || account.name}</td>
                <td className="py-1.5 px-2">
                  <select
                    value={a.send_permission}
                    onChange={(e) => updateMutation.mutate({ assignmentId: a.id, data: { sendPermission: e.target.value } })}
                    className="text-xs border border-outlook-border rounded px-1.5 py-0.5"
                  >
                    <option value="none">Lecture seule</option>
                    <option value="send_as">Send as</option>
                    <option value="send_on_behalf">De la part de</option>
                  </select>
                </td>
                <td className="py-1.5 px-2">
                  <button onClick={() => confirm('Retirer cette attribution ?') && deleteMutation.mutate(a.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assignments.length === 0 && (
          <div className="text-center py-4 text-outlook-text-disabled text-sm">Aucun utilisateur assigné</div>
        )}
      </div>
    </div>
  );
}

function PluginManagement() {
  const queryClient = useQueryClient();
  const { data: plugins = [] } = useQuery({ queryKey: ['admin-plugins'], queryFn: api.getAllPlugins });

  const toggleMutation = useMutation({
    mutationFn: api.togglePlugin,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-plugins'] }); toast.success('Plugin mis à jour'); },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deletePlugin,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-plugins'] }); toast.success('Plugin supprimé'); },
  });

  return (
    <div>
      <h3 className="text-base font-semibold mb-4">Plugins ({plugins.length})</h3>
      <div className="space-y-3">
        {plugins.map((plugin: any) => (
          <div key={plugin.id} className="border border-outlook-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-outlook-blue/10 rounded-lg flex items-center justify-center text-outlook-blue">
                  <Plug size={20} />
                </div>
                <div>
                  <div className="font-medium">{plugin.display_name || plugin.name}</div>
                  <div className="text-xs text-outlook-text-secondary">{plugin.description}</div>
                  <div className="text-xs text-outlook-text-disabled">v{plugin.version} {plugin.author && `par ${plugin.author}`}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleMutation.mutate(plugin.id)}
                  className={`text-xs px-3 py-1 rounded-full ${plugin.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {plugin.is_active ? 'Actif' : 'Inactif'}
                </button>
                {!plugin.is_system && (
                  <button onClick={() => confirm('Supprimer ce plugin ?') && deleteMutation.mutate(plugin.id)} className="p-1 hover:bg-red-50 rounded text-outlook-text-disabled hover:text-outlook-danger">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {plugins.length === 0 && (
          <div className="text-center py-8 text-outlook-text-disabled text-sm">Aucun plugin installé</div>
        )}
      </div>
    </div>
  );
}

function NextCloudSettings() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<'config' | 'users'>('config');

  // Config state
  const { data: status } = useQuery({
    queryKey: ['admin-nextcloud-status'],
    queryFn: api.getNextcloudStatus,
  });

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [autoProvision, setAutoProvision] = useState(false);
  const [autoCreateCalendars, setAutoCreateCalendars] = useState(true);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);

  useEffect(() => {
    if (!status) return;
    setEnabled(!!status.enabled);
    setUrl(status.url || '');
    setAdminUsername(status.adminUsername || '');
    setAutoProvision(!!status.autoProvision);
    setAutoCreateCalendars(status.autoCreateCalendars !== false);
    setSyncIntervalMinutes(Math.max(5, Number(status.syncIntervalMinutes) || 15));
  }, [status]);

  const saveMutation = useMutation({
    mutationFn: () => api.saveNextcloudConfig({
      enabled, url, adminUsername,
      adminPassword: adminPassword || undefined, // only send if changed
      autoProvision, autoCreateCalendars, syncIntervalMinutes,
    }),
    onSuccess: () => {
      toast.success('Configuration NextCloud enregistrée');
      setAdminPassword('');
      queryClient.invalidateQueries({ queryKey: ['admin-nextcloud-status'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const testSavedMutation = useMutation({
    mutationFn: api.testSavedNextcloud,
    onSuccess: (r: any) => r?.success ? toast.success(`Connexion OK (NC ${r.version})`) : toast.error(r?.error || 'Connexion échouée'),
    onError: (e: any) => toast.error(e.message),
  });

  const testLiveMutation = useMutation({
    mutationFn: () => api.testNextcloud(url, adminUsername, adminPassword),
    onSuccess: (r: any) => r?.success ? toast.success(`Connexion OK (NC ${r.version})`) : toast.error(r?.error || 'Connexion échouée'),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
        <Cloud size={20} className="text-outlook-blue" /> Intégration NextCloud
      </h3>
      <p className="text-sm text-outlook-text-secondary mb-4">
        Connectez une instance NextCloud pour provisionner automatiquement les utilisateurs, créer leurs calendriers/contacts,
        activer le partage interne/externe, les liens publics et les invitations iMIP.
      </p>

      <div className="flex gap-2 mb-4 border-b border-outlook-border">
        <button
          onClick={() => setSection('config')}
          className={`px-3 py-2 text-sm font-medium ${section === 'config' ? 'text-outlook-blue border-b-2 border-outlook-blue' : 'text-outlook-text-secondary'}`}
        >Configuration</button>
        <button
          onClick={() => setSection('users')}
          className={`px-3 py-2 text-sm font-medium ${section === 'users' ? 'text-outlook-blue border-b-2 border-outlook-blue' : 'text-outlook-text-secondary'}`}
        >Utilisateurs provisionnés</button>
      </div>

      {section === 'config' && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Activer l'intégration NextCloud
          </label>

          <div>
            <label className="text-xs text-outlook-text-secondary">URL NextCloud</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cloud.example.com"
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary">Identifiant admin</label>
            <input type="text" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} placeholder="admin"
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-outlook-text-secondary">Mot de passe admin / App password</label>
            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
              placeholder={status?.configured ? '•••••••• (laisser vide pour conserver)' : '••••••••'}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
            <p className="text-[11px] text-outlook-text-secondary mt-1">
              Utilisez un <strong>App Password</strong> dédié depuis Paramètres NextCloud → Sécurité.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-outlook-border">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} />
              Provisionner automatiquement les nouveaux utilisateurs
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoCreateCalendars} onChange={(e) => setAutoCreateCalendars(e.target.checked)} />
              Créer les nouveaux calendriers sur NextCloud
            </label>
            <div>
              <label className="text-xs text-outlook-text-secondary">Intervalle de synchronisation (minutes)</label>
              <input type="number" min={5} value={syncIntervalMinutes}
                onChange={(e) => setSyncIntervalMinutes(Math.max(5, Number(e.target.value) || 15))}
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={() => (adminPassword ? testLiveMutation.mutate() : testSavedMutation.mutate())}
              className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-md text-sm flex items-center gap-2">
              <RefreshCw size={14} /> Tester la connexion
            </button>
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm">
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {section === 'users' && <NextCloudUsersPanel />}
    </div>
  );
}

function NextCloudUsersPanel() {
  const queryClient = useQueryClient();
  const { data: ncUsers = [] } = useQuery({ queryKey: ['admin-nextcloud-users'], queryFn: api.getNextcloudUsers });
  const { data: appUsers = [] } = useQuery({ queryKey: ['admin-users'], queryFn: api.getAdminUsers });

  const provisionMutation = useMutation({
    mutationFn: (userId: string) => api.provisionNextcloudUser(userId),
    onSuccess: () => { toast.success('Utilisateur provisionné'); queryClient.invalidateQueries({ queryKey: ['admin-nextcloud-users'] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const unlinkMutation = useMutation({
    mutationFn: (userId: string) => api.unlinkNextcloudUser(userId),
    onSuccess: () => { toast.success('Lien NC supprimé'); queryClient.invalidateQueries({ queryKey: ['admin-nextcloud-users'] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const syncMutation = useMutation({
    mutationFn: (userId: string) => api.syncNextcloudUser(userId),
    onSuccess: () => { toast.success('Synchronisation terminée'); queryClient.invalidateQueries({ queryKey: ['admin-nextcloud-users'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const [linkForUser, setLinkForUser] = useState<string | null>(null);
  const [linkUsername, setLinkUsername] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const linkMutation = useMutation({
    mutationFn: () => api.linkNextcloudUser(linkForUser!, linkUsername, linkPassword),
    onSuccess: () => {
      toast.success('Compte NC lié');
      setLinkForUser(null); setLinkUsername(''); setLinkPassword('');
      queryClient.invalidateQueries({ queryKey: ['admin-nextcloud-users'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mapped = new Map<string, any>();
  for (const nu of ncUsers as any[]) mapped.set(nu.user_id, nu);

  return (
    <div>
      <p className="text-xs text-outlook-text-secondary mb-2">
        Provisionnez ou liez les comptes NextCloud pour permettre la création automatique de calendriers, le partage et la synchronisation.
      </p>
      <div className="border border-outlook-border rounded-md divide-y">
        {(appUsers as any[]).map((u: any) => {
          const nc = mapped.get(u.id);
          return (
            <div key={u.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{u.display_name || u.email}</div>
                <div className="text-xs text-outlook-text-secondary truncate">{u.email}</div>
                {nc ? (
                  <div className="text-[11px] text-green-700 mt-1">
                    Lié NC : <strong>{nc.nc_username}</strong>
                    {nc.last_sync_at && <> · Dernière sync {new Date(nc.last_sync_at).toLocaleString()}</>}
                    {nc.last_sync_error && <div className="text-red-600">Erreur : {nc.last_sync_error}</div>}
                  </div>
                ) : (
                  <div className="text-[11px] text-outlook-text-secondary mt-1">Non provisionné</div>
                )}
              </div>
              <div className="flex gap-2">
                {!nc && (
                  <>
                    <button onClick={() => provisionMutation.mutate(u.id)}
                      className="text-xs px-3 py-1 rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover">
                      Provisionner
                    </button>
                    <button onClick={() => setLinkForUser(u.id)}
                      className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">
                      Lier existant
                    </button>
                  </>
                )}
                {nc && (
                  <>
                    <button onClick={() => syncMutation.mutate(u.id)}
                      className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 flex items-center gap-1">
                      <RefreshCw size={12} /> Sync
                    </button>
                    <button onClick={() => confirm('Supprimer le lien NextCloud ? Le compte NC est conservé.') && unlinkMutation.mutate(u.id)}
                      className="text-xs px-3 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700">
                      Délier
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {appUsers.length === 0 && (
          <div className="p-4 text-center text-sm text-outlook-text-secondary">Aucun utilisateur</div>
        )}
      </div>

      {linkForUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setLinkForUser(null)}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-[420px]" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold mb-3">Lier un compte NextCloud existant</h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs">Nom d'utilisateur NC</label>
                <input value={linkUsername} onChange={(e) => setLinkUsername(e.target.value)}
                  className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
              </div>
              <div>
                <label className="text-xs">App password NC</label>
                <input type="password" value={linkPassword} onChange={(e) => setLinkPassword(e.target.value)}
                  className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1" />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setLinkForUser(null)} className="px-3 py-1 text-sm rounded hover:bg-gray-100">Annuler</button>
              <button onClick={() => linkMutation.mutate()}
                disabled={!linkUsername || !linkPassword || linkMutation.isPending}
                className="px-3 py-1 text-sm rounded bg-outlook-blue text-white hover:bg-outlook-blue-hover disabled:opacity-50">
                Lier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Admin Notifications — défauts serveur appliqués aux utilisateurs
// n'ayant pas personnalisé leurs notifications dans Réglages.
// ──────────────────────────────────────────────────────────────────────────
function AdminNotificationDefaults() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: api.getAdminSettings,
  });

  const initial = useMemo(() => {
    const raw = settings?.notification_defaults;
    let parsed: any = null;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { /* ignore */ }
    const def = getDefaultNotificationPrefs();
    return mergeNotificationPrefs(def, parsed || null);
  }, [settings]);

  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  useEffect(() => { setPrefs(initial); }, [initial]);

  const saveMutation = useMutation({
    mutationFn: () => api.updateAdminSettings({ notification_defaults: prefs }),
    onSuccess: () => {
      toast.success('Défauts de notifications enregistrés');
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Échec de l\'enregistrement'),
  });

  if (isLoading) {
    return <div className="text-sm text-outlook-text-secondary">Chargement…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Bell size={16} /> Notifications — défauts utilisateurs
        </h3>
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="px-3 py-1.5 text-sm rounded bg-outlook-blue text-white hover:brightness-110 disabled:opacity-50"
        >
          Enregistrer
        </button>
      </div>
      <NotificationPreferencesEditor value={prefs} onChange={setPrefs} mode="admin" />
    </div>
  );
}

function SystemSettings() {
  const { data: settings } = useQuery({ queryKey: ['admin-settings'], queryFn: api.getAdminSettings });
  const updateMutation = useMutation({
    mutationFn: api.updateAdminSettings,
    onSuccess: () => toast.success('Paramètres système sauvegardés'),
  });

  const [appName, setAppName] = useState('WebMail');
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [maxAttachmentSize, setMaxAttachmentSize] = useState(25);
  const [attachmentVisibilityMinKb, setAttachmentVisibilityMinKb] = useState(10);
  const [archiveRootFolder, setArchiveRootFolder] = useState('Archives');
  const [archiveSubfolderPattern, setArchiveSubfolderPattern] = useState('{YYYY}/{MM} - {MMMM}');

  useEffect(() => {
    if (!settings) return;

    const parseNumber = (value: any, fallback: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const parseBoolean = (value: any, fallback: boolean) => {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fallback;
    };

    setAppName(settings.app_name || 'WebMail');
    setAllowRegistration(parseBoolean(settings.allow_registration, false));
    setMaxAttachmentSize(parseNumber(settings.max_attachment_size, 25));
    setAttachmentVisibilityMinKb(Math.max(0, parseNumber(settings.attachment_visibility_min_kb, 10)));
    setArchiveRootFolder(typeof settings.archive_root_folder === 'string' && settings.archive_root_folder.trim()
      ? settings.archive_root_folder : 'Archives');
    setArchiveSubfolderPattern(typeof settings.archive_subfolder_pattern === 'string' && settings.archive_subfolder_pattern.trim()
      ? settings.archive_subfolder_pattern : '{YYYY}/{MM} - {MMMM}');
  }, [settings]);

  const handleSave = () => {
    updateMutation.mutate({
      app_name: appName,
      allow_registration: allowRegistration,
      max_attachment_size: Math.max(1, Math.round(maxAttachmentSize)),
      attachment_visibility_min_kb: Math.max(0, Math.round(attachmentVisibilityMinKb)),
      archive_root_folder: archiveRootFolder.trim() || 'Archives',
      archive_subfolder_pattern: archiveSubfolderPattern.trim() || '{YYYY}/{MM} - {MMMM}',
    });
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-4">Paramètres système</h3>
      <div className="space-y-4">
        <div>
          <label className="text-sm text-outlook-text-secondary">Nom de l'application</label>
          <input
            type="text"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Inscription ouverte</label>
          <select
            value={allowRegistration ? 'true' : 'false'}
            onChange={(e) => setAllowRegistration(e.target.value === 'true')}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          >
            <option value="true">Oui</option>
            <option value="false">Non (admin seulement)</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Taille max des pièces jointes (Mo)</label>
          <input
            type="number"
            min={1}
            value={maxAttachmentSize}
            onChange={(e) => setMaxAttachmentSize(Number(e.target.value || 1))}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-sm text-outlook-text-secondary">Masquer les pièces jointes inférieures à (Ko)</label>
          <input
            type="number"
            min={0}
            value={attachmentVisibilityMinKb}
            onChange={(e) => setAttachmentVisibilityMinKb(Number(e.target.value || 0))}
            className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
          />
          <p className="text-xs text-outlook-text-disabled mt-1">
            Par défaut: 10 Ko. Les pièces jointes plus petites (souvent des icônes inline) seront masquées dans la vue du mail.
          </p>
        </div>

        <div className="border-t border-outlook-border pt-4 mt-2">
          <h4 className="text-sm font-semibold mb-2">Archivage des mails</h4>
          <p className="text-xs text-outlook-text-disabled mb-3">
            Lorsqu'un utilisateur clique sur « Archiver », le message est déplacé dans une arborescence
            basée sur la date de réception. Les dossiers manquants sont créés automatiquement.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-outlook-text-secondary">Dossier racine d'archive</label>
              <input
                type="text"
                value={archiveRootFolder}
                onChange={(e) => setArchiveRootFolder(e.target.value)}
                placeholder="Archives"
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
              />
              <p className="text-xs text-outlook-text-disabled mt-1">
                Par défaut : <code>Archives</code>
              </p>
            </div>
            <div>
              <label className="text-sm text-outlook-text-secondary">Motif des sous-dossiers</label>
              <input
                type="text"
                value={archiveSubfolderPattern}
                onChange={(e) => setArchiveSubfolderPattern(e.target.value)}
                placeholder="{YYYY}/{MM} - {MMMM}"
                className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 font-mono"
              />
              <p className="text-xs text-outlook-text-disabled mt-1">
                Séparateur <code>/</code>. Jetons disponibles : <code>{'{YYYY}'}</code> (année),
                <code>{' {YY}'}</code>, <code>{' {MM}'}</code> (mois 01-12), <code>{' {M}'}</code> (mois 1-12),
                <code>{' {MMMM}'}</code> (nom complet&nbsp;: Janvier…), <code>{' {MMM}'}</code> (abrégé).
                Exemple : <code>{'{YYYY}/{MM} - {MMMM}'}</code> → <code>{(archiveRootFolder || 'Archives') + '/2026/04 - Avril'}</code>.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="border-t border-outlook-border mt-8 pt-6">
        <BrandingSettings />
      </div>
    </div>
  );
}

// ─── Branding (favicon / PWA icons) ─────────────────────────────────────────────
//
// Admins can upload custom images for the PWA manifest and browser tab favicon.
// Files are stored on the server and served at the canonical paths
// (/favicon.ico, /icon-192.png, etc.) — uploaded versions automatically replace
// the static bundled assets without a rebuild.
function BrandingSettings() {
  const queryClient = useQueryClient();
  const { data: branding, refetch } = useQuery({
    queryKey: ['branding'],
    queryFn: api.getBranding,
  });

  const [uploading, setUploading] = useState<string | null>(null);

  type IconType = 'favicon' | 'icon192' | 'icon512' | 'apple';

  const iconMeta: Array<{ type: IconType; label: string; hint: string }> = [
    { type: 'favicon', label: 'Favicon (onglet navigateur)', hint: 'Format .ico recommandé (32×32 ou 48×48)' },
    { type: 'icon192', label: 'Icône PWA 192×192', hint: 'PNG 192×192 — utilisée sur Android' },
    { type: 'icon512', label: 'Icône PWA 512×512', hint: 'PNG 512×512 — utilisée pour l\'écran de démarrage et les magasins' },
    { type: 'apple', label: 'Icône Apple Touch 180×180', hint: 'PNG 180×180 — utilisée sur iOS' },
  ];

  const handleUpload = async (type: IconType, file: File) => {
    try {
      setUploading(type);
      await api.uploadBrandingIcon(type, file);
      toast.success('Icône mise à jour');
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['branding'] });
    } catch (err: any) {
      toast.error(err?.message || 'Échec du téléversement');
    } finally {
      setUploading(null);
    }
  };

  const handleReset = async (type: IconType) => {
    try {
      await api.resetBrandingIcon(type);
      toast.success('Icône réinitialisée');
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['branding'] });
    } catch (err: any) {
      toast.error(err?.message || 'Échec de la réinitialisation');
    }
  };

  return (
    <div>
      <h3 className="text-base font-semibold mb-1">Branding & icônes</h3>
      <p className="text-xs text-outlook-text-disabled mb-4">
        Personnalisez le favicon du navigateur et les icônes de l'application web progressive (PWA).
        Les modifications sont appliquées immédiatement après un rafraîchissement du navigateur
        (supprimez le cache si besoin).
      </p>
      <div className="space-y-4">
        {iconMeta.map(({ type, label, hint }) => {
          const url = branding?.icons?.[type];
          const custom = branding?.custom?.[type];
          return (
            <div key={type} className="flex items-center gap-4 border border-outlook-border rounded-md p-3">
              <div className="w-14 h-14 flex-shrink-0 flex items-center justify-center bg-outlook-bg-hover rounded border border-outlook-border overflow-hidden">
                {url ? (
                  <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-xs text-outlook-text-disabled">—</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-outlook-text-disabled">{hint}</div>
                {custom && (
                  <div className="text-xs text-green-600 mt-0.5">✓ Image personnalisée active</div>
                )}
              </div>
              <label className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-xs cursor-pointer disabled:opacity-50">
                {uploading === type ? 'Envoi…' : 'Téléverser'}
                <input
                  type="file"
                  accept={type === 'favicon' ? 'image/x-icon,image/vnd.microsoft.icon,image/png,image/jpeg' : 'image/png,image/jpeg,image/webp'}
                  className="hidden"
                  disabled={uploading === type}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(type, f);
                    e.target.value = '';
                  }}
                />
              </label>
              {custom && (
                <button
                  onClick={() => handleReset(type)}
                  className="text-xs text-outlook-text-secondary hover:text-red-600 px-2 py-1"
                  title="Revenir à l'icône par défaut"
                >
                  Réinitialiser
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Login page appearance ─────────────────────────────────────────────────────
//
// Lets administrators customize the public login screen: wallpaper with blur,
// overlay, card colors, accent color, custom title/subtitle, and toggles for
// the "create account" and "passkey" buttons. All values are persisted in the
// admin_settings table and exposed via the public /api/branding endpoint.
function LoginAppearanceSettings() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ['admin-settings'], queryFn: api.getAdminSettings });
  const { data: branding, refetch: refetchBranding } = useQuery({
    queryKey: ['branding'],
    queryFn: api.getBranding,
  });

  const updateMutation = useMutation({
    mutationFn: api.updateAdminSettings,
    onSuccess: () => {
      toast.success('Apparence de la page de connexion enregistrée');
      queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
      queryClient.invalidateQueries({ queryKey: ['branding'] });
      queryClient.invalidateQueries({ queryKey: ['branding-public'] });
    },
  });

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [blur, setBlur] = useState(0);
  const [overlay, setOverlay] = useState('');
  const [cardBg, setCardBg] = useState('');
  const [cardText, setCardText] = useState('');
  const [accent, setAccent] = useState('');
  const [accentHover, setAccentHover] = useState('');
  const [showRegister, setShowRegister] = useState(true);
  const [showPasskey, setShowPasskey] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const str = (v: any, f = '') => (typeof v === 'string' ? v : f);
    const num = (v: any, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
    const bool = (v: any, f = true) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : f);
    setTitle(str(settings.login_title));
    setSubtitle(str(settings.login_subtitle));
    setBgColor(str(settings.login_background_color));
    setBlur(num(settings.login_background_blur, 0));
    setOverlay(str(settings.login_background_overlay));
    setCardBg(str(settings.login_card_bg_color));
    setCardText(str(settings.login_card_text_color));
    setAccent(str(settings.login_accent_color));
    setAccentHover(str(settings.login_accent_hover_color));
    setShowRegister(bool(settings.login_show_register, true));
    setShowPasskey(bool(settings.login_show_passkey_button, true));
  }, [settings]);

  const save = () => {
    updateMutation.mutate({
      login_title: title.trim() || null,
      login_subtitle: subtitle.trim() || null,
      login_background_color: bgColor.trim() || null,
      login_background_blur: Math.max(0, Math.min(30, Math.round(blur))),
      login_background_overlay: overlay.trim() || null,
      login_card_bg_color: cardBg.trim() || null,
      login_card_text_color: cardText.trim() || null,
      login_accent_color: accent.trim() || null,
      login_accent_hover_color: accentHover.trim() || null,
      login_show_register: showRegister,
      login_show_passkey_button: showPasskey,
    });
  };

  const handleUploadBg = async (file: File) => {
    try {
      setUploading(true);
      await api.uploadLoginBackground(file);
      toast.success('Fond d\'écran mis à jour');
      await refetchBranding();
      queryClient.invalidateQueries({ queryKey: ['branding-public'] });
    } catch (err: any) {
      toast.error(err?.message || 'Échec du téléversement');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveBg = async () => {
    try {
      await api.deleteLoginBackground();
      toast.success('Fond d\'écran supprimé');
      await refetchBranding();
      queryClient.invalidateQueries({ queryKey: ['branding-public'] });
    } catch (err: any) {
      toast.error(err?.message || 'Échec de la suppression');
    }
  };

  const appearance = branding?.login_appearance;
  const appName = branding?.app_name || 'WebMail';

  return (
    <div>
      <h3 className="text-base font-semibold mb-1">Apparence de la page de connexion</h3>
      <p className="text-xs text-outlook-text-disabled mb-6">
        Personnalisez l'écran de connexion que voient tous les utilisateurs : fond d'écran,
        floutage, couleurs de la modale, bouton principal et options affichées.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Contrôles ─────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Textes */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Textes</h4>
            <label className="block text-xs text-outlook-text-secondary mt-2">Titre (par défaut : nom de l'app)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={appName}
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
            />
            <label className="block text-xs text-outlook-text-secondary mt-3">Sous-titre</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="Connectez-vous à votre messagerie"
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1"
            />
          </div>

          {/* Arrière-plan */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Arrière-plan</h4>

            <div className="border border-outlook-border rounded-md p-3 mb-3">
              <div className="text-xs text-outlook-text-secondary mb-2">Image de fond</div>
              {appearance?.backgroundImage ? (
                <div className="flex items-center gap-3">
                  <img src={appearance.backgroundImage} alt="" className="w-24 h-16 object-cover rounded border border-outlook-border" />
                  <div className="flex-1 text-xs text-green-600">✓ Image personnalisée active</div>
                  <button
                    onClick={handleRemoveBg}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Supprimer
                  </button>
                </div>
              ) : (
                <div className="text-xs text-outlook-text-disabled">Aucune image</div>
              )}
              <label className="inline-block mt-2 bg-outlook-blue hover:bg-outlook-blue-hover text-white px-3 py-1.5 rounded-md text-xs cursor-pointer">
                {uploading ? 'Envoi…' : 'Téléverser une image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadBg(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="text-xs text-outlook-text-disabled mt-1">
                PNG, JPEG, WEBP ou GIF. Max 10 Mo. Recommandé : 1920×1080 ou plus.
              </p>
            </div>

            <label className="block text-xs text-outlook-text-secondary">
              Couleur de fond (ignorée si une image est présente)
            </label>
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                value={bgColor || '#0078d4'}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-10 w-14 rounded border border-outlook-border cursor-pointer"
              />
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                placeholder="#0078d4 ou linear-gradient(…)"
                className="flex-1 border border-outlook-border rounded-md px-3 py-2 text-sm font-mono"
              />
            </div>

            <label className="block text-xs text-outlook-text-secondary mt-3">
              Flou d'arrière-plan : <span className="font-semibold">{blur}px</span>
            </label>
            <input
              type="range"
              min={0}
              max={30}
              value={blur}
              onChange={(e) => setBlur(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-xs text-outlook-text-disabled">
              S'applique uniquement si une image de fond est définie. 0 = net, 30 = très flou.
            </p>

            <label className="block text-xs text-outlook-text-secondary mt-3">
              Superposition (rgba/hex) — ex. <code>rgba(0,0,0,0.4)</code>
            </label>
            <input
              type="text"
              value={overlay}
              onChange={(e) => setOverlay(e.target.value)}
              placeholder="rgba(0,0,0,0.4)"
              className="w-full border border-outlook-border rounded-md px-3 py-2 text-sm mt-1 font-mono"
            />
            <p className="text-xs text-outlook-text-disabled">
              Calque placé au-dessus de l'image pour améliorer la lisibilité.
            </p>
          </div>

          {/* Modale */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Modale de connexion</h4>

            <label className="block text-xs text-outlook-text-secondary">Couleur de fond de la modale</label>
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                value={cardBg || '#ffffff'}
                onChange={(e) => setCardBg(e.target.value)}
                className="h-10 w-14 rounded border border-outlook-border cursor-pointer"
              />
              <input
                type="text"
                value={cardBg}
                onChange={(e) => setCardBg(e.target.value)}
                placeholder="#ffffff ou rgba(255,255,255,0.9)"
                className="flex-1 border border-outlook-border rounded-md px-3 py-2 text-sm font-mono"
              />
            </div>

            <label className="block text-xs text-outlook-text-secondary mt-3">Couleur du texte du titre</label>
            <div className="flex gap-2 mt-1">
              <input
                type="color"
                value={cardText || '#323130'}
                onChange={(e) => setCardText(e.target.value)}
                className="h-10 w-14 rounded border border-outlook-border cursor-pointer"
              />
              <input
                type="text"
                value={cardText}
                onChange={(e) => setCardText(e.target.value)}
                placeholder="#323130"
                className="flex-1 border border-outlook-border rounded-md px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          {/* Accent */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Couleur d'accent (bouton principal)</h4>
            <div className="flex gap-2">
              <input
                type="color"
                value={accent || '#0078d4'}
                onChange={(e) => setAccent(e.target.value)}
                className="h-10 w-14 rounded border border-outlook-border cursor-pointer"
              />
              <input
                type="text"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder="#0078d4"
                className="flex-1 border border-outlook-border rounded-md px-3 py-2 text-sm font-mono"
              />
            </div>
            <p className="text-xs text-outlook-text-disabled mt-1">
              Utilisée pour le logo, le bouton « Se connecter » et les liens.
            </p>
          </div>

          {/* Options */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Options affichées</h4>
            <label className="flex items-center gap-2 text-sm py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showPasskey}
                onChange={(e) => setShowPasskey(e.target.checked)}
              />
              Afficher le bouton « Se connecter avec une clé d'accès »
            </label>
            <label className="flex items-center gap-2 text-sm py-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showRegister}
                onChange={(e) => setShowRegister(e.target.checked)}
              />
              Afficher le lien « Créer un compte »
            </label>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              onClick={save}
              disabled={updateMutation.isPending}
              className="bg-outlook-blue hover:bg-outlook-blue-hover text-white px-4 py-2 rounded-md text-sm disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              onClick={() => {
                setTitle(''); setSubtitle('');
                setBgColor(''); setBlur(0); setOverlay('');
                setCardBg(''); setCardText('');
                setAccent(''); setAccentHover('');
                setShowRegister(true); setShowPasskey(true);
              }}
              className="border border-outlook-border px-4 py-2 rounded-md text-sm hover:bg-outlook-bg-hover"
            >
              Réinitialiser
            </button>
          </div>
        </div>

        {/* ── Prévisualisation ──────────────────────────────────── */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Aperçu</h4>
          <LoginPreview
            title={title || appName}
            subtitle={subtitle || 'Connectez-vous à votre messagerie'}
            backgroundColor={bgColor}
            backgroundImage={appearance?.backgroundImage || null}
            backgroundBlur={blur}
            backgroundOverlay={overlay}
            cardBg={cardBg}
            cardText={cardText}
            accent={accent}
            showPasskey={showPasskey}
            showRegister={showRegister}
          />
          <p className="text-xs text-outlook-text-disabled mt-2">
            Les modifications sont visibles immédiatement sur la page de connexion après
            enregistrement. Le bouton « clé d'accès » n'apparaît qu'aux navigateurs qui
            supportent WebAuthn.
          </p>
        </div>
      </div>
    </div>
  );
}

function LoginPreview({
  title, subtitle, backgroundColor, backgroundImage, backgroundBlur, backgroundOverlay,
  cardBg, cardText, accent, showPasskey, showRegister,
}: {
  title: string;
  subtitle: string;
  backgroundColor: string;
  backgroundImage: string | null;
  backgroundBlur: number;
  backgroundOverlay: string;
  cardBg: string;
  cardText: string;
  accent: string;
  showPasskey: boolean;
  showRegister: boolean;
}) {
  const rootStyle: React.CSSProperties = backgroundImage
    ? {}
    : { background: backgroundColor || 'linear-gradient(135deg,#0078d4,#106ebe)' };
  const cardStyle: React.CSSProperties = {};
  if (cardBg) cardStyle.backgroundColor = cardBg;
  if (cardText) cardStyle.color = cardText;
  const btnStyle: React.CSSProperties = accent ? { backgroundColor: accent } : { backgroundColor: '#0078d4' };

  return (
    <div
      className="relative h-80 rounded-lg overflow-hidden border border-outlook-border"
      style={rootStyle}
    >
      {backgroundImage && (
        <div
          aria-hidden
          className="absolute inset-0 bg-center bg-cover"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
            transform: backgroundBlur > 0 ? 'scale(1.1)' : undefined,
          }}
        />
      )}
      {backgroundImage && backgroundOverlay && (
        <div aria-hidden className="absolute inset-0" style={{ background: backgroundOverlay }} />
      )}
      <div className="relative h-full flex items-center justify-center p-4">
        <div
          className="bg-white rounded-lg shadow-xl p-5 w-full max-w-[260px] text-center"
          style={cardStyle}
        >
          <div
            className="w-10 h-10 rounded-md flex items-center justify-center mx-auto mb-2"
            style={btnStyle}
          >
            <Mail size={18} className="text-white" />
          </div>
          <div className="text-sm font-semibold truncate" style={cardText ? { color: cardText } : undefined}>
            {title}
          </div>
          <div className="text-[10px] text-outlook-text-secondary mt-0.5 truncate">
            {subtitle}
          </div>
          {showPasskey && (
            <div className="mt-3 border border-outlook-border rounded px-2 py-1.5 text-[10px]">
              🔑 Se connecter avec une clé d'accès
            </div>
          )}
          <div className="mt-2 space-y-1">
            <div className="h-5 bg-outlook-bg-hover rounded" />
            <div className="h-5 bg-outlook-bg-hover rounded" />
          </div>
          <div
            className="mt-2 rounded py-1 text-[10px] text-white font-medium"
            style={btnStyle}
          >
            Se connecter
          </div>
          {showRegister && (
            <div
              className="mt-2 text-[10px]"
              style={accent ? { color: accent } : { color: '#0078d4' }}
            >
              Créer un compte
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// end marker

// ========================================
// Device Sessions Management (admin)
// ========================================
//
// Shows every active device session across all users so an admin can audit
// logins and remotely sign out a single device or every device of a user.
// Users are grouped in collapsible cards (collapsed by default) to stay
// readable with many users, and a search box filters users by name or email.

function DeviceSessionsManagement() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: groups, isLoading } = useQuery({
    queryKey: ['admin-devices'],
    queryFn: () => api.adminListDevices(),
    refetchOnWindowFocus: true,
  });

  const revokeOne = useMutation({
    mutationFn: (id: string) => api.adminRevokeDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-devices'] });
      toast.success('Appareil déconnecté');
    },
    onError: () => toast.error('Impossible de déconnecter cet appareil'),
  });

  const revokeAll = useMutation({
    mutationFn: (userId: string) => api.adminRevokeUserDevices(userId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin-devices'] });
      toast.success(`${res.revoked} appareil(s) déconnecté(s)`);
    },
    onError: () => toast.error('Impossible de déconnecter les appareils'),
  });

  const filtered = useMemo(() => {
    if (!groups) return [];
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) =>
      (g.displayName || '').toLowerCase().includes(q) ||
      g.email.toLowerCase().includes(q),
    );
  }, [groups, search]);

  // Autocomplete suggestions: distinct users matching the current query,
  // sorted by display name. Shown below the input as clickable chips.
  const suggestions = useMemo(() => {
    if (!groups) return [];
    const q = search.trim().toLowerCase();
    if (!q || q.length < 1) return [];
    const matched = groups
      .filter((g) =>
        (g.displayName || '').toLowerCase().includes(q) ||
        g.email.toLowerCase().includes(q),
      )
      .slice(0, 6);
    // Only show suggestions if the search does not already match exactly one user
    if (matched.length === 1 && (matched[0].email.toLowerCase() === q || (matched[0].displayName || '').toLowerCase() === q)) {
      return [];
    }
    return matched;
  }, [groups, search]);

  const toggle = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set((filtered || []).map((g) => g.userId)));
  const collapseAll = () => setExpanded(new Set());

  const iconFor = (ua: string | null) => {
    const lower = (ua || '').toLowerCase();
    if (lower.includes('iphone') || lower.includes('android')) return Smartphone;
    if (lower.includes('ipad') || lower.includes('tablet')) return Tablet;
    return Monitor;
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return iso; }
  };

  const totalDevices = (filtered || []).reduce((n, g) => n + g.devices.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold mb-1">Appareils connectés</h3>
        <p className="text-sm text-outlook-text-secondary">
          Toutes les sessions actives de l'instance, groupées par utilisateur.
          Vous pouvez déconnecter un appareil précis ou tous les appareils d'un
          utilisateur (par ex. en cas de départ ou de compte compromis).
        </p>
      </div>

      {/* Search + controls */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-outlook-text-disabled" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un utilisateur (nom ou email)…"
              className="w-full pl-7 pr-3 py-2 text-sm border border-outlook-border rounded bg-white"
            />
          </div>
          <button
            onClick={expandAll}
            className="text-xs px-3 py-2 border border-outlook-border rounded bg-white hover:bg-outlook-bg-hover"
          >
            Tout déplier
          </button>
          <button
            onClick={collapseAll}
            className="text-xs px-3 py-2 border border-outlook-border rounded bg-white hover:bg-outlook-bg-hover"
          >
            Tout replier
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="absolute z-10 left-0 right-[8.5rem] mt-1 bg-white border border-outlook-border rounded shadow-md overflow-hidden">
            {suggestions.map((s) => (
              <button
                key={s.userId}
                onClick={() => {
                  setSearch(s.email);
                  setExpanded((prev) => new Set(prev).add(s.userId));
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-outlook-bg-hover"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-outlook-text-primary">
                    {s.displayName || s.email}
                  </div>
                  <div className="truncate text-xs text-outlook-text-secondary">{s.email}</div>
                </div>
                <span className="text-xs text-outlook-text-disabled whitespace-nowrap">
                  {s.devices.length} appareil{s.devices.length > 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isLoading && <div className="text-sm text-outlook-text-secondary">Chargement…</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-sm text-outlook-text-secondary p-6 text-center border border-dashed border-outlook-border rounded">
          {search ? 'Aucun utilisateur ne correspond à cette recherche.' : 'Aucune session active.'}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="text-xs text-outlook-text-disabled">
          {filtered.length} utilisateur{filtered.length > 1 ? 's' : ''} · {totalDevices} appareil{totalDevices > 1 ? 's' : ''} connecté{totalDevices > 1 ? 's' : ''}
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((group) => {
          const isOpen = expanded.has(group.userId);
          const pending = revokeAll.isPending && revokeAll.variables === group.userId;
          return (
            <div key={group.userId} className="border border-outlook-border rounded bg-white overflow-hidden">
              {/* Header (click to expand) */}
              <button
                onClick={() => toggle(group.userId)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-outlook-bg-hover text-left"
              >
                {isOpen
                  ? <ChevronDown size={16} className="text-outlook-text-secondary flex-shrink-0" />
                  : <ChevronRight size={16} className="text-outlook-text-secondary flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-outlook-text-primary truncate">
                      {group.displayName || group.email}
                    </span>
                    {group.isAdmin && (
                      <span className="text-2xs uppercase tracking-wide px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                        Admin
                      </span>
                    )}
                  </div>
                  {group.displayName && (
                    <div className="text-xs text-outlook-text-secondary truncate">{group.email}</div>
                  )}
                </div>
                <span className="text-xs text-outlook-text-secondary whitespace-nowrap">
                  {group.devices.length} appareil{group.devices.length > 1 ? 's' : ''}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!window.confirm(`Déconnecter les ${group.devices.length} appareil(s) de ${group.displayName || group.email} ?`)) return;
                    revokeAll.mutate(group.userId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      if (!window.confirm(`Déconnecter les ${group.devices.length} appareil(s) de ${group.displayName || group.email} ?`)) return;
                      revokeAll.mutate(group.userId);
                    }
                  }}
                  aria-disabled={pending}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors text-red-600 hover:bg-red-50 ${pending ? 'opacity-50 pointer-events-none' : ''}`}
                  title="Déconnecter tous les appareils de cet utilisateur"
                >
                  <LogOut size={12} /> Tout déconnecter
                </span>
              </button>

              {/* Devices */}
              {isOpen && (
                <div className="border-t border-outlook-border divide-y divide-outlook-border bg-outlook-bg-primary/40">
                  {group.devices.map((device) => {
                    const Icon = iconFor(device.userAgent);
                    return (
                      <div key={device.id} className="flex items-start gap-3 px-3 py-2.5">
                        <div className="w-9 h-9 rounded-full bg-outlook-bg-hover flex items-center justify-center flex-shrink-0">
                          <Icon size={16} className="text-outlook-text-secondary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-outlook-text-primary truncate">
                            {device.deviceName || 'Appareil'}
                          </div>
                          <div className="text-xs text-outlook-text-secondary truncate">
                            Dernière utilisation : {formatDate(device.lastUsedAt)}
                            {device.ipLastSeen && <> · {device.ipLastSeen}</>}
                          </div>
                          <div className="text-xs text-outlook-text-disabled truncate">
                            Connecté le {formatDate(device.createdAt)} · expire le {formatDate(device.expiresAt)}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (!window.confirm('Déconnecter cet appareil ?')) return;
                            revokeOne.mutate(device.id);
                          }}
                          disabled={revokeOne.isPending}
                          className="flex items-center gap-1 text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50"
                          title="Déconnecter cet appareil"
                        >
                          <Trash2 size={12} /> Déconnecter
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
