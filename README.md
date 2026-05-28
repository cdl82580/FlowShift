# FlowShift

AI-powered iPaaS migration playbook generator. Describe a workflow in one platform, get a full migration playbook and a ready-to-import workflow file for another — powered by Claude.

**Live:** https://flowshift-cdl.fly.dev

---

## What it does

Submit a source workflow (file upload or plain-text description) and a source/destination platform pair. FlowShift calls Claude to produce:

1. **A migration playbook** — step-by-step breakdown, node mapping, credential setup guide, and gotchas
2. **An import file** — a functional, ready-to-import JSON (n8n workflow, Make blueprint, etc.) with `{{PLACEHOLDER}}` tokens for API keys
3. **A Google Drive folder** — both files uploaded automatically under a per-user, per-run subfolder, shared publicly via link

**Supported platforms:** n8n · Make · Zapier · Tray · Boomi · Workato · Celigo

---

## Stack

| Layer | Tech |
|---|---|
| API | Node.js · TypeScript · Express |
| Database | SQLite via `@libsql/client` (persisted on Fly.io volume) |
| AI | Anthropic Claude (`claude-opus-4-7`) |
| Storage | Google Drive API v3 (OAuth2) |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS |
| Deploy | Fly.io · Docker (multi-stage) |

---

## API

All data endpoints are prefixed `/api`. Authentication uses an `X-API-Key` header.

### Users

```
POST /api/users
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
Identify the current user by API key.

---

```
GET /api/users/:id
X-API-Key: <key>
```
Get user profile (includes GDrive folder URL once a run has been submitted).

---

```
GET /api/users/:id/runs
X-API-Key: <key>
```
List all runs for a user, newest first.

---

### Runs

```
POST /api/runs
X-API-Key: <key>
Content-Type: multipart/form-data   (or application/json for description-only)
```

| Field | Type | Required |
|---|---|---|
| `source` | string | ✓ |
| `destination` | string | ✓ |
| `description` | string | one of these |
| `file` | file upload | one of these |

Synchronous — waits for Claude (~30–60 s) and returns the completed run.

---

```
GET /api/runs/:id
X-API-Key: <key>
```
Full run detail: playbook text, import file content, GDrive folder URL.

---

### OAuth (Google Drive setup)

```
GET /auth/google            → redirects to Google consent
GET /auth/google/callback   → exchanges code, stores refresh token
```

Visit `/auth/google` once to authorize Drive access. After that, every run automatically creates and populates a per-run folder.

---

### Health

```
GET /health   → { "status": "ok", ... }
```

---

## Google Drive output structure

```
Parent folder (shared with service account)
└── you@example.com/          ← user folder, anyone-with-link readable
    └── run_<uuid>/           ← per-run folder, anyone-with-link readable
        ├── playbook.md
        └── flowshift_<src>_to_<dst>.json
```

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

# Run frontend dev server (port 5173, proxies /api to :8080)
cd frontend && npm run dev
```

The frontend dev server proxies `/api` and `/auth` to `localhost:8080`, so no CORS configuration is needed.

---

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_OAUTH_CLIENT_ID` | GCP OAuth 2.0 client ID (Web application) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | GCP OAuth 2.0 client secret |
| `GDRIVE_PARENT_FOLDER_ID` | Parent GDrive folder ID (default: project folder) |
| `APP_URL` | Public base URL (used to build OAuth callback URI) |
| `PORT` | Server port (default: `8080`) |
| `DATABASE_PATH` | SQLite file path (default: `./flowshift.db`) |

---

## Google Drive setup

1. **GCP project** — enable the Drive API
2. **OAuth 2.0 Client ID** — type: Web application, redirect URI: `https://<your-host>/auth/google/callback`
3. **Test users** — add your Google account email (required until the app is verified)
4. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
5. Visit `https://<your-host>/auth/google` and authorize — done

---

## Deployment (Fly.io)

```bash
# First-time setup
fly apps create flowshift-cdl
fly volumes create flowshift_data --region iad --size 1 --app flowshift-cdl

# Secrets
fly secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  GOOGLE_OAUTH_CLIENT_ID="..." \
  GOOGLE_OAUTH_CLIENT_SECRET="..." \
  --app flowshift-cdl

# Deploy
fly deploy --app flowshift-cdl

# Authorize Drive (one-time)
# Visit: https://flowshift-cdl.fly.dev/auth/google
```

The Dockerfile runs a multi-stage build: frontend (Vite) → API (tsc) → slim runtime image. SQLite lives on the mounted `/data` volume.
