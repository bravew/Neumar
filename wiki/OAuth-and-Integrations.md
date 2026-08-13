# OAuth and Integrations

Neuma supports OAuth2 connections to Google, Slack, and Notion. Connected accounts unlock additional agent capabilities (e.g., reading Gmail, posting to Slack, searching Notion pages).

---

## Supported Providers

| Provider | Protocol | Services |
|---|---|---|
| **Google** | OAuth2 PKCE | Gmail, Drive, Calendar, Docs, Sheets, Meet, Photos, Contacts, Tasks, Directory |
| **Slack** | OAuth2 PKCE | Messages, channels, file uploads, Socket Mode gateway |
| **Notion** | OAuth2 PKCE | Pages, databases, search |

---

## OAuth2 PKCE Flow

All providers use the **Authorization Code flow with PKCE** (no client secret stored on disk):

```
1. User clicks Connect in Settings
        │
        ▼
2. App generates code_verifier + code_challenge (S256)
        │
        ▼
3. Spawn loopback callback server on a random port
        │
        ▼
4. Open browser → provider authorization URL
        │
        ▼
5. User logs in and grants scopes
        │
        ▼
6. Browser redirects to http://localhost:<random>/callback?code=...
        │
        ▼
7. Callback server captures code, exchanges for tokens
        │
        ▼
8. Tokens encrypted and stored, callback server shut down
        │
        ▼
9. UI updated to show connected status
```

The loopback server is a temporary HTTP server that exists only for the duration of the OAuth exchange — it is not permanently running.

---

## Token Storage

Tokens are stored **encrypted at rest** in `~/.<slug>/`:

| Provider | File |
|---|---|
| Google | `google-tokens.enc.json` |
| Slack | `slack-tokens.enc.json` |
| Notion | `notion-tokens.enc.json` |

**Encryption:** AES-256-GCM with PBKDF2-SHA512 key derivation (100,000 iterations, 32-byte salt). File permissions are `0o600` (owner-only read/write).

---

## Token Lifecycle

### Automatic Refresh

A background **Token Refresh Service** runs every 15 minutes and refreshes tokens that expire within the next 20 minutes. Currently supported for Google (OAuth2 refresh tokens).

Per-provider **refresh mutex** prevents concurrent refresh attempts for the same provider.

### Connection Health Monitor

A background **Connection Health Monitor** runs every 30 minutes and sends a lightweight API call to verify each connected account is still valid. After 3 consecutive failures, the connection is marked as **revoked** and the user is prompted to reconnect.

---

## Google Scopes

Google scopes are requested **incrementally** — only when the user tries to use a feature that requires them. This avoids overwhelming users with a permissions screen upfront.

| Scope | Feature |
|---|---|
| `gmail.send`, `gmail.readonly` | Send/read emails |
| `drive.file`, `drive.readonly` | Drive file access |
| `calendar.events` | Calendar read/write |
| `docs` | Google Docs |
| `spreadsheets` | Google Sheets |
| `meet.spaces.created` | Google Meet |
| `photoslibrary.readonly` | Google Photos |
| `contacts.readonly` | Google Contacts |
| `tasks` | Google Tasks |
| `admin.directory.user.readonly` | Google Directory |

When an agent tries to use a Google tool that requires a scope not yet granted, the user is prompted to authorize that scope.

---

## Slack Integration

### Socket Mode Gateway

In addition to basic OAuth, the Slack integration includes a **Socket Mode gateway** that receives real-time events from Slack (messages, reactions, etc.) and routes them to the agent.

This enables:
- Triggering tasks from Slack messages
- Responding to Slack threads
- Posting agent outputs directly to channels

Configure in **Settings → Integrations → Slack**.

### Slack as Pipeline Notifier

The [[Linear Pipeline]] uses Slack webhooks (separate from OAuth) to post build/PR notifications. This does not require the OAuth connection.

---

## Authentication API

```
GET  /auth/status             All provider connection states
GET  /auth/health             Background service health
GET  /auth/:provider/scopes   Granted scopes for a provider

POST /auth/:provider/connect  Start OAuth flow (returns auth URL)
POST /auth/:provider/disconnect  Revoke tokens and disconnect
POST /auth/:provider/refresh  Force token refresh
```

---

## Connecting an Account

1. Open **Settings → Integrations**
2. Click **Connect** next to the desired provider
3. Complete the browser OAuth flow
4. Return to the app — the connection shows as **Active**

---

## Disconnecting

1. Open **Settings → Integrations**
2. Click **Disconnect** next to the connected provider
3. Encrypted token file is deleted; API access is revoked server-side

---

## Further Reading

- [[MCP Integration]] — Google Services MCP server (79 tools)
- [[Security]] — OAuth token encryption details
- [[Linear Pipeline]] — Slack notifications from the pipeline
- [[API Reference]] — `/auth/*` endpoints
