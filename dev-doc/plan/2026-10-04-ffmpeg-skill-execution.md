# FFmpeg skill epic execution

Epic: [#168](https://github.com/bravew/Neumar/issues/168). Implementation branch: `epic/168-ffmpeg-skill`, created from `main` at `90554dc0`.

The development plan is [2026-10-04-ffmpeg-skill-replacement.md](2026-10-04-ffmpeg-skill-replacement.md). Each child receives separate commits on this branch. The final PR targets `main` and closes #168 and #169–#174. No intermediate PR is used.

## Decisions during implementation

- The user explicitly approved execution of the pinned Python skill and tests with installed tools and temporary local fixtures on 2026-10-04. No downloads or dependency installations were approved or needed.
- The managed MCP server namespace is `ffmpeg-skill`. The existing subprocess bridge permits hyphens but rejects underscores in server names. Tool names can retain the `ffmpeg_skill_` prefix. Native `ffmpeg` remains separate.
- Initial `pnpm validate` passed branding, lint with existing warnings, consistency checks, and frontend/API source typechecks. Root formatting failed on five existing untracked files: `.pi/agent/auth.json`, `.pi/agent/models-store.json`, `.pi/agent/settings.json`, `dev-doc/upgrades/2026-09-27/audit-rust.json`, and `dev-doc/upgrades/2026-09-27/inventory-rust.json`. Those files are preserved. The log is local at `/tmp/neumar-ffmpeg-implementation-baseline.log` and is not a release artifact.

## Host capability gaps found at #173

The installed ffmpeg build (`/opt/homebrew/Cellar/ffmpeg/9.0.2`) omits four optional libraries, so the pinned skill's caption, subtitle-burn, HDR-to-SDR, and stabilization operations cannot run on this host. The vendored Python is correct; the skill reports these as actionable `missing_tool` failures. `_contract.py doctor --json` confirms `ok:false` with missing `filter:drawtext`, `filter:subtitles`, `filter:vidstabdetect`, `filter:vidstabtransform` (and `zscale`, which breaks `color --to-sdr`). These map to `libfreetype`, `libass`, `libvidstab`, and `libzimg`. Verified-working on this host: probe, stream-copy cut (source-hash preserved), crop, loudness measure. This is a host-provisioning concern for #174's support documentation, not a code change.

## Checkpoints

| Issue | State | Verification |
| --- | --- | --- |
| #169 | Committed `8a0217c8` | `pnpm check:ffmpeg-skill`, `--self-test`, `node --check`; 42 tools, closed schemas, CLI spellings, provenance and inventory drift. |
| #170 | Committed `26de3c0f` | 15 loader/discovery tests (`plugins/loader`, `core/agent/run-context`, `sync-builtin-skills`). |
| #171 | Committed `728f4a85` | 48 service tests (`ffmpeg-skill-policy`, `ffmpeg-skill-runner`, `ffmpeg-skill-server`, `sdk-mcp-servers-tools-list`); API `tsc --noEmit` exit 0. |
| #172 | Committed `f98a8ad6` | 66 API tests (attach, agent-tools, video-codex-bridge, design-chat, task/design-apply) + 6 frontend `useAgentDock`; API/API-test + frontend typechecks; disk-backed video publication. |
| #173 | Committed `4b3f5f5a` | 19 tests (attach + real-media smoke), 67 across the full ffmpeg-skill group; API typecheck; diff-check. Upstream conformance: contract 139/152, all 464/580, every failure a host ffmpeg capability gap (below). |
| #174 | Committed `f5f3709d`, `75f16f3a` | 38 tests across layout (`_up_/skills` and `skills` under a temporary `RESOURCES_DIR`), runtime discovery, executor aliases, attach, and real-media smoke including a non-ASCII filename; API typecheck and lint; drift check after the SKILL.md wording fix. `pnpm test:fast` 380 frontend files / 1634 tests and 586 API files / 3747 tests (7 skipped) pass. `pnpm validate` fails only at root `format:check` on the five pre-existing untracked files listed above; API `format:check` and `check:component-size`, which follow it, pass when run directly. Not verified: Linux, Windows, and a packaged GUI build. |

## Verification policy

Record exact commands and results after each checkpoint. Source inspection or a passing config test cannot stand in for runtime behavior. Capability-based skips and unavailable platform testing remain explicit. Keep child issues open until the final PR merges into `main`.
