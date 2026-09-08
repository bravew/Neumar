# Phase 4 acceptance evidence

Project recovery and media-health contracts. Captured on 2026-09-08 on the same
Apple M4 Pro host as Phases 0 through 3.

## Results

| Activity | Result | Evidence |
| --- | --- | --- |
| A stale timeline save cannot clobber a newer edit | Passed | `video-timeline-route.test.ts` — the second tab's save returns 409 with the current revision, and the first tab's edit is still on disk |
| The two lock maps are actually collapsed | Passed | Same suite — a `PATCH .../timeline` interleaved with an `updateProjectDocument()` caller serializes, and both writes survive |
| The lock survives nested acquisition | Passed | `project-lock.test.ts` — a nested `withProjectLock()` for the same project runs inline while a separate caller still waits |
| Every saved revision is recoverable | Passed | `project-history.test.ts` — snapshot written before the rename, indexed after, deduplicated by digest |
| Retention protects named versions | Passed | Same suite — a named revision survives five automatic ones at retention 2, and named versions do not count toward the limit |
| Restore is append-only and idempotent | Passed | `video-project-history-routes.test.ts` — the head is captured first, the restored revision is above it, and restoring twice lands on the same document |
| One media-health report | Passed | `media-health.test.ts` — ready, missing, unreachable, and the three materialization states, with `blockingRender` counting only timeline assets |

## Commands

```bash
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/project-lock.test.ts \
  test/unit/video/project-history.test.ts \
  test/unit/video/media-health.test.ts \
  test/integration/video-project-history-routes.test.ts \
  test/integration/video-timeline-route.test.ts
pnpm test:api
```

## The bug, and what actually caused it

`PATCH /projects/:id/timeline` was the only timeline mutation route without a
lock — `timeline/op`, `timeline/undo`, and `timeline/redo` all took one. On its
own that is a race. What turned the race into silent data loss was
`projectDocumentForWrite()`: it renumbered any write whose revision was not
greater than what was on disk, so a stale save landed *above* the state it had
just destroyed. Nothing downstream could tell an edit had been lost, because the
revision counter said the write was the newest thing that had happened.

The route now runs under the lock and accepts `expectedRevision`. A mismatch is
a 409 carrying the current revision, so the client can reload or save a copy.

Written as the plan asked: the regression test failed on the tree before the
fix, returning 200 where it now returns 409.

## Two locks became one, and the lock became re-entrant

`withProjectLock()` kept `projectLocks` while `updateProjectDocument()` kept its
own `projectDocumentUpdateLocks`. Neither saw the other, so a route holding one
could interleave with a caller holding the other.

Collapsing them deadlocked immediately: `updateProjectDocument()` is called from
inside handlers that already hold the lock, and a plain queue makes the inner
acquirer wait on a promise that cannot settle until the outer one returns. The
`video-edit-server` and `audio-generation` suites timed out at 30 seconds until
the lock tracked held ids through `AsyncLocalStorage` and ran a nested
acquisition inline.

It serializes per API process — true for the Tauri sidecar and `pnpm dev:api`.
It is not a file lock, so a second process on the same workspace is ordered only
by the revision check.

## A latent bug the silent renumber had been hiding

`getProject()` wrote its migrated document to disk but returned the *pre-write*
revision, so the caller's next write always looked stale. It had been invisible
because that stale write was silently renumbered. The moment behind writes
stopped being renumbered past, it surfaced as
`on disk: revision 1, write carried 0` in the native-enhancement route. The
migration now returns the revision it wrote.

## Snapshot ordering

`writeProject()` already wrote to a temp file and renamed over `project.json`,
so a torn write could not corrupt a project. What did not exist was a durable
copy of the state being replaced. The snapshot is now written and indexed
*before* that rename, and pruning runs only once both are on disk:

- crash between snapshot and rename → an unreferenced snapshot, costing disk
- the reverse order → an index entry pointing at a file that is not there,
  costing a restore

History is additive, so a project still saves when its history directory is
unwritable; the test makes the directory a file to prove it.

## What is not in this phase

The plan's Phase 4 also lists the version-history UI sheet, the media-health
panel and editor badges, threading the existing materialization session id into
browser-upload progress, and the Brief ownership cleanup with its accessibility
checks. Those are frontend work on top of the contracts landed here; the
endpoints they need (`/projects/:id/history*`, `/projects/:id/media-health`) are
in place and covered.

`expectedRevision` is enforced on the timeline route. Internal flows that read a
project, do async work, and write it back have not all been audited — several
are genuine stale reads — so they still renumber, but with a warning naming the
caller rather than silently. Auditing those call sites is the remaining half of
the plan's item 2.

## Known baseline debt

Unchanged: `src-api/test/integration/api/agent.test.ts` fails on an incomplete
`getAgentRun` mock, and `src-api/.../pipeline.ts` has two pre-existing
`typecheck` errors. Neither is in the store, lock, history, or media-health path.
The rest of the API suite is green at 520 files.
