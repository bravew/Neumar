---
summary: "Centralized assets catalog — registry, indexer, embeddings, hybrid search, lazy materializer with cache and proxies, GC, attribution, MCP exposure, and HTTP routes"
read_when:
  - Working on the assets catalog, materializer, or any code under src-api/src/shared/assets/
  - Adding a new asset source or MCP tool over the catalog
  - Debugging asset ingestion, indexing, search, or materialization
  - Wiring catalog assets into a mode (video, design, chat attachments)
title: "Assets Catalog"
---

# Assets Catalog

The assets catalog is the workspace-wide system of record for media and document
assets the user owns, generates, or links from cloud connectors. It centralizes
ingestion, content-hash deduplication, metadata, FTS5 + vector hybrid search,
lazy on-demand materialization with a content-addressed cache, proxy/preview
derivative generation, license-aware attribution, and an MCP surface used by
both Claude (in-process) and subprocess agents like Codex.

Routes mount at `/assets` from `src-api/src/index.ts`. The catalog is opt-out —
`assets.catalog_enabled` defaults to enabled (see `flags.ts`); only an explicit
`'false'` setting disables it.

## Source Map

| Area                       | Files                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public surface             | `src-api/src/shared/assets/index.ts`, `types.ts`                                                                                                                            |
| Registry                   | `src-api/src/shared/assets/registry.ts` (`AssetRegistry`, `AssetsError`)                                                                                                    |
| Indexer pipeline           | `src-api/src/shared/assets/indexer/pipeline.ts` (`AssetIndexer`), `jobs.ts`, `probe.ts`, `text-extract.ts`, `thumbs.ts`, `hashing.ts`                                       |
| Embeddings                 | `src-api/src/shared/assets/embedding.ts` (`AssetEmbeddingService`, defers to `@/shared/services/memory` for text/image embedders)                                           |
| Hybrid search              | `src-api/src/shared/assets/search/hybrid.ts` (`AssetSearchService`)                                                                                                         |
| Materializer               | `src-api/src/shared/assets/materializer.ts`, `materializer-store.ts`, `materializer-download.ts`, `materializer-events.ts`, `materializer-helpers.ts`, `materializer-status.ts`, `materializer-types.ts` |
| Derivatives                | `src-api/src/shared/assets/proxy-engine.ts` (`AssetProxyEngine`), `artifact-engine.ts` (`AssetArtifactEngine`), `derivative-source.ts`                                      |
| Connectors                 | `src-api/src/shared/assets/connectors/sync.ts`, `state.ts`, `immich.ts`, `remote-search.ts`                                                                                 |
| Garbage collection         | `src-api/src/shared/assets/gc.ts` (`runAssetGarbageCollection`, `startAssetGcScheduler`)                                                                                    |
| Attribution                | `src-api/src/shared/assets/attribution.ts`                                                                                                                                  |
| Agent system-prompt context| `src-api/src/shared/assets/agent-context.ts` (`composeCatalogPreamble`)                                                                                                     |
| Workspace / flags          | `src-api/src/shared/assets/workspace.ts`, `flags.ts`                                                                                                                        |
| HTTP routes                | `src-api/src/app/api/assets.ts`                                                                                                                                             |
| MCP server                 | `src-api/src/shared/mcp/assets-server.ts`                                                                                                                                   |
| MCP subprocess bridge      | `src-api/src/shared/mcp/subprocess-bridge/assets-bridge.ts`, `token-store.ts`                                                                                               |
| Migrations                 | `src-api/src/shared/db/migrations/034_assets_catalog.ts` (v91), `035_assets_materialization.ts` (v92)                                                                       |
| Mode integration           | `src-api/src/shared/video/catalog-assets.ts` (`attachCatalogAssetToProject`, `hydrateProjectAsset`), `src-api/src/shared/services/design-mode/catalog-assets.ts` (`attachCatalogAssetToDesign`) |
| Startup wiring             | `src-api/src/index.ts` (`startAssetJobWorkers`, `startAssetGcScheduler`, `createAssetsMcpServer` registration)                                                              |

## Data Model

Migration `034_assets_catalog.ts` (schema v91) creates the catalog tables:

| Table                     | Purpose                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`                  | One row per logical asset. `UNIQUE (source, connection_id, source_id)`, `UNIQUE (client_request_id)`, and a partial unique on `(content_hash) WHERE source = 'local_fs' AND source_id IS NULL AND content_hash IS NOT NULL AND deleted_at IS NULL` |
| `asset_tags`              | `(asset_id, tag)` join. Tags are normalized lower-case in `registry.ts`                                                                       |
| `asset_collections`       | Named groupings                                                                                                                               |
| `asset_collection_items`  | `(collection_id, asset_id, position)`                                                                                                         |
| `asset_attachments`       | `(asset_id, scope, scope_id, role, attached_at)` — primary mechanism to wire assets to projects/tasks/messages/sessions                       |
| `assets_fts`              | FTS5 virtual table over `title`, `description`, `caption`, `ocr_text`, `transcript`, `tag_blob` (`porter unicode61 remove_diacritics 2`)      |
| `asset_embeddings`        | `(asset_id, modality, model, dim)` metadata. Modalities are `text` and `image`                                                                |
| `assets_embedding_config` | Active model per modality; supports re-encode status. Seeded with `text → gte-multilingual-base/768` and `image` placeholder                  |
| `assets_vec_768`          | `vec0` virtual table from `sqlite-vec` for 768-dim vectors. Created only when `sqlite-vec` loads; presence recorded as `assets.vec_available` |
| `asset_sync_state`        | Per-`(source, connection_id)` cursor / `full_sync_at` / `last_synced_at` / `last_error`                                                       |
| `asset_jobs`              | Background job queue (`ingest`, `proxy`, `artifact`, `reencode`, …) with attempts and `cancelled_at`                                          |

Indexes on `assets`: `content_hash`, `kind`, `captured_at`, `source`,
`(connection_id, source_id)`, and `modified_at`.

Migration `035_assets_materialization.ts` (schema v92) adds the cache and
materialization tables:

| Table                     | Purpose                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset_cache`             | Content-addressed cache rows keyed by `content_hash`. Records `cache_path`, `bytes`, `mime`, `fetched_at`, `last_used_at`, and origin triple `(origin_provider, origin_connection_id, origin_source_id)` plus an optional `source_file_hint_json` |
| `asset_materializations`  | Per-scope, per-asset active path with `license_snapshot_json`, `client_request_id`, `role`. Idempotency enforced by `UNIQUE (scope, scope_id, asset_id, client_request_id) WHERE client_request_id IS NOT NULL` |
| `asset_proxies`           | `(content_hash, preset)` proxy files generated by `AssetProxyEngine`. Cascade-deleted with the parent cache row                               |
| `asset_preview_artifacts` | `(content_hash, kind)` preview artifacts (`filmstrip`, `waveform`, `poster`) generated by `AssetArtifactEngine`                               |

Indexes: `idx_asset_cache_last_used`, `idx_asset_cache_origin`,
`idx_asset_materializations_scope`, `idx_asset_materializations_asset`,
`idx_asset_materializations_idempotency` (partial unique, above).

`AssetSource` is one of `local_fs`, `ai_gen`, `immich`, `photoprism`,
`google_drive`, `dropbox`, `box`, `onedrive`, `s3_compatible`, `openverse`,
`unsplash`, `pexels`, `pixabay`, `coverr`, `videvo` (`types.ts`). `AssetKind`
is one of `image`, `video`, `audio`, `pdf`, `text`, `doc`, `other`.

## Ingest & Indexing Pipeline

`AssetRegistry.ingest(input: IngestInput)` is the single entry point for local
ingestion. It is idempotent in three layers, checked in order
(`registry.ts` → `findExistingAsset`):

1. `client_request_id` lookup
2. `(source, connection_id, source_id)` lookup
3. `content_hash` match within the same source

Soft-deleted matches are revived via `restoreDeletedExisting`. After insert,
`storagePath` is normalized through `resolveWorkspaceStoragePath` (`workspace.ts`)
which rejects anything that escapes the configured workspace
(`getSetting('workDir')`). A `kind`/`mime` is derived from the file extension
when not supplied as a hint, and the row is enqueued as an `asset_jobs` entry
of kind `ingest`.

`AssetIndexer.runJob(job)` (`indexer/pipeline.ts`) dispatches by job kind:

| Job kind     | Responsibility                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `ingest`     | Probe (`probe.ts` → `readMediaMetadata`), text extract (`text-extract.ts`), SHA-256 hash, thumb + preview derivatives (`thumbs.ts`), embed text/image, write FTS row, mark `index_state = 'embedded'` |
| `proxy`      | Generate one proxy preset via `AssetProxyEngine` (ffmpeg), record in `asset_proxies`                                      |
| `artifact`   | Generate a preview artifact (`filmstrip`, `waveform`, `poster`) via `AssetArtifactEngine`, record in `asset_preview_artifacts` |
| `reencode`   | Batch-reencode embeddings when `assets_embedding_config` model changes (`REENCODE_BATCH_SIZE = 100`)                      |

The job worker (`indexer/jobs.ts`) ticks every 5s
(`WORKER_INTERVAL_MS = 5_000`), with `recoverInterruptedAssetJobs()` flipping
stuck `running` rows to `error: 'interrupted'` on startup. Proxy/artifact jobs
retry up to `MAX_DERIVATIVE_JOB_ATTEMPTS = 3` with `5s → 60s` exponential
backoff. `scheduleAssetJobDrain(limit?)` can be called inline (e.g. right after
ingest) to drain a small batch immediately.

## Hybrid Search

`AssetSearchService.search(query)` (`search/hybrid.ts`) implements Reciprocal
Rank Fusion (`RRF_K = 60`) over two candidate lists:

- FTS5 BM25 candidates from `assets_fts` (capped at `FTS_CANDIDATE_LIMIT = 200`)
  with the asset-filter SQL bolted on (`modalities`, `sources`, `tags`,
  `collectionId`, `attachedTo`, `dateRange`).
- Vector candidates from `AssetEmbeddingService.searchText(query)` against
  `assets_vec_768`. Includes image embeddings when no `modalities` filter is set
  or `image` is included. Suppressed when `semantic: false`.

Results are merged into `FusedCandidate` with `scoreBreakdown { fts, vector? }`,
sorted by fused score then `bestRank`, then sliced by an offset cursor
(`encodeCursor`/`decodeCursor` are base64url-encoded `{ offset }` blobs).
Scores returned to clients are normalized to `[0, 1]` by dividing by the page's
`maxScore`. A `snippet` is computed locally from `title`/`description`/
`caption`/`ocrText`/`transcript` (`snippetFor`).

When the query text is empty, `searchImmichSourceScoped`
(`connectors/remote-search.ts`) is consulted first so an explicit cloud
`source` filter (e.g. `?source=box`) returns live cloud-provider results even
without a text query. Otherwise the service falls back to `registry.list()`.

Blank browse pages return indexed catalog rows immediately. The service no
longer blocks first paint while remote providers validate that each source item
still exists. Instead, `scheduleRemoteValidation()` reconciles inaccessible
remote rows in the background and soft-deletes stale assets for the next load.
`whenRemoteValidationSettled()` exists for tests and callers that need to await
that cleanup path explicitly.

## Materialization

`AssetMaterializer.materialize(req: MaterializeRequest)` (`materializer.ts`) is
the lazy "I need bytes on disk now" entry point used by attach flows, hydrate
endpoints, exports, and the agent inline-attach path. Reasons are typed
(`MaterializeReason`): `video_attach | video_hydrate | design_attach | preview |
export | agent_inline`.

Key behaviors:

- **Single-flight per request key.** Concurrent calls for the same
  `(asset, scope, scopeId, role)` share one promise via the `inflight` map and
  one `AbortController` from `cancellers` (see the comment block at the top of
  `materializer.ts` referencing macOS File Provider and the Go singleflight
  pattern). This prevents an agent transcode + render preflight from opening
  two parallel multi-GB streams and double-counting the session budget.
- **Content-addressed cache.** Cached rows live keyed by `content_hash` in
  `asset_cache`. Hits update `last_used_at`. Lookups go via
  `cacheRow`, `cacheRowByOrigin`, or `cacheRowBySourceFileHint`
  (`materializer-store.ts`) — origin triple and source-file hint allow
  cross-asset reuse when the same byte stream backs different catalog rows.
- **Per-scope idempotency.** `(scope, scope_id, asset_id, client_request_id)`
  is partially-unique; `findIdempotentMaterializationRow` returns the existing
  row instead of materializing again when the caller passes the same
  `client_request_id`.
- **Budgets.** Defaults: session budget 5 GiB
  (`assets.materialize_session_budget_bytes`), project budget 20 GiB
  (`assets.materialize_project_budget_bytes`). Range downloads kick in above
  `assets.range_download_min_bytes` (32 MiB default). Agents can request a
  bump via the `assets_request_budget_increase` MCP tool, which writes the
  new value to settings and de-dupes per `(session_id, budget)`.
- **Progress + cancel.** `materializer-events.ts` publishes
  `materialize.started`, `materialize.progress`, `materialize.complete`,
  `materialize.error`, and `materialize.cancelled` events. `cancel(req)` fires
  the inflight `AbortController`, releasing the inflight slot for retry.
- **License snapshot.** `licenseSnapshotFor(asset)` captures provider /
  attribution / license code into `asset_materializations.license_snapshot_json`
  so attribution rendering is deterministic even after the source row mutates.

`MaterializeResult.urls` includes `raw`, `preview`, optional `proxy[preset]`,
and optional `filmstrip` / `waveform` / `poster`, all built by `assetUrls()`
(`materializer-helpers.ts`).

Derivative generation:

- `AssetProxyEngine` (`proxy-engine.ts`) renders the four `ProxyPreset` values
  `edit_1080p`, `web_720p`, `design_2k`, `audio_mp3` via `runFFmpeg`, gated by
  `assets.proxy_thresholds_json` (default: `minPixelCount 8,294,400`,
  `minDurationSeconds 600`, `minBytes 524,288,000`) so small assets stream
  raw and large ones get a proxy.
- `AssetArtifactEngine` (`artifact-engine.ts`) renders preview artifacts:
  `filmstrip` (10 frames), `waveform` (1000 bins), `poster`.
- Both resolve their source bytes through
  `resolveAssetDerivativeSource` (`derivative-source.ts`), which prefers the
  cache row over the workspace storage path.

## Connectors & Sync

`syncAssetsConnection` / `syncAssetsSource` (`connectors/sync.ts`) ingest from
the cloud-storage adapter layer (`@/shared/integrations/cloud-storage`) for the
five sources in `CLOUD_CATALOG_SOURCES`: `immich`, `box`, `google_drive`,
`dropbox`, `onedrive`. The connector wraps a `CloudStorageAdapter` as a
`CatalogConnector` that exposes `fullList`, `delta`, and `search`. Each
`CloudFile` is converted to a `RemoteAssetInput` via `cloudFileToRemoteAsset`
and upserted with `AssetRegistry.upsertRemote()`.

Per-connection state lives in `asset_sync_state` and is read/written by
`connectors/state.ts`. Whether a given connection participates in the catalog
is gated by per-connection setting keys prefixed
`INDEX_SETTING_PREFIX = 'assets.index_connection:'` —
`listAssetIndexedConnectionIds(source)` filters by the user's "Index in Assets"
toggle.

The catalog sync scheduler (`AssetCatalogSyncScheduler`) and one-shot calls
both push errors through `recordAssetSyncError` / `recordAssetSyncSuccess`.

## GC

`runAssetGarbageCollection()` (`gc.ts`):

1. Sweeps `assets` rows where `deleted_at IS NOT NULL` past
   `retentionMs` (default `DEFAULT_ASSET_GC_RETENTION_MS = 30d`), skipping any
   still-attached row (`asset_attachments`).
2. Optionally sweeps materialized cache rows / proxies / preview artifacts
   when `sweepMaterializedAssets: true` and removes orphaned files from disk.
3. Optionally purges stale partial downloads older than
   `PARTIAL_DOWNLOAD_MAX_AGE_MS = 1h`.

`startAssetGcScheduler()` runs the sweep once a day
(`ASSET_GC_INTERVAL_MS = 24h`); a global `gcRunning` guard prevents reentrancy.
The `/assets/gc` HTTP route runs it on demand.

## Attribution

`listAssetAttributions({ scope, scopeId })` (`attribution.ts`) reads
`asset_materializations.license_snapshot_json` joined to `assets` for a given
scope, parses it back into `MaterializeLicense`, and de-dupes by
`(provider, attribution, licenseCode)`. `renderAssetAttributionBlock()` formats
the result as `text`, `markdown`, or `html`. The snapshot is taken at
materialize time, so attribution survives later edits or deletion of the
source row.

## HTTP Routes

All routes are created by `createAssetsRoutes()` and mounted at `/assets` from
`src-api/src/index.ts` (`app.route('/assets', assetsRoutes)`).

| Method | Path                                | Purpose                                                                                       |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/assets`                           | `registry.list()` with `?q`, `?kind`, `?source`, `?tag`, `?collection_id`, `?from/?to`, `?cursor`, `?limit` |
| GET    | `/assets/search`                    | Hybrid FTS+vector search; returns `score`, `score_breakdown { fts, vector }`, and `urls`     |
| GET    | `/assets/stats/storage`             | `registry.storageStats()` plus `budgetBytes`, `warningThresholdBytes`, `warning` flag         |
| GET    | `/assets/events`                    | SSE stream of `AssetMaterializeEvent`s (`materialize.*` + `proxy.*` + `artifact.*`). Optional `?session_id` filter. 15s heartbeats |
| POST   | `/assets/native-folder-dialog`      | Spawn the OS-native folder picker from the local API process for web builds; returns `{ path }`, `null` on cancel, or 501 when unsupported |
| POST   | `/assets/gc`                        | Manual GC with optional `retentionDays` and `limit`                                           |
| GET    | `/assets/attribution/:scope/:scopeId` | Rendered attribution block (`?format=text\|markdown\|html`)                                 |
| GET    | `/assets/:id/materialize-status`    | Cache / proxy / preview-artifact state for an asset, optionally scoped                        |
| GET    | `/assets/:id`                       | Full asset row                                                                                |
| POST   | `/assets`                           | Ingest. JSON body or `multipart/form-data` (multipart file capped at `ASSET_MULTIPART_UPLOAD_MAX_BYTES = 10 MB`, written to `.assets/uploads/<uuid>/<safe-name>`) |
| DELETE | `/assets/:id`                       | Soft delete (`registry.softDelete`)                                                           |
| GET    | `/assets/:id/raw`                   | Stream original bytes. Falls back to a remote-adapter proxy via `proxyRemoteAssetContent()` when the asset is not materialized locally |
| GET    | `/assets/:id/thumb`                 | Stream thumbnail                                                                              |
| GET    | `/assets/:id/preview`               | Stream preview (or raw if no preview derivative)                                              |
| GET    | `/assets/:id/proxy/:preset`         | Stream a `ProxyPreset` file; rejects unknown presets with 400                                 |
| GET    | `/assets/:id/filmstrip`             | Preview artifact stream                                                                       |
| GET    | `/assets/:id/waveform`              | Preview artifact stream                                                                       |
| GET    | `/assets/:id/poster`                | Preview artifact stream                                                                       |

All byte-stream routes support `Range` requests (206 + `Content-Range` +
`Accept-Ranges`) via `streamFile()`; `ETag` is derived from `mtimeMs` + `size`.
Errors implement `AssetsError` and are forwarded as their declared HTTP status
through `handleAssetsError`.

## MCP Surface

`createAssetsMcpServer()` (`src-api/src/shared/mcp/assets-server.ts`) registers
under the name `assets`. Tools are also re-exposed to subprocess agents via
`src-api/src/shared/mcp/subprocess-bridge/assets-bridge.ts`. The Claude
extension wires the server when `assets` is in `relevantServers` and
`isAssetsCatalogEnabled()` is true (`src-api/src/extensions/agent/claude/index.ts`).

| Tool                                | Purpose                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `assets_search`                     | Hybrid keyword + semantic search with modality / source / tag / collection / attached-to / date filters                       |
| `assets_get`                        | Fetch one asset row by id                                                                                                     |
| `assets_similar`                    | Similar-asset lookup based on title/description/caption/tags, kind-filtered, semantic when available                          |
| `assets_ingest`                     | Register a workspace path; idempotent on `client_request_id` / `(source, source_id)` / content hash. URL ingestion reserved (rejected today) |
| `assets_attach`                     | Attach to a scope. `video_project` calls `attachCatalogAssetToProject` (hydrate: `proxy`); `design_project` calls `attachCatalogAssetToDesign`; other scopes just write an `asset_attachments` row |
| `assets_tag`                        | Add tags (lower-cased)                                                                                                        |
| `assets_sync`                       | Trigger a connector sync. Source defaults to `immich`                                                                         |
| `assets_recent`                     | Workspace + project recent lists with `urls`                                                                                  |
| `assets_materialize_status`         | Read materialization / proxy / preview-artifact state for an asset                                                            |
| `assets_attribution`                | Render the attribution block for a scope                                                                                      |
| `assets_request_budget_increase`    | Ask the user to raise a `session` or `project` byte budget. Bumps `assets.materialize_session_budget_bytes` /                 |
|                                     | `assets.materialize_project_budget_bytes`, de-duped per `(session_id, budget)`                                                |

Tool inputs use the `_` snake-case shape (`scope_id`, `client_request_id`,
etc.) per project convention, and outputs always include `urls` from
`assetUrls()` so the agent can hand a URL straight back to the user.

## Background Workers & Startup

`src-api/src/index.ts` invokes both startup hooks once the API server is up:

```ts
startAssetJobWorkers();   // 5s tick + interrupted-job recovery
startAssetGcScheduler();  // daily GC sweep
```

`startAssetJobWorkers()` first calls `recoverInterruptedAssetJobs()` so any
job stuck in `running` from a previous process flip to `error: 'interrupted'`,
then sets a 5s interval that calls `scheduleAssetJobDrain()`. Inline drains
also fire after every successful `ingest` so the user sees thumbnails and
embeddings within a few seconds of upload.

The Claude extension lazily creates the in-process MCP server in two places
in `claude/index.ts` (one for the always-allowed core path and one for the
per-task negotiated path); the corresponding `mcp__assets__*` glob is added to
`alwaysAllow`. Video Mode pre-grants `mcp__assets__assets_request_budget_increase`
as `destructive` in `permissions.ts` so it always surfaces a user approval
modal.

## Settings Keys

Set via the standard `settings` table; defaults are seeded by migration v92.

| Key                                            | Default                  | Used by                                                                |
| ---------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `assets.catalog_enabled`                       | (unset → enabled)        | `flags.ts`. Set to `'false'` to disable the catalog                    |
| `assets.materialize_session_budget_bytes`      | 5 GiB (`5368709120`)     | `AssetMaterializer` session quota, `assets_request_budget_increase`    |
| `assets.materialize_project_budget_bytes`      | 20 GiB (`21474836480`)   | `AssetMaterializer` project quota, `assets_request_budget_increase`    |
| `assets.cache_max_bytes`                       | 50 GiB (`53687091200`)   | `AssetMaterializer` cache eviction                                     |
| `assets.cache_ttl_days`                        | `90`                     | Cache-row TTL                                                          |
| `assets.materialize_concurrency`               | `3`                      | Materializer parallelism                                               |
| `assets.proxy_thresholds_json`                 | `{"minPixelCount":8294400,"minDurationSeconds":600,"minBytes":524288000}` | `AssetProxyEngine` threshold gate         |
| `assets.range_download_min_bytes`              | 32 MiB (`33554432`)      | Switch download strategy to ranged for large transfers                 |
| `assets.storage_budget_bytes`                  | 10 GiB (route default)   | `/assets/stats/storage` budget; warns at 80%                           |
| `assets.vec_available`                         | written by migration     | Set to `'true'` only when `sqlite-vec` loaded successfully             |
| `assets.index_connection:<connectionId>`       | (unset → disabled)       | Per-connection "Index in Assets" toggle (`connectors/state.ts`)        |

## Mode Integration

| Mode    | Entry point                                                                              | Behavior                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Video   | `src-api/src/shared/video/catalog-assets.ts` (`attachCatalogAssetToProject`, `hydrateProjectAsset`, `cancelProjectAssetHydration`, `REFERENCED_ASSET_PATH_PREFIX = 'catalog:'`) | `assets_attach` with `scope: 'video_project'` materializes eagerly with `hydrate: 'proxy'` because downstream transcode / analyze tools expect a local file. Referenced assets carry a `catalog:` path prefix until hydration |
| Design  | `src-api/src/shared/services/design-mode/catalog-assets.ts` (`attachCatalogAssetToDesign`, `resolveMaterializedDesignAsset`, `resolveDesignInlineAsset`) | `assets_attach` with `scope: 'design_project'` supports `role: 'inline'` vs `role: 'reference'`; inline pulls bytes immediately, reference defers |
| Chat / Task | `assets_attach` with any other scope (e.g. `task`, `message`, `chat_session`) just writes `asset_attachments` — no eager materialization                                       | The agent's system-prompt preamble (`composeCatalogPreamble`) lists attached assets so the model can mention them without re-fetching   |

`composeCatalogPreamble({ scope, scopeId, attachedCap })` emits a
`<!-- catalog-context-v1 -->` block prepended to the agent system prompt,
summarizing total catalog counts per kind and the most-recent attached assets
with their license-attribution hint. This is the only catalog context the
agent sees by default; everything else must come through `assets_*` tool calls.

---

_See also: [Cloud Storage](cloud-storage.md) · [MCP Integration](mcp.md) · [Video Mode](video-mode.md) · [Design Mode](design-mode.md) · [Memory](memory.md)_
