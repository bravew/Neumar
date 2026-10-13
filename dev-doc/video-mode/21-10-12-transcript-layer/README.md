# Interactive Transcript Layer (transcript-driven editing)

Rev 1 — 2026-10-12. Status: **proposed — phases T1–T7 filed as an epic.**
Baseline: Neumar `895b5729`. Reference: `_sample/baocut` — see
[01-baocut-findings.md](01-baocut-findings.md).

## Goal

After a source is analyzed and transcribed, the transcript becomes a working
surface in the editor, not a read-only caption list:

1. click a word → seek; playback highlights and follows the active word;
2. select words → delete them from the **media** (video, audio, linked
   captions, ripple) or, in a different mode, edit **text only**;
3. cut words stay visible, struck through, and can be restored;
4. a **transcript layer** row on the timeline mirrors the same words and cuts;
5. filler/silence suggestions can be previewed and accepted from the transcript;
6. the agent can perform the same operations.

## Current state (verified against the code)

| Piece | Where | Gap for this goal |
| --- | --- | --- |
| Word-timed ASR transcript (`VideoSourceTranscript.words: VideoSubtitleWord[]`, source-time ms) | `src/shared/types/video.ts`, `src-api/src/shared/video/analysis/transcript.ts`, `project.sourceAnalyses[]` | Words have no ids; nothing renders them as a word list. |
| `TranscriptView` | `src/components/video/TranscriptView.tsx` (mounted in `SideRail.tsx`, tab `transcript`) | Storyboard-scene text; word timing used only to resolve a text selection into a time range. Not a source transcript. |
| `CaptionTranscriptView` | `src/components/video/CaptionTranscriptView.tsx` | Reads caption-track cues; click-to-seek and active-word highlight already work. No cut/restore; shows captions not source speech. |
| Selection → time | `transcriptSelection.ts` (`resolveWordSelection`) | Maps text to words by token-sequence search (first match), not by word index. Falls back to proportional timing (`degraded`). |
| Word-range → timeline ops | `src-api/.../analysis/auto-cut.ts` `compileSourceCutPlanTimelineOps` | Server-side; emits `clip.removeTimeRange` with explicit `before/after`, link groups handled, refuses mid-word cuts. **Ignores `playback.speed`** (uses `startMs + (src - trimStartMs)`). Only handles the `asset` source ref. |
| Delete on timeline | `useTimelineDeleteSelection.ts` → `applyTimelineOps` agent tool | Clip-level only. |
| History / undo | `clip.removeTimeRange` returns an inverse op | Works for a single op; a multi-track cut must be one history step. |
| Auto-cut suggestions | `buildAutoCutCandidates` (silence ≥ 900 ms, filler words) | Not surfaced in any transcript UI. |
| Timeline UI | `src/components/video/timeline/*` | Track kinds are `video`, `broll`, audio kinds, `caption`, `overlay`. No transcript row. |

## Design

### D1. A cut is derived from the timeline, not stored

BaoCut stores `hidden` marks on words. Neumar already has a timeline that is the
authority for what plays, with undo history and agent edits. A second store of
"cut marks" would drift from it (the user trims a clip, the agent removes a
clip, the mark is now wrong).

So a word's state is **computed**: for a source, collect every timeline clip
whose `sourceRef` resolves to it (including `linked` refs and link-group
siblings), convert each to the source span it plays
`[trimStartMs, trimEndMs)`, and take the union. A word is:

- `kept` — fully inside the union,
- `cut` — fully outside,
- `partial` — straddles an edge (rendered dimmed; can only be cut/restored whole),
- `unused` when the source has no clip on the timeline at all (panel shows an
  empty state instead of striking every word).

It also yields each kept word's **timeline position**, which is what click-to-seek,
playback follow, and the transcript layer need. If the same source span appears
in several clips, a word has several timeline positions; seek uses the first at
or after the playhead.

Rejected alternative: persisting `cutWordIds` on the project (BaoCut's model).
It would add a project-schema field plus reconciliation code for every other
way the timeline can change.

### D2. Cut and restore are pure compilers in `packages/video-ir`

New module `transcript-edit.ts` (pure, no I/O, exported from the package):

- `deriveTranscriptView(timeline, source, words) → TranscriptWordState[]` (D1).
- `compileTranscriptCut(timeline, source, wordRange, opts) → TimelineOp[]` —
  converts the word range to a source span `[words[a].startMs, words[b].endMs]`,
  maps it through each matching clip (honoring `playback.speed`, `reverse`,
  `trimStartMs`), applies to the primary track *and* every linked track, and
  returns `clip.removeTimeRange` ops with explicit `before/after` so replay is
  deterministic. Ripple is an option; default follows the editor's ripple setting.
- `compileTranscriptRestore(timeline, source, wordRange) → TimelineOp[]` — finds
  the seam where the span was removed (adjacent clips A, B of the same source
  with `A.trimEnd ≤ span.start` and `B.trimStart ≥ span.end` and no source
  content between them on the timeline) and extends A's trim to cover the span,
  rippling following clips. If the seam no longer exists (A/B moved apart or
  were removed), it returns `{ ok: false, reason }` and the UI says "this cut can
  no longer be restored automatically" rather than guessing.

`compileSourceCutPlanTimelineOps` in `auto-cut.ts` shares the same clip-splitting
helper after this move, so there is one implementation of "remove a source span
from a timeline" (and it gains speed support). Existing `auto-cut` tests must
pass unchanged for speed 1.

Mid-word guard: ranges are always word-aligned because the UI selects words.
The compiler keeps the existing refusal for non-aligned input.

### D3. Two explicit modes; the safe one is the default

| Mode | Delete / Backspace | Words struck through |
| --- | --- | --- |
| **Text** (default) | Edits the word's text (or removes a mistranscribed token) — media untouched | no |
| **Cut media** | Compiles `compileTranscriptCut` → one `applyTimelineOps` call | yes |

The mode toggle is always visible in the panel header and mirrored in the
timeline-row header. A selection can also be cut explicitly from a floating
"Cut" action in either mode. This is AT-09: Delete in Text mode never reaches
the timeline.

### D4. Word identity

`VideoSubtitleWord` has no id. Identity = `(sourceId, wordIndex)` within the
cached transcript's `words` array, plus the `startMs` as a consistency check.
Re-transcription replaces the array and invalidates selections (the panel
clears its selection when the analysis `generatedAt`/hash changes). This avoids
a schema migration; stable ids are deferred (see Open questions).

### D5. Transcript text corrections

Fixing a misheard word is a write to the cached analysis transcript
(`PATCH /projects/:id/sources/:sourceId/transcript`, sparse `{ index, text }`
updates, optimistic revision check like BaoCut's CAS) and, if captions were
generated from it, a re-derivation of the caption tokens through the existing
`redistributeCaptionWords`. Timings never change in Text mode.

### D6. Transcript layer is a derived timeline row

Not a persisted track kind (that would be a `timeline.v1` schema change touching
renderers). It is a UI row computed from D1 and drawn by `TimelineTrackRows`
above the video tracks: sentence blocks from transcript `segments` (falling back
to punctuation/gap grouping), cut gaps shown as bands. Clicking a block seeks and
selects its words; selection is shared with the panel through a small Zustand
store. The row hides itself when there is no analyzed source on the timeline.

### D7. Agent parity

Two agent tools mapped through `agentToolMapping.ts`:
`transcript.cutWords { sourceId, startIndex, endIndex }` and
`transcript.restoreWords { … }`, both thin wrappers over D2 that produce a normal
`applyTimelineOps` proposal (so approvals, diff panels, and history work as they
do for every other timeline edit).

## Phases

Each phase is one GitHub sub-issue, one worktree, one PR into the epic branch.
All user-facing text lands in all six locales (`en zh es fr hi pt`).
Everything is behind the kill-switch flag `video.transcriptLayer` (default on;
off removes the panel mode, the row, and the agent tools).

| # | Phase | Deliverable | Depends on |
| --- | --- | --- | --- |
| T0 | Plan + flag | This directory; `video.transcriptLayer` in `flags.ts` and the frontend flag list | — |
| T1 | Core: derive + compile | `packages/video-ir/src/transcript-edit.ts` (D1, D2), speed/reverse/linked-ref aware; `auto-cut.ts` reuses it; unit tests incl. repeated spans, speed 2×, link groups, restore-after-seam-lost | T0 |
| T2 | Transcript store + panel data | `useSourceTranscript(project)` hook: states, timeline positions, active word from `playheadMs`; selection store; pure unit tests | T1 |
| T3 | Word panel UI | New `SourceTranscriptPanel` in the transcript tab: word-level rendering, click-to-seek, follow-playback toggle, range selection (shift/drag), struck/partial styling, timestamps, empty/unanalyzed states | T2 |
| T4 | Modes + cut/restore actions | Mode toggle, Delete semantics (D3), floating Cut/Restore, one-undo-step through `applyTimelineOps`, keyboard, AT-08/AT-09 component tests | T3 |
| T5 | Timeline transcript layer | Derived row (D6), cut bands, shared selection, click-to-seek, height/visibility controls | T2 (parallel with T3/T4) |
| T6 | Text corrections | D5: sparse transcript PATCH route + client edit-in-place in Text mode + caption re-derivation | T3 |
| T7 | Suggestions + agent | Filler/silence suggestions in the panel (preview = seek and loop the span, accept = D2, dismiss), agent tools (D7) | T4 |
| T8 | QA + docs + rollout | Playwright flow on a fixture project (analyze → select → cut → undo → restore), runbook section in `dev-doc/runbooks/video-mode.md`, success measures below, flag review | all |

## Success measures

- Cut 10 words from a 2-minute talking-head source in ≤ 3 interactions;
  video, audio and caption clips stay in sync (link groups preserved).
- Cut → undo → restore returns a timeline deep-equal to the original
  (excluding generated ids) for speed 1 and non-1 clips.
- Delete in Text mode never changes `timeline.tracks` (asserted in a test).
- Seek from a 10 000-word transcript renders without virtualization jank
  (panel virtualizes beyond ~2 000 words).

## Open questions (defaults chosen; reversible)

1. **Stable word ids.** Default: index-based (D4). If re-transcription needs to
   preserve user edits, add ids to the analysis cache in a follow-up.
2. **Ripple default.** Default: follow the editor's existing ripple toggle; the
   Cut action shows which is active.
3. **Same span used twice.** Default: cut applies to every clip using the span in
   the selected time window only if the user selected it from the panel; layer
   selections cut only the clicked occurrence. Revisit after T4 feedback.
4. **Translation / voice-over modes** from BaoCut are out of scope.

## Decision gate

- A. Execute T1 (and T0 flag).
- B. Revise the design decisions D1–D7.
- C. Stop for missing information.

Default: A. The branch/PR flow follows epic #130: integration branch
`epic/<N>-transcript-layer`, sub-issue PRs target it, final PR to `main`.
