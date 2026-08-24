import { pool } from '../database/connection';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

/**
 * Assistant IA adossé à un serveur Ollama auto-hébergé.
 *
 * Tout passe par le serveur applicatif : le navigateur ne connaît jamais l'URL
 * d'Ollama. C'est volontaire — l'instance tourne presque toujours sur le réseau
 * interne, injoignable depuis le poste de l'utilisateur, et la clé d'API
 * éventuelle n'a rien à faire dans un bundle front.
 */

export type AiAction = 'summarize' | 'reply' | 'improve';

export interface AiConfig {
  enabled: boolean;
  url: string;
  model: string;
  apiKey: string;
  language: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  maxInputChars: number;
  features: Record<AiAction, boolean>;
}

export const AI_DEFAULTS = {
  url: 'http://localhost:11434',
  model: 'llama3.2',
  language: 'fr',
  temperature: 0.4,
  maxTokens: 800,
  timeoutSeconds: 120,
  maxInputChars: 12_000,
};

/** Clés `admin_settings` acceptées en écriture — liste blanche du PUT admin. */
export const AI_SETTING_KEYS = [
  'ai_enabled', 'ai_url', 'ai_model', 'ai_api_key', 'ai_language',
  'ai_temperature', 'ai_max_tokens', 'ai_timeout', 'ai_max_input_chars',
  'ai_feature_summarize', 'ai_feature_reply', 'ai_feature_improve',
] as const;

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

export async function getAiConfig(): Promise<AiConfig> {
  const result = await pool.query(`SELECT key, value FROM admin_settings WHERE key LIKE 'ai_%'`);
  const s: Record<string, any> = {};
  for (const row of result.rows) s[row.key] = row.value;

  let apiKey = '';
  if (s['ai_api_key']) {
    try {
      apiKey = decrypt(s['ai_api_key']);
    } catch {
      // Clé chiffrée avec une autre ENCRYPTION_KEY : on repart sans, plutôt que
      // d'envoyer un en-tête d'autorisation illisible.
      apiKey = '';
    }
  }

  return {
    enabled: bool(s['ai_enabled'], false),
    url: normalizeUrl(typeof s['ai_url'] === 'string' && s['ai_url'] ? s['ai_url'] : AI_DEFAULTS.url),
    model: typeof s['ai_model'] === 'string' && s['ai_model'] ? s['ai_model'] : AI_DEFAULTS.model,
    apiKey,
    language: typeof s['ai_language'] === 'string' && s['ai_language'] ? s['ai_language'] : AI_DEFAULTS.language,
    temperature: num(s['ai_temperature'], AI_DEFAULTS.temperature, 0, 2),
    maxTokens: num(s['ai_max_tokens'], AI_DEFAULTS.maxTokens, 32, 8192),
    timeoutMs: num(s['ai_timeout'], AI_DEFAULTS.timeoutSeconds, 5, 600) * 1000,
    maxInputChars: num(s['ai_max_input_chars'], AI_DEFAULTS.maxInputChars, 500, 100_000),
    features: {
      summarize: bool(s['ai_feature_summarize'], true),
      reply: bool(s['ai_feature_reply'], true),
      improve: bool(s['ai_feature_improve'], true),
    },
  };
}

/** Retire le slash final : toutes les URL sont recomposées avec `/api/...`. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export class AiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'AiError';
  }
}

async function ollamaFetch(cfg: AiConfig, path: string, init: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Ollama nu n'authentifie rien ; la clé ne sert que lorsqu'un reverse proxy
  // se charge de protéger l'instance.
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AiError(
        `Ollama n'a pas répondu en ${Math.round(cfg.timeoutMs / 1000)} s — modèle trop lourd pour la machine, ou serveur surchargé.`,
        504
      );
    }
    throw new AiError(`Impossible de contacter Ollama sur ${cfg.url} : ${err?.message ?? 'erreur réseau'}`);
  }

  const raw = await response.text();
  if (!response.ok) {
    let detail = raw.slice(0, 300);
    try { detail = JSON.parse(raw).error ?? detail; } catch { /* corps non JSON */ }
    if (response.status === 404 && /model/i.test(detail)) {
      throw new AiError(`Modèle "${cfg.model}" absent du serveur Ollama. Lancez : ollama pull ${cfg.model}`, 404);
    }
    throw new AiError(`Ollama a répondu ${response.status} : ${detail}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new AiError('Réponse Ollama illisible (JSON attendu).');
  }
}

export interface OllamaModel {
  name: string;
  size: number | null;
  parameterSize: string | null;
  quantization: string | null;
  modifiedAt: string | null;
}

/** Modèles déjà téléchargés sur le serveur — alimente la liste déroulante. */
export async function listModels(cfg: AiConfig): Promise<OllamaModel[]> {
  const data = await ollamaFetch(cfg, '/api/tags', { method: 'GET' });
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .map((m: any): OllamaModel => ({
      name: String(m?.name ?? m?.model ?? ''),
      size: typeof m?.size === 'number' ? m.size : null,
      parameterSize: m?.details?.parameter_size ?? null,
      quantization: m?.details?.quantization_level ?? null,
      modifiedAt: m?.modified_at ?? null,
    }))
    .filter((m: OllamaModel) => m.name);
}

export async function getVersion(cfg: AiConfig): Promise<string> {
  const data = await ollamaFetch(cfg, '/api/version', { method: 'GET' });
  return typeof data?.version === 'string' ? data.version : 'inconnue';
}

/** Un tour de chat sans streaming : le front reçoit la réponse d'un bloc. */
export async function chat(
  cfg: AiConfig,
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const data = await ollamaFetch(cfg, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      options: {
        temperature: opts.temperature ?? cfg.temperature,
        num_predict: opts.maxTokens ?? cfg.maxTokens,
      },
    }),
  });

  const content = data?.message?.content ?? data?.response ?? '';
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiError('Le modèle a renvoyé une réponse vide.');
  }
  const cleaned = stripThinking(content).trim();
  if (!cleaned) {
    throw new AiError("Le modèle n'a produit que son raisonnement interne — augmentez la limite de tokens.");
  }
  return cleaned;
}

/**
 * Les modèles de raisonnement (deepseek-r1, qwen3…) préfixent leur sortie d'un
 * bloc `<think>`. Le laisser passer afficherait le brouillon du modèle dans le
 * mail de l'utilisateur.
 */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '');
}

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'français', en: 'anglais', de: 'allemand', es: 'espagnol',
  it: 'italien', nl: 'néerlandais', pt: 'portugais',
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function clip(text: string, cfg: AiConfig): string {
  const clean = (text ?? '').replace(/\r\n/g, '\n').trim();
  return clean.length > cfg.maxInputChars
    ? `${clean.slice(0, cfg.maxInputChars)}\n\n[...message tronque...]`
    : clean;
}

const TONES: Record<string, string> = {
  professional: 'professionnel et courtois',
  formal: 'formel et soutenu',
  friendly: 'chaleureux et direct',
  concise: 'très bref, trois phrases maximum',
};

export interface SummarizeInput { subject?: string; from?: string; body: string }
export interface ReplyInput { subject?: string; from?: string; body: string; tone?: string; instructions?: string }
export interface ImproveInput { text: string; style?: string }

export async function summarize(cfg: AiConfig, input: SummarizeInput): Promise<string> {
  const lang = languageName(cfg.language);
  const system = `Tu es un assistant de messagerie. Tu résumes des emails en ${lang}. `
    + `Tu réponds uniquement par le résumé, sans préambule ni formule de politesse. `
    + `Format : deux ou trois phrases, puis, si et seulement si le message appelle une action, `
    + `une ligne commençant par "À faire :" suivie des actions attendues.`;

  const user = `Objet : ${input.subject || '(sans objet)'}\n`
    + `Expéditeur : ${input.from || 'inconnu'}\n\n`
    + `Message :\n${clip(input.body, cfg)}`;

  return chat(cfg, system, user, { temperature: Math.min(cfg.temperature, 0.3) });
}

export async function suggestReply(cfg: AiConfig, input: ReplyInput): Promise<string> {
  const lang = languageName(cfg.language);
  const tone = TONES[input.tone ?? 'professional'] ?? TONES.professional;
  const system = `Tu rédiges des réponses d'email en ${lang}, sur un ton ${tone}. `
    + `Tu produis uniquement le corps du message, prêt à envoyer : pas d'objet, pas de balises, `
    + `pas de commentaire sur ton propre travail, et aucun passage entre crochets à compléter. `
    + `Termine par une formule de politesse, sans signer d'un nom.`;

  const user = `Réponds à cet email.\n\n`
    + `Objet : ${input.subject || '(sans objet)'}\n`
    + `Expéditeur : ${input.from || 'inconnu'}\n\n`
    + `Message reçu :\n${clip(input.body, cfg)}`
    + (input.instructions?.trim() ? `\n\nConsigne de l'utilisateur pour cette réponse : ${input.instructions.trim()}` : '');

  return chat(cfg, system, user);
}

export async function improve(cfg: AiConfig, input: ImproveInput): Promise<string> {
  const lang = languageName(cfg.language);
  const style = TONES[input.style ?? 'professional'] ?? TONES.professional;
  const system = `Tu réécris des textes d'email en ${lang}, sur un ton ${style}. `
    + `Tu corriges l'orthographe, la grammaire et la formulation en conservant le sens et les faits. `
    + `Tu n'inventes rien et tu n'ajoutes aucune information absente de l'original. `
    + `Tu renvoies uniquement le texte réécrit, sans commentaire ni guillemets.`;

  return chat(cfg, system, `Texte à réécrire :\n${clip(input.text, cfg)}`);
}

export async function runAction(cfg: AiConfig, action: AiAction, data: any): Promise<string> {
  switch (action) {
    case 'summarize': return summarize(cfg, data);
    case 'reply':     return suggestReply(cfg, data);
    case 'improve':   return improve(cfg, data);
    default:
      throw new AiError(`Action IA inconnue : ${action}`, 400);
  }
}

export interface AiCheck { id: string; label: string; ok: boolean; detail: string }

/** Diagnostic pas à pas, dans l'ordre où les choses cassent en pratique. */
export async function diagnose(cfg: AiConfig): Promise<{
  ok: boolean;
  checks: AiCheck[];
  models: OllamaModel[];
}> {
  const checks: AiCheck[] = [];
  let models: OllamaModel[] = [];

  try {
    const version = await getVersion(cfg);
    checks.push({ id: 'reach', label: 'Serveur Ollama joignable', ok: true, detail: `${cfg.url} — version ${version}` });
  } catch (err: any) {
    checks.push({ id: 'reach', label: 'Serveur Ollama joignable', ok: false, detail: err?.message ?? 'Échec' });
    checks.push({
      id: 'hint',
      label: 'Piste',
      ok: false,
      detail: "Dans Docker, « localhost » désigne le conteneur, pas la machine hôte : utilisez http://host.docker.internal:11434 ou l'adresse IP du serveur Ollama. Vérifiez aussi qu'Ollama tourne avec OLLAMA_HOST=0.0.0.0, sans quoi il n'écoute que sur sa boucle locale.",
    });
    return { ok: false, checks, models };
  }

  try {
    models = await listModels(cfg);
    const hasModel = models.some(m => m.name === cfg.model || m.name.split(':')[0] === cfg.model);
    checks.push({
      id: 'models',
      label: 'Modèles téléchargés',
      ok: models.length > 0,
      detail: models.length ? models.map(m => m.name).join(', ') : 'Aucun modèle sur le serveur — lancez : ollama pull llama3.2',
    });
    checks.push({
      id: 'model',
      label: `Modèle sélectionné (${cfg.model})`,
      ok: hasModel,
      detail: hasModel
        ? 'Présent sur le serveur'
        : `Absent — lancez : ollama pull ${cfg.model}, ou choisissez-en un dans la liste ci-dessus.`,
    });
    if (!hasModel) return { ok: false, checks, models };
  } catch (err: any) {
    checks.push({ id: 'models', label: 'Modèles téléchargés', ok: false, detail: err?.message ?? 'Échec' });
    return { ok: false, checks, models };
  }

  // Génération réelle : seul test qui prouve que le modèle tient dans la RAM de
  // la machine et répond dans le délai imparti.
  const startedAt = Date.now();
  try {
    const answer = await chat(cfg, 'Réponds en un seul mot, sans ponctuation.', 'Dis simplement bonjour.', { maxTokens: 32 });
    checks.push({
      id: 'generate',
      label: 'Génération de test',
      ok: true,
      detail: `Réponse en ${((Date.now() - startedAt) / 1000).toFixed(1)} s : « ${answer.slice(0, 80)} »`,
    });
  } catch (err: any) {
    checks.push({ id: 'generate', label: 'Génération de test', ok: false, detail: err?.message ?? 'Échec' });
    return { ok: false, checks, models };
  }

  return { ok: checks.every(c => c.ok), checks, models };
}

/** Trace les échecs côté serveur : le front n'affiche qu'un message court. */
export function logAiFailure(action: string, err: unknown) {
  logger.error(err as Error, `AI action failed: ${action}`);
}
