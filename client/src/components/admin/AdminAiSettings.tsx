import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type AiModel } from '../../api';
import {
  Sparkles, Save, TestTube, CheckCircle, XCircle, RefreshCw,
  Eye, EyeOff, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Configuration de l'assistant IA adossé à Ollama.
 *
 * Le serveur Ollama est presque toujours sur le réseau interne : c'est le
 * backend qui l'appelle, jamais le navigateur. Cet écran ne fait donc que
 * décrire la cible ; le bouton « Diagnostic » exécute le test depuis le
 * serveur, seul point de vue qui reflète ce que verront les utilisateurs.
 */

const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'Anglais' },
  { code: 'de', label: 'Allemand' },
  { code: 'es', label: 'Espagnol' },
  { code: 'it', label: 'Italien' },
  { code: 'nl', label: 'Néerlandais' },
  { code: 'pt', label: 'Portugais' },
];

/** Modèles courants, proposés tant qu'on n'a pas interrogé le serveur. */
const SUGGESTED_MODELS = ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5', 'gemma2', 'phi3.5'];

const SECRET_SENTINEL = '__encrypted__';

interface Check { id: string; label: string; ok: boolean; detail: string }

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} Go` : `${Math.round(bytes / 1024 ** 2)} Mo`;
}

export default function AdminAiSettings() {
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('http://localhost:11434');
  const [model, setModel] = useState('llama3.2');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [language, setLanguage] = useState('fr');
  const [temperature, setTemperature] = useState(0.4);
  const [maxTokens, setMaxTokens] = useState(800);
  const [timeoutSec, setTimeoutSec] = useState(120);
  const [maxInputChars, setMaxInputChars] = useState(12000);
  const [featSummarize, setFeatSummarize] = useState(true);
  const [featReply, setFeatReply] = useState(true);
  const [featImprove, setFeatImprove] = useState(true);

  const [models, setModels] = useState<AiModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; checks: Check[]; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['ai-settings'], queryFn: api.getAiSettings });

  useEffect(() => {
    if (!settings) return;
    const s = settings as Record<string, any>;
    setEnabled(s['ai_enabled'] === true);
    setUrl(s['ai_url'] ?? 'http://localhost:11434');
    setModel(s['ai_model'] ?? 'llama3.2');
    // La clé n'est jamais renvoyée en clair : on garde la sentinelle telle
    // quelle pour ne pas l'effacer en enregistrant sans y toucher.
    setApiKey(s['ai_api_key'] ?? '');
    setLanguage(s['ai_language'] ?? 'fr');
    setTemperature(Number(s['ai_temperature'] ?? 0.4));
    setMaxTokens(Number(s['ai_max_tokens'] ?? 800));
    setTimeoutSec(Number(s['ai_timeout'] ?? 120));
    setMaxInputChars(Number(s['ai_max_input_chars'] ?? 12000));
    setFeatSummarize(s['ai_feature_summarize'] !== false);
    setFeatReply(s['ai_feature_reply'] !== false);
    setFeatImprove(s['ai_feature_improve'] !== false);
  }, [settings]);

  /** Corps envoyé aux endpoints de test : les valeurs du formulaire, pas celles en base. */
  const draft = () => ({ ai_url: url, ai_model: model, ai_api_key: apiKey, ai_timeout: timeoutSec });

  const saveMutation = useMutation({
    mutationFn: () => api.updateAiSettings({
      ai_enabled: enabled,
      ai_url: url,
      ai_model: model,
      ai_api_key: apiKey,
      ai_language: language,
      ai_temperature: temperature,
      ai_max_tokens: maxTokens,
      ai_timeout: timeoutSec,
      ai_max_input_chars: maxInputChars,
      ai_feature_summarize: featSummarize,
      ai_feature_reply: featReply,
      ai_feature_improve: featImprove,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
      // L'état de l'assistant est lu par la vue message et la fenêtre de
      // rédaction : sans ça, les boutons n'apparaissent qu'au rechargement.
      queryClient.invalidateQueries({ queryKey: ['ai-status'] });
      toast.success('Configuration IA enregistrée');
    },
    onError: (e: any) => toast.error(e.message ?? 'Erreur'),
  });

  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await api.listAiModels(draft());
      setModels(res.models ?? []);
      if (!res.ok) setModelsError(res.error ?? 'Serveur Ollama injoignable');
      else if (!res.models?.length) setModelsError('Aucun modèle téléchargé sur ce serveur.');
    } catch (e: any) {
      setModelsError(e.message ?? 'Erreur');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testAi(draft());
      setTestResult(res);
      if (res.models?.length) setModels(res.models);
    } catch (e: any) {
      setTestResult({ ok: false, checks: [], error: e.message ?? 'Erreur' });
    } finally {
      setTesting(false);
    }
  };

  const toggle = (label: string, value: boolean, setter: (v: boolean) => void, help: string) => (
    <div className="flex items-start justify-between py-3 border-b border-outlook-border last:border-0">
      <div className="flex-1 pr-4">
        <div className="text-sm font-medium text-outlook-text-primary">{label}</div>
        <div className="text-xs text-outlook-text-secondary mt-0.5">{help}</div>
      </div>
      <button
        type="button"
        onClick={() => setter(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${value ? 'bg-outlook-blue' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );

  const numberField = (
    label: string, value: number, setter: (v: number) => void,
    opts: { min: number; max: number; step?: number; help: string; suffix?: string }
  ) => (
    <div>
      <label className="block text-sm font-medium text-outlook-text-primary mb-1">{label}</label>
      <p className="text-xs text-outlook-text-secondary mb-1">{opts.help}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={opts.min}
          max={opts.max}
          step={opts.step ?? 1}
          onChange={e => setter(Number(e.target.value))}
          className="w-32 px-3 py-2 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
        />
        {opts.suffix && <span className="text-xs text-outlook-text-secondary">{opts.suffix}</span>}
      </div>
    </div>
  );

  const knownModelNames = models.map(m => m.name);
  const modelOptions = knownModelNames.length ? knownModelNames : SUGGESTED_MODELS;
  const modelMissing = knownModelNames.length > 0 && !knownModelNames.includes(model);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Sparkles size={20} />
        <div>
          <h2 className="text-lg font-semibold">Assistant IA (Ollama)</h2>
          <p className="text-sm text-outlook-text-secondary">
            Résumé des messages, brouillon de réponse et réécriture, générés par un modèle qui
            tourne sur vos serveurs.
          </p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
        <strong>Rien ne sort de votre infrastructure.</strong> Les appels partent du serveur
        applicatif vers votre instance Ollama ; le contenu des emails n'est envoyé à aucun service
        tiers, et le navigateur ne connaît jamais l'adresse du serveur de modèles.
      </div>

      <div className="bg-white border border-outlook-border rounded-lg p-4">
        {toggle('Activer l\'assistant IA', enabled, setEnabled,
          'Fait apparaître les actions IA dans la lecture des messages et la fenêtre de rédaction.')}
      </div>

      <div className="bg-white border border-outlook-border rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-semibold">Serveur Ollama</h3>

        <div>
          <label className="block text-sm font-medium text-outlook-text-primary mb-1">URL du serveur</label>
          <p className="text-xs text-outlook-text-secondary mb-1">
            Adresse vue <strong>depuis le serveur applicatif</strong>. En conteneur Docker,
            « localhost » désigne le conteneur lui-même : utilisez
            <code className="bg-gray-100 px-1 rounded mx-1">http://host.docker.internal:11434</code>
            ou l'adresse IP de la machine qui héberge Ollama.
          </p>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="http://localhost:11434"
            className="w-full px-3 py-2 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-outlook-text-primary">Modèle</label>
            <button
              type="button"
              onClick={loadModels}
              disabled={loadingModels}
              className="flex items-center gap-1.5 text-xs px-2 py-1 border border-outlook-border rounded hover:bg-outlook-bg-hover disabled:opacity-50"
            >
              <RefreshCw size={12} className={loadingModels ? 'animate-spin' : ''} />
              {loadingModels ? 'Lecture…' : 'Lister les modèles du serveur'}
            </button>
          </div>
          <p className="text-xs text-outlook-text-secondary mb-1">
            {knownModelNames.length
              ? 'Modèles téléchargés sur le serveur.'
              : 'Cliquez sur « Lister les modèles » pour interroger le serveur. En attendant, voici les modèles les plus courants — chacun doit avoir été récupéré par « ollama pull ».'}
          </p>
          <div className="flex gap-2">
            <select
              value={modelOptions.includes(model) ? model : ''}
              onChange={e => e.target.value && setModel(e.target.value)}
              className="w-56 px-3 py-2 border border-outlook-border rounded-md text-sm bg-white focus:outline-none focus:border-outlook-blue"
            >
              <option value="">— choisir —</option>
              {modelOptions.map(name => {
                const info = models.find(m => m.name === name);
                return (
                  <option key={name} value={name}>
                    {name}
                    {info?.parameterSize ? ` (${info.parameterSize}${info.size ? `, ${formatSize(info.size)}` : ''})` : ''}
                  </option>
                );
              })}
            </select>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="llama3.2"
              className="flex-1 px-3 py-2 border border-outlook-border rounded-md text-sm font-mono focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
            />
          </div>
          {modelsError && (
            <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{modelsError}</div>
          )}
          {modelMissing && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                « {model} » n'est pas sur le serveur. Lancez
                <code className="bg-amber-100 px-1 rounded mx-1">ollama pull {model}</code>
                ou choisissez-en un dans la liste.
              </span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-outlook-text-primary mb-1">
            Clé d'API <span className="font-normal text-outlook-text-secondary">(facultatif)</span>
          </label>
          <p className="text-xs text-outlook-text-secondary mb-1">
            Ollama n'authentifie rien par défaut. À renseigner uniquement si l'instance est
            protégée par un reverse proxy attendant un en-tête <code className="bg-gray-100 px-1 rounded">Authorization: Bearer</code>.
            Stockée chiffrée. Videz le champ pour la supprimer.
          </p>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey === SECRET_SENTINEL ? '' : apiKey}
              placeholder={apiKey === SECRET_SENTINEL ? '•••••••• (enregistrée)' : ''}
              onChange={e => setApiKey(e.target.value)}
              className="w-full px-3 py-2 pr-10 border border-outlook-border rounded-md text-sm focus:outline-none focus:border-outlook-blue focus:ring-1 focus:ring-outlook-blue"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-outlook-text-secondary hover:text-outlook-text-primary"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {apiKey === SECRET_SENTINEL && (
            <button
              type="button"
              onClick={() => setApiKey('')}
              className="mt-1 text-xs text-outlook-blue hover:underline"
            >
              Supprimer la clé enregistrée
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-outlook-border rounded-lg p-4 space-y-4">
        <h3 className="text-sm font-semibold">Génération</h3>

        <div>
          <label className="block text-sm font-medium text-outlook-text-primary mb-1">Langue des réponses</label>
          <p className="text-xs text-outlook-text-secondary mb-1">
            Langue dans laquelle le modèle rédige résumés et brouillons, quelle que soit celle du
            message d'origine.
          </p>
          <select
            value={language}
            onChange={e => setLanguage(e.target.value)}
            className="w-56 px-3 py-2 border border-outlook-border rounded-md text-sm bg-white focus:outline-none focus:border-outlook-blue"
          >
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {numberField('Température', temperature, setTemperature, {
            min: 0, max: 2, step: 0.1,
            help: 'Plus la valeur est basse, plus le modèle est prévisible. 0,3–0,5 convient à des emails ; au-delà de 1, il improvise.',
          })}
          {numberField('Longueur maximale', maxTokens, setMaxTokens, {
            min: 32, max: 8192, suffix: 'tokens',
            help: 'Plafond de la réponse. ~800 tokens ≈ 600 mots ; trop bas, les brouillons sont coupés en plein milieu.',
          })}
          {numberField('Délai d\'attente', timeoutSec, setTimeoutSec, {
            min: 5, max: 600, suffix: 'secondes',
            help: 'Sans GPU, un modèle de 7 milliards de paramètres met facilement une minute. Trop court, tout échoue en timeout.',
          })}
          {numberField('Texte envoyé au modèle', maxInputChars, setMaxInputChars, {
            min: 500, max: 100000, step: 500, suffix: 'caractères',
            help: 'Les messages plus longs sont tronqués avant l\'envoi. Au-delà de la fenêtre de contexte du modèle, la qualité chute.',
          })}
        </div>
      </div>

      <div className="bg-white border border-outlook-border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-1">Fonctions proposées aux utilisateurs</h3>
        <p className="text-xs text-outlook-text-secondary mb-2">
          Chaque fonction désactivée disparaît de l'interface et est refusée côté serveur.
        </p>
        {toggle('Résumer un message', featSummarize, setFeatSummarize,
          'Bouton « Résumer » dans la lecture d\'un email.')}
        {toggle('Proposer une réponse', featReply, setFeatReply,
          'Rédige un brouillon de réponse à partir du message reçu, que l\'utilisateur reprend avant envoi.')}
        {toggle('Réécrire un texte', featImprove, setFeatImprove,
          'Dans la fenêtre de rédaction : correction et reformulation du brouillon en cours.')}
      </div>

      {testResult && (
        <div className="space-y-2">
          {testResult.error && (
            <div className="p-3 rounded-md text-sm bg-red-50 border border-red-200 text-red-800">{testResult.error}</div>
          )}
          {testResult.checks.map(check => (
            <div
              key={check.id}
              className={`flex items-start gap-2 p-3 rounded-md text-sm ${check.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}
            >
              {check.ok ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
              <div className="min-w-0">
                <div className="font-medium">{check.label}</div>
                <div className="text-xs mt-0.5 opacity-90 break-words">{check.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2 border border-outlook-border rounded-md text-sm hover:bg-outlook-bg-hover disabled:opacity-50"
        >
          <TestTube size={16} />
          {testing ? 'Diagnostic en cours…' : 'Lancer le diagnostic'}
        </button>
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-outlook-blue hover:bg-outlook-blue-hover text-white rounded-md text-sm disabled:opacity-50"
        >
          <Save size={16} />
          {saveMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>

      <div className="bg-gray-50 border border-outlook-border rounded-md p-4 text-xs text-outlook-text-secondary space-y-3">
        <div>
          <strong className="text-outlook-text-primary">1. Installer Ollama</strong> — sur la machine
          qui portera les modèles (<a href="https://ollama.com" target="_blank" rel="noreferrer" className="text-outlook-blue hover:underline">ollama.com</a>),
          puis récupérer un modèle :
          <pre className="bg-gray-100 rounded p-2 mt-1 overflow-x-auto">{`ollama pull ${model || 'llama3.2'}`}</pre>
        </div>
        <div>
          <strong className="text-outlook-text-primary">2. L'ouvrir au serveur applicatif</strong> — par
          défaut, Ollama n'écoute que sur sa boucle locale et refusera toute connexion venue d'ailleurs.
          Il faut le démarrer avec <code className="bg-gray-100 px-1 rounded">OLLAMA_HOST=0.0.0.0</code>
          {' '}(sous systemd : <code className="bg-gray-100 px-1 rounded">systemctl edit ollama</code>,
          puis <code className="bg-gray-100 px-1 rounded">Environment="OLLAMA_HOST=0.0.0.0"</code>).
          Le port 11434 n'a aucune authentification : ne l'exposez pas sur Internet.
        </div>
        <div>
          <strong className="text-outlook-text-primary">3. Choisir un modèle à la taille de la machine</strong> —
          compter environ 5 Go de RAM (ou de VRAM) pour un modèle de 7–8 milliards de paramètres,
          3 Go pour un 3B. Sans GPU, la génération reste utilisable mais se compte en dizaines de
          secondes : c'est le délai d'attente ci-dessus qu'il faudra desserrer, pas le modèle qu'il
          faudra grossir.
        </div>
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          <strong>Le diagnostic part du serveur applicatif</strong>, pas de votre poste. Une URL qui
          répond dans votre navigateur peut très bien être injoignable pour lui — c'est le cas le
          plus fréquent avec Docker.
        </div>
      </div>
    </div>
  );
}
