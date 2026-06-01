import path from 'path';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  databasePath: process.env.DATABASE_PATH || path.join(process.cwd(), 'flowshift.db'),

  // ── Required ───────────────────────────────────────────────────────────────
  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  // ── Optional — Claude model tuning (sensible defaults) ────────────────────
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
  maxTokens: parseInt(process.env.MAX_TOKENS || '8192', 10),

  // ── Optional — Email recovery via Resend (recovery flow disabled if unset) ─
  resendApiKey: process.env.RESEND_API_KEY || '',
  fromEmail:    process.env.FROM_EMAIL    || 'noreply@flowshift.io',

  // ── Optional — Slack bot (Slack commands disabled if unset) ──────────────────
  slackBotToken:     process.env.SLACK_BOT_TOKEN      || '',
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || '',
  slackEnabled: !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET),

  // ── Optional — Google Drive output (Drive uploads disabled if unset) ───────
  googleOauthClientId:     process.env.GOOGLE_OAUTH_CLIENT_ID     || '',
  googleOauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  gdriveParentFolderId:    process.env.GDRIVE_PARENT_FOLDER_ID    || '11BCUCoM3a0di8tYiz-r9EOuQ7AZlt7FU',
  appUrl: process.env.APP_URL || 'https://flowshift-cdl.fly.dev',

  driveEnabled: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
};
