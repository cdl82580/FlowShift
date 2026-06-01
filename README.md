# FlowShift

AI-powered iPaaS migration playbook generator. Describe a workflow in one platform, get a full migration playbook and a ready-to-import workflow file for another — powered by Claude.

**Live:** https://flowshift-cdl.fly.dev

---

## What it does

Submit a source workflow (file upload or plain-text description) and a source/destination platform pair. FlowShift calls Claude to produce:

1. **A migration playbook** — step-by-step breakdown, node mapping, credential setup guide, gotchas, security considerations, error & failure handling audit, and improvement suggestions
2. **An import file** — a functional, ready-to-import JSON (n8n workflow, Make blueprint, etc.) with `{{PLACEHOLDER}}` tokens for API keys
3. **A Google Drive folder** — both files uploaded automatically under a per-user, per-run subfolder, shared publicly via link

**Supported platforms:** n8n · Make · Zapier · Tray · Boomi · Workato · Celigo · Power Automate

**Source platform is optional.** Omitting it switches Claude to *Build Guide* mode — a step-by-step guide for building the workflow from scratch in the destination platform rather than migrating from somewhere else.

### Import file compatibility

| Platform | Import file | Notes |
|---|---|---|
| n8n | ✅ Reliable | Open, well-documented JSON format |
| Make | ✅ Reliable | Blueprint JSON — connection re-linking is expected on any Make import |
| Zapier | ❌ Not available | Zapier does not support workflow import |
| Tray | ⚠️ Best-effort | Proprietary format — step definitions and connectors need manual adjustment |
| Boomi | ⚠️ Best-effort | Complex enterprise schema tied to Atoms/connectors — use the playbook as the primary guide |
| Workato | ⚠️ Best-effort | Proprietary recipe format — trigger/action configs may need manual adjustment |
| Celigo | ⚠️ Best-effort | Proprietary flows with account-specific mappings and scripts |
| Power Automate | ⚠️ Best-effort | Proprietary Microsoft schema — connections and credentials need manual configuration |

The UI surfaces an inline caveat banner on the run detail page for all ⚠️ platforms.

---

## Stack

| Layer | Tech |
|---|---|
| API | Node.js · TypeScript · Express |
| Database | SQLite via `@libsql/client` (persisted on Fly.io volume) |
| AI | Anthropic Claude (`claude-opus-4-7`) |
| Storage | Google Drive API v3 (OAuth2) |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS |
| Slack | `@slack/web-api` · Block Kit modals · slash commands |
| Deploy | Fly.io · Docker (multi-stage) |

---

## API

All data endpoints are prefixed `/api`. Authentication uses an `X-API-Key` header.

### Users

```
POST /api/users
Content-Type: application/json
```
Register a new user. Returns an `api_key` — **shown once, save it**.

```json
{ "email": "you@example.com", "name": "Your Name" }
```

---

```
GET /api/users/me
X-API-Key: <key>
```
Identify the current user by API key. Used by the sign-in flow when only the key is known.

---

```
GET /api/users/:id
X-API-Key: <key>
```
Get user profile. Includes `gdrive_folder_id` and `gdrive_folder_url` once a run has completed with Drive enabled.

---

```
GET /api/users/:id/runs?limit=50&offset=0
X-API-Key: <key>
```
List runs for a user, newest first. Returns lightweight summary objects — no `playbook_text` or `import_file_content`. Use `GET /api/runs/:id` for full results.

**Query parameters:**

| Parameter | Default | Max | Description |
|---|---|---|---|
| `limit` | `50` | `500` | Number of runs to return |
| `offset` | `0` | — | Pagination offset |

---

```
POST /api/users/recover
Content-Type: application/json
```
Request an API key recovery email.

```json
{ "email": "you@example.com" }
```

Always returns `200 OK` with the same neutral message regardless of whether the email is registered (prevents account enumeration). If the email is found, a one-time recovery link is sent via Resend and expires in **15 minutes**.

> **Local dev:** If `RESEND_API_KEY` is not set, the recovery URL is printed to the server console.

---

```
GET /api/users/recover/:token
```
Exchange a recovery token for a new API key. Single-use — invalidated immediately on redemption. Previous key is permanently replaced.

| Field | Type | Description |
|---|---|---|
| `api_key` | string | New API key — **shown once only** |
| `id` | string | User UUID |
| `email` | string | Registered email |
| `name` | string \| null | Display name |

Errors: `400` for invalid, already-used, or expired tokens.

---

### Runs

```
POST /api/runs
X-API-Key: <key>
Content-Type: application/json
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | | Optional. Omit to produce a Build Guide instead of a migration playbook. |
| `destination` | string | ✓ | Required. The target platform. |
| `description` | string | one of † | Plain-text or markdown description of the workflow. |
| `fileContent` | string | one of † | Full text of the source workflow file. |
| `fileName` | string | | With `fileContent` — used to name the Drive upload. |

† At least one of `description` or `fileContent` must be provided.

**Async** — returns `202 Accepted` immediately with `status: "pending"`. Claude + Drive upload run in the background. Poll `GET /api/runs/:id` until `status` is `"completed"` or `"failed"` (typically 30–60 seconds).

> **File upload note:** The frontend reads the file as text client-side and sends it in `fileContent`. Chrome on macOS can block this with a `NotReadableError` for files with emoji in the name — the UI opens a paste textarea automatically as a fallback.

---

```
GET /api/runs/:id
X-API-Key: <key>
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Run UUID |
| `user_id` | string | Owning user UUID |
| `source` | string \| null | Source platform. Null for Build Guide runs. |
| `destination` | string | Destination platform |
| `description` | string \| null | Description submitted with the run |
| `original_filename` | string \| null | Uploaded filename, if any |
| `status` | string | `pending` → `processing` → `completed` \| `failed` |
| `playbook_text` | string \| null | Full migration guide in markdown. Populated when `completed`. Includes security considerations, error & failure handling audit, and improvement suggestions appended as sections. |
| `import_file_content` | string \| null | Ready-to-import workflow file text. Null if platform doesn't support import (e.g. Zapier). |
| `import_file_name` | string \| null | Suggested filename (e.g. `flowshift_zapier_to_n8n.json`) |
| `import_file_extension` | string \| null | Extension without dot (e.g. `json`) |
| `has_import_file` | boolean | `true` when `import_file_content` is non-null |
| `gdrive_run_folder_url` | string \| null | Drive folder URL. Null if Drive is not authorized. |
| `error_message` | string \| null | Error details when `status` is `failed` |
| `created_at` | string | ISO 8601 UTC |
| `completed_at` | string \| null | ISO 8601 UTC. Null while pending or processing. |

---

### OAuth (Google Drive)

```
GET /auth/google            → redirects to Google consent screen
GET /auth/google/callback   → exchanges code, stores refresh token in DB
```

Visit `/auth/google` once in a browser. The refresh token is stored in the database and reused automatically — no re-authorization needed across deploys.

---

### Slack (webhook receivers)

These endpoints are called by Slack's infrastructure, not by API consumers directly. See [SLACK_SETUP.md](./SLACK_SETUP.md) for the full setup guide.

```
POST /slack/commands       — receives /flowshift slash commands
POST /slack/interactions   — receives modal submissions and button clicks
```

Both endpoints verify Slack's HMAC-SHA256 request signature before processing. Requests older than 5 minutes are rejected (replay-attack prevention).

---

### Health

```
GET /health   → { "status": "ok", "service": "flowshift-api", "timestamp": "..." }
```

---

## Slack bot

The FlowShift Slack bot maps the full API surface to native Slack patterns.

### Commands

| Command | What it does |
|---|---|
| `/flowshift register` | Create a new FlowShift account using your Slack email — API key sent as DM, account auto-linked |
| `/flowshift link <api-key>` | Link an existing FlowShift account to your Slack |
| `/flowshift forgot` | Send a recovery link to your Slack email to get a new API key |
| `/flowshift` | Opens a Block Kit modal — platform pickers, description textarea, file upload |
| `/flowshift new` | Same as above |
| `/flowshift list` | Shows your last 5 runs with status, full run ID, and a 📂 Drive link (ephemeral) |
| `/flowshift status <run-id>` | Checks the status of a specific run (first 8 chars of ID work) |
| `/flowshift unlink` | Removes the Slack ↔ FlowShift account link |
| `/flowshift help` | Shows the command reference |

### Result delivery

When a run completes, FlowShift DMs you with:
- ✅ A rich message with a playbook preview and action buttons (*View Full Playbook*, *Open in Drive*)
- 📎 The import file uploaded as a Slack file attachment (if the platform supports it)

### User linking

Three ways to get started in Slack:

1. **New user** — `/flowshift register` creates an account using your Slack profile email, auto-links your Slack account, and DMs you the API key.
2. **Existing user** — `/flowshift link <api-key>` links your current account.
3. **Forgot your key** — `/flowshift forgot` sends a recovery link to your Slack email.

> **Security note:** `register` and `forgot` both read your email from your verified Slack profile (requires the `users:read.email` scope) — they do not accept a user-supplied email address. This ensures users can only register or recover their own account.

**→ Full Slack app setup guide: [SLACK_SETUP.md](./SLACK_SETUP.md)**

---

## Google Drive output structure

```
Parent folder (your GDrive, authorized via OAuth)
└── you@example.com/          ← user folder, anyone-with-link can view
    └── run_<uuid>/           ← per-run folder, anyone-with-link can view
        ├── playbook.md
        └── flowshift_<src>_to_<dst>.json
```

---

## Frontend

The React SPA is built by Vite and served as static files from the same Express process.

| Page | Path | Description |
|---|---|---|
| Auth | `/auth` | Register · Sign In · "Forgot your API key?" recovery form |
| Dashboard | `/` | Run history with status badges, Drive links, stats panel, API key widget |
| New Migration | `/runs/new` | Platform pickers (source optional), markdown description editor, file upload with paste fallback |
| Run Detail | `/runs/:id` | Playbook tab (rendered markdown), Import File tab (copy + download), Drive link, import caveat banners |
| Recover | `/recover?token=<uuid>` | Exchanges a recovery token for a new API key, auto-signs in |

The run detail page polls `GET /api/runs/:id` every 3 seconds while the run is in-flight, stopping automatically after 10 minutes and showing a manual refresh button.

---

## Local development

```bash
git clone https://github.com/cdl82580/flowshift
cd flowshift

# Install API deps
npm install

# Install frontend deps
cd frontend && npm install && cd ..

# Copy and fill in env vars
cp .env.example .env

# Run API (port 8080)
npm run dev

# In a second terminal — frontend dev server (port 5173)
# Proxies /api, /auth, and /slack to localhost:8080 automatically
cd frontend && npm run dev
```

---

## Environment variables

### Required

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |

### Optional — Claude tuning

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-4-7` | Claude model ID |
| `MAX_TOKENS` | `8192` | Max tokens for Claude responses |

### Optional — Email recovery (disabled if unset)

| Variable | Default | Description |
|---|---|---|
| `RESEND_API_KEY` | — | Resend API key for sending recovery emails |
| `FROM_EMAIL` | `noreply@flowshift.io` | Sender address for recovery emails |

### Optional — Google Drive (uploads disabled if unset)

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | — | GCP OAuth 2.0 client ID (Web application type) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | GCP OAuth 2.0 client secret |
| `GDRIVE_PARENT_FOLDER_ID` | `11BCUCoM3a0di8tYiz-r9EOuQ7AZlt7FU` | Parent folder — user subfolders created here |
| `APP_URL` | `https://flowshift-cdl.fly.dev` | Public base URL — used to build OAuth callback URIs |

### Optional — Slack bot (disabled if unset)

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (starts with `xoxb-`) |
| `SLACK_SIGNING_SECRET` | Signing secret from Slack app Basic Information page |

### Infrastructure

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server port |
| `DATABASE_PATH` | `./flowshift.db` | SQLite file path (`/data/flowshift.db` in production) |

---

## Google Drive setup

1. **GCP project** — enable the Drive API
2. **OAuth 2.0 Client ID** — type: Web application, redirect URI: `https://<your-host>/auth/google/callback`
3. **Test users** — add your Google account email (required until the app passes Google verification)
4. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` as Fly.io secrets
5. Visit `https://<your-host>/auth/google` in a browser and approve — refresh token stored automatically

---

## Slack setup

See **[SLACK_SETUP.md](./SLACK_SETUP.md)** for the complete step-by-step guide.

Quick summary:
1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Add bot scopes (including `users:read.email`), slash command, and interactivity pointing to your Fly.io URL
3. Install to your workspace and copy the Bot Token + Signing Secret
4. `fly secrets set SLACK_BOT_TOKEN="xoxb-..." SLACK_SIGNING_SECRET="..." --app flowshift-cdl`
5. `/flowshift register` to create an account, or `/flowshift link <api-key>` to connect an existing one

---

## Deployment (Fly.io)

```bash
# First-time setup
fly apps create flowshift-cdl
fly volumes create flowshift_data --region iad --size 1 --app flowshift-cdl

# Required secret
fly secrets set ANTHROPIC_API_KEY="sk-ant-..." --app flowshift-cdl

# Optional secrets (add as needed)
fly secrets set \
  GOOGLE_OAUTH_CLIENT_ID="..." \
  GOOGLE_OAUTH_CLIENT_SECRET="..." \
  RESEND_API_KEY="re_..." \
  FROM_EMAIL="noreply@yourdomain.com" \
  SLACK_BOT_TOKEN="xoxb-..." \
  SLACK_SIGNING_SECRET="..." \
  --app flowshift-cdl

# Deploy
fly deploy --app flowshift-cdl

# One-time post-deploy steps
# Drive:  open https://flowshift-cdl.fly.dev/auth/google in a browser
# Slack:  /flowshift register  (new user)
#         /flowshift link <api-key>  (existing user)
```

**Infrastructure notes:**
- Multi-stage Docker build: frontend (Vite) → API (tsc) → slim `node:20-slim` runtime
- SQLite on a persistent 1 GB volume mounted at `/data`
- `auto_stop_machines = false` — machine stays running so background run processing is never interrupted
- Health check at `GET /health` every 15 seconds
- VM: `shared-cpu-1x` · 512 MB RAM
