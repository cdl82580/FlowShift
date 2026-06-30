# FlowShift — Slack App Setup

This guide walks through creating the Slack app, configuring it, and linking your workspace. The entire process takes about 10 minutes.

---

## Prerequisites

- A deployed FlowShift instance (the Fly.io app must be live at your `APP_URL`)
- A Slack workspace where you have permission to install apps
- Your FlowShift API key (shown on the dashboard, or use `/flowshift link` after setup)

---

## Step 1 — Create the Slack app

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)**
2. Click **Create New App** → **From scratch**
3. Name it **FlowShift** and select your workspace
4. Click **Create App**

---

## Step 2 — Add bot token scopes

In your app's settings, go to **OAuth & Permissions** → scroll to **Bot Token Scopes** → click **Add an OAuth Scope** and add each of the following:

| Scope | Purpose |
|---|---|
| `chat:write` | Send messages and DMs |
| `commands` | Respond to slash commands |
| `conversations.open` | Open a DM channel to deliver run results |
| `files:read` | Download workflow files uploaded in modals |
| `files:write` | Upload import files back to Slack as attachments |
| `im:write` | Write into DM channels |
| `users:read.email` | Read the verified Slack account email for `/flowshift register` and `/flowshift forgot` — ensures users can only register or recover their own email, not someone else's |

---

## Step 3 — Create the slash command

Go to **Slash Commands** → **Create New Command** and fill in:

| Field | Value |
|---|---|
| **Command** | `/flowshift` |
| **Request URL** | `https://flowshift.cdlav.us/slack/commands` |
| **Short Description** | `Generate iPaaS migration playbooks` |
| **Usage Hint** | `[new \| list \| status <run-id> \| link <api-key> \| help]` |

Click **Save**.

---

## Step 4 — Enable interactivity

Go to **Interactivity & Shortcuts** → toggle the feature **On** → set:

| Field | Value |
|---|---|
| **Request URL** | `https://flowshift.cdlav.us/slack/interactions` |

Click **Save Changes**.

---

## Step 5 — Install the app to your workspace

Go to **OAuth & Permissions** → click **Install to Workspace** → click **Allow**.

After installation, you'll see a **Bot User OAuth Token** that starts with `xoxb-`. Copy it — you'll need it in the next step.

---

## Step 6 — Copy the signing secret

Go to **Basic Information** → **App Credentials** → copy the **Signing Secret**.

---

## Step 7 — Set the Fly.io secrets

Run this in your terminal (replace with your actual values):

```bash
fly secrets set \
  SLACK_BOT_TOKEN="xoxb-your-token-here" \
  SLACK_SIGNING_SECRET="your-signing-secret-here" \
  --app flowshift-cdl
```

The machine will restart automatically and pick up the new secrets. Verify by running:

```bash
fly logs --app flowshift-cdl | grep "Slack integration"
# Should print: Slack integration: enabled
```

---

## Step 8 — Invite the bot to a channel

In Slack, go to any channel (or open a DM), type `/invite @FlowShift` and press Enter.

Alternatively, just type `/flowshift help` in any channel — Slack will ask you to invite the bot automatically.

---

## Step 9 — Connect your FlowShift account

**Option A — New user (no FlowShift account yet):**
```
/flowshift register
```
A modal opens asking for your name (optional). Your Slack profile email is used automatically. After submitting, FlowShift DMs you your new API key and auto-links your Slack account. You're ready immediately.

**Option B — Existing user (already have an account):**
```
/flowshift link <your-api-key>
```
Your API key is shown on the FlowShift dashboard at `https://flowshift.cdlav.us`. Run this once to connect Slack.

**Forgot your API key?**
```
/flowshift forgot
```
Sends a recovery link to your Slack profile email. Click the link to get a new API key, then run `/flowshift link <new-key>`.

---

## You're live. Try it:

```
/flowshift register     → create account + auto-link (new users)
/flowshift              → open the migration modal
/flowshift list         → see your last 5 runs
/flowshift help         → full command reference
```

---

## Command reference

| Command | Description |
|---|---|
| `/flowshift register` | Create a FlowShift account using your Slack email — API key sent as DM |
| `/flowshift link <api-key>` | Link an existing FlowShift account to your Slack |
| `/flowshift forgot` | Send a recovery link to your Slack email to get a new API key |
| `/flowshift` | Opens a modal to start a new migration or build guide |
| `/flowshift new` | Same as above |
| `/flowshift list` | Shows your last 5 runs — status, full run ID, and a 📂 Drive link per run (only visible to you) |
| `/flowshift status <run-id>` | Checks a specific run — the first 8 characters of the ID work |
| `/flowshift unlink` | Removes the account link |
| `/flowshift help` | Shows this command reference in Slack |

---

## The modal

When you run `/flowshift`, a modal opens with four fields:

| Field | Required | Notes |
|---|---|---|
| **Source Platform** | No | Leave blank for Build Guide mode (no migration, just a how-to for the destination) |
| **Destination Platform** | Yes | The platform you're building or migrating to |
| **Workflow Description** | One of these | Describe triggers, actions, conditions in plain text or markdown. Max 3,000 characters. |
| **Workflow File** | One of these | Upload a JSON, YAML, XML, or TXT file. The bot downloads it automatically. Very large files (> a few MB) work better through the web app. |

You can provide both a description and a file — Claude uses both for context.

---

## What you receive when a run completes

FlowShift sends you a DM containing:

1. **A playbook preview** — the first ~600 characters of the migration guide with a *View Full Playbook* button linking to the web UI
2. **An import file attachment** — the workflow JSON uploaded directly as a Slack file (where the destination platform supports import)
3. **Action buttons**:
   - *View Full Playbook* — opens the run detail page in the web app
   - *Open in Drive* — opens the Google Drive run folder (if Drive is authorized)

---

## Troubleshooting

**`/flowshift` returns "Slack integration not configured"**
→ The `SLACK_BOT_TOKEN` or `SLACK_SIGNING_SECRET` secrets are not set. Re-run Step 7.

**Modal submission does nothing / no DM received**
→ Check that the Interactivity Request URL is set to `https://flowshift.cdlav.us/slack/interactions` (Step 4).

**"Invalid Slack signature" in server logs**
→ The `SLACK_SIGNING_SECRET` doesn't match the app. Go to **Basic Information → App Credentials** and re-copy it.

**File upload fails with "Could not read the uploaded file"**
→ Ensure the `files:read` scope is added (Step 2) and the app is re-installed after adding the scope.

**`/flowshift list` or `/flowshift status` says "Link your account first"**
→ Use `/flowshift register` (new user) or `/flowshift link <api-key>` (existing user) — see Step 9.

**`/flowshift register` or `/flowshift forgot` says "Could not read your Slack account email"**
→ The `users:read.email` scope is missing. Add it under **OAuth & Permissions → Bot Token Scopes** and reinstall the app (Step 2 + Step 5).

---

## Updating the app URL

If you change your Fly.io app name or use a custom domain, update both Request URLs:
- **Slash Commands**: `https://your-domain/slack/commands`
- **Interactivity & Shortcuts**: `https://your-domain/slack/interactions`

And update the `APP_URL` Fly.io secret:

```bash
fly secrets set APP_URL="https://your-domain" --app flowshift-cdl
```
