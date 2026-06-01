import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { marked } from 'marked';
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

/**
 * Convert markdown to HTML and upload as a native Google Doc.
 * Returns the new Google Doc file ID.
 */
export async function uploadAsGoogleDoc(
  drive: drive_v3.Drive,
  folderId: string,
  docName: string,
  markdownContent: string
): Promise<string> {
  const html = await marked(markdownContent);
  const file = await drive.files.create({
    requestBody: {
      name: docName,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from([html]),
    },
    fields: 'id',
  });

  return file.data.id!;
}

/**
 * Export an existing Google Doc as a .docx file and upload it to the same folder.
 * Returns the new .docx file ID.
 */
export async function exportGoogleDocAsDocx(
  drive: drive_v3.Drive,
  folderId: string,
  docxName: string,
  googleDocId: string
): Promise<string> {
  const exportRes = await drive.files.export(
    { fileId: googleDocId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { responseType: 'arraybuffer' }
  );

  const buffer = Buffer.from(exportRes.data as ArrayBuffer);

  const file = await drive.files.create({
    requestBody: {
      name: docxName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: Readable.from(buffer),
    },
    fields: 'id',
  });

  return file.data.id!;
}
