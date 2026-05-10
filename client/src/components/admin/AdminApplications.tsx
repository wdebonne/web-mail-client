import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor, Smartphone, Globe, Download, Play, Trash2,
  CheckCircle, XCircle, Loader2, Terminal, Package,
  RefreshCw, AlertTriangle, Info, Github, ExternalLink,
  Server, Cpu,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Env detection ─────────────────────────────────────────────────────────────

type Env = 'tauri' | 'pwa' | 'web';

function detectEnv(): Env {
  if (typeof window === 'undefined') return 'web';
  if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) return 'tauri';
  if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true) return 'pwa';
  return 'web';
}

// ── API ───────────────────────────────────────────────────────────────────────

const API = '/api/admin/applications';

function authHeaders() {
  const token = localStorage.getItem('auth_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getInfo() {
  const res = await fetch(`${API}/info`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    builderAvailable: boolean;
    builderUrl: string;
    builds: Array<{ filename: string; platform: string; size: number; builtAt: string }>;
  }>;
}

async function triggerDockerBuild(serverUrl: string) {
  const res = await fetch(`${API}/build/docker`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ serverUrl }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

async function triggerGithubBuild(payload: { token: string; owner: string; repo: string; serverUrl: string; version: string }) {
  const res = await fetch(`${API}/build/github`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json() as Promise<{ runUrl?: string }>;
}

async function getGithubRuns(token: string, owner: string, repo: string) {
  const params = new URLSearchParams({ token, owner, repo });
  const res = await fetch(`${API}/build/github/runs?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Array<{ id: number; status: string; conclusion: string | null; createdAt: string; htmlUrl: string }>>;
}

async function deleteFile(filename: string) {
  const res = await fetch(`${API}/download/${encodeURIComponent(filename)}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json()).error);
}

function formatBytes(b: number) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${s[i]}`;
}

const PLATFORM_ICON: Record<string, string> = {
  windows: '🪟', linux: '🐧', macos: '🍎', android: '🤖', unknown: '📦',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function EnvBadge({ env }: { env: Env }) {
  const cfg = {
    tauri: { icon: Monitor, label: 'Application Desktop (Tauri)', color: 'bg-purple-100 text-purple-700 border-purple-200' },
    pwa:   { icon: Smartphone, label: 'PWA installée', color: 'bg-green-100 text-green-700 border-green-200' },
    web:   { icon: Globe, label: 'Navigateur Web', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  }[env];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${cfg.color}`}>
      <Icon size={15} /> {cfg.label}
    </span>
  );
}

function PwaSection() {
  const [canInstall, setCanInstall] = useState(false);
  const prompt = useRef<any>(null);
  const env = detectEnv();

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); prompt.current = e; setCanInstall(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!prompt.current) return;
    prompt.current.prompt();
    const { outcome } = await prompt.current.userChoice;
    if (outcome === 'accepted') { toast.success('PWA installée !'); prompt.current = null; setCanInstall(false); }
  };

  return (
    <section className="border border-outlook-border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-outlook-text-primary mb-2 flex items-center gap-2">
        <Smartphone size={16} /> Application Web Progressive (PWA)
      </h3>
      <p className="text-xs text-outlook-text-secondary mb-3">
        Installe l'application comme une app native — fonctionne hors-ligne, raccourci bureau, notifications push.
      </p>
      {env === 'pwa' && <StatusChip ok icon={<CheckCircle size={13} />} text="PWA déjà installée sur cet appareil." color="green" />}
      {env === 'tauri' && <StatusChip icon={<Info size={13} />} text="Vous utilisez déjà l'application desktop." color="purple" />}
      {env === 'web' && canInstall && (
        <button onClick={install}
          className="flex items-center gap-2 px-4 py-2 bg-outlook-blue text-white rounded text-sm hover:bg-blue-700 transition-colors">
          <Download size={15} /> Installer la PWA
        </button>
      )}
      {env === 'web' && !canInstall && (
        <StatusChip icon={<Info size={13} />} text="Installation PWA non disponible dans ce navigateur ou déjà installée." color="gray" />
      )}
    </section>
  );
}

function StatusChip({ icon, text, color, ok }: { icon: React.ReactNode; text: string; color: string; ok?: boolean }) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 border-green-200 text-green-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    gray: 'bg-outlook-bg-hover border-outlook-border text-outlook-text-secondary',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <div className={`flex items-center gap-2 text-sm border rounded px-3 py-2 ${colors[color]}`}>
      {icon} {text}
    </div>
  );
}

function LogConsole({ lines, status }: { lines: string[]; status: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1 text-xs text-outlook-text-secondary">
        <Terminal size={13} /> Sortie du build
        {status === 'running' && <Loader2 size={12} className="animate-spin text-outlook-blue" />}
        {status === 'success' && <CheckCircle size={12} className="text-green-600" />}
        {status === 'error' && <XCircle size={12} className="text-red-600" />}
      </div>
      <div ref={ref}
        className="bg-gray-950 text-green-400 rounded text-[11px] font-mono p-3 h-48 overflow-y-auto leading-relaxed">
        {lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

// ── Docker builder section ────────────────────────────────────────────────────

function DockerBuilderSection({ builderAvailable }: { builderAvailable: boolean }) {
  const queryClient = useQueryClient();
  const [serverUrl, setServerUrl] = useState(window.location.origin);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [buildStatus, setBuildStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const esRef = useRef<EventSource | null>(null);

  const openLogStream = () => {
    if (esRef.current) esRef.current.close();
    const token = localStorage.getItem('auth_token') ?? '';
    const es = new EventSource(`${API}/build/docker/log?_token=${token}`);
    esRef.current = es;
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'log') setLogLines(p => [...p, msg.line]);
      if (msg.type === 'status') {
        setBuildStatus(msg.status);
        if (msg.status !== 'running') {
          es.close();
          queryClient.invalidateQueries({ queryKey: ['admin-applications'] });
          if (msg.status === 'success') toast.success('Build Linux terminé !');
          else if (msg.status !== 'idle') toast.error('Build échoué');
        }
      }
    };
    es.onerror = () => { es.close(); setBuildStatus('error'); };
  };

  const buildMutation = useMutation({
    mutationFn: () => triggerDockerBuild(serverUrl.trim()),
    onSuccess: () => { setBuildStatus('running'); setLogLines([]); openLogStream(); },
    onError: (e: any) => { toast.error(e.message); setBuildStatus('error'); },
  });

  return (
    <section className="border border-outlook-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
        <Server size={16} /> Build Linux via Docker <span className="text-xs font-normal text-outlook-text-secondary">(conteneur tauri-builder)</span>
      </h3>

      <div className="flex flex-wrap gap-2 text-xs">
        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded border ${builderAvailable ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {builderAvailable ? <CheckCircle size={12} /> : <XCircle size={12} />}
          {builderAvailable ? 'Conteneur actif' : 'Conteneur hors ligne'}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded border bg-blue-50 border-blue-200 text-blue-700">
          <Package size={12} /> Produit: .deb + .AppImage
        </div>
      </div>

      {!builderAvailable && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded p-3 space-y-1">
          <div className="font-medium flex items-center gap-1.5"><AlertTriangle size={13} /> Conteneur builder non démarré</div>
          <div>Dans Portainer, activez le service <code className="bg-amber-100 px-1 rounded">tauri-builder</code> :</div>
          <code className="block bg-amber-100 px-2 py-1 rounded mt-1">
            docker compose --profile builder up -d tauri-builder
          </code>
          <div className="text-amber-600 pt-1">Le premier démarrage installe Rust (~5 min). Les suivants sont instantanés.</div>
        </div>
      )}

      <div className="flex gap-2">
        <input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
          placeholder="https://mail.mondomaine.com"
          disabled={!builderAvailable || buildStatus === 'running'}
          className="flex-1 text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-outlook-blue disabled:opacity-50" />
        <button
          onClick={() => buildMutation.mutate()}
          disabled={!builderAvailable || buildStatus === 'running'}
          className="flex items-center gap-2 px-4 py-1.5 bg-outlook-blue text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap">
          {buildStatus === 'running'
            ? <><Loader2 size={14} className="animate-spin" /> En cours…</>
            : <><Play size={14} /> Générer Linux</>}
        </button>
      </div>

      <LogConsole lines={logLines} status={buildStatus} />
    </section>
  );
}

// ── GitHub Actions section ────────────────────────────────────────────────────

function GithubActionsSection() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [serverUrl, setServerUrl] = useState(window.location.origin);
  const [version, setVersion] = useState('1.6.0');
  const [showToken, setShowToken] = useState(false);
  const [runUrl, setRunUrl] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['github-runs', owner, repo, token],
    queryFn: () => getGithubRuns(token, owner, repo),
    enabled: !!(token && owner && repo),
    refetchInterval: 30000,
  });

  const buildMutation = useMutation({
    mutationFn: () => triggerGithubBuild({ token, owner, repo, serverUrl, version }),
    onSuccess: (data) => {
      setRunUrl(data.runUrl ?? null);
      toast.success('Workflow GitHub Actions déclenché !');
      queryClient.invalidateQueries({ queryKey: ['github-runs'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const statusColor = (status: string, conclusion: string | null) => {
    if (status === 'in_progress' || status === 'queued') return 'text-blue-600 bg-blue-50 border-blue-200';
    if (conclusion === 'success') return 'text-green-700 bg-green-50 border-green-200';
    if (conclusion === 'failure') return 'text-red-700 bg-red-50 border-red-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  const statusLabel = (status: string, conclusion: string | null) => {
    if (status === 'queued') return '⏳ En attente';
    if (status === 'in_progress') return '⚙️ En cours';
    if (conclusion === 'success') return '✅ Succès';
    if (conclusion === 'failure') return '❌ Échoué';
    if (conclusion === 'cancelled') return '⏹ Annulé';
    return status;
  };

  return (
    <section className="border border-outlook-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
        <Github size={16} /> Build multi-plateforme via GitHub Actions
      </h3>
      <p className="text-xs text-outlook-text-secondary">
        Déclenche un workflow sur runners GitHub (Windows, Linux, macOS). Produit <strong>.exe/.msi + .deb/.AppImage + .dmg</strong>. Les artefacts sont disponibles dans GitHub puis téléchargeables ici.
      </p>

      {/* Config */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-outlook-text-primary mb-1">Owner GitHub</label>
          <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="mon-org"
            className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-outlook-blue" />
        </div>
        <div>
          <label className="block text-xs font-medium text-outlook-text-primary mb-1">Repo</label>
          <input value={repo} onChange={e => setRepo(e.target.value)} placeholder="web-mail-client"
            className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-outlook-blue" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-outlook-text-primary mb-1">Token GitHub (scope: <code>workflow</code>)</label>
          <div className="flex gap-1">
            <input type={showToken ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="flex-1 text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-outlook-blue font-mono" />
            <button onClick={() => setShowToken(v => !v)}
              className="px-2 text-xs border border-outlook-border rounded hover:bg-outlook-bg-hover">
              {showToken ? 'Masquer' : 'Voir'}
            </button>
          </div>
          <p className="text-xs text-outlook-text-disabled mt-0.5">
            Créez un token sur <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="underline">github.com/settings/tokens</a> avec le scope <code>workflow</code>.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-outlook-text-primary mb-1">URL du serveur</label>
          <input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
            placeholder="https://mail.mondomaine.com"
            className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-outlook-blue" />
        </div>
        <div>
          <label className="block text-xs font-medium text-outlook-text-primary mb-1">Version</label>
          <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.6.0"
            className="w-full text-sm border border-outlook-border rounded px-2 py-1.5 bg-white focus:outline-none focus:border-outlook-blue" />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => buildMutation.mutate()}
          disabled={!token || !owner || !repo || buildMutation.isPending}
          className="flex items-center gap-2 px-4 py-1.5 bg-gray-900 text-white rounded text-sm hover:bg-gray-700 transition-colors disabled:opacity-50">
          {buildMutation.isPending
            ? <><Loader2 size={14} className="animate-spin" /> Déclenchement…</>
            : <><Play size={14} /> Déclencher le build</>}
        </button>
        {token && owner && repo && (
          <button onClick={() => runsQuery.refetch()}
            className="p-2 border border-outlook-border rounded hover:bg-outlook-bg-hover transition-colors" title="Rafraîchir">
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {runUrl && (
        <a href={runUrl} target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-outlook-blue hover:underline">
          <ExternalLink size={12} /> Voir les workflows GitHub Actions
        </a>
      )}

      {/* Recent runs */}
      {runsQuery.data && runsQuery.data.length > 0 && (
        <div>
          <div className="text-xs font-medium text-outlook-text-primary mb-1.5">Derniers workflows</div>
          <div className="space-y-1">
            {runsQuery.data.map(run => (
              <div key={run.id} className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded border text-[11px] whitespace-nowrap ${statusColor(run.status, run.conclusion)}`}>
                  {statusLabel(run.status, run.conclusion)}
                </span>
                <span className="text-outlook-text-secondary">{new Date(run.createdAt).toLocaleString('fr-FR')}</span>
                <a href={run.htmlUrl} target="_blank" rel="noreferrer"
                  className="ml-auto flex items-center gap-1 text-outlook-blue hover:underline">
                  <ExternalLink size={11} /> Voir
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Downloads list ────────────────────────────────────────────────────────────

function DownloadsList({ builds, onDelete }: {
  builds: Array<{ filename: string; platform: string; size: number; builtAt: string }>;
  onDelete: (f: string) => void;
}) {
  if (builds.length === 0) {
    return (
      <div className="text-xs text-outlook-text-disabled border border-dashed border-outlook-border rounded p-4 text-center">
        Aucun fichier disponible. Lancez un build Docker ou récupérez les artefacts GitHub.
      </div>
    );
  }
  return (
    <div className="divide-y divide-outlook-border border border-outlook-border rounded overflow-hidden">
      {builds.map(b => (
        <div key={b.filename} className="flex items-center gap-3 px-3 py-2.5 hover:bg-outlook-bg-hover">
          <span className="text-base leading-none">{PLATFORM_ICON[b.platform]}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-outlook-text-primary truncate">{b.filename}</div>
            <div className="text-xs text-outlook-text-disabled">
              {formatBytes(b.size)} · {new Date(b.builtAt).toLocaleDateString('fr-FR')}
            </div>
          </div>
          <a href={`${API}/download/${encodeURIComponent(b.filename)}`} download={b.filename}
            className="flex items-center gap-1 text-xs px-2 py-1 text-outlook-blue border border-outlook-blue rounded hover:bg-blue-50 transition-colors">
            <Download size={12} /> Télécharger
          </a>
          <button onClick={() => { if (!window.confirm(`Supprimer ${b.filename} ?`)) return; onDelete(b.filename); }}
            className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors" title="Supprimer">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AdminApplications() {
  const queryClient = useQueryClient();
  const env = detectEnv();

  const { data: info, isLoading } = useQuery({
    queryKey: ['admin-applications'],
    queryFn: getInfo,
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteFile,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-applications'] }); toast.success('Fichier supprimé'); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-outlook-text-primary">Applications</h2>
        <p className="text-sm text-outlook-text-secondary mt-0.5">
          Générez et distribuez des applications natives Desktop depuis votre serveur.
        </p>
      </div>

      {/* Environnement actuel */}
      <section className="border border-outlook-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-outlook-text-primary mb-3 flex items-center gap-2">
          <Cpu size={16} /> Environnement actuel
        </h3>
        <EnvBadge env={env} />
        <p className="text-xs text-outlook-text-secondary mt-2">
          {env === 'tauri' && 'Vous consultez cette page depuis l\'application desktop Tauri.'}
          {env === 'pwa' && 'L\'application PWA est installée et s\'exécute en mode standalone.'}
          {env === 'web' && 'Vous utilisez le navigateur web standard.'}
        </p>
      </section>

      <PwaSection />

      {/* Build sections */}
      {isLoading ? (
        <div className="text-sm text-outlook-text-secondary flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Chargement…</div>
      ) : (
        <>
          <DockerBuilderSection builderAvailable={info?.builderAvailable ?? false} />
          <GithubActionsSection />
        </>
      )}

      {/* Downloads */}
      <section className="border border-outlook-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-outlook-text-primary flex items-center gap-2">
            <Download size={16} /> Téléchargements disponibles
          </h3>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-applications'] })}
            className="p-1.5 border border-outlook-border rounded hover:bg-outlook-bg-hover transition-colors" title="Rafraîchir">
            <RefreshCw size={13} />
          </button>
        </div>
        <DownloadsList
          builds={info?.builds ?? []}
          onDelete={(f) => deleteMutation.mutate(f)}
        />
      </section>
    </div>
  );
}
