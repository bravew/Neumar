---
summary: "Heartbeat/cron scheduling engine — periodic agent tasks with multi-channel delivery, cost budgets, condition evaluation, and empty-result suppression"
read_when:
  - Working on the automation or scheduling system
  - Understanding heartbeat vs cron trigger behavior
  - Debugging delivery, condition evaluation, or lifecycle issues
  - Adding new trigger types or delivery channels
title: "Automation & Scheduling"
---

# Automation & Scheduling Engine

Scheduling and automation engine for periodic agent tasks. Supports heartbeat (interval-based
periodic checks), cron (calendar-aligned schedules), webhook (external triggers), and manual
triggers. Results are delivered to channels (Telegram, Discord, Slack, Lark) or desktop
notifications.

## Architecture Overview

```
Trigger Source
    │
    ├──▶ Heartbeat Timer (interval + active hours + stagger offset)
    ├──▶ Cron Scheduler (cronExpr, once/interval/cron kinds)
    ├──▶ Webhook POST (slug + bearer token)
    └──▶ Manual (on-demand via API/MCP)
            │
            ▼
     Engine Queue (max concurrent: 3, heartbeats limited to 2)
            │
            ▼
     Run Execution
       ├── Agent invocation (provider/model/planning/mcpServers)
       ├── Timeout enforcement (max 1h, default 10min)
       └── Overlap policy (skip | queue | cancel_previous)
            │
            ▼
     Condition Evaluation (3-layer, cost-optimized)
       ├── 1. Hash check (zero cost)
       ├── 2. Keyword heuristic (zero cost)
       └── 3. LLM Judge (Haiku ~$0.001/eval)
            │
            ▼
     Empty Result Suppression (3-layer)
       ├── 1. SHA-256 hash dedup (24h window)
       ├── 2. @@HEARTBEAT_OK token
       └── 3. Heuristic keyword matching
            │
            ▼
     Channel Delivery
       ├── Telegram (4096 char limit)
       ├── Discord (2000 char limit)
       ├── Slack (3000 char + Block Kit)
       ├── Lark (30000 char limit)
       └── Desktop (100000 char + SSE event)
            │
            ▼
     Lifecycle Management
       ├── Auto-disable (expiry, maxRuns, costBudget, 5+ failures)
       ├── Global cost budgets (daily $10 / monthly $100)
       └── Missed-fire recovery (2h threshold, 3s stagger)
```

## Service Layer

All services follow the **functional pattern** with module-level state:

| Service                 | File                     | Responsibility                                                                  |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| **Engine**              | `engine.ts`              | Core queue processing, run execution, concurrency limits                        |
| **HeartbeatRunner**     | `heartbeat-runner.ts`    | Periodic timer with SHA256-based stagger offset, active hours, drift correction |
| **Store**               | `store.ts`               | JSON file persistence with 500ms debounced writes                               |
| **Lifecycle**           | `lifecycle.ts`           | 60s lifecycle check loop, auto-disable, cost budgets, missed-fire recovery      |
| **Delivery**            | `delivery.ts`            | Channel delivery + 3-layer empty result suppression                             |
| **Channel Formatter**   | `channel-formatter.ts`   | Platform-specific formatting, chunking, char limits                             |
| **Condition Evaluator** | `condition-evaluator.ts` | 3-layer cost-optimized condition evaluation                                     |
| **Templates**           | `templates.ts`           | 8 built-in automation templates                                                 |
| **Delivery Locale**     | `delivery-locale.ts`     | i18n for delivery messages (6 locales)                                          |
| **Hooks**               | `hooks.ts`               | Event emission system + SSE endpoint                                            |
| **Types**               | `types.ts`               | All type definitions                                                            |
| **Constants**           | `constants.ts`           | Limits and defaults                                                             |
| **API Routes**          | `automation.ts`          | Hono API routes                                                                 |
| **MCP Server**          | `schedule-server.ts`     | MCP tool server (5 tools)                                                       |

## Engine

Module-level state manages the automation queue and active runs:

- **Max concurrent runs:** 3 (heartbeats limited to 2 of those 3 slots)
- **Max automations:** 50
- **Overlap policies:** `skip` (drop if already running), `queue` (enqueue behind current),
  `cancel_previous` (abort active run and start new)
- **Missed-fire policy:** `fire_immediately` | `skip` | `fire_once`
  - On startup, automations that missed their window within a 2h threshold are recovered
    with 3s stagger between fires to avoid thundering herd

## Trigger Types

### Heartbeat

Interval-based periodic execution with:

- **Stagger offset:** SHA256-based deterministic offset derived from automation ID, distributes
  timer fires across the interval window to avoid concurrent spikes
- **Active hours:** `HH:MM-HH:MM` window in IANA timezone (e.g. `09:00-17:00` in `America/New_York`).
  Fires outside this window are skipped.
- **Drift correction:** Timers self-adjust to compensate for Node.js event loop drift
- **Modes:** `standard` (run agent with prompt) or `queue_pickup` (process queued items from
  the task queue manager; see [Agent System](agent-system.md))
- **Context:** `fat` (full context) or `thin` (minimal context for cheaper runs)

#### Queue Pickup Mode

When mode is `queue_pickup`, the heartbeat integrates with the task queue manager:

1. `queueProfileId` specifies which profile's queue to drain
2. Uses `getQueuedTasks` / `pickupQueuedTask` from DB operations
3. Builds a prompt via `assembleQueueContext` (thin or fat context)
4. Enqueues with payload `{ source: 'queue_pickup', taskId, prompt }`
5. Execution path uses the payload to build the run prompt

### Cron

Calendar-aligned scheduling:

- **Kinds:** `once` (fire once at specified time), `interval` (recurring fixed interval),
  `cron` (standard cron expression)
- **cronExpr:** Standard 5-field cron expression with timezone support
- **Error backoff:** `[30s, 60s, 300s, 900s, 3600s]` — escalating delays on consecutive errors
- **Min interval:** 60s
- **Max timer:** 60s (Node.js drift prevention — long `setTimeout` values drift significantly)
- **Min refire gap:** 2s (prevents rapid-fire on misconfigured schedules)

### Webhook

External HTTP trigger:

- **Authentication:** Unique slug + bearer token per automation
- **payloadTemplate:** Template for transforming incoming webhook body into agent prompt
- **maxBodyBytes:** 1MB default limit

### Manual

On-demand trigger via API or MCP tool. No scheduling — fires immediately when invoked.

## Delivery System

Results are formatted and delivered to configured channels after passing through empty-result
suppression. Delivery resolves the target plugin via `configId` first (multi-bot precise
lookup), falling back to `getPluginByPlatform(platform)` for legacy single-bot setups.

### configId-Aware Delivery

`AutomationChannelDelivery` includes an optional `configId` field. When present, the delivery
pipeline calls `manager.getPlugin(configId)` directly. When absent, it falls back to
`manager.getPluginByPlatform(platform)` (first running plugin for that platform).

The MCP schedule server's `resolveDeliveryTarget()` copies `configId` from the channel context
into the delivery target when the automation is created from a channel conversation.

### Dedup Window

Delivery includes a 24-hour dedup window using `lastDeliveryHash` and `lastDeliveryAt` on the
automation record. Identical results within the window are suppressed.

Each platform has specific formatting and character limits:

| Platform | Char Limit | Notes               |
| -------- | ---------- | ------------------- |
| Telegram | 4,096      | Markdown formatting |
| Discord  | 2,000      | Markdown formatting |
| Slack    | 3,000      | Block Kit support   |
| Lark     | 30,000     | Markdown formatting |
| Desktop  | 100,000    | SSE event delivery  |

**Format options:** `text`, `markdown`, `summary` (LLM-condensed via Haiku ~$0.001/eval).

Local file paths are stripped before sending to external channels. A metadata footer is
appended with duration, cost, and run count.

### Wake and Success-Notification Controls

Both legacy delivery (`AutomationDelivery`) and channel delivery
(`AutomationChannelDelivery`) support the same notification controls:

| Field                         | Values              | Effect                                                                            |
| ----------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `wakeMode`                    | `always` / `silent` | `silent` keeps successful runs from waking the user while still recording the run |
| `suppressSuccessNotification` | boolean             | Suppresses successful-run notifications without suppressing failures              |

`shouldSuppressSuccessNotification()` treats either `wakeMode: 'silent'` or
`suppressSuccessNotification: true` as a silent successful run. Failures still deliver unless
the delivery target itself is unavailable.

### Empty Result Suppression (3-layer)

Prevents noisy "nothing changed" deliveries:

1. **Hash check (zero cost):** SHA-256 of result compared against `lastDeliveryHash` with
   24h dedup window. Identical results within the window are suppressed.
2. **Structured token:** Agent outputs `@@HEARTBEAT_OK` to signal nothing to report. Token
   is stripped from delivery — never reaches the channel.
3. **Heuristic (after N quiet runs):** After `skipAfterQuietRuns` consecutive quiet runs,
   keyword matching scans for prices, errors, updates, and other significant patterns.

## Condition Evaluation

Three-layer cost-optimized evaluation determines whether a run result is "interesting" enough
to deliver:

1. **Hash check (zero cost):** If the result is identical to the previous result, the condition
   is not satisfied — no delivery.
2. **Keyword heuristic (zero cost, after N quiet runs):** Pattern matching for known
   significant keywords (price changes, error codes, status updates).
3. **LLM Judge (Haiku ~$0.001/eval):** Sends result to Haiku with a JSON response schema
   `{satisfied: boolean, reason: string}`. On failure, fallback assumes the condition is
   satisfied (fail-open to avoid suppressing important results).

## Lifecycle Management

A 60s lifecycle check loop monitors all active automations:

**Auto-disable triggers:**

- Expiry date reached
- `maxRuns` count exceeded
- `costBudget` exhausted
- 5+ consecutive failures

**Global cost budgets:**

- Daily: $10 default
- Monthly: $100 default

**Missed-fire recovery on startup:**

- Threshold: 2h — automations that should have fired within the last 2 hours are recovered
- Stagger: 3s between fires to prevent thundering herd
- Respects `missedFirePolicy` per automation

## Agent Configuration

Each automation configures its agent execution independently:

- `provider` / `model` — which LLM to use
- `usePlanning` — enable extended thinking / planning mode
- `autoApprove` — auto-approve tool use
- `workDir` — workspace directory for file operations
- `timeoutMs` — max execution time (default 10min, max 1h)
- `mcpServers` — MCP servers available to the agent
- `skills` — agent skills to enable

## Templates

8 built-in templates with i18n keys, icons, categories, default schedules, delivery
configuration, optional conditions, and suggested expiry/budgets:

| Template             | Category     | Description                    |
| -------------------- | ------------ | ------------------------------ |
| `daily-news-brief`   | Information  | Daily news summary             |
| `price-monitor`      | Monitoring   | Price change alerts            |
| `ci-cd-status`       | DevOps       | CI/CD pipeline status          |
| `weekly-digest`      | Information  | Weekly activity digest         |
| `pr-review-reminder` | DevOps       | Pending PR review reminders    |
| `dependency-audit`   | DevOps       | Dependency vulnerability audit |
| `daily-standup`      | Productivity | Daily standup preparation      |
| `email-digest`       | Information  | Email summary digest           |

## Delivery Locales

6 locales supported: `en-US`, `zh-CN`, `es-ES`, `fr-FR`, `hi-IN`, `pt-BR`.

Templates cover: run header/footer, expired notification, budget exhausted, error reporting,
condition quiet, automation created, and maxRuns reached messages. Falls back to `en-US`
when the requested locale is unavailable.

## Hooks & Events

Event-driven system for observing automation lifecycle:

**Event types:**

- `run:started`, `run:completed`, `run:failed`, `run:cancelled`
- `run:delivery_suppressed`, `run:condition_not_met`
- `automation:expired`, `automation:budget_exhausted`
- `automation:max_runs_reached`, `automation:consecutive_failures`

**SSE endpoint:** `GET /automation/events` — streams events to the frontend in real time.

## MCP Schedule Server

The schedule MCP server exposes 5 tools for agents to manage automations programmatically:

| Tool               | Rate Limit     | Purpose                      |
| ------------------ | -------------- | ---------------------------- |
| `schedule_create`  | 5/session/hour | Create a new automation      |
| `schedule_list`    | —              | List all automations         |
| `schedule_cancel`  | —              | Cancel/delete an automation  |
| `schedule_toggle`  | —              | Enable/disable an automation |
| `schedule_history` | —              | View run history             |

In channel-routed sessions, creation and management are deliberately separated.
`schedule_create` is gated by ConnectorPolicy via `allowCreate`, so non-admin
channel callers can be denied creation with the canonical connector denial
message. The schedule server is still mounted, and `schedule_list`,
`schedule_cancel`, `schedule_toggle`, and `schedule_history` remain available
for automations owned by the same channel context.

Channel ownership is recorded on automation creation as `originChannel`
(`platform`, `conversationId`, optional `configId`). Management lookups compare
the same platform plus the base conversation id before any `:` thread suffix, so
users in another thread of the same Slack/Discord/Telegram/Lark conversation can
manage that channel's automation without seeing desktop or other-channel
automations. Desktop/no-channel callers keep the admin view over all
automations.

The system prompt teaches agents the distinction between heartbeat and cron, how delivery
resolution works, and the suppress-empty protocol (`@@HEARTBEAT_OK`).

## Source Files

| File                                                   | Purpose                                          |
| ------------------------------------------------------ | ------------------------------------------------ |
| `src-api/src/shared/automation/engine.ts`              | Core engine, queue, run execution                |
| `src-api/src/shared/automation/heartbeat-runner.ts`    | Heartbeat timer management                       |
| `src-api/src/shared/automation/store.ts`               | JSON persistence                                 |
| `src-api/src/shared/automation/lifecycle.ts`           | Auto-disable, cost budgets, missed-fire recovery |
| `src-api/src/shared/automation/delivery.ts`            | Channel delivery + empty suppression             |
| `src-api/src/shared/automation/channel-formatter.ts`   | Platform-specific formatting + chunking          |
| `src-api/src/shared/automation/condition-evaluator.ts` | 3-layer condition evaluation                     |
| `src-api/src/shared/automation/templates.ts`           | Built-in automation templates                    |
| `src-api/src/shared/automation/delivery-locale.ts`     | i18n for delivery messages                       |
| `src-api/src/shared/automation/hooks.ts`               | Event emission system                            |
| `src-api/src/shared/automation/types.ts`               | All type definitions                             |
| `src-api/src/shared/automation/constants.ts`           | Limits and defaults                              |
| `src-api/src/app/api/automation.ts`                    | Hono API routes                                  |
| `src-api/src/shared/mcp/schedule-server.ts`            | MCP tool server                                  |

---

_See also: [Channels](channels.md) · [MCP Integration](mcp.md) · [Agent System](agent-system.md)_
