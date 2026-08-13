# Database Schema

Neuma uses **SQLite** as its primary database, accessed via `tauri-plugin-sql` in the desktop app and directly via `better-sqlite3` in the API server. The schema is versioned with sequential migrations.

---

## Migrations

| Migration | Version | Changes |
|---|---|---|
| `001_initial` | 1 | Core tables: sessions, tasks, messages, files, media_versions, settings |
| `002_message_costs` | 2 | Add cost/usage columns to messages |
| `003_cache_tokens` | 3 | Add cache token columns |

---

## Core Tables

### `sessions`

Top-level container for related tasks.

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  prompt      TEXT,                    -- Initial user prompt (summary)
  task_count  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

### `tasks`

Individual agent task within a session.

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  task_index  INTEGER DEFAULT 0,       -- Position within session
  prompt      TEXT,                    -- Full user prompt
  title       TEXT,                    -- Agent-generated title
  work_dir    TEXT,                    -- Workspace directory for this task
  status      TEXT DEFAULT 'pending',  -- pending | running | done | error | cancelled
  cost        REAL DEFAULT 0,          -- Total USD cost
  duration    INTEGER,                 -- Execution time in ms
  favorite    INTEGER DEFAULT 0,       -- Bookmarked by user
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_session_id ON tasks(session_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
```

**Status values:**
| Status | Description |
|---|---|
| `pending` | Task created, not yet started |
| `running` | Agent actively executing |
| `done` | Completed successfully |
| `error` | Failed with an error |
| `cancelled` | Aborted by user |

### `messages`

Individual SSE messages from the agent, persisted in order.

```sql
CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  type            TEXT NOT NULL,      -- text | tool_use | tool_result | plan | result | error | done
  content         TEXT,               -- Message body
  tool_name       TEXT,               -- For tool_use messages
  tool_input      TEXT,               -- JSON tool input
  tool_output     TEXT,               -- JSON tool output
  tool_use_id     TEXT,               -- Correlation with tool_result
  subtype         TEXT,               -- Agent-specific subtype
  error_message   TEXT,               -- For error messages
  attachments     TEXT,               -- JSON array of attachment paths
  message_id      TEXT UNIQUE,        -- Dedup key from upstream API
  cost            REAL,               -- Per-message cost in USD
  usage_input     INTEGER,            -- Input tokens
  usage_output    INTEGER,            -- Output tokens
  usage_cache_read       INTEGER,     -- Cache read tokens
  usage_cache_creation   INTEGER,     -- Cache creation tokens
  model           TEXT,               -- Model ID that generated this message
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_task_id ON messages(task_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE UNIQUE INDEX idx_messages_message_id ON messages(message_id)
  WHERE message_id IS NOT NULL;
```

The `message_id` unique index enables **idempotent message persistence** — replaying SSE events (e.g., on reconnect) will not create duplicate rows.

### `files`

Agent-generated artifacts.

```sql
CREATE TABLE files (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  name        TEXT NOT NULL,           -- Display filename
  type        TEXT,                    -- MIME type or 'code' | 'html' | 'pdf' | etc.
  path        TEXT,                    -- Absolute path to file
  preview     TEXT,                    -- Preview content (text/HTML snippet)
  thumbnail   TEXT,                    -- Base64 thumbnail for images
  is_favorite INTEGER DEFAULT 0
);

CREATE INDEX idx_files_task_id ON files(task_id);
```

### `media_versions`

Version history for generated images and videos.

```sql
CREATE TABLE media_versions (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id),
  artifact_id         TEXT NOT NULL,       -- Associated file ID
  version_number      INTEGER NOT NULL,
  path                TEXT NOT NULL,       -- Absolute path
  prompt              TEXT,                -- Generation prompt
  previous_version_id TEXT,               -- For edit chains
  type                TEXT                 -- 'image' | 'video'
);
```

### `settings`

Key-value application configuration.

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Common keys:

| Key | Description |
|---|---|
| `workDir` | Default workspace directory |
| `language` | UI language (`en` / `zh` / `es` / `fr`) |
| `theme` | UI theme (`light` / `dark` / `system`) |
| `activeProvider` | Active AI provider ID |
| `memoryEnabled` | Memory system toggle |
| `embeddingProvider` | Embedding model (`local` / `openai` / `gemini`) |

---

## Memory Tables

### `memories`

```sql
CREATE TABLE memories (
  id               TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  category         TEXT DEFAULT 'other',  -- preference | fact | decision | entity | other
  importance       REAL DEFAULT 0.5,       -- 0.0 to 1.0
  source           TEXT,                   -- auto | manual | llm
  session_id       TEXT,
  access_count     INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  has_embedding    INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_memories_category ON memories(category);
CREATE INDEX idx_memories_importance ON memories(importance);
CREATE INDEX idx_memories_has_embedding ON memories(has_embedding);
```

### `embedding_cache`

Caches computed embedding vectors to avoid recomputing.

```sql
CREATE TABLE embedding_cache (
  content_hash  TEXT NOT NULL,   -- SHA-256 of content
  model         TEXT NOT NULL,   -- Provider + model ID
  embedding     BLOB NOT NULL,   -- Float32Array serialized
  dim           INTEGER NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (content_hash, model)
);
```

### `session_memory_chunks`

Chunked transcripts for session-level memory indexing.

```sql
CREATE TABLE session_memory_chunks (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  chunk_index  INTEGER NOT NULL,
  content      TEXT NOT NULL,
  token_count  INTEGER DEFAULT 0,
  has_embedding INTEGER DEFAULT 0,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_chunks_task_id ON session_memory_chunks(task_id);
```

---

## Virtual Tables (Runtime-Created)

These are created by the memory service at startup — not persisted in the schema migrations.

### `vec_memories`
```sql
-- sqlite-vec extension
CREATE VIRTUAL TABLE vec_memories USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[768]  -- dimension matches active provider
);
```

### `vec_session_chunks`
```sql
CREATE VIRTUAL TABLE vec_session_chunks USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[768]
);
```

### `memories_fts`
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  id UNINDEXED,
  content,
  content='memories',
  content_rowid='rowid'
);
```

---

## Data Retention

- Tasks and messages are kept indefinitely (no automatic deletion)
- The Library page allows users to favorite files and mark tasks
- Memory eviction uses LRU when capacity is reached (configurable)
- Embedding cache grows unboundedly (cleared on reindex)

---

## Further Reading

- [[Architecture]] — Database location and access patterns
- [[Memory System]] — Virtual tables and hybrid search
- [[Backend]] — SQLite singleton and operations layer
