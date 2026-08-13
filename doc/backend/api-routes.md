---
summary: "Complete HTTP API route reference — all endpoints for agent, sandbox, providers, MCP, plugins, preview, link previews, files, cloud storage, linear, slack, memory, soul, search, automation, and health"
read_when:
  - Looking up a specific API endpoint
  - Adding new routes
  - Understanding the API surface area
title: "API Routes"
---

# API Routes

All agent routes use **Zod schema validation** via `@hono/zod-validator`, providing
type-safe request parsing and automatic 400 responses for malformed input. Manual
`if (!body.prompt)` checks have been replaced by schema-level `z.string().min(1)` constraints.

## Agent (V1)

| Method | Path                                                      | Description                                                       |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST` | `/agent/plan`                                             | Start planning phase (SSE stream, Zod-validated)                  |
| `POST` | `/agent/execute`                                          | Execute approved plan (SSE stream, Zod-validated)                 |
| `POST` | `/agent`                                                  | Direct execution — legacy (SSE stream, Zod-validated)             |
| `POST` | `/agent/resume`                                           | Resume a prior provider session, or start fresh if the stored resume identity no longer matches |
| `GET`  | `/agent/subscribe/:taskId`                                | Subscribe to live task updates via SSE (cross-client observation) |
| `POST` | `/agent/reply/:taskId`                                    | Send a follow-up message to a running agent (mid-run reply)       |
| `POST` | `/agent/stop/:sessionId`                                  | Cancel running task                                               |
| `GET`  | `/agent/session/:sessionId`                               | Session status                                                    |
| `GET`  | `/agent/plan/:planId`                                     | Retrieve stored plan                                              |
| `POST` | `/agent/questions`                                        | Persist a human-in-the-loop `AskUserQuestion` prompt              |
| `GET`  | `/agent/questions/pending`                                | List pending questions across active sessions                     |
| `GET`  | `/agent/sessions/:sessionId/questions/pending`            | List pending questions for one session                            |
| `POST` | `/agent/questions/:questionId/answer`                     | Answer a persisted question                                       |
| `POST` | `/agent/sessions/:sessionId/questions/:questionId/answer` | Answer a session-scoped question                                  |

## AG-UI (V2)

Standards-based agent streaming using the [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui). Events are SSE-encoded JSON with `type`, `timestamp`, `threadId`, `runId`, and `seq` (monotonic counter for ordering and deduplication).

| Method | Path                          | Description                                                                               |
| ------ | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `POST` | `/ag-ui/run`                  | Start an AG-UI run (SSE stream) — supports planning + execution phases, detached pipeline |
| `GET`  | `/ag-ui/subscribe/:taskId`    | Late-joiner subscribe — replays `MESSAGES_SNAPSHOT` + buffered events, then streams live  |
| `POST` | `/ag-ui/stop/:taskId`         | Abort a running AG-UI task                                                                |
| `GET`  | `/ag-ui/pending-plan/:taskId` | Poll for awaiting plan approval                                                           |
| `POST` | `/ag-ui/reject-plan/:taskId`  | Reject a pending plan                                                                     |
| `GET`  | `/ag-ui/history/:taskId`      | Get AG-UI message history plus task files for hydration                                   |

**Detached pipeline pattern:** The agent generator runs independently of the SSE connection. Events are unconditionally published to `TaskEventBus` and persisted to DB via `AGUIEventPersister`. The SSE handler subscribes passively — client disconnect does not abort the run.

**AG-UI event types:** `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `TEXT_MESSAGE_START/CONTENT/END`, `REASONING_MESSAGE_START/CONTENT/END`, `TOOL_CALL_START/ARGS/END`, `TOOL_CALL_RESULT`, `STATE_SNAPSHOT`, `STATE_DELTA`, `STEP_STARTED/FINISHED`, `CUSTOM`.

**Hydration and file state:** `/ag-ui/history/:taskId` validates and returns `{ messages, files }`. `/ag-ui/subscribe/:taskId` emits `MESSAGES_SNAPSHOT`, `STATE_SNAPSHOT`, and `STATE_DELTA` events with monotonic `seq` values so clients can reconnect with `Last-Event-ID`, rebuild the task file index, and ignore duplicate events.

**Media download and versioning:** The AG-UI run pipeline wraps the agent stream with `withWorkDirSync()`, which intercepts MCP media tool results (tools matching `mcp__*` with `image`, `media`, or `generate` in the name). External media URLs (`.png`, `.jpg`, `.gif`, `.webp`, `.svg`, `.mp4`, `.webm`, `.wav`, `.mp3`) are downloaded to the session workspace. If a file with the same name already exists, the existing file is moved to a `.versions/` subfolder with a timestamp suffix (e.g. `.versions/image.2026-04-05T14-30-00.png`) and a `file_snapshots` record is created for the Diff tab. URLs are SSRF-validated before download. Media-generation source attachments are also promoted into `output/<runId>/inputs/` and persisted as task files so the frontend can group inputs with generated outputs.

## CopilotKit

CopilotKit V2 runtime proxy — routes CopilotKit agent protocol to the AG-UI endpoint via loopback (`http://127.0.0.1:{port}/ag-ui/run`).

| Method | Path                                        | Description                                           |
| ------ | ------------------------------------------- | ----------------------------------------------------- |
| `GET`  | `/copilotkit/info`                          | Agent discovery (lists available agents)              |
| `POST` | `/copilotkit/agent/:agentId/run`            | Start agent run (SSE stream, proxied to `/ag-ui/run`) |
| `POST` | `/copilotkit/agent/:agentId/connect`        | Long-lived connection                                 |
| `POST` | `/copilotkit/agent/:agentId/stop/:threadId` | Abort agent run                                       |

**Stale thread recovery:** An `onBeforeRequest` middleware detects and resets stale `isRunning=true` states in CopilotKit's `InMemoryAgentRunner` global store (keyed by `Symbol.for('@copilotkitnext/runtime/in-memory-store')`). This prevents "Thread already running" errors after page refreshes, client disconnects, or SSE hangs. The middleware calls `abortRun()` and `runSubject.complete()` on the stale entry before resetting all state fields.

## Agent Runtimes

Detection, install/update guidance, and gated install/update operations for supported
local code-agent CLIs.

| Method   | Path                                  | Description                                                          |
| -------- | ------------------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/agent-runtimes`                     | Detect local runtimes and return the install/update catalog          |
| `POST`   | `/agent-runtimes/rescan`              | Invalidate detection cache and force a fresh scan                    |
| `GET`    | `/agent-runtimes/:id`                 | Detect one runtime by catalog id                                     |
| `GET`    | `/agent-runtimes/:id/install-options` | Return install options for one runtime                               |
| `GET`    | `/agent-runtimes/:id/update-options`  | Return update options for one runtime                                |
| `POST`   | `/agent-runtimes/:id/install`         | Start a confirmed install operation                                  |
| `POST`   | `/agent-runtimes/:id/update`          | Start a confirmed update operation                                   |
| `GET`    | `/agent-runtimes/operations/:id`      | Read one operation status                                            |
| `DELETE` | `/agent-runtimes/operations/:id`      | Cancel an operation when the underlying process is still cancellable |

Install/update starts require a selected method plus the command hash returned by the
options endpoint. The server recomputes and verifies the hash before running anything.

## ACP / A2A

The ACP/A2A surface is mounted before global JWT middleware because `/acp/ws` is a WebSocket route. Auth is enforced inside `acp.ts` with Bearer JWTs signed by `WEBUI_JWT_SECRET`; tokens issued before `NEUMA_BOOT_AT` are rejected. A per-identity JSON-RPC limiter returns `429` + `Retry-After` on HTTP and `-32029` JSON-RPC errors on WebSocket.

`message/send` and `message/stream` currently return task envelopes and skeleton status events; wiring the payload into the full agent loop is a follow-up.

| Method | Path                           | Description                                                                                                                                               |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/acp/a2a`                     | A2A v0.3.0 JSON-RPC endpoint. Methods: `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`                                                      |
| `WS`   | `/acp/ws`                      | ACP JSON-RPC over WebSocket. Methods: `initialize`, `authenticate`, `session/new`, `session/list`, `session/set_mode`, `session/cancel`, `session/prompt` |
| `GET`  | `/.well-known/agent-card.json` | Public A2A agent-card discovery built from active agent profiles                                                                                          |

## Sandbox

| Method | Path                   | Description                           |
| ------ | ---------------------- | ------------------------------------- |
| `GET`  | `/sandbox/available`   | Check sandbox availability            |
| `GET`  | `/sandbox/images`      | List container images                 |
| `POST` | `/sandbox/exec`        | Execute command                       |
| `POST` | `/sandbox/run/file`    | Run script file (auto-detect runtime) |
| `POST` | `/sandbox/run/node`    | Run inline Node.js code               |
| `POST` | `/sandbox/exec/stream` | Stream command execution (SSE)        |
| `POST` | `/sandbox/stop-all`    | Stop all sandbox providers            |

## Providers

| Method | Path                           | Description                                                                                                     |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/providers/sandbox`           | List sandbox providers with metadata                                                                            |
| `GET`  | `/providers/sandbox/available` | List available sandbox providers                                                                                |
| `GET`  | `/providers/sandbox/:type`     | Get specific sandbox provider details                                                                           |
| `POST` | `/providers/sandbox/switch`    | Switch sandbox provider                                                                                         |
| `GET`  | `/providers/agents`            | List agent providers with metadata                                                                              |
| `GET`  | `/providers/agents/available`  | List available agent providers                                                                                  |
| `GET`  | `/providers/agents/:type`      | Get specific agent provider details                                                                             |
| `POST` | `/providers/agents/switch`     | Switch agent provider                                                                                           |
| `POST` | `/providers/settings/sync`     | Sync frontend settings to backend                                                                               |
| `GET`  | `/providers/config`            | Get current configuration                                                                                       |
| `POST` | `/providers/models`            | Fetch live model list from a provider's API (SSRF-protected; supports OpenAI-compatible, Gemini native, Ollama) |

Sandbox provider responses include Phase 7 capability metadata when available:
`enforcement`, `supportsNetworkPolicy`, `supportsReadDeny`,
`supportsWriteAllowlist`, `supportsAuditEvents`, `marketplaceEligible`, and
`reducedIsolationReason`. The frontend uses these fields for the sandbox
security badges in Settings.

## MCP

| Method | Path                       | Description                                       |
| ------ | -------------------------- | ------------------------------------------------- |
| `GET`  | `/mcp/config`              | Read MCP configuration                            |
| `POST` | `/mcp/config`              | Write MCP configuration                           |
| `GET`  | `/mcp/path`                | Get MCP config file path                          |
| `GET`  | `/mcp/all-configs`         | Read all MCP configs (app + Claude)               |
| `POST` | `/mcp/oauth/initiate`      | Start MCP Remote OAuth flow (RFC 7591 DCR + PKCE) |
| `GET`  | `/mcp/oauth/status/:state` | Poll OAuth flow status by CSRF state token        |

## Plugins

Installable Anthropic-style plugins for skills, commands, hooks, MCP servers,
DesignMode, task flows, and VideoMode. Plugin ids contain slashes
(`user/name`, `project/name`, `bundled/name`), so plugin-id routes use
`/:id{.+}`.

| Method   | Path                                            | Description                                                                 |
| -------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `GET`    | `/plugins`                                      | List installed DB-tracked plugins; supports `scope` and `enabledOnly` query |
| `GET`    | `/plugins/discovered`                           | Full disk scan from the plugin loader                                       |
| `GET`    | `/plugins/:id`                                  | Read one installed plugin                                                   |
| `GET`    | `/plugins/:id/config`                           | Read public config values from `metadata.neuma.configSchema`                |
| `PUT`    | `/plugins/:id/config`                           | Validate and save plugin config; secret fields use the secret store         |
| `GET`    | `/plugins/:id/preview`                          | Serve a design-system plugin's `components.html` preview for sandboxed iframes |
| `POST`   | `/plugins/:id/apply`                            | Apply a plugin to `task`, `design`, or `video`; `chat` returns 501          |
| `POST`   | `/plugins/install`                              | Install from `local`, `github`, `url`, or `marketplace` source              |
| `POST`   | `/plugins/:id/enable`                           | Enable an installed or bundled plugin                                       |
| `POST`   | `/plugins/:id/disable`                          | Disable an installed or bundled plugin                                      |
| `DELETE` | `/plugins/:id`                                  | Uninstall a non-bundled plugin and delete saved config secrets              |
| `POST`   | `/plugins/scaffold`                             | Scaffold a plugin from `basic`, `with-script`, or `with-mcp` template       |
| `GET`    | `/plugins/marketplace/index`                    | Legacy merged registry response over configured marketplace sources         |
| `GET`    | `/plugins/marketplaces`                         | List persisted marketplace catalog sources                                  |
| `POST`   | `/plugins/marketplaces`                         | Add a marketplace source URL with user-assigned trust                       |
| `GET`    | `/plugins/marketplaces/available`               | Merge available catalog entries from every configured source                |
| `POST`   | `/plugins/marketplaces/:sourceId/refresh`       | Refetch one source and update plugin count / catalog version                |
| `GET`    | `/plugins/marketplaces/:sourceId/inspect?entry=...` | Pre-install inspection for GitHub-backed catalog entries                |
| `DELETE` | `/plugins/marketplaces/:sourceId`               | Remove a marketplace source                                                 |

Local installs are restricted to user home, workspace, or app dir. Network and
marketplace installs fetch into a temporary directory, validate the manifest,
enforce install caps, and stamp marketplace provenance when a source entry was
used. Marketplace source URLs are SSRF-validated and must use HTTPS except for
localhost development URLs.

## Preview

| Method | Path                      | Description                          |
| ------ | ------------------------- | ------------------------------------ |
| `GET`  | `/preview/node-available` | Check if Node.js is available        |
| `POST` | `/preview/start`          | Start Vite preview server for a task |
| `POST` | `/preview/stop`           | Stop preview server for a task       |
| `GET`  | `/preview/status/:taskId` | Get preview server status            |
| `POST` | `/preview/stop-all`       | Stop all preview servers             |

## Link Preview

Safe external preview cards for pasted links. The current frontend consumer is
VideoMode's agent dock, but the route is intentionally generic.

| Method | Path            | Description                                                    |
| ------ | --------------- | -------------------------------------------------------------- |
| `POST` | `/link-preview` | Resolve one `url` into a video, image, website, or unsupported preview |

Request body: `{ "url": "https://..." }`.

The resolver supports YouTube and Vimeo oEmbed metadata, direct HTTPS image URLs,
and generic web pages via Open Graph / Twitter card metadata. Fetches use the
external API network policy, block unsafe destinations, cap response size, and
cache normalized URLs for one hour.

## DesignMode

Local creation workspace for documents, media, decks, prototypes, templates, and
campaigns. Project files live under `<workDir>/design-projects/<design_id>/`; the
SQLite `design_projects` table is an index, and `project.json` is the manifest source
of truth.

| Method   | Path                                                      | Description                                                                             |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | `/design/projects`                                        | List DesignMode projects ordered by update time                                         |
| `GET`    | `/design/metrics`                                         | Return aggregate DesignMode metrics                                                     |
| `GET`    | `/design/dependencies`                                    | Return renderer and local binary dependency status                                      |
| `GET`    | `/design/connectors`                                      | List live-artifact connector options and readiness                                      |
| `GET`    | `/design/design-jury/status`                              | Return whether the gated Design Jury feature is enabled                                 |
| `POST`   | `/design/projects`                                        | Create a project with scaffolded local folders                                          |
| `POST`   | `/design/projects/import`                                 | Import files or ZIP archives into a new project, with archive policy checks and linting |
| `GET`    | `/design/projects/:id`                                    | Get a project manifest                                                                  |
| `PATCH`  | `/design/projects/:id`                                    | Update project metadata, brief, media settings, outputs, or status                      |
| `DELETE` | `/design/projects/:id`                                    | Tombstone and move a project folder to `.deleted/`                                      |
| `POST`   | `/design/projects/:id/touch`                              | Refresh a project `updatedAt` timestamp                                                 |
| `GET`    | `/design/projects/:id/live-artifacts`                     | List rendered live artifacts for a project                                              |
| `POST`   | `/design/projects/:id/live-artifacts`                     | Create a live HTML artifact from template/data input                                    |
| `GET`    | `/design/projects/:id/live-artifacts/:artifactId`         | Read live artifact detail, provenance, and refresh log                                  |
| `POST`   | `/design/projects/:id/live-artifacts/:artifactId/refresh` | Re-render a live artifact from its source data                                          |
| `GET`    | `/design/projects/:id/design-jury`                        | List Design Jury critique runs                                                          |
| `POST`   | `/design/projects/:id/design-jury`                        | Run gated Design Jury critique on a reviewable artifact                                 |
| `GET`    | `/design/projects/:id/files`                              | List project files recursively                                                          |
| `GET`    | `/design/projects/:id/file`                               | Read a project text file                                                                |
| `POST`   | `/design/projects/:id/file`                               | Write a project text file and run DesignMode lint                                       |
| `GET`    | `/design/projects/:id/blob`                               | Serve binary preview bytes with `no-store` and `nosniff` headers                        |
| `GET`    | `/design/projects/:id/file-location`                      | Return the absolute local path for OS open/copy actions                                 |
| `GET`    | `/design/skills`                                          | List bundled and installed DesignMode skills                                            |
| `GET`    | `/design/skills/:id/example`                              | Return a bundled skill example artifact when available                                  |
| `GET`    | `/design/skills/:id`                                      | Read one DesignMode skill                                                               |
| `GET`    | `/design/design-systems`                                  | List bundled and workspace design systems                                               |
| `POST`   | `/design/design-systems`                                  | Create a workspace custom design system                                                 |
| `GET`    | `/design/design-systems/:id`                              | Read one design system                                                                  |
| `PATCH`  | `/design/design-systems/:id`                              | Reject built-in design-system edits until workspace editing is wired                    |
| `GET`    | `/design/craft`                                           | List craft reference Markdown files                                                     |
| `GET`    | `/design/craft/:id`                                       | Read one craft reference                                                                |
| `GET`    | `/design/prompt-templates`                                | List image or video prompt templates                                                    |
| `GET`    | `/design/prompt-templates/:surface/:id`                   | Read a prompt template with its full prompt                                             |
| `POST`   | `/design/projects/:id/resolve-prompt`                     | Compose and persist resolved system/user prompts                                        |
| `POST`   | `/design/projects/:id/generate`                           | Legacy alias for starting media/document generation                                     |
| `POST`   | `/design/projects/:id/media`                              | Start image, video, audio, or document generation                                       |
| `GET`    | `/design/projects/:id/tasks`                              | List in-memory media task records for a project                                         |
| `GET`    | `/design/projects/:id/tasks/:taskId/wait`                 | Long-poll a media task and return new progress lines                                    |
| `POST`   | `/design/projects/:id/tasks/:taskId/cancel`               | Cancel a running media task                                                             |
| `GET`    | `/design/projects/:id/capabilities`                       | Return media capabilities and budget status                                             |
| `POST`   | `/design/projects/:id/edit-target`                        | Append a targeted edit instruction to project history                                   |
| `GET`    | `/design/projects/:id/comments`                           | List comments                                                                           |
| `POST`   | `/design/projects/:id/comments`                           | Add a comment, optionally attached to a preview target                                  |
| `PATCH`  | `/design/projects/:id/comments/:commentId`                | Update comment text, status, attachment, or target                                      |
| `DELETE` | `/design/projects/:id/comments/:commentId`                | Delete a comment                                                                        |
| `GET`    | `/design/projects/:id/sketches`                           | List sketch overlay files                                                               |
| `POST`   | `/design/projects/:id/sketches`                           | Save a sketch overlay                                                                   |
| `GET`    | `/design/projects/:id/exports`                            | List export records                                                                     |
| `POST`   | `/design/projects/:id/export`                             | Export with lint gating and disclosure metadata                                         |
| `GET`    | `/design/projects/:id/history`                            | Return the tail of `history.jsonl`                                                      |
| `GET`    | `/design/projects/:id/debug`                              | Return prompts, provenance, runtime tasks, render log, history, exports, and metrics    |
| `GET`    | `/design/projects/:id/metrics`                            | Return per-project DesignMode metrics                                                   |
| `GET`    | `/design/projects/:id/preview`                            | SSE preview reload stream                                                               |
| `GET`    | `/design/projects/:id/assets/:assetId/versions`           | List versions for one generated asset                                                   |
| `POST`   | `/design/projects/:id/assets/:assetId/promote-version`    | Promote an older asset version into project outputs                                     |
| `GET`    | `/design/projects/:id/assets/:assetId/provenance`         | Return provenance for one generated asset                                               |
| `POST`   | `/design/projects/:id/lint`                               | Run DesignMode lint on project content                                                  |

Imports reject unsafe ZIP entries, oversized payloads, path traversal, and P0 lint
findings unless the caller explicitly allows override. Exports are blocked by P0 lint
findings by default and include `metadata/designmode-disclosure.json` where the format
supports embedded metadata.

## Video Mode

Local video project creation, agentic editing, timeline operations, asset
materialization, render jobs, reusable video plugins, and editor handoff packages.
The full architecture is in [Video Mode Backend](video-mode.md).

| Method   | Path                                             | Description                                                                 |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `GET`    | `/video/projects`                                | List Video Mode projects                                                    |
| `POST`   | `/video/projects`                                | Create a video project from a workflow, template, script, and assets        |
| `GET`    | `/video/projects/:id`                            | Read one project manifest                                                   |
| `PATCH`  | `/video/projects/:id/settings`                   | Update project settings such as aspect ratios and YouTube acknowledgement   |
| `DELETE` | `/video/projects/:id`                            | Delete a video project                                                      |
| `GET`    | `/video/projects/:id/storyboard`                 | Read the current storyboard                                                 |
| `POST`   | `/video/projects/:id/agent`                      | Stream a storyboard/chat agent turn with model, conversation, editor context, and plugin context |
| `GET`    | `/video/projects/:id/agent-history`              | Return persisted Video agent dock messages                                  |
| `PUT`    | `/video/projects/:id/agent-history`              | Persist up to 200 Video agent dock messages                                 |
| `GET`    | `/video/projects/:id/content-graph`              | Read the HTML/Motion content graph                                          |
| `PUT`    | `/video/projects/:id/content-graph`              | Persist the HTML/Motion content graph and frame overrides                   |
| `GET`    | `/video/projects/:id/timeline`                   | Read the editable timeline and undo/redo history                            |
| `PATCH`  | `/video/projects/:id/timeline`                   | Persist the editable timeline, including markers and intro/outro bookends   |
| `POST`   | `/video/projects/:id/timeline/op`                | Apply one timeline operation under the project lock                         |
| `POST`   | `/video/projects/:id/timeline/undo`              | Undo the latest timeline operation                                          |
| `POST`   | `/video/projects/:id/timeline/redo`              | Redo the latest undone timeline operation                                   |
| `GET`    | `/video/projects/:id/intent-log`                 | List agent/editor intent log entries for the project                        |
| `POST`   | `/video/projects/:id/render`                     | Queue or start a render                                                     |
| `GET`    | `/video/projects/:id/render/status`              | Read render status for the active or latest job                             |
| `POST`   | `/video/projects/:id/render/cancel`              | Cancel a running render                                                     |
| `GET`    | `/video/projects/:id/render/subscribe`           | Resumable render-progress SSE stream                                        |
| `POST`   | `/video/projects/:id/editor-handoff`             | Queue an NLE handoff export job                                             |
| `GET`    | `/video/projects/:id/editor-handoff/:jobId`      | Read an editor-handoff job, package path, and conformance report            |
| `POST`   | `/video/projects/:id/reframe`                    | Create an alternate aspect output from the 16:9 master                      |
| `POST`   | `/video/projects/:id/music/select`               | Select or generate background music from project/style constraints          |
| `GET`    | `/video/projects/:id/usage`                      | Read per-project video usage                                                |
| `GET`    | `/video/usage`                                   | Read global video usage                                                     |
| `POST`   | `/video/projects/:id/eval`                       | Run the Video Mode eval / QA report                                         |
| `GET`    | `/video/plugins`                                 | List selectable video plugins, optionally filtered by query and limit       |
| `GET`    | `/video/plugins/:id`                             | Read one video plugin summary and manifest                                  |
| `POST`   | `/video/plugins/:id/apply`                       | Apply a video plugin and return prompt, gate, and agent context             |
| `GET`    | `/video/plugins/:id/export`                      | Export a `neuma.video-plugin.bundle.v1` plugin bundle                       |
| `POST`   | `/video/plugins/import`                          | Import a video plugin bundle into project or user scope                     |
| `GET`    | `/video/plugins/candidates`                      | List reusable video plugin candidates by project and status                 |
| `POST`   | `/video/plugins/candidates/detect`               | Detect a reusable plugin candidate from the latest applied plugin snapshot  |
| `POST`   | `/video/plugins/candidates/:candidateId/dismiss` | Dismiss a plugin candidate                                                  |
| `POST`   | `/video/plugins/candidates/:candidateId/save`    | Save a plugin candidate as an installed project or user plugin              |

## Files

### Core File Operations

| Method   | Path                     | Description                                                                                                                                                                                                            |
| -------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/files/readdir`         | Recursive directory listing (Zod-validated: `path`, `maxDepth` 0-5, default 3). Filters hidden files and common noise (node_modules, dist, .cache, lock files). Returns tree with `name`, `path`, `isDir`, `children`. |
| `POST`   | `/files/stat`            | Get file metadata (exists, isFile, isDirectory, size, mtime)                                                                                                                                                           |
| `POST`   | `/files/read`            | Read file contents as UTF-8 text                                                                                                                                                                                       |
| `POST`   | `/files/read-binary`     | Read file as base64 — returns `{ fileName, content, size }`                                                                                                                                                            |
| `POST`   | `/files/find-file`       | Recursive file search by name within a directory (max depth 5). Body: `{ name, searchDir }`. Returns `{ found: string \| null }`                                                                                       |
| `POST`   | `/files/open`            | Open file/directory in system default app (macOS `open`, Windows `explorer`/`start`, Linux `xdg-open`). Creates directory if it doesn't exist.                                                                         |
| `POST`   | `/files/open-in-editor`  | Open file in detected code editor (priority: Cursor > VS Code > VS Code Insiders > Sublime Text > system default)                                                                                                      |
| `GET`    | `/files/detect-editor`   | Detect installed code editor — returns `{ editor, command }`                                                                                                                                                           |
| `GET`    | `/files/stream`          | Stream file with HTTP Range support for video/audio seeking. Query: `path`. Returns ETag-based caching headers. Supports all common media MIME types.                                                                  |
| `DELETE` | `/files/delete-dir`      | Delete a session directory. Security: only allows paths within `~/.<app>/sessions/`.                                                                                                                                   |
| `GET`    | `/files/proxy-download`  | CORS proxy for external URLs — SSRF-validated, returns file with Content-Disposition header. Query: `url`.                                                                                                             |
| `POST`   | `/files/video-thumbnail` | Generate video thumbnail via FFmpeg. Accepts multipart upload or JSON `{ path }` for on-disk files. Max 500 MB. Seeks to 3s, falls back to frame 0. Returns base64 JPEG.                                               |

### Skills Management

| Method | Path                                 | Description                                                                                                                                       |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/files/skills-dir`                  | Get all skills directories (app, Claude, bundled) with existence status                                                                           |
| `GET`  | `/files/list-skills`                 | List installed skills with metadata (name, slug, description, source, trigger, category, icon)                                                    |
| `GET`  | `/files/skills-catalog`              | Browse paginated skills catalog — query: `search`, `page`, `pageSize`. Includes both bundled and community skills. 5-minute index cache.          |
| `GET`  | `/files/skills-catalog/:owner/:slug` | Get full detail for a catalog skill (metadata, files, version history). `owner=built-in` for bundled skills.                                      |
| `POST` | `/files/install-skill`               | Install a skill from the catalog into `~/.claude/skills/`. Body: `{ owner, slug }`. Returns 409 if already installed.                             |
| `POST` | `/files/create-skill`                | Create a new skill with SKILL.md template. Body: `{ name, description? }`. Auto-generates kebab-case slug.                                        |
| `POST` | `/files/extract-skill`               | Extract a completed task session into a reusable SKILL.md via LLM summarization (with template fallback). Body: `{ taskId, name, description? }`. |

### File Snapshots

| Method | Path                                   | Description                                                                                                                                                                     |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/files/snapshot`                      | Capture before/after snapshot for a file write. Body: `{ task_id, file_path, phase: 'before' \| 'after', snapshot_id? }`. Skips binary files. Max 1 MB, 100 snapshots per task. |
| `GET`  | `/files/snapshots/:taskId`             | List file snapshots for a task (paths + metadata, no content)                                                                                                                   |
| `GET`  | `/files/snapshots/:taskId/:snapshotId` | Get a single snapshot with full before/after content                                                                                                                            |

### Workspace Migration

| Method | Path                              | Description                                                                                                                                                 |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/files/session-stats`            | Session count and total size for a workspace directory (query: `workDir`). Also reports which migratable folders exist.                                     |
| `POST` | `/files/migrate-workspace`        | Copy workspace contents from source to dest. Validates no overlap/nesting. Returns `{ copied, errors }`.                                                    |
| `POST` | `/files/migrate-workspace-stream` | SSE-streaming version of migrate-workspace with per-file progress events.                                                                                   |
| `POST` | `/files/migrate-sessions-stream`  | SSE-streaming full workspace data migration — copies all data folders (sessions, channels, logs, cache, skills), updates task DB records, cleans up source. |
| `POST` | `/files/cleanup-workspace`        | Remove old workspace directory after migration. Depth guard prevents deleting home dir or top-level folders.                                                |

**Migratable folders** (in priority order): `sessions`, `channels`, `logs`, `cache`, `skills`.

**Workspace migration SSE events (`migrate-workspace-stream`):** `scan` (total file count), `progress` (file, copied, total, percent — throttled to 1% increments for large workspaces), `done` (success, copied, errors).

**Session migration SSE events (`migrate-sessions-stream`):** `scan` (folders, totalFiles, sessionCount), `progress` (folder, copied, total, percent — throttled to 2%), `db` (updatedTasks), `done` (success, copiedFolders, copiedFiles, updatedTasks, errors). Source folders are deleted after successful copy.

### Security

All file endpoints enforce path traversal protection via `path.resolve()` + `isAllowedPath()`. Trusted roots are recomputed per request: user home, app data dir, configured `workDir`, temp dir, and `/Volumes/` on macOS. The `proxy-download` endpoint performs SSRF validation (blocks private IPs, cloud metadata, non-HTTPS).

## Auth

### JWT Authentication (WebUI / Remote Access Mode)

Only active when the server is started with `--webui` or `WEBUI_MODE=true`. Not active in standard desktop/Tauri mode.

| Method | Path                | Description                                                            |
| ------ | ------------------- | ---------------------------------------------------------------------- |
| `POST` | `/auth/jwt/login`   | Password login — returns `{ accessToken, refreshToken }`               |
| `POST` | `/auth/jwt/refresh` | Rotate refresh token — returns new `{ accessToken, refreshToken }`     |
| `POST` | `/auth/jwt/setup`   | First-run password setup (only works if no password is configured yet) |
| `GET`  | `/auth/jwt/status`  | Returns `{ configured: boolean, authenticated: boolean }`              |

### Site Authentication (Primary)

| Method | Path                | Description                                                                                    |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| `POST` | `/auth/site/login`  | Start site login flow — spawns localhost callback server, returns `authUrl` to open in browser |
| `POST` | `/auth/site/logout` | Clear site session (remove stored tokens)                                                      |

### Connection Status & Health

| Method | Path                          | Description                                                                                   |
| ------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/auth/status`                | All connection statuses + available providers; `authenticated` = has active `site` connection |
| `GET`  | `/auth/providers`             | List configured OAuth integration providers (Google, Slack, Notion)                           |
| `GET`  | `/auth/health`                | Cached heartbeat results for all providers (`?refresh=true` for fresh check)                  |
| `GET`  | `/auth/health/:provider`      | On-demand health check for a single provider                                                  |
| `GET`  | `/auth/connections/:provider` | Get connection details + live token-expiry check for Google                                   |

### OAuth Integration Flows

| Method   | Path                          | Description                                                   |
| -------- | ----------------------------- | ------------------------------------------------------------- |
| `POST`   | `/auth/:provider/initiate`    | Start OAuth2 PKCE flow — returns `authUrl` to open in browser |
| `POST`   | `/auth/:provider/scopes`      | Request additional scopes for an existing connection          |
| `POST`   | `/auth/refresh/:provider`     | Force token refresh (supports `google` and `site`)            |
| `DELETE` | `/auth/connections/:provider` | Revoke tokens and remove connection                           |

### OAuth Credentials (User-provided)

| Method   | Path                          | Description                                    |
| -------- | ----------------------------- | ---------------------------------------------- |
| `GET`    | `/auth/credentials/:provider` | Check if user has configured OAuth credentials |
| `PUT`    | `/auth/credentials/:provider` | Save user-provided OAuth app credentials       |
| `DELETE` | `/auth/credentials/:provider` | Remove user-provided OAuth app credentials     |

## Assets Catalog

The desktop `/assets` route group is the HTTP surface of the centralized Assets Catalog
(see [assets-catalog.md](assets-catalog.md)). All bytes the agent attaches to a task,
video project, or design project flow through this group — `/cloud-storage/*` remains
the per-provider browser, while `/assets/*` is the unified index + materialized byte
store with attribution, GC, and per-project budgets.

| Method   | Path                                            | Description                                                                                                                                                |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/assets`                                       | List catalog assets with kind/source/tag/date filters and cursor pagination                                                                                |
| `GET`    | `/assets/search`                                | Hybrid search (FTS5 + embedding kNN) with filters; returns ranked assets                                                                                   |
| `GET`    | `/assets/stats/storage`                         | Storage budget snapshot — total bytes, per-scope budgets, and warning ratio                                                                                |
| `GET`    | `/assets/events`                                | SSE stream of materialization progress events (`asset.materialize.start/progress/done/cancel/error`) for live UI badges                                    |
| `POST`   | `/assets/gc`                                    | Run garbage collection over unattached assets and proxy artifacts past the retention TTL                                                                   |
| `GET`    | `/assets/attribution/:scope/:scopeId`           | Render the license/attribution block for all assets attached to a scope                                                                                    |
| `GET`    | `/assets/:id/materialize-status`                | Per-asset materialization state, cache hit, bytes downloaded, and active proxy presets                                                                     |
| `GET`    | `/assets/:id`                                   | Get one asset with full metadata, tags, provenance, and EXIF                                                                                               |
| `POST`   | `/assets`                                       | Ingest a new asset — accepts JSON (`source`, `path`/`storage_path`, hint metadata) or multipart upload (`file`, `storagePath`); deduplicates by content hash |
| `DELETE` | `/assets/:id`                                   | Soft-delete an asset; also removes attachments and triggers proxy/cache cleanup                                                                            |
| `GET`    | `/assets/:id/raw`                               | Stream original bytes with HTTP Range support                                                                                                              |
| `GET`    | `/assets/:id/thumb`                             | Serve the catalog thumbnail (generated on ingest)                                                                                                          |
| `GET`    | `/assets/:id/preview`                           | Serve the long-edge preview artifact for fast inline rendering                                                                                             |
| `GET`    | `/assets/:id/proxy/:preset`                     | Serve a sized/transcoded proxy (`preset` is one of `PROXY_PRESETS`); materializes on first hit                                                             |
| `GET`    | `/assets/:id/filmstrip`                         | Serve the video filmstrip preview artifact                                                                                                                 |
| `GET`    | `/assets/:id/waveform`                          | Serve the audio waveform preview artifact                                                                                                                  |
| `GET`    | `/assets/:id/poster`                            | Serve the video poster frame                                                                                                                               |

Ingest is bounded to a 10 MiB multipart upload (`ASSET_MULTIPART_UPLOAD_MAX_BYTES`).
Larger captures should be referenced by `storage_path` and materialized through the
local-fs connector.

## Cloud Storage

The desktop `/cloud-storage` routes mirror the site cloud-storage API and add local behavior
for self-hosted Immich media, LAN path mappings, local cache bootstrap, and content streaming.

### Connections

| Method   | Path                                   | Description                                                                                |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/cloud-storage/connections`           | List site-backed and local personal-media connections                                      |
| `POST`   | `/cloud-storage/connections`           | Create a connection; local Immich credentials are stored in the desktop settings DB        |
| `DELETE` | `/cloud-storage/connections/:id`       | Remove a local Immich connection or proxy deletion to the site                             |
| `POST`   | `/cloud-storage/connections/test`      | Test stock catalog or personal-media credentials; Immich/PhotoPrism tests run from desktop |
| `POST`   | `/cloud-storage/oauth/desktop-start`   | Start a site-managed desktop OAuth flow for cloud providers                                |
| `GET`    | `/cloud-storage/connections/:id/roots` | Get provider root selections                                                               |
| `PUT`    | `/cloud-storage/connections/:id/roots` | Save provider root selections                                                              |

### Items and Media

| Method   | Path                                                     | Description                                                                                      |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET`    | `/cloud-storage/connections/:id/items`                   | List children; supports `parentId`, `cursor`, `limit`, `includeTrashed`, and repeated `mimeType` |
| `POST`   | `/cloud-storage/connections/:id/items`                   | Create a folder or album where supported                                                         |
| `PUT`    | `/cloud-storage/connections/:id/items`                   | Multipart upload with `file`, `name`, `parentId`, `mimeType`, `overwrite`, and optional metadata |
| `GET`    | `/cloud-storage/connections/:id/search`                  | Search with query, media kind, licenses, search mode, place, camera, date, and media filters     |
| `GET`    | `/cloud-storage/connections/:id/items/:itemId`           | Get item metadata                                                                                |
| `PATCH`  | `/cloud-storage/connections/:id/items/:itemId`           | Update item metadata where supported                                                             |
| `DELETE` | `/cloud-storage/connections/:id/items/:itemId`           | Delete an item; `?permanent=true` requests permanent deletion where supported                    |
| `GET`    | `/cloud-storage/connections/:id/items/:itemId/thumbnail` | Stream an adapter thumbnail                                                                      |
| `GET`    | `/cloud-storage/connections/:id/items/:itemId/content`   | Stream item bytes with HTTP Range passthrough for image/video preview                            |
| `POST`   | `/cloud-storage/connections/:id/items/:itemId/move`      | Move an item through the site proxy                                                              |
| `POST`   | `/cloud-storage/connections/:id/items/:itemId/copy`      | Copy an item through the site proxy                                                              |
| `GET`    | `/cloud-storage/connections/:id/timeline/buckets`        | Return day/month timeline buckets when supported                                                 |

### LAN Bridge, Sync, and Indexing

| Method   | Path                                                        | Description                                                                                   |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET`    | `/cloud-storage/connections/:id/path-mappings`              | List Immich path mappings for a connection                                                    |
| `GET`    | `/cloud-storage/connections/:id/path-mappings/discovery`    | Discover local network mounts and Tailscale availability for setup hints                      |
| `POST`   | `/cloud-storage/connections/:id/path-mappings`              | Create a mapping from Immich original path prefix to local mount path                         |
| `PATCH`  | `/cloud-storage/connections/:id/path-mappings/:mappingId`   | Update a mapping; path changes reset verification and client-supplied verification is ignored |
| `DELETE` | `/cloud-storage/connections/:id/path-mappings/:mappingId`   | Delete a mapping                                                                              |
| `POST`   | `/cloud-storage/connections/:id/path-mappings/resolve-test` | Resolve or verify a sample Immich asset against candidate/local mappings                      |
| `GET`    | `/cloud-storage/connections/:id/sync`                       | Get sync status through the site                                                              |
| `POST`   | `/cloud-storage/connections/:id/sync/run`                   | Trigger sync through the site                                                                 |
| `GET`    | `/cloud-storage/connections/:id/changes`                    | Poll adapter changes                                                                          |
| `GET`    | `/cloud-storage/connections/:id/content-jobs`               | List remote content materialization jobs                                                      |
| `PATCH`  | `/cloud-storage/connections/:id/content-jobs/:jobId`        | Patch a content job status                                                                    |
| `POST`   | `/cloud-storage/index`                                      | Start site-side indexing for selected cloud content                                           |

## Linear

| Method | Path                        | Description                                                        |
| ------ | --------------------------- | ------------------------------------------------------------------ |
| `POST` | `/linear/webhook`           | Receive Linear webhooks (IP allowlist + HMAC verification + dedup) |
| `GET`  | `/linear/status`            | Integration status: connected, poller state, active pipelines      |
| `POST` | `/linear/config`            | Update Linear config (encrypts secrets, restarts poller if needed) |
| `GET`  | `/linear/config`            | Get config with secrets redacted (last 4 chars only)               |
| `GET`  | `/linear/issues`            | List assigned issues via Linear SDK                                |
| `POST` | `/linear/process/:issueId`  | Manually trigger pipeline for an issue                             |
| `GET`  | `/linear/pipeline/:issueId` | Get pipeline state for an issue                                    |
| `GET`  | `/linear/pipelines`         | Get all pipeline states                                            |
| `POST` | `/linear/test-connection`   | Test Linear API connectivity with provided key                     |
| `POST` | `/linear/polling/start`     | Start the dev-only poller                                          |
| `POST` | `/linear/polling/stop`      | Stop the poller                                                    |
| `POST` | `/linear/test-slack`        | Send test Slack notification                                       |
| `POST` | `/linear/cleanup`           | Evict completed/failed pipeline states older than TTL              |

## Slack

| Method | Path                     | Description                                                                                                                                                                                         |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/slack/config`          | Get Slack config (secrets redacted)                                                                                                                                                                 |
| `PUT`  | `/slack/config`          | Update Slack config (encrypts secrets)                                                                                                                                                              |
| `POST` | `/slack/connect`         | Connect via manual bot/user tokens (validates via auth.test)                                                                                                                                        |
| `GET`  | `/slack/gateway/status`  | Socket Mode gateway status + stats                                                                                                                                                                  |
| `POST` | `/slack/gateway/start`   | Start Socket Mode gateway + wire cowork handler                                                                                                                                                     |
| `POST` | `/slack/gateway/stop`    | Unwire cowork handler + stop gateway                                                                                                                                                                |
| `POST` | `/slack/gateway/restart` | Restart gateway with fresh config + re-wire handler                                                                                                                                                 |
| `POST` | `/slack/gateway/test`    | Test bot token connectivity                                                                                                                                                                         |
| `GET`  | `/slack/channels`        | Paginated Slack `conversations.list` wrapper for the settings channel picker. Query: `cursor`, `limit` (1–999), `exclude_archived`, `types`; maps Slack auth/scope/rate-limit errors to 401/403/429 |
| `GET`  | `/slack/sessions`        | List active cowork sessions (thread-to-agent mappings)                                                                                                                                              |

## Feedback

The feedback API is local-first: feedback is written to SQLite before any external forwarding is attempted. Bug reports include a redacted diagnostics payload with OS/process/app metadata only.

| Method | Path              | Description                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/feedback`       | Submit feedback. Body: `category` (`bug`/`feature`/`feedback`/`question`), `subject`, `description`, optional `email`, `appName`, `appVersion`. Rate limited to 10 submissions/hour per session key. Persists locally, then optionally creates a Linear issue and/or forwards to `NEUMA_FEEDBACK_ENDPOINT`. |
| `GET`  | `/feedback`       | List stored feedback. Query: `page`, `limit` (max 100), optional `category`.                                                                                                                                                                                                                                |
| `POST` | `/feedback/flush` | Retry remote forwarding for queued/failed feedback when `NEUMA_FEEDBACK_ENDPOINT` is configured.                                                                                                                                                                                                            |

## Memory

| Method   | Path                     | Description                                                         |
| -------- | ------------------------ | ------------------------------------------------------------------- |
| `GET`    | `/memory`                | List memories (optional `category`, `limit`, `offset` query params) |
| `GET`    | `/memory/stats`          | Memory statistics (total, by category, with embeddings)             |
| `GET`    | `/memory/config`         | Get memory config (API key redacted)                                |
| `POST`   | `/memory/config`         | Update memory config (Zod-validated)                                |
| `GET`    | `/memory/export`         | Export all memories as JSON                                         |
| `POST`   | `/memory/import`         | Import memories from JSON (Zod-validated, max 10K)                  |
| `GET`    | `/memory/reindex/status` | Check reindex progress                                              |
| `GET`    | `/memory/cache/stats`    | Embedding cache statistics                                          |
| `POST`   | `/memory`                | Create a memory (Zod-validated)                                     |
| `POST`   | `/memory/search`         | Hybrid semantic + keyword search (Zod-validated)                    |
| `POST`   | `/memory/reindex`        | Re-embed all memories (optional `force` query param)                |
| `GET`    | `/memory/:id`            | Get a specific memory by ID                                         |
| `PUT`    | `/memory/:id`            | Update a memory (Zod-validated)                                     |
| `DELETE` | `/memory/:id`            | Delete a memory                                                     |

## Soul

| Method   | Path                                      | Description                                           |
| -------- | ----------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/soul/templates`                         | List soul templates (query: `quickstart`, `language`) |
| `GET`    | `/soul/templates/:id`                     | Get full template details                             |
| `GET`    | `/soul/agent-profiles/:id`                | Get profile soul configuration                        |
| `PUT`    | `/soul/agent-profiles/:id`                | Update soul (Zod-validated)                           |
| `POST`   | `/soul/agent-profiles/:id/apply`          | Apply a template to a profile                         |
| `GET`    | `/soul/agent-profiles/:id/corrections`    | Get correction history                                |
| `GET`    | `/soul/agent-profiles/:id/learnings`      | Get learning history                                  |
| `DELETE` | `/soul/agent-profiles/:id/corrections`    | Clear corrections                                     |
| `POST`   | `/soul/agent-profiles/:id/auto-structure` | Convert freeform text to structured soul JSON via LLM |
| `POST`   | `/soul/agent-profiles/:id/evolve`         | Trigger soul evolution (supports `dry_run` mode)      |
| `GET`    | `/soul/agent-profiles/:id/export`         | Export soul as JSON                                   |
| `POST`   | `/soul/agent-profiles/:id/import`         | Import soul from JSON                                 |
| `GET`    | `/soul/agent-profiles/:id/preview`        | Preview rendered soul system prompt                   |

## Speech

| Method   | Path                        | Description                                                   |
| -------- | --------------------------- | ------------------------------------------------------------- |
| `POST`   | `/speech/synthesize`        | Batch TTS — returns binary audio (mp3/wav/opus/pcm/flac)      |
| `POST`   | `/speech/transcribe`        | Batch STT — multipart audio upload → JSON transcript          |
| `GET`    | `/speech/voices`            | List available TTS voices across all providers                |
| `GET`    | `/speech/capabilities`      | List configured providers and local model status              |
| `GET`    | `/speech/local/status`      | Local model download progress and state                       |
| `POST`   | `/speech/local/download`    | Trigger local model download (TTS or STT)                     |
| `POST`   | `/speech/voice-clone`       | Upload WAV to create a cloned voice                           |
| `GET`    | `/speech/voice-clone`       | List cloned voices                                            |
| `DELETE` | `/speech/voice-clone/:name` | Delete a cloned voice                                         |
| `POST`   | `/speech/voice-clone/test`  | Test a cloned voice with sample text                          |
| `WS`     | `/speech/stt/stream`        | Streaming STT — binary audio chunks in, transcript events out |
| `WS`     | `/speech/tts/stream`        | Streaming TTS — text in, binary audio chunks out              |

## Gateway

All `/gateway/*` routes are protected by a localhost-only guard (Host header check; same pattern as `/db`). Channel tokens and secrets are redacted in responses.

| Method   | Path                           | Description                                                         |
| -------- | ------------------------------ | ------------------------------------------------------------------- |
| `GET`    | `/gateway/health`              | Gateway status (running/stopped) + active channel count             |
| `GET`    | `/gateway/metrics`             | Full metrics snapshot (per-channel counters, uptime)                |
| `GET`    | `/gateway/channels`            | List all channels with runtime metrics (config tokens excluded)     |
| `GET`    | `/gateway/channels/:id/config` | Get channel config (sensitive fields redacted as `••••••••`)        |
| `POST`   | `/gateway/channels/:id/config` | Update channel config (Zod-validated, merges into `gateway.json`)   |
| `POST`   | `/gateway/channels/:id/start`  | Connect and start a specific channel                                |
| `POST`   | `/gateway/channels/:id/stop`   | Disconnect a specific channel                                       |
| `POST`   | `/gateway/channels/:id/test`   | Test channel connectivity                                           |
| `GET`    | `/gateway/identities`          | List all gateway identities with linked channel accounts            |
| `POST`   | `/gateway/identities`          | Create a new identity (alias, permission_tier, token_budget)        |
| `PUT`    | `/gateway/identities/:id`      | Update identity (alias, permission_tier, token_budget)              |
| `DELETE` | `/gateway/identities/:id`      | Delete identity                                                     |
| `GET`    | `/gateway/config`              | Get gateway-level config (channels block excluded)                  |
| `POST`   | `/gateway/config`              | Update gateway-level config (enabled, security, routing, etc.)      |
| `GET`    | `/gateway/audit-log`           | Paginated audit log (`page`, `limit`, `identity`, `action` filters) |
| `GET`    | `/gateway/subscriptions`       | List notification subscriptions                                     |
| `POST`   | `/gateway/subscriptions`       | Create a notification subscription                                  |
| `DELETE` | `/gateway/subscriptions/:id`   | Delete a subscription                                               |

## Database — Projects & Tasks

All `/db/*` routes are protected by a localhost-only guard (same pattern as `/gateway`).

### Backup Import

| Method | Path                | Description                                                                                                                                                                                                                              |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/db/import-backup` | Transactionally import JSON backup v1. Validates the full payload, upserts sessions/tasks/files, deduplicates messages by `message_id`, restores only allowlisted non-secret settings, and rolls back the whole import on fatal failure. |

### Projects

| Method   | Path                   | Description                                |
| -------- | ---------------------- | ------------------------------------------ |
| `GET`    | `/db/projects`         | List projects (optional `?status=` filter) |
| `GET`    | `/db/projects/sidebar` | Projects with recent tasks for sidebar     |
| `POST`   | `/db/projects`         | Create project (201)                       |
| `GET`    | `/db/projects/:id`     | Get project with task summary              |
| `PATCH`  | `/db/projects/:id`     | Update project                             |
| `DELETE` | `/db/projects/:id`     | Archive project (soft delete)              |

### Task Hierarchy

| Method   | Path                     | Description           |
| -------- | ------------------------ | --------------------- |
| `GET`    | `/db/tasks/:id/children` | List sub-tasks        |
| `GET`    | `/db/tasks/:id/links`    | List dependency links |
| `POST`   | `/db/tasks/:id/links`    | Create link           |
| `DELETE` | `/db/task-links/:id`     | Delete link           |
| `GET`    | `/db/tasks/:id/comments` | List comments         |
| `POST`   | `/db/tasks/:id/comments` | Create comment        |
| `DELETE` | `/db/task-comments/:id`  | Delete comment        |
| `GET`    | `/db/tasks/:id/usage`    | Token usage summary   |

### Activity & Dashboard

| Method | Path                         | Description                      |
| ------ | ---------------------------- | -------------------------------- |
| `GET`  | `/db/activity`               | Activity events (filtered)       |
| `GET`  | `/db/activity/:id`           | Single event                     |
| `GET`  | `/db/dashboard/stats`        | Task counts, project count, cost |
| `GET`  | `/db/dashboard/task-flow`    | Daily created/completed/failed   |
| `GET`  | `/db/dashboard/cost-summary` | Cost by model/provider           |

## Observability

Persisted agent-run observability is mounted at `/observability`.

| Method | Path                                       | Description                                                                                                                                                           |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/observability/tasks/:id/trace`           | List persisted trace events for a task. Query: `since` (event id cursor), `limit` (1–2000, default 500). Results are ordered by `started_at`, `created_at`, `id`.     |
| `GET`  | `/observability/tasks/:id/trace/subscribe` | SSE stream of live trace events for a task. Emits `connected` once, then `trace.event` payloads from `TaskEventBus`.                                                  |
| `GET`  | `/observability/cost`                      | Cost rollup for the dashboard. Query: `range` (`7d`, `30d`, `90d`; default `7d`) and `group_by` (`provider`, `model`, `agent`, `profile`, `day`; default `provider`). |

`/observability/cost` returns totals from `trace_events` plus message backfill and grouped rows from model-call trace events. The `source` field is currently `trace_events+messages_backfill` so callers can label mixed-source totals clearly.

## Approvals

| Method | Path                       | Description                                                                                  |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| `GET`  | `/approvals`               | List approvals (query params: `status`, `type`, `limit`, `offset`; default `status=pending`) |
| `GET`  | `/approvals/pending/count` | Returns `{ count: number }` — used for sidebar badge polling                                 |
| `GET`  | `/approvals/:id`           | Get single approval detail                                                                   |
| `POST` | `/approvals/:id/decide`    | Decide an approval: body `{ decision: 'approved' \| 'rejected', reason?: string }`           |

## Channels

All `/channels/*` routes manage the unified bot channel plugin system (Telegram, Lark/Feishu, Discord, Slack) plus the gateway adapter registry and routing rules. Bot tokens are masked to last 4 chars in responses.

### Legacy Platform Routes (Deprecated)

These routes resolve `configId` via `getChannelConfig(platform)` (first match) and are insufficient for multi-bot setups. Prefer the `/configs/:configId` routes below.

| Method   | Path                                  | Description                                                                  |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/channels/config`                    | List all platform configs (token masked)                                     |
| `GET`    | `/channels/config/:platform`          | Get config for a specific platform                                           |
| `PUT`    | `/channels/config/:platform`          | Upsert platform config (token, mode, rate_limit, enabled, guardrails fields) |
| `POST`   | `/channels/config/:platform/validate` | Test credentials validity                                                    |
| `GET`    | `/channels/users/:platform`           | List approved users for a platform                                           |
| `DELETE` | `/channels/users/:id`                 | Remove an authorized user                                                    |
| `PATCH`  | `/channels/users/:id/tier`            | Update user permission tier (`viewer`/`operator`/`admin`)                    |
| `PATCH`  | `/channels/users/:id/budget`          | Update user token budget (0 = unlimited)                                     |
| `GET`    | `/channels/pairing/:platform`         | List active pairing codes                                                    |
| `POST`   | `/channels/pairing/verify`            | Verify a 6-digit pairing code from the desktop UI                            |
| `GET`    | `/channels/status`                    | All plugin lifecycle states                                                  |
| `POST`   | `/channels/:platform/start`           | Start a specific channel plugin                                              |
| `POST`   | `/channels/:platform/stop`            | Stop a specific channel plugin                                               |
| `GET`    | `/channels/sessions`                  | List channel sessions (query: `platform`, `limit`)                           |
| `GET`    | `/channels/sessions/:id/messages`     | List messages for a channel session                                          |
| `GET`    | `/channels/audit-log`                 | List audit log entries (query: `platform`, `limit`)                          |

### Multi-Bot Config Routes (Preferred)

| Method   | Path                                           | Description                                                                                                                                       |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/channels/configs`                            | List all channel configs (masked tokens + configured flag)                                                                                        |
| `POST`   | `/channels/configs`                            | Create a new channel config (platform, name, optional token) → 201. Slack configs also accept `cred_connectors_allowlist` and `user_mcp_policy`.  |
| `GET`    | `/channels/configs/:configId`                  | Get a single config by ID                                                                                                                         |
| `PUT`    | `/channels/configs/:configId`                  | Update config settings/token; auto-restarts plugin on real token change. Slack configs also persist Home connector allowlist and user-MCP policy. |
| `DELETE` | `/channels/configs/:configId`                  | Delete config + cascade (users, sessions, messages, audit, pairing)                                                                               |
| `POST`   | `/channels/configs/:configId/start`            | Start the bot plugin for this config                                                                                                              |
| `POST`   | `/channels/configs/:configId/stop`             | Stop the bot plugin                                                                                                                               |
| `POST`   | `/channels/configs/:configId/validate`         | Validate the token for this config's platform                                                                                                     |
| `GET`    | `/channels/configs/:configId/users`            | List approved users for this config                                                                                                               |
| `POST`   | `/channels/configs/:configId/pairing/generate` | Generate a 6-digit pairing code for this config                                                                                                   |
| `GET`    | `/channels/configs/:configId/audit-log`        | Audit log entries (query: channelUserId, limit, offset, exclude)                                                                                  |
| `GET`    | `/channels/configs/:configId/sessions`         | List sessions for this config (query: status)                                                                                                     |

### Gateway Adapter Admin

These routes expose adapters registered through `src-api/src/shared/services/gateway/channels/index.ts` (Telegram, Discord, Slack, Feishu, iMessage on macOS, Linear, WhatsApp placeholder, SMS placeholder). They persist enablement and health state in `gateway_channels`.

| Method | Path                      | Description                                                                                       |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET`  | `/channels/`              | List registered gateway adapters with `enabled`, health, last error, and last connected timestamp |
| `POST` | `/channels/:id/enable`    | Enable a registered gateway adapter in `gateway_channels`                                         |
| `POST` | `/channels/:id/disable`   | Disable a registered gateway adapter and mark status `disabled`                                   |
| `POST` | `/channels/:id/reconnect` | Mark adapter `disconnected` so the gateway supervisor restarts it on the next health sweep        |

### Gateway Routing Rules

Routing rules map `(workspace_id, channel_id, intent, chat_pattern)` to an agent profile. `priority` is sorted descending; ties are resolved by `updated_at` descending.

| Method   | Path                          | Description                                                                                                                            |
| -------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/channels/routing-rules`     | List all routing rules                                                                                                                 |
| `POST`   | `/channels/routing-rules`     | Create a rule (`workspace_id`, `channel_id`, `chat_pattern`, `intent`, `profile_id`, optional `model_override`, `priority`, `enabled`) |
| `PATCH`  | `/channels/routing-rules/:id` | Update any allowed routing-rule fields                                                                                                 |
| `DELETE` | `/channels/routing-rules/:id` | Delete a routing rule                                                                                                                  |

## Web Remote

`/remote/*` is mounted only when `NEUMA_REMOTE_UI` is `read-only` or `interactive`. Phase 6.0 is read-only: non-GET/HEAD methods return `405`. All routes require a Bearer JWT signed by `WEBUI_JWT_SECRET`.

| Method | Path                       | Description                                                                                    |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET`  | `/remote/tasks`            | Return the 100 most recent tasks                                                               |
| `GET`  | `/remote/messages/:taskId` | SSE stream of task events with 15s heartbeat, terminal-event close, and 30-minute max duration |

## Branches (Conversation Branching)

All `/tasks/:taskId/branches/*` routes manage conversation branching, message editing, and regeneration within the AG-UI V2 task view.

| Method | Path                                      | Description                                                                                            |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST` | `/tasks/:taskId/branches`                 | Create a branch from a message — copies `main` messages up to `fromMessageId` onto a new `branch_id`   |
| `GET`  | `/tasks/:taskId/branches`                 | List distinct `branch_id` values for a task                                                            |
| `POST` | `/tasks/:taskId/branches/:branchId/merge` | Merge a branch — reassign rows to target branch                                                        |
| `POST` | `/tasks/:taskId/branches/edit`            | Create a branch with an edited message — copies prefix, inserts new user message with modified content |
| `GET`  | `/tasks/:taskId/branches/at/:messageId`   | Get branches at a fork point (branches whose `parent_message_id` matches)                              |
| `POST` | `/tasks/:taskId/branches/regenerate`      | Delete messages after a given `afterMessageId` on a specific `branchId` for re-generation              |
| `GET`  | `/tasks/:taskId/messages/search`          | Full-text search across task messages (LIKE query)                                                     |

**ID resolution:** `resolveMessageId(taskId, messageRef)` accepts numeric id, numeric string, or UUID (`message_id` column).

**AG-UI integration:** The AG-UI run route reads `forwardedProps.branchId` (validated as UUID format), loads branch-specific history via `getMessagesByBranch(taskId, branchId)`, and persists user messages with the `branch_id` column set.

## Usage

All `/usage/*` routes expose token usage statistics, request logs, and model pricing. Time range
query parameters (`start`, `end`) accept ISO-8601 date strings.

### Analytics

| Method   | Path                  | Description                                                                                                                 |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/usage/summary`      | Overall usage summary — total tokens, cost, request counts                                                                  |
| `GET`    | `/usage/by-provider`  | Usage grouped by provider                                                                                                   |
| `GET`    | `/usage/by-model`     | Usage grouped by model                                                                                                      |
| `GET`    | `/usage/by-call-type` | Usage grouped by call type (`agent`, `title`, `embedding`, `image`, `speech`, `ptc`, `other`)                               |
| `GET`    | `/usage/daily`        | Daily usage aggregation                                                                                                     |
| `GET`    | `/usage/logs`         | Paginated request logs (supports `model`, `provider`, `call_type`, `locality`, `sort_field`, `sort_dir`, `limit`, `offset`) |
| `DELETE` | `/usage/logs`         | Clear all usage log records — returns `{ deleted: number }`                                                                 |

**Common query params** (all analytics endpoints): `start` (ISO date), `end` (ISO date), `billing_type` (`api` \| `subscription` \| `free`), `source` (`desktop` \| `channel`).

### Pricing

| Method  | Path                             | Description                                                                                                                                                                                     |
| ------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/usage/pricing`                 | List all model pricing records                                                                                                                                                                  |
| `GET`   | `/usage/pricing/:modelId`        | Get pricing for a single model                                                                                                                                                                  |
| `POST`  | `/usage/pricing`                 | Create a new pricing record — body: `{ model_id, provider, display_name?, default_billing_type? }`                                                                                              |
| `PUT`   | `/usage/pricing/:modelId`        | Update pricing fields (`input_cost_per_million`, `output_cost_per_million`, `cache_read_cost_per_million`, `cache_creation_cost_per_million`, `unit_cost`, `unit_type`, `default_billing_type`) |
| `PATCH` | `/usage/pricing/:modelId/rename` | Rename a pricing record's model ID — body: `{ new_model_id }`                                                                                                                                   |

**Billing types**: `api` (per-token, cost tracked in USD), `subscription` (flat-rate plan, tokens tracked but cost excluded from totals), `free` (no cost).

## Budget

| Method   | Path                   | Description                                                                     |
| -------- | ---------------------- | ------------------------------------------------------------------------------- |
| `GET`    | `/budget/status`       | All budget policies with current spend utilization (% used per period)          |
| `GET`    | `/budget/preflight`    | Pre-flight check for a scope — returns `{ blocked, alert, alertLevel, policy }` |
| `GET`    | `/budget/policies`     | List all budget policies                                                        |
| `POST`   | `/budget/policies`     | Create a new budget policy (Zod-validated)                                      |
| `PUT`    | `/budget/policies/:id` | Update a budget policy                                                          |
| `DELETE` | `/budget/policies/:id` | Delete a budget policy                                                          |

**Scope types**: `global`, `provider`, `model`, `agent_profile`, `project`, `automation`

**Preflight query params**: `scope_type` (required), `scope_id` (optional, for non-global scopes)

**Alert levels**: `soft` (≥75%), `urgent` (≥90%), `blocked` (≥100%)

## Task Documents

All task document routes are accessible under `/tasks/:taskId/documents`.

| Method | Path                                               | Description                                                            |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/tasks/:taskId/documents`                         | List doc keys with latest version metadata (no content)                |
| `GET`  | `/tasks/:taskId/documents/:key`                    | Get latest content for a doc key (`plan`, `notes`, `design`, `custom`) |
| `POST` | `/tasks/:taskId/documents/:key`                    | Create or update a document (upsert by task_id + doc_key)              |
| `GET`  | `/tasks/:taskId/documents/:key/history`            | List all historical versions                                           |
| `GET`  | `/tasks/:taskId/documents/:key/history/:historyId` | Get a single historical version by ID                                  |

Version history is auto-maintained by a `BEFORE UPDATE` trigger — no explicit versioning needed by the caller. Pass `id` in the POST body to update an existing doc; omit for insert (new UUID is generated).

## Automation

All `/automation/*` routes manage the heartbeat/cron scheduling engine — creating automations, tracking runs, and streaming real-time events.

### Automations

| Method   | Path                     | Description                                                 |
| -------- | ------------------------ | ----------------------------------------------------------- |
| `GET`    | `/automation`            | List all automations                                        |
| `POST`   | `/automation`            | Create automation (validated with `CreateAutomationSchema`) |
| `GET`    | `/automation/:id`        | Get automation by ID                                        |
| `PUT`    | `/automation/:id`        | Update automation                                           |
| `DELETE` | `/automation/:id`        | Delete automation + associated runs                         |
| `PATCH`  | `/automation/:id/toggle` | Enable/disable automation                                   |

### Runs

| Method   | Path                             | Description                                                 |
| -------- | -------------------------------- | ----------------------------------------------------------- |
| `GET`    | `/automation/runs/active`        | List active runs                                            |
| `GET`    | `/automation/runs/:runId`        | Get run by ID                                               |
| `POST`   | `/automation/runs/:runId/cancel` | Cancel in-progress run                                      |
| `GET`    | `/automation/:id/runs`           | Run history for automation                                  |
| `DELETE` | `/automation/:id/runs`           | Bulk-delete runs by ID array — body: `{ runIds: string[] }` |

### Engine Status & Events

| Method | Path                 | Description                                                                   |
| ------ | -------------------- | ----------------------------------------------------------------------------- |
| `GET`  | `/automation/status` | Engine status (`started`, `activeRunCount`, `queuedCount`, `automationCount`) |
| `GET`  | `/automation/events` | SSE stream for real-time events                                               |

### Templates

| Method | Path                                | Description             |
| ------ | ----------------------------------- | ----------------------- |
| `GET`  | `/automation/templates`             | List built-in templates |
| `GET`  | `/automation/templates/:templateId` | Get template details    |

### Queue

| Method | Path                                     | Description                   |
| ------ | ---------------------------------------- | ----------------------------- |
| `GET`  | `/automation/queue/status?profileId=...` | Queue stats for profile       |
| `POST` | `/automation/queue/enqueue`              | Enqueue task to profile queue |

### Webhooks

| Method | Path                      | Description                                  |
| ------ | ------------------------- | -------------------------------------------- |
| `POST` | `/automation/hooks/:slug` | External webhook trigger (bearer token auth) |

## Search

| Method | Path                | Description                                                                                                   |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/search/providers` | List configured providers with enabled status, credentials, and priority                                      |
| `GET`  | `/search/presets`   | Return all 13 provider preset definitions (metadata for UI)                                                   |
| `GET`  | `/search/config`    | Get current search config (API keys masked as `••••••••`)                                                     |
| `POST` | `/search/test`      | Test provider connectivity — body: `{ providerId, apiKey?, baseUrl?, config? }` → `{ ok, latencyMs, error? }` |
| `POST` | `/search/query`     | Execute search for UI testing — body: `{ query, maxResults?, freshness?, country?, language? }`               |

## Agent Permission

| Method | Path                | Description                                                                        |
| ------ | ------------------- | ---------------------------------------------------------------------------------- |
| `POST` | `/agent/permission` | Respond to a permission request — body: `{ permissionId, approved, alwaysAllow? }` |

## Doctor

System health diagnostics with actionable recommendations.

| Method | Path      | Description                                                |
| ------ | --------- | ---------------------------------------------------------- |
| `GET`  | `/doctor` | Full system health check — returns `{ overall, checks[] }` |

**Response shape:**

- `overall`: `'healthy' | 'degraded' | 'unhealthy'`
- `checks[]`: each entry has `name`, `status` (`pass`/`warn`/`fail`), `message`, and optional `fix` (remediation suggestion)

**Checks performed:** Node.js version (≥20 recommended), Git availability, API key configuration, workspace directory access, database integrity, MCP server health, memory usage, disk space.

## MCP Runtime

Dynamic MCP server management for active sessions. All routes require an active query object for the task (from `activeQueryStore`).

| Method | Path                     | Description                                    |
| ------ | ------------------------ | ---------------------------------------------- |
| `POST` | `/mcp/runtime/add`       | Add MCP server to active session               |
| `POST` | `/mcp/runtime/toggle`    | Enable/disable MCP server in active session    |
| `POST` | `/mcp/runtime/reconnect` | Reconnect a failed MCP server                  |
| `GET`  | `/mcp/runtime/status`    | Get all MCP server statuses for active session |

## Health

| Method | Path                                        | Description                      |
| ------ | ------------------------------------------- | -------------------------------- |
| `GET`  | `/health`                                   | Server, memory, resource, and asset-storage health summary |
| `GET`  | `/health/dependencies`                      | Check all dependency statuses    |
| `GET`  | `/health/dependencies/:id`                  | Check specific dependency status |
| `GET`  | `/health/dependencies/:id/install-commands` | Get install instructions         |
| `POST` | `/health/dependencies/:id/install`          | Trigger dependency installation  |

`GET /health` returns process uptime, memory usage, memory-budget supervisor
status, session and plan-manager metrics, memory-monitor metrics, and Assets
Catalog storage counters. Dependency checks reuse the agent-runtime registry for
Claude Code and Codex when possible, then fall back to legacy native / WSL /
bundled-sidecar probes.

---

_See also: [Backend Overview](index.md) · [Agent System](agent-system.md) · [Auth System](auth.md) · [Linear Pipeline](linear-pipeline.md) · [Slack Integration](../../doc-dev/plan/slack-integration.md) · [Speech System](speech.md) · [Multichannel Gateway](gateway.md)_
