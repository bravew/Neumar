# External MCP Server Implementation Log

Resume file for `dev-doc/plan/2026-09-02-external-mcp-server.md`.
Update this file at the start and end of every checkpoint so an interrupted session can continue.

| Field | Value |
| --- | --- |
| Started | 2026-09-03 |
| Plan | `dev-doc/plan/2026-09-02-external-mcp-server.md` |
| Goal | Implement all 7 checkpoints, review+commit each, then open a PR |
| Branch | `feat/external-mcp-server` |
| Status | In progress — checkpoint 2 |

## Current position

- Next work: Checkpoint 2 (authenticated daemon facade and policy services)
- Last completed checkpoint: 1
- Last commit: pending at time of this update (see git log on this branch)

## Checkpoint status

| CP | Name | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| 1 | Protocol spike and contract freeze | completed | (this checkpoint) | See notes below |
| 2 | Authenticated daemon facade | pending | | |
| 3 | Stdio server, read tools | pending | | |
| 4 | Safe mutation tools | pending | | |
| 5 | Durable agent runs | pending | | off by default |
| 6 | Install info and Settings UX | pending | | |
| 7 | Packaged smoke tests and runbook | pending | | |
| PR | Pull request | pending | | |

## Resume instructions

1. Read this log and the plan.
2. Skip completed checkpoints.
3. If a checkpoint is `in_progress`, inspect the working tree and tests before continuing.
4. After each checkpoint: review, fix valid issues, commit, update this log, then advance.

## Checkpoint 1 notes

Shipped:

- `@modelcontextprotocol/server@^2.0.0` beside `@modelcontextprotocol/sdk@^1.30.0`
- Frozen catalog, Zod schemas, error codes, setting keys, argv parser, instructions
- Health-only `createHealthMcpServer` using SDK v2 `McpServer` + `serveStdio` (`legacy: 'serve'`)
- Contract tests including a real stdio JSON-RPC initialize / tools/list / tools/call of `neumar_health`

Verification:

```bash
pnpm --filter neumar-api exec vitest run --config vitest.config.ts test/unit/mcp/public-server-contract.test.ts
```

7/7 passed. `pnpm --filter neumar-api typecheck` still reports two pre-existing errors in `src/shared/video/pipeline.ts` (not touched). Public-server files typecheck clean.

Host matrix (CLI versions on this machine):

- Codex CLI `0.152.1`
- Claude Code `2.1.259`
- Automated handshake used protocol `2025-03-26` initialize (legacy serve). Instructions, single health tool, structuredContent + JSON text all returned.
- Isolated `codex mcp add` / `claude mcp add` against a live child is deferred to checkpoint 7 so we do not write the user's real host config.

Review fixes in this checkpoint:

- `neumar_get_agent_run` is gated by `agentRunsEnabled` (`side: 'run'`) rather than always listed as a read.
- Safe-retry set is `readOnlyHint`, so get-run remains retryable once enabled.

Bundle: v2 pulls `@modelcontextprotocol/core`. Full `pkg` size delta is checkpoint 7.

Argv: `mcp video-server` remains an exact two-token match. Extra tokens error instead of falling through to the HTTP daemon.

## Session notes

- Do not push unless explicitly asked except when opening the PR.
- Next SQLite migration is filename `055_external_mcp.ts`, version `107`.
- Vitest root is `src-api/`; pass `test/unit/...` not `src-api/test/...`.
