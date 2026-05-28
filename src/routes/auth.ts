import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { getDb } from '../db';

const router = Router();

function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleOauthClientId,
    config.googleOauthClientSecret,
    `${config.appUrl}/auth/google/callback`
  );
}

// GET /auth/google — redirect to Google consent screen
router.get('/google', async (_req: Request, res: Response) => {
  if (!config.googleOauthClientId || !config.googleOauthClientSecret) {
    return res.status(503).json({
      error: 'OAuth not configured',
      hint: 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET as Fly.io secrets',
    });
  }

  // Generate and persist a one-time state token to defend against CSRF on the callback
  const state = uuidv4();
  const db = getDb();
  await db.execute({
    sql: `INSERT OR REPLACE INTO settings (key, value, updated_at)
          VALUES ('oauth_state', ?, datetime('now'))`,
    args: [state],
  });

  const url = getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
    prompt: 'consent',
    state,
  });

  return res.redirect(url);
});

// GET /auth/google/callback — exchange code, store refresh token
router.get('/google/callback', async (req: Request, res: Response) => {
  const code  = req.query.code  as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' });
  }

  // ── CSRF check: verify the state matches what we generated ──────────────────
  const db = getDb();
  const storedState = await db.execute({
    // Allow up to 10 minutes for the user to complete the consent screen
    sql: `SELECT value FROM settings
          WHERE key = 'oauth_state'
            AND updated_at > datetime('now', '-10 minutes')`,
    args: [],
  });

  const valid = storedState.rows.length > 0 && storedState.rows[0].value === state;

  // Always delete the state so it can't be replayed regardless of outcome
  await db.execute({ sql: `DELETE FROM settings WHERE key = 'oauth_state'`, args: [] })
    .catch((e) => console.error('Failed to delete oauth_state:', e));

  if (!valid) {
    return res.status(400).json({
      error: 'Invalid or expired state parameter. Please restart the authorization flow.',
    });
  }
  // ── End CSRF check ──────────────────────────────────────────────────────────

  try {
    const { tokens } = await getOAuth2Client().getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).json({
        error: 'No refresh token returned',
        hint: 'Revoke app access at https://myaccount.google.com/permissions and try again',
      });
    }

    await db.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES ('drive_refresh_token', ?, datetime('now'))`,
      args: [tokens.refresh_token],
    });

    return res.send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto">
        <h2>✅ Google Drive authorized</h2>
        <p>FlowShift can now write playbooks to your Google Drive.</p>
        <p>You can close this tab.</p>
      </body></html>
    `);
  } catch (err: unknown) {
    // Log full error server-side but never expose internal details to the browser
    console.error('OAuth callback error:', err);
    return res.status(500).json({ error: 'Authorization failed. Please try again.' });
  }
});

export default router;
