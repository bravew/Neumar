---
summary: "Authentication and OAuth2 integration system — site-based primary auth (Supabase), PKCE flow for integrations, token manager, encrypted storage, and third-party integration clients (Google, Slack, Notion)"
read_when:
  - Adding a new OAuth provider
  - Debugging authentication or token refresh issues
  - Understanding how integration tokens are stored and secured
  - Building features that use Google, Slack, or Notion APIs
  - Understanding the site login flow
title: "Auth System"
---

# Auth System

The auth system has two layers:

1. **Primary authentication** — via the companion website (neumar.app / localhost:3000), using
   Supabase auth. This determines the `authenticated` state for the desktop app.
2. **Integration connections** — OAuth2 for third-party services (Google, Slack, Notion). These
   are optional connectors for workspace features, not the primary login.

All token storage happens **server-side** — the frontend only receives connection metadata
(email, display name, status) and never sees raw tokens.

## Architecture

```
Frontend                     Backend API                    Site (neumar.app)
──────────                   ───────────                    ─────────────────
useAuth hook          ←───→  /auth/* routes           ───→  /auth/desktop
AuthContext                  site-auth.ts                   /auth/desktop-callback
SiteSignInButton             oauth-client.ts                Supabase Auth
IntegrationCard              token-manager.ts
AccountSettings              integrations/*

                                    ↓ encrypted storage
                             ~/.<slug>/auth.enc.json (AES-256-GCM)
```

## Site Login Flow (Primary Auth)

The desktop app authenticates users via the companion website. This supports any auth method
configured on the site (Google, email/password, magic link, etc.):

1. Frontend calls `POST /auth/site/login`
2. Backend spawns a temporary loopback HTTP server on a random port
3. Backend returns `authUrl` → `{siteUrl}/auth/desktop?port={port}`
4. Frontend opens `authUrl` in the system browser
5. Site stores the callback port in a short-lived cookie, redirects to sign-in page
6. User signs in on the site (any Supabase-supported method)
7. After auth, site renders an auto-submitting HTML form that POSTs session tokens to
   `http://127.0.0.1:{port}/callback` (tokens never appear in URL bar or browser history)
8. Backend receives tokens, persists Supabase URL + anon key for token refresh, stores
   encrypted session, shows success page in browser
9. Frontend polls `/auth/status` and detects the new `site` connection → `authenticated = true`

**Token refresh:** Supabase access tokens expire (~1 hour). The background token refresh service
proactively refreshes site tokens using Supabase's `POST /auth/v1/token?grant_type=refresh_token`
REST endpoint, with a 10-second request timeout. The Supabase URL and anon key (public values)
are stored locally during the initial login.

**Configuration:** Set `SITE_URL=http://localhost:3000` for local dev, or leave unset to default
to `https://neumar.app`. Can also be set via the `site_url` setting in the desktop app's DB.

## OAuth2 Flow (PKCE) — Integration Connections

Google, Slack, and Notion integrations use the **Authorization Code + PKCE** flow:

1. Frontend calls `POST /auth/:provider/initiate`
2. Backend generates `codeVerifier` + `codeChallenge` (S256) and a random CSRF `state`
3. Backend spawns a temporary loopback HTTP server on a random port, returns `authUrl`
4. Frontend opens `authUrl` in the system browser via Tauri `shell:open`
5. User grants consent; browser redirects to `http://localhost:<port>/callback?code=…&state=…`
6. Backend validates `state`, exchanges code for tokens, stores encrypted tokens to disk
7. Backend resolves the pending flow promise; frontend polls `/auth/status` and sees the new connection

### Token Storage

Tokens are stored in `~/.{slug}/auth/<provider>.enc` using AES-256-GCM:

```
salt (32 bytes) | IV (12 bytes) | auth tag (16 bytes) | ciphertext
```

Key derivation: `PBKDF2-SHA512` with 100,000 iterations over a per-installation master key.
File permissions are set to `0o600` (owner read/write only). Raw tokens are never logged or
returned in API responses.

## Files

| File | Purpose |
|------|---------|
| `src-api/src/shared/auth/types.ts` | Shared types: `OAuthProvider` (includes `'site'`), `OAuthConnection`, `OAuthTokens`, `PendingOAuthFlow`, `HealthStatus`, `ConnectionHealthState`, `ConnectionEvent` |
| `src-api/src/shared/auth/site-auth.ts` | Site login flow — localhost callback server, Supabase session storage, token refresh via Supabase REST API |
| `src-api/src/shared/auth/oauth-client.ts` | PKCE flow, loopback callback server, token exchange, and available provider detection (Google/Slack/Notion) |
| `src-api/src/shared/auth/token-manager.ts` | Encrypted token read/write, refresh scheduling, and connection lifecycle |
| `src-api/src/shared/auth/connection-broker.ts` | Unified facade over all OAuth connections — `getServiceClient()`, refresh mutex, event emitter |
| `src-api/src/shared/auth/connection-health-monitor.ts` | Periodic heartbeat checks (every 30 min) — detects externally-revoked tokens (Google/Slack/Notion; site sessions skipped) |
| `src-api/src/shared/auth/token-refresh-service.ts` | Proactive background token refresh — checks every 15 min, refreshes tokens expiring within 20 min (Google + site) |
| `src-api/src/config/oauth.ts` | Per-provider configuration and incremental scope constants (Gmail, Calendar, Drive, etc.) |
| `src-api/src/app/api/auth.ts` | Hono route handlers — mounts at `/auth/` |

## Supported Providers

| Provider | Role | Credentials Source | Auth Method | Base Scopes |
|----------|------|-------------------|-------------|-------------|
| `site` | **Primary auth** | `SITE_URL` env var or `site_url` setting | Site-mediated Supabase login | N/A (Supabase session) |
| `google` | Integration | Env var (build-time) or user setting | OAuth2 + PKCE | `openid email profile` |
| `slack` | Integration | User-provided via Settings → Connectors | OAuth2 + secret | `chat:write channels:read channels:history users:read files:read im:read im:history` |
| `notion` | Integration | User-provided via Settings → Connectors | OAuth2 + secret | (Notion handles scope server-side) |

## Cloud Storage Connection Behavior

Cloud storage uses two credential paths:

| Connection type | Storage path | Notes |
|-----------------|--------------|-------|
| Site-proxied cloud providers (`google_drive`, `dropbox`, `box`, `onedrive`, stock catalogs, site-managed personal media) | Companion site account, accessed through `SiteApiClient` with the desktop site session bearer token | The desktop route mirrors `/api/cloud-storage/*` on the site and refreshes the site token once after a 401 |
| Local Immich personal media | Existing SQLite `settings` rows keyed by `cloud_storage_personal_media_connection_ids` and `cloud_storage_personal_media_credential:<id>` | API key and base URL are entered in **Settings → Connectors → Cloud storage** and never returned to the frontend after creation |

Self-hosted media connection tests run from the desktop process so LAN-only Immich or PhotoPrism
URLs can be checked locally. The URL policy allows explicit LAN hosts but still rejects embedded
credentials, cloud metadata hosts, blocked/link-local IPs, unsupported protocols, and non-HTTPS
public URLs.

### Security Model (Desktop App — No Server)

- **Google**: Uses PKCE (RFC 7636) with `client_secret` sent conditionally. "Desktop app" type
  Google OAuth clients can omit the secret; "Web application" type requires it. Google credentials
  are loaded from env vars (build-time) or user settings, with PKCE + redirect URI validation
  protecting the flow.
- **Slack & Notion**: These providers require `client_secret` for token exchange and do not support
  PKCE. Since this is a server-less desktop app, secrets cannot be safely bundled. Instead, users
  provide their own OAuth app credentials via Settings → Connectors. Credentials are stored locally
  in the settings DB and never leave the device.

A provider is listed as "available" when its required credentials are configured.

### Google Incremental Scopes

Google scopes are requested incrementally. The base auth grant (`openid email profile`) is
followed by service-specific scope requests as features are used. Exported constants from
`oauth.ts`:

| Constant | Scopes | Service |
|----------|--------|---------|
| `GOOGLE_GMAIL_SCOPES` | `gmail.readonly`, `gmail.compose` | Gmail |
| `GOOGLE_CALENDAR_SCOPES` | `calendar.readonly`, `calendar.events` | Calendar |
| `GOOGLE_DRIVE_SCOPES` | `drive.readonly`, `drive.file` | Drive |
| `GOOGLE_PHOTOS_SCOPES` | `photospicker.mediaitems.readonly` | Photos |
| `GOOGLE_MEET_SCOPES` | `meetings.space.created`, `meetings.space.readonly` | Meet |
| `GOOGLE_TASKS_SCOPES` | `tasks` | Tasks |
| `GOOGLE_CONTACTS_SCOPES` | `contacts` | Contacts |
| `GOOGLE_DIRECTORY_SCOPES` | `directory.readonly` | Workspace Directory |
| `GOOGLE_SHEETS_SCOPES` | `spreadsheets` | Sheets |
| `GOOGLE_SLIDES_SCOPES` | `presentations` | Slides |
| `GOOGLE_DOCS_SCOPES` | `documents` | Docs |

## Connection Broker

`connection-broker.ts` is a singleton facade over all OAuth connections. Integration clients
use `getConnectionBroker().getServiceClient(provider)` to obtain an authenticated `fetch`
wrapper — the broker injects the `Authorization` header and any provider-specific headers
(e.g., `Notion-Version`), and serialises concurrent token refreshes with a per-provider mutex.

```
Integration client → getServiceClient(provider) → authenticated fetch wrapper
                                 ↓ (if expired)
                          refreshWithLock() → mutex → refreshGoogleToken() → token store
```

Key exports: `getConnectionBroker()`, `initConnectionBroker()`, `ConnectionRevokedError`.

## Background Services

Both services are started at server startup (after config load) and stopped on shutdown:

### Token Refresh Service (`token-refresh-service.ts`)

Proactively refreshes expiring access tokens before they expire:
- Runs every **15 minutes**
- Refreshes tokens expiring within the next **20 minutes**
- After **3 consecutive failures**, marks the connection as `expired`
- **Google** — refreshed via Google's `oauth2.googleapis.com/token` endpoint
- **Site** — refreshed via Supabase's `POST /auth/v1/token?grant_type=refresh_token` REST endpoint (10s timeout); rotated refresh tokens are persisted
- Slack/Notion tokens are long-lived and do not need refresh

### Connection Health Monitor (`connection-health-monitor.ts`)

Detects externally revoked tokens via lightweight API heartbeats:
- Runs every **30 minutes** (first check deferred 5s after startup)
- **Google** — `GET /oauth2/v3/userinfo`; attempts one refresh on 401 before marking revoked
- **Slack** — `POST auth.test`; marks revoked if `ok: false`
- **Notion** — `GET /v1/users/me`; marks revoked on 401/403

## Integration Clients

Located in `src-api/src/shared/integrations/`. Each client uses
`getConnectionBroker().getServiceClient(provider)` to obtain a fresh authenticated fetch wrapper.

### Google

| Module | Key Operations |
|--------|----------------|
| `google/gmail.ts` | List/search/send messages, get message, get unread count |
| `google/calendar.ts` | List calendars, list/get/create events, today's schedule |
| `google/drive.ts` | List/search/get files, CRUD (create/copy/move/trash), comments, permissions, revisions |
| `google/photos.ts` | Photos Picker session management, list picked items |
| `google/meet.ts` | Create/get/update Meet spaces, conference records, participants, recordings, transcripts |
| `google/tasks.ts` | Task lists and tasks CRUD (list, get, create, update, complete, delete) |
| `google/contacts.ts` | Personal contacts (list/get/search/create/update) + Workspace directory search |
| `google/sheets.ts` | Get/create spreadsheets, read/write/append values, add sheets |
| `google/slides.ts` | Get presentations, read text, create presentations, add slides |
| `google/docs.ts` | Get/create documents, read text, insert/replace text |

### Slack (`slack/client.ts`)

Post messages, list channels, get user info, upload files, send DMs.

### Notion (`notion/client.ts`)

Search pages/databases, read/write page properties, read block children.

## WebUI JWT Auth (Remote Access Mode)

When the API server is started with `--webui` (or `WEBUI_MODE=true`), a second auth layer activates for browser-based access. This is entirely separate from the site/OAuth auth layer above and is designed for self-hosted or remote access scenarios.

### Architecture

```
Browser Client
    │
    ├── POST /auth/jwt/setup   (first-run password setup)
    ├── POST /auth/jwt/login   (password → accessToken + refreshToken)
    ├── POST /auth/jwt/refresh (rotate refresh token)
    └── Authorization: Bearer <accessToken>
                              │
                    jwtMiddleware (active only in --webui mode)
                              │
                     all /api/* routes
```

### Configuration

| Setting | Description |
|---------|-------------|
| `--webui` flag | Enables WebUI static serving + activates JWT middleware |
| `--remote` flag | Binds to `0.0.0.0` (all interfaces) instead of `localhost`; logs security warning if auth not enabled |
| `WEBUI_AUTH=true` | Required to enforce JWT auth; without it, `--webui` serves unauthenticated |
| `WEBUI_JWT_SECRET` | Optional — auto-generated on first start and persisted to settings DB |
| `WEBUI_CORS_ORIGINS` | Comma-separated origins allowed in remote mode |
| `--resetpass` | CLI flag to reset the WebUI password (reads from `WEBUI_PASSWORD` env var or prompts) |

### Token Lifecycle

- **Access token**: 15-minute TTL, signed HS256 JWT
- **Refresh token**: 7-day TTL, rotation on every refresh call
- **Storage**: Refresh tokens stored in `webui_sessions` table (migration 017)
- **Theft detection**: Token-family model — if a previously-rotated refresh token is replayed, the entire family is revoked and a 401 is returned

### Desktop Mode (No JWT)

In normal Tauri desktop mode, `jwtMiddleware` is a no-op (skipped entirely when `WEBUI_AUTH !== 'true'`). The `/auth/jwt/*` routes are still mounted for completeness but auth is not enforced.

### Files

| File | Purpose |
|------|---------|
| `src-api/src/app/middleware/jwt.ts` | JWT middleware — skips auth/health routes and desktop mode |
| `src-api/src/app/api/auth-jwt.ts` | Login, refresh, setup, status endpoints |
| `src-api/src/shared/db/migrations/017_webui_sessions.ts` | Refresh token rotation table |

## API Routes

See [API Routes](api-routes.md#auth) for the full route table.

Key behavior notes:

- `POST /auth/site/login` — starts the site login flow (spawns localhost callback server, returns `authUrl`)
- `POST /auth/site/logout` — clears the site session (removes stored tokens)
- `POST /auth/:provider/initiate` — starts OAuth2 PKCE flow for integration providers; accepts
  an optional `scopes` array body for requesting additional scopes beyond the defaults
- `GET /auth/:provider/callback` — only reachable from the loopback redirect server; not a
  publicly accessible endpoint
- `DELETE /auth/:provider/disconnect` — calls the provider's revocation endpoint (if available)
  before deleting local tokens
- `GET /auth/status` — returns `{ authenticated, connections[], availableProviders[] }`;
  `authenticated` is `true` when a `site` connection is `active`
- `POST /auth/refresh/:provider` — force-refreshes tokens (supports `google` and `site`)
- `GET /auth/health` — returns cached heartbeat results; add `?refresh=true` to trigger fresh checks
- `GET /auth/health/:provider` — run an on-demand health check for a single provider
- `GET /auth/connections/:provider` — returns `{ connected, connection }` with live token-expiry check for Google

## Channel Credential Vault

Channel bot tokens are stored in an encrypted vault file (`~/.{slug}/channel-credentials.enc`)
separate from OAuth integration tokens. The vault uses AES-256-GCM encryption with a
machine-specific key.

### configId-Based Keys

The vault is keyed by **`configId`** (the UUID `channel_config.id`), not by platform string.
This enables multiple bot tokens per platform (multi-bot support).

- **`saveChannelCredential(configId, token)`** — encrypt and persist
- **`getChannelToken(configId)`** — read from in-memory cache
- **`hasChannelCredential(configId)`** — check existence
- **`removeChannelCredential(configId)`** — delete from vault and cache
- **`mergeAndSaveCredential(configId, token)`** — merge JSON sub-fields (for Slack's
  `{ botToken, appToken }` where only one field may change), returns `VAULT_SENTINEL`

### Legacy Re-Keying

On vault initialization, `rekeyLegacyPlatformKeys()` migrates entries stored under bare
platform names (`'telegram'`, `'discord'`, `'slack'`, `'lark'`) to their `configId` UUIDs:

1. Scans the in-memory cache for keys matching known platform names
2. For each, calls `getChannelConfigsByPlatform(platform)`
3. If exactly **one** config exists for that platform, re-keys the entry
4. If multiple configs share a platform, logs a warning and skips (ambiguous)
5. Persists updated keys to disk

### SQLite Migration

`migrateFromSqlite()` migrates plaintext tokens from `channel_config.token` to the vault.
It now uses `row.id` (configId) as the vault key instead of `row.platform`, and sets
`channel_config.token = '__vault__'` after successful migration.

## Adding a New Provider

1. Add the provider to `OAuthProvider` union in `types.ts`
2. Add `CLIENT_ID` / `CLIENT_SECRET` env vars and provider config to `oauth.ts`
3. Implement the token exchange in `oauth-client.ts` (most providers follow the standard flow)
4. Add a user-info fetch in `token-manager.ts` to populate `displayName`, `accountEmail`, `avatarUrl`
5. Add a revocation call to `oauth-client.ts` (optional but recommended)
6. Add a health check function in `connection-health-monitor.ts` and register it in `PROVIDER_CHECKS`
7. Add an integration client under `integrations/<provider>/`
8. Add `VALID_PROVIDERS` entry in `auth.ts`
9. Add an `IntegrationCard` entry in `AccountSettings.tsx`

---

*See also: [Security](../security/index.md) · [API Routes](api-routes.md) · [Desktop Shell](../desktop/index.md)*
