# Video editor UX feedback (2026-08-24)

Source: live usage session on the Preview step (`/video/:id?step=preview`),
screenshot attached, four items reported together. Filed as a findings +
recommendations doc rather than a spec — items 1, 2, 4 need a design call
before implementation; item 3 was small and well-precedented enough to fix
directly.

| # | Item | Status |
|---|---|---|
| 1 | No progress indicator while a folder / multi-file add is processing | **Implemented (first slice)** — floating panel off the existing SSE map |
| 2 | Folder-added assets are flattened; no folder grouping in the assets list | **Implemented (first slice)** — collapsible folder sections, no schema change |
| 3 | Deleting a timeline layer with clips on it should warn first | **Implemented** |
| 4 | Timeline needs In/Out points to set the output (export) range | **Plan written**, not implemented — `dev-doc/video-mode/15-08-24-output-range/README.md` |

## 3. Warn before deleting a track with clips (done)

`TrackHeader`'s delete button called `onDeleteTrack(track)` straight into
`removeTrack`, which silently dropped every clip on the track
(`useTimelineEditorStore.removeTrack`, no confirmation, no undo prompt).
Asset deletion already had exactly this guard —
`useProjectAssetDeletion.tsx` + `ProjectAssetDeleteDialog.tsx` warn before
removing an asset that's placed on the timeline. This change mirrors that
pattern for tracks:

- `useTimelineTrackActions.handleDeleteTrack` now checks `track.clips.length`.
  Empty tracks still delete immediately; tracks with clips set
  `pendingTrackDelete` instead and wait for `confirmDeleteTrack` /
  `cancelDeleteTrack`.
- New `TrackDeleteDialog.tsx` (same shape as `ProjectAssetDeleteDialog.tsx`,
  minus the async `deleting` state — `removeTrack` is a synchronous local
  store mutation, not a server round trip).
- `Timeline.tsx` renders the dialog and wires the three new values through.
- New locale key `video.editor.timeline.deleteTrackConfirm` (title/body/
  confirm/cancel) added to all six locales (en/zh/es/fr/hi/pt).

No new asset-deletion-style undo mechanism was added — this is a same-tab
confirm dialog, matching the asset case, not a persisted undo record. Track
deletion still goes through `removeTrack` → `withUserHistory`, so the
project's own Ctrl+Z still undoes it after confirming.

## 1. Floating progress indicator for batch asset adds

**Implemented (first slice):** `AssetBatchProgressPanel.tsx`, mounted from
`ProjectAssetsSection.tsx`. Fixed-position panel (bottom-right of the
viewport) derived entirely from the existing `materializationStates` SSE map
— no new backend surface. Shows an aggregate "Processing N asset(s) · P%"
headline plus a per-item list with retry/cancel wired to the existing
`useProjectAssetMaterializationActions` handlers; error items sort first.

**Correction after live testing (2026-08-24, same day):** live testing
surfaced that "Add folder" doesn't go through the SSE-tracked catalog
materialization path at all — see item 2 below, same root cause. The panel
now also accepts a `localTask` prop for non-SSE-tracked activity and shows
"Indexing folder…" / "Adding N/M from…" while a folder add is in flight
(`useAddLocalFolder.ts`).

**Second gap found in the same testing session, now fixed:** once files
land in Project assets, large videos (above `VIDEO_PROXY_SIZE_THRESHOLD_BYTES`
/ over 1080p) get a background proxy transcode
(`scheduleVideoProxyGeneration` → `generateVideoProxyForAsset` in
`src-api/src/shared/video/proxy.ts`) before they preview — that job
published **zero** events; only the SSE-driven catalog-hydration path did.
For a large batch (the reported case was 89 files) most tiles just sat
thumbnail-less with no explanation. Fixed by having
`generateVideoProxyForAsset` publish the same `materialize.started` /
`materialize.complete` / `materialize.error` events the catalog path already
uses, threading an optional `sessionId` through the four attach/hydrate
routes that call it (`linked-assets/:id/attach`, `assets/catalog/:id/attach`,
`assets/:id/hydrate`, `POST /projects/:id/assets`). Since locally-attached
assets have no `catalogAssetId`, the per-tile badge
(`projectAssetMaterializationBadge`) and the floating panel now fall back to
keying the SSE map lookup by the project asset id itself when no catalog id
is present — cancel/retry stay catalog-only in that fallback path, since
those actions call the catalog hydrate/cancel endpoints, which don't apply
to a local proxy encode.

**Still open**: the browser-upload fallback path (`uploadAssets`, used only
when there's no native file picker) doesn't thread a `sessionId` yet, so it
won't show progress. Low priority — it's a fallback, not the primary path.

**Third round (2026-08-24, same day) — two more bugs found by live-testing
the "Add folder" flow against a real 89-file DJI drone folder on an exFAT
card:**

1. Every attached asset displayed the *folder's* name instead of its own —
   `attachLinkedAsset` (`src-api/src/shared/video/linked-sources/index.ts`)
   stamped `provenance.sourceDisplayName` from `source.displayName` (the
   linked source/folder name) instead of `linkedAsset.name` (the individual
   file). Fixed to use the per-asset name.
2. Half the "media" (42 of 89 files) were AppleDouble resource forks
   (`._DJI_....MP4`, 4096 bytes each — macOS writes one beside every file
   when a folder sits on a non-HFS volume like an exFAT SD card). The
   crawler already has an `isFilesystemNoise()` guard meant to exclude
   exactly these, confirmed correct by direct code/DB inspection, but
   something in the live path still let them through. Rather than chase the
   exact live-server discrepancy further, `useAddLocalFolder.ts` now
   defensively re-filters the crawler's own output before attaching
   anything — dotfile names, OS bookkeeping names (`thumbs.db`,
   `desktop.ini`), and any `video`/`image`-kind item under 16KB (real
   footage is never that small) are dropped, with a "Skipped N unsupported
   file(s)" toast. This is a second, independent layer — it protects future
   folder-adds regardless of whether the backend-side gap is ever fully
   root-caused.

Both existing bugs affected the live "chong" project
(`930743ca-b6fd-41fa-a9e7-e62da9ccd4f5`) — cleaned up in place with the
user's confirmation: 42 junk assets deleted via the existing delete-asset
endpoint, and the 47 real assets' saved display names corrected directly
(no PATCH-asset endpoint exists yet; verified safe since project reads/writes
have no in-process cache and the server was idle during the edit).

**Current state.** There are two local-add paths, both in
`src/components/video/assets/`:

- `useAddLocalFiles.openFilePicker` — native OS file dialog, gets real paths,
  sends them all in **one** `POST /projects/:id/assets` request
  (`attachAssetPaths`, `useVideoProject.ts:378`). No toast at all until the
  request resolves; `addingFiles` only disables the dropdown item. For a
  multi-GB 4K batch this can be a long silent wait — exactly the gap
  reported.
- `useAddLocalFiles.handleFilesSelected` — browser `<input type=file>`
  fallback (used when there's no native dialog), uploads **one file at a
  time** in a loop and does show a "queued" toast up front, but never a
  running "X of N" count while the loop executes.
- `useAddLocalFolder.addLocalFolder` — this is the *linked source* flow
  (`actions.addLinkedSource({provider:'local-fs', ...})`), not a project-asset
  attach. It grants folder access, registers a context source, and kicks off
  an async catalog crawl (`syncLinkedSource`) with **no progress surfaced at
  all** in this hook — the folder just eventually becomes browsable.

Separately, there is already a real-time per-asset progress channel:
`useAssetMaterializationEvents` opens one SSE connection per project
(`materialize-session-<projectId>`) and maintains a
`Record<assetId, AssetMaterializationState>` with `started` / `progress`
(0-100%) / `complete` / `error` / `cancelled`. Two things already consume it:
`projectAssetMaterializationBadge` (a per-tile corner ring) and
`AssetMaterializationNotice` (one-line text, singular — keyed to whatever
`activeAssetIds` happens to be, not a batch summary). Neither is a "floating"
UI element and neither aggregates a folder/multi-file batch.

**Recommendation.** Don't build a new progress channel — the SSE map already
carries the right data. Add one small piece: a floating aggregate summary
(bottom-corner toast-style panel, similar to how upload managers show
"Uploading 3 of 12") that:

1. Derives its count/percent from `materializationStates` (already fetched in
   `ProjectAssetsSection`) filtered to `started | progress`, rather than adding
   a second state store.
2. Also covers the two gaps SSE doesn't reach today:
   - `openFilePicker`'s single batched POST has no per-file feedback at all —
     needs the backend endpoint to report per-path progress (SSE or chunked
     response) instead of one opaque request, or at minimum an immediate
     "Adding N files…" toast that's replaced on completion (cheap first step,
     doesn't fix the silent multi-minute wait for large batches).
   - `useAddLocalFolder`'s linked-source crawl has no progress signal to hook
     into yet; would need `syncLinkedSource` to expose crawl counts.
3. Auto-dismisses `ASSET_MATERIALIZATION_NOTICE_TTL_MS` after the last item
   settles, matching the existing notice's TTL convention.

Smallest correct first slice: wire the floating aggregate off the existing
SSE map for the two paths that already emit it (catalog/reference hydration),
then follow up on `attachAssetPaths` and `syncLinkedSource` progress
separately since those need backend changes.

## 2. Folder structure for project assets

**Implemented (first slice, collapsible groups):**
`ProjectAssetFolderGroups.tsx` groups `displayedAssets` in
`ProjectAssetsGroupedList.tsx` by `dirname(path)` for `origin==='external'`
assets — no schema change, per the no-schema-change slice below. Each folder
renders as a collapsible section (open by default, `ChevronRight` toggle,
count badge) above the existing flat/paginated list; assets with no
derivable folder (catalog/managed origin) fall through to that unchanged
flat list. Projects with zero folder-sourced assets render pixel-identical
to before — `folders.length === 0` short-circuits to the old path.

**Deeper bug found in live testing (2026-08-24, same day), now fixed:**
grouping was correct for assets already in `project.assets`, but "Add
folder" (`useAddLocalFolder.ts`) never put folder-added files there in the
first place — it only registered a **linked/context source**
(`addLinkedSource({ role: 'context' })`) and synced it for browse/search.
That's a different, legitimate feature (the same thing "Connect cloud" →
Linked sources registers), but it sat one dropdown item away from "Add
files" with no visual distinction, so a folder add looked identical to a
files add and silently produced zero project assets.

Fixed: "Add folder" now also crawls the folder (existing
`syncLinkedSource`), waits for the discovered-asset count to stabilize
(there's no completion event for this job kind — see item 1), and attaches
every discovered file into `project.assets` via `attachLinkedAsset`, so it
behaves like a folder-shaped "Add files." The underlying linked-source
registration is a still side effect (harmless — it's also how "Connect
cloud" works), not a second user-facing feature.
**Not done**: the attach-time `sourceFolderLabel` follow-up for
catalog/uploaded assets (tier 2 below) — those still don't group.

**Current state.** `ProjectAssetsGroupedList` (`useProjectAssetGroups`) groups
strictly by `kind` (video/image/audio) — there is no folder/origin grouping
anywhere in the assets rail today. Two different "add folder" affordances
exist and neither preserves folder identity into the *Project assets* list:

- The header's "Add folder" (`ProjectAssetsHeader` → `useAddLocalFolder`)
  attaches the folder as a **linked source** (`VideoLinkedSource`, provider
  `local-fs`), which is a separate browse/context surface, not project assets.
- There's no current path that says "pick a folder, flatten its contents into
  individual project assets, and remember which folder each came from" — but
  per the screenshot, individually-added local files *do* end up flat in
  Project assets with no grouping, which matches the "treated individually"
  complaint once files are added one by one or dropped in from a folder.

**What's already available to group by, with no schema change.** For
`origin: 'external'` assets (the common case for locally-added footage —
`VideoMediaItem.path` is the real absolute filesystem path, not a
project-managed copy), `dirname(asset.path)` is already a valid, stable
per-file folder path. Nothing new needs to be stored for that class of asset.
For catalog/managed assets (uploaded bytes, or attached from a connector),
there's no filesystem path — `provenance` is an open bag
(`[key: string]: unknown`) and would need a new field (e.g.
`provenance.sourceFolderLabel`) set at attach time if folder grouping should
also apply there.

**Recommendation.** Two-tier plan:
1. **No-schema-change slice**: add a folder-derived secondary grouping level
   in `ProjectAssetsGroupedList`, applied only within each kind group, keyed
   by `dirname(path)` for `origin==='external'` assets (label = last path
   segment, mirroring `lastPathSegment` already used in
   `useAddLocalFolder.ts`); assets without a derivable folder stay in an
   "Ungrouped" bucket rendered exactly like today. This alone fixes the
   locally-added-folder case in the screenshot without backend changes.
2. **Follow-up**: extend `attachAssetPaths` (backend `POST .../assets`) to
   accept and stamp an explicit `sourceFolderLabel`/batch id when the caller
   is adding a folder's worth of files in one shot, so uploaded/managed
   assets (not just external-path ones) can carry the same grouping — and so
   a future "collapse this folder" UI action has a stable key instead of
   inferring one from a path string.

This needs a design decision before implementation: should folder groups be
collapsible sections, a breadcrumb/tree view, or just a secondary filter chip
next to the existing kind filter (`All / Video / Image / Audio`)? The kind
filter's UI (`ProjectAssetsGroupedList.tsx:137-159`) is the natural place to
add a parallel folder filter if a flat-list-plus-filter approach is preferred
over nested collapsible groups.

## 4. Timeline In/Out points for output (export) range

Full implementation plan: `dev-doc/video-mode/15-08-24-output-range/README.md`.

**Current state.** There is no render-range concept anywhere in the timeline
model or pipeline today:
- `VideoTimeline.durationMs` is derived by `getTimelineDurationMs(tracks)` —
  the full extent of every track's clips. There's no separate "output starts
  here / ends here" field.
- The toolbar's flag icon (`TimelineToolbar.tsx`, `handleAddMarker`) adds a
  **chapter/comment marker** (`markerChapter`, `markerComment` — see
  `TimelineLabels.ts`), not a range boundary; markers are annotations, not
  render bounds.
- `src-api/src/shared/video/pipeline.ts` renders the full timeline duration —
  there's no `rangeMs`-equivalent input to the render/export path at all
  (the only `rangeMs` in the codebase is unrelated:
  `provenance.generatedFor.rangeMs`, which records what source range a
  generated asset was produced *for*, not an output trim).

**Recommendation — new, scoped feature, not a small fix:**
1. **Data model**: add an optional `VideoTimeline.outputRangeMs?: [number, number]`
   (or project-level, if the range should survive timeline edits/undo
   independent of clip content — needs a decision). Defaults to the full
   duration when unset, so every existing project keeps rendering exactly as
   today (matches the "Don't introduce `timeline.v2` without a proven load
   path" rule in the video-mode runbook — this should land as a *new optional
   field* readable by old code as "no trim").
2. **UI**: In/Out set buttons (`I` / `O` keyboard shortcuts, standard NLE
   convention) that stamp the playhead position into `outputRangeMs`, plus
   draggable in/out handles on the timeline ruler (same interaction family as
   the existing clip trim handles, `trimStart`/`trimEnd` in
   `TimelineLabels.ts`, but operating on the ruler/global range rather than a
   clip).
3. **Render/export**: `pipeline.ts` and the Remotion/HTML paths need to clip
   final output to `outputRangeMs` — this touches every render engine
   (`remotion`, `html`, `hyperframes`) per the "runtime-selection contract is
   enforced, not advisory" rule, so each engine's honest tradeoffs doc likely
   needs a line about range-trim support.
4. **MCP/agent surface**: needs a named tool
   (`video_set_output_range` or similar) following the runbook's rule that
   timeline edits go through named builders, not ad hoc ops.

This is the largest of the four items — it's a genuine new feature spanning
data model, timeline UI, and every render engine, not a bug fix. Worth a
short implementation-plan doc of its own (mirroring
`dev-doc/video-mode/07-01-video-use/04-implementation-plan.md`'s shape)
before starting, once prioritized.
