# Asset picker connection-starvation fix plan (2026-08-26)

Status: implemented (Checkpoints 1–4); live multi-tab acceptance still owed

## What landed

- `src/shared/assets/materializationLease.ts` — refcounted lease registry with
  a 90s grace window; owns `ASSET_MATERIALIZATION_NOTICE_TTL_MS`.
- `src/shared/hooks/useAssetMaterializationLease.ts` — `useSyncExternalStore`
  read plus a declarative `active` acquirer.
- `useAssetMaterializationEvents(sessionId, { enabled? })` opens
  `/assets/events` only while a lease is held; `enabled` overrides it.
- Leases are taken by `useAddLocalFiles`, `useAddLocalFolder`,
  `useCatalogAssetAttach`, `useProjectAssetMaterializationActions`,
  `useProjectAssetTimelineActions`, design `AssetGallery`, and by
  `ProjectAssetsSection` for any asset persisted as `hydrating`. Both file and
  folder paths acquire *after* the chooser closes, never while it is open.
- `run-tree-store` owns its request lifetime (internal `AbortController` +
  12s timeout) instead of the first caller's signal, and always settles
  `loading`. `ExecutionDiagnosticsPanel` bounds its own fetch the same way and
  distinguishes an unmount abort from a timeout; `OwnerRunDiagnostics` renders
  a settled "Diagnostics could not be loaded" state.
- Coverage: `src/__tests__/shared/assetMaterializationLease.test.ts`,
  `assetMaterializationEvents.test.ts`, `run-tree-store.test.ts`, plus new
  cases in `ExecutionDiagnosticsPanel.test.tsx` and `addLocalAssets.test.tsx`.

Incidental: `ExecutionDiagnosticsPanel.tsx` and `ProjectAssetTile.tsx` were
split (`DiagnosticsGrid.tsx`, `useDiagnosticsLabels.ts`,
`ProjectAssetThumbnail.tsx`) to satisfy the 350-line component cap.
`ProjectAssetTile.tsx` was already over the cap at HEAD.

Still owed: the live Chrome acceptance in Checkpoint 4. Baseline measured
before reload was 5 established Chrome→:5126 sockets against a ~6 cap.

Scope: the web editor at `/video/:id`, specifically **Add file(s)** and
**Add folder** in the Project assets rail. This plan does not change the
native Tauri picker path or the asset data model.

## Verified failure

Live Chrome reproduction against
`/video/f46708b0-5fd1-4b5b-be95-f13a5d3e53e6`:

1. Open **Add assets → Add file(s)** (or **Add folder**).
2. The menu item immediately becomes disabled because `addingFiles` or
   `addingFolder` is set to `true`.
3. No file-picker process is spawned and no API error appears.
4. The item recovers only after the client timeout (150 seconds).

The API itself is healthy: `/health` returned 200 and the CORS preflight for
`/assets/native-file-dialog` returned 204. The server process had six active
Chrome connections on port 5126. Three Neumar video tabs were open, and the
target tab contributed two active requests after reload. The picker POST was
queued in Chrome's per-host HTTP/1.1 connection pool, so
`/assets/native-(file|folder)-dialog` never reached Hono and could not spawn
`osascript`.

The relevant source already describes this failure mode:

- `src/shared/lib/shared-event-source.ts` documents the ~6-socket browser cap.
- `src/components/video/assets/ProjectAssetsSection.tsx` mounts the asset
  event subscription for every editor instance.
- `src/shared/hooks/useAssetMaterializationEvents.ts` opens a persistent SSE
  connection even when a project has no materialization in progress.
- `src/components/shared/run-diagnostics/ExecutionDiagnosticsPanel.tsx`
  leaves the diagnostics request in “Loading diagnostics…” without a request
  timeout.
- `src/shared/assets/api.ts` waits up to 150 seconds for the native picker
  request, which makes a queued request look like a dead button.

## Design decision

The first implementation slice should reduce idle connection ownership and
make stalled diagnostics self-healing. It must preserve progress events while
an add/materialization operation is active, and it must not replace a real
native chooser with a silent or destructive fallback.

Cross-tab event sharing (SharedWorker/BroadcastChannel) and HTTP/2 are useful
follow-ups, but are not required to fix the common case of several idle video
tabs.

## Throughput checkpoint

- **Blocking first step:** establish a deterministic multi-tab reproduction and
  count active requests; otherwise a stream-lifecycle change could mask the
  symptom without proving that the picker obtains a socket.
- **Independent workstreams:** the asset-stream lifecycle and diagnostics
  request lifecycle touch disjoint files and can be developed independently
  after the baseline test exists.
- **Shared mutable state:** the browser connection pool and the module-level
  shared-event-source pool are shared runtime state. The live verification must
  exercise both one-tab and multi-tab cases; tests must not assume module-level
  pooling crosses tabs.
- **Smallest safe decomposition:** four checkpoints below; each has a static
  assertion plus a runtime or test verification.

## Checkpoints

### 1. Pin the regression and inventory stream ownership

Likely files/subsystems:

- `src/components/video/assets/ProjectAssetsSection.tsx`
- `src/shared/hooks/useAssetMaterializationEvents.ts`
- `src/components/shared/run-diagnostics/ExecutionDiagnosticsPanel.tsx`
- `src/shared/stores/run-tree-store.ts`
- `src/__tests__/video/addLocalAssets.test.tsx`
- `src/__tests__/shared/sharedEventSource.test.ts`
- new browser/e2e fixture if the existing Playwright harness can expose two
  tabs to the same origin

Work:

- Add a testable connection/stream ownership seam (for example, an injectable
  `enabled` flag and a visible subscription count in test-only instrumentation)
  without changing production behavior yet.
- Record the exact request classes that are allowed to stay open: active asset
  materialization, active render progress, and an in-flight agent stream.
- Ensure the `fetchOwner` cache does not let one tab's aborted signal cancel a
  different tab's shared request; either deduplicate only within a consumer or
  use a request whose lifetime is independent of the first caller's signal.

Observable result: a focused test can distinguish an idle asset SSE from an
active materialization stream, and an aborted diagnostics caller cannot leave a
shared owner request permanently pending.

Verification:

```bash
pnpm vitest run \
  src/__tests__/video/addLocalAssets.test.tsx \
  src/__tests__/shared/sharedEventSource.test.ts \
  src/__tests__/ExecutionDiagnosticsPanel.test.tsx
```

### 2. Make asset materialization streams demand-driven

Likely files:

- `src/shared/hooks/useAssetMaterializationEvents.ts`
- `src/components/video/assets/ProjectAssetsSection.tsx`
- `src/components/video/timeline/useTimelineAssetMaterializationSync.ts`
- `src/components/video/assets/useAddLocalFiles.ts`
- `src/components/video/assets/useAddLocalFolder.ts`
- `src/components/video/assets/AssetBatchProgressPanel.tsx`

Work:

- Add an explicit subscription lease/`enabled` input to
  `useAssetMaterializationEvents`.
- Acquire the lease when file/folder attach or materialization starts; retain
  it for the existing 90-second notice TTL after the last active item settles
  so late proxy events and the progress panel are not lost.
- Do not open `/assets/events` for an idle project with no active add,
  materialization, or pending materialization state.
- Keep the assets panel and timeline on the same session id and shared source
  when the lease is active; the change is about when the source exists, not
  about creating duplicate streams.
- Ensure cleanup releases the lease on unmount and on cancellation, including
  React StrictMode's mount/unmount cycle.

Observable result: an empty/idle project owns zero asset SSE connections;
starting an add opens one shared session stream and progress remains visible
through settlement.

Verification:

```bash
pnpm vitest run \
  src/__tests__/video/addLocalAssets.test.tsx \
  src/__tests__/video/ProjectAssetsHeader.test.tsx \
  src/__tests__/shared/sharedEventSource.test.ts
```

Then verify in Chrome with two or more open `/video/:id` tabs: idle tabs must
not add `/assets/events` connections; an active add must still receive
materialization progress.

### 3. Bound and recover diagnostics requests

Likely files:

- `src/components/shared/run-diagnostics/ExecutionDiagnosticsPanel.tsx`
- `src/shared/stores/run-tree-store.ts`
- `src/__tests__/ExecutionDiagnosticsPanel.test.tsx`
- new `src/__tests__/shared/run-tree-store.test.ts` if store behavior is not
  already covered

Work:

- Give the owner-tree and diagnostics fetches a bounded timeout suitable for a
  local request (for example 10–15 seconds), using `AbortController` and
  preserving the existing cleanup path.
- Render a settled “diagnostics unavailable” state after timeout instead of
  leaving “Loading diagnostics…” indefinitely.
- Do not retry aggressively; at most provide the existing user-triggered
  refresh/reopen path so a timed-out request cannot refill the six-socket pool.
- Preserve the distinction between an intentional abort during unmount and a
  genuine timeout/error.

Observable result: a stalled diagnostics endpoint releases its connection and
the UI leaves the loading state within the timeout; normal diagnostics still
render unchanged.

Verification:

```bash
pnpm vitest run \
  src/__tests__/ExecutionDiagnosticsPanel.test.tsx \
  src/__tests__/shared/run-tree-store.test.ts
```

### 4. End-to-end picker acceptance and rollout guard

Likely files/subsystems:

- `src/shared/assets/api.ts`
- `src/components/video/assets/pickLocalMediaFiles.ts`
- `src/components/video/assets/useAddLocalFolder.ts`
- `src/components/video/assets/useAddLocalFiles.ts`
- API route tests under `src-api/test/unit/assets/` and
  `src-api/test/integration/`
- the project’s browser/e2e test harness

Work:

- Keep the 120-second server-side chooser lifetime and the client’s
  user-facing error handling; do not add a short timeout that kills a chooser
  after it successfully opens.
- Add a deterministic browser-level test or harness probe that opens multiple
  video tabs, confirms idle tabs do not consume asset SSE slots, then invokes
  **Add file(s)** and **Add folder** and observes a request/chooser completion
  or a clear error.
- Verify cancellation resets `addingFiles`/`addingFolder` and that a second
  attempt is possible without reloading.
- Capture before/after socket counts and the elapsed time from click to API
  request in the fix record.

Observable result: both controls remain enabled when idle, invoke their
handlers with multiple video tabs open, and recover immediately on cancel or
picker failure rather than waiting 150 seconds.

Verification:

```bash
pnpm test:fast
pnpm validate
```

Manual acceptance must include the original URL and the existing second
Neumar video tab. Record the Chrome DOM state, API request status, and active
connection count in the implementation progress note.

## Follow-up, not a prerequisite

If users routinely keep enough active streams across tabs to exhaust six
connections after Checkpoints 2–4, design a cross-tab event transport:

- elect one tab/SharedWorker as the `/assets/events` owner;
- broadcast materialization events to other tabs;
- handle owner-tab close and browser sleep/reconnect;
- add multi-tab failover tests.

Do not implement this larger transport in the first fix slice. The current
evidence supports removing idle ownership and bounding diagnostics first.

## Out of scope

- changing project asset schemas or provenance;
- changing the Tauri `@tauri-apps/plugin-dialog` path;
- hiding the problem with a blind `window.prompt` fallback;
- closing or navigating the user's other browser tabs;
- unrelated React StrictMode `AbortError` console noise unless it is proven to
  keep a socket or request alive after cleanup.
