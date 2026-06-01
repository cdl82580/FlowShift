import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Client } from '@libsql/client';
import { getDb } from '../db';
import { requireApiKey, AuthedRequest, UserRow } from '../auth';
import { generateMigrationPlaybook, VALID_PLATFORMS } from '../services/claude';
import { getDriveClient, getOrCreateUserFolder, createRunFolder, uploadFile, uploadAsGoogleDoc, exportGoogleDocAsDocx } from '../services/drive';
import { config } from '../config';

const router = Router();

// ── POST /runs ── accepts JSON: { source, destination, description?, fileContent?, fileName? }
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const { user } = req as AuthedRequest;
  const { source: rawSource, destination, description, fileContent, fileName } = req.body as Record<string, string>;
  const source = rawSource?.trim() || null;   // empty string → null

  if (!destination) {
    return res.status(400).json({ error: 'destination is required' });
  }
  if (source && !(VALID_PLATFORMS as readonly string[]).includes(source)) {
    return res.status(400).json({ error: `Invalid source. Valid platforms: ${VALID_PLATFORMS.join(', ')}` });
  }
  if (!(VALID_PLATFORMS as readonly string[]).includes(destination)) {
    return res.status(400).json({ error: `Invalid destination. Valid platforms: ${VALID_PLATFORMS.join(', ')}` });
  }
  if (source && source === destination) {
    return res.status(400).json({ error: 'source and destination cannot be the same' });
  }
  if (!fileContent?.trim() && !description?.trim()) {
    return res.status(400).json({ error: 'Provide a file or a description (or both)' });
  }

  const runId = uuidv4();
  const db = getDb();

  await db.execute({
    sql: `INSERT INTO runs (id, user_id, source, destination, description, original_filename, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    args: [runId, user.id, source, destination, description?.trim() ?? null, fileName?.trim() ?? null],
  });

  // Respond immediately — client will poll GET /runs/:id
  const pending = await db.execute({ sql: 'SELECT * FROM runs WHERE id = ?', args: [runId] });
  res.status(202).json(formatRun(pending.rows[0] as Record<string, unknown>));

  // Fire-and-forget background processing
  void processRun({
    runId,
    user,
    db,
    submission: {
      source:      source ?? undefined,
      destination,
      description: description?.trim() || undefined,
      fileContent: fileContent?.trim() || undefined,
      fileName:    fileName?.trim() || undefined,
    },
  });
});

// ── GET /runs/:id ────────────────────────────────────────────────────────────
router.get('/:id', requireApiKey, async (req: Request, res: Response) => {
  const { user } = req as AuthedRequest;
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM runs WHERE id = ? AND user_id = ?',
    args: [req.params.id, user.id],
  });
  if (!result.rows.length) {
    return res.status(404).json({ error: 'Run not found' });
  }
  return res.json(formatRun(result.rows[0] as Record<string, unknown>));
});

// ── Background processor ─────────────────────────────────────────────────────
interface ProcessRunArgs {
  runId: string;
  user: UserRow;
  db: Client;
  submission: {
    source?: string;
    destination: string;
    description?: string;
    fileContent?: string;
    fileName?: string;
  };
}

async function processRun({ runId, user, db, submission }: ProcessRunArgs): Promise<void> {
  try {
    await db.execute({
      sql: "UPDATE runs SET status = 'processing' WHERE id = ?",
      args: [runId],
    });

    const result = await generateMigrationPlaybook(submission);

    let runFolderUrl: string | null = null;
    let runFolderId: string | null  = null;

    if (config.driveEnabled) {
      try {
        // Create one Drive client for the entire upload sequence (one DB read, one OAuth2 instance)
        const drive = await getDriveClient();

        // Re-fetch only the needed column to get latest gdrive_folder_id
        // (may have been set by a concurrent run since the request started)
        const userRow = await db.execute({
          sql: 'SELECT gdrive_folder_id FROM users WHERE id = ?',
          args: [user.id],
        });
        const latestFolderId = (userRow.rows[0]?.gdrive_folder_id as string | null) ?? null;

        const { folderId: userFolderId, folderUrl: userFolderUrl } = await getOrCreateUserFolder(
          drive, user.email, latestFolderId
        );

        if (!latestFolderId) {
          await db.execute({
            sql: 'UPDATE users SET gdrive_folder_id = ?, gdrive_folder_url = ? WHERE id = ?',
            args: [userFolderId, userFolderUrl, user.id],
          });
        }

        const runFolder = await createRunFolder(drive, userFolderId, runId);
        runFolderId = runFolder.folderId;
        runFolderUrl = runFolder.folderUrl;

        // Build a human-readable document name for this run
        const safe = (s: string) => s.replace(/[^a-zA-Z0-9 &]/g, '').trim();
        const docBaseName = submission.source
          ? `FlowShift - ${safe(submission.source)} to ${safe(submission.destination)} Migration Playbook`
          : `FlowShift - ${safe(submission.destination)} Build Guide`;

        // Upload raw markdown
        await uploadFile(drive, runFolderId, `${docBaseName}.md`, result.playbookText, 'text/markdown');

        // Upload as native Google Doc (markdown → HTML → GDoc conversion)
        let googleDocId: string | null = null;
        try {
          googleDocId = await uploadAsGoogleDoc(drive, runFolderId, docBaseName, result.playbookText);
        } catch (gdocErr) {
          console.error(`Run ${runId}: Google Doc upload failed:`, gdocErr);
        }

        // Export the Google Doc as .docx and upload alongside
        if (googleDocId) {
          try {
            await exportGoogleDocAsDocx(drive, runFolderId, `${docBaseName}.docx`, googleDocId);
          } catch (docxErr) {
            console.error(`Run ${runId}: DOCX export failed:`, docxErr);
          }
        }

        if (result.importFileContent && result.importFileName) {
          const mime = result.importFileExtension === 'json' ? 'application/json' : 'text/plain';
          await uploadFile(drive, runFolderId, result.importFileName, result.importFileContent, mime);
        }
      } catch (driveErr: unknown) {
        console.error(`Run ${runId}: Drive upload failed (run still saved):`, driveErr);
      }
    }

    await db.execute({
      sql: `UPDATE runs SET
              status = 'completed',
              playbook_text = ?,
              import_file_content = ?,
              import_file_name = ?,
              import_file_extension = ?,
              gdrive_run_folder_id = ?,
              gdrive_run_folder_url = ?,
              completed_at = datetime('now')
            WHERE id = ?`,
      args: [
        result.playbookText,
        result.importFileContent,
        result.importFileName,
        result.importFileExtension,
        runFolderId,
        runFolderUrl,
        runId,
      ],
    });

    console.log(`Run ${runId} completed.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Run ${runId} failed:`, err);
    await db
      .execute({
        sql: `UPDATE runs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`,
        args: [msg, runId],
      })
      .catch(console.error);
  }
}

function formatRun(run: Record<string, unknown>) {
  return {
    id: run.id,
    user_id: run.user_id,
    source: run.source,
    destination: run.destination,
    description: run.description,
    original_filename: run.original_filename,
    status: run.status,
    playbook_text: run.playbook_text,
    import_file_name: run.import_file_name,
    import_file_extension: run.import_file_extension,
    import_file_content: run.import_file_content,
    has_import_file: !!run.import_file_content,
    gdrive_run_folder_url: run.gdrive_run_folder_url,
    error_message: run.error_message,
    created_at: run.created_at,
    completed_at: run.completed_at,
  };
}

export default router;
