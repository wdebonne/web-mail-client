import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import { URL } from 'url';

const router = Router();

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;

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
      },
      timeout: TIMEOUT_MS,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 0;

      if (status >= 301 && status <= 308) {
        const location = proxyRes.headers['location'];
        if (!location) {
          res.status(502).send('Redirect without Location');
          return;
        }
        const nextUrl = new URL(location, target).toString();
        proxyRes.resume();
        fetchImage(nextUrl, redirectsLeft - 1, res);
        return;
      }

      if (status < 200 || status >= 300) {
        res.status(502).send('Upstream error');
        proxyRes.resume();
        return;
      }

      const contentType = proxyRes.headers['content-type'] ?? '';
      if (!contentType.startsWith('image/') && !contentType.startsWith('application/octet-stream')) {
        res.status(400).send('Not an image');
        proxyRes.resume();
        return;
      }

      res.setHeader('Content-Type', contentType.split(';')[0].trim());
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      proxyRes.pipe(res);
    }
  );

  req.on('timeout', () => {
    req.destroy();
    if (!res.headersSent) res.status(504).send('Timeout');
  });

  req.on('error', () => {
    if (!res.headersSent) res.status(502).send('Fetch error');
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
