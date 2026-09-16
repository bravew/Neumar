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
| 0 Spikes and fixtures | in progress — evidence written, awaiting commit | — | fixtures + S1–S4 in `evidence/` |
| 1 Reference acquisition | not started | — | |
| 2 Evidence toolset | not started | — | ship `store.ts` stub fix as its own commit |
| 3 Analysis run and progress | not started | — | |
| 4 Structured reading | not started | — | |
| 5 Framework extraction | not started | — | |
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
