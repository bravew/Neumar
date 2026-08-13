# Mock Agent — replay-based agent for tests & offline iteration

Replays a pre-recorded session as neuma `AgentMessage`s. **Zero LLM tokens,
zero network.** Adapted from open-design's `mocks/` replay CLIs
(`_sample/open-design/mocks/`).

## Why a registry seam, not a fake `claude` binary

open-design spawns `claude -p --output-format=stream-json` and parses stdout
itself, so its mock just emits NDJSON on stdout. neuma instead drives the
**Claude Agent SDK** over a bidirectional *control protocol* — a stdout-only
mock can't complete that handshake. So the faithful interception point is
neuma's own `IAgent`/registry boundary: a `mock` provider that yields the same
`AgentMessage` stream the real agents do. Tests then exercise the full pipeline
(routes → registry → agent → `AgentMessage` → SSE → UI) with no provider spend.

## Selecting a recording (env-driven)

| Env var | Effect |
|---|---|
| `NEUMA_MOCK_TRACE=hello-read-edit` | Exact id, or a unique filename prefix. Unmatched → throws (a typo never silently picks another trace). |
| `NEUMA_MOCK_POOL=outcome:succeeded` | Pool by `agent:<name>`, `outcome:<succeeded\|failed\|errored>`, `skill:<name>`, or a bare tag. |
| `NEUMA_MOCK_SEED=<any>` | Reproducible "random" pick within the pool / corpus. |
| `NEUMA_MOCK_RECORDINGS_DIR=<dir>` | Use fixtures from another directory. |
| `NEUMA_MOCK_NO_DELAY=1` | Skip inter-event sleeps (fast tests). |

A per-task trace also comes from the agent **config** (`config.model`), which
wins over the env so concurrent mock tasks can replay different traces.

## Drive it end-to-end through the running server

```bash
# 1. Start the API in mock mode (deterministic, no tokens, channels off):
NEUMA_MOCK_TRACE=hello-read-edit NEUMA_MOCK_NO_DELAY=1 pnpm api:start

# 2. Create/run a task selecting provider "mock" via the normal chat/agent
#    API, then assert the SSE events / DB rows. The whole pipeline runs.

# 3. node scripts/dev.mjs logs   # watch the replay
#    node scripts/dev.mjs stop
```

In a Vitest integration test, skip the server and drive the factory directly —
see `src-api/test/integration/mock-agent.test.ts`.

## Recording format (`recordings/*.jsonl`)

First line is `meta`; each following line is one replay event.

```jsonc
{"type":"meta","id":"hello-read-edit","agent":"claude","outcome":"succeeded","tags":["skill:demo"]}
{"type":"thinking","content":"…","t_ms":120}
{"type":"text","content":"…","t_ms":300}
{"type":"tool_call","id":"toolu_01","name":"Read","input":{"file_path":"README.md"},"t_ms":650}
{"type":"tool_result","id":"toolu_01","output":"# Old Title\n","isError":false}
{"type":"report","content":"Done.","t_ms":2000}
```

Mapping to `AgentMessage`s: `thinking`/`text`→ same; `report`→`text`;
`tool_call`→`tool_use` immediately followed by its `tool_result`
(`{toolUseId, output, isError}`); `error`→`error`. The stream is bracketed by
`session` … `result` + `done`. `t_ms` is elapsed ms from session start and
paces replay (capped at 1.5s/step) unless `NEUMA_MOCK_NO_DELAY=1`.

## Adding recordings

Drop a new `*.jsonl` under `recordings/`. Keep fixtures small and committed —
this is the in-repo corpus. (open-design hosts a 179-trace corpus on R2 and
fetches on demand; neuma starts with a couple of hand-written fixtures. A
harvester that anonymizes real sessions into this format is the natural next
step.)
