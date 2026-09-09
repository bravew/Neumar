# Gap and priority matrix

## Ranking rules

- P0 protects existing projects, output correctness, or upgrade safety.
- P1 removes a common workflow limitation or unlocks the next product slice.
- P2 improves scale, quality, or recovery after core correctness is secure.
- P3 is a large expansion that needs usage evidence or a separate product case.

## Matrix

| ID | Capability | Evidence in Neumar | Reference | Decision | Priority | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Close render and Studio evidence debt | Three prior acceptance rows remain open | Prior `13-08-22` plan | Adopt | P0 | 0 |
| G2 | Repeatable Video performance fixtures | No committed large-timeline or long-render harness | video-studio | Adapt | P0 | 0 |
| G3 | Remotion 4.0.522 update | Active media and renderer fixes since 4.0.515; `src-video` uses caret ranges while the other two manifests pin exactly | Remotion releases | Adopt | P0 | 1 |
| G3b | Align `mediabunny` to 1.55.5 and confirm a single resolved Zod | Root pins `mediabunny@1.55.2`; `@remotion/media@4.0.522` needs `1.55.5` | npm registry metadata | Adopt with G3 | P0 | 1 |
| G4 | HyperFrames 0.8.31 update | CLI wrapper pinned to 0.8.7 | npm package delta | Adopt with spike | P0 | 1 |
| G5 | Explicit rational project timebase | Rational IR exists, project choice does not | OpenReel | Adapt | P0 | 2 |
| G6 | Timeline In/Out export | Prior plan exists, no code landed | Neumar UX feedback | Adopt | P1 | 2 |
| G7 | Clip-count-bounded timeline rendering | Rows virtualized, clips not time-windowed | video-studio | Adapt and measure | P1 | 3 |
| G8 | Preview/final-render parity matrix | Multiple render paths lack one shared visual fixture matrix | video-studio | Adopt | P0 | 3 |
| G9 | Project-level version history | Timeline-only undo, no whole-project restore | video-studio | Adapt locally | P1 | 4 |
| G10 | Revision conflict handling | Unlocked full-timeline PATCH overwrites current state and is silently renumbered above it | video-studio plus source audit | Adopt | P0 | 4 |
| G10b | Single serialization boundary for project writes | `withProjectLock` and `projectDocumentUpdateLocks` are two unrelated in-process maps | source audit | Adopt | P0 | 4 |
| G11 | Unified media-health preflight | Relink and proxy tools exist but readiness is fragmented | OpenReel, video-studio | Adapt | P1 | 4 |
| G12 | Multicamera manifest and sync | No domain model | OpenReel | Adapt | P1 | 5 |
| G13 | Speaker activity and shot plan | Existing analysis artifacts, no multicamera planner | OpenReel | Adapt | P1 | 5 |
| G14 | Reviewable multicamera cut decisions | Existing plan gates and timeline op batches | OpenReel | Adapt | P1 | 6 |
| G15 | Multicamera agent domain | No tools; existing registry supports a focused domain | OpenReel | Adapt | P1 | 6 |
| G16 | Multicamera OTIO/editor handoff | Existing handoff package lacks angle metadata | OpenReel | Extend existing | P2 | 6 |
| G17 | Browser WebCodecs hard caps | Final output runs in sidecar | OpenReel | Reject direct copy | N/A | N/A |
| G18 | Universal timeline-item abstraction | Discriminated timeline clip union already covers Neumar | OpenReel | Defer | P3 | N/A |
| G19 | Rust core rewrite | Mature TypeScript IR and sidecar already exist | OpenCut | Reject | N/A | N/A |
| G20 | Cloudflare proxy-local stack | Deployment model does not match Neumar desktop | video-studio | Reject direct copy | N/A | N/A |
| G21 | Native motion-graphics layer engine | HyperFrames bridge still lacks usage evidence | prior plan, OpenReel | Keep gated | P3 | N/A |
| G22 | Central keyframe property registry | Current property surface remains manageable | video-studio | Defer until next two domains | P3 | N/A |

## Highest-risk correctness findings

### Stale timeline replacement

`PATCH /projects/:id/timeline` (`src-api/src/app/api/video.ts:2190`) does not
carry `expectedProjectRevision` and — unlike `timeline/op`, `timeline/undo`, and
`timeline/redo` — does not take `withProjectLock()`. Worse,
`projectDocumentForWrite()` (`src-api/src/shared/video/store.ts:2015`) renumbers
a stale write to `persisted.revision + 1` instead of rejecting it, so the
overwrite leaves no trace. A retry from one tab can overwrite a newer project
written by another tab or by an agent, and nothing downstream can detect it.

Fix all three before adding multicamera analysis and apply flows. The
`expectedProjectRevision` contract already exists for durable agent plans; reuse
that token rather than introducing a second one.

### Mixed timebase behavior

The IR supports rational frame rates, while `deriveTimelineFps()`
(`src-api/src/shared/video/timeline.ts:663`) returns
`Math.round(frameRate)` from the first asset that has one. 23.976 silently
becomes 24. Multicamera sync and long-form interchange will amplify the drift,
and `editor-handoff/rational-time.ts` already emits rational time downstream of
a value that was rounded upstream. Lock the timebase first.

### Performance name mismatch

`TimelineCanvas` is a React DOM surface. The name does not mean clips are canvas
painted. `TimelineTrack.tsx:266` maps every clip on a visible row. Measure by
visible clips and total clips before using it for large multicamera edits.

### Upgrade coupling

HyperFrames is pinned in `src-video`, wrapped by the API, referenced by a
bundled skill, checked by two validation scripts, and needed in packaged builds.
Change all of these in one checkpoint or do not bump the pin.

`scripts/check-hyperframes-skill-drift.mjs` makes half of this mechanical: it
fails when the exact `hyperframes` devDependency pin in `src-video/package.json`
and the `upstream-version:` frontmatter in the bundled `SKILL.md` disagree. Both
scripts run inside `pnpm validate`, so a partial bump cannot merge. The parts
that are *not* mechanical — the wrapped CLI output parsers, the packaged sidecar
probe, and the documented attribute ranges inside the skill body — are the ones
Phase 1 has to do by hand.

## Capability boundaries

### Multicamera analysis artifact

Use a new additive artifact family rather than writing directly to the timeline:

```ts
type MulticamArtifact =
  | MulticamManifestArtifact
  | MulticamSyncArtifact
  | MulticamActivityArtifact
  | MulticamShotPlanArtifact
  | MulticamCutReviewArtifact;
```

Each artifact needs:

- `schemaVersion`
- project and camera-group identity
- source fingerprints
- project timebase
- creation timestamp
- producer version
- status and warnings
- deterministic compatibility check

The shot plan may produce a proposed `TimelineOpBatch`. It must not mutate the
timeline until a user or approved durable plan applies the batch.

### Project revision

Keep these concepts separate:

| Concept | Meaning |
| --- | --- |
| `VideoProject.revision` | optimistic concurrency token for the current document |
| `VideoTimelineHistory` | undo and redo of named timeline operations |
| project revision snapshot | restorable whole-project state |
| agent execution log | durable execution intent and step outcome |

One counter should not impersonate all four.

There is also one serialization concept, and it currently has two
implementations. `withProjectLock()` in `project-lock.ts` guards route handlers;
`projectDocumentUpdateLocks` inside `store.ts` guards `updateProjectDocument()`.
Neither is aware of the other, and both are per-process `Map`s rather than file
locks. Phase 4 should collapse them into one boundary — the safest shape is for
`withProjectLock()` to be the only public entry point and for
`updateProjectDocument()` to run inside it — and state explicitly that project
writes are serialized per API process, which holds for the Tauri sidecar and for
`pnpm dev:api` but is not a filesystem guarantee.

### Timebase and output range

Use frame-native storage for new timing boundaries:

```ts
import type { FrameRate, TimelineFrame } from '@neumar/video-ir';

interface VideoProjectTimebase {
  // Reuse the IR's FrameRate rather than restating {num, den}. It is already
  // reduced and validated by normalizeFrameRate().
  rate: FrameRate;
  source: 'user' | 'derived';
  locked: boolean;
}

interface TimelineOutputRange {
  // Branded TimelineFrame, not bare number — the IR already distinguishes
  // TimelineFrame from SourceFrame, and the range is a timeline concept.
  inFrame: TimelineFrame;
  outFrameExclusive: TimelineFrame;
}
```

Both types belong in `packages/video-ir/` and are re-exported to `src-api` and
the frontend, which is how every other shared Video type already crosses the
`@/*` alias boundary. Do not declare a parallel copy in `src/shared/types/
video.ts`.

Keep `fps` and millisecond clip fields during migration. Derive them from the
canonical rational rate and frame boundaries. Do not silently reinterpret old
projects.

## Explicit non-goals

- full waveform-based multicamera synchronization in the first multicamera UI
  commit
- live collaborative editing or CRDT adoption
- cloud project history
- a new workflow engine
- a new effect package format
- a Rust rewrite of `packages/video-ir`
- replacement of Remotion, HyperFrames, or FFmpeg
- browser-side Whisper model downloads
- drop-frame timecode display in the first timebase increment
- automatic face-reaction cuts before speaker-driven cuts are reliable
