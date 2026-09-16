# Analyze Video implementation log

Interrupt-recovery ledger for
[`20-09-15-reference-video-analysis`](./README.md).
Update this file **before each phase commit** so a later session can resume
without reconstructing intent from the diff.

Branch: `feat/analyze-video-reference`
Base: `feat/reference-video-analysis` @ `b4a7cfd` (flags already default-on)

## Status

| Phase | Status | Commit | Notes |
| --- | --- | --- | --- |
| 0 Spikes and fixtures | done | `ddb09bd` | fixtures + S1–S4 in `evidence/` |
| 1 Reference acquisition | done | `5888d3b` | types, archive, routes, MCP, locales, hooks |
| 2 Evidence toolset | done | stub `74e42f4`; evidence `4b73470` | labeled grids, advisory boundaries, packed-transcript MCP |
| 3 Analysis run and progress | done | `793796b` | run ledger, SSE, SideRail, review dialog |
| 4 Structured reading | done | `f7fb706` | agent writes; Neumar validates; ANALYSIS.md/TIMELINE.md; SideRail review view |
| 5 Framework extraction | done | pending SHA | structure-only VideoFramework, lint, review panel |
| 6 Template materialization | not started | — | |
| 7 Apply to an editing task | not started | — | |
| PR | not started | — | |

## Phase 0 notes

- Synthetic fixtures in `src-api/test/fixtures/video/reference/` (no third-party bytes).
- S1: `select` at 0.2 and `scdet` at 8 both get precision 1.0 / recall 0.67 on hard-cuts; still clips stay silent; dissolves and caption-entry are invisible. Boundaries ship advisory-only. Fast-cut 7/19 at those defaults — cap required. FFmpeg 9 needs `-fps_mode vfr`.
- S2 simulate: YouTube, TikTok, generic local mp4 succeeded. Instagram empty media, Bilibili geo/deleted, X no video, Vimeo 404. Link intake stays behind classified errors + local-file alternative.
- S3: 1.0s / 320px = 40 frames / 45 KB / 0.15s on 40s clip. 0.25s control is 160 frames. Default 48-cell coarse cap + 192 run ceiling.
- S4: whisper CLI not installed. Fixtures have real speech+music audio. No language-confidence gate; surface `degraded`.
- Do not commit `evidence/_raw/` or `__pycache__/` (gitignored spike work product).

## Phase 1 notes

### Review (before commit)

- `VideoReference` lives on both type trees; `videoReferences[]` is optional and ignored by existing readers.
- Archive is `references/<id>/` with `assertSafeReferenceId` `/^[a-z0-9][a-z0-9-]{2,100}$/` and `validatePath(..., getVideoProjectRoot, 'write')`.
- Intake requires `studyAcknowledged`; promote is the only path that creates a `MediaItem` and sets `reuseAcknowledged`.
- yt-dlp destination is generalized (`destinationDir`, `--format-sort`); stderr is classified, never raw.
- YouTube plugin path is gated by `network:youtube` (`mcp__video-edit__video_add_reference`); first-party MCP defaults `youtubeImportGranted ?? true`.
- Live streams and playlists are rejected. Duration ceiling is 10 minutes unless `allowLonger`.
- Six-locale intake copy is distinct from `sources.rights` publish-ack. `pnpm check:locale-parity` passed for `video.ts`.
- Tests: 27 passed (`reference-store`, `reference-acquire`, `flags`, `video-reference-routes`). MCP tool list still matches `VIDEO_EDIT_TOOL_NAMES`.

### Verification run

```bash
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/reference-store.test.ts \
  test/unit/video/reference-acquire.test.ts \
  test/unit/video/flags.test.ts \
  test/integration/video-reference-routes.test.ts
pnpm check:locale-parity
pnpm --filter neumar-api exec oxlint src/shared/video/reference \
  src/shared/video/types.ts src/shared/video/store.ts \
  src/shared/video/source/ytdlp.ts src/shared/video/plugins/types.ts \
  src/app/api/video.ts src/shared/mcp/video-edit-server.ts \
  src/extensions/agent/video/permissions.ts
```

`pnpm --filter neumar-api lint` still fails on pre-existing unused `validateInputFile` imports outside this phase. Full `pnpm validate` was not claimed; it is known to trip on unrelated untracked `VideoProjectFilePreview.tsx`. Codacy MCP timed out on individual files after a clean scan of `src-api/src/shared/video/reference/`.

### Known gaps

- Promote is not idempotent: a second promote copies another `MediaItem`.
- Phase 1 has no SideRail UI yet (Phase 3). Hooks and locales are ready.
- Do not commit dirty plan-doc edits (`01`–`05`, `README`) or the large untracked `dev-doc/` tree.

## How to resume

1. Read this file and the latest evidence under `evidence/`.
2. Confirm `git status` on `feat/analyze-video-reference`; do not mix the
   large untracked `dev-doc/` tree or unrelated frontend files.
3. Continue at the first phase whose status is not `done`.
4. Before committing: review the phase diff, format edited files, run the
   phase's verification commands, then record the commit SHA here.

## Decisions taken during implementation

- New implementation branch is `feat/analyze-video-reference` rather than
  continuing on `feat/reference-video-analysis`, so the already-landed flag
  docs stay a separate history and phase commits are reviewable.
- Fixtures are generated synthetic media only (ffmpeg lavfi + macOS `say`).
  No copyrighted reference bytes enter the repository.
- S2 uses `yt-dlp --simulate` / skip-download so the spike records extractor
  keys and classified failures without storing platform media.
- Per-reference study ack + `reference-study.v1` policy version.
- 10-minute duration unless `allowLonger`; no DRM/cookies; reject live/playlists.
- `workspace-path` copies into the archive (allow external media on read, then write under `references/`).
- Default yt-dlp runner is injectable via `spawnFn` so tests can assert classified errors without mocking ESM `spawn`.

## Phase 2 notes

### Stub fix (own commit `74e42f4`)

`buildDeterministicAnalysis()` no longer emits two fabricated scenes labeled
`method: 'ffmpeg-scdet'`. It now writes `scenes: []` and empty `visualBeats`.
Heuristic cut candidates (dead-air / no-audio review-only) remain.

### Evidence toolset (this commit)

- `detectBoundaries()` via ffmpeg `select='gt(scene,t)'` (default) or `scdet`.
  Scores are capped (48 default / 192 route max) and always carry
  `REFERENCE_BOUNDARY_CAVEAT`. Candidates are not promoted to `DetectedScene`.
- Labeled grids: sharp SVG time/word labels **below** the picture (Homebrew
  ffmpeg has no `drawtext`). Media writes `mkdtemp` + rename; existing dest is
  an error; staging dirs are removed on failure.
- Phrase range: `--around` occurrence + padding, typed `PhraseRangeError`.
- `buildEvidence()`: coarse interval with hard cell cap, `sampledAtMs` in the
  result, fingerprint cache (contentHash + range + samples + grid). Packed
  transcript is written with transcribe, before dense grids.
- API: `POST …/boundaries`, `POST/GET …/evidence`.
- MCP: `video_get_packed_transcript` (source or `referenceId`),
  `video_inspect_source_range` (unlabeled; not reference evidence),
  `video_reference_probe|transcribe|boundaries|build_evidence`.
- `inspectSourceRange` now forwards caller `maxFrameCount` / `frameWidth`
  (default cap remains 8). Unlabeled filmstrip path kept for SourceMedia.
- Transcribe is in `METERED_TOOLS` so the agent cannot loop it for free;
  actual cost still goes through `transcribeSourceMedia()` → `cost-approval.ts`.

### Review (before commit)

- Labels sit under the frame, not over it.
- Cache hit writes no new media (`already exists` would fire otherwise).
- Hard-cut fixture: precision (every candidate near a known cut) + ≥2 of 3
  cuts within 100 ms at threshold 0.2; still clip is empty; caveat present.
- `rg "method: 'ffmpeg-scdet'"` in `store.ts` is only the `DetectedScene` union.
- Dual type tree: evidence types stay API-only until Phase 3/4 UI.
- Do not commit dirty plan-doc edits or unrelated `VideoProjectFilePreview`.

### Verification run

```bash
pnpm --filter neumar-api exec oxfmt <phase-2 files>
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/boundaries.test.ts \
  test/unit/video/labeled-frames.test.ts \
  test/unit/video/phrase-range.test.ts \
  test/unit/video/reference-evidence.test.ts \
  test/unit/video/auto-cut-store.test.ts \
  test/unit/video/source-range-evidence.test.ts \
  test/integration/video-reference-evidence-routes.test.ts
# 7 files, 14 tests passed
# MCP name/classification tests passed
pnpm --filter neumar-api exec oxlint <phase-2 source files>
```

Codacy MCP timed out on individual files. Full `pnpm validate` not claimed.

### Known gaps

- `detectBoundaries.sampleRate` is recorded but not applied as an ffmpeg fps
  prefilter; the filters scan the whole file then cap.
- `kind: 'frames' | 'clip'` is accepted on the input type but `buildEvidence`
  currently always materializes a labeled grid.
- Unlabeled `inspectSourceRange` filmstrip still uses ffmpeg `tile`, not
  `labeled-frames.ts`. Labeled drawing is the reference-evidence path.
- `video_reference_transcribe` is untested end-to-end (S4: no whisper CLI).
- Promote still not idempotent (Phase 1 gap).

## Phase 3 notes

### Review (before commit)

- Ordered ledger `fetch → probe → transcribe → pack → boundaries → sample → read → extract`. Deterministic steps are system-owned; read/extract skip when semantic reading is off.
- Resume restarts the first non-`done`/`skipped` step. Cancel keeps finished artifacts.
- Progress `note` is specific (sample step includes range, grid, page, cell cap). `PROGRESS.md` is rewritten, not appended.
- `taskEventBus` channel `video-reference-run:${runId}` is additive; render SSE is unchanged.
- `VideoJob.kind` includes `reference-analysis` and participates in `drainVideoJobs` / cancel.
- SideRail tab `'reference'` is gated with `flags['video.referenceAnalysis'] !== false`. Loading disables Analyze; error shows retry. Hidden tab redirects to sources.
- Expanded review dialog is a private player + run steps, not a rail-only summary. Evidence sample IDs (`page`/`cell`/`gridPath`) land on new grids.
- Six-locale copy for steps/status/review. `pnpm check:locale-parity` and component-size passed (`SideRail` 341/350).
- Plugin atom `reference-analyze` runs the pipeline. Focus text is optional run input; `video_record_research_brief` is not reused.

### Verification run

```bash
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/reference-run.test.ts \
  test/unit/video/reference-progress-markdown.test.ts \
  test/unit/video/jobs-reference-analysis.test.ts \
  test/integration/video-reference-run-routes.test.ts
pnpm test src/__tests__/video/ReferenceRunProgress.test.tsx \
  src/__tests__/video/editorLocation.test.ts
pnpm check:locale-parity
pnpm check:component-size
```

4 API tests and 7 frontend tests passed. Codacy MCP not re-run (prior timeouts). Full `pnpm validate` not claimed.

### Known gaps

- Semantic `read`/`extract` still skip with a note (Phases 4–5).
- SSE reconnect is implemented; the integration test only checks the stream route status, not event-order bounds.
- Default transcribe still needs whisper CLI; jobs may error until ASR is present, then resume from that step.

## Phase 4 notes

### Review (before commit)

- Agent writes; Neumar validates. Typed `ReferenceReadingValidationError` names the offending anchor (`out-of-range`, `evidence-overlap`, `unknown-system`, `thin-ranges`, `confidence`).
- Coverage follows document 06: still samples are points. `thinRanges` are computed from `sampledAtMs` (default gap 2s) plus optional packed-transcript phrase coverage. Writes persist the computed coverage; claimed thinRanges that understate computed gaps are rejected.
- `promptVersion` (`reference-reading.v1`) is in the reading fingerprint. A method bump marks timeline/framework stale without deleting them.
- MCP: `video_reference_write_analysis` / `write_timeline` (write + `media:vision`) and `video_reference_get_reading` (read). Flag `video.referenceSemanticReading` gates writes.
- `ANALYSIS.md` / `TIMELINE.md` render beside the JSON envelopes. These are not `AnalysisArtifactKind` values.
- Default run `read` step uses on-disk envelopes when present; otherwise skips with an agent-write note (not "later phase"). Extract still waits for Phase 5.
- Review dialog loads GET `.../reading` and shows `ReferenceReadingView` (sections, coverage bar, open questions, confidence). Six-locale `reference.reading.*`.
- Dual type tree: `VideoReferenceAnalysis` / timeline / coverage on the frontend.

### Verification run

```bash
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/reference-reading-validate.test.ts \
  test/unit/video/reference-markdown.test.ts \
  test/unit/video/reference-reading-fingerprint.test.ts \
  test/unit/video/reference-run.test.ts
pnpm test src/__tests__/video/ReferenceReadingView.test.tsx
pnpm check:locale-parity
pnpm check:component-size
```

8 API reading tests, 1 run test, 2 frontend tests, plus MCP name/classification tests passed. Codacy MCP timed out. Full `pnpm validate` not claimed.

### Known gaps

- Evidence thumbnails are id labels, not archive image URLs (media route still serves only the source file).
- Run `read` does not block the job waiting for the agent; the agent writes after evidence exists.
- Promote still not idempotent (Phase 1 gap).

## Phase 5 notes

### Review (before commit)

- `VideoFramework` is structure-only: roles, relative timing, typed slots (`ask-user` plus live asset-plan fallbacks), spanning systems, pacing, min section confidence.
- Extraction refuses when thinRanges exceed 40% of duration or when more than 30% of timeline sections sit below confidence 0.4.
- Spine is non-overlapping (document 06). Proportions normalize from `observedMs`. Pacing derives from boundary candidates in range.
- `framework-lint.ts` fails on archive paths, contentHash, data URIs, and 8-token transcript runs in purpose/prompt/text/query templates. Do not weaken this lint.
- MCP: `video_extract_framework`, `video_get_framework`, `video_revise_framework`. HTTP POST/GET/PATCH `.../framework`.
- Default run `extract` tries extraction when a reading exists; coverage/confidence/missing-reading skip the step instead of failing the run.
- `FrameworkReviewPanel` shows proportion bars, slots, systems, confidence, and role correction. Six-locale role labels.

### Verification run

```bash
pnpm vitest run --config src-api/vitest.config.ts \
  test/unit/video/framework-extract.test.ts \
  test/unit/video/framework-lint.test.ts \
  test/unit/video/framework-schema.test.ts \
  test/unit/video/reference-run.test.ts
pnpm test src/__tests__/video/FrameworkReviewPanel.test.tsx
pnpm check:locale-parity
pnpm check:component-size
```

12 API tests and 1 frontend test passed. MCP name/classification tests passed. Codacy MCP not re-run (timeouts). Full `pnpm validate` not claimed.

### Known gaps

- Auto-extract maps every spine section to a single `a-roll` / `ask-user` slot; richer slot kinds wait on the agent draft.
- `analyzeSourceBeats` is not wired into `audio.tempoBpm` yet.
- Materialization is Phase 6.
- Promote still not idempotent (Phase 1 gap).
