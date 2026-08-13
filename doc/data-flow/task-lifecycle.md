---
summary: "Task execution lifecycle — user prompt through planning phase, approval, execution phase, and workspace file generation"
read_when:
  - Understanding the end-to-end task flow
  - Debugging task execution issues
  - Working on the plan/execute phases
title: "Task Execution Lifecycle"
---

# Task Execution Lifecycle

```
┌─────────┐     POST /agent/plan      ┌──────────┐
│  User   │ ──────────────────────────▶│   API    │
│  types  │                            │  Server  │
│  prompt │     SSE: plan messages     │          │
│         │ ◀──────────────────────────│          │
└────┬────┘                            └──────────┘
     │
     │  User reviews plan
     │  and clicks "Approve"
     ▼
┌─────────┐    POST /agent/execute     ┌──────────┐
│  User   │ ──────────────────────────▶│   API    │
│approves │                            │  Server  │
│  plan   │     SSE: execution msgs    │          │
│         │ ◀──────────────────────────│          │
└────┬────┘                            └────┬─────┘
     │                                      │
     │  UI displays                         │  Agent executes:
     │  messages                            │  • Tool calls
     │                                      │  • File operations
     │                                      │  • Code execution
     │                                      │  • MCP tools
     │                                      │
     │                                      │  Backend persists:
     │                                      │  • Messages → SQLite
     │                                      │  • Fan-out → TaskEventBus
     │                                      ▼
     │                                ┌──────────┐
     │                                │ Workspace│
     │                                │  Files   │
     │                                └──────────┘
     │
     ▼
  Observer clients (optional)
  GET /agent/subscribe/:taskId
```

## V2 Task Lifecycle (AG-UI + CopilotKit)

The V2 lifecycle uses the AG-UI protocol with CopilotKit V2 runtime. The key difference is a **detached pipeline** where the agent runs independently of the SSE connection.

```
┌─────────┐     POST /ag-ui/run          ┌──────────┐
│  User   │ ──────────────────────────▶  │   API    │
│  types  │                              │  Server  │
│  prompt │     SSE: AG-UI events        │          │
│         │ ◀──────────────────────────  │          │
└────┬────┘                              └──────────┘
     │                                        │
     │  STEP_STARTED (planning)               │  Detached pipeline:
     │  CUSTOM(plan) event                    │  • Generator runs in background
     │  STEP_FINISHED (planning)              │  • Events → TaskEventBus + DB
     │                                        │  • SSE subscribes passively
     │  CopilotKit useInterrupt               │
     │  shows PlanInterruptCard               │
     │                                        │
     │  User approves via                     │
     │  forwardedProps.command.resume          │
     ▼                                        │
┌─────────┐    POST /ag-ui/run (resume)  ┌──────────┐
│  User   │ ──────────────────────────▶  │   API    │
│approves │                              │  Server  │
│  plan   │     SSE: execution events    │          │
│         │ ◀──────────────────────────  │          │
└────┬────┘                              └────┬─────┘
     │                                        │
     │  STEP_STARTED (execution)              │  Agent executes:
     │  TOOL_CALL_* events                    │  • Tool calls
     │  TEXT_MESSAGE_* events                 │  • File operations
     │  STATE_SNAPSHOT (usage data)           │  • MCP tools
     │  STEP_FINISHED (execution)             │
     │  RUN_FINISHED                          │  Backend persists:
     │                                        │  • Events → SQLite
     │                                        │  • File artifacts extracted
     │                                        ▼
     │                                  ┌──────────┐
     │                                  │ Workspace│
     │                                  │  Files   │
     │                                  └──────────┘
     │
     ▼
  Late joiners (any time)
  GET /ag-ui/subscribe/:taskId
  → MESSAGES_SNAPSHOT + buffer replay + live events
```

**V2 plan approval flow:**
1. Agent emits `CUSTOM(plan)` event with step list
2. `usePlanInterrupt` hook polls `/ag-ui/pending-plan/:taskId`
3. `PlanInterruptCard` renders with approve/reject buttons
4. Approve → `agent.runAgent({ forwardedProps: { command: { resume: { approved: true } } } })`
5. API finds pending plan run, starts execution phase
6. Reject → `POST /ag-ui/reject-plan/:taskId` → task status set to `error`

## Recovery & Reconnect

Task runs share a reliability envelope with Design and Video (`run-context.ts` +
`agent_run_events` journal). Each run is reserved against idempotency keys
(`client_request_id`, `request_message_id`) before it starts, so a retried or duplicated
request converges on the existing run instead of forking a new one. Every AG-UI event is
journaled by run/seq before it's published live, so a client that reconnects — or a late
joiner hitting `GET /ag-ui/subscribe/:taskId` — replays from the last event id instead of
losing history. A failure only auto-retries silently when nothing user-visible has happened
yet (no text, tool call, artifact write, or live artifact) and it's the first attempt;
anything past that point surfaces to the user instead. See [Agent System — Run Context &
Recovery](../backend/agent-system.md#run-context--recovery) for the full mechanism and
`dev-doc/runbooks/multi-mode-reliability.md` for the operational runbook.

---

*See also: [Streaming & Observation](streaming.md) · [Agent System](../backend/agent-system.md) · [Hooks & Utilities](../frontend/hooks.md)*
