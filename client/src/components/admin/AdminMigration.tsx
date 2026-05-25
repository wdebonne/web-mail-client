import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowRight, ArrowLeft, CheckCircle2, XCircle, Loader2,
  Server, FolderOpen, Play, BarChart3, AlertTriangle, RefreshCw,
  Mail, Lock, Globe, Wifi,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImapConfig {
  host: string;
  port: string;
  secure: boolean;
  email: string;
  password: string;
}

interface FolderInfo {
  path: string;
  name: string;
  messageCount: number;
}

interface MigrationProgress {
  status: 'running' | 'done' | 'error';
  currentFolder: string;
  currentFolderIndex: number;
  totalFolders: number;
  messagesProcessed: number;
  messagesTotal: number;
  errors: { folder: string; message: string }[];
  report?: {
    totalFolders: number;
    totalMessages: number;
    migratedMessages: number;
    skippedMessages: number;
    failedFolders: { folder: string; error: string }[];
    durationSeconds: number;
  };
}

type Step = 'source' | 'destination' | 'folders' | 'progress';

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeaders() {
  const token = localStorage.getItem('auth_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`/api/admin${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'source', label: 'Source' },
    { id: 'destination', label: 'Destination' },
    { id: 'folders', label: 'Dossiers' },
    { id: 'progress', label: 'Migration' },
  ];
  const idx = steps.findIndex(s => s.id === current);
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2
              ${i < idx ? 'bg-green-500 border-green-500 text-white'
                : i === idx ? 'bg-outlook-blue border-outlook-blue text-white'
                : 'bg-white border-outlook-border text-outlook-text-disabled'}`}>
              {i < idx ? <CheckCircle2 size={16} /> : i + 1}
            </div>
            <span className={`text-xs mt-1 ${i === idx ? 'text-outlook-blue font-medium' : 'text-outlook-text-disabled'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 ${i < idx ? 'bg-green-500' : 'bg-outlook-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function ImapForm({
  title,
  icon: Icon,
  config,
  onChange,
  onTest,
  testStatus,
  testing,
  defaultHost,
  defaultPort,
}: {
  title: string;
  icon: any;
  config: ImapConfig;
  onChange: (c: ImapConfig) => void;
  onTest: () => void;
  testStatus: 'idle' | 'ok' | 'error';
  testing: boolean;
  defaultHost?: string;
  defaultPort?: string;
}) {
  const set = (field: keyof ImapConfig, value: string | boolean) =>
    onChange({ ...config, [field]: value });

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-outlook-text-primary flex items-center gap-2">
        <Icon size={18} className="text-outlook-blue" /> {title}
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-outlook-text-secondary mb-1">
            <Globe size={12} className="inline mr-1" />Serveur IMAP
          </label>
          <input
            type="text"
            value={config.host}
            onChange={e => set('host', e.target.value)}
            placeholder={defaultHost ?? 'imap.example.com'}
            className="w-full px-3 py-2 text-sm border border-outlook-border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-outlook-blue"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-outlook-text-secondary mb-1">Port</label>
          <input
            type="number"
            value={config.port}
            onChange={e => set('port', e.target.value)}
            placeholder={defaultPort ?? '993'}
            className="w-full px-3 py-2 text-sm border border-outlook-border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-outlook-blue"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`secure-${title}`}
          checked={config.secure}
          onChange={e => set('secure', e.target.checked)}
          className="rounded border-outlook-border"
        />
        <label htmlFor={`secure-${title}`} className="text-sm text-outlook-text-secondary">
          Connexion sécurisée SSL/TLS
        </label>
      </div>

      <div>
        <label className="block text-xs font-medium text-outlook-text-secondary mb-1">
          <Mail size={12} className="inline mr-1" />Adresse email
        </label>
        <input
          type="email"
          value={config.email}
          onChange={e => set('email', e.target.value)}
          placeholder="utilisateur@domaine.com"
          className="w-full px-3 py-2 text-sm border border-outlook-border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-outlook-blue"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-outlook-text-secondary mb-1">
          <Lock size={12} className="inline mr-1" />Mot de passe
        </label>
        <input
          type="password"
          value={config.password}
          onChange={e => set('password', e.target.value)}
          placeholder="Mot de passe ou mot de passe d'application"
          className="w-full px-3 py-2 text-sm border border-outlook-border rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-outlook-blue"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onTest}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-outlook-blue text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
          Tester la connexion
        </button>
        {testStatus === 'ok' && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 size={15} /> Connexion réussie
          </span>
        )}
        {testStatus === 'error' && (
          <span className="flex items-center gap-1 text-sm text-red-600">
            <XCircle size={15} /> Connexion échouée
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const DEFAULT_SOURCE: ImapConfig = {
  host: 'outlook.office365.com',
  port: '993',
  secure: true,
  email: '',
  password: '',
};

const DEFAULT_DEST: ImapConfig = {
  host: '',
  port: '993',
  secure: true,
  email: '',
  password: '',
};

export default function AdminMigration() {
  const [step, setStep] = useState<Step>('source');

  // Configs
  const [source, setSource] = useState<ImapConfig>(DEFAULT_SOURCE);
  const [destination, setDestination] = useState<ImapConfig>(DEFAULT_DEST);

  // Connection tests
  const [srcTest, setSrcTest] = useState<'idle' | 'ok' | 'error'>('idle');
  const [srcTesting, setSrcTesting] = useState(false);
  const [dstTest, setDstTest] = useState<'idle' | 'ok' | 'error'>('idle');
  const [dstTesting, setDstTesting] = useState(false);

  // Folders
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());

  // Progress
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket ──
  const connectWs = useCallback(() => {
    if (wsRef.current) return;
    const token = localStorage.getItem('auth_token') ?? '';
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'migration_progress') {
          setProgress(msg.data as MigrationProgress);
        }
      } catch {}
    };

    ws.onclose = () => { wsRef.current = null; };
  }, []);

  useEffect(() => {
    connectWs();
    return () => { wsRef.current?.close(); wsRef.current = null; };
  }, [connectWs]);

  // ── Handlers ──
  const testSource = async () => {
    setSrcTesting(true); setSrcTest('idle');
    try {
      const r = await apiPost('/migration/test', {
        host: source.host, port: source.port, secure: source.secure,
        email: source.email, password: source.password,
      });
      setSrcTest(r.ok ? 'ok' : 'error');
      if (!r.ok) toast.error(`Échec source : ${r.error}`);
    } catch (e: any) {
      setSrcTest('error'); toast.error(e.message);
    } finally { setSrcTesting(false); }
  };

  const testDest = async () => {
    setDstTesting(true); setDstTest('idle');
    try {
      const r = await apiPost('/migration/test', {
        host: destination.host, port: destination.port, secure: destination.secure,
        email: destination.email, password: destination.password,
      });
      setDstTest(r.ok ? 'ok' : 'error');
      if (!r.ok) toast.error(`Échec destination : ${r.error}`);
    } catch (e: any) {
      setDstTest('error'); toast.error(e.message);
    } finally { setDstTesting(false); }
  };

  const loadFolders = async () => {
    setLoadingFolders(true);
    try {
      const list: FolderInfo[] = await apiPost('/migration/folders', {
        host: source.host, port: source.port, secure: source.secure,
        email: source.email, password: source.password,
      });
      setFolders(list);
      setSelectedFolders(new Set(list.map(f => f.path)));
    } catch (e: any) {
      toast.error(`Impossible de lister les dossiers : ${e.message}`);
    } finally { setLoadingFolders(false); }
  };

  const startMigration = async () => {
    setProgress(null);
    setStep('progress');
    try {
      await apiPost('/migration/start', {
        source: { host: source.host, port: parseInt(source.port), secure: source.secure, email: source.email, password: source.password },
        destination: { host: destination.host, port: parseInt(destination.port), secure: destination.secure, email: destination.email, password: destination.password },
        selectedFolders: Array.from(selectedFolders),
      });
    } catch (e: any) {
      toast.error(`Erreur au démarrage : ${e.message}`);
    }
  };

  const toggleFolder = (path: string) => {
    setSelectedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const totalSelected = folders
    .filter(f => selectedFolders.has(f.path))
    .reduce((acc, f) => acc + f.messageCount, 0);

  // ── Step navigation ──
  const goToFolders = async () => {
    if (folders.length === 0) await loadFolders();
    setStep('folders');
  };

  // ── Render ──
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-outlook-text-primary flex items-center gap-2">
          <RefreshCw size={22} className="text-outlook-blue" />
          Migration IMAP
        </h2>
        <p className="text-sm text-outlook-text-secondary mt-1">
          Transférez les emails d'un serveur IMAP vers un autre (ex. Microsoft 365 → O2switch).
        </p>
      </div>

      <div className="bg-white border border-outlook-border rounded-lg p-6">
        <StepIndicator current={step} />

        {/* ── Étape 1 : Source ── */}
        {step === 'source' && (
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800 flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                Pour Microsoft 365, utilisez un <strong>mot de passe d'application</strong> (Sécurité du compte → Mots de passe d'application).
                L'accès IMAP doit être activé dans le Centre d'administration Exchange.
              </span>
            </div>
            <ImapForm
              title="Serveur source (Microsoft 365)"
              icon={Server}
              config={source}
              onChange={cfg => { setSource(cfg); setSrcTest('idle'); }}
              onTest={testSource}
              testStatus={srcTest}
              testing={srcTesting}
              defaultHost="outlook.office365.com"
              defaultPort="993"
            />
            <div className="flex justify-end">
              <button
                onClick={() => setStep('destination')}
                disabled={srcTest !== 'ok'}
                className="flex items-center gap-2 px-5 py-2 bg-outlook-blue text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Suivant <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Étape 2 : Destination ── */}
        {step === 'destination' && (
          <div className="space-y-6">
            <ImapForm
              title="Serveur destination (O2switch / IMAP)"
              icon={Server}
              config={destination}
              onChange={cfg => { setDestination(cfg); setDstTest('idle'); }}
              onTest={testDest}
              testStatus={dstTest}
              testing={dstTesting}
              defaultHost="mail.o2switch.net"
              defaultPort="993"
            />
            <div className="flex justify-between">
              <button
                onClick={() => setStep('source')}
                className="flex items-center gap-2 px-5 py-2 border border-outlook-border text-sm rounded-md hover:bg-outlook-bg-hover"
              >
                <ArrowLeft size={16} /> Retour
              </button>
              <button
                onClick={goToFolders}
                disabled={dstTest !== 'ok' || loadingFolders}
                className="flex items-center gap-2 px-5 py-2 bg-outlook-blue text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loadingFolders ? <Loader2 size={14} className="animate-spin" /> : null}
                {loadingFolders ? 'Chargement...' : 'Suivant'} <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Étape 3 : Sélection dossiers ── */}
        {step === 'folders' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-outlook-text-primary flex items-center gap-2">
                <FolderOpen size={18} className="text-outlook-blue" />
                Sélection des dossiers
              </h3>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelectedFolders(new Set(folders.map(f => f.path)))}
                  className="text-outlook-blue hover:underline"
                >
                  Tout sélectionner
                </button>
                <span className="text-outlook-text-disabled">|</span>
                <button
                  onClick={() => setSelectedFolders(new Set())}
                  className="text-outlook-blue hover:underline"
                >
                  Tout désélectionner
                </button>
              </div>
            </div>

            <div className="border border-outlook-border rounded-md divide-y divide-outlook-border max-h-80 overflow-y-auto">
              {folders.map(folder => (
                <label key={folder.path} className="flex items-center gap-3 px-4 py-2.5 hover:bg-outlook-bg-hover cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedFolders.has(folder.path)}
                    onChange={() => toggleFolder(folder.path)}
                    className="rounded border-outlook-border"
                  />
                  <FolderOpen size={15} className="text-outlook-text-secondary flex-shrink-0" />
                  <span className="text-sm text-outlook-text-primary flex-1">{folder.path}</span>
                  <span className="text-xs text-outlook-text-disabled">
                    {folder.messageCount.toLocaleString()} email{folder.messageCount > 1 ? 's' : ''}
                  </span>
                </label>
              ))}
            </div>

            <div className="bg-outlook-bg-secondary rounded-md px-4 py-3 text-sm text-outlook-text-secondary">
              <strong>{selectedFolders.size}</strong> dossier{selectedFolders.size > 1 ? 's' : ''} sélectionné{selectedFolders.size > 1 ? 's' : ''},{' '}
              <strong>{totalSelected.toLocaleString()}</strong> email{totalSelected > 1 ? 's' : ''} à migrer.
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep('destination')}
                className="flex items-center gap-2 px-5 py-2 border border-outlook-border text-sm rounded-md hover:bg-outlook-bg-hover"
              >
                <ArrowLeft size={16} /> Retour
              </button>
              <button
                onClick={startMigration}
                disabled={selectedFolders.size === 0}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play size={16} /> Démarrer la migration
              </button>
            </div>
          </div>
        )}

        {/* ── Étape 4 : Progression ── */}
        {step === 'progress' && (
          <div className="space-y-6">
            <h3 className="font-semibold text-outlook-text-primary flex items-center gap-2">
              <BarChart3 size={18} className="text-outlook-blue" />
              {progress?.status === 'done' ? 'Migration terminée' : 'Migration en cours…'}
            </h3>

            {!progress && (
              <div className="flex items-center gap-3 text-outlook-text-secondary">
                <Loader2 size={20} className="animate-spin text-outlook-blue" />
                <span className="text-sm">Initialisation de la migration…</span>
              </div>
            )}

            {progress && progress.status !== 'done' && (
              <div className="space-y-4">
                {/* Dossier courant */}
                <div className="text-sm text-outlook-text-secondary">
                  Dossier en cours :{' '}
                  <span className="font-medium text-outlook-text-primary">{progress.currentFolder || '—'}</span>
                  {' '}({progress.currentFolderIndex + 1}/{progress.totalFolders})
                </div>

                {/* Barre dossiers */}
                <div>
                  <div className="flex justify-between text-xs text-outlook-text-secondary mb-1">
                    <span>Dossiers</span>
                    <span>{progress.currentFolderIndex}/{progress.totalFolders}</span>
                  </div>
                  <div className="h-2 bg-outlook-bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-outlook-blue rounded-full transition-all duration-500"
                      style={{ width: `${progress.totalFolders > 0 ? (progress.currentFolderIndex / progress.totalFolders) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Barre emails */}
                <div>
                  <div className="flex justify-between text-xs text-outlook-text-secondary mb-1">
                    <span>Emails</span>
                    <span>{progress.messagesProcessed.toLocaleString()} / {progress.messagesTotal.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-outlook-bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-green-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress.messagesTotal > 0 ? (progress.messagesProcessed / progress.messagesTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Erreurs */}
                {progress.errors.length > 0 && (
                  <div className="border border-red-200 bg-red-50 rounded-md p-3">
                    <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                      <AlertTriangle size={13} /> {progress.errors.length} dossier(s) en erreur (ignorés)
                    </p>
                    <ul className="text-xs text-red-600 space-y-0.5">
                      {progress.errors.map(e => (
                        <li key={e.folder}><strong>{e.folder}</strong> : {e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Rapport final */}
            {progress?.status === 'done' && progress.report && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatBox label="Dossiers migrés" value={progress.report.totalFolders} color="bg-outlook-blue" />
                  <StatBox label="Emails migrés" value={progress.report.migratedMessages} color="bg-green-500" />
                  <StatBox label="Ignorés" value={progress.report.skippedMessages} color="bg-yellow-500" />
                  <StatBox label="Durée" value={`${progress.report.durationSeconds}s`} color="bg-gray-500" />
                </div>

                {progress.report.failedFolders.length > 0 && (
                  <div className="border border-red-200 bg-red-50 rounded-md p-3">
                    <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                      <XCircle size={13} /> Dossiers en erreur
                    </p>
                    <ul className="text-xs text-red-600 space-y-1">
                      {progress.report.failedFolders.map(f => (
                        <li key={f.folder}><strong>{f.folder}</strong> : {f.error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {progress.report.failedFolders.length === 0 && (
                  <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-md p-3 text-sm">
                    <CheckCircle2 size={18} /> Migration terminée sans erreur.
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setStep('source'); setProgress(null); setFolders([]); setSelectedFolders(new Set()); setSrcTest('idle'); setDstTest('idle'); }}
                    className="flex items-center gap-2 px-4 py-2 border border-outlook-border text-sm rounded-md hover:bg-outlook-bg-hover"
                  >
                    <RefreshCw size={14} /> Nouvelle migration
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white border border-outlook-border rounded-lg p-3 text-center">
      <div className={`text-2xl font-bold text-white ${color} rounded-md py-1 mb-2`}>{value}</div>
      <div className="text-xs text-outlook-text-secondary">{label}</div>
    </div>
  );
}
