# MCP Integration

Neuma integrates with the **Model Context Protocol (MCP)** to give agents access to a rich set of tools. Built-in MCP servers are started automatically; users can add custom servers via configuration files.

---

## How MCP Servers Are Loaded

Servers are loaded from two sources at API startup:

| Source | Path | Purpose |
|---|---|---|
| Claude Code config | `~/.claude/settings.json` | Shared with the Claude Code CLI |
| App-specific config | `~/.<slug>/mcp.json` | Neuma-only servers |

Both files use the same `mcpServers` JSON format:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@org/my-mcp-server"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

---

## Built-In MCP Servers

Six servers are bundled and started automatically:

### Sandbox Server
Exposes shell execution to agents within the workspace:

| Tool | Description |
|---|---|
| `run_command` | Execute a shell command in the workspace |
| `read_file` | Read a workspace file |

### Linear Server — 18 tools
Full Linear project management access:

| Category | Tools |
|---|---|
| Issues | `create_issue`, `update_issue`, `get_issue`, `list_issues`, `delete_issue` |
| Projects | `create_project`, `list_projects`, `get_project` |
| Teams | `list_teams`, `get_team` |
| Comments | `create_comment`, `list_comments` |
| Labels | `list_labels` |
| Relations | `create_relation`, `update_relation` |
| Cycles | `list_cycles` |
| Users | `list_members` |
| Workflow | `list_workflow_states` |

### Media Generation Server — 4 tools

| Tool | Description |
|---|---|
| `generate_image` | Generate an image (DALL-E / Gemini / Volcengine) |
| `edit_image` | Edit an existing image |
| `generate_video` | Generate a video (Sora / Volcengine) |
| `list_providers` | List available media providers |

### Memory Server — 4 tools

| Tool | Description |
|---|---|
| `remember` | Store a new memory |
| `recall` | Search memories by query |
| `forget` | Delete a memory by ID |
| `list_memories` | List all memories (paginated) |

### Google Services Server — 79 tools
Tools are filtered to the OAuth scopes the user has authorized:

| Service | Example Tools |
|---|---|
| Gmail | `send_email`, `search_emails`, `read_email` |
| Calendar | `create_event`, `list_events`, `update_event` |
| Drive | `upload_file`, `search_files`, `download_file` |
| Docs | `create_doc`, `update_doc`, `read_doc` |
| Sheets | `create_sheet`, `update_cells`, `read_cells` |
| Meet | `create_meeting` |
| Photos | `search_photos`, `list_albums` |
| Contacts | `search_contacts`, `create_contact` |
| Tasks | `create_task`, `list_tasks` |

### Speech Server — 4 tools

| Tool | Description |
|---|---|
| `synthesize` | Convert text to speech audio |
| `transcribe` | Convert audio to text |
| `list_voices` | List available TTS voices |
| `list_capabilities` | List active provider capabilities |

---

## MCP Presets

The Settings → MCP Presets tab offers one-click installation of popular MCP servers:

| Preset | Package | Description |
|---|---|---|
| Context7 | `@upstash/context7-mcp` | Up-to-date library documentation |
| Sequential Thinking | `@modelcontextprotocol/server-sequential-thinking` | Structured reasoning |
| Memory | `@modelcontextprotocol/server-memory` | Persistent memory (alternative) |
| Filesystem | `@modelcontextprotocol/server-filesystem` | Enhanced file access |
| Brave Search | `@modelcontextprotocol/server-brave-search` | Web search |
| GitHub | `@modelcontextprotocol/server-github` | GitHub repository tools |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | Browser automation |
| Fetch | `@modelcontextprotocol/server-fetch` | Web content fetching |
| EverArt | `@modelcontextprotocol/server-everart` | AI image generation |
| Playwright | `@executeautomation/playwright-mcp-server` | Browser testing |

Clicking **Install** writes the server entry to `~/.<slug>/mcp.json` and restarts the MCP manager.

---

## Security: Prompt Injection Mitigation

MCP server responses are treated as untrusted data:

- **Sentinel labels** — all MCP content is tagged with an "untrusted" prefix in the system prompt
- **10,000 character truncation** — oversized tool results are truncated before prompt inclusion
- **XML escaping** — tool results are XML-escaped when included in memory context

---

## Adding a Custom Server

### Via settings file

Edit `~/.<slug>/mcp.json`:

```json
{
  "mcpServers": {
    "my-db-tools": {
      "command": "node",
      "args": ["/path/to/my-mcp-server/index.js"],
      "env": {
        "DB_URL": "postgresql://..."
      }
    }
  }
}
```

### Via the UI

Settings → MCP Servers → Add Server — fills in the JSON config via a form.

Changes take effect after restarting the API (the file is watched for changes in development).

---

## MCP Config API

```
GET  /mcp/config          Return current MCP server list
POST /mcp/config          Save updated MCP server config
```

---

## Further Reading

- [[Agent System]] — How agents call MCP tools
- [[Memory System]] — Memory MCP server details
- [[Voice Interface]] — Speech MCP server details
- [[OAuth and Integrations]] — Authorizing Google services
- [[API Reference]] — `/mcp/*` endpoints
