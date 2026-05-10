import { Router, Response } from 'express';
import { AuthRequest, adminMiddleware } from '../middleware/auth';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export const applicationsRouter = Router();
applicationsRouter.use(adminMiddleware);

const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');
const BUILDER_URL = process.env.TAURI_BUILDER_URL || 'http://tauri-builder:4000';

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDownloadsDir() {
  if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function collectBuiltFiles(): Array<{ filename: string; platform: string; size: number; builtAt: string }> {
  ensureDownloadsDir();
  return fs.readdirSync(DOWNLOADS_DIR)
    .filter(f => /\.(exe|msi|deb|AppImage|dmg|apk)$/i.test(f))
    .map(filename => {
      const stat = fs.statSync(path.join(DOWNLOADS_DIR, filename));
      const ext = path.extname(filename).toLowerCase();
      const platform =
        ext === '.exe' || ext === '.msi' ? 'windows' :
        ext === '.deb' || ext === '.appimage' ? 'linux' :
        ext === '.dmg' ? 'macos' :
        ext === '.apk' ? 'android' : 'unknown';
      return { filename, platform, size: stat.size, builtAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.builtAt).getTime() - new Date(a.builtAt).getTime());
}

async function pingBuilder(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${BUILDER_URL}/status`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function triggerDockerBuild(serverUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BUILDER_URL}/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl }),
    });
    if (res.status === 409) return { ok: false, error: 'Un build est déjà en cours dans le conteneur' };
    if (!res.ok) return { ok: false, error: `Builder HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Impossible de joindre le builder Docker: ${err.message}` };
  }
}

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

async function resolveWorkflowId(token: string, owner: string, repo: string): Promise<number | null> {
  // GitHub indexe les workflows depuis la branche par défaut.
  // On liste tous les workflows pour trouver l'ID numérique de tauri-build.yml,
  // ce qui fonctionne même si le fichier n'est pas sur main.
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows?per_page=100`,
    { headers: GH_HEADERS(token) }
  );
  if (!res.ok) return null;
  const data = await res.json() as { workflows?: Array<{ id: number; path: string }> };
  const found = (data.workflows ?? []).find(
    w => w.path === '.github/workflows/tauri-build.yml'
  );
  return found?.id ?? null;
}

async function triggerGithubBuild(opts: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  serverUrl: string;
  version: string;
}): Promise<{ ok: boolean; runUrl?: string; error?: string }> {
  const { token, owner, repo, branch, serverUrl, version } = opts;

  // Résoudre l'ID numérique du workflow (contourne le bug 404 quand le
  // fichier n'est pas sur la branche par défaut du dépôt)
  const workflowId = await resolveWorkflowId(token, owner, repo);
  if (!workflowId) {
    return {
      ok: false,
      error: `Workflow introuvable dans ${owner}/${repo}. `
        + `Le fichier .github/workflows/tauri-build.yml doit être présent sur la branche par défaut (main). `
        + `Fusionnez-le depuis Dev → main, ou changez la branche par défaut du dépôt sur GitHub (Settings → Branches).`,
    };
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: 'POST',
      headers: GH_HEADERS(token),
      body: JSON.stringify({
        ref: branch,
        inputs: { server_url: serverUrl, version },
      }),
    }
  );

  if (res.status === 204) {
    return { ok: true, runUrl: `https://github.com/${owner}/${repo}/actions` };
  }
  const body = await res.json().catch(() => ({})) as any;

  if (res.status === 403) {
    return { ok: false, error: `403 — Token insuffisant. PAT classique : scope "workflow" requis. PAT fine-grained : permission "Actions → Read and write" requise.` };
  }
  if (res.status === 404) {
    return { ok: false, error: `404 — Dépôt "${owner}/${repo}" introuvable ou token sans accès à ce dépôt.` };
  }
  if (res.status === 422) {
    return { ok: false, error: `422 — La branche "${branch}" n'existe pas dans ce dépôt.` };
  }
  return { ok: false, error: body?.message ?? `GitHub API ${res.status}` };
}

async function getGithubRuns(token: string, owner: string, repo: string) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/tauri-build.yml/runs?per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  if (!res.ok) return [];
  const data = await res.json() as any;
  return (data.workflow_runs ?? []).map((r: any) => ({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    htmlUrl: r.html_url,
    artifactsUrl: `https://api.github.com/repos/${owner}/${repo}/actions/runs/${r.id}/artifacts`,
  }));
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/admin/applications/info
applicationsRouter.get('/info', async (_req: AuthRequest, res) => {
  const [builderAvailable] = await Promise.all([pingBuilder()]);
  res.json({
    builderAvailable,
    builderUrl: BUILDER_URL,
    builds: collectBuiltFiles(),
  });
});

// POST /api/admin/applications/build/docker
applicationsRouter.post('/build/docker', async (req: AuthRequest, res) => {
  const { serverUrl = 'http://localhost:3000' } = req.body as { serverUrl?: string };
  const result = await triggerDockerBuild(serverUrl);
  if (!result.ok) return res.status(422).json({ error: result.error });
  res.json({ ok: true });
});

// GET /api/admin/applications/build/docker/log  (SSE — proxy vers le builder)
applicationsRouter.get('/build/docker/log', async (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const ctrl = new AbortController();
  req.on('close', () => ctrl.abort());

  try {
    const upstream = await fetch(`${BUILDER_URL}/log`, { signal: ctrl.signal });
    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value));
    }
    res.end();
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'error', message: err.message })}\n\n`);
    }
    res.end();
  }
});

// POST /api/admin/applications/build/github
applicationsRouter.post('/build/github', async (req: AuthRequest, res) => {
  const { token, owner, repo, branch = 'main', serverUrl = 'http://localhost:3000', version = '1.7.0' } = req.body as {
    token: string; owner: string; repo: string; branch?: string; serverUrl?: string; version?: string;
  };
  if (!token || !owner || !repo) {
    return res.status(400).json({ error: 'token, owner et repo sont requis' });
  }
  const result = await triggerGithubBuild({ token, owner, repo, branch, serverUrl, version });
  if (!result.ok) return res.status(422).json({ error: result.error });
  res.json({ ok: true, runUrl: result.runUrl });
});

// GET /api/admin/applications/build/github/runs
applicationsRouter.get('/build/github/runs', async (req: AuthRequest, res) => {
  const { token, owner, repo } = req.query as { token?: string; owner?: string; repo?: string };
  if (!token || !owner || !repo) return res.status(400).json({ error: 'token, owner, repo requis' });
  try {
    const runs = await getGithubRuns(token, owner, repo);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/applications/download/:filename
applicationsRouter.get('/download/:filename', (req: AuthRequest, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w\-. ]+$/.test(filename)) return res.status(400).json({ error: 'Nom de fichier invalide' });
  const filepath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier non trouvé' });
  res.download(filepath, filename);
});

// DELETE /api/admin/applications/download/:filename
applicationsRouter.delete('/download/:filename', (req: AuthRequest, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w\-. ]+$/.test(filename)) return res.status(400).json({ error: 'Nom de fichier invalide' });
  const filepath = path.join(DOWNLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Fichier non trouvé' });
  fs.unlinkSync(filepath);
  res.json({ ok: true });
});
