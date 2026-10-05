# FFmpeg skill epic execution

Epic: [#168](https://github.com/bravew/Neumar/issues/168). Implementation branch: `epic/168-ffmpeg-skill`, created from `main` at `90554dc0`.

The development plan is [2026-10-04-ffmpeg-skill-replacement.md](2026-10-04-ffmpeg-skill-replacement.md). Each child receives separate commits on this branch. The final PR targets `main` and closes #168 and #169–#174. No intermediate PR is used.

## Decisions during implementation

- The user explicitly approved execution of the pinned Python skill and tests with installed tools and temporary local fixtures on 2026-10-04. No downloads or dependency installations were approved or needed.
- The managed MCP server namespace is `ffmpeg-skill`. The existing subprocess bridge permits hyphens but rejects underscores in server names. Tool names can retain the `ffmpeg_skill_` prefix. Native `ffmpeg` remains separate.
- Initial `pnpm validate` passed branding, lint with existing warnings, consistency checks, and frontend/API source typechecks. Root formatting failed on five existing untracked files: `.pi/agent/auth.json`, `.pi/agent/models-store.json`, `.pi/agent/settings.json`, `dev-doc/upgrades/2026-09-27/audit-rust.json`, and `dev-doc/upgrades/2026-09-27/inventory-rust.json`. Those files are preserved. The log is local at `/tmp/neumar-ffmpeg-implementation-baseline.log` and is not a release artifact.

## Checkpoints

| Issue | State | Verification |
| --- | --- | --- |
| #169 | In progress | Pinned payload, static contract, provenance, drift verification. |
| #170 | Pending | Discovery, catalogs, profiles, owned sync and upgrade tests. |
| #171 | Pending | Host policy, runtime resolution, supervision and real media tests. |
| #172 | Pending | Mode selections, provider transports, output attribution. |
| #173 | Pending | Media property and cross-mode regression suite. |
| #174 | Pending | Installed-resource smoke, support documentation, final gate and PR. |

## Verification policy

Record exact commands and results after each checkpoint. Source inspection or a passing config test cannot stand in for runtime behavior. Capability-based skips and unavailable platform testing remain explicit. Keep child issues open until the final PR merges into `main`.
