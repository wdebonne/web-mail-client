import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { createServer } from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import { logger } from './utils/logger';
import { db, pool, initDatabase } from './database/connection';
import { authRouter } from './routes/auth';
import { mailRouter } from './routes/mail';
import { contactRouter } from './routes/contacts';
import { calendarRouter } from './routes/calendar';
import { calendarPublicRouter } from './routes/calendarPublic';
import { settingsRouter } from './routes/settings';
import { accountRouter } from './routes/accounts';
import { adminRouter, oauthCallbackRouter } from './routes/admin';
import { pluginRouter } from './routes/plugins';
import { searchRouter } from './routes/search';
import { pushRouter } from './routes/push';
import { autoResponderRouter } from './routes/autoResponder';
import { mailTemplateRouter, adminMailTemplateRouter } from './routes/mailTemplates';
import { rulesRouter, adminRulesRouter } from './routes/rules';
import { nextcloudFilesRouter } from './routes/nextcloudFiles';
import { brandingPublicRouter, brandingAdminRouter, BRANDING_DIR, BRANDING_FILES } from './routes/branding';
import { applicationsRouter } from './routes/applications';
import { backupRouter } from './routes/backup';
import { imageProxyRouter } from './routes/imageProxy';
import { translateRouter } from './routes/translate';
import { startBackupScheduler } from './services/backupScheduler';
import { bulkSendRouter, adminBulkSendRouter } from './routes/bulkSend';
import { startBulkSendProcessor } from './services/bulkSendProcessor';
import { startScheduledSendProcessor } from './services/scheduledSendProcessor';
import fs from 'fs';
import { authMiddleware } from './middleware/auth';
import { authLimiter } from './middleware/rateLimit';
import { cspMiddleware } from './middleware/csp';
import { setupWebSocket } from './services/websocket';
import { PluginManager } from './plugins/manager';
import { initPushService } from './services/push';
import { startNewMailPoller } from './services/newMailPoller';
import { startCalendarReminderPoller } from './services/calendarReminderPoller';
import { startNextCloudSyncPoller } from './services/nextcloudSyncPoller';
import { getWebAuthnConfig } from './services/webauthn';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Refuse to start in production without explicit secrets: the fallbacks below
// are public on GitHub, so sessions could be forged and every stored
// IMAP/LDAP/SSO password would be encrypted with a known key.
if (process.env.NODE_ENV === 'production') {
  const missing = ['SESSION_SECRET', 'ENCRYPTION_KEY'].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    logger.error(
      `Missing required environment variable(s) in production: ${missing.join(', ')}. ` +
      'Generate values with: openssl rand -hex 32'
    );
    process.exit(1);
  }
}

// Trust the first proxy hop (Nginx Proxy Manager / Traefik / etc.) so that
// Express honours X-Forwarded-Proto when deciding whether to set cookies
// with the `Secure` flag. Required for the httpOnly refresh cookie to be
// delivered over HTTPS behind a reverse proxy.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
  hsts: false,
}));

// Manual CSP with a per-request nonce on script-src (no 'unsafe-inline') —
// see middleware/csp.ts for the rationale and the res.locals.cspNonce contract.
app.use(cspMiddleware);
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173'],
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Session configuration
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax',
  },
}));

// Healthcheck — public et volontairement minimal (aucune info sensible).
// Utilisé par le HEALTHCHECK Docker et les sondes du reverse proxy : un
// conteneur en crash-loop (ex : initDatabase qui plante) est ainsi signalé
// `unhealthy` au lieu de produire des 502 mystérieux. 200 = process vivant
// et base de données joignable ; 503 = base injoignable.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

// API Routes
// Baseline IP rate limit on all auth endpoints (incl. /refresh, WebAuthn
// options, SSO). Sensitive routes add stricter per-route limiters in auth.ts.
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/mail', authMiddleware, mailRouter);
app.use('/api/contacts', authMiddleware, contactRouter);
app.use('/api/calendar', authMiddleware, calendarRouter);
app.use('/api/public/calendar', calendarPublicRouter);
app.use('/api/settings', authMiddleware, settingsRouter);
app.use('/api/accounts', authMiddleware, accountRouter);
// OAuth callbacks (Microsoft, …) must be mounted BEFORE the authenticated
// admin router. The browser redirect from login.microsoftonline.com only
// carries the session cookie, not the SPA's Bearer token, so the callback
// handler authenticates via `req.session.oauthUserId` (set at /start time).
app.use('/api/admin', oauthCallbackRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/admin/branding', authMiddleware, brandingAdminRouter);
app.use('/api/branding', brandingPublicRouter);
app.use('/api/plugins', authMiddleware, pluginRouter);
app.use('/api/search', authMiddleware, searchRouter);
app.use('/api/push', authMiddleware, pushRouter);
app.use('/api/auto-responder', authMiddleware, autoResponderRouter);
app.use('/api/mail-templates', authMiddleware, mailTemplateRouter);
app.use('/api/admin/mail-templates', authMiddleware, adminMailTemplateRouter);
app.use('/api/rules', authMiddleware, rulesRouter);
app.use('/api/admin/rules', authMiddleware, adminRulesRouter);
app.use('/api/nextcloud/files', authMiddleware, nextcloudFilesRouter);
app.use('/api/admin/applications', authMiddleware, applicationsRouter);
app.use('/api/admin/backup', authMiddleware, backupRouter);
// Proxy d'images des emails : monté sans authMiddleware global car les <img>
// ne peuvent pas envoyer de Bearer token. Protections dans le router lui-même :
// signature HMAC obligatoire sur GET (délivrée par POST /sign, authentifié) et
// blocage anti-SSRF des adresses privées/loopback/link-local après résolution DNS.
app.use('/api/proxy/image', imageProxyRouter);
app.use('/api/translate', authMiddleware, translateRouter);
app.use('/api/bulk-send', authMiddleware, bulkSendRouter);
app.use('/api/admin/bulk-send', authMiddleware, adminBulkSendRouter);

// 404 for any /api path not matched above — must stay after every API router.
// Without it, the production SPA catch-all matched GET /api/* without ever
// responding, leaving the request hanging until the client timed out.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Override icon files with custom admin-uploaded branding (served before static).
// If a custom file exists in uploads/branding/, serve it; otherwise fall through
// to the static frontend bundle.
for (const filename of Object.values(BRANDING_FILES)) {
  app.get(`/${filename}`, (_req, res, next) => {
    const full = path.join(BRANDING_DIR, filename);
    if (fs.existsSync(full)) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(full);
    }
    next();
  });
}

// Serve frontend in production. /api/* never reaches this catch-all: the
// JSON 404 handler above answers unmatched API paths first.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// WebSocket setup for real-time notifications
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// Initialize and start
async function start() {
  try {
    await initDatabase();
    logger.info('Database initialized');

    // Initialize Web Push (VAPID)
    await initPushService();

    // Initialize plugin manager
    const pluginManager = PluginManager.getInstance();
    await pluginManager.loadPlugins();
    logger.info('Plugins loaded');

    // Start periodic new-mail poller (only polls accounts whose owner subscribed to push)
    startNewMailPoller();

    // Start periodic calendar reminder poller (sends Web Push when an event's VALARM is due)
    startCalendarReminderPoller();

    // Start periodic NextCloud sync (pulls calendars + contacts for provisioned users)
    startNextCloudSyncPoller().catch((err) => logger.error(err, 'Failed to start NextCloud sync poller'));

    // Start automatic backup scheduler
    startBackupScheduler();
    startBulkSendProcessor();
    startScheduledSendProcessor();

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      const wa = getWebAuthnConfig();
      logger.info(
        { rpID: wa.rpID, origins: wa.origins },
        'WebAuthn effective config — the browser hostname MUST match rpID and ' +
        'the page URL MUST be one of the listed origins, otherwise passkeys ' +
        "will fail with 'rp.id cannot be used with the current origin'."
      );
    });
  } catch (error) {
    logger.error(error as Error, 'Failed to start server');
    process.exit(1);
  }
}

start();

export { app, server };
