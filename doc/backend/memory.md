---
summary: "Long-term memory system — hybrid vector + FTS5 search, auto-recall, auto-capture, embedding providers, session indexing, cognitive memory types with temporal decay, entity graph, scoping, consolidation, MMR re-ranking, visibility (private/team), journal mode with batch distillation, token-budgeted recall, staleness hints, and LLM reranking"
read_when:
  - Working with the memory system
  - Understanding how memories are stored and recalled
  - Adding embedding providers or modifying search logic
  - Debugging memory recall or capture issues
  - Working with cognitive memory features (decay, entity graph, scoping, consolidation)
  - Working with visibility (private/team), journal mode, or LLM reranking
title: "Memory System"
---

# Memory System

The memory system provides persistent, cross-session long-term memory for AI agents.
It stores user preferences, facts, decisions, and entities, then automatically recalls
relevant context when the agent processes a new prompt. Version 2 adds cognitive memory
types with temporal decay, entity graph extraction, memory scoping, consolidation, and
MMR-based diversity re-ranking. Version 3 adds memory visibility (private/team), journal
mode with batch distillation, token-budgeted recall with staleness hints, optional LLM
reranking, and Unicode-safe FTS.

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        Claude Agent Extension                      │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Auto-Recall  │  │ Auto-Capture │  │  Memory MCP Server       │ │
│  │ (pre-query)  │  │(post-execute)│  │  (10 tools for agents)   │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬──────────────┘ │
└─────────┼─────────────────┼──────────────────────┼────────────────┘
          │                 │                      │
┌─────────▼─────────────────▼──────────────────────▼────────────────┐
│                         Memory Service                              │
│                                                                    │
│  ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ Retriever  │  │  Store    │  │  Embedder  │  │   Config     │ │
│  │ (hybrid    │  │ (CRUD +   │  │ (local /   │  │  (settings   │ │
│  │  search +  │  │  reindex) │  │  cloud)    │  │   table)     │ │
│  │  MMR)      │  │           │  │            │  │              │ │
│  └─────┬──────┘  └─────┬────┘  └─────┬──────┘  └──────────────┘ │
│        │               │             │                            │
│  ┌─────────────┐ ┌───────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │   Decay     │ │  Entity   │ │Consolidation │ │ Classifier  │ │
│  │ (temporal   │ │ Extractor │ │ (cluster +   │ │ (memory     │ │
│  │  strength)  │ │ (LLM)     │ │  merge)      │ │  typing)    │ │
│  └─────┬───────┘ └─────┬────┘ └──────┬───────┘ └─────────────┘ │
│        │               │             │                            │
│  ┌─────▼───────────────▼─────────────▼──────────────────────────┐ │
│  │                    SQLite Database                             │ │
    │  │                                                               │ │
    │  │  memories (metadata)     │  vec_memories (sqlite-vec ANN)     │ │
    │  │  memories_fts (FTS5)     │  embedding_cache (BLOB cache)      │ │
    │  │  session_memory_chunks   │  vec_session_chunks (session ANN)  │ │
    │  │  memory_entities         │  memory_entity_edges               │ │
    │  │  memory_consolidation_log│  session_journals (v3)             │ │
    │  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## Cognitive Memory Types (v2)

Version 2 introduces a cognitive type system that classifies memories by how they should
age and be maintained over time. Each memory receives a `memory_type` on creation:

| Type | Half-Life | Description |
|------|-----------|-------------|
| `episodic` | 7 days | Short-lived context: recent conversations, transient state, session-specific notes |
| `semantic` | 30 days | Durable knowledge: facts, preferences, project details, learned information |
| `procedural` | 90 days | Long-lived patterns: workflows, tool usage habits, recurring processes |
| `pinned` | Never decays | Permanent memories explicitly pinned by the user or via `memory_pin` MCP tool |

**Auto-classification** is handled by the **classifier module** (`classifier.ts`) which
exports two functions:

- `classifyMemoryType(content, source, category)` — returns the cognitive `MemoryType`
- `getDecayRateForType(memoryType, decayConfig)` — returns the appropriate decay rate
  (via `halfLifeToDecayRate()` from `decay.ts`)

Classification runs on **all** auto-captured memories regardless of the `decayEnabled`
setting. Even when decay is off, the type is stored for future use if decay is later enabled.

**Classification rules (priority order):**

1. **Source-based** (highest priority):
   - `auto_capture` with category `preference`, `decision`, or `entity` → `semantic`
   - `auto_capture` matching `EPISODIC_PATTERNS` → `episodic`
   - `auto_capture` (default fallback) → `episodic`
   - `manual` / `mcp_tool` / `api` with category `correction`, `tool_pattern`, or `workflow` → `procedural`
   - `manual` / `mcp_tool` / `api` matching `PROCEDURAL_PATTERNS` → `procedural`
   - `manual` / `mcp_tool` / `api` (default) → `semantic`
2. **Content-based** (fallback): `PROCEDURAL_PATTERNS` → `procedural`, `EPISODIC_PATTERNS` → `episodic`, else `semantic`
3. **Multilingual patterns** — classification patterns are defined for all 6 supported languages (en, zh, es, fr, hi, pt)

## Memory Scoping

Memories can be scoped to limit their visibility to specific contexts:

| Scope Type | Scope ID | Description |
|------------|----------|-------------|
| `global` | `null` | Visible everywhere (default) |
| `profile` | Profile UUID | Visible only when the matching agent profile is active |
| `project` | Project path or ID | Visible only within the matching project/workspace |
| `session` | Session UUID | Visible only within the originating session |

**DB columns:** `scope_type TEXT DEFAULT 'global'`, `scope_id TEXT DEFAULT NULL`

**Search behavior:** Retrieval always includes `global` memories plus memories matching
the current scope. For example, when profile "coding-assistant" is active, search returns
all global memories and all memories scoped to that profile.

**Consolidation boundary:** The consolidation engine never merges memories across different
scopes or across different languages. Grouping key is `(scope_type, scope_id, language)`.

### Cross-Channel Memory Isolation

When messages originate from external channels (Slack, Discord, Telegram, Lark), the memory
system uses **qualified user IDs** to ensure per-user, per-channel isolation — preventing
one user's memories from leaking into another user's context, even on the same platform.

**Qualified user ID construction** (`buildQualifiedUserId()` in `channels/workspace.ts`):

| Platform | Format | Example |
|----------|--------|---------|
| Slack | `{teamId}:{userId}` | `T04ABC:U12345` |
| Discord | `{guildId}:{userId}` | `123456:789012` |
| Lark | `{tenantKey}:{userId}` | `tenant123:ou_abc` |
| Telegram | `{userId}` | `987654` (globally unique, no qualifier) |

**Scope derivation** (`deriveMemoryScope()` in `services/agent.ts`):
Channel context is converted to a `MemoryScope` with `profileId = '{platform}:{qualifiedUserId}'`
(e.g. `slack:T04ABC:U12345`). This scope is passed to `resolveAgentContext()`, which forwards
it to `autoRecall()` so that retrieval only returns global memories plus memories matching that
specific channel user.

**Channel context flow:**

```
Channel message → buildQualifiedUserId(platform, userId, metadata)
  → channelContext.userId = qualifiedUserId
  → deriveMemoryScope({ platform, userId: qualifiedUserId })
  → MemoryScope.profileId = 'slack:T04ABC:U12345'
  → autoRecall(prompt, sessionId, memoryScope)
  → search filters: scope_type='global' OR (scope_type='profile' AND scope_id=profileId)
```

**Per-scope `/forget` command:** Channel users can run `/forget` to delete all memories
scoped to their channel identity. This calls `deleteMemoriesByScope('profile', scopeId)`
in `memory/store.ts`, removing only memories from that platform/workspace combination —
memories from other channels are unaffected.

**Per-channel workspace isolation:** Each channel thread gets its own file directory
based on the qualified user ID and thread ID, via `resolveChannelWorkDir()` in
`channels/workspace.ts`.

## Temporal Decay

Temporal decay models the natural fading of memory strength over time, inspired by the
Ebbinghaus forgetting curve.

**Formula:**

```
strength = importance × e^(-decayRate × daysSinceLastAccess)
```

Where `decayRate = ln(2) / halfLifeDays` for the memory's cognitive type.

**Spacing effect:** Accessing (recalling) a memory resets `last_accessed` to now, which
resets the decay clock. Frequently recalled memories stay strong indefinitely.

**Lifecycle states:**

| State | Condition | Behavior |
|-------|-----------|----------|
| `active` | strength >= 0.05 | Normal retrieval and display |
| `stale` | strength < 0.05 | Excluded from search results, marked in UI |
| `archived` | strength < 0.02 | Soft-deleted, eligible for permanent pruning |

**Periodic maintenance:** A daily maintenance task (`runDecayMaintenance()`) recalculates
strength for all memories and transitions stale/archived memories. Runs at most once per
24-hour period, tracked via `lastDecayRun` setting.

**Opt-in:** Decay is disabled by default. Enable via `decayEnabled: true` in memory settings.
When disabled, all memories retain full strength indefinitely (v1 behavior).

## Entity Graph

The entity graph extracts structured relationships from stored memories using LLM analysis.

**Entity types:**

- `person` — people, usernames, team members
- `project` — repositories, applications, codebases
- `technology` — languages, frameworks, libraries, tools
- `organization` — companies, teams, departments
- `concept` — abstract ideas, architectural patterns, methodologies

**Relationship types (6):**

| Relationship | Example |
|-------------|---------|
| `works_on` | "Alice works_on ProjectX" |
| `uses` | "ProjectX uses React" |
| `manages` | "Bob manages the backend team" |
| `belongs_to` | "Alice belongs_to Engineering" |
| `related_to` | "Kubernetes related_to Docker" |
| `depends_on` | "Frontend depends_on API service" |

**Entity resolution:** Entities are matched by case-insensitive name comparison. When a new
extraction produces an entity name that matches an existing one (ignoring case), the existing
entity is reused rather than creating a duplicate.

**DB tables:**

- `memory_entities` — `id`, `name`, `type`, `first_seen`, `last_seen`, `memory_ids` (JSON array)
- `memory_entity_edges` — `id`, `source_entity_id`, `target_entity_id`, `relationship`, `memory_id`, `created_at`

**Graph traversal:** `getEntityGraph(entityId, hops?)` returns a subgraph starting from the
given entity, traversing up to `hops` levels of relationships (default: 2). Returns nodes
and edges suitable for visualization.

## MMR Re-ranking

Maximal Marginal Relevance (MMR) prevents near-duplicate results from dominating the
recall set, ensuring diversity in the memories returned to the agent.

**Formula:**

```
Score(d) = λ × relevance(d) − (1 − λ) × max_similarity(d, selected)
```

Where:
- `λ` (lambda) controls the relevance-diversity tradeoff (default: **0.7**)
- `relevance(d)` is the hybrid search score (RRF) for document d
- `max_similarity(d, selected)` is the highest cosine similarity between d and any already-selected result

**CJK-aware tokenization:** The similarity computation uses character bigrams for CJK
(Chinese, Japanese, Korean) text and word-level tokenization for Latin-script text. This
ensures meaningful overlap detection across writing systems.

MMR runs as a post-processing step after RRF fusion and before the final top-N cutoff.

## Memory Consolidation

Consolidation clusters similar memories and merges them into unified summaries, reducing
redundancy and keeping the memory store compact.

**Process:**

1. **Clustering** — memories are grouped by embedding cosine similarity (threshold: **0.85**)
2. **Scope grouping** — clusters are further partitioned by `(scope_type, scope_id, language)` so memories are never merged across scopes or languages
3. **LLM merge** — each cluster is sent to a lightweight LLM to produce a single unified memory that preserves all important information
4. **Archival** — original memories are archived with `parent_id` set to the new consolidated memory's ID, maintaining full provenance

**Configuration:**

| Setting | Default | Description |
|---------|---------|-------------|
| `consolidationEnabled` | `false` | Opt-in toggle |
| `intervalDays` | `7` | Minimum days between consolidation runs |
| `minMemoriesForRun` | `50` | Minimum memory count to trigger consolidation |
| `maxMergePerRun` | `20` | Maximum clusters to merge in a single run |
| `similarityThreshold` | `0.85` | Cosine similarity threshold for clustering |

## Memory Visibility (v3)

Memories have a `visibility` field that classifies sharing intent:

| Visibility | Description |
|-----------|-------------|
| `private` | Default. Only visible to the owning user/agent |
| `team` | Shared across team members; subject to sensitive content blocking |

**Sensitive content blocking:** When `visibility === 'team'`, the store scans content with
`containsSensitiveContent()` for API key patterns, Bearer tokens, and `password`/`secret`
assignments. Matches are rejected — team-visible memories cannot store obvious secrets.

**DB column:** `memories.visibility TEXT NOT NULL DEFAULT 'private'`

**Retrieval behavior:** The retriever does not filter by visibility — it is a storage/sharing
classification plus a team safety gate, not a per-user ACL in search.

**API:** `POST /memory` accepts `input.visibility`. The `memory_store` MCP tool accepts an
optional `visibility` parameter (`private` / `team`).

## Journal Mode (v3)

Journal mode implements a memdir-inspired workflow: accumulate observations in an append-only
session log first, then batch-distill into durable memories via LLM.

### Session Journals

**`session_journals` table** (migration `006_memory_v3`):

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `session_id` | `TEXT NOT NULL` | FK to session |
| `content` | `TEXT NOT NULL` | Journal entry text |
| `created_at` | `TEXT NOT NULL` | ISO 8601 timestamp |

Index: `idx_session_journals_session (session_id, created_at)`

### Journal Accumulation

When `journalMode` is enabled, `autoCapture` in `agent-hooks.ts` only appends to the journal
(via `appendToJournal(sessionId, entry)`) instead of creating a memory directly. The v2
confidence path, classification, and immediate `createMemory` calls are skipped.

### Distillation

`distillJournal(sessionId, callLLM, clearAfter?)` converts journal entries into memories:

1. Skips if fewer than **3** journal entries
2. Sends up to **4000** chars of journal text to the LLM
3. Extracts up to **10** items with `content`, `category`, and `importance`
4. Semantic dedup via `searchMemories` at threshold **0.9**
5. Creates `auto_capture` memories (trimmed to 500 chars) and stores embeddings async
6. If `clearAfter && created > 0`, clears the journal for that session

**Trigger:** When `llmCaptureMemories` runs and `journalMode` is on with
`getJournalEntryCount(sessionId) >= 10`, distillation is invoked automatically.

### MCP Tool

`memory_journal_distill` — if journal mode is off, explains how to enable it. If on,
returns a message that distillation needs an LLM from the agent runtime. The real
distillation path is `agent-hooks` (which has access to `callLLM`).

## Token-Budgeted Recall (v3)

The `maxRecallTokens` config setting (default `1500`) caps how many tokens of recalled
memories are injected into the prompt.

**Budget enforcement in `recall.ts`:**

- Uses `~4 chars per token` estimate
- Greedily packs results: the first item always enters even if over budget; subsequent
  items must fit within the remaining budget
- Omitted-count is noted in the `<relevant-memories>` XML block

### Staleness Hints

`stalenessSuffix(createdAt)` appends English age hints to each recalled memory line:

- Recent memories: no suffix
- Older memories: "verify if old" style warnings
- Very old memories: "historical context only" annotation

`autoRecall` passes `maxRecallTokens: config.maxRecallTokens` from the persisted config.

## Soul Evolution Integration

`agent-hooks.ts` integrates with the soul self-improvement loop via the
`detectSoulCorrection()` hook. When an agent profile has `evolution.self_improving` enabled
in its soul, correction signals in user messages are detected and appended to the profile's
corrections log.

**Imported functions from `@/core/agent/soul-evolution`:**

- `detectCorrectionSignal(prompt)` — fast regex pre-scan for correction language
- `extractCorrection(prompt, callLLM)` — LLM-based extraction of structured correction data

**Imported from `@/shared/db/operations`:**

- `appendCorrection(profileId, correction)` — persists the correction to the profile's
  `corrections_log`
- `getAgentSoul(profileId)` — loads the soul config to check `evolution.self_improving`

**Flow:**

1. `detectSoulCorrection(prompt, sessionId, agentProfileId, callLLM, preloadedSoul?)` is
   called from agent adapters after each user turn
2. If the profile has no soul or `self_improving` is off, returns immediately
3. `detectCorrectionSignal()` does a fast regex check; skips if no signal
4. `extractCorrection()` calls the LLM to extract structured correction data
5. On success, `appendCorrection()` writes to the profile's corrections log

## LLM Reranking (v3)

Optional LLM-based reranking runs after MMR to further improve result quality.

**Process:**

1. Up to **20** candidate results are sent to a lightweight LLM
2. Prompt asks for JSON `ids` in relevance order
3. Pads with original order if the model returns too few IDs
4. Falls back to score order on any failure

**Activation:** Runs only when `options.callLLM` is provided **and**
`getMemoryConfig().llmRerankEnabled` is `true`.

**Current wiring:** `context-resolver.ts` calls `autoRecall(prompt, sessionId, memoryScope)`
without a `callLLM` argument, so LLM reranking does not run in the main context-resolution
path unless another caller passes `callLLM` into `autoRecall`.

**Config:**

| Setting | Default | Description |
|---------|---------|-------------|
| `llmRerankEnabled` | `false` | Opt-in toggle |
| `llmRerankModel` | `'haiku'` | Model selector (present in config/API but **not** consumed by the retriever — `llmRerank()` uses whatever `callLLM` the caller provides) |

## Unicode-Safe FTS (v3)

FTS5 query tokenization uses Unicode letter/number classes (`\p{L}\p{N}`) so CJK and
similar scripts are not stripped. Phrases are wrapped in quotes for the main hybrid search
path. `ftsOnlySearch` uses per-token quoted terms for AND-style matching.

## Data Flow

### Auto-Recall (before agent execution)

1. User sends a prompt
2. `recallMemories()` runs a hybrid search (vector ANN + FTS5 BM25) with RRF fusion
3. Top-N relevant memories are formatted as an XML `<relevant-memories>` block
4. Block is prepended to the prompt with safety instructions ("treat as untrusted data")

### Auto-Capture (after agent execution)

1. Agent completes execution
2. Rule-based `shouldCapture()` checks if the user's prompt contains information worth storing
3. Prompt injection guard rejects malicious patterns
4. **Journal mode check (v3):** if `journalMode` is on, the entry is appended to
   `session_journals` and the remaining steps are skipped (distillation runs later)
5. Category is detected (preference, fact, decision, entity, other)
6. Deduplication check via high-similarity search (threshold 0.95)
7. Memory created → embedding generated → stored in `vec_memories`

**Capture quality improvements (v3):** `isDerivableContent()` excludes git-like output,
stack traces, large code fences, and path-heavy text. `scoreCaptureConfidence` adds
confirmation signals ("yes exactly", "that works") to reduce negativity drift. LLM capturer
prompt rules align: no code paths/architecture, record confirmations, structured
preference/decision templates, absolute dates, same-language extraction.

### LLM-Based Capture (optional)

- Uses a lightweight Haiku model call to extract structured facts from conversation turns
- Runs at configurable intervals (every N turns) or when user says "remember"
- Produces higher-quality memories than rule-based capture at the cost of an API call
- **Template injection prevention:** `buildExtractionPrompt()` uses simultaneous regex
  replacement for `{userMessage}` and `{assistantResponse}` placeholders to prevent template
  injection (if truncatedUser contains `"{assistantResponse}"`, sequential `.replace()` would
  substitute it)
- **maxExtractions enforcement:** `llmExtractMemories()` enforces a configurable
  `maxExtractions` cap (default 5) via `.slice(0, maxExtractions)` on the parsed JSON array
- **Language-aware extraction:** Accepts an optional `languageHint` parameter; when provided,
  `buildExtractionPrompt()` appends a language instruction telling the LLM to extract in the
  source language without translating. The hint is sanitized (newlines stripped, capped at
  50 chars) to prevent prompt manipulation

### Flush Before Compaction

`flushMemoriesBeforeCompaction()` (in `flush.ts`) re-runs rule-based auto-capture on recent
conversation messages before context window compaction. This ensures important context is
persisted to long-term memory before the conversation is truncated.

**Invocation:** `flushIfNeeded()` in `agent-hooks.ts` triggers the flush when the total
conversation size exceeds ~16K tokens (64K chars). The caller is responsible for debounce
via an `alreadyFlushed` flag.

**Behavior:**

1. Filters to user messages only (last 10), never agent output
2. Runs `shouldCapture()` + `detectCategory()` on each
3. Dedup check at threshold 0.95 against existing memories
4. Caps at 5 new memories per flush to avoid flooding
5. Stores embeddings synchronously (awaits)

## Embedding Providers

| Provider | Model | Dimensions | Context | Latency | Cost |
|----------|-------|-----------|---------|---------|------|
| **Local** (default) | gte-multilingual-base via onnxruntime-node | 768 | 8192 tokens | ~40–60ms | Free (offline) |
| **OpenAI** | text-embedding-3-small | 1536 | 8191 tokens | ~200ms | API-priced |
| **Gemini** | text-embedding-004 | 768 | 2048 tokens | ~200ms | API-priced |

The default local model (`onnx-community/gte-multilingual-base`) supports ~75 languages
including English, Chinese, Spanish, French, Japanese, Korean, and Arabic. It runs as a
quantized ONNX model (int8, ~340 MB) via `onnxruntime-node` with `AutoTokenizer` from
`@huggingface/transformers` for tokenization. No API key or network dependency after
initial download.

**Model loading:** The ONNX embedding model is **not** bundled with the app. It downloads
automatically on first use to `~/.<slug>/cache/embeddings/` (~340 MB). The `onnxruntime-node`
native addon (`.node` + `.dylib` files) **is** bundled: `build.mjs` copies the native files to
`dist/onnxruntime/` and Tauri includes them via `bundle.resources`. At runtime, the embedder
checks for `RESOURCES_DIR` (set by Tauri for sidecars) and loads the bundled native addon from
an absolute path; in development, it uses the standard `import('onnxruntime-node')` resolution.

The embedding provider is configurable at runtime. When switching providers, the system
detects the dimension change at startup via `checkDimensionChange()` in `store.ts`:

1. Compares stored `memory.embeddingDim` with `getEmbeddingDim(provider, model)`
2. If different, calls `recreateVecTable(newDim)` which drops and recreates `vec_memories`
3. Also recreates `vec_session_chunks` if session indexing tables exist
4. Saves the new dimension to config via `saveMemoryConfig({ embeddingDim: currentDim })`
5. Triggers a non-blocking background `reindexMemories(embedOptions, force=true)`

**Reindex timeout:** `store.ts` tracks reindex start time and auto-clears hung reindex
tasks after **10 minutes** (`REINDEX_STALE_MS`). `getReindexProgress()` checks for stale
state and sets `status: 'failed'` if the timeout is exceeded (e.g., after a server crash
mid-reindex).

## Hybrid Search (Retriever)

The retriever combines two search signals using **Reciprocal Rank Fusion (RRF)**:

1. **Vector ANN** — `sqlite-vec` cosine similarity search for paraphrase matching
2. **FTS5 BM25** — SQLite full-text search for exact token matching (IDs, env vars, code symbols)
3. **RRF fusion** — combines both ranked lists without score normalization (k=60)
4. **Post-processing** — recency boost (7-day window), importance boost, access frequency boost

**FTS5 query sanitization:** The query text is sanitized before being passed to the FTS5
`MATCH` clause using a whitelist approach — only word characters (`\w`) and whitespace are
preserved; all punctuation (commas, quotes, parentheses, etc.) is stripped. This prevents
FTS5 syntax errors from special characters in user prompts.

## Embedding Cache

An `embedding_cache` table stores SHA-256(content) → embedding BLOB mappings keyed by model
name. This avoids redundant API calls when the same content is re-embedded (e.g., during
reindex). Cache invalidation happens automatically when switching embedding providers.

## Session Transcript Indexing

When enabled (`sessionIndexing: true`), the session indexer (`session-indexer.ts`) processes
completed task conversations:

- Chunks transcripts into ~400-token overlapping segments (80-token overlap)
- Stores chunks in `session_memory_chunks` with vector embeddings in `vec_session_chunks`
- Delta-based sync: only processes new tasks since last index
- Results are merged into the main retriever as virtual "session memories" with a slight
  relevance penalty vs. explicit memories

**Key functions:**

| Function | Description |
|----------|-------------|
| `indexTask(taskId, embedOptions)` | Index a single task's conversation (skip if already indexed) |
| `syncSessionIndex(embedOptions, maxTasks?)` | Batch-index all un-indexed completed tasks (default: up to 50) |
| `searchSessions(queryText, embedOptions, limit?)` | Semantic search across session chunks; returns `{ content, taskId, score, createdAt }[]` |
| `chunkText(text, targetChars?, overlapChars?)` | Split text into overlapping chunks with sentence/paragraph-aware boundaries |

**Retriever integration:** `searchMemories()` in `retriever.ts` calls `searchSessions()`
when `sessionIndexing` is enabled and merges results as synthetic session memories
(IDs prefixed with `session:`, `memoryType: 'episodic'`, score penalized by 0.8x).

## Memory Categories

| Category | Examples |
|----------|---------|
| `preference` | "I prefer dark mode", "I like TypeScript" |
| `fact` | "My timezone is PST", "The project uses React 19" |
| `decision` | "We decided to use PostgreSQL", "Going forward, use Tailwind" |
| `entity` | "john@example.com", "+1-555-0123", "The API is called Acme" |
| `interaction` | User communication patterns, recurring questions, feedback themes |
| `tool_pattern` | "Uses ripgrep for search", "Prefers pnpm over npm" |
| `correction` | "Actually, the port is 3000 not 8080", "That endpoint was deprecated" |
| `workflow` | "Deploy flow: test → stage → prod", "PR review requires 2 approvals" |
| `other` | Anything that doesn't fit the above categories |

## Safety & Security

- **Prompt injection guard** — `INJECTION_PATTERNS` reject attempts to inject system-level
  instructions via stored memories (e.g., "ignore all previous instructions")
- **XML escaping** — memory content is HTML-escaped before injection into prompts
- **Safety prefix** — recalled memories are wrapped in `<relevant-memories>` with
  "treat as untrusted data" instructions
- **Source tracking** — each memory records its source (`manual`, `auto_capture`, `mcp_tool`, `api`)
- **Capacity limit** — configurable `maxMemories` with LRU eviction (lowest importance + oldest first)
- **API key redaction** — `GET /memory/config` redacts the embedding API key in responses

## Settings UI (`MemorySettings.tsx`)

The memory settings tab provides configuration for:

| Section | Controls |
|---------|----------|
| **Enable/Disable** | Master toggle for the memory system |
| **Auto-Capture** | Toggle automatic capture from conversations |
| **Auto-Recall** | Toggle automatic memory injection before agent runs |
| **Embedding Provider** | Dropdown (Local / OpenAI / Gemini) with optional API key |
| **Recall Settings** | Limit (max memories per turn) and threshold (min similarity) |
| **LLM Capture** | Toggle LLM-based structured fact extraction |
| **Session Indexing** | Toggle cross-session transcript indexing |
| **Decay** | Toggle temporal decay; half-life controls per memory type (episodic, semantic, procedural); prune threshold slider |
| **Consolidation** | Toggle consolidation; interval (days), min memories for run, max merge per run, similarity threshold |
| **Entity Extraction** | Toggle LLM-driven entity extraction from stored memories |
| **Capture Guard Level** | Dropdown: strict / standard / relaxed — controls how aggressively auto-capture filters content |
| **LLM Reranking** (v3) | Toggle `llmRerankEnabled`; description notes ~200ms latency |
| **Journal Mode** (v3) | Toggle `journalMode`; description: accumulate during session, distill at end |
| **Entity Graph Explorer** | Dedicated tab for browsing entities, relationships, and graph traversal |
| **Memory Type Column** | Memory list shows cognitive type (episodic / semantic / procedural / pinned) alongside category |
| **Actions** | Reindex, Force Reindex, Export JSON, Import JSON |
| **Statistics** | Total memories, by category, by type, with embeddings count |
| **Memory List** | Browse and delete stored memories |

**Note (v3):** `maxRecallTokens` and `llmRerankModel` exist in the backend config API but
are not exposed in the UI settings form. `maxRecallTokens` **is** consumed by `recall.ts`
(via `applyTokenBudget()`), while `llmRerankModel` is **not** consumed by the retriever
(the reranker uses whatever `callLLM` function the caller passes in). The new toggles
(LLM Reranking, Journal Mode) use per-toggle immediate `POST` calls rather than the batch
`handleSaveAll` flow.

## Memory MCP Server

The Memory MCP Server exposes **10 tools** for agents to interact with the memory system
directly during execution (defined in `MEMORY_TOOL_NAMES` in `memory-server.ts`):

| Tool | Description |
|------|-------------|
| `memory_recall` | Hybrid search (vector + FTS5) with optional scope and type filters |
| `memory_store` | Create a new memory with content, category, importance, optional scope, and optional `visibility` (`private` / `team`) (v3) |
| `memory_forget` | Delete a memory by query or specific ID; returns candidates if multiple matches |
| `memory_list` | List memories with pagination, filtering by category |
| `memory_pin` | Pin/unpin a memory (sets `memory_type` to `pinned`, preventing decay) |
| `memory_entities` | List extracted entities with optional type filter |
| `memory_entity_graph` | Retrieve entity relationship subgraph with configurable hop depth |
| `memory_search_keyword` (v3) | FTS5 exact keyword search; useful when semantic search misses exact tokens, IDs, or env vars |
| `memory_report_drift` (v3) | Flag a memory as contradicted by current state; sets lifecycle to `stale` |
| `memory_journal_distill` (v3) | Trigger journal distillation for the current session; explains how to enable if journal mode is off |

## Database Schema (v2 + v3)

### Columns on `memories` table (added in v2 and v3)

| Column | Type | Default | Description | Version |
|--------|------|---------|-------------|---------|
| `memory_type` | `TEXT` | `'semantic'` | Cognitive type: `episodic`, `semantic`, `procedural`, `pinned` | v2 |
| `scope_type` | `TEXT` | `'global'` | Scope: `global`, `profile`, `project`, `session` | v2 |
| `scope_id` | `TEXT` | `NULL` | Identifier for the scope (profile UUID, project path, session UUID) | v2 |
| `strength` | `REAL` | `1.0` | Current decay strength (0.0 to 1.0) | v2 |
| `language` | `TEXT` | `'en'` | Detected language code of the memory content | v2 |
| `parent_id` | `TEXT` | `NULL` | Points to consolidated memory that replaced this one | v2 |
| `visibility` | `TEXT` | `'private'` | Sharing classification: `private` or `team` | v3 |

### New tables

**`memory_entities`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `name` | `TEXT NOT NULL` | Entity display name |
| `type` | `TEXT NOT NULL` | `person`, `project`, `technology`, `organization`, `concept` |
| `first_seen` | `TEXT NOT NULL` | ISO 8601 timestamp of first extraction |
| `last_seen` | `TEXT NOT NULL` | ISO 8601 timestamp of most recent extraction |
| `memory_ids` | `TEXT NOT NULL` | JSON array of memory IDs that reference this entity |

**`memory_entity_edges`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `source_entity_id` | `TEXT NOT NULL` | FK to `memory_entities.id` |
| `target_entity_id` | `TEXT NOT NULL` | FK to `memory_entities.id` |
| `relationship` | `TEXT NOT NULL` | `works_on`, `uses`, `manages`, `belongs_to`, `related_to`, `depends_on` |
| `memory_id` | `TEXT NOT NULL` | FK to `memories.id` (the memory this edge was extracted from) |
| `created_at` | `TEXT NOT NULL` | ISO 8601 timestamp |

**`memory_consolidation_log`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `run_at` | `TEXT NOT NULL` | ISO 8601 timestamp of the consolidation run |
| `clusters_found` | `INTEGER` | Number of similar-memory clusters identified |
| `clusters_merged` | `INTEGER` | Number of clusters actually merged |
| `memories_archived` | `INTEGER` | Number of original memories archived |
| `scope_type` | `TEXT` | Scope partition for this run |
| `scope_id` | `TEXT` | Scope ID partition for this run |

**`session_journals`** (v3)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `session_id` | `TEXT NOT NULL` | FK to session |
| `content` | `TEXT NOT NULL` | Journal entry text |
| `created_at` | `TEXT NOT NULL` | ISO 8601 timestamp |

### New indexes

```sql
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_scope ON memories(scope_type, scope_id);
CREATE INDEX idx_memories_strength ON memories(strength);
CREATE INDEX idx_memories_parent ON memories(parent_id);
CREATE INDEX idx_entities_type ON memory_entities(type);
CREATE INDEX idx_entities_name ON memory_entities(name COLLATE NOCASE);
CREATE INDEX idx_entity_edges_source ON memory_entity_edges(source_entity_id);
CREATE INDEX idx_entity_edges_target ON memory_entity_edges(target_entity_id);
CREATE INDEX idx_session_journals_session ON session_journals(session_id, created_at);
```

### FTS5 tokenizer upgrade

The `memories_fts` FTS5 virtual table now uses the `unicode61` tokenizer with
`remove_diacritics 2` for improved CJK (Chinese, Japanese, Korean) full-text search.
This replaces the default ASCII tokenizer and enables meaningful token matching across
all supported languages without requiring language-specific tokenizers.

## Memory Configuration (v3 additions)

Settings persisted under `memory.*` via `POST /memory/config`:

| Setting | Default | Description |
|---------|---------|-------------|
| `llmRerankEnabled` | `false` | Enable LLM-based post-MMR reranking |
| `llmRerankModel` | `'haiku'` | Model selector (present in config/API but **not** consumed by the retriever — `llmRerank()` uses whatever `callLLM` the caller provides) |
| `maxRecallTokens` | `1500` | Token budget for recalled memories in prompt; consumed by `recall.ts` via `applyTokenBudget()` and passed through `autoRecall()` in `agent-hooks.ts` as `maxRecallTokens: config.maxRecallTokens` |
| `journalMode` | `false` | Accumulate in session journal, distill later |

---

*See also: [MCP Integration](mcp.md) · [Agent System](agent-system.md) · [Database Schema](../reference/database-schema.md)*
