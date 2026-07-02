import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db';
import { requireApiKey, AuthedRequest } from '../auth';
import { config } from '../config';
import { sendEmail } from '../services/email';

// Stricter limit for the recovery endpoint specifically — prevents email flooding
const recoverLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many recovery requests — please wait 15 minutes.' },
});

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

async function sendRecoveryEmail(toEmail: string, recoveryUrl: string): Promise<void> {
  await sendEmail(
    toEmail,
    'Your FlowShift API key recovery link',
    `
      <div style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="color:#4f46e5;margin:0 0 16px">FlowShift — API Key Recovery</h2>
        <p style="color:#374151;line-height:1.6">
          Click the button below to generate a new API key.
          This link is valid for <strong>15 minutes</strong> and works only once.
        </p>
        <p style="margin:28px 0;text-align:center">
          <a href="${recoveryUrl}"
             style="background:#4f46e5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">
            Reset my API key
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">
          If you didn't request this, ignore this email — your current key remains unchanged.
        </p>
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0">
        <p style="color:#9ca3af;font-size:12px;margin:0">FlowShift · iPaaS Migration Playbooks</p>
      </div>`
  );
}

// ── routes ────────────────────────────────────────────────────────────────────

// POST /api/users — register
router.post('/', async (req: Request, res: Response) => {
  const { email, name } = req.body as { email?: string; name?: string };

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (name && name.trim().length > 200) {
    return res.status(400).json({ error: 'Name must be 200 characters or fewer' });
  }

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.execute({
    sql: 'SELECT id FROM users WHERE email = ?',
    args: [normalizedEmail],
  });
  if (existing.rows.length) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }

  const id = uuidv4();
  const apiKey = uuidv4();

  await db.execute({
    sql: 'INSERT INTO users (id, email, name, api_key) VALUES (?, ?, ?, ?)',
    args: [id, normalizedEmail, name?.trim() ?? null, apiKey],
  });

  return res.status(201).json({ id, email: normalizedEmail, name: name?.trim() ?? null, api_key: apiKey });
});

// POST /api/users/recover — request a recovery email
router.post('/recover', recoverLimiter, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  // Always return the same message regardless of whether the email is registered
  // (prevents account enumeration)
  const neutral = { message: 'If that email is registered, a recovery link has been sent.' };

  const result = await db.execute({
    sql: 'SELECT id, email FROM users WHERE email = ?',
    args: [normalizedEmail],
  });

  if (!result.rows.length) {
    return res.json(neutral);
  }

  const userId = result.rows[0].id as string;
  const token   = uuidv4();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await db.execute({
    sql: 'INSERT INTO recovery_tokens (token, user_id, expires_at) VALUES (?, ?, ?)',
    args: [token, userId, expires],
  });

  const recoveryUrl = `${config.appUrl}/recover?token=${token}`;

  try {
    await sendRecoveryEmail(normalizedEmail, recoveryUrl);
  } catch (err) {
    // Log server-side but don't return a different status — exposing a 500 only
    // for registered emails would let an attacker enumerate valid accounts.
    console.error('Failed to send recovery email:', err);
  }

  // Always return the neutral message — don't reveal send success/failure
  return res.json(neutral);
});

// GET /api/users/recover/:token — exchange token for new API key
router.get('/recover/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const db = getDb();

  // Atomic conditional UPDATE — only one concurrent request can get rowsAffected === 1.
  // This simultaneously checks existence, used status, and expiry in a single statement,
  // preventing the TOCTOU race condition of separate SELECT + UPDATE queries.
  const markUsed = await db.execute({
    sql: `UPDATE recovery_tokens
          SET used = 1
          WHERE token = ? AND used = 0 AND expires_at > datetime('now')`,
    args: [token],
  });

  if (markUsed.rowsAffected === 0) {
    return res.status(400).json({ error: 'Invalid, already-used, or expired recovery link.' });
  }

  // Fetch the user_id now that we know we atomically claimed this token
  const tokenData = await db.execute({
    sql: 'SELECT user_id FROM recovery_tokens WHERE token = ?',
    args: [token],
  });

  const userId = tokenData.rows[0].user_id as string;

  // Rotate API key
  const newApiKey = uuidv4();
  await db.execute({
    sql: 'UPDATE users SET api_key = ? WHERE id = ?',
    args: [newApiKey, userId],
  });

  // Prune stale tokens for this user (used ones + expired ones)
  await db.execute({
    sql: `DELETE FROM recovery_tokens
          WHERE user_id = ? AND (used = 1 OR expires_at <= datetime('now'))`,
    args: [userId],
  }).catch((e) => console.error('Token pruning failed (non-fatal):', e));

  const userResult = await db.execute({
    sql: 'SELECT id, email, name FROM users WHERE id = ?',
    args: [userId],
  });

  const user = userResult.rows[0];
  return res.json({
    api_key: newApiKey,
    id: user.id,
    email: user.email,
    name: user.name,
  });
});

// GET /api/users/me — identify caller by API key (must be before /:id)
router.get('/me', requireApiKey, (req: Request, res: Response) => {
  const { user } = req as AuthedRequest;
  const { api_key, ...safe } = user;
  return res.json(safe);
});

router.get('/:id', requireApiKey, (req: Request, res: Response) => {
  const { user } = req as AuthedRequest;
  if (user.id !== req.params.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { api_key, ...safe } = user;
  return res.json(safe);
});

router.get('/:id/runs', requireApiKey, async (req: Request, res: Response) => {
  const { user } = req as AuthedRequest;
  if (user.id !== req.params.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const limit  = Math.min(Math.max(parseInt(req.query.limit  as string || '50',  10), 1), 500);
  const offset = Math.max(parseInt(req.query.offset as string || '0', 10), 0);

  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, source, destination, status, original_filename,
                 gdrive_run_folder_url, error_message, created_at, completed_at
          FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    args: [req.params.id, limit, offset],
  });

  return res.json({ runs: result.rows, limit, offset });
});

export default router;
