# AGENTS.md

Backend module map for DesignMode critique.

- `design-jury.ts` owns run orchestration, transcript persistence, project history, adapter execution, and metrics rollup writes.
- `events.ts` owns the SSE panel-event contract. Keep event additions backward compatible with replayed transcripts.
- `adapters/` owns primary/degraded panelist adapters and the test-resettable registry.
- `conformance/` owns replay fixtures and structured transcript diffs. Do not require live providers in CI.
- `observability/` owns critique telemetry events, metrics rows, and optional tracing.
- `rollout/` owns M-phase settings, resolver, and ratchet decisions.

Validation:

```bash
pnpm script:critique:conformance
pnpm test:api -- src-api/test/unit/services/design-mode-critique.test.ts src-api/test/unit/services/critique-rollout.test.ts
pnpm typecheck:api
```
