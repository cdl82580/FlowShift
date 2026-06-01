import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { initDb } from './db';
import { checkAndUpdateModel } from './services/modelCheck';
import usersRouter from './routes/users';
import runsRouter  from './routes/runs';
import authRouter  from './routes/auth';
import slackRouter from './routes/slack';

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isProd = process.env.NODE_ENV === 'production';

// ── Trust Fly.io's proxy so req.ip reflects the real client IP ───────────────
app.set('trust proxy', 1);

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:"],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
    },
  },
  crossOriginOpenerPolicy:   { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: isProd ? config.appUrl : true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

// ── Slack routes — MUST be mounted before express.json/urlencoded ─────────────
// The Slack router uses express.raw() internally to capture the raw body for
// HMAC signature verification. If express.urlencoded() runs first it consumes
// the body stream, leaving nothing for express.raw() to read, causing the
// computed HMAC to be over an empty string → signature mismatch → 401.
app.use('/slack', slackRouter);

// ── Global body parsers (all non-Slack routes) ────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const tooManyRequests = { error: 'Too many requests — please slow down.' };

/** Run creation: 20/hr keyed on X-API-Key, plain IP fallback (no IPv6 issue) */
const runsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) return apiKey;
    // Normalise IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4) to avoid bypass
    const ip = req.ip ?? 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  },
  message: tooManyRequests,
});

/** Registration: 10/hr per IP */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequests,
});

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

app.get('/health', async (_req, res) => {
  const { getActiveModel } = await import('./services/modelCheck');
  const model = await getActiveModel().catch(() => config.claudeModel);
  res.json({ status: 'ok', service: 'flowshift-api', timestamp: new Date().toISOString(), model });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/auth',      authRouter);
app.use('/api/users', registerLimiter, usersRouter);
app.use('/api/runs',  runsLimiter,     runsRouter);

// ── Internal model-check endpoint (manual trigger) ───────────────────────────
app.post('/internal/model-check', express.json(), (req: express.Request, res: express.Response): void => {
  const secret = config.modelCheckSecret;
  if (secret && req.headers['x-internal-secret'] !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Fire-and-forget — respond immediately
  void checkAndUpdateModel();
  res.json({ ok: true, message: 'Model check triggered' });
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(index);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

initDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`FlowShift API running on port ${config.port}`);
      console.log(`Drive integration: ${config.driveEnabled ? 'enabled' : 'disabled'}`);
      console.log(`Slack integration: ${config.slackEnabled ? 'enabled' : 'disabled'}`);
      console.log(`Frontend: ${fs.existsSync(PUBLIC_DIR) ? 'serving from ' + PUBLIC_DIR : 'not built'}`);
      console.log(`Environment: ${isProd ? 'production' : 'development'}`);
    });

    // Run an immediate model check 30s after startup, then weekly thereafter
    setTimeout(() => {
      void checkAndUpdateModel();
      setInterval(() => void checkAndUpdateModel(), WEEK_MS);
    }, 30_000);
  })
  .catch((err) => {
    console.error('Failed to initialize:', err);
    process.exit(1);
  });
