# Timeline In/Out output range — implementation plan

Date: 2026-08-24
Status: proposed
Source: editor UX feedback item 4 (`dev-doc/video-mode/14-08-24-editor-ux-feedback/README.md`)
Prerequisite reading: `dev-doc/runbooks/video-mode.md` — Timeline Editing, Render Engines, Output Quality

## Problem

There is no way to render/export a sub-range of a timeline. Every render
(preview or final) covers the full extent of every track's clips
(`getTimelineDurationMs(tracks)`). A user who wants to ship just the middle
30 seconds of a longer edit has to physically delete or ripple-trim the
surrounding clips — destructive, and it throws away the trimmed footage
instead of just hiding it from output.

Goal: standard NLE in/out-point behavior — mark a range on the timeline, and
every render (preview scrub bounds excluded — see Non-goals) uses that range
as the output window, non-destructively.

## Current state (confirmed in code)

- `VideoTimeline` has no range field. `durationMs` is derived, not stored:
  `getTimelineDurationMs(tracks)` in `useTimelineEditorStore.ts`.
- The toolbar flag icon (`TimelineToolbar.tsx` → `handleAddMarker` →
  `editor.addMarker`) adds a chapter/comment **marker** (annotation), not a
  range boundary. Markers and an output range are different concepts and
  should stay different — do not overload markers to also mean "in/out".
- `pipeline.ts` (`src-api/src/shared/video/pipeline.ts`) has no range input.
  It renders whatever the resolved timeline contains, full stop.
- The one existing `rangeMs` in the codebase
  (`provenance.generatedFor.rangeMs`) records what source range a *generated
  asset* was produced for — unrelated, do not confuse the two or reuse the
  field.
- Render engine selection (`selectFinalRenderer()`), the runtime-selection
  contract (`video_list_engines`/`video_select_engine`), and per-engine
  tradeoffs are all engine-level concerns that sit **above** this feature —
  a range trim has to be honored by whichever engine gets selected, not
  become a fourth thing engines are selected on.

## Non-goals (v1)

- **Live preview does not loop/bound playback to the range.** Scope creep
  risk: `WebCodecsPreview` and the Remotion Player fallback both have their
  own playhead/seek machinery (`dev-doc` Live Preview section). Bounding
  live playback to the range is a natural v2, but v1 only needs the range to
  affect what gets **rendered on export** and to show as a visual marker on
  the ruler. Conflating the two roughly doubles the surface area for v1.
- **No retroactive retiming.** Setting an output range crops what renders;
  it must not shift, re-time, or renumber anything inside the range —
  captions, markers, keyframes, and transition seams keep their existing
  absolute timeline-ms offsets. This matters because caption sync and
  source-cut compilation both depend on stable absolute offsets (Timeline
  Editing / Source Auto-Cut Workflow in the runbook).
- **No per-scene range.** This is a single project-wide output window, not a
  per-storyboard-scene concept.

## Open design decisions (resolve before Checkpoint 1)

1. **Where does the range live — `VideoTimeline.outputRangeMs` or
   project-level?** Recommendation: on `VideoTimeline`, since duration and
   tracks already live there and the field should travel with
   undo/redo (`withUserHistory`) the same way clip edits do. A project-level
   field would need its own separate undo/persistence story for no clear
   benefit.
2. **Persistence compatibility.** The runbook's hard rule: no
   `timeline.v2` write path without a proven load path for existing
   projects. `outputRangeMs` must be an **optional** field, absent by
   default, read as "full duration" by every existing consumer
   (`getTimelineDurationMs`-based code, render/export, budget estimation)
   with zero behavior change until a user explicitly sets it.
3. **UI affordance shape.** Recommend the standard NLE pattern: `I` / `O`
   keyboard shortcuts stamp the playhead into in/out, plus draggable handles
   on the ruler (same interaction family as clip trim handles). A
   simpler v0 (two numeric time fields in a panel, no ruler drag) is a
   fallback if ruler-handle hit-testing proves fiddly to land safely inside
   the existing drag/lasso/seam-drag gesture set on `TimelineCanvas`.
4. **Budget/duration estimation.** Approval (phase 3 in the runbook)
   estimates cost/duration before queueing spend-capable jobs. Once a range
   exists, that estimate must use the **trimmed** duration, not
   `timeline.durationMs` — otherwise budget approval overestimates or
   (worse) underestimates cost for a trimmed export.

## Data model

```ts
// src-api/src/shared/video/types.ts and src/shared/types/video.ts (both sides, mirrored)
export interface VideoTimeline {
  // ...existing fields
  /** Optional output trim, in project ms. Absent = full timeline duration.
   *  Render/export clip to this window; does not affect clip timing. */
  outputRangeMs?: [number, number];
}
```

Both the frontend (`src/shared/types/video.ts`) and backend
(`src-api/src/shared/video/types.ts`) type mirrors need the field, matching
existing `MediaItem`/`Scene`/`Clip` dual-definition convention.

## Checkpoints

### Checkpoint 1 — Data model + store plumbing

**Touches**: `src/shared/types/video.ts`, `src-api/src/shared/video/types.ts`,
`useTimelineEditorStore.ts` (`setOutputRange` / `clearOutputRange` actions,
routed through `withUserHistory` like `updateTrack`/`removeTrack`).

**Observable result**: `outputRangeMs` round-trips through project
save/load with no effect on any existing project (field absent → unchanged
behavior). Setting/clearing the range is undoable/redoable via the timeline's
existing history stack.

**Verification**: unit test on `useTimelineEditorStore` covering
set/clear/undo/redo of `outputRangeMs`; existing timeline persistence tests
still pass unmodified (proves old projects load unaffected).

### Checkpoint 2 — Timeline UI

**Touches**: `TimelineToolbar.tsx` (I/O buttons + keyboard shortcuts, next to
existing `toggleSnapping`/`addMarker`), a new ruler overlay component for the
in/out handles (sibling to however seam badges/markers already render on the
ruler), `useTimelineKeyboardShortcuts.ts` (`I`/`O` bindings — check for
collisions with existing shortcuts first), `TimelineLabels.ts` +
`useTimelineLabels.ts` (new label group), all 6 locales.

**Observable result**: pressing `I`/`O` at the playhead sets in/out; the
ruler shows the trimmed-out regions dimmed (matching how out-of-range
regions read in most NLEs) with draggable handles; a range can be cleared
back to full duration from the toolbar.

**Verification**: component test on the new ruler control (set via keyboard,
verify store state; drag handle, verify clamped bounds — out point can't
precede in point, both stay within `[0, durationMs]`).

### Checkpoint 3 — Render/export pipeline

**Touches**: `src-api/src/shared/video/pipeline.ts` (FFmpeg path — trim
final concat/mux to the range), the Remotion composition entry (bound the
sequence to the range), the HTML/Playwright engine, and HyperFrames — per
the runbook's enforced runtime-selection contract, **every** engine has to
honor the range or `selectFinalRenderer()`/`video_list_engines` needs to
report it as an unsupported-tradeoff dimension for that engine rather than
silently ignoring it.

**Observable result**: exporting a timeline with a set range produces output
covering only that window, correct across all three engines. Exporting with
no range set is byte-identical to today's output (regression guard).

**Verification**: fixture project with `outputRangeMs` set, rendered through
each engine in `video_list_engines`; assert output duration matches the
range within one frame. A second fixture with no range set diffed against
pre-change output.

### Checkpoint 4 — Budget/duration estimation

**Touches**: wherever phase-3 approval estimates render cost/duration today
(uses `timeline.durationMs`) — switch to the trimmed duration when
`outputRangeMs` is set.

**Observable result**: setting a budget below the high estimate for a
*trimmed* range still correctly fails/passes based on the trimmed length,
not the full-timeline length (mirrors the existing smoke check "Set the
budget below the high estimate and confirm approval fails").

**Verification**: extend that existing smoke-check scenario with a
range-trimmed variant.

### Checkpoint 5 — MCP/agent tool surface

**Touches**: a new named tool, e.g. `video_set_output_range` /
`video_clear_output_range`, following the runbook's rule that timeline edits
go through named builders/tools, not ad hoc ops. Should resolve `$selection`
etc. the same way other clip-taking tools do where relevant (likely N/A here
since the range isn't clip-scoped, but keep tool registration consistent
with the existing MCP dispatcher conventions).

**Observable result**: an agent can set/clear the output range and it
appears in `plan_storyboard`/`approve_storyboard`/`compose` flows exactly
like any other timeline edit — same undo/redo, same persistence.

**Verification**: MCP integration test calling the new tool end-to-end
against a fixture project.

### Checkpoint 6 — Docs

**Touches**: `dev-doc/runbooks/video-mode.md` — add an "Output Range"
section (parallel to existing "Timeline Editing" / "Transitions" sections)
documenting the field, the non-destructive-crop guarantee, and the
per-engine support contract established in Checkpoint 3.

## Sequencing

Checkpoint 1 blocks everything else (shared schema). Checkpoints 2 and 5 can
proceed in parallel once 1 lands (UI and MCP tool both just call the same
store actions). Checkpoint 3 is the highest-risk, highest-effort item — it
touches three independent render engines — and should not start until 1 is
stable, since a mid-flight schema change there would mean redoing render-side
work three times. Checkpoint 4 depends on 3 existing (needs the trimmed
duration concept proven end-to-end first). Checkpoint 6 last, once behavior
is final.

## Release gates

Same as the standing video-mode gates
(`dev-doc/runbooks/video-mode.md` → Release Gates), plus the Checkpoint 3
per-engine fixture renders as a new smoke-check line item once this ships.
