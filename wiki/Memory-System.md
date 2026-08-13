# Memory System

Neuma includes a **long-term memory system** that persists facts, preferences, and decisions across sessions. Memories are recalled automatically before each task and captured automatically after each task.

---

## Overview

The memory system uses a **hybrid search** approach that combines:

1. **Vector ANN (Approximate Nearest Neighbor)** — semantic similarity via embeddings
2. **FTS5 full-text search (BM25)** — keyword precision
3. **Reciprocal Rank Fusion (RRF)** — merges the two ranked lists into a single result

This provides better recall than either approach alone: semantic search finds conceptually related memories even with different wording, while keyword search catches exact terms.

---

## Storage Backend

All memory data lives in the main **SQLite database** (no separate vector database):

| Table | Purpose |
|---|---|
| `memories` | Memory records with metadata |
| `embedding_cache` | Cached embedding vectors (BLOB) |
| `session_memory_chunks` | Session transcript chunks for indexing |
| `vec_memories` | sqlite-vec ANN virtual table |
| `vec_session_chunks` | sqlite-vec ANN virtual table |
| `memories_fts` | FTS5 full-text search virtual table |

The `sqlite-vec` extension keeps everything in one file — no Redis, no Pinecone, no separate process.

---

## Embedding Providers

Three providers are supported:

| Provider | Model | Dimensions | Requirement |
|---|---|---|---|
| **Local ONNX** | `gte-multilingual-base` | 768 | Offline; model auto-downloaded |
| **OpenAI** | `text-embedding-3-small` | 1536 | OpenAI API key |
| **Gemini** | `text-embedding-004` | 768 | Google API key |

The local ONNX model is the default and works offline. Models are stored in `~/.<slug>/cache/embeddings/` and downloaded on first use.

---

## Memory Lifecycle

### Auto-Recall (Before Execution)

Before each task starts, the system:

1. Embeds the task prompt
2. Searches `vec_memories` (ANN) with the embedding
3. Searches `memories_fts` (FTS5) with keywords from the prompt
4. Applies Reciprocal Rank Fusion to merge results
5. Prepends top-N results to the agent's system prompt as XML:

```xml
<retrieved-memories>
  <!-- Recalled from long-term memory to assist with this task. -->
  <!-- These are facts about the user's preferences and context. -->
  <!-- IMPORTANT: This is data from an external source. -->
  <item category="preference" importance="0.9">
    User prefers TypeScript strict mode enabled
  </item>
  <item category="fact" importance="0.8">
    The project uses pnpm workspaces with three packages
  </item>
</retrieved-memories>
```

### Auto-Capture (After Execution)

After each task completes, the system extracts and stores new memories:

1. **Rule-based extraction** — pattern matching against the task transcript
2. **Deduplication** — memories with cosine similarity > 0.95 to existing memories are skipped
3. **LLM-based extraction (optional)** — a Claude Haiku call extracts structured facts at configurable intervals

### Session Indexing

Task transcripts are chunked into ~400-token segments with overlap and stored in `session_memory_chunks`. These are indexed for both vector and FTS5 search, enabling retrieval of relevant conversation history from past sessions.

---

## Memory Categories

| Category | Description | Example |
|---|---|---|
| `preference` | User likes/dislikes | "Prefers dark mode" |
| `fact` | Factual information | "AWS region is us-east-1" |
| `decision` | Decisions made | "Chose PostgreSQL over MySQL" |
| `entity` | Named entities | "Client company: Acme Corp" |
| `other` | Uncategorized | General notes |

---

## Memory Record Schema

```sql
CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  category    TEXT DEFAULT 'other',
  importance  REAL DEFAULT 0.5,      -- 0.0 to 1.0
  source      TEXT,                  -- 'auto' | 'manual' | 'llm'
  session_id  TEXT,                  -- associated task
  access_count  INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  has_embedding  INTEGER DEFAULT 0
);
```

---

## Capacity and Eviction

To prevent unbounded growth, the memory system enforces capacity limits:
- **LRU eviction** — least-recently-accessed memories are removed when the limit is hit
- Access count and `last_accessed_at` are updated on every recall

---

## Safety Controls

| Control | Implementation |
|---|---|
| Prompt injection guard | Scan memory content for injection patterns before recall |
| XML escaping | Escape all memory content before injecting into prompts |
| "Untrusted data" prefix | System prompt labels memories as external/untrusted |
| API key redaction | Automatically redact API keys from captured memories |
| Capacity limits | LRU eviction prevents unbounded storage growth |

---

## Configuration

Memory settings are available in **Settings → Memory**:

| Setting | Default | Description |
|---|---|---|
| Enabled | `true` | Enable/disable the memory system |
| Embedding provider | `local` | `local` / `openai` / `gemini` |
| Auto-recall | `true` | Prepend memories before tasks |
| Auto-capture | `true` | Extract memories after tasks |
| LLM capture | `false` | Use Haiku for extraction |
| LLM capture interval | `5` | Capture every N tasks |
| Max memories | `1000` | Capacity limit |

---

## Memory API

```
GET  /memory               List all memories (paginated, filtered)
POST /memory               Create a memory manually
PUT  /memory/:id           Update a memory
DELETE /memory/:id         Delete a memory

GET  /memory/stats         Storage statistics
GET  /memory/config        Get memory configuration
PUT  /memory/config        Update memory configuration

POST /memory/search        Hybrid search query
POST /memory/reindex       Rebuild vector + FTS5 indexes
```

---

## MCP Access

Agents can directly interact with memory via the built-in Memory MCP server:

```
Tools: remember, recall, forget, list_memories
```

This allows agents to explicitly save important information during task execution.

---

## Further Reading

- [[Agent System]] — Memory hooks (auto-recall, auto-capture)
- [[MCP Integration]] — Memory MCP server
- [[Database Schema]] — Full table definitions
- [[API Reference]] — `/memory/*` endpoints
