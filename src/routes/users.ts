import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { requireApiKey, AuthedRequest } from '../auth';
import { config } from '../config';

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

async function sendRecoveryEmail(toEmail: string, recoveryUrl: string): Promise<void> {
  if (!config.resendApiKey) {
    // Dev fallback: log the link so local testing still works
    console.log(`[RECOVERY] No RESEND_API_KEY — recovery URL: ${recoveryUrl}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `FlowShift <${config.fromEmail}>`,
      to: [toEmail],
      subject: 'Your FlowShift API key recovery link',
      html: `
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
        </div>`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

// ── routes ────────────────────────────────────────────────────────────────────

// POST /api/users — register
router.post('/', async (req: Request, res: Response) => {
  const { email, name } = req.body as { email?: string; name?: string };

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
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
router.post('/recover', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const neutral = { message: 'If that email is registered, a recovery link has been sent.' };

  const result = await db.execute({
    sql: 'SELECT id, email FROM users WHERE email = ?',
    args: [normalizedEmail],
  });

  if (!result.rows.length) {
    // Don't reveal whether the email exists
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
    console.error('Failed to send recovery email:', err);
    return res.status(500).json({ error: 'Could not send recovery email. Try again later.' });
  }

  return res.json(neutral);
});

// GET /api/users/recover/:token — exchange token for new API key
router.get('/recover/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const db = getDb();

  const result = await db.execute({
    sql: 'SELECT * FROM recovery_tokens WHERE token = ? AND used = 0',
    args: [token],
  });

  if (!result.rows.length) {
    return res.status(400).json({ error: 'Invalid or already-used recovery link.' });
  }

  const row = result.rows[0];
  if (new Date(row.expires_at as string) < new Date()) {
    return res.status(400).json({ error: 'Recovery link has expired. Request a new one.' });
  }

  const newApiKey = uuidv4();

  await db.execute({
    sql: 'UPDATE recovery_tokens SET used = 1 WHERE token = ?',
    args: [token],
  });

  await db.execute({
    sql: 'UPDATE users SET api_key = ? WHERE id = ?',
    args: [newApiKey, row.user_id],
  });

  const userResult = await db.execute({
    sql: 'SELECT id, email, name FROM users WHERE id = ?',
    args: [row.user_id],
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

  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, source, destination, status, original_filename,
                 gdrive_run_folder_url, error_message, created_at, completed_at
          FROM runs WHERE user_id = ? ORDER BY created_at DESC`,
    args: [req.params.id],
  });

  return res.json({ runs: result.rows });
});

export default router;
