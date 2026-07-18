import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Manual CSP instead of helmet's: no upgrade-insecure-requests (breaks
// plain-HTTP deployments behind a TLS-terminating reverse proxy).
//
// script-src uses a per-request nonce rather than 'unsafe-inline'. The SPA
// bundle only loads external scripts, so the nonce exists for the two
// server-rendered pages that need an inline script: the OAuth popup-closing
// page (routes/admin.ts) and the public calendar page (routes/calendarPublic.ts).
// Both read the nonce from res.locals.cspNonce. Note that nonces do NOT cover
// inline event handlers (onclick="…"), only <script nonce="…"> elements —
// server-rendered pages must attach handlers via addEventListener.
//
// style-src keeps 'unsafe-inline': React style attributes and injected
// <style> tags (Quill, Coloris…) depend on it.
export function cspMiddleware(_req: Request, res: Response, next: NextFunction) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    `script-src 'self' 'nonce-${nonce}'; ` +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: blob: https:; " +
    "frame-src 'self' blob: data:; " +
    "connect-src 'self' wss: ws:; " +
    "font-src 'self' data: https://fonts.gstatic.com; " +
    "worker-src 'self' blob:; " +
    "manifest-src 'self'"
  );
  next();
}
