/**
 * Micro-serveur de build Tauri (tourne dans le conteneur Ubuntu+Rust).
 * Expose une API HTTP simple que le serveur principal appelle.
 */
import http from 'http';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4000;
const PROJECT_SRC = '/project';       // monté en volume depuis le host
const DOWNLOADS_OUT = '/downloads';   // volume partagé avec le serveur principal
const BUNDLE_DIR = path.join(PROJECT_SRC, 'src-tauri/target/release/bundle');

let activeBuild = null;   // { status, log, listeners }

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

function collectBundle() {
  const exts = ['.deb', '.AppImage'];
  const result = [];
  for (const ext of exts) {
    const subdir = ext === '.deb' ? 'deb' : 'appimage';
    const dir = path.join(BUNDLE_DIR, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase().endsWith(ext.toLowerCase())) result.push(path.join(dir, f));
    }
  }
  return result;
}

function copyToDownloads(files) {
  ensureDir(DOWNLOADS_OUT);
  for (const src of files) {
    const dst = path.join(DOWNLOADS_OUT, path.basename(src));
    fs.copyFileSync(src, dst);
  }
}

function broadcast(type, payload) {
  if (!activeBuild) return;
  const data = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  if (type === 'log') activeBuild.log.push(payload.line);
  for (const res of activeBuild.listeners) {
    try { res.write(data); } catch {}
  }
  if (type === 'status' && payload.status !== 'running') {
    for (const res of activeBuild.listeners) { try { res.end(); } catch {} }
    activeBuild.listeners.clear();
  }
}

function runBuild(serverUrl) {
  activeBuild = { status: 'running', log: [], listeners: new Set() };

  setImmediate(() => {
    broadcast('log', { line: `🚀 Build Linux Tauri — URL serveur: ${serverUrl}` });

    const configOverride = JSON.stringify({
      build: { frontendDist: serverUrl },
      productName: 'WebMail',
      version: '1.6.0',
    });

    // Install npm deps if needed
    try {
      broadcast('log', { line: '📦 npm ci (client)…' });
      execSync('npm ci --prefer-offline 2>&1', { cwd: path.join(PROJECT_SRC, 'client'), stdio: 'pipe' });
    } catch (e) {
      broadcast('log', { line: `⚠️ npm ci: ${e.message}` });
    }

    const args = ['tauri', 'build', '--config', configOverride];
    broadcast('log', { line: `▶ npx ${args.join(' ')}` });

    const proc = spawn('npx', args, {
      cwd: PROJECT_SRC,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', PATH: `/root/.cargo/bin:${process.env.PATH}` },
    });

    proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => broadcast('log', { line: l })));
    proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => broadcast('log', { line: l })));

    proc.on('close', code => {
      if (code === 0) {
        broadcast('log', { line: '✅ Build OK — copie des artefacts…' });
        try {
          const files = collectBundle();
          copyToDownloads(files);
          broadcast('log', { line: `📁 ${files.length} fichier(s) copié(s) dans /downloads` });
        } catch (e) {
          broadcast('log', { line: `⚠️ Copie: ${e.message}` });
        }
        activeBuild.status = 'success';
        broadcast('status', { status: 'success' });
      } else {
        activeBuild.status = 'error';
        broadcast('log', { line: `❌ Build échoué (code ${code})` });
        broadcast('status', { status: 'error', message: `code ${code}` });
      }
    });

    proc.on('error', err => {
      activeBuild.status = 'error';
      broadcast('log', { line: `❌ ${err.message}` });
      broadcast('status', { status: 'error', message: err.message });
    });
  });
}

// ── HTTP router ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // POST /build
  if (req.method === 'POST' && url.pathname === '/build') {
    if (activeBuild?.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Build already running' }));
    }
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const { serverUrl = 'http://localhost:3000' } = JSON.parse(body || '{}');
      runBuild(serverUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // GET /log  (SSE)
  if (req.method === 'GET' && url.pathname === '/log') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    if (!activeBuild) {
      res.write(`data: ${JSON.stringify({ type: 'status', status: 'idle' })}\n\n`);
      return res.end();
    }
    for (const line of activeBuild.log) {
      res.write(`data: ${JSON.stringify({ type: 'log', line })}\n\n`);
    }
    if (activeBuild.status !== 'running') {
      res.write(`data: ${JSON.stringify({ type: 'status', status: activeBuild.status })}\n\n`);
      return res.end();
    }
    activeBuild.listeners.add(res);
    req.on('close', () => activeBuild?.listeners.delete(res));
    return;
  }

  // GET /status
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: activeBuild?.status ?? 'idle' }));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[tauri-builder] listening on :${PORT}`);
});
