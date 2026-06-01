import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getDb } from '../db';
import { getSlackClient } from './slack';

// Matches claude-opus-<major>-<minor>[...] — ignores dated snapshots with extra suffixes
const OPUS_PATTERN = /^claude-opus-(\d+)-(\d+)$/;

// ── Active model resolution ───────────────────────────────────────────────────

/**
 * Returns the model currently in use: DB override takes precedence over
 * the compiled-in config default.  DB value is written by checkAndUpdateModel()
 * when a newer Opus is found.
 */
export async function getActiveModel(): Promise<string> {
  try {
    const db = getDb();
    const r = await db.execute({
      sql: "SELECT value FROM settings WHERE key = 'claude_model'",
      args: [],
    });
    if (r.rows.length) return r.rows[0].value as string;
  } catch {
    // DB not ready yet — fall through to config default
  }
  return config.claudeModel;
}

// ── Version comparison ────────────────────────────────────────────────────────

function parseOpusVersion(modelId: string): [number, number] | null {
  const m = modelId.match(OPUS_PATTERN);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

function isNewer(candidate: string, current: string): boolean {
  const c = parseOpusVersion(candidate);
  const cur = parseOpusVersion(current);
  if (!c || !cur) return false;
  if (c[0] !== cur[0]) return c[0] > cur[0];
  return c[1] > cur[1];
}

// ── Main check ────────────────────────────────────────────────────────────────

export async function checkAndUpdateModel(): Promise<void> {
  console.log('[modelCheck] Running weekly model check…');
  try {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    // Collect all model IDs (paginate through the full list)
    const allModelIds: string[] = [];
    for await (const model of await client.models.list()) {
      allModelIds.push(model.id);
    }

    // Keep only clean opus model IDs (e.g. claude-opus-4-8, not claude-opus-4-5-20251101)
    const opusModels = allModelIds.filter(id => OPUS_PATTERN.test(id));

    if (!opusModels.length) {
      console.log('[modelCheck] No opus models found in API response — skipping.');
      return;
    }

    // Sort descending by version, pick the highest
    opusModels.sort((a, b) => {
      const [aMaj, aMin] = parseOpusVersion(a)!;
      const [bMaj, bMin] = parseOpusVersion(b)!;
      return bMaj !== aMaj ? bMaj - aMaj : bMin - aMin;
    });

    const latestModel  = opusModels[0];
    const currentModel = await getActiveModel();

    if (!isNewer(latestModel, currentModel)) {
      console.log(`[modelCheck] Model is current: ${currentModel}`);
      return;
    }

    // ── Upgrade ───────────────────────────────────────────────────────────────
    const db = getDb();
    await db.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value, updated_at)
            VALUES ('claude_model', ?, datetime('now'))`,
      args: [latestModel],
    });

    console.log(`[modelCheck] ✅ Model upgraded: ${currentModel} → ${latestModel}`);

    // ── Notify all linked Slack users ─────────────────────────────────────────
    if (config.slackEnabled) {
      await notifySlackUsers(currentModel, latestModel);
    }
  } catch (err) {
    console.error('[modelCheck] Check failed:', err);
  }
}

// ── Slack notification ────────────────────────────────────────────────────────

async function notifySlackUsers(oldModel: string, newModel: string): Promise<void> {
  try {
    const db    = getDb();
    const slack = getSlackClient();

    const result = await db.execute({
      sql: 'SELECT DISTINCT slack_user_id FROM slack_users',
      args: [],
    });

    for (const row of result.rows) {
      const slackUserId = row.slack_user_id as string;
      try {
        const dmResult  = await slack.conversations.open({ users: slackUserId });
        const channelId = (dmResult.channel as Record<string, unknown>)?.id as string | undefined;
        if (!channelId) continue;

        await slack.chat.postMessage({
          channel: channelId,
          text: `🤖 FlowShift model upgraded to ${newModel}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `🤖 *FlowShift model upgraded*\n\n` +
                  `*${oldModel}* → *${newModel}*\n\n` +
                  `All new runs will use the updated model automatically.`,
              },
            },
          ],
        });
      } catch (dmErr) {
        console.error(`[modelCheck] Could not DM ${slackUserId}:`, dmErr);
      }
    }
  } catch (err) {
    console.error('[modelCheck] Slack notification failed:', err);
  }
}
