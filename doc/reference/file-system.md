---
summary: "Project root and application data directory structure including sessions, skills, database, logs, and config files"
read_when:
  - Looking up where files are stored
  - Understanding the application data directory layout
  - Working with file paths or storage locations
title: "File System Layout"
---

# File System Layout

```
Project Root
├── branding/                        # Brand definitions (one folder per brand)
│   ├── default/                     # Default brand (tracked in git)
│   │   ├── branding.json            # Brand config (source of truth)
│   │   ├── logo.png, app-icon.png, favicon.ico
│   │   ├── icons/                   # All platform icons
│   │   └── generate-assets.py       # Icon generation utility
│   └── <custom-brand>/              # Custom brands (gitignored)
├── branding.json                    # Mirror of active brand config (auto-synced)
└── ...

~/.<slug>/                          # Application data root (slug from branding.json)
├── sessions/                   # Session workspaces
│   └── {sessionId}/
│       ├── attachments/        # User-uploaded attachments
│       └── output/             # Agent-generated files
├── design-projects/            # DesignMode project folders
│   ├── design_{id}/
│   │   ├── project.json        # DesignMode project manifest
│   │   ├── brief.json          # Editable project brief
│   │   ├── skill/              # Snapshotted SKILL.md
│   │   ├── design-system/      # Snapshotted DESIGN.md
│   │   ├── craft/              # Snapshotted craft references
│   │   ├── prompts/            # Resolved prompt files and template snapshot
│   │   ├── assets/
│   │   │   ├── references/     # User/reference assets
│   │   │   └── generated/      # Provider or renderer outputs
│   │   ├── artifacts/          # Primary generated documents/prototypes/decks
│   │   ├── exports/            # Exported files and disclosure sidecars
│   │   ├── provenance/         # assets.jsonl and tasks.jsonl
│   │   ├── comments/           # comments.json
│   │   ├── sketches/           # Sketch overlays
│   │   └── history.jsonl       # Append-only project history
│   └── .deleted/               # Tombstoned DesignMode project folders
├── .neuma/
│   └── design-systems/         # Workspace custom DesignMode systems
│       └── {system-id}/DESIGN.md
├── skills/                     # Custom skill definitions
│   └── {skill-name}/
│       └── SKILL.md
├── database.db                 # SQLite database (memories, sessions, tasks, etc.)
├── logs/
│   └── <slug>.log                  # Application log file
├── cache/
│   └── embeddings/             # Local embedding model cache (dev-mode fallback only)
├── mcp.json                    # MCP server configuration
├── linear.enc.json             # Linear config with encrypted secrets (0o600)
├── pipeline-state.json         # Persisted pipeline state (survives restarts)
└── automations.json            # Automation definitions and run history (debounced writes, 500ms coalesce)

~/.claude/                      # Shared Claude Code config
├── settings.json               # Claude settings (MCP servers)
└── skills/                     # Claude Code skills
```

---

_See also: [Configuration & Branding](../backend/configuration.md) · [Database Schema](database-schema.md)_
