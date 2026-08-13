---
summary: "Autonomous Linear-to-PR pipeline data flow — 15-step multi-agent orchestration, PGE pattern, confidence gate, CI monitoring, persistence, and timeout enforcement"
read_when:
  - Understanding the autonomous pipeline end-to-end flow
  - Debugging pipeline state transitions
  - Working on pipeline persistence or resumability
title: "Pipeline Lifecycle"
---

# Autonomous Pipeline Lifecycle

The Linear-to-PR pipeline operates independently of the UI, running entirely on the backend.
It uses a Planner-Generator-Evaluator (PGE) pattern with six specialized agent roles running
in isolated git worktrees.

```
Linear Webhook / Poller
    │
    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                              │
│                                                                      │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │Preflight│─▶│ Triage  │─▶│  Research    │─▶│  Create Branch   │  │
│  │ (git    │  │(classify│  │ (tech stack  │  │  (isolated git   │  │
│  │  clean?)│  │  issue) │  │  detection,  │  │   worktree)      │  │
│  └─────────┘  └─────────┘  │  web search) │  └────────┬─────────┘  │
│                             └──────────────┘           │            │
│                                                        ▼            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Plan (Planner agent, extended thinking: 10k tokens)         │   │
│  │  → Confidence Gate (heuristic score 1–10)                    │   │
│  │    • score ≥ 8 → proceed automatically                       │   │
│  │    • score < 8 → post plan to Linear, wait for approval      │   │
│  │      (poll comments every 2min, up to 4h)                    │   │
│  └──────────────────────────────────────┬───────────────────────┘   │
│                                          │                          │
│  ┌──────────────────┐  ┌────────────────▼───────────────────────┐  │
│  │ Evaluate          │◀─│  Implement (Developer agent)           │  │
│  │ (Evaluator agent, │  │  [timeout: 10min]                      │  │
│  │  fresh session,   │  └────────────────────────────────────────┘  │
│  │  CLI-isolated)    │                                              │
│  └────────┬──────────┘                                              │
│           │                                                          │
│  ┌────────▼─────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Verify (lint+tsc)│─▶│ Self-Review  │─▶│  Create PR           │  │
│  │ retry loop       │  │ (diff review │  │  (gh pr create)      │  │
│  │ (max 3)          │  │  agent pass) │  │  [targeted git add]  │  │
│  └──────────────────┘  └──────────────┘  └──────────┬───────────┘  │
│                                                      │              │
│  ┌──────────────────────────────────────────────────▼────────────┐ │
│  │                CI Monitor                                      │ │
│  │  Poll GitHub Actions every 60s, up to 15min                   │ │
│  │  • All checks pass → proceed to review loop                   │ │
│  │  • Checks fail → build fix prompt → agent fixes → re-push    │ │
│  └──────────────────────────────────────────────────┬────────────┘ │
│                                                      │              │
│  ┌──────────────────────────────────────────────────▼────────────┐ │
│  │                PR Review Loop                                  │ │
│  │  Poll every 5min, up to 24h window                            │ │
│  │  • Detect new comments/reviews via gh API                     │ │
│  │  • If feedback → agent fixes → commit → push                 │ │
│  │  • If approved → break                                        │ │
│  │  • Max 10 fix iterations                                      │ │
│  └──────────────────────────────────────────────────┬────────────┘ │
│                                                      │              │
│  ┌──────────┐  ┌──────────────┐                      │              │
│  │ Slack    │◀─│ Update       │◀─────────────────────┘              │
│  │ Notify   │  │ Linear       │  Pipeline state persisted           │
│  │          │  │ (→ Done)     │  to ~/.<slug>/                      │
│  └──────────┘  └──────────────┘  pipeline-state.json                │
│                                   at every status change            │
│                                                                      │
│  Phase hooks: onPhaseTransition() updates Linear workflow state,    │
│  posts i18n status comments, writes memories on success/failure     │
└──────────────────────────────────────────────────────────────────────┘

Multi-Repo Decomposition (optional):
  decomposeMultiRepoIssue() splits a cross-repo ticket into up to 5
  Linear sub-issues for parallel pipeline runs. Repo coordinates are
  resolved from attachments, description, comments, or config mappings.
```

## Agent Roles (PGE Pattern)

| Role | Session | Auto-Approve | Thinking | Purpose |
|------|---------|-------------|----------|---------|
| Triage | shared | yes | — | Classify, extract requirements |
| Planner | shared | yes | 10k tokens | Analyze codebase, create plan |
| Developer | shared | yes | — | Implement the plan |
| Evaluator | **fresh** | **no** | 8k tokens | Independent code review (CLI-isolated) |
| Verifier | shared | yes | — | Run repo-specific lint/test |
| CI Monitor | shared | yes | — | Poll CI, build fix prompts |

## Persistence & Resumability

Pipeline state is written to disk on every status transition. On API server restart,
`loadPersistedState()` restores all pipeline states and resumes review loops for any
pipelines that were in `awaiting_review` status.

Per-worktree progress is persisted to `.pipeline-progress.json`, tracking phase records
with duration/cost, classification, plan, confidence score, research findings, evaluator
feedback, PR info, and blockers. `formatProgressForAgent()` injects this context into
each agent's prompt, enabling stateful handoffs across the PGE cycle.

## Timeout Enforcement

Each agent phase gets a combined `AbortSignal.any()` that fires if either the parent
pipeline abort controller or the per-phase timeout (10 min) triggers. The total pipeline
timeout is 60 minutes. The confidence gate has its own 4-hour approval timeout. The CI
monitor polls for up to 15 minutes.

---

*See also: [Linear Pipeline](../backend/linear-pipeline.md) · [Task Lifecycle](task-lifecycle.md) · [Security](../security/index.md)*
