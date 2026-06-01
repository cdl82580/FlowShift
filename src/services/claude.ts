import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';

export const VALID_PLATFORMS = ['n8n', 'Make', 'Zapier', 'Tray', 'Boomi', 'Workato', 'Celigo', 'Power Automate'] as const;
export type Platform = typeof VALID_PLATFORMS[number];

export interface Submission {
  source?: string;      // optional — omit for "build guide" mode
  destination: string;
  description?: string;
  fileContent?: string;
  fileName?: string;
}

export interface PlaybookResult {
  playbookText: string;
  importFileContent: string | null;
  importFileName: string | null;
  importFileExtension: string | null;
  securityReview: string | null;
  errorHandlingReview: string | null;
  suggestions: string | null;
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: config.anthropicApiKey });
  return _client;
}

export async function generateMigrationPlaybook(submission: Submission): Promise<PlaybookResult> {
  const isMigration = !!submission.source;
  const systemPrompt = isMigration
    ? `You are Flowshift, an expert iPaaS migration consultant. You specialize in translating workflow logic between platforms. Your primary goal is to provide functional, valid import files (JSON) for the destination platform whenever technically possible.`
    : `You are Flowshift, an expert iPaaS workflow consultant. You specialize in building workflows from scratch on any iPaaS platform. Your primary goal is to provide functional, valid import files (JSON) for the target platform whenever technically possible.`;

  const response = await getClient().messages.create({
    model: config.claudeModel,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: buildPrompt(submission) }],
  });

  const rawOutput = response.content[0].type === 'text' ? response.content[0].text : '';
  return parseOutput(rawOutput, submission);
}

/**
 * Strip the output-parser format markers from user-supplied content to prevent
 * prompt injection attacks that could manipulate the parsed playbook/import file.
 */
function sanitizeInput(text: string): string {
  return text.replace(/---(?:BEGIN|END)\s+[A-Z\s]+---/gi, '[REMOVED]');
}

function buildPrompt({ source, destination, fileContent, fileName, description }: Submission): string {
  const isMigration = !!source;

  let context = '';
  if (fileContent) {
    const label = isMigration ? 'Source Workflow File' : 'Reference Workflow / Requirements';
    context += `## ${label} (${fileName})\n\`\`\`\n${sanitizeInput(fileContent).substring(0, 15000)}\n\`\`\`\n\n`;
  }
  if (description) {
    const label = isMigration ? 'Source Workflow Description' : 'Workflow Requirements';
    context += `## ${label}\n${sanitizeInput(description)}\n\n`;
  }

  const intro = isMigration
    ? `I need to migrate a workflow from **${source}** to **${destination}**.`
    : `I need a step-by-step guide for building the following workflow in **${destination}** from scratch.`;

  const docTitle  = isMigration ? 'FlowShift Migration Playbook' : 'FlowShift Build Guide';
  const bodyHint  = isMigration
    ? 'Detailed breakdown of each step, node mapping from source to destination, credential setup, and gotchas'
    : `Detailed step-by-step guide for building this workflow in ${destination}, including node setup, credential configuration, and testing tips`;

  return `${intro}

${context}
Produce a complete ${docTitle} using EXACTLY this format:

---BEGIN PLAYBOOK---
# ${docTitle}
[${bodyHint}]
---END PLAYBOOK---

---BEGIN IMPORT FILE---
[IMPORTANT: You MUST generate a valid, functional ${destination} import file based on the workflow logic.
- If destination is n8n: Provide a valid JSON array of nodes and connections.
- If destination is Make: Provide a valid Blueprint JSON.
- If destination is Zapier: Write "NOT AVAILABLE".
- If destination is Tray: Provide a best-effort Tray workflow JSON with steps and connectors. Use {{PLACEHOLDER}} for connector IDs and credentials.
- If destination is Boomi: Provide a best-effort Boomi process definition JSON with shapes (Start, Map, Route, etc.) and connector operations. Use {{PLACEHOLDER}} for Atom IDs, connector settings, and process properties.
- If destination is Workato: Provide a best-effort Workato recipe JSON with trigger, steps, and actions. Use {{PLACEHOLDER}} for connection IDs and account-specific values.
- If destination is Celigo: Provide a best-effort Celigo flow definition JSON with exports, imports, and flow steps. Use {{PLACEHOLDER}} for connection IDs, resource IDs, and field mappings.
- If destination is Power Automate: Provide a best-effort Power Automate flow definition JSON using the standard export schema (with $schema, contentVersion, parameters, triggers, and actions). Use {{PLACEHOLDER}} for connection references and credentials.
Provide actual functional logic, not a blank template. Use {{PLACEHOLDER}} for API keys and platform-specific IDs.]
---END IMPORT FILE---

---BEGIN IMPORT FILE FORMAT---
[e.g. "json"]
---END IMPORT FILE FORMAT---

---BEGIN SECURITY REVIEW---
[Audit the workflow for security risks: credential and secret handling, auth patterns, data exposure (PII/sensitive fields in logs or payloads), hardcoded values that should be env vars, platform-specific risks (e.g. tokens stored in plain JSON), and any permissions that are broader than necessary. Be specific and actionable.]
---END SECURITY REVIEW---

---BEGIN ERROR HANDLING REVIEW---
[Audit the workflow's error and failure handling: missing retry logic, unhandled error branches, silent failures, lack of alerting or notifications on failure, non-idempotent steps that could cause duplicates on retry, missing timeouts, and any steps where a failure would leave data in a bad state. Be specific about which steps are affected and what should be added.]
---END ERROR HANDLING REVIEW---

---BEGIN SUGGESTIONS---
[Improvements beyond security and error handling: rate limiting considerations, idempotency gaps, performance or cost optimizations, platform-specific features that could simplify the workflow, missing logging or observability, and anything else worth noting that isn't covered by the source workflow or description. Be specific and actionable.]
---END SUGGESTIONS---`;
}

function parseOutput(rawOutput: string, submission: Submission): PlaybookResult {
  const playbookMatch = rawOutput.match(/---BEGIN PLAYBOOK---([\s\S]*?)---END PLAYBOOK---/);
  const playbookText  = playbookMatch ? playbookMatch[1].trim() : rawOutput;

  let importFileContent: string | null   = null;
  let importFileExtension: string | null = null;

  const importMatch = rawOutput.match(/---BEGIN IMPORT FILE---([\s\S]*?)---END IMPORT FILE---/);
  if (importMatch) {
    const content = importMatch[1].trim();
    if (content && content !== 'NOT AVAILABLE') {
      importFileContent = content.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    }
  }

  const formatMatch = rawOutput.match(/---BEGIN IMPORT FILE FORMAT---([\s\S]*?)---END IMPORT FILE FORMAT---/);
  if (formatMatch) {
    const fmt = formatMatch[1].trim().replace(/\./g, '').toLowerCase();
    if (fmt !== 'n/a' && fmt !== 'not available') importFileExtension = fmt;
  }

  let importFileName: string | null = null;
  if (importFileContent && importFileExtension) {
    const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '_');
    importFileName = submission.source
      ? `flowshift_${safe(submission.source)}_to_${safe(submission.destination)}.${importFileExtension}`
      : `flowshift_${safe(submission.destination)}_build.${importFileExtension}`;
  }

  const securityMatch = rawOutput.match(/---BEGIN SECURITY REVIEW---([\s\S]*?)---END SECURITY REVIEW---/);
  const securityReview = securityMatch ? securityMatch[1].trim() : null;

  const errorMatch = rawOutput.match(/---BEGIN ERROR HANDLING REVIEW---([\s\S]*?)---END ERROR HANDLING REVIEW---/);
  const errorHandlingReview = errorMatch ? errorMatch[1].trim() : null;

  const suggestionsMatch = rawOutput.match(/---BEGIN SUGGESTIONS---([\s\S]*?)---END SUGGESTIONS---/);
  const suggestions = suggestionsMatch ? suggestionsMatch[1].trim() : null;

  const appendix = [
    securityReview      ? `## Security Considerations\n\n${securityReview}`       : null,
    errorHandlingReview ? `## Error & Failure Handling\n\n${errorHandlingReview}` : null,
    suggestions         ? `## Suggestions & Improvements\n\n${suggestions}`       : null,
  ].filter(Boolean).join('\n\n---\n\n');

  const fullPlaybookText = appendix ? `${playbookText}\n\n---\n\n${appendix}` : playbookText;

  return { playbookText: fullPlaybookText, importFileContent, importFileName, importFileExtension, securityReview, errorHandlingReview, suggestions };
}
