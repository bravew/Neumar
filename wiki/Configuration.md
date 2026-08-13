# Configuration

This page covers all configuration surfaces: branding, MCP servers, provider settings, environment variables, and application settings stored in SQLite.

---

## Branding

The app is white-label ready. The active brand is defined in `branding.json` at the project root.

### `branding.json` structure

```json
{
  "displayName": "Neuma",
  "slug": "neuma",
  "identifier": "ai.neuma.app",
  "tagline": "Your Tireless AI Workhorse",
  "theme": {
    "primaryColor": "oklch(0.45 0.18 30)",
    "primaryColorDark": "oklch(0.65 0.16 30)"
  },
  "api": {
    "binaryName": "neuma-api"
  }
}
```

| Field | Usage |
|---|---|
| `displayName` | Window title, about screen |
| `slug` | App data directory name (`~/.<slug>/`) |
| `identifier` | macOS bundle ID, Windows App ID |
| `tagline` | Shown on the home / welcome screen |
| `theme.primaryColor` | CSS custom property (light mode) |
| `theme.primaryColorDark` | CSS custom property (dark mode) |
| `api.binaryName` | Compiled sidecar binary filename |

### Managing brands

```bash
# Switch to a custom brand
pnpm brand:sync -- --brand=mybrand

# Validate brand configuration (CI check)
pnpm brand:check
```

Custom brand folders live at `branding/<slug>/` and are gitignored. The default brand is at `branding/default/` and is tracked.

---

## MCP Server Configuration

### App-specific MCP servers
Path: `~/.<slug>/mcp.json`

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@org/my-mcp-server"],
      "env": {
        "API_KEY": "secret"
      }
    }
  }
}
```

### Claude Code shared servers
Path: `~/.claude/settings.json`

Uses the same `mcpServers` format. These servers are shared with the Claude Code CLI and loaded by Neuma automatically.

The API watches both files for changes in development mode.

---

## Provider Configuration

AI provider settings are stored in the `settings` table in SQLite and managed via **Settings → Providers** in the UI.

| Setting Key | Description |
|---|---|
| `activeProvider` | Active agent: `claude` / `codex` / `deepagents` |
| `anthropicApiKey` | Anthropic API key (if not using Claude CLI auth) |
| `openaiApiKey` | OpenAI API key |
| `claudeCodePath` | Override Claude Code CLI path |

---

## Application Settings (SQLite)

All persisted settings live in the `settings` table as key-value pairs:

| Key | Type | Description |
|---|---|---|
| `workDir` | `string` | Default workspace directory |
| `language` | `string` | UI language code |
| `theme` | `string` | `light` / `dark` / `system` |
| `activeProvider` | `string` | Active AI provider |
| `memoryEnabled` | `boolean` | Long-term memory on/off |
| `embeddingProvider` | `string` | `local` / `openai` / `gemini` |
| `speechProvider` | `string` | `openai` / `deepgram` / `local` |
| `linearEnabled` | `boolean` | Linear pipeline on/off |

Settings are read/written by the API via `getSetting()` / `setSetting()`:

```typescript
import { getSetting, setSetting } from '@/shared/db/operations';

const workDir = getSetting('workDir') ?? process.cwd();
setSetting('workDir', '/Users/me/projects');
```

---

## Port Configuration

| Port | Service | Configurable? |
|---|---|---|
| `3420` | Vite dev server | Yes (`VITE_PORT` env var) |
| `5126` | Dev API server | Yes (`PORT` env var) |
| `1421` | Vite HMR WebSocket | No |
| `2620` | Production sidecar | No |

---

## Environment Variables

The API server reads these at startup. None are required for basic operation.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5126` | API server port (dev) |
| `NODE_ENV` | `development` | `development` / `production` |
| `LOG_LEVEL` | `info` | Log verbosity |

**Important:** Never use environment variables to store secrets in production — use the encrypted settings in the `settings` table or the encrypted JSON files (`linear.enc.json`, OAuth token files).

---

## Linear Pipeline Configuration

Configuration is encrypted at rest. Set it via **Settings → Linear Pipeline** in the UI, or via the API:

```
POST /linear/config
{
  "apiKey": "lin_api_...",
  "webhookSecret": "wh_...",
  "teamId": "TEAM-ID",
  "labelFilter": "ready-for-dev",
  "githubToken": "ghp_...",
  "slackWebhookUrl": "https://hooks.slack.com/...",
  "workspaceDir": "/Users/me/myrepo"
}
```

The config is stored as AES-256-GCM encrypted JSON in `~/.<slug>/linear.enc.json`.

---

## Workspace Selection

The workspace is the root directory where agents generate files. It is set during first run and can be changed in **Settings → Workspace**.

All agent file operations are **sandboxed to this directory** — the path validator blocks `..` traversal, OS paths, and symlinks pointing outside the workspace.

---

## Further Reading

- [[Architecture]] — Application data layout
- [[MCP Integration]] — MCP server config format
- [[Security]] — Encryption details
- [[Linear Pipeline]] — Pipeline configuration
- [[Getting Started]] — Initial setup
