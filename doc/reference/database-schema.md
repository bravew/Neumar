---
summary: "Complete SQLite schema — all tables, columns, foreign keys, indexes, virtual tables, and migration strategy"
read_when:
  - Working with the database layer
  - Adding new tables or columns
  - Understanding the data model
  - Writing queries or migrations
title: "Database Schema"
---

# Database Schema

The initial schema was consolidated in migration version 1 (pre-release). Subsequent
migrations add columns incrementally. The schema is kept in sync between the Tauri SQLite
plugin (`src-tauri/src/lib.rs`) and the backend `better-sqlite3` module
(`src-api/src/shared/db/index.ts`).

## Tables

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY NOT NULL,
    prompt      TEXT NOT NULL,
    task_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
    id                   TEXT PRIMARY KEY NOT NULL,
    session_id           TEXT,
    task_index           INTEGER DEFAULT 1,
    prompt               TEXT NOT NULL,
    title                TEXT,                        -- Auto-generated display title
    work_dir             TEXT,                        -- Per-task workspace directory
    additional_work_dirs TEXT,                        -- JSON array of extra workspace dirs (migration 002)
    agent_session_id     TEXT,                        -- Provider/runtime session id for resume
    applied_plugin_id    TEXT,                        -- Applied task plugin id, if any
    applied_plugin_snapshot_json TEXT,                 -- Redacted applied plugin snapshot
    status               TEXT NOT NULL DEFAULT 'running',
    cost                 REAL,
    duration             INTEGER,
    favorite             INTEGER DEFAULT 0,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE agent_resume_identities (
    task_id           TEXT PRIMARY KEY,
    provider_id       TEXT NOT NULL,
    model_id          TEXT,
    workspace_root    TEXT,
    native_session_id TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL
);

CREATE TABLE messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       TEXT NOT NULL,                -- FK to tasks(id) ON DELETE CASCADE
    type          TEXT NOT NULL,                -- text, tool_use, tool_result, plan, etc.
    content       TEXT,
    tool_name     TEXT,
    tool_input    TEXT,                         -- JSON string
    tool_output   TEXT,
    tool_use_id   TEXT,
    subtype       TEXT,
    error_message TEXT,
    attachments   TEXT,                         -- JSON string
    message_id    TEXT,                         -- Deterministic ID for idempotent persistence
    branch_id     TEXT,                          -- Conversation branch ID (migration 002)
    parent_message_id INTEGER DEFAULT NULL,       -- Parent message for branching (migration 002)
    agui_type     TEXT,                          -- AG-UI event type (migration 002)
    run_id        TEXT,                          -- AG-UI run ID (migration 002)
    step_name     TEXT,                          -- AG-UI step name (migration 002)
    cost          REAL,                          -- Per-message API cost (USD)
    usage_input   INTEGER,                       -- Input tokens for this message
    usage_output  INTEGER,                       -- Output tokens for this message
    usage_cache_read    INTEGER,                  -- Cache read input tokens
    usage_cache_creation INTEGER,                 -- Cache creation input tokens
    model         TEXT,                          -- Model used for this message
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL,                  -- FK to tasks(id) ON DELETE CASCADE
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    path        TEXT NOT NULL,
    preview     TEXT,
    thumbnail   TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE media_versions (
    id                  TEXT PRIMARY KEY NOT NULL,
    task_id             TEXT NOT NULL,          -- FK to tasks(id) ON DELETE CASCADE
    artifact_id         TEXT NOT NULL,
    version_number      INTEGER NOT NULL,
    path                TEXT NOT NULL,
    prompt              TEXT NOT NULL,
    previous_version_id TEXT,
    type                TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE settings (
    key         TEXT PRIMARY KEY NOT NULL,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE design_projects (
    id         TEXT PRIMARY KEY,
    surface    TEXT NOT NULL,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

`design_projects` is an index for DesignMode project discovery. The full manifest lives
in `<workDir>/design-projects/<design_id>/project.json`; deleting a DesignMode project
removes the index row and moves the project folder under `.deleted/`.

`agent_resume_identities` records which provider, model, and workspace produced a
task's durable native session id. `/agent/resume` uses it to avoid replaying a stale
or cross-provider session id into the wrong runtime.

## Memory System Tables

```sql
CREATE TABLE memories (
    id                    TEXT PRIMARY KEY NOT NULL,
    content               TEXT NOT NULL,
    category              TEXT NOT NULL DEFAULT 'other',
    importance            REAL NOT NULL DEFAULT 0.7,
    source                TEXT NOT NULL DEFAULT 'manual',
    session_id            TEXT,
    access_count          INTEGER NOT NULL DEFAULT 0,
    last_accessed_at      TEXT,
    has_embedding         INTEGER NOT NULL DEFAULT 0,
    -- v2 columns (migration 003)
    memory_type           TEXT,            -- episodic | semantic | procedural | preference
    scope_type            TEXT,            -- global | project | task
    scope_id              TEXT,            -- project or task ID (NULL for global)
    decay_rate            REAL,            -- per-day decay factor
    last_accessed_strength REAL,
    confidence            REAL,
    valid_from            TEXT,
    valid_until           TEXT,
    parent_id             TEXT,
    consolidated_from     TEXT,            -- JSON array of original memory IDs
    lifecycle_status      TEXT,            -- active | archived | consolidated | expired
    metadata              TEXT DEFAULT '{}',
    language              TEXT,
    -- v3 columns (migration 006)
    visibility            TEXT NOT NULL DEFAULT 'private',  -- private | team
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE embedding_cache (
    content_hash    TEXT NOT NULL,
    model           TEXT NOT NULL,
    embedding       BLOB NOT NULL,
    dim             INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (content_hash, model)
);

CREATE TABLE session_memory_chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         TEXT NOT NULL,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER NOT NULL DEFAULT 0,
    has_embedding   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, chunk_index)
);

-- Entity graph tables (migration 003)
CREATE TABLE memory_entities (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    entity_type     TEXT NOT NULL,   -- person | project | technology | organization | concept
    summary         TEXT,
    first_seen_at   TEXT DEFAULT (datetime('now')),
    last_seen_at    TEXT DEFAULT (datetime('now')),
    mention_count   INTEGER DEFAULT 1,
    metadata        TEXT DEFAULT '{}'
);

CREATE TABLE memory_entity_edges (
    id                TEXT PRIMARY KEY,
    source_entity_id  TEXT NOT NULL REFERENCES memory_entities(id),
    target_entity_id  TEXT NOT NULL REFERENCES memory_entities(id),
    relation          TEXT NOT NULL,   -- works_on | uses | manages | belongs_to | related_to | depends_on
    confidence        REAL DEFAULT 0.8,
    valid_from        TEXT,
    valid_until       TEXT,
    source_memory_id  TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE memory_consolidation_log (
    id              TEXT PRIMARY KEY,
    merged_into_id  TEXT,
    original_ids    TEXT,            -- JSON array
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Session journals (migration 006) — append-only observation log
CREATE TABLE session_journals (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Virtual Tables (runtime)

Created at runtime by `initializeMemory()`:

```sql
-- sqlite-vec ANN index for memories
CREATE VIRTUAL TABLE vec_memories USING vec0(...)

-- sqlite-vec ANN index for session chunks
CREATE VIRTUAL TABLE vec_session_chunks USING vec0(...)

-- FTS5 full-text search index
CREATE VIRTUAL TABLE memories_fts USING fts5(...)
```

## Indexes

```sql
CREATE INDEX        idx_sessions_created_at    ON sessions(created_at);
CREATE INDEX        idx_tasks_session_id       ON tasks(session_id);
CREATE INDEX        idx_tasks_created_at       ON tasks(created_at);
CREATE INDEX        idx_tasks_applied_plugin   ON tasks(applied_plugin_id);
CREATE INDEX        idx_messages_task_id       ON messages(task_id);
CREATE UNIQUE INDEX idx_messages_message_id    ON messages(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX        idx_messages_branch        ON messages(task_id, branch_id);
CREATE INDEX        idx_files_task_id          ON files(task_id);
CREATE INDEX        idx_media_versions_task_id ON media_versions(task_id);
CREATE INDEX        idx_design_projects_updated_at ON design_projects(updated_at DESC);
CREATE INDEX        idx_design_projects_surface ON design_projects(surface);
CREATE INDEX        idx_memories_category      ON memories(category);
CREATE INDEX        idx_memories_importance    ON memories(importance DESC);
CREATE INDEX        idx_memories_created_at    ON memories(created_at DESC);
CREATE INDEX        idx_memories_has_embedding ON memories(has_embedding);
CREATE INDEX        idx_session_chunks_task    ON session_memory_chunks(task_id);
CREATE INDEX        idx_session_chunks_embedding ON session_memory_chunks(has_embedding);
CREATE INDEX        idx_session_journals_session ON session_journals(session_id, created_at);
```

## Plugin Tables

`installed_plugins` tracks user, project, bundled, local, GitHub, URL, and
marketplace installs. Bundled plugins are reconciled into this table so users
can disable them without deleting shipped files.

```sql
CREATE TABLE IF NOT EXISTS installed_plugins (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  source          TEXT NOT NULL, -- github | url | local | bundled
  source_ref      TEXT,
  install_path    TEXT NOT NULL,
  scope           TEXT NOT NULL, -- project | user | marketplace | bundled | legacy
  enabled         INTEGER NOT NULL DEFAULT 1,
  manifest_json   TEXT NOT NULL,
  sha256          TEXT,
  signature_ok    INTEGER,
  trust_tier      TEXT,
  manifest_digest TEXT,
  last_reviewed_digest TEXT,
  source_marketplace_id TEXT,
  source_entry_name TEXT,
  source_entry_version TEXT,
  marketplace_trust TEXT,
  installed_at    TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installed_plugins_scope_enabled
  ON installed_plugins(scope, enabled);
CREATE INDEX IF NOT EXISTS idx_installed_plugins_name
  ON installed_plugins(name);

CREATE TABLE IF NOT EXISTS plugin_config_values (
  plugin_id   TEXT NOT NULL,
  key         TEXT NOT NULL,
  value_json  TEXT,
  secret_name TEXT,
  sensitive   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key),
  FOREIGN KEY (plugin_id) REFERENCES installed_plugins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plugin_config_values_plugin
  ON plugin_config_values(plugin_id);

CREATE TABLE IF NOT EXISTS marketplace_sources (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL UNIQUE,
  trust             TEXT NOT NULL CHECK (trust IN ('official', 'restricted')),
  catalog_version   TEXT,
  plugin_count      INTEGER,
  last_refreshed_at TEXT,
  created_at        TEXT NOT NULL
);
```

Marketplace source trust is user-assigned and never inherited from catalog
JSON. Installs from a marketplace source copy the source id, catalog entry
name/version, and source trust onto `installed_plugins` for provenance and
update hints. Plugin config secrets are stored in the app secret store; SQLite
keeps only the generated `secret_name`.

## Idempotent Message Persistence

The `message_id` unique index enables **idempotent message persistence** — the backend
generates deterministic IDs (tool messages use the SDK-provided `toolUseId`, other messages
use a per-task monotonic sequence counter) and checks for existence before insertion,
preventing duplicates on retries or replayed streams.

## Per-Message Cost & Usage Tracking

Each message stores its own `cost`, `usage_input`, `usage_output`, `usage_cache_read`,
`usage_cache_creation`, and `model` fields. The backend populates these from the agent SDK
result events during both planning and execution phases. This enables per-turn cost breakdowns
in the frontend toolbar tooltip.

## Usage Tables (Migration 001)

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
    id                    TEXT PRIMARY KEY NOT NULL,
    task_id               TEXT,
    session_id            TEXT,
    parent_id             TEXT,
    call_type             TEXT NOT NULL,  -- agent | title | embedding | image | speech | ptc | other
    provider              TEXT,
    model                 TEXT,
    billing_type          TEXT NOT NULL DEFAULT 'api',  -- api | subscription | free
    billing_scope         TEXT,
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    input_cost            INTEGER NOT NULL DEFAULT 0,   -- micro-USD (÷ 1,000,000 = USD)
    output_cost           INTEGER NOT NULL DEFAULT 0,
    cache_read_cost       INTEGER NOT NULL DEFAULT 0,
    cache_creation_cost   INTEGER NOT NULL DEFAULT 0,
    total_cost            INTEGER NOT NULL DEFAULT 0,
    unit_cost             INTEGER NOT NULL DEFAULT 0,
    unit_type             TEXT,
    unit_count            INTEGER NOT NULL DEFAULT 0,
    latency_ms            INTEGER NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'success',
    error_message         TEXT,
    metadata              TEXT DEFAULT '{}',
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_pricing (
    model_id                        TEXT PRIMARY KEY NOT NULL,
    provider                        TEXT NOT NULL DEFAULT '',
    display_name                    TEXT NOT NULL DEFAULT '',
    input_cost_per_million          INTEGER NOT NULL DEFAULT 0,  -- micro-USD per million input tokens
    output_cost_per_million         INTEGER NOT NULL DEFAULT 0,
    cache_read_cost_per_million     INTEGER NOT NULL DEFAULT 0,
    cache_creation_cost_per_million INTEGER NOT NULL DEFAULT 0,
    unit_cost                       INTEGER NOT NULL DEFAULT 0,
    unit_type                       TEXT,
    is_default                      INTEGER NOT NULL DEFAULT 0,
    default_billing_type            TEXT NOT NULL DEFAULT 'api'  -- api | subscription | free (migration 020)
);
```

Cost values in `usage_logs` and `model_pricing` use **micro-USD** integers (multiply by 10⁻⁶ for USD). This avoids floating-point precision issues. The `default_billing_type` on `model_pricing` controls how costs are accounted for in spend totals — `subscription` tokens are tracked but cost is excluded from budget preflight calculations; `free` records cost as zero.

## Observability Trace Events (Migration 007)

`trace_events` stores persisted agent-run events used by the Trace tab, the
observability cost dashboard, optional exporters, and deterministic evals.

```sql
CREATE TABLE IF NOT EXISTS trace_events (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    session_id      TEXT,
    message_id      TEXT,
    parent_event_id TEXT,
    kind            TEXT NOT NULL,    -- agent_run | model_call | tool_call | approval | hook | error | budget | stream_start | stream_end
    agent           TEXT,
    provider        TEXT,
    model           TEXT,
    profile         TEXT,
    tool            TEXT,
    status          TEXT NOT NULL,    -- ok | error | denied | timeout | cancelled | running
    started_at      INTEGER NOT NULL, -- epoch ms
    ended_at        INTEGER,
    duration_ms     INTEGER,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    cache_read      INTEGER,
    cache_creation  INTEGER,
    cost_usd        REAL,
    attrs_json      TEXT,             -- redacted JSON
    error_json      TEXT,             -- redacted JSON
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trace_task_started
    ON trace_events(task_id, started_at);

CREATE INDEX IF NOT EXISTS idx_trace_kind
    ON trace_events(kind, started_at);

CREATE INDEX IF NOT EXISTS idx_trace_provider_day
    ON trace_events(provider, model, started_at);

CREATE INDEX IF NOT EXISTS idx_trace_message
    ON trace_events(message_id);
```

`recordTraceEvent()` upserts by `id` so a running event can later be completed
without losing its original `created_at`. List cursors use
`(started_at, created_at, id)` ordering so same-millisecond trace events are not
dropped by incremental fetches.

## Security Audit Tables (Migration 011)

Phase 7 stores redacted security telemetry in two tables. These tables never
store raw sensitive payloads. Callers provide payload hashes, redacted snippets,
and metadata that has already passed through logger redaction.

```sql
CREATE TABLE IF NOT EXISTS security_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    session_id       TEXT,
    task_id          TEXT,
    event_type       TEXT NOT NULL,     -- sandbox.*, network.*, tool_output.*, canary.*, tauri.*
    severity         TEXT NOT NULL,     -- info | warn | error | critical
    source           TEXT NOT NULL,
    action           TEXT NOT NULL,     -- block | allow | warn | redact | audit
    payload_hash     TEXT,
    redacted_snippet TEXT,
    metadata_json    TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_events_session
    ON security_events(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type
    ON security_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_severity
    ON security_events(severity, created_at DESC);

CREATE TABLE IF NOT EXISTS network_policy_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    session_id     TEXT,
    task_id        TEXT,
    decision       TEXT NOT NULL,       -- allow | deny | redirect_blocked | canary_blocked | timeout
    reason         TEXT,
    method         TEXT,
    host           TEXT,
    port           INTEGER,
    scheme         TEXT,
    resolved_ip    TEXT,
    redirect_chain TEXT,
    canary_hit     INTEGER NOT NULL DEFAULT 0,
    metadata_json  TEXT
);

CREATE INDEX IF NOT EXISTS idx_network_policy_audit_session
    ON network_policy_audit(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_policy_audit_decision
    ON network_policy_audit(decision, created_at DESC);
```

The JSONL export mirror lives at `~/<APP_DATA_DIR>/security/events.jsonl` and
contains the same redacted event fields for forensic export.

## Feedback Table (Migration 012)

Feedback is persisted locally before any Linear or remote forwarding attempt, so user submissions are not lost while offline.

```sql
CREATE TABLE IF NOT EXISTS feedback (
    id               TEXT PRIMARY KEY,
    category         TEXT NOT NULL, -- bug | feature | feedback | question
    subject          TEXT NOT NULL,
    description      TEXT NOT NULL,
    email            TEXT,
    app_name         TEXT,
    app_version      TEXT,
    diagnostics_json TEXT,          -- redacted OS/process/app metadata for bug reports
    linear_id        TEXT,
    remote_status    TEXT NOT NULL DEFAULT 'pending',
    sync_attempts    INTEGER NOT NULL DEFAULT 0,
    last_sync_error  TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    synced_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
    ON feedback(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_category
    ON feedback(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_remote_status
    ON feedback(remote_status, created_at DESC);
```

## Gateway Tables

Initialized by `initializeGatewaySchema()` in `src-api/src/shared/services/gateway/shared/db/schema.ts`. All table names are prefixed with `gateway_` to avoid collisions with core tables.

```sql
-- Channel status and config cache
CREATE TABLE IF NOT EXISTS gateway_channels (
  id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',       -- JSON blob (tokens redacted in API responses)
  status TEXT DEFAULT 'disconnected',
  last_error TEXT,
  last_connected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gateway user accounts
CREATE TABLE IF NOT EXISTS gateway_identities (
  id TEXT PRIMARY KEY,
  user_alias TEXT,
  permission_tier TEXT DEFAULT 'viewer',   -- viewer | operator | admin
  token_budget INTEGER DEFAULT 0,          -- 0 = unlimited
  tokens_used_today INTEGER DEFAULT 0,
  budget_reset_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Maps channel-native user IDs to gateway identities
CREATE TABLE IF NOT EXISTS gateway_identity_channels (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES gateway_identities(id),
  channel_id TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  channel_username TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel_id, channel_user_id)
);

-- Gateway agent sessions (per channel chat)
CREATE TABLE IF NOT EXISTS gateway_sessions (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES gateway_identities(id),
  channel_id TEXT NOT NULL,
  channel_chat_id TEXT NOT NULL,
  api_session_id TEXT,
  api_task_id TEXT,
  linked_session_id TEXT,
  status TEXT DEFAULT 'active',
  context_summary TEXT,
  last_message_at TEXT,
  last_error TEXT,
  error_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Message log with deduplication
CREATE TABLE IF NOT EXISTS gateway_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES gateway_sessions(id),
  direction TEXT NOT NULL,                  -- inbound | outbound
  channel_id TEXT NOT NULL,
  channel_message_id TEXT,
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text',
  metadata TEXT DEFAULT '{}',
  token_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'delivered',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Event notification subscriptions
CREATE TABLE IF NOT EXISTS gateway_subscriptions (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES gateway_identities(id),
  channel_id TEXT NOT NULL,
  channel_chat_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  filter TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Admin audit trail
CREATE TABLE IF NOT EXISTS gateway_audit_log (
  id TEXT PRIMARY KEY,
  identity_id TEXT,
  channel_id TEXT,
  action TEXT NOT NULL,   -- config_change | identity_create | identity_delete | permission_change
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Explicit gateway profile routing rules
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '*',
  channel_id TEXT NOT NULL DEFAULT '*',
  chat_pattern TEXT NOT NULL DEFAULT '*',
  intent TEXT NOT NULL DEFAULT '*',
  profile_id TEXT NOT NULL,
  model_override TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`agent_profiles.routing_hints` is added by migration 008 as `TEXT DEFAULT '{}'` so profile-level fallback routing can live with the profile record.

### Gateway Indexes

```sql
CREATE INDEX idx_gw_session_identity  ON gateway_sessions(identity_id);
CREATE INDEX idx_gw_session_channel   ON gateway_sessions(channel_id, channel_chat_id);
CREATE INDEX idx_gw_msg_session       ON gateway_messages(session_id, created_at);
CREATE UNIQUE INDEX idx_gw_msg_dedup  ON gateway_messages(channel_id, channel_message_id)
  WHERE channel_message_id IS NOT NULL;
CREATE INDEX idx_gw_sub_event         ON gateway_subscriptions(event_type, enabled);
CREATE INDEX idx_gw_audit_time        ON gateway_audit_log(created_at);
CREATE INDEX idx_gw_audit_identity    ON gateway_audit_log(identity_id, created_at);
CREATE INDEX idx_routing_rules_lookup ON routing_rules(enabled, workspace_id, channel_id, intent, priority);
```

## Tier 1 Tables (Migrations 004–006)

### Migration 004: Projects and Goals

```sql
-- Migration 004: Projects and Goals
CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,
    workspace   TEXT,                        -- Default workspace directory
    status      TEXT NOT NULL DEFAULT 'active',  -- active, in_progress, completed, archived
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE goals (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    project_id  TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);
```

### Migration 005: Task Hierarchy

```sql
-- Migration 005: Task Hierarchy
-- tasks table extended with: project_id, goal_id, parent_task_id, priority, labels, blocked_reason

CREATE TABLE task_links (
    id            TEXT PRIMARY KEY,
    from_task_id  TEXT NOT NULL,
    to_task_id    TEXT NOT NULL,
    link_type     TEXT NOT NULL DEFAULT 'parent_child',
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE task_comments (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    author_type TEXT NOT NULL DEFAULT 'user',
    author_id   TEXT,
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);
```

### Migration 006: Activity Events

```sql
-- Migration 006: Activity Events (append-only audit log)
CREATE TABLE activity_events (
    id          TEXT PRIMARY KEY,
    actor_type  TEXT NOT NULL,
    actor_id    TEXT,
    event_type  TEXT NOT NULL,       -- dot-notation: task.created, project.archived, etc.
    entity_type TEXT NOT NULL,
    entity_id   TEXT,
    project_id  TEXT,
    metadata    TEXT,                -- JSON with before/after snapshots
    created_at  TEXT DEFAULT (datetime('now'))
);
```

## Tier 2 Tables (Migrations 008–014)

### Migration 008: Agent Profiles

```sql
CREATE TABLE agent_profiles (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    role                     TEXT,
    description              TEXT,
    avatar_color             TEXT,
    avatar_icon              TEXT,
    runtime_id               TEXT NOT NULL,
    default_model            TEXT,
    default_provider         TEXT,
    default_mcp_servers      TEXT,    -- JSON array of server IDs
    default_skills           TEXT,    -- JSON array of skill names
    system_prompt            TEXT,
    max_concurrent_tasks     INTEGER DEFAULT 1,
    max_delegation_depth     INTEGER DEFAULT 3,
    allowed_delegates        TEXT,    -- JSON array of profile IDs
    session_compaction_policy TEXT DEFAULT 'auto',
    max_session_messages     INTEGER DEFAULT 100,
    -- Soul system columns (migration 004)
    soul                     TEXT,    -- JSON: structured soul configuration
    soul_version             TEXT,
    soul_origin              TEXT,
    corrections_log          TEXT,
    learnings                TEXT,
    status                   TEXT NOT NULL DEFAULT 'active',  -- active | paused | archived
    created_at               TEXT DEFAULT (datetime('now')),
    updated_at               TEXT DEFAULT (datetime('now'))
);

-- tasks extended with:
--   assignee_profile_id TEXT REFERENCES agent_profiles(id)
--   queue_status TEXT DEFAULT 'unassigned'
```

### Migration 009: User Templates

```sql
CREATE TABLE user_templates (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    description      TEXT,
    category         TEXT NOT NULL DEFAULT 'dev',
    system_prompt    TEXT NOT NULL,
    suggested_model  TEXT,
    skills           TEXT,    -- JSON array
    mcp_servers      TEXT,    -- JSON array
    starter_prompts  TEXT NOT NULL,  -- JSON array
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
);
```

### Migration 010: Agent Profile Avatar Icon

Safety-net migration adding `avatar_icon TEXT` to `agent_profiles` for existing databases created before the column was added to migration 008.

### Migration 011: Task Queue Priority

```sql
-- tasks extended with:
--   queue_priority INTEGER DEFAULT 0

CREATE INDEX idx_tasks_queue ON tasks(queue_status, queue_priority DESC, created_at);
```

### Migration 012: Budget Policies

```sql
CREATE TABLE budget_policies (
    id                   TEXT PRIMARY KEY,
    name                 TEXT,
    scope_type           TEXT NOT NULL,   -- global | provider | model | agent_profile | project | automation
    scope_id             TEXT,            -- NULL for global scope
    period_type          TEXT NOT NULL DEFAULT 'monthly',  -- monthly | weekly | daily
    limit_usd            REAL NOT NULL,
    alert_threshold_pct  INTEGER NOT NULL DEFAULT 75,      -- soft alert percentage
    hard_stop            INTEGER NOT NULL DEFAULT 0,       -- 1 = block when limit reached
    enabled              INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE budget_spend_cache (
    policy_id      TEXT NOT NULL REFERENCES budget_policies(id) ON DELETE CASCADE,
    period_start   TEXT NOT NULL,    -- ISO date string for the current period start
    spend_usd      REAL NOT NULL DEFAULT 0,
    last_updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (policy_id, period_start)
);
```

The spend cache is a performance optimisation — the authoritative source is always `usage_logs`. `invalidateBudgetSpendCache()` is called after every usage insert with a cost > 0 so the next preflight reads fresh data.

### Migration 013: File Snapshots

```sql
CREATE TABLE file_snapshots (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,
    content_before  TEXT,    -- NULL for newly created files
    content_after   TEXT,    -- NULL for deleted files
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_file_snapshots_task ON file_snapshots(task_id);
CREATE UNIQUE INDEX idx_file_snapshots_task_path ON file_snapshots(task_id, file_path);
```

Powers the **File Diff View** in the TaskDetail right sidebar — the agent writes before/after snapshots on every file write, and the frontend fetches them to render a unified diff.

### Migration 014: Task Documents

```sql
CREATE TABLE task_documents (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    doc_key     TEXT NOT NULL,     -- plan | notes | design | custom
    title       TEXT,
    content     TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT DEFAULT 'user',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_task_documents_current ON task_documents(task_id, doc_key);

CREATE TABLE task_document_history (
    history_id  TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES task_documents(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    version     INTEGER NOT NULL,
    created_by  TEXT DEFAULT 'user',
    created_at  TEXT NOT NULL
);
```

A `BEFORE UPDATE` trigger on `task_documents` auto-archives the previous content into `task_document_history` on every update, providing automatic version history without application-level logic.

## Tier 4 Tables (Migrations 015–017)

### Migration 015: Approvals

Durable human-in-the-loop approval records. Supports plan approval, delegation, budget override, sensitive file system access, external actions, and automation change gates.

```sql
CREATE TABLE IF NOT EXISTS approvals (
  id                   TEXT PRIMARY KEY,
  approval_type        TEXT NOT NULL,        -- plan | delegation | budget_override | external_action | sensitive_fs | automation_change
  status               TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired
  requested_by_type    TEXT NOT NULL,        -- user | agent | automation | system
  requested_by_id      TEXT,
  entity_type          TEXT NOT NULL,        -- e.g. 'task', 'session'
  entity_id            TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT,
  payload              TEXT,                 -- JSON blob (plan steps, file paths, etc.)
  decided_by           TEXT,
  decision_reason      TEXT,
  decided_at           TEXT,
  expires_at           TEXT,
  orchestration_run_id TEXT,
  created_at           TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approvals_status      ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_entity      ON approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approvals_type_status ON approvals(approval_type, status);
```

### Migration 016: Channel Plugin Tables

Supports the unified channel plugin system (`BasePlugin` / `ChannelManager`) for Telegram, Lark/Feishu, Discord, and Slack bots.

```sql
-- Per-platform bot configuration
CREATE TABLE IF NOT EXISTS channel_config (
  id                    TEXT PRIMARY KEY,
  platform              TEXT NOT NULL,       -- telegram | lark | discord | slack
  agent_profile_id      TEXT,                -- Per-channel agent personality (migration 005)
  token                 TEXT,                -- bot token (stored encrypted)
  mode                  TEXT DEFAULT 'polling',
  rate_limit            INTEGER DEFAULT 10,
  enabled               INTEGER NOT NULL DEFAULT 1,
  guardrails_provider   TEXT,                -- null | 'openai'
  guardrails_fail_mode  TEXT,                -- null | 'open' | 'closed'
  block_kit_progress    INTEGER DEFAULT 1,   -- Slack Block Kit progress blocks (migration 007)
  name                  TEXT,                -- Human-readable bot label (migration 003_multi_bot)
  access_mode           TEXT DEFAULT 'open', -- open or gated (migration 008)
  cred_connectors_allowlist TEXT DEFAULT NULL, -- Slack App Home connector allowlist (migration 014)
  user_mcp_policy       TEXT DEFAULT 'open',  -- open | admin-approved | disabled (migration 014)
  created_at            TEXT DEFAULT (datetime('now'))
);

-- Approved channel users (paired via 6-digit pairing code)
CREATE TABLE IF NOT EXISTS channel_users (
  id                 TEXT PRIMARY KEY,
  config_id          TEXT,                   -- Links rows to a specific bot instance (migration 003_multi_bot)
  platform           TEXT NOT NULL,
  platform_user_id   TEXT NOT NULL,
  display_name       TEXT,
  approved_at        TEXT,
  permission_tier    TEXT DEFAULT 'operator',   -- viewer | operator | admin
  token_budget       INTEGER DEFAULT 0,          -- 0 = unlimited
  tokens_used_today  INTEGER DEFAULT 0,
  tokens_period_start TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_users_platform
  ON channel_users(platform, platform_user_id);

-- Ephemeral pairing codes (6-digit, 10-min TTL)
CREATE TABLE IF NOT EXISTS channel_pairing_codes (
  code              TEXT PRIMARY KEY,
  platform          TEXT NOT NULL,
  platform_user_id  TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  used              INTEGER DEFAULT 0
);
```

### Migration 018: Channel Consolidation

Extends channel tables, adds sessions/messages/audit tables, and drops all `gateway_*` tables.

```sql
-- Extended channel_users columns (added via ALTER TABLE)
-- permission_tier, token_budget, tokens_used_today, tokens_period_start

-- Extended channel_config columns (added via ALTER TABLE)
-- guardrails_provider, guardrails_fail_mode

-- Maps (platform, sessionKey) to agent sessions
CREATE TABLE IF NOT EXISTS channel_sessions (
  id               TEXT PRIMARY KEY,
  platform         TEXT NOT NULL,
  session_key      TEXT NOT NULL,
  channel_user_id  TEXT,
  agent_session_id TEXT,
  agent_task_id    TEXT,
  status           TEXT DEFAULT 'active',
  error_count      INTEGER DEFAULT 0,
  last_activity_at TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

-- Message history per channel session
CREATE TABLE IF NOT EXISTS channel_messages (
  id                TEXT PRIMARY KEY,
  channel_session_id TEXT NOT NULL,
  platform          TEXT NOT NULL,
  direction         TEXT NOT NULL,   -- inbound | outbound
  content           TEXT NOT NULL,
  message_id        TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- Security audit log
CREATE TABLE IF NOT EXISTS channel_audit_log (
  id               TEXT PRIMARY KEY,
  action           TEXT NOT NULL,
  channel_user_id  TEXT,
  platform         TEXT NOT NULL,
  details          TEXT DEFAULT '{}',
  created_at       TEXT DEFAULT (datetime('now'))
);

-- Dropped: gateway_channels, gateway_identities, gateway_identity_channels,
--          gateway_sessions, gateway_messages, gateway_subscriptions, gateway_audit_log
```

### Migration 017: WebUI Sessions

Refresh-token rotation table for JWT auth in WebUI / remote access mode. Implements token-family theft detection: if a used token is replayed, the entire family is revoked.

```sql
CREATE TABLE IF NOT EXISTS webui_sessions (
  token       TEXT PRIMARY KEY,
  family      TEXT NOT NULL,              -- UUID grouping all tokens from one login
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0, -- 1 = already rotated
  used_at     TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webui_sessions_family  ON webui_sessions(family);
CREATE INDEX IF NOT EXISTS idx_webui_sessions_expires ON webui_sessions(expires_at);
```

**Token rotation flow:**

- Login → generate `family = randomUUID()`, insert refresh token
- Refresh → mark `used=1`, insert new token with same family
- Replay detected (used token re-submitted) → DELETE all rows for that family, return 401

### Backend Migration 013: Slack App Home Tables

Slack App Home adds per-user link, personal credential, and per-user MCP storage. Rows are keyed by both Slack team and user so Slack user IDs never collide across workspaces.

```sql
CREATE TABLE IF NOT EXISTS slack_user_links (
  slack_team_id      TEXT NOT NULL,
  slack_user_id      TEXT NOT NULL,
  config_id          TEXT NOT NULL,
  channel_user_id    TEXT,
  email              TEXT,
  display_name       TEXT,
  routing_mode       TEXT NOT NULL DEFAULT 'auto',
  notify_on_done     INTEGER NOT NULL DEFAULT 1,
  dek_wrapped_iv     TEXT NOT NULL,
  dek_wrapped_ct     TEXT NOT NULL,
  dek_wrapped_tag    TEXT NOT NULL,
  linked_at          TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at       TEXT,
  PRIMARY KEY (slack_team_id, slack_user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_user_links_config
  ON slack_user_links(config_id);

CREATE INDEX IF NOT EXISTS idx_slack_user_links_channel_user
  ON slack_user_links(channel_user_id);

CREATE TABLE IF NOT EXISTS slack_user_oauth (
  slack_team_id   TEXT NOT NULL,
  slack_user_id   TEXT NOT NULL,
  provider        TEXT NOT NULL,
  account_label   TEXT,
  access_iv       TEXT NOT NULL,
  access_ct       TEXT NOT NULL,
  access_tag      TEXT NOT NULL,
  refresh_iv      TEXT,
  refresh_ct      TEXT,
  refresh_tag     TEXT,
  scopes_json     TEXT,
  expires_at      TEXT,
  connected_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (slack_team_id, slack_user_id, provider)
);

CREATE TABLE IF NOT EXISTS slack_user_mcp (
  id                       TEXT PRIMARY KEY,
  slack_team_id            TEXT NOT NULL,
  slack_user_id            TEXT NOT NULL,
  name                     TEXT NOT NULL,
  transport                TEXT NOT NULL,
  url                      TEXT,
  command                  TEXT,
  args_json                TEXT,
  env_iv                   TEXT,
  env_ct                   TEXT,
  env_tag                  TEXT,
  enabled                  INTEGER NOT NULL DEFAULT 1,
  pending_admin_approval   INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slack_user_mcp_user
  ON slack_user_mcp(slack_team_id, slack_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_user_mcp_unique_name
  ON slack_user_mcp(slack_team_id, slack_user_id, name);

ALTER TABLE webui_sessions ADD COLUMN slack_team_id TEXT;
ALTER TABLE webui_sessions ADD COLUMN slack_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_webui_sessions_slack_user
  ON webui_sessions(slack_team_id, slack_user_id);
```

`slack_user_links` stores the wrapped per-user DEK. Deleting a link row removes the wrapped DEK and crypto-shreds dependent `slack_user_oauth` and `slack_user_mcp` ciphertexts.

### Backend Migration 014: Slack App Home Per-Bot Toggles

Slack App Home behavior can be narrowed per bot instance through `channel_config`:

```sql
ALTER TABLE channel_config ADD COLUMN cred_connectors_allowlist TEXT DEFAULT NULL;
ALTER TABLE channel_config ADD COLUMN user_mcp_policy TEXT DEFAULT 'open';
```

`cred_connectors_allowlist` is a comma-separated list of Slack Home personal credential connector keys. The backend registry currently accepts `linear`, `anthropic`, and `openai`; NULL or whitespace means all registered credential connectors. GitHub, Notion, Atlassian/Jira, Linear hosted MCP, and Sentry live in the Slack Home MCP quick-add catalog instead and are stored as encrypted `slack_user_mcp` headers. `user_mcp_policy` controls user-added MCP rows: `open` self-adds and probes asynchronously, `admin-approved` inserts pending rows, and `disabled` hides the MCP section.

### Backend Migrations 024-026: Runtime Coordination and Questions

Recent runtime migrations add:

```sql
CREATE TABLE IF NOT EXISTS channel_leases (
  key        TEXT    PRIMARY KEY,
  holder     TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS agent_questions (
  id             TEXT PRIMARY KEY NOT NULL,
  session_id     TEXT NOT NULL,
  task_id        TEXT,
  tool_use_id    TEXT,
  questions_json TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'cancelled', 'expired')),
  answer_json    TEXT,
  asked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at    TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

ALTER TABLE publish_jobs ADD COLUMN workflow_version TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE publish_jobs ADD COLUMN workflow_state_json TEXT NOT NULL DEFAULT '{}';
```

`channel_leases` prevents duplicate channel workers from owning singleton duties at the same
time. `agent_questions` persists `AskUserQuestion` prompts across task switches and adapter
resumes. Publish workflow columns let the publish orchestrator store versioned workflow
state without changing the top-level job contract.

## Migration History

### Backend Migrations (`src-api/src/shared/db/migrations/`)

The backend uses a consolidated initial schema plus idempotent catch-up migrations:

| Version | File                                 | Description                                                                                                          |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 001     | `001_init.ts`                        | Complete consolidated schema — all baseline tables and indexes                                                       |
| 002     | `002_add_thinking_config.ts`         | Adds `agent_profiles.default_thinking_config`                                                                        |
| 003     | `003_multi_bot.ts`                   | Multi-bot instance support: re-keys channel child tables from platform to `config_id` and adds `channel_config.name` |
| 004     | `004_add_file_provenance.ts`         | Adds `files.provenance` JSON for generated media provenance                                                          |
| 005     | `005_plugins.ts`                     | Creates `installed_plugins` for plugin/skills marketplace state                                                      |
| 006     | `006_agent_loop_v2.ts`               | Adds agent-loop v2 run tracking (`agent_runs`), approval risk/resume fields, and message parent/sub-agent columns    |
| 007     | `007_trace_events.ts`                | Creates `trace_events` for observability timelines and eval cost rollups                                             |
| 008     | `008_gateway_routing_rules.ts`       | Adds `agent_profiles.routing_hints`, `gateway_channels`, and `routing_rules`                                         |
| 009     | `009_recall_audit.ts`                | Creates `recall_audit` for per-turn memory recall provenance                                                         |
| 010     | `010_workspace_chunks.ts`            | Creates `workspace_chunks`, `workspace_chunks_fts`, and `workspace_index_meta` for workspace RAG                     |
| 011     | `011_security_events.ts`             | Creates `security_events` and `network_policy_audit` for redacted security telemetry                                 |
| 012     | `012_feedback.ts`                    | Creates local-first `feedback` persistence with sync status fields                                                   |
| 013     | `013_slack_app_home.ts`              | Creates Slack App Home per-user link, credential, and MCP tables; extends `webui_sessions` with Slack user columns   |
| 014     | `014_slack_app_home_per_bot.ts`      | Adds Slack App Home connector allowlist and user-MCP policy columns to `channel_config`                              |
| 015     | `015_design_projects.ts`             | Creates `design_projects` as the local index for DesignMode project manifests                                        |
| 016     | `016_cloud_storage_local.ts`         | Creates local cloud storage connection/item cache and content job tables                                             |
| 017     | `017_cloud_storage_local_cursors.ts` | Creates local change cursors for desktop long-poll sync                                                              |
| 018     | `018_cloud_storage_path_mappings.ts` | Creates local Immich path mapping table for LAN bridge reads                                                         |
| 019     | `019_publish_tables.ts`              | Creates publish destinations, jobs, attempts, approvals, and provenance support                                      |
| 020     | `020_publish_leg_approvals.ts`       | Adds publish approval leg tracking                                                                                   |
| 021     | `021_design_routines.ts`             | Adds DesignMode routine scheduling metadata                                                                          |
| 022     | `022_design_critique_metrics.ts`     | Adds DesignMode critique metrics                                                                                     |
| 023     | `023_connector_tool_overrides.ts`    | Adds connector tool override metadata                                                                                |
| 024     | `024_channel_leases.ts`              | Creates `channel_leases` for singleton channel worker ownership                                                      |
| 025     | `025_agent_questions.ts`             | Creates durable `agent_questions` for human-in-the-loop agent prompts                                                |
| 026     | `026_publish_workflows.ts`           | Adds versioned workflow state columns/indexes to `publish_jobs`                                                      |
| 027–033 | `027_video_mode_foundation.ts` … `033_video_recipe_tool_rename.ts` | Video Mode foundation, linked sources, search, activity, embedding cache, conversation mode, recipe rename (see [Video Mode Backend](../backend/video-mode.md)) |
| 034     | `034_assets_catalog.ts`              | Centralized Assets Catalog (v91) — `assets`, `asset_tags`, `asset_collections`, `asset_collection_items`, `asset_attachments`, `assets_fts` (FTS5), `asset_embeddings`, `assets_embedding_config`, `asset_sync_state`, `asset_jobs`, and `assets_vec_768` (vec0 virtual table when sqlite-vec is loadable) |
| 035     | `035_assets_materialization.ts`      | Assets materialization cache (v92) — `asset_cache`, `asset_materializations`, `asset_proxies`, `asset_preview_artifacts`; seeds session/project byte budgets and proxy thresholds in `settings` |
| 036     | `036_task_agent_session_id.ts`       | Adds `tasks.agent_session_id` for resumable provider sessions |
| 037     | `037_video_project_workspace_root.ts` | Adds `video_projects.workspace_root` so projects keep their original workspace root |
| 038–041 | `038_plugin_runtime_trust.ts` … `041_video_agent_history.ts` | Adds plugin trust/digest columns, video plugin candidates, applied plugin snapshots, and per-project Video agent history |
| 042     | `042_video_media_frame_search.ts`    | Adds `media_frames` plus FTS triggers for Video Mode frame search |
| 043     | `043_plugin_config.ts`               | Creates `plugin_config_values` for installed plugin configuration; secret fields point at the secret store |
| 044     | `044_task_plugin_snapshot.ts`        | Adds `tasks.applied_plugin_id`, `tasks.applied_plugin_snapshot_json`, and `idx_tasks_applied_plugin` |
| 045     | `045_marketplace_sources.ts`         | Creates `marketplace_sources`, migrates `pluginMarketplaceUrls`, and adds marketplace provenance columns to `installed_plugins` |
| 099     | `046_agent_resume_identity.ts`       | Creates `agent_resume_identities` for guarded native session resume identity |

Fresh installs get the current baseline from `001_init`; existing databases run the later migrations to pick up feature-specific tables and columns.

### Backend Migration 016: Cloud Storage Local Mirror Cache

Cloud storage uses local cache tables for connection metadata, indexed items, and content
materialization jobs. Local Immich credentials remain in the existing `settings` table; these
tables store connection/item metadata and job state only.

```sql
CREATE TABLE IF NOT EXISTS cloud_storage_connections_cache (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_email TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  capabilities_json TEXT,
  connected_at TEXT NOT NULL,
  last_synced_with_site_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cloud_storage_connections_cache_provider_status
  ON cloud_storage_connections_cache(provider, status);

CREATE TABLE IF NOT EXISTS cloud_storage_items_cache (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  root_id TEXT,
  provider_item_id TEXT NOT NULL,
  parent_provider_id TEXT,
  name TEXT,
  mime_type TEXT,
  item_type TEXT NOT NULL,
  size_bytes INTEGER,
  web_url TEXT,
  etag TEXT,
  revision TEXT,
  content_hash TEXT,
  modified_at TEXT,
  deleted_at TEXT,
  metadata_json TEXT,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (connection_id)
    REFERENCES cloud_storage_connections_cache(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_storage_items_cache_connection_provider_item
  ON cloud_storage_items_cache(connection_id, provider_item_id);

CREATE INDEX IF NOT EXISTS idx_cloud_storage_items_cache_root_parent
  ON cloud_storage_items_cache(root_id, parent_provider_id);

CREATE INDEX IF NOT EXISTS idx_cloud_storage_items_cache_connection_deleted
  ON cloud_storage_items_cache(connection_id, deleted_at);

CREATE TABLE IF NOT EXISTS cloud_storage_content_jobs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  provider_item_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  materialized_path TEXT,
  content_fingerprint TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id)
    REFERENCES cloud_storage_connections_cache(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cloud_storage_content_jobs_status_updated
  ON cloud_storage_content_jobs(status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_storage_content_jobs_connection_item_fingerprint
  ON cloud_storage_content_jobs(connection_id, provider_item_id, content_fingerprint);
```

### Backend Migration 017: Cloud Storage Local Cursors

Long-poll sync stores one cursor per connection/root pair:

```sql
CREATE TABLE IF NOT EXISTS cloud_storage_local_cursors (
  connection_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  last_change_id_seen TEXT,
  last_polled_at TEXT,
  PRIMARY KEY (connection_id, root_id),
  FOREIGN KEY (connection_id)
    REFERENCES cloud_storage_connections_cache(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cloud_storage_local_cursors_polled
  ON cloud_storage_local_cursors(last_polled_at);
```

### Backend Migration 018: Cloud Storage Local Path Mappings

Immich LAN bridge mappings connect an Immich server-side original path prefix to a mounted
local directory. Verification fields are written only by the backend verification flow.

```sql
CREATE TABLE IF NOT EXISTS cloud_storage_path_mappings_local (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  immich_path_prefix TEXT NOT NULL,
  local_mount_path TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verification_hash TEXT,
  last_error TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (connection_id)
    REFERENCES cloud_storage_connections_cache(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_storage_path_mappings_connection_prefix
  ON cloud_storage_path_mappings_local(connection_id, immich_path_prefix);

CREATE INDEX IF NOT EXISTS idx_cloud_storage_path_mappings_connection_disabled
  ON cloud_storage_path_mappings_local(connection_id, disabled);
```

### Backend Migration 034: Assets Catalog (v91)

The centralized Assets Catalog index. See [Assets Catalog](../backend/assets-catalog.md)
for the subsystem detail.

| Table                       | Purpose                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`                    | Unified asset row across `local_fs`, cloud-storage, personal-media, and stock sources. Holds kind, mime, dimensions, duration, content hash, perceptual hash, captions, OCR text, transcript, EXIF, GPS, provenance, and indexing state |
| `asset_tags`                | User and ingest-time tags (`(asset_id, tag)` PK)                                                                                                                                                                                                   |
| `asset_collections`         | User-created groupings                                                                                                                                                                                                                             |
| `asset_collection_items`    | Ordered membership of assets in a collection                                                                                                                                                                                                       |
| `asset_attachments`         | Records which scope (task, video project, design project, message) an asset is attached to and the attachment role                                                                                                                                 |
| `assets_fts` (FTS5)         | Virtual table over title/description/caption/OCR text/transcript/tag blob with porter unicode61 tokenizer                                                                                                                                          |
| `asset_embeddings`          | Per-modality, per-model embedding pointer rows                                                                                                                                                                                                     |
| `assets_embedding_config`   | Active embedding model + dim per modality; tracks reencode status                                                                                                                                                                                  |
| `asset_sync_state`          | Per-connection sync cursors for connector-driven catalog sync                                                                                                                                                                                      |
| `asset_jobs`                | Background job records for ingest, sync, materialize, and reencode work                                                                                                                                                                            |
| `assets_vec_768` (vec0)     | sqlite-vec virtual table for 768-dim embeddings; created only when `sqlite-vec` is loadable (presence recorded in `settings.assets.vec_available`)                                                                                                 |

Key indexes: `idx_assets_content_hash`, `idx_assets_kind`, `idx_assets_captured_at`,
`idx_assets_source`, `idx_assets_connection(connection_id, source_id)`,
`idx_assets_modified_at`, and a partial unique index
`idx_assets_local_content_hash_unique` that deduplicates live local-FS assets by
content hash.

### Backend Migration 035: Assets Materialization Cache (v92)

Adds the byte cache, project-scoped materialization records, sized proxies, and
preview artifacts (filmstrips, waveforms, posters) that back the `/assets/:id/raw`,
`/proxy/:preset`, `/filmstrip`, `/waveform`, and `/poster` routes.

| Table                       | Purpose                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset_cache`               | Content-hash-keyed byte cache under `<workDir>/.neuma/assets/cache/`. Tracks bytes, MIME, fetch/last-used timestamps, origin provider, and source-file hint     |
| `asset_materializations`    | Per-scope (`scope`, `scope_id`) record that an asset's bytes are materialized into a project workspace. Holds active path, content hash, byte cost, license snapshot, and idempotency key |
| `asset_proxies`             | Sized/transcoded proxy variants per `(content_hash, preset)` with byte cost, dimensions, duration, generated/last-used timestamps                              |
| `asset_preview_artifacts`   | Auxiliary preview blobs (filmstrip, waveform, poster) keyed by `(content_hash, kind)`                                                                          |

Seeds defaults in `settings`:

- `assets.materialize_session_budget_bytes` = 5 GiB
- `assets.materialize_project_budget_bytes` = 20 GiB
- `assets.cache_max_bytes` = 50 GiB
- `assets.cache_ttl_days` = 90
- `assets.materialize_concurrency` = 3
- `assets.proxy_thresholds_json` — pixel/duration/byte thresholds that gate proxy generation
- `assets.range_download_min_bytes` = 32 MiB — threshold for switching to ranged downloads

### Backend Migrations 036-099: Agent Resume, Plugins, and Video Mode Runtime State

These migrations add resumability, workspace-root stability for Video Mode projects,
marketplace source management, plugin configuration, task plugin snapshots, and
the state needed for reusable video plugins, visual frame search, and guarded native
session replay.

| Table / Column                    | Purpose                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tasks.agent_session_id`          | Provider/runtime session id used to resume a task with the same underlying agent session         |
| `agent_resume_identities`         | Per-task provider/model/workspace identity for the recorded native session id                    |
| `video_projects.workspace_root`   | Root workspace path captured when the video project is created or first loaded                   |
| `installed_plugins.trust_tier`    | Trust tier used by plugin runtime gates (`local`, `bundled`, `saved`, `imported`, etc.)          |
| `installed_plugins.manifest_digest` | Digest of the domain manifest used for review and capability gating                            |
| `installed_plugins.last_reviewed_digest` | Last manifest digest explicitly reviewed by the user                                      |
| `installed_plugins.source_marketplace_id` | Marketplace source row that supplied the installed plugin                                |
| `installed_plugins.source_entry_name` | Catalog entry name used during install                                                   |
| `installed_plugins.source_entry_version` | Catalog entry version at install/update inspection time                                |
| `installed_plugins.marketplace_trust` | User-assigned source trust captured when the plugin was installed                         |
| `plugin_config_values`           | Non-secret plugin config values plus secret-name references for secret fields                   |
| `marketplace_sources`            | Persisted plugin marketplace catalog URLs, trust level, refresh metadata, and plugin counts     |
| `tasks.applied_plugin_id`        | Task plugin id selected for a task run                                                          |
| `tasks.applied_plugin_snapshot_json` | Redacted applied task plugin snapshot recorded when the run starts                         |
| `video_intent_log.applied_plugin_json` | Applied video plugin snapshot recorded with an agent turn                                  |
| `video_agent_history`             | Opaque per-project Video agent dock message history                                              |
| `video_plugin_candidates`         | Reusable plugin suggestions derived from successful non-trivial video plugin runs                |
| `media_frames`                    | Per-project visual frame captions, tags, thumbnails, and embedding metadata for frame search     |
| `media_frames_fts`                | FTS5 virtual table over frame captions/tags/source ids with insert/update/delete triggers        |
| `vec_media_frames`                | Optional sqlite-vec virtual table created by memory initialization when vector search is available |

```sql
CREATE TABLE IF NOT EXISTS video_plugin_candidates (
  id                    TEXT PRIMARY KEY,
  plugin_id             TEXT REFERENCES installed_plugins(id) ON DELETE SET NULL,
  source_plugin_id      TEXT,
  project_id            TEXT NOT NULL,
  session_id            TEXT,
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  confidence            REAL NOT NULL DEFAULT 0,
  status                TEXT NOT NULL CHECK (status IN ('active', 'dismissed', 'saved')),
  applied_snapshot_json TEXT NOT NULL,
  manifest_digest       TEXT,
  draft_manifest_path   TEXT,
  saved_plugin_id       TEXT REFERENCES installed_plugins(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_plugin_candidates_project_status
  ON video_plugin_candidates(project_id, status);

CREATE TABLE IF NOT EXISTS video_agent_history (
  project_id    TEXT PRIMARY KEY,
  messages_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_frames (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  source_id        TEXT,
  asset_id         TEXT,
  at_ms            INTEGER NOT NULL,
  start_ms         INTEGER,
  end_ms           INTEGER,
  caption          TEXT NOT NULL,
  tags_json        TEXT,
  thumb_base64     TEXT,
  caption_provider TEXT,
  caption_model    TEXT,
  embedding_model  TEXT,
  embedding_dim    INTEGER,
  embedded_at      TEXT,
  indexed_at       TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS media_frames_fts USING fts5(
  caption,
  tags,
  asset_id,
  source_id,
  content='media_frames',
  content_rowid='rowid',
  tokenize='unicode61'
);
```

### Historical Migrations (pre-consolidation)

Prior to consolidation, migrations 001–020 added features incrementally:

| Version | Description                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 001     | Initial schema — `sessions`, `tasks`, `messages`, `files`, `settings`                                                                                                                |
| 002     | Memory system — `memories`, `embedding_cache`, `session_memory_chunks`                                                                                                               |
| 003     | Gateway tables — `gateway_channels`, `gateway_identities`, `gateway_identity_channels`, `gateway_sessions`, `gateway_messages`, `gateway_subscriptions`, `gateway_audit_log`         |
| 004     | Projects and goals — `projects`, `goals`                                                                                                                                             |
| 005     | Task hierarchy — `task_links`, `task_comments`; extends `tasks` with `project_id`, `goal_id`, `parent_task_id`, `priority`, `labels`, `blocked_reason`                               |
| 006     | Activity events — `activity_events` (append-only audit log)                                                                                                                          |
| 007     | Media versions — `media_versions`                                                                                                                                                    |
| 008     | Agent profiles — `agent_profiles`; extends `tasks` with `assignee_profile_id`, `queue_status`                                                                                        |
| 009     | User templates — `user_templates`                                                                                                                                                    |
| 010     | Agent profile avatar icon — adds `avatar_icon` to `agent_profiles` (idempotent patch)                                                                                                |
| 011     | Task queue priority — adds `queue_priority` to `tasks`, composite queue index                                                                                                        |
| 012     | Budget policies — `budget_policies`, `budget_spend_cache`                                                                                                                            |
| 013     | File snapshots — `file_snapshots` for agent-written file diffs                                                                                                                       |
| 014     | Task documents — `task_documents`, `task_document_history` with auto-versioning trigger                                                                                              |
| 015     | Approvals — `approvals` table for durable human-in-the-loop gates                                                                                                                    |
| 016     | Channel plugin tables — `channel_config`, `channel_users`, `channel_pairing_codes`                                                                                                   |
| 017     | WebUI sessions — `webui_sessions` for JWT refresh-token rotation                                                                                                                     |
| 018     | Channel consolidation — extends `channel_users`/`channel_config` with security columns, adds `channel_sessions`/`channel_messages`/`channel_audit_log`, drops all `gateway_*` tables |
| 019     | Channel model — adds `model TEXT` column to `channel_config` for per-channel model selection                                                                                         |
| 020     | Pricing billing type — adds `default_billing_type TEXT NOT NULL DEFAULT 'api'` to `model_pricing` for per-model billing mode (`api` \| `subscription` \| `free`)                     |

### Selected Recent Migrations

#### Migration 003: Multi-Bot Instance Support

```sql
-- Human-readable bot name
ALTER TABLE channel_config ADD COLUMN name TEXT DEFAULT NULL;

-- config_id links child tables to specific bot instances
ALTER TABLE channel_users ADD COLUMN config_id TEXT DEFAULT NULL;
ALTER TABLE channel_sessions ADD COLUMN config_id TEXT DEFAULT NULL;
ALTER TABLE channel_messages ADD COLUMN config_id TEXT DEFAULT NULL;
ALTER TABLE channel_audit_log ADD COLUMN config_id TEXT DEFAULT NULL;
ALTER TABLE channel_pairing_codes ADD COLUMN config_id TEXT DEFAULT NULL;

-- Backfill config_id from platform-matched configs
-- Re-key unique indexes: (platform, ...) → (config_id, ...)
CREATE UNIQUE INDEX idx_channel_users_config ON channel_users(config_id, platform_user_id);
CREATE UNIQUE INDEX idx_channel_sessions_config_key ON channel_sessions(config_id, session_key);
CREATE UNIQUE INDEX idx_channel_messages_config_dedup ON channel_messages(config_id, platform_message_id) WHERE platform_message_id IS NOT NULL;
CREATE INDEX idx_channel_config_platform ON channel_config(platform);
```

#### Migration 008: Gateway Routing Rules

```sql
ALTER TABLE agent_profiles ADD COLUMN routing_hints TEXT DEFAULT '{}';

CREATE TABLE IF NOT EXISTS gateway_channels (
  id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'disconnected',
  last_error TEXT,
  last_connected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '*',
  channel_id TEXT NOT NULL DEFAULT '*',
  chat_pattern TEXT NOT NULL DEFAULT '*',
  intent TEXT NOT NULL DEFAULT '*',
  profile_id TEXT NOT NULL,
  model_override TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Migration 009: Recall Audit

```sql
CREATE TABLE IF NOT EXISTS recall_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'hybrid',
  query TEXT,
  recalled_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### Migration 010: Workspace RAG

```sql
CREATE TABLE IF NOT EXISTS workspace_chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  symbol TEXT,
  language TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS workspace_chunks_fts USING fts5(
  content,
  path,
  symbol,
  content='workspace_chunks',
  content_rowid='rowid'
);
```

---

_See also: [State Management](../frontend/state-management.md) · [Desktop Shell](../desktop/index.md) · [Memory System](../backend/memory.md) · [Channel Plugins](../backend/channels.md)_
