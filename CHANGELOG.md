# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

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
