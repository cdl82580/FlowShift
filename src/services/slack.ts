import { WebClient } from '@slack/web-api';
import { createHmac, timingSafeEqual } from 'crypto';
import { Client } from '@libsql/client';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { VALID_PLATFORMS } from './claude';

// ── Client singleton ──────────────────────────────────────────────────────────

let _slack: WebClient | null = null;
export function getSlackClient(): WebClient {
  if (!_slack) _slack = new WebClient(config.slackBotToken);
  return _slack;
}

/**
 * Fetch the verified email address from the user's Slack profile.
 * Requires the `users:read.email` OAuth scope.
 * Returns null if the scope is missing or the profile has no email.
 */
export async function getSlackUserEmail(slackUserId: string): Promise<string | null> {
  try {
    const info = await getSlackClient().users.info({ user: slackUserId });
    const email = (info.user as any)?.profile?.email as string | undefined;
    return email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

// ── Signature verification ────────────────────────────────────────────────────

export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes (replay-attack prevention)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false;

  const expected = 'v0=' + createHmac('sha256', config.slackSigningSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

// ── User linking ──────────────────────────────────────────────────────────────

export async function getLinkedFlowShiftUserId(
  db: Client,
  slackUserId: string,
  workspaceId: string,
): Promise<string | null> {
  const r = await db.execute({
    sql: 'SELECT flowshift_user_id FROM slack_users WHERE slack_user_id = ? AND slack_workspace_id = ?',
    args: [slackUserId, workspaceId],
  });
  return r.rows.length ? (r.rows[0].flowshift_user_id as string) : null;
}

export async function linkSlackUser(
  db: Client,
  slackUserId: string,
  workspaceId: string,
  flowshiftUserId: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO slack_users (slack_user_id, slack_workspace_id, flowshift_user_id)
          VALUES (?, ?, ?)`,
    args: [slackUserId, workspaceId, flowshiftUserId],
  });
}

export async function getUserByApiKey(db: Client, apiKey: string) {
  const r = await db.execute({
    sql: 'SELECT * FROM users WHERE api_key = ?',
    args: [apiKey],
  });
  return r.rows.length ? r.rows[0] : null;
}

// ── Block Kit helpers ─────────────────────────────────────────────────────────

const PLATFORM_OPTIONS = VALID_PLATFORMS.map(p => ({
  text: { type: 'plain_text' as const, text: p, emoji: true },
  value: p,
}));

export function buildRegisterModal() {
  return {
    type: 'modal' as const,
    callback_id: 'flowshift_register',
    title: { type: 'plain_text' as const, text: 'Create Account', emoji: true },
    submit: { type: 'plain_text' as const, text: 'Create Account →', emoji: true },
    close:  { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          // No email field — we use the verified Slack account email automatically.
          // This prevents registering on behalf of someone else's email address.
          text: 'Create a FlowShift account using your *Slack account email*. Your API key will be sent to you as a DM — save it somewhere safe.',
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'name_block',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Name' },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'name',
          placeholder: { type: 'plain_text' as const, text: 'Your name (optional)' },
        },
      },
    ],
  };
}

export function buildNewRunModal() {
  return {
    type: 'modal' as const,
    callback_id: 'flowshift_new_run',
    title: { type: 'plain_text' as const, text: 'FlowShift', emoji: true },
    submit: { type: 'plain_text' as const, text: '⚡ Generate Playbook', emoji: true },
    close: { type: 'plain_text' as const, text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Source is optional.* Leave it blank to generate a *Build Guide* for the destination platform instead of a migration.',
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'source_block',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Source Platform', emoji: true },
        element: {
          type: 'static_select' as const,
          action_id: 'source',
          placeholder: { type: 'plain_text' as const, text: 'Leave blank for Build Guide mode' },
          options: PLATFORM_OPTIONS,
        },
      },
      {
        type: 'input',
        block_id: 'destination_block',
        label: { type: 'plain_text' as const, text: 'Destination Platform', emoji: true },
        element: {
          type: 'static_select' as const,
          action_id: 'destination',
          placeholder: { type: 'plain_text' as const, text: 'Choose destination' },
          options: PLATFORM_OPTIONS,
        },
      },
      {
        type: 'input',
        block_id: 'description_block',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Workflow Description', emoji: true },
        hint: {
          type: 'plain_text' as const,
          text: 'Describe triggers, actions, conditions, and connected apps. Markdown supported.',
        },
        element: {
          type: 'plain_text_input' as const,
          action_id: 'description',
          multiline: true,
          max_length: 3000,
          placeholder: {
            type: 'plain_text' as const,
            text: 'e.g. When a new Stripe charge over $5k occurs, create a HubSpot contact and alert #sales in Slack.',
          },
        },
      },
      {
        type: 'input',
        block_id: 'file_block',
        optional: true,
        label: { type: 'plain_text' as const, text: 'Workflow File', emoji: true },
        hint: {
          type: 'plain_text' as const,
          text: 'JSON, YAML, XML, or TXT. Very large files work better via the web app.',
        },
        element: {
          type: 'file_input' as const,
          action_id: 'workflow_file',
          filetypes: ['json', 'yaml', 'yml', 'txt', 'xml'],
          max_files: 1,
        },
      },
    ],
  };
}

// ── Messaging ─────────────────────────────────────────────────────────────────

export async function sendProcessingMessage(channelId: string, runId: string): Promise<void> {
  await getSlackClient().chat.postMessage({
    channel: channelId,
    text: '⏳ FlowShift is generating your playbook...',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⏳ *Generating your playbook…*\nThis usually takes 30–60 seconds. I'll post the results here when it's ready.\n\n_Run ID: \`${runId}\`_`,
        },
      },
    ],
  });
}

export async function notifyRunComplete(
  channelId: string,
  runId: string,
  db: Client,
): Promise<void> {
  const slack = getSlackClient();

  const result = await db.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [runId] });
  if (!result.rows.length) return;
  const run = result.rows[0] as Record<string, unknown>;

  const status = run.status as string;
  const source = run.source as string | null;
  const destination = run.destination as string;
  const playbookText = run.playbook_text as string | null;
  const importFileName = run.import_file_name as string | null;
  const importFileContent = run.import_file_content as string | null;
  const driveUrl = run.gdrive_run_folder_url as string | null;
  const webUrl = `${config.appUrl}/runs/${runId}`;

  if (status === 'failed') {
    await slack.chat.postMessage({
      channel: channelId,
      text: '❌ FlowShift run failed',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ *Run failed*\n${run.error_message || 'Unknown error'}\n\n<${webUrl}|View details →>`,
          },
        },
      ],
    });
    return;
  }

  if (status !== 'completed' || !playbookText) return;

  const header = source
    ? `✅ *${source} → ${destination} Migration Playbook Ready*`
    : `✅ *${destination} Build Guide Ready*`;

  // Truncate playbook to first ~600 chars for the Slack preview
  const preview = playbookText.length > 600
    ? playbookText.substring(0, 600).replace(/\n+$/, '') + '…'
    : playbookText;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actionButtons: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '📖 View Full Playbook', emoji: true },
      url: webUrl,
      action_id: 'view_results',
    },
  ];

  if (driveUrl) {
    actionButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: '📂 Open in Drive', emoji: true },
      url: driveUrl,
      action_id: 'open_drive',
    });
  }

  await slack.chat.postMessage({
    channel: channelId,
    text: header.replace(/\*/g, ''),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: header } },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Playbook preview:*\n\`\`\`${preview}\`\`\`\n<${webUrl}|Read the full playbook →>`,
        },
      },
      { type: 'actions', elements: actionButtons },
    ],
  });

  // Upload the import file as a Slack file attachment
  if (importFileContent && importFileName) {
    await uploadFileToSlack(slack, channelId, importFileName, importFileContent);
  }
}

async function uploadFileToSlack(
  slack: WebClient,
  channelId: string,
  fileName: string,
  content: string,
): Promise<void> {
  const buf = Buffer.from(content, 'utf-8');

  // Step 1: Get an external upload URL
  const { upload_url, file_id } = await slack.files.getUploadURLExternal({
    filename: fileName,
    length: buf.length,
  }) as { upload_url: string; file_id: string };

  // Step 2: PUT the content directly to Slack's storage
  await fetch(upload_url, {
    method: 'POST',
    body: buf,
    headers: { 'Content-Type': 'application/octet-stream' },
  });

  // Step 3: Complete the upload and share into the channel
  await slack.files.completeUploadExternal({
    files: [{ id: file_id, title: fileName }],
    channel_id: channelId,
    initial_comment: `📎 *Import file:* \`${fileName}\` — download and import into your destination platform.`,
  });
}

// ── Run list / status formatting ──────────────────────────────────────────────

export function formatRunSummary(run: Record<string, unknown>): string {
  const source   = run.source as string | null;
  const dest     = run.destination as string;
  const status   = run.status as string;
  const id       = run.id as string;
  const driveUrl = run.gdrive_run_folder_url as string | null;
  const created  = new Date(run.created_at as string).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const statusEmoji = { completed: '✅', processing: '⏳', pending: '🕐', failed: '❌' }[status] ?? '❓';
  const route     = source ? `${source} → ${dest}` : `Build Guide → ${dest}`;
  const driveLink = driveUrl ? ` · <${driveUrl}|📂 Drive>` : '';
  return `${statusEmoji} *${route}* — ID: ${id} — ${created}${driveLink}`;
}
