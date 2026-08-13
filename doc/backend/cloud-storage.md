---
summary: "Cloud storage and personal media integration — adapters, route surface, site proxying, local Immich support, LAN bridge path mappings, cache tables, and media MCP tools"
read_when:
  - Working on cloud storage connectors or the Library cloud storage tab
  - Debugging self-hosted media, stock catalog, or personal-media path mappings
  - Adding a cloud storage provider or media search capability
title: "Cloud Storage"
---

# Cloud Storage

The cloud storage subsystem gives the desktop app a common media/file browser over
site-proxied cloud providers, self-hosted personal media servers, and stock catalogs.
The active route group is mounted at `/cloud-storage` from `src-api/src/index.ts`.

## Source Map

| Area                   | Files                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| HTTP routes            | `src-api/src/app/api/cloud-storage.ts`                                                                              |
| Adapter contract       | `src-api/src/shared/integrations/cloud-storage/adapter.ts`, `types.ts`                                              |
| Registry/bootstrap     | `registry.ts`, `bootstrap.ts`, `cache.ts`, `index.ts`                                                               |
| Site-proxied providers | `providers/google-drive-proxy.ts`, `dropbox-proxy.ts`, `box-proxy.ts`, `onedrive-proxy.ts`, `site-proxy-adapter.ts` |
| Personal media         | `providers/immich-local-adapter.ts`, `providers/personal-media-proxy.ts`, `personal-media/*`                        |
| Stock catalogs         | `providers/stock-catalog-proxy.ts`                                                                                  |
| Media-kind filter      | `media-kind-filter.ts` (`filterByMediaKind`)                                                                        |
| LAN bridge             | `personal-media/lan-bridge/*`                                                                                       |
| Content cache          | `content/cache-paths.ts`, `content/materializer.ts`, `content/mime-policy.ts`                                       |
| Agent MCP helpers      | `src-api/src/shared/mcp/cloud-storage-media-server.ts`                                                              |

## Provider Model

All providers resolve through `cloudStorageRegistry.resolve(connectionId)` and implement
the `CloudStorageAdapter` interface:

| Capability           | Adapter method                      |
| -------------------- | ----------------------------------- |
| Browse folders/items | `listChildren()`                    |
| Search               | `search()`                          |
| Metadata             | `getMetadata()`                     |
| Thumbnails           | `getThumbnail?()`                   |
| Content stream       | `download()` with optional `Range`  |
| Export               | `exportContent()`                   |
| Folder create/upload | `createFolder()`, `upload()`        |
| Metadata edits       | `updateMetadata()`                  |
| Move/copy/delete     | `move()`, `copy()`, `delete()`      |
| Change polling       | `getChanges()`                      |
| Watch/timeline       | `watch?()`, `getTimelineBuckets?()` |

Registered providers:

| Provider                          | Adapter                     | Notes                                                                                                                                                       |
| --------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `google_drive`                    | `GoogleDriveProxyAdapter`   | Site-proxied Drive operations; declares thumbnails, export, and watch support                                                                               |
| `dropbox`                         | `DropboxProxyAdapter` / `DropboxLocalAdapter`   | Site-proxied or local OAuth via `providers/dropbox-local-adapter.ts`; the local adapter falls back to `listChildren` + `filterByMediaKind` for empty searches                                |
| `box`                             | `BoxProxyAdapter` / `BoxLocalAdapter`           | Site-proxied or local OAuth via `providers/box-local-adapter.ts`; full-text, thumbnails, extracted text representation                                                                       |
| `onedrive`                        | `OneDriveProxyAdapter` / `OneDriveLocalAdapter` | Site-proxied or local OAuth via `providers/onedrive-local-adapter.ts`; local adapter is also used by the native publish destination                                                          |
| `immich`                          | `ImmichLocalAdapter`        | Local desktop API-key credential support, albums-as-folders, thumbnails, streaming, search, timeline, metadata edits, delete, uploads, and LAN bridge reads |
| `photoprism`                      | `PersonalMediaProxyAdapter` | Site-proxied personal-media shape; no local credential creation yet                                                                                         |
| `openverse`, `unsplash`, `pexels` | `StockCatalogProxyAdapter`  | Read-only stock catalogs with license and attribution metadata                                                                                              |

## Route Groups

The route file intentionally mirrors the site cloud-storage API while adding desktop-only
local behavior for Immich and LAN bridge mappings.

| Group         | Routes                                                                                                                                      | Purpose                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Connections   | `GET/POST /connections`, `DELETE /connections/:id`, `POST /connections/test`, `POST /oauth/desktop-start`                                   | List/create/test/remove connections; local Immich creation is handled in the desktop DB, other requests are proxied to the site |
| Roots         | `GET/PUT /connections/:id/roots`                                                                                                            | Read/write provider root selection through the site                                                                             |
| Path mappings | `GET/POST /connections/:id/path-mappings`, `PATCH/DELETE /connections/:id/path-mappings/:mappingId`, `GET /discovery`, `POST /resolve-test` | Manage Immich server path to local mount path mappings                                                                          |
| Timeline      | `GET /connections/:id/timeline/buckets`                                                                                                     | Return day/month media buckets when the adapter supports them                                                                   |
| Items         | `GET/POST/PUT /connections/:id/items`                                                                                                       | List children, create folders, and upload multipart files                                                                       |
| Search        | `GET /connections/:id/search`                                                                                                               | Search files/media with query, kind, license, place, camera, date, favorite/archive/album, and search-mode filters              |
| Item detail   | `GET/PATCH/DELETE /connections/:id/items/:itemId`                                                                                           | Metadata read/update/delete                                                                                                     |
| Media bytes   | `GET /connections/:id/items/:itemId/thumbnail`, `GET /connections/:id/items/:itemId/content`                                                | Thumbnail and content streaming with passthrough cache/range headers                                                            |
| Move/copy     | `POST /connections/:id/items/:itemId/move`, `POST /connections/:id/items/:itemId/copy`                                                      | Site-proxied file operations                                                                                                    |
| Sync/index    | `GET /sync`, `POST /sync/run`, `GET /changes`, `GET/PATCH /content-jobs/:jobId`, `POST /index`                                              | Change polling, content jobs, and remote indexing hooks                                                                         |

## Local Immich Flow

Local Immich connections are created by posting `provider: "immich"` and
`kind: "personal-media"` to `/cloud-storage/connections`. Credentials are stored in the
existing `settings` table under:

- `cloud_storage_personal_media_connection_ids`
- `cloud_storage_personal_media_credential:<connectionId>`

`LocalPersonalMediaStore.ensureCached()` repopulates `cloud_storage_connections_cache`
at startup before any site-backed cloud connections are fetched. If the site is unreachable
or auth is revoked, `/connections` can still return local personal-media connections.

`ImmichLocalAdapter` maps Immich assets to the common `CloudFile` shape, preserving EXIF,
people, tags, geo, favorite state, rating, original path, checksum, dimensions, and duration
under `mediaMetadata`. Albums are exposed as folder-like entries with `id: "album:<id>"`.

## LAN Bridge

The LAN bridge lets Immich original-image downloads use a mounted local share instead of
streaming through the Immich API when a verified mapping exists.

| Component                          | Responsibility                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `PathMappingsStore`                | Persists mappings in `cloud_storage_path_mappings_local`                                 |
| `mount-discoverer.ts`              | Suggests mounted SMB/NFS/synced directories                                              |
| `tailscale-detector.ts`            | Detects Tailscale availability for UI hints                                              |
| `resolver.ts` / `bridge-stream.ts` | Resolve Immich `originalPath` to a local file and return a `Response` with range support |
| `verifier.ts`                      | Verifies a sample asset against local file size/checksum and emits a verification hash   |
| `reverification-scheduler.ts`      | Periodically re-checks mappings and marks failing mappings unverified                    |

Mappings require an absolute local directory, reject symlinks and traversal, and never allow
resolved paths to escape the mapped root. Client-supplied verification fields are stripped
on update; changing either path resets verification.

## Search and Timeline

`parseSearchInput()` supports both general file search and personal-media filters:

- search mode: `context`, `filename`, `description`, `ocr`
- media kind: image, video, audio, document
- license filters for stock catalogs
- place: country, state, city
- camera: make, model, lens model
- dates: taken/imported ranges
- people/tags, favorite/archive/album state

Immich search calls `/search/metadata`; timeline buckets call `/timeline/buckets` and
normalize the result into descending day or month keys.

## Content Cache and Jobs

Content materialization uses safe workspace paths under:

```
<workDir>/.neuma/cloud-cache/<provider>/<connectionId>/<providerItemId>/<fingerprint>
```

`cache-paths.ts` rejects unsafe path segments and verifies the final path stays inside the
cache root. `materializer.ts` downloads through the site API, writes a temporary file, atomically
renames it into place, and patches the remote content job status.

## Agent Tools

Claude runs register a built-in `cloud-storage-media` MCP server when built-in tools are
allowed. It exposes two helper tools:

| Tool                             | Purpose                                                             |
| -------------------------------- | ------------------------------------------------------------------- |
| `cloud_storage_cluster_by_event` | Groups personal-media items by timestamp and optional geo proximity |
| `cloud_storage_get_people`       | Summarizes people detected across personal-media items              |

These tools operate on `CloudFile`-like JSON already returned by search/list flows; they do
not fetch external media by themselves.

## Security Notes

- Site proxy calls use the site session bearer token, refresh once after 401, cap retry delay,
  and map upstream failures to meaningful `CloudStorageError` status codes.
- Personal-media base URLs allow only `http` or `https`, reject embedded credentials, block
  cloud metadata hosts and blocked/link-local IPs, require explicit LAN opt-in, and require
  HTTPS for non-LAN hosts.
- Immich fetches and connection tests use `redirect: "manual"`; redirects are rejected.
- LAN bridge resolution rejects symlinks, non-files, traversal, containment escapes, and size
  mismatches before streaming a local file.
- Direct Immich uploads with `writeMode: "direct-then-scan"` require a verified mapping and
  reject `.`/`..` path segments before writing inside the mapped root and triggering an Immich
  library scan.

## Centralized Assets Catalog Integration

Cloud storage providers feed the centralized **Assets Catalog** (see
[assets-catalog.md](assets-catalog.md)) — the catalog is the single index
across `local_fs`, cloud providers (`google_drive`, `dropbox`, `box`, `onedrive`),
personal media (`immich`, `photoprism`), and stock catalogs (`openverse`,
`unsplash`, `pexels`).

| Connector file                                          | Responsibility                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src-api/src/shared/assets/connectors/sync.ts`          | Drives incremental catalog sync from any `CloudStorageAdapter` — diffs `getChanges()` or `listChildren()` output into the `assets` table |
| `src-api/src/shared/assets/connectors/immich.ts`        | Immich-specific catalog connector that maps `CloudFile` metadata (EXIF, people, tags, geo) onto catalog rows                            |
| `src-api/src/shared/assets/connectors/remote-search.ts` | Federates stock-catalog and remote-provider search through `StockCatalogProxyAdapter` / `SiteProxyAdapter` without ingesting bytes      |
| `src-api/src/shared/assets/connectors/state.ts`         | Persists per-connection sync cursors in `asset_sync_state`                                                                              |

The catalog materializer (`src-api/src/shared/assets/materializer.ts`) is the only
component that downloads bytes for cloud-backed assets — when an agent or surface
attaches a catalog asset, the materializer dispatches through the same
`CloudStorageAdapter.download()` path described above and parks bytes under
`<workDir>/.neuma/assets/cache/` for re-use across attachments.

## Tests

Focused coverage lives under:

- `src-api/test/integration/api/cloud-storage.test.ts`
- `src-api/test/unit/cloud-storage/**`
- `src/__tests__/components/CloudStorageLibraryTab.test.tsx`
- `src/__tests__/components/CloudStorageAssetPicker.test.tsx`
- `src/__tests__/components/PersonalMediaConnectDialog.test.tsx`
- `src/__tests__/components/PathMappingsCard.test.tsx`

---

_See also: [API Routes](api-routes.md) · [Auth System](auth.md) · [MCP Integration](mcp.md) · [Database Schema](../reference/database-schema.md)_
