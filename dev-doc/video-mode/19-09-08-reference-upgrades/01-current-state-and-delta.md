# Current state and upgrade delta

## Audit method

The audit used:

- Git history and source diffs in each reference checkout
- Neumar's Video Mode runbook and plans from `13-08-22` through `18-08-26`
- current source and focused tests
- official Remotion release notes
- the published `hyperframes@0.8.31` npm tarball, compared with Neumar's
  installed `0.8.7` package

No sample repository was modified. No dependency was installed into Neumar.

## Neumar baseline

### Architecture that should remain

| Concern | Current owner | Assessment |
| --- | --- | --- |
| Timeline model and inverse operations | `packages/video-ir/` | Strong. Keep as the canonical edit model |
| Frontend editing state | `src/components/video/timeline/useTimelineEditorStore.ts` | Strong for same-tab edits and undo |
| Persistence | `src-api/src/shared/video/store.ts` | Atomic file replacement, but weak conflict recovery |
| Agent edit surface | `src-api/src/shared/mcp/video-edit-server.ts` | Broad and permission/cost classified |
| Durable execution | `agent-plan.ts`, `execution-log.ts`, `plan-runner.ts`, `reconciliation.ts` | Shipped after the prior upgrade plan |
| Render engines | Remotion, HTML fallback, HyperFrames | Registry-driven with explicit availability and selection |
| External media | reference, status, relink, consolidation | Good desktop-first base |
| Timeline UI | row virtualization plus DOM clips | Good for ordinary edits, unmeasured for multicamera scale |

### Confirmed strengths

1. `Timeline.frameRate?: {num, den}` and the branded timebase helpers already
   support rational rates.
2. Timeline edits use named operations with inverses and a bounded history.
3. `linkGroupId` supports linked clip movement and edit policy.
4. Beat artifacts stay anchored to an audio clip and derive timeline positions.
5. Agent conversations persist through `/projects/:id/agent-history`.
6. `writeProject()` writes a temporary document and renames it over
   `project.json`, which protects against torn writes.
7. External masters can be checked, relinked by root, and consolidated into a
   managed project.
8. The render stack already includes WebCodecs preview, Remotion render,
   HyperFrames render, FFmpeg processing, output QA, and editor handoff.

### Confirmed gaps

#### Project timebase is implicit

`deriveTimelineFps()` (`src-api/src/shared/video/timeline.ts:663`) scans project
assets, takes the first finite positive `metadata.frameRate`, and returns
`Math.round(frameRate)`. A 23.976 source therefore becomes a project at 24, and
29.97 becomes 30, with no record that rounding happened. There is no project
settings control to choose or lock `24000/1001`, `30000/1001`, or `60000/1001`.

The rational primitives to fix this already exist and are stronger than any
reference implementation: `packages/video-ir/src/timebase.ts` defines branded
`TimelineFrame`, `SourceFrame`, `FrameCount`, and `AudioSample` types, a
`FrameRate {num, den}` record, `normalizeFrameRate()` with reduction, and
explicit `SnapPolicy` handling. `src-api/src/shared/video/editor-handoff/
rational-time.ts` already emits rational time for interchange. The gap is the
product contract, not the math.

#### Output range remains unimplemented

`dev-doc/video-mode/15-08-24-output-range/README.md` is still marked proposed.
A repository-wide grep for `outputRange` across `src/`, `src-api/src/`, and
`packages/` returns nothing. There is no field, ruler control, or render-engine
contract.

#### Row virtualization does not bound clip DOM

`TimelineTrackRows.tsx` virtualizes track rows through `@tanstack/react-virtual`.
`TimelineTrack.tsx:266` still runs `clips.map(...)` over every clip on each
visible row. Cost therefore grows with the number of clips in visible tracks,
even when most clips sit outside the visible time range.

Prior art for the fix already exists on the backend:
`src-api/src/shared/video/timeline-window.ts` computes a time-windowed clip
query for the agent tool surface. Its window semantics should be the shared
definition rather than a second, subtly different frontend one.

#### Project revision actively masks conflicts

This finding is more severe than revision 1 recorded. Three separate problems
stack:

1. **`PATCH /projects/:id/timeline` takes no lock.** Every other timeline
   mutation route — `POST .../timeline/op`, `.../timeline/undo`,
   `.../timeline/redo` — wraps its read-modify-write in `withProjectLock()`.
   The full-timeline PATCH (`src-api/src/app/api/video.ts:2190`) calls
   `getProject()`, builds `next`, and calls `writeProject()` with no lock at all.
2. **Stale writes are silently renumbered, not rejected.**
   `projectDocumentForWrite()` (`src-api/src/shared/video/store.ts:2015`) reads
   the persisted document and, when the incoming `revision` is not greater,
   returns `{ ...normalized, revision: persisted.revision + 1 }`. A stale tab's
   timeline therefore overwrites newer state *and* is stamped with a higher
   revision, so nothing downstream can detect that it happened.
3. **Two independent in-process serialization maps exist and do not see each
   other.** `withProjectLock()` keeps `projectLocks` in
   `src-api/src/shared/video/project-lock.ts`; `updateProjectDocument()` keeps
   `projectDocumentUpdateLocks` inside `store.ts`. A route holding one can
   interleave with a call holding the other.

The frontend retries failed saves and cannot distinguish a transport failure
from a revision conflict or offer recovery.

The contract to copy already exists in this codebase. Durable agent plans pass
`expectedProjectRevision` and reject on mismatch with
`Project revision conflict: plan expects N, current M`, surfaced by
`src/components/video/AgentPlanPanel.tsx:139`. Phase 4 should generalize that
existing token rather than invent a new one.

#### Undo is not project recovery

`VideoTimelineHistory` captures timeline operations only. It does not preserve
changes to assets, storyboard, settings, plans, render choices, or project
metadata. There is no version browser, named checkpoint, preview, or
non-destructive restore.

#### Multicamera has no domain model

There is no multicamera manifest, camera group, sync map, speaker activity map,
shot plan, review model, or agent domain. Existing source analysis and timeline
operations are suitable building blocks but do not form this workflow.

## Unfinished work from prior Video plans

These items remain valid and are folded into the new checkpoints rather than
copied as separate projects.

| Prior item | Current state | New owner |
| --- | --- | --- |
| Remotion golden frames and long-render RSS | Evidence still owed | Phase 0 |
| HyperFrames vs HTML deterministic render comparison | Evidence still owed | Phase 0 |
| Live Studio click to `data-hf-id` acceptance | Evidence still owed | Phase 0 |
| Browser-upload fallback progress | Low-priority gap | Phase 4 |
| Brief duplicate editors and progressive disclosure | Outstanding checkpoint | Phase 4 |
| Integrated editor ownership visual/accessibility gate | Outstanding checkpoint | Phase 4 and Phase 6 |
| In/Out output range | Planned, not implemented | Phase 2 |
| Multi-tab asset-picker live acceptance | Evidence still owed | Phase 0 |
| Native motion-graphics composition model | Still gated on real Studio use | Deferred |

## Package delta since the prior plan

### Remotion 4.0.515 to 4.0.522

`remotion@4.0.522` is the current `latest` on the npm registry, published
2026-09-07. A `4.1.0-alpha12` line exists under the `alpha` tag; stay on 4.0.x.

Where Neumar pins today:

| Location | Packages |
| --- | --- |
| `package.json` | `@remotion/effects`, `@remotion/media`, `@remotion/player`, `@remotion/transitions`, `remotion` — all exact `4.0.515` |
| `src-api/package.json` | `@remotion/bundler`, `@remotion/effects`, `@remotion/media`, `@remotion/renderer`, `@remotion/transitions`, `remotion` — all exact `4.0.515` |
| `src-video/package.json` | nine `@remotion/*` packages plus `remotion` at caret `^4.0.515` |

The caret range in `src-video` is inconsistent with the exact pins elsewhere.
Phase 1 should make all three exact so the render fixtures are reproducible.

The official releases are additive but touch Neumar's active paths:

- 4.0.516 releases broadcast ImageBitmaps after sending in `@remotion/media`.
- 4.0.517 selects Fast Start based on output container, preserves the hardware
  acceleration fallback warning in `@remotion/renderer`, and ships
  `@remotion/gsap`.
- 4.0.518 adds WebMCP Studio tools and launches `@remotion/whisper-webgpu`.
- 4.0.519 fixes 5.1 audio downmixing in `@remotion/media`.
- 4.0.520 adds preview pitch shifting and upgrades Mediabunny to 1.55.5.
- 4.0.521 fixes Windows video rendering stalls in `@remotion/media` and stops
  the Player resume timeout muting user playback.
- 4.0.522 contains mostly Studio interaction fixes.

Revision 1 attributed the 5.1 downmix fix to 4.0.516 and omitted 4.0.519
entirely. Corrected above against the published release notes.

Primary source: <https://github.com/remotion-dev/remotion/releases>

#### Transitive alignment that Phase 1 must handle

Read from the registry metadata on 2026-09-08:

| Package | `@remotion/media@4.0.515` needs | `@remotion/media@4.0.522` needs | Neumar pins |
| --- | --- | --- | --- |
| `mediabunny` | `1.55.1` | `1.55.5` | `1.55.2` in root `package.json` |
| `zod` | `4.4.3` | `4.5.4` | `^4.4.3` in all four manifests |

Move the direct `mediabunny` pin to `1.55.5`, matching what `@remotion/media`
resolves. Do not jump to the registry's `latest` of `1.56.0` — the point is a
single resolved copy, not the newest one. The `zod` caret ranges already admit
`4.5.4`, but the lockfile should be inspected after the bump to confirm one
resolved Zod rather than two, because `packages/video-ir`, `src-api`, and the
frontend all share schema types across the boundary.

The plan recommends an exact-pin upgrade to 4.0.522 after Phase 0 captures the
current golden and performance baseline. `@remotion/gsap`, WebMCP, and
Whisper-WebGPU remain out of scope until a Neumar feature needs them.

### HyperFrames 0.8.7 to 0.8.31

The npm registry reports `0.8.31` as `latest`, published 2026-09-07. Neumar pins
`hyperframes` at exact `0.8.7` in `src-video/package.json` devDependencies.

Verified directly against the published 0.8.31 tarball:

| Claim | Status | Evidence |
| --- | --- | --- |
| CLI bundle still targets Node 22 | Confirmed | `engines.node: ">=22"` |
| Package adds a second binary | Confirmed | `bin` now has `hyperframes` **and** `hyperframes-localize-fonts` → `bin/hyperframes-localize-fonts.mjs`, backed by `dist/fontLocalizeCli.js` |
| Publish is private by default, `--public` explicit | Confirmed | `dist/skills/hyperframes-cli/references/preview-render.md:191`: "A fresh publish is private by default and requires authentication plus access to view." Re-publishing without `--public` never turns a public project private; `--yes` skips only the prompt |
| Signed-out publish returns a claim URL | Confirmed | same reference line |
| `data-volume` allows gain to ~3.98 | Confirmed **in the runtime, not the docs** | `dist/hyperframe-runtime.js` defines `so = 3.981071705534972` (= 10^(12/20), +12 dB) and clamps gain with `Math.max(0, Math.min(so, e))`. A separate `Math.max(0, Math.min(1, ...))` clamp still applies on the `set-media-volume` command path |
| `data-track-index` is a Studio lane, not paint order | **Not verifiable** as stated | The shipped docs only say lint "catches ... overlapping tracks on the same `data-track-index`" (`dist/skills/hyperframes-cli/references/lint-validate-inspect.md:24`). Treat paint-order independence as an assumption to test in Phase 1, not a documented guarantee |

New runtime dependencies worth noting before bumping the packaged sidecar:
`onnxruntime-node`, `sharp`, `puppeteer-core`, `@puppeteer/browsers`, and
`esbuild` — all native or browser-fetching. Confirm none of these change the
packaged-build footprint or the "browser missing" unavailable path.

#### The concrete drift to fix

Neumar's bundled skill at
`plugins/builtin/design-skills/hyperframes/skills/hyperframes/SKILL.md:297`
documents `data-volume` as `0-1 (default 1)`. The shipped 0.8.31 runtime allows
up to ~3.98. That line is wrong today and must change in the same commit as the
pin.

`scripts/check-hyperframes-skill-drift.mjs` enforces the coupling: it reads the
exact `hyperframes` devDependency pin from `src-video/package.json` and the
`upstream-version:` frontmatter field from that `SKILL.md`, and fails when they
differ. Both must move together or `pnpm validate` breaks.

`scripts/check-hyperframes-upgrade.mjs` already shells out to
`pnpm exec hyperframes upgrade --project . --check --json` inside `src-video`
and reads `_meta.version`, `_meta.latestVersion`, and `_meta.updateAvailable`.
It warns and exits 0 when offline or when the CLI is missing, so it is a
notifier, not a gate. Phase 1's command-contract diff should use this same
command against both pins rather than a hand-written probe.

The upgrade is higher risk than Remotion because 24 patch versions shipped in
roughly two weeks and Neumar wraps CLI output. It needs a command-contract diff,
real composition tests, packaged-sidecar probing, and a skill sync in one phase.

## Scope conclusion

The upgrade work should not become a library-led roadmap. Package updates fix
active media behavior and keep the HyperFrames bridge current. The product work
should focus on timebase/output control, recovery, timeline scale, and
multicamera editing.
