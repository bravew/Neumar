# Test Coverage Analysis

**Date:** 2026-03-08
**Current state:** 5 test files, 18 passing tests (4 frontend, 14 backend)

---

## Current Coverage Summary

| Layer | Source Files | Test Files | Tests | Coverage |
|-------|-------------|------------|-------|----------|
| Frontend (`src/`) | ~171 | 1 | 4 | <1% |
| Backend (`src-api/`) | ~201 | 4 | 14 | ~2% |
| **Total** | **~372** | **5** | **18** | **~1%** |

### What's Currently Tested

| Test File | What It Covers |
|-----------|---------------|
| `src/__tests__/components/ChatInput.test.tsx` | Basic render, placeholder, button states |
| `src-api/test/integration/api/health.test.ts` | Health endpoint (status, timestamp, uptime, memory) |
| `src-api/test/integration/api/providers.test.ts` | Provider listing (agents, sandbox) |
| `src-api/test/integration/google-server.test.ts` | Google MCP server init & scope-based tool filtering |
| `src-api/test/e2e/api-lifecycle.e2e.test.ts` | Health, providers, concurrent requests, 404 handling |

### What's Not Tested

**Frontend:** 170 out of 171 source files have zero tests — all pages, all hooks, all shared utilities, all components except ChatInput.

**Backend:** ~191 out of 201 source files have zero tests — 15 of 17 API routes, the entire agent core, sandbox system, all services, all channel adapters.

---

## Recommended Improvements (Priority Order)

### 1. Backend Utility Functions (High impact, low effort)

Pure functions that are easy to test and reduce regression risk.

**Files:**
- `src-api/src/shared/utils/url-validator.ts` — SSRF protection is security-critical
- `src-api/src/shared/utils/path-validator.ts` — workspace confinement is security-critical
- `src-api/src/shared/utils/limited-set.ts` — data structure correctness
- `src-api/src/shared/utils/provider-headers.ts` — header construction for upstream APIs
- `src-api/src/shared/services/pricing.ts` — cost calculation correctness
- `src-api/src/shared/services/slack-format.ts` — message formatting logic

**Why:** These are pure or near-pure functions with clear inputs/outputs. Testing them catches edge cases in security boundaries and data transformation without needing mocks.

### 2. Core Agent System (High impact, medium effort)

The agent system is the backbone of the product — untested changes here risk breaking all agent interactions.

**Files:**
- `src-api/src/core/agent/base.ts` — BaseAgent lifecycle (init, execute, cleanup)
- `src-api/src/core/agent/registry.ts` — agent registration and lookup
- `src-api/src/core/agent/plugin.ts` — plugin loading
- `src-api/src/core/plan-manager.ts` — plan creation, approval, execution flow
- `src-api/src/core/session-manager.ts` — session lifecycle

**Why:** A regression in the agent core silently breaks every agent type. The existing `mock-llm.ts` and `mock-mcp.ts` helpers already support this kind of testing.

### 3. API Route Integration Tests (High impact, medium effort)

Only 2 of 17 API routes have integration tests. The Hono `app.request()` pattern used in existing tests makes this straightforward.

**Priority routes:**
- `src-api/src/app/api/agent.ts` — the primary user-facing endpoint (plan/execute)
- `src-api/src/app/api/files.ts` — file operations (workspace confinement matters)
- `src-api/src/app/api/auth.ts` — authentication flow
- `src-api/src/app/api/db.ts` — database operations (data integrity)
- `src-api/src/app/api/mcp.ts` — MCP server management
- `src-api/src/app/api/automation.ts` — scheduled task execution

**Why:** API routes are the contract between frontend and backend. The existing test infrastructure (`test/helpers/db.ts`, `test/helpers/fixtures.ts`) already supports building app instances for testing.

### 4. Automation & Scheduling Engine (High impact, medium effort)

The automation system runs tasks without user supervision — bugs here execute silently.

**Files:**
- `src-api/src/shared/automation/engine.ts` — automation execution
- `src-api/src/shared/automation/cron-service.ts` — cron scheduling correctness
- `src-api/src/shared/automation/webhook-handler.ts` — webhook trigger processing
- `src-api/src/shared/automation/delivery.ts` — result delivery
- `src-api/src/shared/automation/store.ts` — automation state persistence

**Why:** Scheduled/automated operations have no immediate user feedback loop, so bugs persist longer. Cron parsing and webhook validation are particularly testable.

### 5. Gateway Channel Adapters (Medium impact, medium effort)

The gateway bridges the agent to external messaging platforms — each adapter has platform-specific formatting and parsing.

**Key files:**
- `src-api/src/shared/services/gateway/core/command-parser.ts` — command parsing logic
- `src-api/src/shared/services/gateway/core/message-router.ts` — routing decisions
- `src-api/src/shared/services/gateway/shared/auth/rate-limiter.ts` — rate limiting
- `src-api/src/shared/services/gateway/shared/auth/permission-gate.ts` — access control
- `src-api/src/shared/services/gateway/channels/telegram/formatter.ts` — message formatting
- `src-api/src/shared/services/gateway/channels/discord/formatter.ts` — message formatting

**Why:** Each channel has unique constraints (message length limits, formatting rules, rate limits). Unit tests on formatters and parsers prevent platform-specific regressions.

### 6. Frontend Shared Hooks (Medium impact, medium effort)

Hooks contain the core frontend business logic — they're more testable than UI components and higher-value.

**Files:**
- `src/shared/hooks/useAgent.ts` — the primary hook driving task interaction
- `src/shared/hooks/agent-utils.ts` — message parsing, stream handling
- `src/shared/hooks/agent-messages.ts` — message state management
- `src/shared/hooks/useAutomation.ts` — automation CRUD
- `src/shared/hooks/usePermissions.ts` — permission checking
- `src/shared/lib/markdown-utils.ts` — markdown processing
- `src/shared/lib/utils.ts` — general utilities

**Why:** Hooks encapsulate async logic, state transitions, and data transformations that are prone to stale closure bugs (noted in CLAUDE.md). Testing with `renderHook` catches these issues.

### 7. Memory Service (Medium impact, high effort)

The memory system handles embedding, retrieval, and session indexing — correctness matters for recall quality.

**Files:**
- `src-api/src/shared/services/memory/retriever.ts` — similarity search
- `src-api/src/shared/services/memory/capturer.ts` — memory extraction
- `src-api/src/shared/services/memory/store.ts` — persistence
- `src-api/src/shared/services/memory/recall.ts` — contextual recall

**Why:** Memory retrieval bugs degrade agent quality silently. The retriever and capturer have testable logic around scoring and filtering.

### 8. Frontend Page & Component Tests (Lower priority)

Page-level tests are valuable but require more setup (routing, providers, mocks).

**Start with:**
- `src/components/task/MessageList.tsx` — the primary chat display
- `src/components/task/MessageItem.tsx` — individual message rendering
- `src/components/home/TaskInput.tsx` — task creation flow
- `src/components/automation/AutomationCard.tsx` — automation display
- `src/app/pages/Home.tsx` — main entry page

**Why:** These are user-facing components where visual regressions matter, but the ROI per test is lower than hooks and utilities since they require extensive mocking of providers and routing.

---

## Infrastructure Observations

**Strengths:**
- Good test helper infrastructure already exists (`mock-llm.ts`, `mock-mcp.ts`, `fixtures.ts`, `db.ts`, `spawn-api.ts`)
- Vitest configured with v8 coverage provider
- Backend has coverage thresholds set (70% lines — currently not met)
- E2E framework is in place with server spawning and SSE collection
- Frontend has Tauri mocks ready for component testing

**Gaps:**
- No CI coverage reporting (no coverage directory checked in)
- Backend coverage thresholds (70%) are aspirational — actual coverage is ~2%
- No snapshot tests for complex rendered output
- No contract/schema tests for API request/response shapes
- No tests for error paths (network failures, invalid input, timeout handling)

---

## Suggested Quick Wins (< 1 day each)

1. **URL validator tests** — 10-15 test cases covering private IP blocking, HTTPS enforcement, edge cases
2. **Path validator tests** — directory traversal prevention, workspace confinement
3. **Pricing service tests** — token counting and cost calculation
4. **Cron service tests** — cron expression parsing and next-run calculation
5. **Command parser tests** — gateway command parsing and routing
6. **Rate limiter tests** — token bucket / sliding window correctness
7. **Fixture-based API route tests** — use existing helpers to test agent, files, and db routes
