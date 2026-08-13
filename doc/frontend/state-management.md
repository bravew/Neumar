---
summary: "React state patterns (Context API, hooks, local state), database abstraction layer (SQLite + IndexedDB), and data flow architecture"
read_when:
  - Understanding how state flows through the application
  - Working with the database layer
  - Adding new persistent data or settings
title: "State Management"
---

# State Management

## State Patterns

The frontend uses a mix of React built-in state management and lightweight external stores:

| Pattern | Scope | Examples |
|---------|-------|---------|
| **Context API** | App-wide | `ThemeContext`, `LanguageContext`, `SidebarContext` |
| **CopilotKit** | Thread-scoped | AG-UI V2 agent state (`useAgent()` from CopilotKit) |
| **Zustand** | Thread cache | `thread-store.ts` — per-task AG-UI message state with LRU eviction |
| **Zustand** | Branch state | `branch-store.ts` — per-task conversation branching selections and fork metadata |
| **useSyncExternalStore** | OS-level | System theme detection (dark/light mode media query) |
| **Custom hooks** | Feature-scoped | `useAgent` (V1), `useProviders`, `useVitePreview` |
| **Local state** | Component-scoped | `useState`, `useRef` for per-component data |
| **Database** | Persistent | SQLite/IndexedDB for sessions, tasks, messages, settings |
| **In-memory cache** | Performance | `settingsCache` map for synchronous settings access |

Context providers use React 19's `<Context value={...}>` syntax (replacing the legacy
`<Context.Provider>` pattern) and memoize values with `useMemo` to prevent unnecessary
re-renders.

### AG-UI V2 Thread Store (Zustand)

The V2 task view introduces a Zustand store (`src/shared/stores/thread-store.ts`) for per-task message state:

- **LRU cache** — max 10 cached threads; oldest evicted on overflow
- **Source of truth** — for **inactive** threads only; active threads use CopilotKit agent state directly
- **Hydration** — re-hydrated from DB on next visit via `useV2TaskLoader`
- **Snapshot on unmount** — `AgUiProvider` snapshots agent state to Zustand when unmounting (survives provider destruction)
- **Live updates** — `useThreadSync` pushes SSE events into the store for reconnected threads

### Branch Store (Zustand)

`src/shared/stores/branch-store.ts` manages conversation branching state per task:

- **Per-task state** — `taskBranches[taskId]`: `activeBranchId`, `branchSelections` (fork point id → branch id), `branchMeta[]` (`branchId`, `forkPointId`, `messageCount`)
- **Actions:**
  - `selectBranchAtFork(taskId, forkPointId, branchId)` — Select which branch to follow at a fork point
  - `setActiveBranch(taskId, branchId)` — Set the active branch for a task
  - `setBranchMeta(taskId, meta[])` — Set branch metadata (for richer fork UI)
  - `addBranch(taskId, branchId, forkPointId)` — Register a new branch (from edit/regenerate/fork operations)
  - `clearTask(taskId)` — Clear all branch state for a task
- **Relationship to DB:** Branches are persisted in the `messages` table via `branch_id` and `parent_message_id` columns. The Zustand store tracks UI-level selection state only — which branch path to display at each fork point

## Data Flow Pattern

```
User Input → Custom Hook (useAgent) → API Call (SSE) → Stream Processing
    │                                                        │
    ▼                                                        ▼
  Local State ◄────────────────────────────────────── Parsed Messages
    │                                                  (display only)
    ▼
  Component Re-render            API Server persists messages to DB
                                 & publishes to TaskEventBus
                                        │
                                        ▼
                                 Observer SSE clients
                                 (cross-client view)
```

**Key architectural note:** The **backend is the single source of truth** for message
persistence. The frontend only displays messages from the SSE stream; it does not write
agent messages to the database. This eliminates duplicate writes and ensures consistency
across multiple clients observing the same task.

## Database Abstraction Layer

The `src/shared/db/database.ts` module implements a **dual-backend storage abstraction**:

```
┌─────────────────────────────────────────────┐
│          Unified Database API               │
│  (createSession, saveTasks, getMessages...) │
└────────────┬───────────────┬────────────────┘
             │               │
     ┌───────▼───────┐ ┌────▼──────────┐
     │    SQLite      │ │   IndexedDB   │
     │ (Tauri plugin) │ │  (Browser)    │
     └───────────────┘ └───────────────┘
```

**Environment detection:** checks for `window.__TAURI_INTERNALS__` to select the backend.

**Schema** (9 tables + 3 virtual tables):

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `sessions` | id, prompt, task_count, timestamps | Group related tasks |
| `tasks` | id, session_id, prompt, status, cost, duration, work_dir | Individual task records |
| `messages` | id, task_id, type, content, tool_name, message_id, attachments | Agent message history |
| `files` | id, task_id, name, type, path, is_favorite | Generated file library |
| `media_versions` | id, task_id, artifact_id, version_number, path, type | Artifact version tracking |
| `settings` | key, value, updated_at | User preferences |
| `memories` | id, content, category, importance, source, has_embedding | Long-term memory records |
| `embedding_cache` | content_hash, model, embedding (BLOB), dim | Embedding dedup cache |
| `session_memory_chunks` | id, task_id, chunk_index, content, has_embedding | Session transcript chunks |
| `vec_memories` | memory_id, embedding (virtual — sqlite-vec) | Vector ANN index for memories |
| `vec_session_chunks` | chunk_id, embedding (virtual — sqlite-vec) | Vector ANN index for session chunks |
| `memories_fts` | content (virtual — FTS5) | Full-text search index for memories |

## Settings Layer

The settings layer (`settings.ts`) provides:
- **Three-tier caching:** in-memory map → localStorage → database
- **Synchronous reads** via cache, asynchronous writes to all tiers
- **Backend sync** via `POST /providers/settings/sync` for API-side config

Notable settings added in this branch:

| Key | Type | Default | Synced to API | Description |
|-----|------|---------|---------------|-------------|
| `ptcEnabled` | `boolean` | `false` | Yes | Enable Programmatic Tool Calling (batch mode) for agents |
| `sessionBudgetEnabled` | `boolean` | `true` | Yes | Enable per-session cost cap and loop detection |
| `maxSessionCostUsd` | `number` | `10` | Yes | Maximum cost per session in USD |
| `maxToolCallsPerMinute` | `number` | `20` | Yes | Tool call rate limit for loop detection |

### Additional Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `agent_profiles` | id, name, runtime_id, status, system_prompt, default_model, allowed_delegates | Agent persona presets |
| `user_templates` | id, name, category, system_prompt, suggested_model, skills, starter_prompts | Assistant template presets |

Tasks table extended with `assignee_profile_id` (FK to agent_profiles) and `queue_status` (`unassigned`, `queued`, `picked_up`, `paused_approval`, `done`).

---

*See also: [Frontend Overview](index.md) · [Hooks & Utilities](hooks.md) · [Database Schema](../reference/database-schema.md)*
