import path from 'path';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  databasePath: process.env.DATABASE_PATH || path.join(process.cwd(), 'flowshift.db'),

  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-4-7',
  maxTokens: parseInt(process.env.MAX_TOKENS || '8192', 10),

  resendApiKey: process.env.RESEND_API_KEY || '',
  fromEmail: process.env.FROM_EMAIL || 'noreply@flowshift.io',

  googleOauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
  googleOauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  gdriveParentFolderId: process.env.GDRIVE_PARENT_FOLDER_ID || '11BCUCoM3a0di8tYiz-r9EOuQ7AZlt7FU',
  appUrl: process.env.APP_URL || 'https://flowshift-cdl.fly.dev',

  driveEnabled: !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
};
