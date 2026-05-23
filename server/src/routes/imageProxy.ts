import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import path from 'path';

const router = Router();

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;

// Réponse de repli pour les pixels de tracking (204 / body vide / content-type absent)
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.ico', '.bmp', '.avif', '.tiff', '.tif', '.apng',
]);

/**
 * Détermine si la réponse upstream est acceptable pour un proxy d'image email.
 * On est permissif : content-type absent ou binaire générique → on laisse passer
 * (le pire cas est une icône "image cassée", pas un risque de sécurité puisque
 * les `<img>` n'exécutent jamais de HTML/JS).
 */
function isImageLike(contentType: string, urlStr: string): boolean {
  const ct = contentType.toLowerCase().split(';')[0].trim();

  if (!ct) {
    // Pas de content-type : accepter si l'URL ressemble à une image, sinon laisser passer
    try {
      const ext = path.extname(new URL(urlStr).pathname).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) || ext === '';
    } catch {
      return true;
    }
  }

  if (ct.startsWith('image/')) return true;
  if (ct === 'application/octet-stream' || ct === 'binary/octet-stream') return true;

  // Dernière chance : extension connue même si content-type inattendu (CDN mal configuré)
  try {
    const ext = path.extname(new URL(urlStr).pathname).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return true;
  } catch { /* ignore */ }

  return false;
}

function fetchImage(urlStr: string, redirectsLeft: number, res: Response): void {
  if (redirectsLeft < 0) {
    res.status(400).send('Too many redirects');
    return;
  }

  let target: URL;
  try {
    target = new URL(urlStr);
  } catch {
    res.status(400).send('Invalid URL');
    return;
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    res.status(400).send('Invalid protocol');
    return;
  }

  const client = target.protocol === 'https:' ? https : http;

  const req = client.get(
    target.toString(),
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebMailClient/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
        'Accept-Encoding': 'identity',
      },
      timeout: TIMEOUT_MS,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 0;

      // Suivi des redirections
      if (status >= 301 && status <= 308) {
        const location = proxyRes.headers['location'];
        if (!location) {
          proxyRes.resume();
          res.status(502).send('Redirect without Location');
          return;
        }
        const nextUrl = new URL(location, target).toString();
        proxyRes.resume();
        fetchImage(nextUrl, redirectsLeft - 1, res);
        return;
      }

      // 204 No Content : pixel de tracking sans corps → GIF transparent
      if (status === 204) {
        proxyRes.resume();
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(TRANSPARENT_GIF);
        return;
      }

      if (status < 200 || status >= 300) {
        proxyRes.resume();
        // Upstream en erreur : on renvoie le GIF transparent plutôt qu'une icône cassée
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Cache-Control', 'no-store');
        res.end(TRANSPARENT_GIF);
        return;
      }

      const contentType = proxyRes.headers['content-type'] ?? '';

      if (!isImageLike(contentType, urlStr)) {
        proxyRes.resume();
        res.status(400).send('Not an image');
        return;
      }

      // Utilise le content-type upstream ou déduit de l'extension
      let outContentType = contentType.split(';')[0].trim();
      if (!outContentType) {
        try {
          const ext = path.extname(new URL(urlStr).pathname).toLowerCase();
          const mime: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif',
          };
          outContentType = mime[ext] ?? 'image/jpeg';
        } catch {
          outContentType = 'image/jpeg';
        }
      }

      res.setHeader('Content-Type', outContentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      proxyRes.pipe(res);
    },
  );

  req.on('timeout', () => {
    req.destroy();
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'image/gif');
      res.end(TRANSPARENT_GIF);
    }
  });

  req.on('error', () => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'image/gif');
      res.end(TRANSPARENT_GIF);
    }
  });
}

router.get('/', (req: Request, res: Response) => {
  const urlParam = req.query.url;
  if (typeof urlParam !== 'string' || !urlParam) {
    res.status(400).send('Missing url parameter');
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlParam);
  } catch {
    res.status(400).send('Malformed url parameter');
    return;
  }

  fetchImage(decoded, MAX_REDIRECTS, res);
});

export { router as imageProxyRouter };
