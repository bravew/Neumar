---
summary: "Autonomous Linear ticket-to-PR pipeline — 15-step multi-agent orchestration, budget controls, agent capabilities, trigger labels, webhook processing, encrypted config, and settings UI"
read_when:
  - Working on the Linear integration
  - Understanding the autonomous pipeline flow
  - Debugging pipeline issues or adding pipeline steps
  - Configuring webhook or polling modes
title: "Linear Pipeline"
---

# Linear Integration & Autonomous Pipeline

The Linear integration enables an autonomous ticket-to-PR workflow. When a Linear ticket
is assigned (via webhook or polling), the pipeline orchestrates the full development lifecycle
without manual intervention until final merge approval.

## Architecture Overview

```
Linear (assigns ticket)
    │
    ├──▶ Webhook POST ──┐
    │                    ▼
    └──▶ Polling Job ──▶ Dedup Check (Linear-Delivery / issueId)
          (dev only)           │
                               ▼
                        Pipeline Queue
                               │
                               ▼
                     Pipeline Orchestrator
                               │
                ┌──────────────┼──────────────────┐
                ▼              ▼                   ▼
          1. Triage      2. Preflight Check   3. Research Phase
          (classify,      (workspace clean?     (detect tech stack,
           build prompt)   branch exists?)       web search best practices)
                                                    │
                                                    ▼
                                             4. Create Branch
                                                (isolated git worktree)
                                                    │
                                                    ▼
                                             5. Plan (Planner agent)
                                                [extended thinking: 10k tokens]
                                                    │
                                                    ▼
                                             6. Confidence Gate
                                                (heuristic score 1-10,
                                                 post plan to Linear,
                                                 wait for approval if < 8)
                                                    │
                                                    ▼
                                             7. Implement (Developer agent)
                                                [timeout: 10min]
                                                    │
                                                    ▼
                                             8. Verify (lint + tsc)
                                                retry loop (max 3)
                                                    │
                                                    ▼
                                             9. Evaluate (Evaluator agent)
                                                [fresh session, autoApprove: false]
                                                    │
                                                    ▼
                                            10. Self-Review (diff stat)
                                                    │
                                                    ▼
                                            11. Create PR (gh cli)
                                                [targeted git add]
                                                    │
                                                    ▼
                                            12. CI Monitor
                                                (poll GitHub Actions every 60s,
                                                 up to 15min, auto-fix on failure)
                                                    │
                                                    ▼
                                            13. PR Review Loop
                                                (poll every 5min,
                                                 up to 24h window,
                                                 max 10 fix iterations)
                                                    │
                                                    ▼
                                            14. Slack Notify
                                                    │
                                                    ▼
                                            15. Update Linear
                                                (status → Done,
                                                 post PR link)

Multi-Repo Decomposition (optional):
  If a ticket spans multiple repositories, the orchestrator splits it
  into up to 5 Linear sub-issues for parallel pipeline runs via
  decomposeMultiRepoIssue().
```

## Service Layer

All services follow the **functional pattern** with module-level state (matching `agent.ts`):

| Service | File | Responsibility |
|---------|------|----------------|
| **Linear Config** | `linear-config.ts` | Encrypted config I/O (AES-256-GCM), PBKDF2 key derivation |
| **Linear Service** | `linear.ts` | SDK client, issue triage, webhook verification, polling, full CRUD, search, comments, relations, labels, attachments, org discovery (teams/users/projects/cycles), file upload (presigned PUT), `ensureAssignedToAgent()` for self-assign |
| **Linear MCP Server** | `mcp/linear-server.ts` | Built-in MCP server exposing 19 Linear tools to agents via `createSdkMcpServer` |
| **Pipeline Index** | `pipeline/index.ts` | Public API re-exports: `enqueue`, `abort`, `cleanup`, `getAll`, `getStatus`, `loadPersistedState`, `shutdownPipelines` |
| **Pipeline Core** | `pipeline/pipeline.ts` | Central state machine, queue management, 15-step orchestration, state persistence to `pipeline-state.json` |
| **Pipeline Orchestrator** | `pipeline/orchestrator.ts` | Higher-level phase wrappers: `runResearchPhase`, `runConfidenceGate`, `runCIMonitorPhase`, `decomposeMultiRepoIssue` |
| **Pipeline Agents** | `pipeline/agents.ts` | PGE (Planner-Generator-Evaluator) role definitions: triage, planner, developer, evaluator, verifier, ci_monitor. `runRoleAgent()` streaming entry point |
| **Pipeline Confidence** | `pipeline/confidence.ts` | Heuristic scorer (base 7, adjustments for tests/CLAUDE.md/description/plan complexity). Posts plan to Linear, polls for approval if score < threshold |
| **Pipeline Research** | `pipeline/research.ts` | Tech stack detection (20+ framework patterns), web search queries, deduplication, returns best practices + doc links |
| **Pipeline Prompts** | `pipeline/prompts.ts` | Prompt templates per ticket type with OWASP ASI01 input sanitization. Builders for verification, self-review, PR review fix, PR body, knowledge block |
| **Pipeline CI** | `pipeline/ci.ts` | `waitForCIChecks()` polls GitHub Actions via `gh api` every 60s for up to 15min. `buildCIFixPrompt()` formats failure logs for agent |
| **Pipeline Hooks** | `pipeline/hooks.ts` | `onPhaseTransition()` fire-and-forget: updates Linear workflow state, posts i18n status comments, writes success/failure memories. Team workflow states cached 10min |
| **Pipeline Progress** | `pipeline/progress.ts` | Writes `.pipeline-progress.json` per worktree. Tracks phase records, classification, plan, confidence, research, evaluator feedback, PR info, blockers. `formatProgressForAgent()` produces context block for stateful handoffs |
| **Pipeline Budget** | `pipeline/budget.ts` | Per-ticket and per-day cost tracking. Persisted daily to `pipeline-budget-YYYY-MM-DD.json` with module-level cache. `checkBudget()` pre-gates enqueue; `recordTicketCost()` accumulates on completion. Stale files cleaned up after 7 days |
| **Pipeline Repo Resolver** | `pipeline/repo-resolver.ts` | `resolveRepoFromTicket()` / `resolveAllReposFromTicket()` extracts GitHub repo coordinates from attachments, description, comments, or `LinearConfig.repoMappings`. Each resolution tagged with `RepoResolutionSource` for audit. Self-healing write-back attaches resolved repo to issue. Capped at 5 repos |
| **Pipeline Repo Config** | `pipeline/repo-config.ts` | `discoverRepoConfig()` pre-reads CLAUDE.md conventions, detects test/lint commands from `package.json`, identifies package manager |
| **Pipeline CLI Dispatch** | `pipeline/cli-dispatch.ts` | `spawnCliEvaluator()` detects installed `claude`/`codex` CLI, spawns via `execFile` (not `exec`) with allowlisted env for process-isolated evaluation |
| **Swarm Task** | `pipeline/swarm-task.ts` | Per-task metadata persistence to `tasks/<taskId>.json` for multi-agent coordination. Parent↔child linking, status polling, CRUD |
| **Git Workspace** | `git-workspace.ts` | Isolated git worktrees: `ensureBaseRepo()`, `createTaskWorktree()` (race-safe), `createTaskWorktreeIsolated()` (with PORT_OFFSET), `initializeWorktreeForClaude()`. Path traversal validation |
| **Slack** | `slack.ts` | Webhook notification with retry/exponential backoff |
| **Task Event Bus** | `task-event-bus.ts` | In-process pub/sub for cross-client task observation via SSE |

## Linear Config & Encrypted Storage

Sensitive fields (`apiKey`, `webhookSecret`, `githubToken`, `slackWebhookUrl`) are encrypted
at rest using **AES-256-GCM** with per-field unique IVs. The encryption key is derived using
async `crypto.pbkdf2()` with SHA-512 digest, 32-byte random salt, and 100,000 iterations.

```
~/.<slug>/linear.enc.json
  ├── Plaintext fields: teamId, assigneeFilter, workspaceDir, ...
  ├── Encrypted fields: { iv, data, tag } for each secret
  ├── _salt: base64-encoded 32-byte salt
  └── _nonce: base64-encoded random nonce (adds entropy)
```

File permissions are set to `0o600` (owner-only) on Unix/macOS.

## Agent Identity & Capabilities

The `LinearConfig` defines the agent's identity and restrictive-by-default capabilities:

**Identity fields:**
- `agentUserId` / `agentName` — auto-populated on first successful connection test via `viewer` query
- `assigneeFilter` — auto-set to agent's user ID if not already configured
- `triggerLabels` — labels that trigger the pipeline (e.g. `"agent-ready"`) — checked alongside assignee filter

**Capability flags** (`AgentCapabilities`):

| Capability | Default | Description |
|-----------|---------|-------------|
| `canCreateBranches` | `true` | Create git branches |
| `canCreatePRs` | `true` | Create pull requests |
| `canMerge` | `false` | Merge PRs automatically |
| `canDeploy` | `false` | Deploy after merge |
| `canCreateSubIssues` | `true` | Create sub-issues for multi-repo |
| `canModifyLabels` | `true` | Add/remove labels on issues |
| `canCloseIssues` | `false` | Close issues directly |
| `maxConcurrentPipelines` | `3` | Max concurrent pipeline runs |

Capabilities are validated at pipeline start via `requireCapability()` — missing capabilities
throw and fail the pipeline immediately.

**Trigger conditions:** Webhooks now check both assignee match AND label match. A ticket is
processed if `assigneeId === agentUserId` OR any issue label matches `triggerLabels`.

## Budget Controls

Per-ticket and per-day cost limits prevent runaway spending:

| Config field | Default | Description |
|-------------|---------|-------------|
| `maxUsdPerTicket` | `$10` | Maximum cost for a single ticket pipeline run |
| `maxUsdPerDay` | `$100` | Maximum total cost across all pipeline runs per calendar day |

Budget is checked pre-enqueue via `checkBudget()` and recorded post-pipeline via
`recordTicketCost()`. Daily budget files (`pipeline-budget-YYYY-MM-DD.json`) are persisted
with module-level caching for hot-path reads. Files older than 7 days are auto-cleaned.

**API endpoint:** `GET /linear/budget` returns today's spending summary with configured limits.

## Forced Approval Categories

The `requireApprovalFor` config array (e.g. `["security", "database", "infra"]`) forces
human approval via Linear comments regardless of confidence score. Matching checks issue
labels, title, and description (case-insensitive substring). When matched, the plan comment
includes a warning note indicating which category triggered the gate.

## Webhook Processing

The webhook endpoint implements defense-in-depth:

1. **IP allowlisting** — rejects requests not from Linear's published IPs
2. **Raw body preservation** — reads via `c.req.text()` before JSON parsing (Hono best practice)
3. **SDK signature verification** — `LinearWebhookClient.verify(body, signature, timestamp)` handles HMAC-SHA256, timing-safe comparison, and replay protection
4. **Idempotency** — TTL-based dedup cache for `Linear-Delivery` header IDs
5. **Trigger matching** — checks assignee match OR trigger label match (rejects if neither)
6. **Async enqueue** — returns 200 immediately, processes asynchronously (Linear 5s timeout)

## Pipeline Orchestration

The pipeline uses `AbortSignal.any()` for combined timeout enforcement (per-phase + total).
State is persisted to `~/.<slug>/pipeline-state.json` on every status change to survive
API server restarts. Pipelines in `awaiting_review` status resume their review loops on restart.

**Pipeline statuses:** `queued` → `preflight` → `triaging` → `researching` → `branching` →
`planning` → `confidence_gate` → `implementing` → `verifying` → `evaluating` →
`self_reviewing` → `creating_pr` → `awaiting_ci` → `awaiting_review` ⇄ `fixing_review` →
`notifying` → `completed` (or `failed` at any step)

**Multi-agent PGE pattern:** The pipeline uses a Planner-Generator-Evaluator pattern with
six specialized agent roles:

| Role | Auto-Approve | Thinking Budget | Purpose |
|------|-------------|-----------------|---------|
| `triage` | yes | — | Classify ticket, extract requirements |
| `planner` | yes | 10k tokens | Analyze codebase, create execution plan |
| `developer` | yes | — | Implement the plan with file changes |
| `evaluator` | **no** | 8k tokens | Independent review in fresh session (process-isolated via CLI dispatch) |
| `verifier` | yes | — | Run lint/tsc with repo-specific commands |
| `ci_monitor` | yes | — | Monitor GitHub Actions, build fix prompts |

**Key design choices:**
- Configurable concurrency limit (`maxConcurrentPipelines`, default 3) with pre-enqueue check
- Budget pre-check on enqueue; cost recorded on completion from progress data
- Isolated git worktrees per pipeline (not shared workspace)
- Research phase gathers tech-stack-specific best practices before planning
- Confidence gate posts plan to Linear and waits for human approval if score < 8
- Evaluator runs in a fresh session with `autoApprove: false` to prevent self-bias
- CLI dispatch (`spawnCliEvaluator`) provides process-level isolation for evaluation
- CI monitor polls GitHub Actions every 60s for up to 15min after PR creation
- Targeted git staging with sensitive file filtering (`.env`, `.key`, `.pem`, etc.)
- HEREDOC-safe commit messages and PR body creation
- Self-review agent runs a diff analysis before PR creation
- PR review loop: polls every 5 min, up to 24h window, max 10 fix iterations
- Phase hooks update Linear workflow state and post i18n status comments automatically
- Progress persistence (`.pipeline-progress.json`) enables stateful handoffs between agents
- Multi-repo decomposition splits cross-repo tickets into up to 5 sub-issues
- Graceful shutdown aborts active pipelines and persists state

## Prompt Engineering & Security

Prompts use clear `<system-instruction>` / `<user-input>` XML delimiters to prevent ticket
content from being interpreted as system-level instructions (OWASP ASI01 mitigation).
Ticket content is sanitized (10,000 char limit) and type-specific prompt templates route
to `buildFeaturePrompt`, `buildBugFixPrompt`, `buildRefactorPrompt`, or `buildChorePrompt`.

Additional prompt builders: `buildVerificationPrompt`, `buildSelfReviewPrompt`,
`buildPRReviewFixPrompt`, `buildPRBody`, `knowledgeBlock`. `gatherTicketContext()` fetches
issue comments, relations, and parent/children from Linear in parallel. Research findings
are appended to prompts via `buildPromptForIssue()`.

## Confidence Gate

The confidence gate evaluates the planner's output using a heuristic scorer:
- Base score: 7
- Adjustments: +1 for repo tests, +0.5 for CLAUDE.md, +0.5 for detailed description,
  +0.5 for lint/test scripts, −1/−2 for high plan step count, −2 for missing plan
- Clamped to [1, 10]

If score < threshold (default 8), `waitForApproval()` posts the plan and risks to Linear
and polls issue comments every 2 minutes for up to 4 hours, recognizing keywords:
`approved`/`lgtm`/`go ahead` or `reject`/`cancel`/`stop`.

Additionally, issues matching `requireApprovalFor` categories always require human approval
regardless of score — the gate returns `approvalReason: "category:<name>"` for audit.

## Research Phase

`conductResearch()` detects the tech stack from `package.json` scripts and directory
structure (20+ framework patterns: Next.js, React, Hono, Tauri, Rust, etc.), builds up
to 3 search queries, calls the multi-provider search router (Tavily/Brave/DuckDuckGo etc.),
and returns up to 8 deduplicated best practices and 5 relevant doc links (capped at 3000
chars total). Falls back gracefully if search is unconfigured.

## Triage Logic

Issue classification follows a priority chain:
1. Check Linear labels for `bug`, `feature`, `chore`, `refactor`
2. Fallback: check title prefix patterns (`fix:`, `feat:`, etc.)
3. Default to `feature` if no match
4. Branch slug: lowercase, strip non-alphanumeric, replace spaces, truncate to 50 chars

## Settings UI (`ConnectorSettings.tsx`)

The connector settings tab provides configuration for three integrations:

| Section | Fields |
|---------|--------|
| **Linear** | API Key (password + show/hide), Webhook Secret, Team ID, Assignee Filter, Trigger Labels, Mode (Webhook/Polling/Both radio), Poll Interval, Workspace Dir, Default Branch, Auto-process toggle, Budget Limits (per-ticket/per-day), Agent Capabilities toggles, Required Approval Categories, Test Connection button (auto-populates agent identity) |
| **GitHub** | Personal Access Token (with "leave empty for gh auth" hint) |
| **Slack** | Enable toggle, Webhook URL, Channel, Send Test Message button |

Toggle fields (`linearEnabled`, `slackEnabled`) are saved to the frontend Settings DB.
All other fields are saved via `POST /linear/config` where the backend encrypts secrets
before writing to disk. Redacted secrets (from `GET /linear/config`) are detected to
prevent overwriting encrypted values with masked strings.

---

*See also: [Security](../security/index.md) · [Pipeline Lifecycle](../data-flow/pipeline-lifecycle.md) · [MCP Integration](mcp.md)*
