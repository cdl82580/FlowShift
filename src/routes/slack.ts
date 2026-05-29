/**
 * Slack slash commands + interactive components for FlowShift.
 *
 * IMPORTANT: This router uses express.raw() to capture the raw body for
 * Slack signature verification. It must be mounted in index.ts BEFORE the
 * global express.json() / express.urlencoded() parsers.
 *
 * Endpoints:
 *   POST /slack/commands       — /flowshift slash command
 *   POST /slack/interactions   — modal submissions + button clicks
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import { getDb } from '../db';
import { config } from '../config';
import { VALID_PLATFORMS } from '../services/claude';
import {
  verifySlackSignature,
  getSlackClient,
  getLinkedFlowShiftUserId,
  linkSlackUser,
  getUserByApiKey,
  buildNewRunModal,
  buildRegisterModal,
  sendProcessingMessage,
  formatRunSummary,
} from '../services/slack';

const router = Router();

// ── Raw body middleware ── must run before any other parsing ───────────────────
router.use(express.raw({ type: '*/*', limit: '2mb' }));
router.use((req: Request, _res: Response, next) => {
  const raw = (req.body instanceof Buffer) ? req.body.toString('utf-8') : '';
  (req as any).rawBody = raw;

  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    try { req.body = JSON.parse(raw); } catch { req.body = {}; }
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    const params = Object.fromEntries(new URLSearchParams(raw));
    if (params.payload) {
      // Interactions arrive as URL-encoded with a JSON `payload` field
      try { req.body = JSON.parse(params.payload); } catch { req.body = {}; }
    } else {
      req.body = params;
    }
  }
  next();
});

// ── Signature guard ────────────────────────────────────────────────────────────
function requireSlackSignature(req: Request, res: Response, next: () => void): void {
  if (!config.slackEnabled) {
    res.status(503).json({ error: 'Slack integration not configured' });
    return;
  }
  const ts  = req.headers['x-slack-request-timestamp'] as string || '';
  const sig = req.headers['x-slack-signature'] as string || '';
  if (!verifySlackSignature((req as any).rawBody || '', ts, sig)) {
    res.status(401).json({ error: 'Invalid Slack signature' });
    return;
  }
  next();
}

// ── response_url helper ───────────────────────────────────────────────────────
// Use response_url instead of chat.postEphemeral for all slash command replies.
// Benefits: no channel membership required, works in any channel/DM, valid for
// 5 minutes after the command.
async function reply(
  responseUrl: string,
  payload: { text: string; blocks?: unknown[] },
): Promise<void> {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', ...payload }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /slack/commands   — /flowshift <text>
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/commands', requireSlackSignature, async (req: Request, res: Response) => {
  const body        = req.body as Record<string, string>;
  const slackUserId = body.user_id;
  const workspaceId = body.team_id;
  const triggerId   = body.trigger_id;
  const responseUrl = body.response_url;   // ← use this instead of postEphemeral
  const text        = (body.text || '').trim().toLowerCase();

  // Acknowledge immediately — Slack requires a response within 3 seconds.
  // Everything else happens asynchronously after this point.
  res.status(200).send();

  const db = getDb();
  const slack = getSlackClient();

  try {
    // ── /flowshift help ──────────────────────────────────────────────────────
    if (text === 'help') {
      await reply(responseUrl, {
        text: 'FlowShift help',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*FlowShift — iPaaS Migration Playbook Generator* ⚡\n\n' +
              '*Getting started:*\n' +
              '• `/flowshift register` — create a new FlowShift account from Slack\n' +
              '• `/flowshift link <api-key>` — link an existing FlowShift account\n' +
              '• `/flowshift forgot <email>` — email yourself a new API key\n\n' +
              '*Migrations:*\n' +
              '• `/flowshift` or `/flowshift new` — open the migration form\n' +
              '• `/flowshift list` — show your last 5 runs\n' +
              '• `/flowshift status <run-id>` — check status of a specific run\n\n' +
              '*Account:*\n' +
              '• `/flowshift unlink` — unlink your account from Slack\n' +
              '• `/flowshift help` — show this message\n\n' +
              `*Web app:* <${config.appUrl}|${config.appUrl}>`,
          },
        }],
      });
      return;
    }

    // ── /flowshift register — open registration modal ────────────────────────
    if (text === 'register') {
      await slack.views.open({ trigger_id: triggerId, view: buildRegisterModal() });
      return;
    }

    // ── /flowshift forgot <email> — trigger recovery email ────────────────────
    if (text.startsWith('forgot')) {
      const parts = text.split(/\s+/);
      const email  = parts[1]?.trim().toLowerCase();
      if (!email || !email.includes('@')) {
        await reply(responseUrl, {
          text: 'Usage: `/flowshift forgot your@email.com`\n\nWe\'ll send a link to reset your API key.',
        });
        return;
      }

      // Reuse the same recovery logic as the REST API (neutral response either way)
      const db2 = getDb();
      const userRow = await db2.execute({
        sql: 'SELECT id FROM users WHERE email = ?',
        args: [email],
      });

      if (userRow.rows.length) {
        const userId  = userRow.rows[0].id as string;
        const token   = (await import('uuid')).v4();
        const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await db2.execute({
          sql: 'INSERT INTO recovery_tokens (token, user_id, expires_at) VALUES (?, ?, ?)',
          args: [token, userId, expires],
        });
        const recoveryUrl = `${config.appUrl}/recover?token=${token}`;
        // sendRecoveryEmail is not exported — inline a minimal version
        if (config.resendApiKey) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: `FlowShift <${config.fromEmail}>`,
              to:   [email],
              subject: 'Your FlowShift API key recovery link',
              html: `<p>Click the link below to get a new API key (valid 15 minutes, one-time use):</p>
                     <p><a href="${recoveryUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Reset my API key</a></p>
                     <p>If you didn't request this, ignore this email.</p>`,
            }),
          }).catch(e => console.error('[slack/forgot] email send failed:', e));
        } else {
          console.log(`[slack/forgot] recovery URL for ${email}: ${recoveryUrl}`);
        }
      }

      // Always neutral — don't reveal whether email is registered
      await reply(responseUrl, {
        text: `📧 If *${email}* is registered, a recovery link is on its way.\nClick it to get a new API key, then \`/flowshift link <key>\` to reconnect.`,
      });
      return;
    }

    // ── /flowshift link <api-key> ─────────────────────────────────────────────
    if (text.startsWith('link ')) {
      const apiKey = text.split(' ').slice(1).join(' ').trim();
      if (!apiKey) {
        await reply(responseUrl, { text: 'Usage: `/flowshift link <your-api-key>`' });
        return;
      }
      const user = await getUserByApiKey(db, apiKey);
      if (!user) {
        await reply(responseUrl, {
          text: `❌ API key not recognised. Check your key at <${config.appUrl}/auth|${config.appUrl}/auth>.`,
        });
        return;
      }
      await linkSlackUser(db, slackUserId, workspaceId, user.id as string);
      await reply(responseUrl, {
        text: `✅ Linked to FlowShift account *${user.email}*. Type \`/flowshift\` to start a migration.`,
      });
      return;
    }

    // ── /flowshift unlink ────────────────────────────────────────────────────
    if (text === 'unlink') {
      await db.execute({
        sql: 'DELETE FROM slack_users WHERE slack_user_id = ? AND slack_workspace_id = ?',
        args: [slackUserId, workspaceId],
      });
      await reply(responseUrl, { text: '✅ Your Slack account has been unlinked from FlowShift.' });
      return;
    }

    // All remaining commands require a linked account
    const flowshiftUserId = await getLinkedFlowShiftUserId(db, slackUserId, workspaceId);
    if (!flowshiftUserId) {
      await reply(responseUrl, {
        text: '🔗 Link your FlowShift account first',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔗 *Link your FlowShift account to get started.*\n\n` +
              `1. Sign in or register at <${config.appUrl}/auth|${config.appUrl}/auth>\n` +
              `2. Copy your API key from the dashboard\n` +
              `3. Run \`/flowshift link <api-key>\``,
          },
        }],
      });
      return;
    }

    // ── /flowshift list ───────────────────────────────────────────────────────
    if (text === 'list') {
      const runs = await db.execute({
        sql: `SELECT id, source, destination, status, created_at
              FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
        args: [flowshiftUserId],
      });

      if (!runs.rows.length) {
        await reply(responseUrl, {
          text: `No runs yet. Type \`/flowshift\` to start your first migration!`,
        });
        return;
      }

      const lines = runs.rows.map(r => formatRunSummary(r as Record<string, unknown>)).join('\n');
      await reply(responseUrl, {
        text: 'Your recent FlowShift runs',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Your recent runs:*\n\n${lines}\n\n<${config.appUrl}|View all runs →>`,
          },
        }],
      });
      return;
    }

    // ── /flowshift status <run-id> ────────────────────────────────────────────
    if (text.startsWith('status')) {
      const parts = text.split(/\s+/);
      // Strip any surrounding punctuation Slack may inject when copying from
      // a rendered message (backticks, underscores, quotes, angle brackets, etc.)
      const rawFragment = parts.slice(1).join('').trim();
      const runIdFragment = rawFragment.replace(/^[^a-f0-9]+/i, '').replace(/[^a-f0-9-]+$/i, '');
      if (!runIdFragment) {
        await reply(responseUrl, {
          text: 'Usage: `/flowshift status <run-id>` (first 8 chars of the ID work too)',
        });
        return;
      }

      const run = await db.execute({
        sql: `SELECT * FROM runs
              WHERE user_id = ? AND (id = ? OR id LIKE ?)
              ORDER BY created_at DESC LIMIT 1`,
        args: [flowshiftUserId, runIdFragment, `${runIdFragment}%`],
      });

      if (!run.rows.length) {
        await reply(responseUrl, { text: `❌ Run \`${runIdFragment}\` not found.` });
        return;
      }

      const r = run.rows[0] as Record<string, unknown>;
      const webUrl = `${config.appUrl}/runs/${r.id}`;
      await reply(responseUrl, {
        text: `Run status: ${r.status as string}`,
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: formatRunSummary(r) + `\n\n<${webUrl}|View full results →>`,
          },
        }],
      });
      return;
    }

    // ── /flowshift  or  /flowshift new ── open the modal ─────────────────────
    await slack.views.open({ trigger_id: triggerId, view: buildNewRunModal() });

  } catch (err) {
    console.error('[slack/commands] error:', err);
    // Best-effort error reply so the user isn't left with silence
    await reply(responseUrl, { text: '❌ Something went wrong. Please try again.' }).catch(() => {});
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /slack/interactions   — modal submissions + button clicks
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/interactions', requireSlackSignature, async (req: Request, res: Response) => {
  const payload = req.body as Record<string, any>;

  // Acknowledge immediately
  res.status(200).send();

  if (payload.type !== 'view_submission') return;

  const slack = getSlackClient();

  // ── Registration modal ────────────────────────────────────────────────────
  if (payload.view?.callback_id === 'flowshift_register') {
    const slackUserId = payload.user?.id as string;
    const workspaceId = (payload.team?.id ?? payload.user?.team_id) as string;
    const values  = payload.view?.state?.values as Record<string, any>;
    const email   = (values?.email_block?.email?.value as string || '').trim().toLowerCase();
    const name    = (values?.name_block?.name?.value  as string || '').trim() || null;

    const dmResult  = await slack.conversations.open({ users: slackUserId });
    const channelId = (dmResult.channel as any)?.id as string;
    if (!channelId) return;

    if (!email || !email.includes('@')) {
      await slack.chat.postMessage({ channel: channelId,
        text: '❌ Please provide a valid email address.' });
      return;
    }

    const db    = getDb();
    const { v4: uuid } = await import('uuid');

    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ?',
      args: [email],
    });
    if (existing.rows.length) {
      await slack.chat.postMessage({ channel: channelId,
        text: `❌ *${email}* is already registered.\n\n` +
          `Use \`/flowshift forgot ${email}\` to recover your API key, ` +
          `then \`/flowshift link <key>\` to connect your Slack account.` });
      return;
    }

    const userId = uuid();
    const apiKey = uuid();
    await db.execute({
      sql: 'INSERT INTO users (id, email, name, api_key) VALUES (?, ?, ?, ?)',
      args: [userId, email, name, apiKey],
    });

    await linkSlackUser(db, slackUserId, workspaceId, userId);

    await slack.chat.postMessage({
      channel: channelId,
      text: '✅ FlowShift account created',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *FlowShift account created!*\n\n*Email:* ${email}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Your API key — save this somewhere safe, it won't be shown again:*\n\`${apiKey}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Your Slack account has been automatically linked. Type \`/flowshift\` to start your first migration! 🚀`,
          },
        },
      ],
    });
    return;
  }

  if (payload.view?.callback_id !== 'flowshift_new_run') return;

  const slackUserId = payload.user?.id as string;
  const workspaceId = payload.team?.id as string | undefined
    ?? payload.user?.team_id as string;

  const values = payload.view?.state?.values as Record<string, any>;
  const source      = values?.source_block?.source?.selected_option?.value as string | undefined;
  const destination = values?.destination_block?.destination?.selected_option?.value as string | undefined;
  const description = values?.description_block?.description?.value as string | undefined;
  const uploadedFiles: Array<{ id: string; name: string }> =
    values?.file_block?.workflow_file?.files ?? [];

  const db = getDb();

  // Open a DM channel with the user for result delivery
  const dmResult = await slack.conversations.open({ users: slackUserId });
  const channelId = (dmResult.channel as any)?.id as string;

  if (!channelId) {
    console.error('[slack/interactions] could not open DM with', slackUserId);
    return;
  }

  // Verify the user is linked
  const flowshiftUserId = await getLinkedFlowShiftUserId(db, slackUserId, workspaceId);
  if (!flowshiftUserId) {
    await slack.chat.postMessage({ channel: channelId,
      text: `🔗 Link your FlowShift account first: \`/flowshift link <api-key>\`` });
    return;
  }

  // Validate platform inputs
  if (!destination || !(VALID_PLATFORMS as readonly string[]).includes(destination)) {
    await slack.chat.postMessage({ channel: channelId,
      text: '❌ Please select a valid destination platform.' });
    return;
  }
  if (source && !(VALID_PLATFORMS as readonly string[]).includes(source)) {
    await slack.chat.postMessage({ channel: channelId,
      text: '❌ Invalid source platform.' });
    return;
  }
  if (source && source === destination) {
    await slack.chat.postMessage({ channel: channelId,
      text: '❌ Source and destination cannot be the same platform.' });
    return;
  }

  // Download file content from Slack if a file was attached
  let fileContent: string | undefined;
  let fileName: string | undefined;
  if (uploadedFiles.length) {
    try {
      const fileInfo = await slack.files.info({ file: uploadedFiles[0].id });
      const file = fileInfo.file as any;
      const dlRes = await fetch(file.url_private, {
        headers: { Authorization: `Bearer ${config.slackBotToken}` },
      });
      fileContent = await dlRes.text();
      fileName    = file.name as string;
    } catch (err) {
      console.error('[slack/interactions] file download failed:', err);
      await slack.chat.postMessage({ channel: channelId,
        text: '⚠️ Could not read the uploaded file. The run will proceed without it — add a description for best results.' });
    }
  }

  if (!fileContent?.trim() && !description?.trim()) {
    await slack.chat.postMessage({ channel: channelId,
      text: '❌ Please provide a description or attach a workflow file.' });
    return;
  }

  // Fetch the FlowShift user row for the run
  const userRow = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [flowshiftUserId] });
  if (!userRow.rows.length) {
    await slack.chat.postMessage({ channel: channelId,
      text: '❌ FlowShift user not found. Try `/flowshift link <api-key>` again.' });
    return;
  }

  // Create the run
  const runId = uuidv4();
  await db.execute({
    sql: `INSERT INTO runs (id, user_id, source, destination, description, original_filename, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    args: [runId, flowshiftUserId, source ?? null, destination, description?.trim() ?? null, fileName ?? null],
  });

  // Record Slack context so processRun can notify this channel when done
  await db.execute({
    sql: 'INSERT INTO slack_runs (run_id, slack_user_id, slack_channel_id) VALUES (?, ?, ?)',
    args: [runId, slackUserId, channelId],
  });

  // Tell the user it's processing
  await sendProcessingMessage(channelId, runId);

  // Kick off background processing (reuse the same processRun logic via dynamic import)
  const { generateMigrationPlaybook } = await import('../services/claude');
  const { getDriveClient, getOrCreateUserFolder, createRunFolder, uploadFile } = await import('../services/drive');
  const { notifyRunComplete } = await import('../services/slack');

  void (async () => {
    try {
      await db.execute({ sql: "UPDATE runs SET status = 'processing' WHERE id = ?", args: [runId] });

      const result = await generateMigrationPlaybook({
        source:      source,
        destination,
        description: description?.trim(),
        fileContent: fileContent?.trim(),
        fileName,
      });

      let runFolderUrl: string | null = null;
      let runFolderId: string | null  = null;
      const user = userRow.rows[0] as Record<string, unknown>;

      if (config.driveEnabled) {
        try {
          const drive = await getDriveClient();
          const latestUser = await db.execute({ sql: 'SELECT gdrive_folder_id FROM users WHERE id = ?', args: [flowshiftUserId] });
          const latestFolderId = (latestUser.rows[0]?.gdrive_folder_id as string | null) ?? null;
          const { folderId: uFolderId, folderUrl: uFolderUrl } = await getOrCreateUserFolder(drive, user.email as string, latestFolderId);
          if (!latestFolderId) {
            await db.execute({ sql: 'UPDATE users SET gdrive_folder_id = ?, gdrive_folder_url = ? WHERE id = ?', args: [uFolderId, uFolderUrl, flowshiftUserId] });
          }
          const runFolder = await createRunFolder(drive, uFolderId, runId);
          runFolderId = runFolder.folderId;
          runFolderUrl = runFolder.folderUrl;
          await uploadFile(drive, runFolderId, 'playbook.md', result.playbookText, 'text/markdown');
          if (result.importFileContent && result.importFileName) {
            const mime = result.importFileExtension === 'json' ? 'application/json' : 'text/plain';
            await uploadFile(drive, runFolderId, result.importFileName, result.importFileContent, mime);
          }
        } catch (e) { console.error(`[slack] Drive upload failed for run ${runId}:`, e); }
      }

      await db.execute({
        sql: `UPDATE runs SET status = 'completed', playbook_text = ?, import_file_content = ?,
              import_file_name = ?, import_file_extension = ?, gdrive_run_folder_id = ?,
              gdrive_run_folder_url = ?, completed_at = datetime('now') WHERE id = ?`,
        args: [result.playbookText, result.importFileContent, result.importFileName,
               result.importFileExtension, runFolderId, runFolderUrl, runId],
      });

      await notifyRunComplete(channelId, runId, db);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[slack] Run ${runId} failed:`, err);
      await db.execute({
        sql: `UPDATE runs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`,
        args: [msg, runId],
      }).catch(console.error);
      await notifyRunComplete(channelId, runId, db).catch(console.error);
    }
  })();
});

export default router;
