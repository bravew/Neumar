# Grounded decisions and analysis results UI

Reviewed 2026-09-15 against this working tree, including the now-present
`_sample/hypit` checkout. This review supersedes conflicting recommendations
in revisions 1–3. Product decisions below are recommendations, except the
user's explicit decision that both reference flags default on. This document
specifies the UI; it does not claim that the reference pipeline or UI is shipped.
Only the flag registration/defaults and their regression tests land with this review.

## What the code actually supports

| Evidence | Verified behavior and consequence |
| --- | --- |
| [flags.ts](../../../src-api/src/shared/video/flags.ts), [useVideoFlags.ts](../../../src/shared/video/useVideoFlags.ts) | A default-on API flag is disabled only by the stored string `false`. The frontend hook starts with an empty snapshot and exposes `loading`; it does not expose fetch errors. Availability must not be confused with permission to spend or a working backend. |
| [SideRail.tsx](../../../src/components/video/SideRail.tsx), [editorLocation.ts](../../../src/components/video/editorLocation.ts) | Rail tab type, icon map, visible tabs, content rendering and URL parsing all participate. Add a small Reference entry and mount the larger review surface outside the narrow rail. |
| [SourcesPanel.tsx](../../../src/components/video/SourcesPanel.tsx) | Existing imports are footage for editing, with publish/reuse acknowledgement and cut candidates. Reference intake needs separate study wording and storage. |
| [store.ts](../../../src-api/src/shared/video/store.ts), `buildDeterministicAnalysis` | Current scenes are a midpoint split labeled `ffmpeg-scdet`; no scene detector runs there. Whole-duration `vad` speech ranges and generic `scene-detector` visual beats are also synthetic. Do not display these as measured reference analytics. Fixing this existing path remains a separate change. |
| [ytdlp.ts](../../../src-api/src/shared/video/source/ytdlp.ts), `buildYtDlpArgs` | Destination is hardcoded to `sources/<sourceId>`. `maxDurationSec` is accepted but intentionally ignored. The proposed ten-minute reference ceiling needs its own enforced preflight/post-probe limits. |
| [Hypit reference method](../../../_sample/hypit/skills/hypit/references/creation/reference-video.md) | Whole-piece interpretation and detailed timed observation revise each other. Systems can span cuts. Sparse stills do not prove behavior between samples. Source timestamps, transcript and evidence use the same clock. This is a method reference, not a ready-made Neumar UI. |
| [Hypit media implementation](../../../_sample/hypit/packages/video-cli/src/media.ts), `visualBoundaries` | Defaults are 12 samples/s, 32×32 RGB frames and mean absolute adjacent-pixel difference threshold 0.1. It buffers raw output and returns change candidates, not semantic shots. Stream/bound memory for long files; do not port buffering blindly. |
| [cost-approval.ts](../../../src-api/src/shared/video/cost-approval.ts) | Default auto-approval threshold is 25 cents; positive estimates at or above it require approval. An enabled semantic flag does not waive this gate. Unknown price must not be represented as zero. |
| [permissions.ts](../../../src-api/src/extensions/agent/video/permissions.ts), `METERED_TOOLS` | The metered set is an agent tool classification, not the ASR cost gate. Add semantic model accounting deliberately; storing already-authored reading JSON must not double-charge a model call. |
| [video-edit-server.ts](../../../src-api/src/shared/mcp/video-edit-server.ts), `video_record_research_brief` | Requires topic and at least one finding; stores research for storyboard drafting. It is not an existing arbitrary reference focus/sampling brief. |
| [plugin types](../../../src-api/src/shared/video/plugins/types.ts) | `reference-analyze` and `reference-vision` are reserved atoms. Existing source atoms and packed-transcript capability metadata do not implement reference processing. |
| [custom-loader.ts](../../../src-api/src/shared/video/templates/custom-loader.ts) | Custom templates are validated and stored under `getVideoRoot()/templates`, shared within that video root. They are not automatically a cloud/community gallery. Save currently uses `writeFile`; it is not evidence of atomic reference-envelope writes. |
| [store.ts](../../../src-api/src/shared/video/store.ts), `deleteProject`; [handoff package](../../../src-api/src/shared/video/editor-handoff/package.ts) | Delete attempts to remove project and cache directories but catches filesystem errors before deleting the DB row. Handoff packaging is a concrete export path to audit; exclusion from every possible future project export is not implemented proof. |

The codegraph tool reported no loaded project index. Source reads and targeted
searches were used; no index was installed or regenerated. Hypit files are local,
gitignored reference material; links to them will not resolve in a clean checkout.

## Answers to every open question

### Rights and cost

**R1 — Per-reference acknowledgement, recorded with provenance.** Keep the
boolean compatibility field, but add acknowledgement time and policy version.
A project preference can prefill the choice after an explicit user action;
persist its origin on each reference. Do not interpret a global preference as
proof of rights for every link. Promotion into assets remains a separate action.
This fits the existing SourcesPanel acknowledgement boundary while keeping
reference archives out of `project.assets`.

**R2 — Retain provenance privately; make sharing an explicit choice.** Keep the
original source URL on the private reference. At materialization show the exact
attribution that will travel and default to a sanitized public URL only when
the user elects to include it. Strip credentials, signed parameters and local
paths. A copied template must work if the project/reference is deleted; IDs are
optional provenance, not required runtime dependencies. This revises the older
default of copying every URL. Attribution is useful but does not grant reuse rights.

**R3 — Enforce acquisition policy before extractor invocation.** Recommend no
DRM circumvention, paywall/login bypass or automatic browser-cookie extraction.
Start with user-supplied local files and specifically reviewed authorized link
paths; unsupported origins get a local-file alternative. Extractor support is
technical capability, not permission. YouTube's [terms](https://uk.youtube.com/t/terms)
restrict downloading except under their stated permissions or applicable law;
its [help page](https://support.google.com/youtube/answer/56100?hl=en) describes
downloading one's own uploads. A study checkbox cannot establish compliance.
“Private study” and a structure-only output are product boundaries, not a legal
safe-harbor determination. Product/legal acceptance of link policy remains a
release decision; no live platform-download tests were run in this review.

Security consequence: `validateYtDlpUrl` prechecks the submitted URL; yt-dlp
then makes its own extractor/CDN requests. This is not proof of DNS-bound
redirect protection for the subprocess. Phase 0 must verify its network boundary
or restrict acquisition to paths that can enforce it. Use time/byte/process
limits as well as duration, reject playlists/live streams for this increment,
and never surface raw downloader stderr or signed URLs.

**C1 — Coarse then refine, under a cumulative budget.** Hypit's method explicitly
changes interval, range and cell size with the question. Reserve uniform temporal
coverage and opening/closing samples before adding high-change candidates; never
use only the largest scores. Refinements need dense interval samples or short
clips for motion, not just more cut points. Persist every evidence attempt and
charge/cache it by actual inputs. A per-request cap alone permits unbounded
repeated requests: also cap cells, image bytes/tokens and spend per run. Compare
transcript-only, coarse-plus-refinement and dense baselines on the same fixtures.
No measured quality/cost result exists from this review.

### Q1–Q19

| Question | Decision and grounding |
| --- | --- |
| Q1: cross-project references | Keep archives project-local. Materialized custom templates travel within the video root through `saveCustomTemplate`; standalone framework portability is future work and needs a sanitized export schema. |
| Q2: multiple references | One reference per framework initially. The proposed singular `referenceId` does **not** already model many-to-one provenance: merging later needs a versioned list of inputs and evidence/conflict rules. |
| Q3: focused brief | Yes: add optional reference-run `focus` text plus selected ranges/system roles. Snapshot it and include its revision in semantic fingerprints. Existing `video_record_research_brief` is storyboard research, so do not silently repurpose it. Reuse citation conventions if useful. |
| Q4: audio structure | Record timed stingers, risers, silence and handoffs now as observed audio-system occurrences when evidenced. Defer executable audio-template vocabulary until implemented. `ReferenceSystem` already permits sound roles and timed occurrences; frames cannot prove an audio claim, and ASR text cannot prove music character. |
| Q5: community publishing | Defer. Existing `provenance-lint.ts` is gallery metadata checking, not a proof of structure-only content or legal clearance. A future publication path needs recursive payload/asset checks and a separate publishing decision. |
| Q6: two ledgers | Keep run execution separate from agent intent. Link run ID, reference ID and optional agent-plan step ID; render pipeline progress in the reference workspace and a link from AgentPlanPanel. Run ledger owns attempts, cancellation and resume; do not duplicate statuses into an editable agent plan. |
| Q7: SourceMedia reuse | Share pure boundary/grid builders once tested; migrate SourceMedia separately. Do not turn an imported asset into a reference or let reference analysis edit the user's timeline. |
| Q8: deletion/export | Archive inside the project; exclude media, transcript, thumbnails and private notes from template/handoff sharing by default. Project deletion already attempts subtree cleanup, but failed removal is logged and may leave bytes: add cleanup status/retry tests before promising erasure. Cancel active writers before deletion so they cannot recreate the archive. Any archive-inclusive export needs explicit rights/reuse confirmation and a preview of included files. |
| Q9: overlapping names | Keep `VideoReference` separate from linked-folder role `reference`, provenance references and generation reference images. They have different ownership, permissions and lifecycles. Label this UI “Analyze video” / “References”, not “Reference images”. |
| Q10: field name | Use `videoReferences` in both project type trees and serializers. It avoids the existing meanings of `references`; add migration/round-trip tests for projects without the field. |
| Q11: HTML vs storyboard | First materialize storyboard seeds and supported systems. Show unsupported motion/typography as unresolved fidelity gaps; do not claim an exact recreation. Complex HTML/content-graph materialization needs a separate compiler and preview validation. A template can preserve section purpose and pacing without reproducing every observed animation. |
| Q12: native video API | Keep a provider-independent evidence contract. Google documents [video input and configurable sampling](https://ai.google.dev/gemini-api/docs/video-understanding); “Gemini is always 1 fps” is not an API invariant. Native-video adapters may be added once they return source-timed evidence and pass the same tests. Do not promise model-independent subframe precision or fixed image costs. |
| Q13: MCP owner | New agent-facing tools belong in `video-edit-server.ts`; reuse service helpers for the older `video-server`. Register tools, permissions and plugin capability metadata together. Metadata naming `video_get_packed_transcript` does not prove that name is registered on the edit server. Validate the actual tool list. |
| Q14: scene method | A method enum describes an algorithm actually run. The current midpoint implementation cannot emit `ffmpeg-scdet`. Emit no detected scenes until a real producer exists, or a separately labeled heuristic object. Actual adjacent-frame candidates should have their own score/method contract and not masquerade as semantic shots. |
| Q15: cell cap | Use 48 cells per coarse request as a provisional engineering cap, not a proven quality default or “48 per 40 s” endlessly multiplied across long videos. Page at 12 cells (4×3), select across the requested span, report interval and omitted candidates; use a provisional 192-cell run ceiling including refinement. Make both configurable and measure before finalizing. A ten-minute source with 48 samples is visibly sparse. |
| Q16: multicam path fix | No drive-by change. Follow project-root-aware validation for new reference writes; log the multicam issue separately if confirmed relevant. |
| Q17: artifact union | Use a sibling versioned reference envelope chain. The existing frontend/API analysis-kind mismatch is separate debt; widening the union does not supply the required reference relationships. |
| Q18: plugin atoms | Implement reserved `reference-analyze` / `reference-vision`; keep SourceMedia atoms operating on SourceMedia. The semantic atom requires both master and semantic flags plus provider/capability/cost checks. |
| Q19: fingerprints | Add a reference-specific canonical hasher. Include media content, actual sampling parameters, evidence content fingerprints, prompt/schema versions, model/provider and focus revision. Hashing only sorted evidence IDs misses changed evidence contents. Keep labels out; preserve stale artifacts for inspection and require revalidation before materialization. |

## Default-on policy and release semantics

Both flags are `true` by default, with only stored `false` disabling them.
No migration rewrites an existing opt-out. The snapshot includes both flags.
The master gate overrides semantic availability; semantic-off still permits
deterministic evidence review. Neither flag starts a run automatically.

For the future Reference rail, use `flags['video.referenceAnalysis'] !== false`
for default-on discoverability. While the snapshot is loading, show a skeleton
or disable Analyze; verify availability again on the server before work. Extend
the hook with an explicit failure/retry state when implementing the UI so an
offline snapshot is not presented as confirmed backend support. When the flag
resolves false, remove the tab and redirect a selected reference rail to a valid
tab. Reject direct API/MCP invocations too. A disabled setting is not a UI-only gate.

Release gates in document 05 become gates for releasing the implementation,
not conditions for changing defaults later. Registering these flags today does
not make the unimplemented routes or UI available. Keep unrelated flags such as
`video.agentApply`, `video.frameSearch` and `video.multicamAudioSync` unchanged.
Approval for timeline changes remains independent of reference availability.

## Results workspace: what users should see

The rail is an entry/list, not the entire analysis canvas. Opening a completed
reference expands an editor-owned review dialog/workspace with a private source
player, a synchronized analysis timeline and an inspector. On small screens use
one column with a sticky player and tabs; preserve selection when switching views.

Illustrative wireframe only; labels and values below are mock data, not analyzed
output. It specifies the result the implementation must render.

```text
References / Product demo        Ready · 48 sampled frames      [Run details]
40.0 s · portrait · audio        2 unresolved ranges            [Re-analyze]
┌──────────────────────────────────┬─────────────────────────────────────┐
│                                  │ Overview | Moments | Systems       │
│       PRIVATE SOURCE PLAYER      │ Evidence | Transcript | Template    │
│                                  │                                     │
│          00:06.800 / 00:40.000    │ 06.07–08.27 · Workload accelerates  │
│   [Play] [− frame] [+ frame]      │ Tags: b-roll · typography · list    │
│                                  │ Observed: labels replace on nouns  │
├──────────────────────────────────┤ Interpretation: builds urgency      │
│ [frame] [frame] [frame] [frame]   │ Evidence: grid-02 / cell 4 [Open]   │
│ 06.1    06.8    07.3    08.2     │ Confidence: model estimate · medium│
├──────────────────────────────────┴─────────────────────────────────────┤
│ SOURCE TIME      0        10        20        30         40 s           │
│ Sections        [hook][premise][demonstration      ][payoff][CTA]        │
│ Caption system  [========][          ][==================]              │
│ Audio system    [bed=====================================]             │
│ Evidence        • • ••• •  •   • • •     • •   • • •                  │
│ Sampling gaps           [///////]            [////]                    │
└───────────────────────────────────────────────────────────────────────┘
[Inspect selected range]  [Add note]       [Review framework → Template]
```

**Overview.** Describe intent, arc and thesis with separate observed/inferred
claims, duration/aspect/audio metadata, counts of sampled frames and systems,
and unresolved questions. Use “not measured” for absent analytics. Never label
boundary-candidate count as shot count, or a model confidence as calibrated
accuracy. Cuts/minute needs an accepted shot/cut list; do not derive it from
the current synthetic scenes or raw change scores.

**Moments and keyframes.** Each card has the actual extracted image, exact source
time, interval/section, a concise description, functional tags, evidence link
and observation/inference indicator. Clicking seeks and selects the related
section without editing the output timeline. Multiple overlapping systems stay
visible. Filters support tags, roles, time range, uncertainty and user notes.
Show source frames only inside private project review; gallery thumbnails use
structural graphics. Distinguish evidence samples from compressed-video codec
keyframes: the UI label means representative samples, not necessarily I-frames.

**Systems.** A caption, lower-third, typography, MG/UI, b-roll or audio system
has entry/active/exit behavior, appearance, placement, purpose and a row of timed
occurrences. Select an occurrence to inspect its incoming/outgoing handoff.
An audio claim links to playable audio/video evidence; no-audio is distinct from
ASR failure or speechless audio. Tags are editable annotations with origin and
revision, not inferred facts silently rewritten by another run.

**Evidence.** Show paginated time/word-labeled grids, sample points and short
clips. Clicking a grid cell opens a readable individual frame; do not force users
to zoom a contact sheet. “Inspect range” takes a question, start/end and density,
previews incremental cost, and creates a new bounded evidence attempt. Show cache
reuse, changed inputs and stale readings. Retain the previous reading while an
attempt runs; switch to a new version only after validation succeeds.

**Transcript.** Phrase rows seek on the same source clock, highlight during
playback and link to supporting frames. Preserve word IDs/times where available.
Selecting a phrase can request a padded evidence range. Display recognizer/model
and language; allow correction as a versioned artifact that invalidates dependent
interpretation. Do not wire this view to timeline cut/delete controls in the
existing TranscriptView without an explicit read-only adapter.

**Template review.** First compare observed sections to proposed structural roles,
proportions, target duration constraints and slots. Surface unsupported systems
and low-confidence sections. “Save template” performs both framework and output
lint and shows named field errors; it does not apply to the edit. Preview uses
placeholder assets/structural graphics. “Use template” opens the existing template
form, binds only project assets, shows unfilled slots and estimated fallback cost,
then produces a reviewable timeline operation batch. Approval applies the batch;
missing required slots never silently bind the reference footage.

## Contract additions required before UI implementation

The proposed schema in document 03 lacks the per-frame descriptions/tags needed
by this UI. Add a versioned, validated moment/annotation contract rather than
reading tags from nonexistent fields:

- `ReferenceMoment`: stable ID, source `atMs`, optional valid interval,
  description, observation/inference kind, producer/model, evidence/sample IDs,
  section/system IDs and optional model confidence. Empty results are valid.
- `ReferenceTag`: stable tag ID, localized built-in role or free-text user/model
  label, origin (`user`/`model`), attached moment/system IDs and revision. Keep
  generated labels in their original language; localize interface taxonomy.
- Evidence samples: stable sample ID, source timestamp, page/cell position,
  dimensions, thumbnail/detail-media ID and content fingerprint. Current parallel
  `paths[]` and `sampledAtMs[]` do not unambiguously map paginated cells to images.
- Serving contract: authorized project/reference/media-ID endpoints with MIME,
  Range support and cache validators. Resolve IDs to validated archive paths;
  never expose arbitrary filesystem paths in image/video URLs. Cancel requests
  on selection changes and reject stale responses for the previous reference.
- Run read model: durable run/attempt IDs, monotonic revision/event sequence,
  step status, timestamps, recoverable error, estimate/actual cost, artifact
  revisions and stale reasons. Add GET snapshot plus reconnectable event stream;
  snapshot after reconnect, deduplicate events, reject older revisions.

All persisted timestamps are source milliseconds. HTML media `currentTime` is
seconds: convert only at the player boundary. Clip evidence must retain its
source offset. Use rational frame rate/timebase utilities where available;
variable-frame-rate footage needs actual presentation timestamps for exact frame
navigation. Do not calculate exact source frame identity as `round(ms * fps)`.
Use half-open intervals `[startMs, endMs)` and clamp seek positions to duration.
Store selected reference/moment/range independently from the output timeline store.

Replace the ambiguous `coverage.sampledMs` model before claiming percentage
coverage. Still samples are points, not watched intervals. Track visual sample
count, maximum gap, gap ranges and actual reviewed clip intervals separately
from transcript phrase ranges. If reporting a visual coverage percentage, define
and version the neighborhood/window rule and union overlapping intervals; label
it “sampling coverage”, not “understanding”. Transcript coverage cannot fill a
visual gap. Confidence is separate and must not be fabricated for absent output.

Reading sections may overlap; framework proportions may not blindly sum their
durations. Extraction must choose a non-overlapping narrative spine and represent
persistent systems as separate spans. Validate sum of proportions, min/max target
durations and slot feasibility before presenting a template as usable.

## UI states and integration plan

| State | UI and permitted action |
| --- | --- |
| Empty | Intake choices, focus brief and acknowledgement; no fabricated analytics. |
| Running | Actual step/attempt, elapsed time and available artifacts. Indeterminate progress unless total work is known; Cancel stays reachable. |
| Awaiting cost approval | Estimate, scope and prior spend; approve or continue reviewing deterministic artifacts. |
| Partial / semantic disabled | Player, transcript and evidence remain available; reading/template actions explain the missing requirement. |
| Failed / interrupted | Safe classified error and retry/resume from persisted valid artifacts. Do not present a browser disconnect as run failure. |
| Ready | Open the result, preserve user's selected section, show unresolved questions. Do not automatically apply a template. |
| Stale | Keep old results visible with changed-input explanation; re-analyze explicitly; block saving stale derived templates. |
| Master disabled / unavailable backend | Valid navigation fallback and clear availability state; server rejects new gated work. |

Suggested new components under `src/components/video/reference/`:
`ReferenceRail`, `ReferenceReviewDialog`, `ReferenceSourcePlayer`,
`ReferenceTimeline`, `ReferenceMomentList`, `ReferenceSystemsView`,
`ReferenceEvidenceViewer`, `ReferenceRunStatus`, `ReferenceFrameworkReview`.
These are proposed names. Keep each below the existing component-size limit.
Reuse Radix dialog/tabs, existing button/tooltip patterns, template forms and
thumbnail caching infrastructure; do not reuse asset-mutating callbacks for
private references. Wire through `editorTypes.ts` and `useVideoProject` only
after backend types/routes exist. Extend URL parsing deliberately for reference
ID and source time; do not overload output `view=preview|output`.

Keyboard users must be able to select every moment and seek with labeled controls;
provide a list/table alternative to timeline bars. Announce stage changes with
polite live regions, not every frame. Use text/patterns as well as colors for
uncertainty; include thumbnail descriptions and timestamps. Dialog focus returns
to its opener. Escape closes expanded evidence first. Localize all interface
strings in en/zh/es/fr/hi/pt; backend error codes map to localized text.

## Delivery and evidence still required

1. Land flags and document decisions (this review). Preserve stored false values.
2. Deliver project-local intake/store/authorized playback and run snapshots.
   Prove unauthorized access, traversal/symlink rejection, cancellation and cleanup.
3. Deliver deterministic evidence and private results workspace with actual sample
   IDs, grid-cell mapping and transcript navigation. Test silent, failed-ASR,
   portrait, long, fast-cut and variable-frame-rate fixtures.
4. Deliver semantic reading, moment tags/descriptions and systems with evidence
   validation, cost gating and honest gap/confidence display. Measure sampling.
5. Deliver framework review, linted materialization, gallery integration and
   separately approved application. Validate unsupported features and slot gaps.

Closest acceptance tests: sample/card/transcript all seek the same source time;
overlapping systems remain selectable; grid cell opens its actual sample;
disabled/loading/error flags do not start work; read-only review never mutates
assets or timeline; stale response cannot replace another reference; reconnect
and killed-process resume preserve attempts; required-slot failure prevents apply;
export includes no reference bytes or signed provenance; poison payloads fail
recursively across all string-bearing template fields. Add keyboard and six-locale
checks and inspect desktop/narrow-screen screenshots when the UI is built.

Unmeasured: detector precision/recall, sampling quality, provider cost, ten-reference
cross-platform success, process-kill resume and visual usability. No numerical
accuracy target or rollout completion is claimed. These remain implementation
release gates, even though the feature flags now default on.

## Validation of this review

- `pnpm test:api test/unit/video/flags.test.ts`: 14 tests passed, including
  absent settings, explicit true/false, snapshot inclusion and independent flags.
- Edited API files formatted with the API workspace oxfmt; focused oxlint passed.
- `pnpm typecheck:api`: passed (API source build configuration).
- All 16 local source links in this document resolve in this working tree.
  `git diff --check` passed.
- `pnpm validate` stopped during frontend typechecking with TS2339 in the
  pre-existing untracked `src/components/video/VideoProjectFilePreview.tsx`
  (for example line 77, missing `previewFailed`; also `saveFailed`, `edit`,
  `cancel`, `save`, `saving`, `openFile`, `previewUnavailable`). The later
  validation stages did not run. No unrelated locale/UI edits were made.
- No reference videos were analyzed and no UI screenshots were produced;
  the wireframe is a specification, not a running implementation.
