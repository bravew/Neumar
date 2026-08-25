# Open issues and fixing plan

Compiled from every "Deferred" / "Not started" / "still required" item recorded
in this folder as of 2026-08-22, after the PR #23 review-comment fixes landed
(`f91a320`). This is the punch list for what remains — it does not repeat
anything already marked `Implemented` in
[`05-implementation-plan.md`](05-implementation-plan.md).

## Status — 2026-08-22 (fixing-plan pass)

Every code item on this list is now implemented: **A-4** and **B-1 … B-7**.
What is still open is only what cannot be closed by writing code —
**A-1 / A-2 / A-3** are evidence runs (real renders, a Docker reproducible-mode
pass, and an interactive Studio click), and **C-1** is deliberately gated on
that evidence.

| ID | Status | Where it landed |
|---|---|---|
| A-4 | Implemented | `engines/selection.ts`, `GET /video/engines`, `EngineSetupPrompt.tsx`, `engineSetupGuidance.ts` |
| B-1 | Implemented | `engines/selection.ts` (typed escalation, logged decision), `video_select_engine`, `EnginePicker.tsx`, materializer pre-flight |
| B-2 | Implemented | `shared/video/tool-refs.ts` + the `withVideoRefResolution` dispatcher wrapper in `video-edit-server.ts` |
| B-3 | Implemented | `core/agent/turn-budget.ts`, AG-UI `neuma.turn_budget` event, `AgentDockTurnBudget.tsx` |
| B-4 | Implemented | symbolic `key` / `$key:` in `video_apply_timeline_ops`, key→id map in the result |
| B-5 | Implemented | `video_compare_variants` (image-bearing result via `inline-image.ts`) |
| B-6 | Implemented | `video_compare_grades` (grades written to a file — the CLI takes a path, not inline JSON) |
| B-7 | Implemented | `video_check_html_composition`, `POST /video/projects/:id/html-check`, `QaHtmlCheckSection.tsx` |

Verification: `pnpm validate` passes; `pnpm test:fast` passes (frontend 1,240
tests / 293 files; API 3,108 passed + 7 skipped / 497 files) plus the new
suites below. The three HyperFrames wrappers were additionally run **live**
against the pinned 0.8.7 CLI on a real composition — `check --json` parsed its
report off a non-zero exit (3 lint errors, 1 warning, contrast pass clean),
`compare` produced a real 2-variant sheet, and `grade-compare` produced a
3-cell sheet.

New tests: `src-api/test/unit/video/engine-selection.test.ts`,
`.../hyperframes-inspect.test.ts`, `.../tool-refs.test.ts`,
`.../video-tool-refs-dispatcher.test.ts`,
`src-api/test/unit/agent/turn-budget.test.ts`,
`src-api/test/integration/video-engine-routes.test.ts`,
`src/__tests__/video/{EnginePicker,QaHtmlCheckSection,AgentDockTurnBudget}.test.tsx`,
plus two cases added to `src-api/test/integration/ag-ui.test.ts`.

## Issue log

### A — Acceptance evidence gaps (code exists, proof does not)

These phases are implemented and unit-tested, but the plan's own acceptance
criteria for "done" are still open. Nothing here is a known bug; it's
unverified determinism/perf claims.

| ID | Gap | What's missing | Where |
|---|---|---|---|
| A-1 | A1 `@remotion/media` migration | Golden-frame / Player-screenshot matrix, before/after wall-clock and peak-RSS on a long timeline | `05-implementation-plan.md` Phase A1 |
| A-2 | B HyperFrames render engine | Three real-render sampled-frame/ffprobe comparisons against `html`; Docker `--docker` reproducible-mode output-hash run | `05-implementation-plan.md` Phase B |
| A-3 | C1 Studio bridge | Interactive click-to-agent `data-hf-id` acceptance flow (live probe so far only covered start / `server,selection` context / stop) | `05-implementation-plan.md` Phase C1 |
| ~~A-4~~ | ~~B packaged-runtime policy~~ | **Done.** `GET /video/engines` returns each engine's typed unavailable reason; `EngineSetupPrompt.tsx` turns it into one copyable install command plus a re-check, and the picker surfaces it before a render can fail on it | `05-implementation-plan.md` Phase B |

Verified in this session (not previously proven live): the HyperFrames Studio
bridge's acquire → reference-count → release lifecycle, the loopback-URL
schema, and the typed `invalid-project` 422 boundary all work end-to-end
against the real pinned 0.8.7 CLI (`~/.neumar/hyperframes/index.html`, real
background `preview` process, real port). That narrows A-3 to just the
interactive click-to-agent step.

### B — Deferred Phase E items (agent ergonomics / verification surfaces)

All seven are now implemented. Kept here with what actually shipped, since the
delivered shape differs from the sketch in a few places.

| ID | Item | Status | What shipped |
|---|---|---|---|
| B-1 | Runtime-selection contract (P2-6) | Implemented | `selectVideoEngine()` returns a logged decision listing **every** option with its honest tradeoffs, and throws `EngineSelectionError` (`unknown-engine` / `engine-unavailable` / `no-engine-available`) rather than substituting. Exposed as `video_select_engine` and folded into `video_list_engines`; `EnginePicker.tsx` is now a real picker; `materializeHtmlStoryboard` pre-flights the adapter once per run so escalation is real, not advisory. |
| B-2 | Ref resolution in the MCP dispatcher (P2-2) | Implemented | `shared/video/tool-refs.ts` owns the vocabulary — `$selection`, `$transcript_selection`, `clipIndex:<n>`, `trackIndex:<n>:clipIndex:<m>`, `atSec:<s>`, `trackIndex:<n>` — and `withVideoRefResolution` applies it to every tool's `clipId` / `clipIds` / `trackId` fields, including nested ones like `moves[]`. The project is loaded **only** when a ref is present, so literal-id calls cost nothing. `video_apply_timeline_ops` opts out; its batch pass runs op-by-op so `$key:` can see keys minted earlier. |
| B-3 | Typed turn budget (P2-5) | Implemented | `core/agent/turn-budget.ts` normalizes any provider's stop into `end_turn`/`max_steps`/`max_tool_calls`/`max_tokens`/`budget`/`cancelled`/`refusal`/`error`/`unknown` plus an `exhausted` flag. Normalization runs in `AGUIEmitter` — the boundary every mode's messages cross — and emits `neuma.turn_budget`; the Claude adapter also reports the run's actual ceiling. `AgentDockTurnBudget.tsx` renders it and offers Continue only when a ceiling (not a failure) stopped the run. |
| B-4 | Symbolic-key batch ops (P2-4) | Implemented | A clip-creating batch op may carry `key`; Neuma mints the clip id, later ops address it as `$key:<name>`, and the result appends the key→id map. Duplicate keys, keys on non-creating ops, and unminted `$key:` refs all fail at the boundary. |
| B-5 | `video_compare_variants` (P2-1) | Implemented | Wraps `hyperframes compare`; returns `[{type:'text'},{type:'image'}]` via `inline-image.ts`, which downscales once and falls back to path-only rather than blowing up the turn. |
| B-6 | `video_compare_grades` (P2-1) | Implemented | Wraps `grade-compare` with `.cube` LUT candidates. Note for future work: `--grades` takes a **file path**, not inline JSON, despite the CLI's own help text — the module writes and cleans up a temp file. |
| B-7 | `check --json` in QA (P2-1) | Implemented | `video_check_html_composition` + `POST /video/projects/:id/html-check` + `QaHtmlCheckSection.tsx`. `check` exits non-zero when it finds issues; that is a *result*, so the runner reads the report off the failed run's stdout. The QA panel now also mounts when a render produced no findings, since this gate is pre-render. |

### C — Deferred, large, deliberately gated

| ID | Item | Status | Gate |
|---|---|---|---|
| C-1 | Phase F — motion-graphics composition model (P3-1) | Not started | Explicitly gated on Phases B/C1 shipping *and* the Studio bridge seeing real usage. Do not start on a schedule; start when there's evidence. Recommendation already recorded: (b) HyperFrames compositions as the runtime, not a native layer engine. |

### D — Not proposed (informational only, no action)

`@remotion/lambda`/`@remotion/cloudrun`, `.fxpkg`-style signed effect packages,
`<HtmlInCanvas>` nesting, browser-side Whisper, and full linked-caption
support are each recorded with an explicit reason not to build them now (see
`05-implementation-plan.md` → "Not proposed, and why"). Carried here only so
this list is exhaustive — none of these are fixing-plan candidates.

## Fixing plan

Sequenced so each step is independently shippable, matching this repo's
"every phase verifies before the next starts" convention.

### Step 1 — Close the acceptance-evidence gap (A-1, A-2, A-3) — **still open**

This is proof-of-work, not new code, and it's the only thing standing between
"implemented" and "verified" for three already-shipped phases.

1. **A-3 first** (cheapest, unblocks confidence in the others): run the
   interactive Studio session — open a real composition, click an element in
   HyperFrames Studio, confirm `video_get_html_selection` returns the
   `data-hf-id` target through to the agent. This session confirmed every
   other part of the bridge already works against the real CLI.
2. **A-2**: render the same short timeline through `html` and `hyperframes`,
   diff sampled frames + `ffprobe` metadata, then run one `--docker`
   reproducible-mode render twice and diff output hashes.
3. **A-1**: capture the golden-frame/Player-screenshot matrix and the
   before/after wall-clock + peak-RSS numbers on a long (>2 min) timeline.

Each of these produces a table row to flip from "still required" to a
commit+verification entry in `05-implementation-plan.md`, same format as the
existing rows.

### Step 2 — A-4: first-run doctor prompt for HyperFrames — **done**

Now that `probeHyperframes` returns a typed reason
(`not-found`/`version-too-old`/`browser-missing`) with CLI/browser version
detail (fixed in `f91a320`), the missing piece was purely UI: surface that
reason as an actionable prompt instead of a raw render error. Small, scoped,
and it's the one loose end from the packaged-runtime policy decided this
session. Landed ahead of the two remaining Step 1 evidence activities — A-2's
Docker output-hash reproducibility run and A-1's golden-frame/screenshot and
wall-clock/peak-RSS measurements — since testing on a clean machine benefits
from the same install-guidance path.

### Step 3 — B-1 (runtime-selection contract) — **done**

Do this before B-5/B-6 add more engine-shaped tool surface. It's small (S)
and it's explicitly the item this doc flags as "matters more once
`hyperframes` joins `remotion` and `html` as a third engine" — that's already
true today.

### Step 4 — B-2, B-3, B-4 (agent-runtime ergonomics, any order) — **done**

All three are S-effort and independent of each other. B-3 (typed turn budget)
is scoped at the shared agent-runtime boundary, not Video Mode alone — if
another mode is already mid-flight on a similar normalization, coordinate
rather than duplicate.

### Step 5 — B-5, B-6, B-7 (comparison/diagnostic surfaces) — **done**

M-effort, no remaining blockers (P0-1/P0-2 are both shipped). Natural next
increment once Step 1–4 land, since B-5/B-6 build directly on the render
engines and effect stack this PR added.

### Step 6 — C-1 (motion graphics) — **still gated**

Do not schedule this. Re-read this document after the Studio bridge (C1) has
real usage from Step 1's interactive acceptance run — the gate condition is
evidence, not a date. When ready, decide (a) vs (b) explicitly before writing
code; the existing recommendation is (b).

## What this plan does not cover

Bug-shaped findings from the PR #23 CodeRabbit review (keyframe validation
bypass, conflicting `clip.trim` ops on double-snapped boundaries, the
Studio-bridge process leak/race, `process.cwd()` in the Tauri sidecar, the
typed HTTP error boundary, etc.) were fixed and merged separately in
`f91a320` — see that commit message for the itemized list. This document is
about the *unimplemented and deferred* items recorded in this folder, not a
second pass over already-fixed defects.
