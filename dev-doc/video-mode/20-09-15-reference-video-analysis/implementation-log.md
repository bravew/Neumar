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
| 1 Reference acquisition | in progress — tests green, awaiting commit | — | types, archive, routes, MCP, locales, hooks |
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
