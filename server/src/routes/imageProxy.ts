import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import { URL } from 'url';
import path from 'path';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
const MAX_SIGN_BATCH = 500;
const MAX_URL_LENGTH = 4096;
// Plafond de taille de la réponse upstream — 15 Mo par défaut, largement
// au-dessus de toute image d'email légitime. Surchargable via IMAGE_PROXY_MAX_BYTES.
const MAX_RESPONSE_BYTES =
  Number(process.env.IMAGE_PROXY_MAX_BYTES) > 0
    ? Number(process.env.IMAGE_PROXY_MAX_BYTES)
    : 15 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Signature HMAC des URLs (anti « open proxy »)
//
// La route GET est montée sans authMiddleware car les <img> des emails ne
// peuvent pas envoyer de Bearer token. À la place, chaque URL proxifiée doit
// porter une signature HMAC-SHA256 délivrée par POST /sign (authentifié) au
// moment du rendu du mail — même modèle que le proxy camo de GitHub. La
// signature est déterministe (pas d'expiration) pour que le cache du service
// worker reste stable.
// ---------------------------------------------------------------------------

const SIGNING_KEY = crypto
  .createHmac('sha256', process.env.IMAGE_PROXY_SECRET || process.env.SESSION_SECRET || 'dev-secret-change-me')
  .update('image-proxy-url-signing-v1')
  .digest();

export function signImageUrl(url: string): string {
  return crypto.createHmac('sha256', SIGNING_KEY).update(url).digest('hex');
}

function verifyImageSignature(url: string, sig: string): boolean {
  const expected = Buffer.from(signImageUrl(url), 'utf8');
  const provided = Buffer.from(sig.toLowerCase(), 'utf8');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// Anti-SSRF : blocage des adresses privées / loopback / link-local
//
// La validation se fait sur les adresses effectivement résolues (pas sur le
// hostname), via l'option `lookup` de http.get : la connexion est épinglée
// sur les adresses validées, donc pas de fenêtre TOCTOU exploitable par DNS
// rebinding. Les redirections repassent par fetchImage, donc chaque saut est
// re-vérifié.
// ---------------------------------------------------------------------------

/** Convertit une IPv4 pointée en entier 32 bits, ou null si invalide. */
function parseIPv4(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8],  // 0.0.0.0/8 « ce réseau » (0.0.0.0 = localhost sous Linux)
  [0x0a000000, 8],  // 10.0.0.0/8 privé
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT
  [0x7f000000, 8],  // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local (dont 169.254.169.254, métadonnées cloud)
  [0xac100000, 12], // 172.16.0.0/12 privé
  [0xc0000000, 24], // 192.0.0.0/24 réservé IETF
  [0xc0000200, 24], // 192.0.2.0/24 TEST-NET-1
  [0xc0586300, 24], // 192.88.99.0/24 relais 6to4
  [0xc0a80000, 16], // 192.168.0.0/16 privé
  [0xc6120000, 15], // 198.18.0.0/15 bancs d'essai
  [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 4],  // 224.0.0.0/4 multicast
  [0xf0000000, 4],  // 240.0.0.0/4 réservé + broadcast
];

function isBlockedIPv4(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(
    ([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits),
  );
}

/** Développe une IPv6 en 8 groupes de 16 bits, ou null si invalide. */
function expandIPv6(addr: string): number[] | null {
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);

  // Queue IPv4 pointée (formes ::ffff:192.168.0.1 / ::192.168.0.1)
  if (addr.includes('.')) {
    const idx = addr.lastIndexOf(':');
    const v4 = parseIPv4(addr.slice(idx + 1));
    if (v4 === null) return null;
    addr = addr.slice(0, idx + 1) + `${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups: number[] = [];
  for (const g of [...left, ...Array(Math.max(missing, 0)).fill('0'), ...right]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    groups.push(parseInt(g, 16));
  }
  return groups.length === 8 ? groups : null;
}

function isBlockedIPv6(addr: string): boolean {
  const groups = expandIPv6(addr);
  if (!groups) return true; // adresse illisible → on bloque
  const [g0, g1, g2, , , g5, g6, g7] = groups;
  const zeroThrough = (end: number) => groups.slice(0, end).every((g) => g === 0);

  // :: (non spécifiée) et ::1 (loopback)
  if (zeroThrough(7) && g7 <= 1) return true;
  // IPv4-mapped ::ffff:0:0/96 et IPv4-compatible ::/96 → vérifier l'IPv4 embarquée
  if (zeroThrough(5) && (g5 === 0xffff || g5 === 0)) {
    return isBlockedIPv4(g6 * 0x10000 + g7);
  }
  // NAT64 64:ff9b::/96 → IPv4 embarquée
  if (g0 === 0x64 && g1 === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return isBlockedIPv4(g6 * 0x10000 + g7);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true;        // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return true;        // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true;        // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true;  // 2001:db8::/32 documentation
  if (g0 === 0x2002) {                              // 2002::/16 6to4 → IPv4 embarquée
    return isBlockedIPv4(g1 * 0x10000 + g2);
  }
  return false;
}

export function isBlockedAddress(addr: string): boolean {
  const family = net.isIP(addr);
  if (family === 4) {
    const value = parseIPv4(addr);
    return value === null ? true : isBlockedIPv4(value);
  }
  if (family === 6) return isBlockedIPv6(addr);
  return true;
}

const SSRF_ERROR_CODE = 'ESSRFBLOCKED';

function ssrfError(hostname: string): NodeJS.ErrnoException {
  const err = new Error(`Adresse réseau interdite pour ${hostname}`) as NodeJS.ErrnoException;
  err.code = SSRF_ERROR_CODE;
  return err;
}

/**
 * Résolution DNS filtrée, passée à http.get via l'option `lookup` : si UNE des
 * adresses résolues est privée/loopback/link-local, tout est refusé (empêche le
 * rebinding par enregistrements mixtes publics + privés). La socket se connecte
 * exclusivement aux adresses retournées ici — validation et connexion partagent
 * donc la même résolution.
 */
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, result) => {
    if (err) return callback(err);
    const addresses = result as unknown as dns.LookupAddress[];
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(ssrfError(hostname));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

// ---------------------------------------------------------------------------
// Proxy à proprement parler
// ---------------------------------------------------------------------------

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

  // Les IP littérales court-circuitent l'option `lookup` de net.connect
  // (Node se connecte directement sans résolution) : valider ici. Le parseur
  // WHATWG a déjà normalisé les formes décimales/octales (http://2130706433/
  // devient 127.0.0.1) et les IPv6 compressées.
  const literalHost = target.hostname.startsWith('[') && target.hostname.endsWith(']')
    ? target.hostname.slice(1, -1)
    : target.hostname;
  if (net.isIP(literalHost) !== 0 && isBlockedAddress(literalHost)) {
    res.status(403).send('Forbidden target address');
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
      lookup: safeLookup as net.LookupFunction,
    },
    (proxyRes) => {
      const status = proxyRes.statusCode ?? 0;

      // Suivi des redirections — fetchImage re-valide protocole et adresses résolues
      if (status >= 301 && status <= 308) {
        const location = proxyRes.headers['location'];
        if (!location) {
          proxyRes.resume();
          res.status(502).send('Redirect without Location');
          return;
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, target).toString();
        } catch {
          proxyRes.resume();
          res.status(502).send('Invalid redirect Location');
          return;
        }
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

      // Plafond de taille : refus immédiat si l'upstream annonce trop gros
      const declaredLength = Number(proxyRes.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        req.destroy();
        res.status(413).send('Image too large');
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

      // Streaming plafonné : Content-Length peut mentir (ou être absent en
      // chunked), donc on compte les octets réellement reçus. Backpressure
      // manuelle puisqu'on n'utilise plus pipe().
      let sent = 0;
      proxyRes.on('data', (chunk: Buffer) => {
        sent += chunk.length;
        if (sent > MAX_RESPONSE_BYTES) {
          req.destroy();
          res.destroy();
          return;
        }
        if (!res.write(chunk)) {
          proxyRes.pause();
          res.once('drain', () => proxyRes.resume());
        }
      });
      proxyRes.on('end', () => res.end());
      proxyRes.on('error', () => res.destroy());
      res.on('close', () => {
        if (!res.writableEnded) req.destroy();
      });
    },
  );

  req.on('timeout', () => {
    req.destroy();
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'image/gif');
      res.end(TRANSPARENT_GIF);
    }
  });

  req.on('error', (err: NodeJS.ErrnoException) => {
    if (res.headersSent) return;
    if (err.code === SSRF_ERROR_CODE) {
      res.status(403).send('Forbidden target address');
      return;
    }
    res.setHeader('Content-Type', 'image/gif');
    res.end(TRANSPARENT_GIF);
  });
}

/**
 * Signe un lot d'URLs d'images au moment du rendu d'un mail. Authentifié :
 * seul un utilisateur connecté peut fabriquer des URLs proxifiées valides.
 */
router.post('/sign', authMiddleware, (req: Request, res: Response) => {
  const urls = (req.body as { urls?: unknown } | undefined)?.urls;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_SIGN_BATCH) {
    res.status(400).json({ error: `urls doit être un tableau de 1 à ${MAX_SIGN_BATCH} éléments` });
    return;
  }

  const signatures: Record<string, string> = {};
  for (const url of urls) {
    if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) continue;
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    signatures[url] = signImageUrl(url);
  }
  res.json({ signatures });
});

router.get('/', (req: Request, res: Response) => {
  // CSP sandbox dédié (même modèle que le proxy camo de GitHub) : un SVG
  // malveillant ouvert en navigation directe s'exécute dans une origine opaque
  // sans scripts, indépendamment du CSP global de l'application.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");

  const urlParam = req.query.url;
  const sigParam = req.query.sig;
  if (typeof urlParam !== 'string' || !urlParam || urlParam.length > MAX_URL_LENGTH) {
    res.status(400).send('Missing url parameter');
    return;
  }

  if (typeof sigParam !== 'string' || !verifyImageSignature(urlParam, sigParam)) {
    res.status(403).send('Missing or invalid signature');
    return;
  }

  fetchImage(urlParam, MAX_REDIRECTS, res);
});

export { router as imageProxyRouter };
