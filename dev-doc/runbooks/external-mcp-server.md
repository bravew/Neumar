# External MCP Server Runbook

Local inbound MCP lets Codex, Claude Code, and other MCP hosts call Neumar
library projects and tasks. The host talks JSON-RPC over stdio to a thin
adapter. The adapter calls the running Neumar daemon on loopback. The stdio
process never opens SQLite.

This is **not** outbound MCP (Neumar calling other servers). Settings keeps
those panels distinct.

## Enable

1. Start Neumar (desktop app or `pnpm dev:api`). The daemon must stay running.
2. Open Settings → MCP → **Inbound MCP server**.
3. Enable **Allow other apps to call Neumar**. Leave writes and agent runs off
   until you accept those risks.
4. Copy the Codex or Claude Code add command. Paste it into a terminal.
5. Restart or inspect the host (`codex mcp list` / `claude mcp list`).
6. Confirm the host lists `neumar_health` and can call it.

Recommend Codex **writes** approval for mutation tools. Claude Code is
installed at **user** scope.

Ship default: all three flags off (`externalMcpEnabled`,
`externalMcpWritesEnabled`, `externalMcpAgentRunsEnabled`).

## Architecture

```
Host  --stdio JSON-RPC-->  neumar-api mcp server
                              |  reads {appDataDir}/mcp-server.secret
                              |  reads {appDataDir}/mcp-daemon.json
                              v
                         http://127.0.0.1:<port>/mcp/server/*
                              |
                              v
                         SQLite / agent services (daemon only)
```

- UI routes `/mcp/server/status` and `/mcp/server/install-info` do not use the
  bridge secret and must never return it.
- Command routes always require `Authorization: Bearer <secret>`.
- `--daemon-url` must be loopback HTTP(S). Non-loopback URLs are refused.
- `NEUMAR_APP_DATA_DIR` pins the directory so a host with an unusual cwd still
  finds the secret and daemon record.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Host lists no Neumar tools | Inbound flag off; host not restarted; wrong `mcp add` binary |
| `DAEMON_UNREACHABLE` | Neumar is stopped, crashed, or `--daemon-url` points at the wrong port |
| `UNAUTHORIZED` | Secret file missing or stdio child using a different app-data dir |
| `FEATURE_DISABLED` | Settings inbound switch is off |
| `WRITE_DISABLED` | Writes switch is off; write tools are omitted from `tools/list` |
| `RUN_DISABLED` | Agent-runs switch is off |
| `CONFLICT` | Same `requestId` reused with a different payload |
| `AMBIGUOUS_RESULT` | Name matched more than one project; pass the UUID |
| `PAYLOAD_TOO_LARGE` | One row exceeded the 256 KiB cap; page with `cursor` |
| `VALIDATION_FAILED` | Malformed input, non-UUID write target, or bad cursor |
| Stdio child never exits | Close stdin; idle timeout is 30 minutes (`NEUMAR_MCP_IDLE_MS`) |
| Logs on stdout break the host | Child must run with `MCP_STDIO=1` (the `mcp server` entry sets this) |

Existing `/mcp`, `/mcp/bridge`, and `mcp video-server` are unchanged. A failure
here must not be "fixed" by disabling those surfaces.

## Secret file recovery

Path: `{appDataDir}/mcp-server.secret` (today `~/.neumar/mcp-server.secret`).
Mode `0600` where the OS allows it.

1. Quit Neumar.
2. Delete `mcp-server.secret` (and only that file).
3. Start Neumar again. `ensureBridgeSecret()` recreates it on listen.
4. Re-copy the host add command if `NEUMAR_APP_DATA_DIR` changed. The secret
   is never placed in argv, env snippets, or install-info JSON.

If a host was already added, it keeps working: the stdio child reads the new
file from disk. You do not need to re-add unless the launch command itself
changed.

## Privacy and audit

- Install-info env is only `NEUMAR_APP_DATA_DIR`. Never the secret.
- Facade commands omit workspace / `work_dir` paths.
- Prompt-shaped tool text is returned as data, not executed.
- Audit events use type `external_mcp.command` with `source: external-mcp`,
  HTTP method, route, and error `code`. Do not paste the bearer secret, raw
  tool arguments, or transcript bodies into tickets.

## Rollback

1. Turn off **Allow other apps to call Neumar** (or set
   `externalMcpEnabled=false` in the daemon settings table).
2. Writes and agent runs have their own flags; turning the parent flag off is
   enough to block command routes.
3. Remove the host entry: `codex mcp remove neumar` or
   `claude mcp remove --scope user neumar`.
4. Optional: delete `mcp-server.secret` and `mcp-daemon.json` after quit.

Outbound MCP server JSON and `/mcp/bridge` tokens are separate. Do not rotate
those to recover this feature.

## Packaged vs development launch

- Packaged: `{sidecar} mcp server --daemon-url http://127.0.0.1:<port>`
  (`neumar-api` / `neumar-api.exe`).
- Development: `node` plus the API entry script, same `mcp server` args.
- Windows: quote paths that contain spaces; the sidecar name ends with `.exe`.
- `mcp server` is dispatched before the HTTP daemon module loads, so the child
  does not open SQLite or native media addons.

Verify the child-process smoke (uses tsx, not a stale pkg binary):

```bash
pnpm --filter neumar-api exec vitest run --config vitest.config.ts \
  test/unit/mcp/stdio-entry.test.ts \
  test/unit/mcp/pagination.test.ts
pnpm test:e2e -- -t "external MCP"
```

After `pnpm build:api:binary`, smoke the packaged sidecar without using the
operator's host config:

```bash
NEUMAR_MCP_SIDECAR_SMOKE=1 pnpm test:e2e -- -t "external MCP"
```

Host matrix (manual after the child-process smoke is green): isolated
`CODEX_HOME` / Claude user-scope add against a live daemon, then IDE hosts.
Do not point those checks at the operator's real MCP config directory.
