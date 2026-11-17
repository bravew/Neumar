# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).



## 26.11.16 — 2026-11-16

### Added
- **deps**: upgrade CopilotKit 1.88 and AG-UI 1.0 (#314) (#332)
- **task**: rewind files to before an Activity turn (#330)
- **video**: interactive transcript layer (epic #177) (#187)
- **ffmpeg**: replace FFmpeg skill across task, chat, design, video (#175)

### Fixed
- **task**: keep a per-attempt file checkpoint for retried turns (#333)
- **ffmpeg**: read SRT cues as ffmpeg does; keep symbols; wrap Korean (#329)
- **video**: draw a split transcript word as one animated caption word (#328)
- **deps**: clear in-major production audit advisories (#313)
- **chat**: repair attach-by-path test mocks and toast assertion (#176)

### Changed
- **epic(290)**: make FFmpeg skill results match the selected media (#327)
- **epic(292)**: keep transcript word timing editable (#316)
- **epic(291)**: keep caption word and punctuation boundaries (#315)
- **epic(289)**: keep the Design workspace's visible state (#321)
- **epic(194)**: recurring maintenance and contributor quality policy (#284)
- **epic(193)**: resolve architecture ownership and reduce the highest-risk modules (#283)
- **epic(192)**: remove proven orphans and obsolete allowances (#282)
- **epic(191)**: restore transcript and shell integration contracts (#281)
- **epic(190)**: repair FFmpeg publication, cancellation, and permission priority (#280)
- **epic(189)**: contain host execution and external I/O (#279)
- **epic(188)**: reproducible merge gate and test isolation (#249)

## 26.10.1 — 2026-10-02

### Added
- **ux**: simple-by-default shell, settings, and first-run (#155)

## 26.9.10 — 2026-09-30

### Added
- **mcp**: per-server timeouts and interrupt semantics (#96)
- **chat**: back conversation branches with forked SDK sessions (#93)
- **channels**: send channel and scheduled prompts verbatim (#92)
- **agent**: surface new Claude SDK stream signals (#91)
- **agent-runtimes**: Codex GPT-6 models, persistent effort, cache-write usage (#89)
- **codex**: forward user images as local_image input (#88)
- **codex**: honor outputFormat via TurnOptions.outputSchema (#87)
- **ui**: React 19.3 <ViewTransition> for route and panel transitions (#84)
- **codex**: per-tool output limits for bridged MCP servers (#82)
- **codex**: stream item.started/item.updated and render todo_list (#81)

### Fixed
- **api**: remove duplicate test import; pin patched undici (#105)
- **models**: show Claude model names in picker (#104)
- **api**: clear the remaining API test typecheck errors (#103)
- **desktop**: ship tray-icon 0.25 and repair test types (#102)
- **agent**: close headless, cost, and branch gaps (#101)
- **agent**: deny headless permission asks and un-shadow canUseTool (#90)
- **deps**: upgrade claude-agent-sdk to 0.3.283 with Zod-safe MCP schemas (#80)

### Performance
- **agent**: measure and cut Claude first-turn latency (#95)
## Unreleased

## [26.9.9] - 2026-09-09

### Added

- **video**: expand Video Mode with durable planning and external-footage export.
- **mcp**: accept inbound MCP connections from Codex and Claude Code.

### Fixed

- **video**: validate audio assets before use to keep video workflows reliable.

## [26.8.27] - 2026-08-27

Maintenance release.

## [26.8.25] - 2026-08-25

### Added

- **video**: implement the post-upgrade video plan
- **library**: make project grids responsive
- **video**: improve project library management

### Fixed

- **video**: harden project library controls
- **task-v2**: isolate task state and recover interrupted runs
- **agent**: recover interrupted task runs

## [26.8.20] - 2026-08-20

### Added

- **task-v2**: collapse each agent turn into one activity group

### Fixed

- **task**: make local media previews resilient to load errors
- **task-v2**: address PR review findings on activity groups
- pin transitive deps to clear high-severity npm audit findings
- clear high-severity npm audit findings in transitive deps

## [26.8.19] - 2026-08-19

### Added

- **task-v2**: render tool-generated media inline in chat

### Fixed

- **agent**: let skill-enabled profiles download media instead of refusing
- **task-v2**: stop rendering AskUserQuestion answers twice
- **agent**: unblock codex network access and unwrap JSON envelopes
- **ag-ui**: create the run row before journaling its first event
- **task-v2**: resolve the session folder when task.work_dir is empty
- skill-based downloads and inline media rendering in chat- #1
