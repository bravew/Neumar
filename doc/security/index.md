---
summary: "Security considerations — OS-level sandbox isolation, workspace boundaries, path validation, folder permissions, credential protection, CORS, OWASP mitigations for agentic applications"
read_when:
  - Reviewing security practices
  - Adding new security controls
  - Working on the Linear pipeline security
  - Understanding workspace isolation and path validation
  - Understanding sandbox filesystem boundaries
title: "Security"
---

# Security Considerations

## Workspace Isolation & Sandbox Architecture

The application enforces workspace isolation through a **multi-layer defense-in-depth** strategy, following best practices from [OWASP Top 10 for Agentic Applications (2026)](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/), [Anthropic's Secure Deployment Guide](https://platform.claude.com/docs/en/agent-sdk/secure-deployment), and [NVIDIA's Sandboxing Guidance](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/).

### Defense-in-Depth Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: API Input Validation (path-validator.ts)           │
│  Blocks system paths, traversal, null-bytes, symlink evasion │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: OS-Level Sandbox (Claude Agent SDK)                │
│  macOS Seatbelt / Linux Bubblewrap — HARD boundary           │
│  filesystem.allowWrite, denyWrite, denyRead                  │
├──────────────────────────────────────────────────────────────┤
│  Layer 3: System Prompt Boundaries                           │
│  Workspace instruction tells agent where it can operate      │
├──────────────────────────────────────────────────────────────┤
│  Layer 4: Folder Permission Consent Model                    │
│  User grants per-folder read/write via FolderPermissionDialog│
├──────────────────────────────────────────────────────────────┤
│  Layer 5: Bash Command Validation (defense-in-depth)         │
│  validateBashCommand() checks extracted paths against allowed│
└──────────────────────────────────────────────────────────────┘
```

### OS-Level Sandbox (Layer 2) — Hard Boundary

The Claude Agent SDK's native sandbox settings enforce filesystem restrictions at the OS level via **macOS Seatbelt** profiles and **Linux Bubblewrap** — this is a **hard security boundary** that the LLM cannot bypass regardless of prompt injection.

Configuration is built by `buildSdkSandboxSettings()` in `claude/index.ts` and `buildSandboxFilesystemConfig()` in `path-validator.ts`:

```typescript
sandbox: {
  enabled: true,
  autoAllowBashIfSandboxed: true,
  filesystem: {
    allowWrite: [sessionCwd, userWorkspaceDir],  // Only writable paths
    denyWrite: ['~/.ssh', '~/.aws', '~/.bashrc', '~/.zshrc', ...],
    denyRead: ['~/.ssh', '~/.aws', '~/.gnupg', '~/.git-credentials', ...],
  }
}
```

| Boundary | Paths | Enforcement |
|----------|-------|-------------|
| **Write allowed** | Session directory (`sessionCwd`), optionally user workspace | OS sandbox `allowWrite` |
| **Write denied** | Shell configs (`.bashrc`, `.zshrc`), credential dirs (`.ssh`, `.aws`) | OS sandbox `denyWrite` |
| **Read denied** | Credential stores (`.ssh`, `.aws`, `.gnupg`, `.git-credentials`, `.npmrc`) | OS sandbox `denyRead` |
| **Additional read access** | User workspace folder (via `additionalDirectories`) | Claude SDK option |

### Workspace Directory Flow

```
User selects folder ──→ Frontend sends both:
  in FolderPicker         1. workDir (session folder for file output)
                          2. userWorkspaceDir (original folder selection)
                     ──→ Backend validates paths (path-validator.ts)
                     ──→ Builds OS sandbox boundaries
                     ──→ Claude SDK enforces at kernel level
```

- **Session directory** (`workDir`): Always writable — agent output goes here
- **User workspace** (`userWorkspaceDir`): Read-only by default; writable when `allowWorkspaceWrite=true`
- System-wide searches (`find /Users`, `find /home`, `find /tmp`) are **blocked by the OS sandbox**

### Credential Protection

Sensitive paths are explicitly denied at the OS level to prevent exfiltration via prompt injection:

| Blocked Path | Risk |
|-------------|------|
| `~/.ssh` | SSH keys, known_hosts |
| `~/.aws` | AWS access keys |
| `~/.azure` | Azure CLI credentials |
| `~/.config/gcloud` | Google Cloud ADC tokens |
| `~/.gnupg` | GPG keys |
| `~/.git-credentials` | Git passwords/tokens |
| `~/.npmrc`, `~/.pypirc` | Package registry tokens |
| `~/.netrc` | FTP/HTTP credentials |
| `~/.docker/config.json` | Docker registry auth |
| `~/.kube/config` | Kubernetes cluster credentials |

### Slack App Home Secret Box

Slack App Home personal credentials and per-user MCP headers use the `secret-box.ts` envelope-encryption helper instead of the older single-key stores:

- **KEK**: derived with PBKDF2 from `hostname + username + nonce`; salt and nonce are stored in the `settings` table under `secret_box_kek_salt` and `secret_box_kek_nonce`.
- **DEK**: a random 32-byte key generated per Slack user link. The DEK is wrapped with the KEK and stored on `slack_user_links`.
- **Per-record secrets**: personal tokens in `slack_user_oauth` and MCP headers/env in `slack_user_mcp` are encrypted with the unwrapped per-user DEK using AES-256-GCM.
- **Crypto-shredding**: disconnecting a Slack user deletes the link row and its wrapped DEK, making dependent ciphertext unrecoverable even if a backup or in-flight copy remains.

The KEK seed intentionally binds to the local desktop host and OS user. If either changes, wrapped DEKs cannot be recovered; this matches the desktop/sidecar deployment target but should be revisited before containerized or multi-host deployments.

## Phase 7 Security Control Plane

Phase 7 adds a cross-cutting security layer for sandbox capability reporting,
network egress validation, tool-output defense, canary leak detection, and
redacted audit storage.

### Security Sessions and Canaries

`createSecuritySession()` creates a per-run security context with:

- `sessionId` and optional `taskId` for audit correlation
- optional `profileId` for the network policy in force
- a per-session canary token in the form `NEUMA-CANARY-<session>-<random>`
- an audit recorder bound to the same ids

The raw canary token is treated as a secret. Audit records store only a short
fingerprint. Canaries are scanned in outbound safe-fetch requests, tool-call
arguments, and model output streams. On detection, the relevant path blocks and
records a redacted critical event.

### Network Policy and Safe Fetch

`network-policy/schema.ts` defines a versioned policy DSL with default
allow/deny behavior, egress rules by host/port/method/path, DNS private-address
controls, an explicit localhost development exception, and audit settings.

`safeFetch()` is the required fetch boundary for untrusted or user-controlled
URLs. It validates every hop immediately before connect, resolves and classifies
all DNS answers, rejects private and cloud metadata addresses by default, pins
the connection to the validated IP, follows redirects manually, and re-validates
each redirect target.

The plugin marketplace registry fetch path uses `safeFetch()` with a trusted
local policy so public registries can load while DNS rebinding and redirect
smuggling remain blocked.

Cloud storage personal-media connections use a narrower URL policy in
`src-api/src/shared/integrations/cloud-storage/personal-media/url-policy.ts`.
Self-hosted Immich and PhotoPrism can explicitly use LAN hosts, `localhost`,
`.local`, or Tailscale `.ts.net` names, while metadata hosts, embedded
credentials, blocked/link-local IPs, unsupported protocols, and non-HTTPS public
URLs are rejected. Immich requests use manual redirect handling so redirects do
not silently bypass the desktop policy.

### Tool Output Defense

Tool and MCP outputs are normalized and inspected before they re-enter provider
messages. `defendToolOutput()` performs Unicode normalization, zero-width and
bidi-control stripping, hidden HTML removal, deterministic prompt-injection rule
checks, suspicious encoded-payload inspection, and verdict selection:
`ALLOW`, `WARN`, `HITL_REQUIRED`, or `BLOCK`.

Allowed and warned outputs are wrapped in a structural
`<<<NEUMA_TOOL_OUTPUT ...>>>` envelope before model re-entry. Blocked and
human-review-required outputs are replaced with placeholders. OpenAI-compatible
and Claude PTC adapters apply this before the next model turn consumes tool
results; Codex applies it at the display boundary because Codex owns its
internal tool loop.

### Redacted Security Audit

Security events are written to two redacted sinks:

- SQLite `security_events` for in-app review and correlation
- JSONL at `~/<APP_DATA_DIR>/security/events.jsonl` for durable export

Network decisions use a separate `network_policy_audit` table so high-volume
egress decisions do not drown out higher-level security events. Raw sensitive
payloads are never persisted; records carry payload hashes, redacted snippets,
and redacted metadata.

## Tool Permission & Safety Layer

The agent system includes a multi-layer safety pipeline for tool execution control, implemented in `src/core/agent/`.

### Tool Permission Registry

`ToolPermissionRegistry` classifies every tool by risk (`read`, `write`, `execute`, `destructive`, `network`) and evaluates user-configured rules:

- **alwaysAllow** — auto-approve matching tools (supports patterns like `"Bash(npm test)"`)
- **alwaysDeny** — block unconditionally
- **alwaysAsk** — always prompt user approval

Evaluation order: deny → ask → allow → classification default → allow.

### Dangerous Pattern Detection

`dangerous-patterns.ts` performs static analysis on Bash commands and file operations:

- **Block-severity patterns:** `rm -rf`, `dd if=/dev/`, `mkfs`, credential exfiltration (`curl -d @~/.ssh/`)
- **Warn-severity patterns:** `chmod 777`, `sudo`, `kill -9`, `chown root`
- **Sensitive write paths:** `/etc/`, `/usr/`, `/sys/`, `/boot/`, `~/.ssh/`, `~/.aws/`, `~/.gnupg/`
- Risk levels displayed in the permission dialog UI

### Denial Tracking

`DenialTracker` prevents agents from repeatedly requesting denied operations:

- Tracks denials per `toolName:inputSummary` key
- After 3 denials, injects guidance into the system message suggesting alternative approaches
- Scoped per session; cleared on session end

### Tool Lifecycle Hooks

`ToolLifecycleHookRunner` intercepts tool execution with pre/post hooks:

- Pre-hooks can `allow`, `deny`, or `modify` tool inputs
- Post-hooks run asynchronously for logging/auditing
- Fail-open design: hook errors don't block execution
- Integrates with Claude Agent SDK via `toSdkHooks()`
- Hook definition: `{ event, matcher?, handler, priority?, async? }`
- Matcher is a regex pattern (e.g. `"Write|Edit"`, `"Bash"`)
- SDK integration converts hooks to `HookCallbackMatcher` format

### Auto-Classifier (Feature-Flagged)

`safety/auto-classifier.ts` provides an independent AI-based safety review (second opinion) for tool calls:

- **Two-stage pipeline:** Stage 1 (fast, 2s timeout, 50 tokens) → Stage 2 (deep, 5s timeout, 500 tokens, only if Stage 1 is ambiguous)
- Uses Claude Haiku model for cost efficiency (~$0.001 per classification)
- LRU cache (500 results per session) avoids re-classifying identical calls
- Feature-flagged (off by default) — enabled via `autoClassifierEnabled` setting
- Fails open: classifier failures never block tool execution
- Risk categories: destructive ops, credential exposure, system modification, network exfiltration, resource exhaustion
- Decision outcomes: `allow`, `deny`, `warn` (escalates to permission request)

### Tool Result Limiter

`tool-result-limiter.ts` truncates oversized tool outputs to protect frontend and DB. The SDK handles model-side truncation (50K per-tool, 200K per-message) independently.

| Tool | Display Limit |
|------|--------------|
| Bash | 50,000 chars |
| Grep | 30,000 chars |
| Glob | 20,000 chars |
| Read | 100,000 chars |
| WebFetch | 50,000 chars |
| Default | 50,000 chars |

Truncated output appends: `[Output truncated for display. Full output available in workspace.]`

### Error Retry with Backoff

`error-retry.ts` provides categorized retry strategies with jittered exponential backoff:

| Status Code | Retries | Backoff | Strategy |
|-------------|---------|---------|----------|
| 429 (rate limit) | 5 | 2–60s | Aggressive |
| 500/502/503 (server) | 3 | 1–32s | Standard |
| 401 (auth) | 0 | — | Fail immediately |
| 400 (bad request) | 0 | — | Fail immediately |
| Default | 2 | 1–16s | Conservative |

Jitter formula: `baseDelay * (0.5 + random * 0.5)` — prevents thundering herd. Accepts `AbortSignal` for session teardown.

### File State Cache

`file-cache.ts` provides an LRU cache for file content with mtime-based invalidation:

- Max 500 entries, 30-minute TTL
- Validates mtime on get — auto-evicts stale entries
- Pattern-based invalidation: `*path*`, `prefix*`, `*suffix`
- Cloneable for sub-agent sharing (no mutable state leakage)
- Automatically invalidated on Write/Edit operations

### Worktree Isolation

`worktree.ts` manages git worktrees for safe agent experimentation:

- `createWorktree(repoPath, branchName)` → `{ worktreePath, branch }`
- `removeWorktree(repoPath, worktreePath, deleteBranch?)`
- `mergeWorktree(repoPath, branchName, targetBranch?)`
- `listWorktrees(repoPath)`, `hasChanges(worktreePath)`
- All paths shell-escaped via `execFile` to prevent injection
- Branch names sanitized (alphanumeric, hyphens, underscores only)
- Located in `$TMPDIR` for automatic cleanup
- Limitation: shared `.git` directory limits to 1 worktree per repo

### Context Resolver

`context-resolver.ts` is the single source of truth for system context assembly. All DB reads happen here, never in adapters.

**Context tiers:**
1. Runtime: date/time, timezone, locale, platform, geolocation
2. Workspace: working directory boundary
3. Language: response language preference
4. Profile: agent profile soul OR legacy role + system_prompt
5. Preferences: global user preferences (from DB)
6. Memories: auto-recalled long-term memories (semantic search)
7. Search: search service availability hint

**Prompt caching split:**
- Static context (cache-stable): workspace + language + profile + prefs + search hint
- Dynamic context (per-turn): runtime timestamp + memories

**Minimal context** (for sub-agents/A2A delegates): layers 1–3 only.

### OWASP Alignment

| OWASP Risk | Mitigation |
|------------|----------------|
| **ASI02: Tool Misuse** | Permission registry classifies tools by risk; dangerous patterns blocked; auto-classifier provides AI second opinion |
| **ASI03: Privilege Abuse** | Denial tracker prevents retry loops; lifecycle hooks enforce approval; per-session permission scoping prevents leakage |
| **ASI04: Excessive Agency** | User approval required for execute/destructive/network tools; tool result limiter prevents context overflow |

## General Security

| Area | Approach |
|------|----------|
| **Workspace isolation** | OS-level sandbox (macOS Seatbelt / Linux Bubblewrap) enforces hard filesystem boundaries; per-task `workDir` validated by `path-validator.ts` |
| **Path validation** | `validateWorkDir()` blocks `..` traversal, OS-aware system paths (POSIX: `/etc`, `/usr`, `/sys`; Windows: `C:\Windows`, `C:\Program Files`), resolves symlinks, and expands `~` |
| **Sandbox filesystem** | `buildSandboxFilesystemConfig()` generates `allowWrite`/`denyWrite`/`denyRead` rules passed to Claude SDK's native sandbox |
| **Bash command validation** | `validateBashCommand()` extracts paths from filesystem commands and validates against allowed directories (defense-in-depth) |
| **Folder permissions** | Cowork-style consent model: users grant per-folder read/write via `FolderPermissionDialog`; permissions stored in `settings.allowedFolders`; non-"alwaysAllow" permissions reset on app restart; delete operations always require explicit per-operation consent |
| **Backup policy** | Agents must backup files before destructive operations |
| **Read-before-write** | Agents must read files before modifying them |
| **File system scoping** | Tauri restricts FS access to explicit paths (`~/.<slug>`, `~/.claude`, user directories) |
| **Process sandboxing** | Shell permissions limited to specific sidecar binaries |
| **Local-only API** | API server binds to localhost only (not exposed to network) |
| **CORS** | Origin allowlist (Vite dev, Tauri webview, production API) — unknown origins rejected |
| **Body limit** | 10 MB request body limit prevents oversized payloads |
| **Input validation** | Zod schemas on all agent routes via `@hono/zod-validator` — rejects malformed requests with 400 |
| **Network policy** | `safeFetch()` validates every redirect hop, pins DNS results to the validated IP, scans canaries, and audits allow/deny/timeout decisions |
| **macOS entitlements** | Minimal JIT/memory permissions for Node.js V8 engine |
| **macOS signing** | Code signing + notarization for distribution builds |
| **File access roots** | `getAllowedRoots()` recomputes trusted roots per-request (user home, app dir, configured `workDir`, temp dir, `/Volumes/` on macOS) so that `workDir` changes take effect without server restart; `isAllowedPath()` validates every resolved path against these roots |
| **Header injection** | File download proxy sanitizes filenames: `decodeURIComponent()` + strip quotes, CR/LF, null bytes, and non-ASCII (`/["\r\n\x00-\x1f\x7f-\uffff]/g` → `_`) to prevent HTTP header injection via `Content-Disposition` |
| **Fetch timeout** | External proxy downloads (`/files/proxy`) enforce a 30-second `AbortSignal.timeout` to prevent hanging connections |
| **Security audit** | `security_events` and `network_policy_audit` store redacted event summaries and payload hashes; raw secrets and full sensitive payloads are not persisted |
| **API key handling** | Keys stored in Stronghold encrypted vault (`~/.neumar/vault.hold`); never written to SQLite or localStorage; vault password held in OS keychain (macOS Keychain / Windows Credential Manager / libsecret); passed to backend via environment variables at runtime (never logged) |
| **Site authentication** | Primary auth via companion website (neumar.app) using Supabase; session tokens transferred via auto-submitting HTML form POST to localhost (never in URL bar or browser history); callback port validated 1–65535; cookie uses `secure` flag on HTTPS, `httpOnly`, short-lived (10 min) |
| **Site token refresh** | Supabase access tokens refreshed proactively via REST API (`POST /auth/v1/token`); rotated refresh tokens persisted; 10-second request timeout prevents hanging; Supabase URL and anon key are public values stored in settings DB |
| **OAuth token storage** | OAuth tokens (access + refresh) encrypted at rest with AES-256-GCM (per-file unique IV, 32-byte random salt, PBKDF2-SHA512 × 100K iterations); token files use `0o600` permissions; raw tokens are never sent to the frontend |
| **PKCE flow** | OAuth2 Authorization Code + PKCE (`S256` challenge method) prevents authorization code interception; CSRF `state` parameter validated on callback |
| **Loopback redirect** | OAuth callbacks use a temporary localhost HTTP server on a random port; server shuts down immediately after receiving the code; POST body size limited to 64 KB |
| **Token refresh** | Automatic background token refresh before expiry (Google + site sessions); expired connections marked without blocking the UI |
| **Keychain integration** | Sensitive client-side values stored in macOS Keychain / Windows Credential Store via Tauri keychain plugin |
| **Error boundary** | Root-level `react-error-boundary` catches unhandled React errors with recovery UI |
| **Error markers** | Special error codes (`__API_KEY_ERROR__`, `__CLAUDE_CODE_NOT_FOUND__`) for safe UI display |
| **Session cleanup** | BaseAgent periodically evicts idle sessions (1 hr TTL, 5 min sweep) to prevent memory leaks |
| **Memory safety** | Prompt injection guard rejects malicious patterns in stored memories; XML escaping prevents instruction injection; recalled memories wrapped with "untrusted data" safety prefix; capacity limits with LRU eviction |

## OWASP Top 10 for Agentic Applications (2026) Mitigations

| OWASP Risk | Mitigation |
|------------|------------|
| **ASI01: Agent Goal Hijack** | Prompt injection defense — ticket content sanitized (10K char limit), `<system-instruction>` / `<user-input>` XML delimiters separate trusted and untrusted content |
| **ASI02: Tool Misuse** | OS-level sandbox restricts filesystem access; `buildSandboxFilesystemConfig()` enforces write boundaries; system prompt explicitly lists allowed paths |
| **ASI03: Privilege Abuse** | No auto-merge (human required), scoped git operations, config redaction in API responses; credential paths denied at OS level |
| **ASI04: Excessive Agency** | Workspace boundaries prevent system-wide searches; agent confined to session dir + user workspace; `additionalDirectories` grants minimal read access |
| **ASI05: Unexpected Code Execution** | Verification loop (lint + tsc, max 3 retries) before PR creation; sandbox `denyWrite` blocks shell config modification |
| **ASI06: Insufficient Sandboxing** | OS-level enforcement (macOS Seatbelt / Linux Bubblewrap) — not just prompt-based; `denyRead` blocks credential stores |
| **ASI08: Cascading Failures** | Per-phase timeouts (`AbortSignal.any()`), total pipeline timeout (60 min), graceful shutdown |
| **ASI09: Human Trust Exploitation** | Agent never auto-merges; Slack notification explicitly requests human review |

## Channel Security

The channel plugin system handles files and credentials from external messaging platforms, requiring dedicated security controls.

### Path Traversal Prevention

User-controlled filenames from Slack file attachments and voice clips are sanitized before local storage:

```typescript
const safeName = path.basename(origName);  // Strip directory components
const localPath = path.join(tmpDir, `${crypto.randomUUID().slice(0, 8)}-${safeName}`);
```

- Only `path.basename()` of user-provided filename used — blocks `../` traversal
- UUID prefix prevents collision attacks
- Temp directories: `/tmp/neuma-slack-files` (file attachments), `/tmp/neuma-voice` (voice clips)

### Token Leakage Prevention

Slack bot tokens must not leak to untrusted CDN hosts during file download redirects:

- **Host allowlist**: Authorization header attached only to Slack-owned domains (`files.slack.com`, `slack-files.com`, `slack-edge.com`, `slack.com`)
- **Manual redirect handling**: `redirect: 'manual'` on initial fetch; redirect `Location` followed without auth (pre-signed CDN URLs don't need it)
- Prevents WHATWG-spec cross-origin auth stripping from causing failures, while also preventing credential exposure to third-party CDNs

### SSRF Protection for Attachments

Image attachments from channel messages are downloaded with SSRF protections:

```typescript
const ALLOWED_ATTACHMENT_HOSTS = new Set([
  'cdn.discordapp.com', 'media.discordapp.net',
  'api.telegram.org', 'files.slack.com',
]);
```

- Explicit hostname allowlist — blocks requests to internal networks
- Content-Type verification rejects HTML auth pages (detects Slack/Discord login redirects)
- Max attachment size: 10 MB

## Gateway Security

The multichannel gateway introduces external user input from untrusted messaging platforms and applies a dedicated security pipeline:

- **Prompt injection defense** — Inbound messages are wrapped with explicit boundary markers (`--- BEGIN GATEWAY MESSAGE ---` / `--- END GATEWAY MESSAGE ---`) before being passed to the agent, following OWASP ASI01 mitigation.
- **Identity-based access control** — Every inbound message is resolved to a `GatewayIdentity` with a `permission_tier` (`viewer` / `operator` / `admin`). Unauthenticated users are rejected or assigned a configurable default tier.
- **Rate limiting** — Sliding-window limiter (default: 20 msg/min per identity, 10 auth attempts/min) with configurable lockout periods. Implemented in-memory in `shared/auth/rate-limiter.ts`.
- **Token budget enforcement** — Daily token budgets per identity with configurable reset time, warning threshold, and `enforce` vs `warn-only` modes.
- **Concurrency gate** — Maximum concurrent agent runs per identity (default: 3) prevents resource exhaustion.
- **Guardrails** — Optional content moderation layer (`none` / `anthropic` / `llm-guard`) with `failMode: open|closed`.
- **Message deduplication** — Unique index on `(channel_id, channel_message_id)` prevents replay attacks from channel APIs.
- **Admin API localhost-only guard** — All `/gateway/*` routes reject requests with non-localhost `Host` headers (same pattern as `/db` routes).
- **Secret redaction in API responses** — Channel configs served via `GET /gateway/channels/:id/config` redact sensitive fields (tokens, passwords, keys) matching a regex pattern.
- **SSRF protection on webhook URLs** — Telegram webhook and SMS webhook URLs are validated against private IP ranges, cloud metadata hostnames, and non-HTTPS schemes before being accepted.
- **Audit log** — All admin actions (config changes, identity create/delete, permission changes) are written to `gateway_audit_log` with identity and timestamp.

## ACP / A2A and Web Remote Security

The remote protocol surfaces are intentionally narrow in Phase 6:

- **Bearer JWT auth** — `POST /acp/a2a`, `WS /acp/ws`, and `/remote/*` require tokens signed with `WEBUI_JWT_SECRET`.
- **Boot-time token invalidation** — ACP rejects tokens with `iat < NEUMA_BOOT_AT`, so restarting the daemon invalidates tokens issued before the current process boot.
- **Per-identity RPC limits** — ACP JSON-RPC calls use `acpRpcLimiter` keyed by identity. HTTP returns `429` plus `Retry-After`; WebSocket returns JSON-RPC `-32029`.
- **Public discovery only** — `/.well-known/agent-card.json` is unauthenticated for A2A discovery and exposes active agent profile IDs, names, roles, and descriptions. Operators exposing non-loopback listeners should treat this metadata as public.
- **Read-only remote mode** — `/remote/*` is mounted only when `NEUMA_REMOTE_UI` is `read-only` or `interactive`; in Phase 6.0 mutating verbs return `405`, and the SSE stream closes on terminal task events or after 30 minutes.

## Daemon Supervisor Security

The desktop daemon commands install OS-native supervisors and therefore enforce template hygiene before writing launchd, systemd, or Task Scheduler files:

- **Label validation** — Supervisor labels must be 1–128 chars and match `[A-Za-z0-9._-]+`.
- **Sidecar path validation** — `sidecar_path` must be absolute, must not have leading/trailing whitespace, and must not contain control characters.
- **Template escaping** — launchd and Task Scheduler XML escape inserted values; systemd quotes `ExecStart` and escapes `%`, backslash, and double quotes.
- **No shell interpolation** — Platform control commands use `Command::new().args([...])` arrays and run through `tauri::async_runtime::spawn_blocking`.
- **Log scope** — `daemon_logs_tail` only reads `~/.neumar/logs/sidecar.log` and clamps requests to 1–5000 lines.

## Linear Pipeline Security

The autonomous pipeline introduces additional security controls:

- **Encrypted config storage** — API keys, tokens, and secrets encrypted at rest using AES-256-GCM with per-field unique IVs. Key derivation: async `crypto.pbkdf2()` with SHA-512, 32-byte random salt, 100,000 iterations. Config file permissions: `0o600` on Unix/macOS.
- **Webhook verification** — `LinearWebhookClient.verify(body, signature, timestamp)` from `@linear/sdk/webhooks` handles HMAC-SHA256 on raw bytes, timing-safe comparison, and replay protection.
- **Webhook IP allowlisting** — Requests validated against Linear's published source IPs as an additional layer beyond signature verification.
- **Raw body preservation** — Webhook handler reads body via `c.req.text()` before JSON parsing to preserve exact bytes for signature verification.
- **Targeted git staging** — Sensitive file pattern filtering (`.env`, `credentials`, `.secret`, `.key`, `.pem`) prevents accidental credential commits.
- **Config redaction** — `GET /linear/config` only returns last 4 characters of secret fields.
- **Graceful shutdown** — Active pipelines are aborted and state persisted on SIGTERM/SIGINT.
- **State persistence** — Pipeline state survives API restarts via `pipeline-state.json`.

## API Key Storage

Provider API keys (Anthropic, OpenAI, OpenRouter, etc.) use a two-layer security model that keeps keys out of every on-disk database and browser storage.

### Security chain

```
OS login
  └─ OS Keychain  (macOS Keychain Services / Windows Credential Manager / libsecret)
       └─ Vault password  (32-byte random hex, generated once per device)
            └─ Stronghold vault  (~/.neumar/vault.hold, AES-256-GCM at rest)
                 └─ API keys  (one entry per provider: api_key_{providerId})
```

### Why two layers?

A single encrypted file with the key stored next to it ("key under the doormat") provides minimal protection — both artifacts share the same filesystem permissions. Storing the vault password in the OS keychain means it is protected by a separate OS-managed access control boundary, requiring OS authentication (user login / Touch ID / Windows Hello) to retrieve.

### Storage locations — what goes where

| Store | Contains | Does NOT contain |
|-------|----------|-----------------|
| `~/.neumar/vault.hold` | API keys (AES-256-GCM encrypted) | vault password |
| OS Keychain | vault password | API keys |
| SQLite (`neumar.db`) | all other settings | API keys |
| localStorage (`neumar_settings`) | all other settings (stripped) | API keys |

### Implementation

| File | Role |
|------|------|
| `src/shared/lib/stronghold.ts` | Vault lifecycle, `setApiKey` / `getApiKey` / `mergeProviderKeys` / `persistProviderKeys`; auto-recovery from vault corruption (`BadFileKey` / `decode/decrypt` errors → delete and recreate vault file) |
| `src/shared/lib/keychain.ts` | OS keychain wrapper (vault password storage) |
| `src/shared/db/settings.ts` | Calls `persistProviderKeys` on save; calls `mergeProviderKeys` on async load; `stripApiKeysForStorage` removes keys before any DB/localStorage write |
| `src-tauri/src/lib.rs` | Registers `tauri_plugin_stronghold::Builder::with_argon2` (Argon2id key derivation) |
| `src-tauri/capabilities/default.json` | Grants `stronghold:*` permissions to the WebView |

### Threat model

| Threat | Protection |
|--------|------------|
| XSS / JS injection reads localStorage | ✅ Keys never in localStorage |
| `sqlite3 neumar.db` inspection | ✅ Keys never in SQLite |
| Disk image / backup of `~/.neumar/` | ✅ Vault is encrypted; vault password is not on disk |
| Targeted malware reads `~/.neumar/` | ✅ Vault encrypted; attacker also needs OS keychain access |
| Process running as same OS user | ⚠️ Can access OS keychain if user is logged in (same threat model as 1Password, VS Code, Slack) |
| Physical access with disk removed | ✅ Key not recoverable without both vault file and OS keychain |
| Vault file corruption / truncation | ✅ Auto-recovery: detects `BadFileKey`/`decode/decrypt` errors, deletes corrupt file, recreates fresh vault (keys re-entered by user) |

## Key Files

| File | Purpose |
|------|---------|
| `src-api/src/shared/utils/path-validator.ts` | Path validation, sandbox filesystem config, bash command validation |
| `src-api/src/extensions/agent/claude/index.ts` | Claude SDK integration with `buildSdkSandboxSettings()`, permission flow, canUseTool chain |
| `src-api/src/core/agent/base.ts` | Workspace instruction generation with boundary info |
| `src-api/src/core/agent/types.ts` | `userWorkspaceDir` and `allowWorkspaceWrite` options |
| `src-api/src/core/agent/safety/auto-classifier.ts` | AI-based safety review (two-stage classification, feature-flagged) |
| `src-api/src/core/agent/safety/dangerous-patterns.ts` | Regex-based dangerous command/path detection |
| `src-api/src/core/agent/denial-tracker.ts` | Denial dedup and fallback guidance after 3 denials |
| `src-api/src/core/agent/tool-permission-registry.ts` | Rule-based allow/deny/ask evaluation with pattern matching |
| `src-api/src/core/agent/tool-lifecycle-hooks.ts` | Pre/post tool-use hook runner with SDK integration |
| `src-api/src/core/agent/tool-result-limiter.ts` | Output truncation for frontend display |
| `src-api/src/core/agent/permission-rules.ts` | Persistent permission rule storage (load/save from DB) |
| `src-api/src/core/agent/error-retry.ts` | Categorized retry with jittered backoff |
| `src-api/src/core/agent/file-cache.ts` | LRU file content cache with mtime invalidation |
| `src-api/src/core/agent/worktree.ts` | Git worktree management for safe experimentation |
| `src-api/src/core/agent/context-resolver.ts` | Centralized system context assembly (single DB read point) |
| `src-api/src/app/api/agent.ts` | API endpoint validation and authorization |
| `src-api/src/app/api/doctor.ts` | System health diagnostics with actionable recommendations |

---

*See also: [Sandbox System](../backend/sandbox.md) · [Auth System](../backend/auth.md) · [Linear Pipeline](../backend/linear-pipeline.md) · [Multichannel Gateway](../backend/gateway.md) · [Desktop Shell](../desktop/index.md) · [Design Decisions](../system/design-decisions.md)*
