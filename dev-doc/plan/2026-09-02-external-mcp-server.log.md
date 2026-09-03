# External MCP Server Implementation Log

Resume file for `dev-doc/plan/2026-09-02-external-mcp-server.md`.
Update this file at the start and end of every checkpoint so an interrupted session can continue.

| Field | Value |
| --- | --- |
| Started | 2026-09-03 |
| Plan | `dev-doc/plan/2026-09-02-external-mcp-server.md` |
| Goal | Implement all 7 checkpoints, review+commit each, then open a PR |
| Branch | `feat/external-mcp-server` |
| Status | In progress — checkpoint 4 |

## Current position

- Next work: Checkpoint 4 (safe mutation tools)
- Last completed checkpoint: 3
- Last commit: see git log (`feat(mcp): add stdio inbound MCP server and read tools`)

## Checkpoint status

| CP | Name | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| 1 | Protocol spike and contract freeze | completed | `6495c2c` | See notes below |
| 2 | Authenticated daemon facade | completed | `e6b023e` | See notes below |
| 3 | Stdio server, read tools | completed | (this checkpoint) | See notes below |
| 4 | Safe mutation tools | in_progress | | |
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

## Checkpoint 2 notes

Shipped:

- Migration `055_external_mcp.ts` version `107` — `external_mcp_idempotency` ledger
- `{appDataDir}/mcp-server.secret` (0600) + loopback bearer middleware (fail closed if missing)
- Feature/write/run gates default off (`externalMcp*`); command routes always require the secret
- `GET /mcp/server/status` has no secret and never returns one
- Bounded project/task reads wrapping existing ops; omit `workspace` / `work_dir`
- Atomic create project, create session+task, allowlisted update, agent comment
- Idempotency unique `(surface, request_id)` with payload digest; mismatch → `CONFLICT`
- `writeDaemonRecord` / `readDaemonRecord` for checkpoint 3 listen hook
- Run routes stubbed as `RUN_DISABLED` until checkpoint 5
- Route module exported; **not** mounted in `src-api/src/index.ts` yet (checkpoint 3)

Verification:

```bash
pnpm --filter neumar-api exec vitest run --config vitest.config.ts test/integration/api/mcp-server.test.ts test/unit/mcp/public-server-contract.test.ts test/integration/api/db.test.ts
```

52/52 passed. Review fixes: transactional idempotency, output schema parse, no auto-create secret on request, no internal error leakage, `matches[0]` undefined guard.

`src-api/src/index.ts` is still owned by checkpoint 3 (argv + `app.route('/mcp/server', mcpServerRoutes)` + `ensureBridgeSecret` / `writeDaemonRecord` on listen).

## Checkpoint 3 notes

Shipped:

- `mcp server` argv dispatch before `start()`, sibling of `mcp video-server`; `--help` on stderr via logger.error
- `app.route('/mcp/server', mcpServerRoutes)` plus `ensureBridgeSecret` / `writeDaemonRecord` on listen
- Stdio adapter: discover (loopback URL only), daemon client (one read retry, no write mapping retry), read catalog, idle-exit
- `MCP_STDIO=1` live-check in `createLogger` so `info`/`warn` never write stdout
- Resources deferred (hosts did not require them in checkpoint 1)

Verification:

```bash
pnpm --filter neumar-api exec vitest run --config vitest.config.ts test/unit/mcp/public-server.test.ts test/integration/mcp-public-server.test.ts test/unit/mcp/public-server-contract.test.ts test/integration/api/mcp-server.test.ts
```

26/26 passed.

## Session notes

- Do not push unless explicitly asked except when opening the PR.
- Vitest root is `src-api/`; pass `test/unit/...` not `src-api/test/...`.
- Codacy MCP timed out on single-file analyze; directory analyze of `external-mcp/` returned no issues.
