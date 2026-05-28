import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { initDb } from './db';
import usersRouter from './routes/users';
import runsRouter from './routes/runs';
import authRouter from './routes/auth';

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
      styleSrc:    ["'self'", "'unsafe-inline'"],   // Tailwind utility classes
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

// ── CORS — restrict to app origin in production ───────────────────────────────
app.use(cors({
  origin: isProd ? config.appUrl : true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const tooManyRequests = { error: 'Too many requests — please slow down.' };

/** Recovery email: max 5 requests per 15 min per IP */
const recoverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequests,
});

/** Run creation: max 20 per hour per API key (keyed on X-API-Key, falls back to IP) */
const runsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.headers['x-api-key'] as string) || req.ip || 'unknown',
  message: tooManyRequests,
});

/** Registration: max 10 per hour per IP */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequests,
});

// ── Static frontend ───────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'flowshift-api', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/api/users',         registerLimiter, usersRouter);
app.post('/api/users/recover', recoverLimiter); // extra guard on the recovery sub-route
app.use('/api/runs',          runsLimiter,     runsRouter);

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

initDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`FlowShift API running on port ${config.port}`);
      console.log(`Drive integration: ${config.driveEnabled ? 'enabled' : 'disabled'}`);
      console.log(`Frontend: ${fs.existsSync(PUBLIC_DIR) ? 'serving from ' + PUBLIC_DIR : 'not built'}`);
      console.log(`Environment: ${isProd ? 'production' : 'development'}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize:', err);
    process.exit(1);
  });
