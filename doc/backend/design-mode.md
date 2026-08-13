---
summary: "DesignMode backend architecture — project storage, catalogs, prompt composition, media dispatch, import/export, budgets, and governance"
read_when:
  - Working on DesignMode API routes or services
  - Adding a new DesignMode surface, catalog, exporter, or media provider
  - Debugging DesignMode project files, budgets, provenance, or import/export behavior
title: "DesignMode Backend"
---

# DesignMode Backend

DesignMode is a local-first creation workspace for documents, images, videos, audio,
decks, prototypes, templates, and campaigns. The backend owns project persistence,
catalog loading, prompt composition, media dispatch, linting, import/export, and
governance metadata.

## Source Map

| Area                        | Source                                                        |
| --------------------------- | ------------------------------------------------------------- |
| HTTP routes                 | `src-api/src/app/api/design.ts`                               |
| Project manifests and index | `src-api/src/shared/services/design-mode/projects.ts`         |
| Project file system helpers | `src-api/src/shared/services/design-mode/fs.ts`               |
| Project locations           | `src-api/src/shared/services/design-mode/project-locations.ts` |
| Catalog loading             | `src-api/src/shared/services/design-mode/catalogs.ts`         |
| Generated design-system validation | `src-api/src/shared/services/design-mode/design-system-package.ts` |
| Prompt composition          | `src-api/src/shared/services/design-mode/prompt-composer.ts`  |
| Conversational chat loop    | `src-api/src/shared/services/design-mode/chat.ts`             |
| Linked context validation   | `src-api/src/shared/services/design-mode/linked-context.ts`   |
| Skill side-file staging     | `src-api/src/shared/services/design-mode/skill-staging.ts`    |
| Folder import validation    | `src-api/src/shared/services/design-mode/import-folder/`      |
| Media dispatcher            | `src-api/src/shared/services/design-mode/media-dispatcher.ts` |
| Budgets                     | `src-api/src/shared/services/design-mode/budgets.ts`          |
| Dependency checks           | `src-api/src/shared/services/design-mode/dependencies.ts`     |
| Lint rules                  | `src-api/src/shared/services/design-mode/lint.ts`             |
| Live artifacts              | `src-api/src/shared/services/design-mode/live-artifacts.ts`   |
| Manual edit patch journal   | `src-api/src/shared/services/design-mode/source-rewriter/`    |
| Design package export       | `src-api/src/shared/services/design-mode/design-package/`     |
| PDF print input builder     | `src-api/src/shared/services/design-mode/pdf-export/`         |
| Design Jury critique        | `src-api/src/shared/services/design-mode/critique/`           |
| Finalization / handoff      | `src-api/src/shared/services/design-mode/finalize-design.ts`, `editors.ts` |
| Routines / scheduler        | `src-api/src/shared/services/design-mode/routines/`           |
| Catalog asset bridge        | `src-api/src/shared/services/design-mode/catalog-assets.ts`   |
| Metrics                     | `src-api/src/shared/services/design-mode/metrics.ts`          |
| Shared types                | `src-api/src/shared/services/design-mode/types.ts`            |
| DB migration                | `src-api/src/shared/db/migrations/015_design_projects.ts`     |
| Bundled catalogs            | `src-api/src/shared/design-mode/`                             |

## Project Model

DesignMode supports these surfaces:

`document`, `image`, `video`, `audio`, `deck`, `prototype`, `template`, and
`campaign`.

Each project has:

- A SQLite index row in `design_projects` for fast listing by `updated_at` and `surface`.
- A project folder under `<location>/design-projects/<design_id>/`, where
  `<location>` is the default workspace root or one of the additional absolute
  project locations configured in DesignMode settings.
- A `project.json` manifest that is the source of truth for project metadata.
- A `brief.json` copy of the editable brief.
- Scaffold directories for `skill/`, `design-system/`, `craft/`, `prompts/`,
  `assets/references/`, `assets/generated/`, `artifacts/`, `exports/`,
  `provenance/`, `comments/`, `sketches/`, `live-artifacts/`, and `critique/`.
- Optional `linkedContextDirs`, normalized to absolute directories inside the
  configured workspace root, for prompt-only context references.
- Optional `workspaceRoot`, resolved by `project-locations.ts`, so projects can
  live in configured locations while listing still scans the default workspace
  and app-data fallback for older projects.

The backend never trusts request paths directly. `normalizeProjectRelativePath()`
rejects absolute paths, `..` traversal, null bytes, and Windows drive roots before
`resolveProjectPath()` checks that the final resolved path remains inside the project
folder.

Additional project locations must be absolute directories, must exist, and must
not be filesystem roots or blocked system directories (`/etc`, `/proc`, `/sys`,
`/dev`, `/boot`, and Windows system roots). The default location remains derived
from `workDir` or the app data directory and cannot be removed through the
project-location API.

## API Surface

All `/design/*` routes are mounted from `designRoutes` and use Zod validation for
request bodies where structured data is accepted.

| Method   | Path                                                   | Purpose                                                                  |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `GET`    | `/design/projects`                                     | List project manifests ordered by most recent update                     |
| `GET`    | `/design/project-locations`                            | List configured DesignMode project roots and project counts              |
| `POST`   | `/design/project-locations`                            | Add an absolute project root after validation                            |
| `GET`    | `/design/project-locations/scan`                       | Re-scan configured roots and return discovered projects                  |
| `DELETE` | `/design/project-locations`                            | Remove a non-default configured project root                             |
| `GET`    | `/design/metrics`                                      | Return aggregate DesignMode metrics                                      |
| `GET`    | `/design/dependencies`                                 | Return renderer/provider dependency status                               |
| `GET`    | `/design/connectors`                                   | List live-artifact connector options and readiness                       |
| `GET`    | `/design/telemetry/status`                             | Return DesignMode telemetry feature status                               |
| `GET`    | `/design/critique/metrics`                             | Return Design Jury metric rollups                                        |
| `GET`    | `/design/critique/conformance`                         | Return critique conformance fixture status                               |
| `GET`    | `/design/critique/rollout`                             | Return Design Jury rollout state                                         |
| `POST`   | `/design/critique/rollout/promote`                     | Promote the critique rollout when gates pass                             |
| `POST`   | `/design/critique/rollout/rollback`                    | Roll back the critique rollout                                           |
| `POST`   | `/design/critique/rollout/override`                    | Apply a manual critique rollout override                                 |
| `GET`    | `/design/routines`                                     | List scheduled DesignMode routines                                       |
| `POST`   | `/design/routines`                                     | Create a DesignMode routine                                              |
| `GET`    | `/design/routines/scheduler`                           | Return scheduler status                                                  |
| `POST`   | `/design/routines/scheduler/tick`                      | Run one scheduler tick                                                   |
| `GET`    | `/design/routines/:routineId`                          | Read one routine                                                         |
| `PATCH`  | `/design/routines/:routineId`                          | Update one routine                                                       |
| `GET`    | `/design/design-jury/status`                           | Return whether the gated Design Jury feature is enabled                  |
| `POST`   | `/design/projects`                                     | Create a project and scaffold its folder                                 |
| `POST`   | `/design/projects/import`                              | Import files or a ZIP archive into a new project                         |
| `POST`   | `/design/projects/import-folder`                       | Link a validated local folder as read-only DesignMode context            |
| `GET`    | `/design/projects/:id`                                 | Read a project manifest                                                  |
| `PATCH`  | `/design/projects/:id`                                 | Update project metadata, brief, settings, outputs, or status             |
| `DELETE` | `/design/projects/:id`                                 | Tombstone and move a project under `.deleted/`                           |
| `POST`   | `/design/projects/:id/touch`                           | Refresh a project `updatedAt` timestamp                                  |
| `POST`   | `/design/projects/:id/catalog-assets/:assetId`          | Attach an Assets Catalog item to a DesignMode project                    |
| `GET`    | `/design/projects/:id/finalize/state`                   | Return `DESIGN.md` freshness state                                       |
| `POST`   | `/design/projects/:id/finalize`                         | Generate or refresh project `DESIGN.md` handoff                          |
| `GET`    | `/design/projects/:id/live-artifacts`                  | List rendered live artifacts for a project                               |
| `POST`   | `/design/projects/:id/live-artifacts`                  | Create a live HTML artifact from template/data input                     |
| `GET`    | `/design/projects/:id/live-artifacts/:artifactId`      | Read live artifact manifest, template, data, provenance, and refresh log |
| `POST`   | `/design/projects/:id/live-artifacts/:artifactId/refresh` | Re-render a live artifact from its source data                        |
| `GET`    | `/design/projects/:id/design-jury`                     | List Design Jury critique runs                                           |
| `POST`   | `/design/projects/:id/design-jury`                     | Run gated Design Jury critique on a reviewable artifact                  |
| `POST`   | `/design/projects/:id/design-jury/:runId/interrupt`   | Mark an active Design Jury run as interrupted                            |
| `GET`    | `/design/projects/:id/design-jury/:runId/artifact`    | Serve the stored critique artifact                                       |
| `GET`    | `/design/projects/:id/files`                           | List project files recursively                                           |
| `DELETE` | `/design/projects/:id/files`                           | Soft-delete selected files and prune deleted project outputs             |
| `GET`    | `/design/projects/:id/file`                            | Read a text file, capped at 5 MB                                         |
| `POST`   | `/design/projects/:id/file`                            | Write a text file atomically and run lint when applicable                |
| `GET`    | `/design/projects/:id/blob`                            | Serve binary preview bytes with no-store and nosniff headers             |
| `GET`    | `/design/projects/:id/file-location`                   | Return the absolute local path for OS open/copy actions                  |
| `GET`    | `/design/skills`                                       | List bundled and installed DesignMode skills                             |
| `POST`   | `/design/skills/:id/install`                           | Install a DesignMode skill pack                                          |
| `DELETE` | `/design/skills/:id/install`                           | Uninstall an installed skill pack                                        |
| `GET`    | `/design/skills/:id/example`                           | Return a bundled skill example artifact when available                   |
| `GET`    | `/design/skills/:id`                                   | Read one DesignMode skill                                                |
| `GET`    | `/design/design-systems`                               | List bundled and workspace design systems                                |
| `POST`   | `/design/design-systems/:id/install`                   | Install a design-system pack                                             |
| `DELETE` | `/design/design-systems/:id/install`                   | Uninstall an installed design-system pack                                |
| `POST`   | `/design/design-systems/import/dtcg`                   | Import a DTCG token document as a design system                          |
| `POST`   | `/design/design-systems/import/shadcn-registry`        | Import a shadcn registry as a design system                              |
| `POST`   | `/design/design-systems`                               | Create a workspace custom design system                                  |
| `GET`    | `/design/design-systems/:id`                           | Read one design system                                                   |
| `GET`    | `/design/design-systems/:id/showcase`                  | Render a generated showcase HTML page for a design system                |
| `GET`    | `/design/design-systems/:id/tokens.dtcg.json`          | Export design-system tokens as DTCG JSON                                 |
| `PATCH`  | `/design/design-systems/:id`                           | Reject built-in design-system edits until workspace editing is wired     |
| `GET`    | `/design/craft`                                        | List craft reference documents                                           |
| `GET`    | `/design/craft/:id`                                    | Read one craft reference                                                 |
| `GET`    | `/design/prompt-templates`                             | List image or video prompt templates                                     |
| `GET`    | `/design/prompt-templates/:surface/:id`                | Read a prompt template with its full prompt                              |
| `GET`    | `/design/live-artifact-templates`                      | List reusable live artifact templates                                    |
| `GET`    | `/design/live-artifact-templates/:id`                  | Read one live artifact template                                          |
| `POST`   | `/design/projects/:id/resolve-prompt`                  | Compose and persist resolved system/user prompts                         |
| `POST`   | `/design/projects/:id/generate`                        | Legacy alias for starting media/document generation                      |
| `POST`   | `/design/projects/:id/media`                           | Start image, video, audio, or document generation                        |
| `POST`   | `/design/projects/:id/chat`                            | Stream an agentic DesignMode chat turn that can create/edit artifacts    |
| `POST`   | `/design/projects/:id/chat/:runId/cancel`              | Cancel an active DesignMode chat run                                     |
| `GET`    | `/design/projects/:id/tasks`                           | List in-memory media task records for a project                          |
| `GET`    | `/design/projects/:id/tasks/:taskId/wait`              | Long-poll task status and progress lines                                 |
| `POST`   | `/design/projects/:id/tasks/:taskId/cancel`            | Cancel a running task                                                    |
| `GET`    | `/design/projects/:id/capabilities`                    | Return media capabilities and project budget status                      |
| `POST`   | `/design/projects/:id/edit-target`                     | Append a targeted edit instruction to project history                    |
| `POST`   | `/design/projects/:id/edit/patch`                      | Apply a validated manual HTML edit patch and journal it                  |
| `GET`    | `/design/projects/:id/edit/patches`                    | List manual edit patch journal entries                                   |
| `POST`   | `/design/projects/:id/edit/revert`                     | Revert a journaled manual edit patch                                     |
| `POST`   | `/design/projects/:id/comments`                        | Add a comment, optionally attached to a selected preview target          |
| `PATCH`  | `/design/projects/:id/comments/:commentId`             | Update comment status/text/target                                        |
| `DELETE` | `/design/projects/:id/comments/:commentId`             | Delete a comment                                                         |
| `GET`    | `/design/projects/:id/sketches`                        | List sketch overlay JSON files                                           |
| `POST`   | `/design/projects/:id/sketches`                        | Save a sketch overlay                                                    |
| `GET`    | `/design/projects/:id/exports`                         | List export records                                                      |
| `POST`   | `/design/projects/:id/export`                          | Export a project with disclosure metadata                                |
| `POST`   | `/design/projects/:id/export/pdf-input`                | Build printable HTML input for desktop/browser PDF fallback              |
| `POST`   | `/design/projects/:id/export/design-package`           | Create a `.designpkg` archive with manifest and checksums                |
| `GET`    | `/design/editors`                                      | List detected editor/file-manager handoff targets                        |
| `GET`    | `/design/projects/:id/dir`                             | Return the absolute project directory for copy/CLI handoff actions       |
| `POST`   | `/design/projects/:id/open-in`                         | Open a project directory in an allowlisted editor or file manager        |
| `GET`    | `/design/projects/:id/history`                         | Return the tail of `history.jsonl`                                       |
| `GET`    | `/design/projects/:id/debug`                           | Return metrics, prompts, provenance, history, exports, and runtime tasks |
| `GET`    | `/design/projects/:id/metrics`                         | Return per-project DesignMode metrics                                    |
| `GET`    | `/design/projects/:id/preview`                         | SSE stream used to reload live previews after file writes/imports        |
| `GET`    | `/design/projects/:id/assets/:assetId/versions`        | List asset versions                                                      |
| `POST`   | `/design/projects/:id/assets/:assetId/promote-version` | Point a project output at an older version                               |
| `GET`    | `/design/projects/:id/assets/:assetId/provenance`      | Return provenance for one output                                         |
| `POST`   | `/design/projects/:id/lint`                            | Run DesignMode lint on a file or supplied content                        |

## Catalogs

Catalogs are read from `src-api/src/shared/design-mode/` and merged with workspace
overrides where supported:

- **Design systems** are `DESIGN.md` files. Workspace systems under
  `<workDir>/.neuma/design-systems/<id>/DESIGN.md` take precedence over bundled
  systems with the same id.
- **Craft references** are Markdown files under `craft/`, such as typography,
  color, and anti-slop guidance.
- **Prompt templates** are JSON files grouped by image or video surface.
- **DesignMode skills** load from bundled `skills/` and from the global skills loader.
  The `od` metadata block describes surface, inputs, outputs, required craft, and
  capabilities. `readDesignSkillSeedTemplate()` can also read a skill's
  `assets/template.html` for chat-surface starter artifacts.

Catalog ids are constrained by `CATALOG_ID_PATTERN` before a specific catalog record
is loaded by id.

Installed catalog packs are separate from bundled records. Built-in skills are
protected from uninstall. Design systems can also be imported from DTCG token
documents or shadcn registries, rendered as generated showcase HTML, and exported
as DTCG token JSON for handoff to other tools.

Design-system records surface freshness metadata from each pack's `meta.json`.
`installCatalogPack()` stamps `installedAt`, and DTCG or shadcn imports stamp
`createdAt`; bundled systems usually have neither. These fields are returned as
`DesignSystemRecord.installedAt` / `createdAt` so the frontend can offer a stable
newest-first sort without disturbing curated order for timestamp-less records.

Skill and catalog frontmatter parsing is centralized in
`src-api/src/shared/utils/frontmatter.ts`. DesignMode uses the shared helpers for
top-level skill frontmatter and nested `od` metadata so block scalars, quoted
values, and list-like metadata stay consistent with the global plugin loader.

Generated design-system packages are validated by
`validateGeneratedDesignSystemPackage()`. A valid generated pack must be an
ordinary directory under its package root, must not use symlinked required
files, must stay under the file and package byte caps, and must include:
`DESIGN.md`, `manifest.json`, `tokens.css`, `components.html`,
`design-tokens.json`, `USAGE.md`, and `source/evidence.md`. The validator also
checks supported manifest schemas, catalog-safe ids, required manifest fields,
CSS custom properties in `tokens.css`, non-empty design-token groups, and
source provenance evidence.

## Prompt Composition

`resolveProjectPrompt()` builds the prompt contract used by DesignMode generation. It
combines:

1. The DesignMode operating contract.
2. Project manifest and brief.
3. Active design system, or `default-freeform` when none is selected.
4. Inspiration design systems.
5. Validated linked context directories, when the project has any.
6. Selected craft references plus `anti-ai-slop`.
7. Selected DesignMode skill.
8. Selected skill side-file paths, staged under `.neuma-skills/<skill-slug>/`
   inside the project folder when the source skill has side files.
9. Selected prompt template.
10. Media-specific generation contract for image, video, or audio projects.

The resolved prompt is written to `prompts/resolved-system.md` and
`prompts/resolved-user.md`. The selected design system, craft references, skill, and
template are snapshotted into the project folder for reproducibility.

`normalizeLinkedContextDirs()` rejects relative paths, missing directories, filesystem
roots, system directories such as `/etc` or `/proc`, and directories outside the
workspace root. The resolved prompt treats linked directories as read-only context.

## Media Dispatch

`startDesignMediaTask()` performs budget preflight, creates a runtime task, appends
task provenance, and dispatches work by surface:

| Surface    | Behavior                                                                      |
| ---------- | ----------------------------------------------------------------------------- |
| `document` | Writes a Markdown artifact from the prompt                                    |
| `image`    | Uses the media-generation router and writes bytes under `assets/generated/`   |
| `video`    | Uses provider video tasks, or HyperFrames when `model === "hyperframes-html"` |
| `audio`    | Uses the speech router for speech and voiceover-style outputs                 |

Tasks are held in memory for active runs and appended to `provenance/tasks.jsonl`.
Outputs are added to `project.outputs` through a project lock so concurrent task
completion does not lose JSON updates.

The dispatcher also writes task rows to the shared `tasks` table. On daemon start,
`reconcileRunningDesignMediaTasks()` marks previously running DesignMode rows as failed
with `providerError: "daemon_restart"` and appends a recovery entry to the task journal.

Audio generation accepts `languageBoost`, which is passed through to speech providers
that support explicit pronunciation/language hints, currently MiniMax.

## Conversational Chat Loop

Agentic DesignMode surfaces (`prototype`, `template`, `deck`, `document`, and
`campaign`) can use `/design/projects/:id/chat` instead of the media dispatcher.
The route streams `AgentMessage` events over SSE, stores the run id, supports
cancellation through an `AbortController`, and accepts up to 40 prior
conversation turns so the agent can use discovery questions and answers in the
build turn.

On the first turn of a new chat-surface project, `runDesignChat()` asks two to
four short questions with the shared `AskUserQuestion` fence and stops. The next
turn receives the answers as history and builds the expected artifact:
`index.html` for prototypes, templates, and decks, or `artifacts/document.md`
for document and campaign surfaces. After a run completes,
`harvestDesignChatArtifact()` registers a newly written expected artifact as a
project output so the frontend can show it in the creations grid and auto-open it.

Fresh HTML builds seed `index.html` before the agent runs when a suitable skill
template exists. The project-bound skill wins; otherwise prototypes/templates use
`web-prototype` and decks use `simple-deck`. The prompt then tells the agent to
read and compose into that starter file instead of failing on a missing artifact
or inventing an unstructured page from scratch. If no seed is available, the
prompt explicitly tells the agent to create the expected file directly.

Design chat runs set `disableUserMcp: true` because these builds are
self-contained file-writing tasks and user MCP startup can dominate
time-to-first-token. A 90-second first-token watchdog aborts runs that yield no
message, logs the likely startup stall, and emits an `error` message with
subtype `first_token_timeout` followed by `done`. The stream is also wrapped in
`withToolResultLoopGuard()` so repeated failing tool results produce a transient
loop warning rather than burning turns indefinitely.

Image, video, and audio surfaces still route through `startDesignMediaTask()`.

## Catalog Asset Attachments

DesignMode attaches assets from the centralized **Assets Catalog** (see
[Assets Catalog](assets-catalog.md)) through
`src-api/src/shared/services/design-mode/catalog-assets.ts`. When the user picks
a catalog asset for a design project:

1. The bridge records an `asset_attachments` row scoped to the design project
   and a `asset_materializations` row that charges the project's storage budget.
2. The materializer copies (or hard-links when safe) the active bytes into
   `assets/linked/` under the project folder so the prompt and design package
   reference a stable local path.
3. When the asset originates from a stock catalog (`openverse`, `unsplash`,
   `pexels`) or other licensed source, `assetAttribution()` is invoked and the
   resulting license/attribution block is auto-included in the resolved prompt
   alongside the project brief — so generated outputs always carry the required
   credit text.

This keeps DesignMode's per-project artifact set self-contained while letting a
single catalog row back attachments across many projects.

## Budgets and Dependencies

Global defaults come from `DEFAULT_DESIGN_MODE_SETTINGS` and can be overridden per
project. Budget dimensions are:

- image generations
- video jobs
- video seconds
- audio seconds
- retry count for repeated failed prompts
- project storage bytes

`strictProviderMode` is part of the DesignMode settings shape and appears in the
settings UI, but the current dispatcher path does not enforce it. Do not document it
as an execution guarantee until provider selection enforcement is wired through task
start.

The dependency endpoint checks optional local tools and renderers:

- `sharp` for image conversion
- Playwright Chromium for PDF and HTML screenshot export
- `pandoc` for some document export flows
- built-in DOCX and PPTX renderers
- `ffmpeg` for audio/video conversion
- HyperFrames for HTML video rendering

## Live Artifacts

Live artifacts let DesignMode persist a rendered HTML artifact backed by structured data.
The first shipped connector catalog supports:

- `inline-json` — JSON supplied directly in the create request.
- `project-json` — JSON read from a file already inside the project folder.
- Google Workspace, Notion, and Slack connector placeholders — reported as
  `coming-soon` and only marked configured when an active connection plus connector
  policy allows access.

`createDesignLiveArtifact()` writes `template.html`, `data.json`, `index.html`,
`provenance.json`, `refresh-log.jsonl`, and `artifact.json` under
`live-artifacts/<artifactId>/`. If the template contains `{{DATA_JSON}}`, the data is
injected there; otherwise a `<script type="application/json" id="neuma-live-data">`
block is appended before `</body>` or at EOF. Refreshes re-read source data, update
hashes in provenance, append a refresh log entry, and publish a preview reload event.

## Manual Edit Patches

Manual edit patches are validated before rewriting HTML. The current patch schema supports
`set-text`, `set-link`, `set-image`, `set-style`, `set-token`, `set-full-source`,
`set-outer-html`, and `set-attributes`. Validation rejects unsafe links, suspicious image
references, disallowed style declarations, invalid token names, and malformed full-source
updates.

Patches target annotated preview nodes through `data-neuma-id`. Successful edits are
journaled so `/design/projects/:id/edit/patches` can show history and
`/design/projects/:id/edit/revert` can restore a previous source snapshot.

## Design Jury

Design Jury is a gated critique path. It is disabled by default unless
`DESIGN_MODE_JURY_ENABLED` is truthy or the `designModeJuryEnabled` setting is truthy.
When enabled, `runDesignJury()` selects the requested artifact path, the first reviewable
project output, or `artifacts/index.html`, then:

1. Reads and parses the artifact with the Design Jury parser.
2. Runs `lintDesignArtifact()`.
3. Scores role perspectives for designer, critic, brand, accessibility, and copy.
4. Writes `critique/<runId>/transcript.json` and `summary.md`.
5. Appends a `design-jury.completed` history event.

Active runs are registered in memory so `/design/projects/:id/design-jury/:runId/interrupt`
can mark the run as `interrupted` and persist the recovery reason. Status values now include
`running`, `interrupted`, and `failed` in addition to completed critique records.

## Finalization and Editor Handoff

`finalizeDesignProject()` generates a root-level `DESIGN.md` as a durable handoff
for future CLI or editor work. The file summarizes the project, active design
system, inspiration systems, pinned craft references, files and artifacts, recent
history, and provenance. `getDesignMdState()` marks it stale when project files
or relevant conversation history are newer than the recorded provenance, or when
the provenance block cannot be parsed.

The frontend handoff menu uses `editors.ts` and the project directory route to
open the project in allowlisted editors or the file manager, and to copy the
absolute path or ready-to-paste `cd`, `cd && claude`, and `cd && codex` commands.

## Import, Lint, and Export Governance

Imports accept JSON, multipart files, or ZIP archives. ZIP imports are checked for
unsupported compression, encrypted entries, path traversal, file count, total size,
single-file size, and an HTML entry point when strict archive import is used. Imported
HTML is sanitized before writing.

Folder import is intentionally a link operation, not a recursive copy. `validateImportFolder()`
resolves the real path, blocks system directories, skips `.git`, `.neuma`, `node_modules`,
and virtualenv folders, and enforces 50,000 files plus a 100 MB per-file limit before storing
the folder as linked read-only context.

`lintDesignArtifact()` runs on text writes, imports, and exports. P0 findings block
imports and exports unless the request explicitly allows override.

Export block/unavailable responses carry stable low-cardinality `code` values
for frontend recovery UI and analytics. P0 lint blocks return
`export_blocked_by_lint` with HTTP 409. `DesignExportUnavailableError` maps
422 responses to `attribution_blocked`, `invalid_input`, `dependency_missing`,
or `renderer_unavailable` based on the missing dependency/source shape.

Exports write a sidecar disclosure file and, for ZIP/PPTX/DOCX formats, embed structured
DesignMode disclosure metadata. The disclosure includes project identity, export format,
generated assets, providers, models, prompt hashes, references, task ids, and signing
status.

PDF exports have a fallback path for desktop/web contexts that cannot run Playwright or
Pandoc. `buildArtifactPdfInput()` wraps the selected HTML artifact with a `base` URL, title,
deck print CSS when needed, and a print-ready message. The frontend print fallback waits for
that message and for finite positive iframe dimensions before invoking print, with a timed
fallback so malformed artifacts do not hang the export drawer. The Tauri shell can save PDF
bytes on macOS; otherwise the frontend falls back to print dialog/browser printing.

Design packages are `.designpkg` ZIP files created by `packDesignPackage()`. They include
source artifacts, assets, provenance, design-system/craft snapshots, and critique transcripts
by default, exclude `exports/`, `.trash/`, and provider keys, and add a `manifest.json` with
file checksums plus a manifest checksum.

## Concurrency and Preview Updates

`withProjectLock()` serializes read-modify-write operations per project for comments,
sketches, exports, project outputs, and project manifests. This avoids lost updates
when requests or media completions race.

The preview SSE endpoint emits `ready`, periodic `ping`, and `reload` events. File
writes and imports publish reload events so the frontend can refresh the active source
or preview without polling.

## Failure Modes

- Invalid project ids throw before touching disk.
- Missing project files become `404 DesignMode project not found`.
- Active MIME types served by `/blob` are forced to attachment disposition.
- Provider and budget failures are written to task records and surfaced through the
  project view.
- Exporters return `422` with `code`, `format`, `dependency`, and `source` when a
  renderer or source artifact is unavailable.

---

_See also: [API Routes](api-routes.md) · [Media Generation](media-generation.md) · [Frontend DesignMode](../frontend/design-mode.md) · [Database Schema](../reference/database-schema.md)_
