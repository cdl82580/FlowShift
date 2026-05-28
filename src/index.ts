import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { initDb } from './db';
import usersRouter from './routes/users';
import runsRouter from './routes/runs';
import authRouter from './routes/auth';

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve built frontend assets
app.use(express.static(PUBLIC_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'flowshift-api', timestamp: new Date().toISOString() });
});

// OAuth callbacks stay at /auth (matches GCP redirect URI)
app.use('/auth', authRouter);
// Data API prefixed with /api to avoid SPA route collisions
app.use('/api/users', usersRouter);
app.use('/api/runs',  runsRouter);

// SPA fallback — any non-API route serves index.html
app.get('*', (_req, res) => {
  const index = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) {
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
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
