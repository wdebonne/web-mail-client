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
import { authMiddleware } from './middleware/auth';
import { setupWebSocket } from './services/websocket';
import { PluginManager } from './plugins/manager';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      fontSrc: ["'self'", 'data:'],
      workerSrc: ["'self'", 'blob:'],
      manifestSrc: ["'self'"],
    },
  },
}));
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
app.use('/api/plugins', authMiddleware, pluginRouter);
app.use('/api/search', authMiddleware, searchRouter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

    // Initialize plugin manager
    const pluginManager = PluginManager.getInstance();
    await pluginManager.loadPlugins();
    logger.info('Plugins loaded');

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
