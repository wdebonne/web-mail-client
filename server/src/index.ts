import 'dotenv/config';
// Force the Node process timezone to UTC so Date() stringification and any
// date math are stable regardless of the host / container system timezone.
// This must run before any module that instantiates Date objects at import time.
process.env.TZ = process.env.TZ || 'UTC';
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
import { db, initDatabase } from './database/connection';
import { authRouter } from './routes/auth';
import { mailRouter } from './routes/mail';
import { contactRouter } from './routes/contacts';
import { calendarRouter } from './routes/calendar';
import { settingsRouter } from './routes/settings';
import { accountRouter } from './routes/accounts';
import { adminRouter } from './routes/admin';
import { pluginRouter } from './routes/plugins';
import { searchRouter } from './routes/search';
import { pushRouter } from './routes/push';
import { brandingPublicRouter, brandingAdminRouter, BRANDING_DIR, BRANDING_FILES } from './routes/branding';
import fs from 'fs';
import { authMiddleware } from './middleware/auth';
import { setupWebSocket } from './services/websocket';
import { PluginManager } from './plugins/manager';
import { initPushService } from './services/push';
import { startNewMailPoller } from './services/newMailPoller';
import { startNextCloudSyncPoller } from './services/nextcloudSyncPoller';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
  hsts: false,
}));

// Manual CSP without upgrade-insecure-requests
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; " +
    "frame-src 'self' blob: data:; " +
    "connect-src 'self' wss: ws:; " +
    "font-src 'self' data:; " +
    "worker-src 'self' blob:; " +
    "manifest-src 'self'"
  );
  next();
});
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

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/mail', authMiddleware, mailRouter);
app.use('/api/contacts', authMiddleware, contactRouter);
app.use('/api/calendar', authMiddleware, calendarRouter);
app.use('/api/settings', authMiddleware, settingsRouter);
app.use('/api/accounts', authMiddleware, accountRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/admin/branding', authMiddleware, brandingAdminRouter);
app.use('/api/branding', brandingPublicRouter);
app.use('/api/plugins', authMiddleware, pluginRouter);
app.use('/api/search', authMiddleware, searchRouter);
app.use('/api/push', authMiddleware, pushRouter);

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

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
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

    // Start periodic NextCloud sync (pulls calendars + contacts for provisioned users)
    startNextCloudSyncPoller().catch((err) => logger.error(err, 'Failed to start NextCloud sync poller'));

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(error as Error, 'Failed to start server');
    process.exit(1);
  }
}

start();

export { app, server };
