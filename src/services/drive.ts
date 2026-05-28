import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { config } from '../config';
import { getDb } from '../db';

// ── Client factory — call once per run, then pass the instance through ────────

export async function getDriveClient(): Promise<drive_v3.Drive> {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'drive_refresh_token'",
    args: [],
  });

  if (!result.rows.length) {
    throw new Error('Drive not authorized. Visit /auth/google to authorize.');
  }

  const refreshToken = result.rows[0].value as string;
  const auth = new google.auth.OAuth2(
    config.googleOauthClientId,
    config.googleOauthClientSecret,
    `${config.appUrl}/auth/google/callback`
  );
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
}

// ── Drive operations — each accepts a pre-created client ─────────────────────

export async function getOrCreateUserFolder(
  drive: drive_v3.Drive,
  userEmail: string,
  existingFolderId: string | null
): Promise<{ folderId: string; folderUrl: string }> {
  if (existingFolderId) {
    return {
      folderId: existingFolderId,
      folderUrl: `https://drive.google.com/drive/folders/${existingFolderId}`,
    };
  }

  const folder = await drive.files.create({
    requestBody: {
      name: userEmail,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [config.gdriveParentFolderId],
    },
    fields: 'id',
  });

  const folderId = folder.data.id!;

  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
  };
}

export async function createRunFolder(
  drive: drive_v3.Drive,
  userFolderId: string,
  runId: string
): Promise<{ folderId: string; folderUrl: string }> {
  const folder = await drive.files.create({
    requestBody: {
      name: `run_${runId}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [userFolderId],
    },
    fields: 'id',
  });

  const folderId = folder.data.id!;

  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return {
    folderId,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
  };
}

export async function uploadFile(
  drive: drive_v3.Drive,
  folderId: string,
  fileName: string,
  content: string,
  mimeType = 'text/plain'
): Promise<string> {
  const file = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from([content]),
    },
    fields: 'id',
  });

  return file.data.id!;
}
