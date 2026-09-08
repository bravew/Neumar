# Video Mode reference upgrade plan

Date: 2026-09-08
Revision: 2 (2026-09-08, grounding pass)
Status: approved scope, ready to begin Phase 0
Baseline: Neumar `dca3854`

## Revision 2 changes

Every factual claim below was re-checked against the working tree, the npm
registry, the Remotion release notes, and the reference checkouts in `_sample/`.
What changed:

- Corrected the Remotion changelog attribution. The 5.1 downmix fix is in
  4.0.519, not 4.0.516, and 4.0.519 was missing from the version list.
- Added the concrete dependency alignment for Phase 1: `@remotion/media@4.0.522`
  depends on `mediabunny@1.55.5` and `zod@4.5.4`; the repo pins `mediabunny`
  at `1.55.2` and `zod` at `^4.4.3`.
- Sharpened the save-conflict finding. It is worse than "no expected revision":
  `projectDocumentForWrite()` silently renumbers a stale write to
  `persisted.revision + 1`, and `PATCH /projects/:id/timeline` is the only
  timeline mutation route that does not take `withProjectLock()`.
- Recorded that two independent in-process serialization maps exist and do not
  see each other.
- Replaced `pnpm -C src-api exec vitest` in every verification block. That form
  skips the `@neumar/video-ir` build that `src-api` tests depend on.
- Verified the HyperFrames `data-volume` claim in the shipped runtime and
  pointed it at the exact line of Neumar's bundled skill that is now wrong.
- Added the repo conventions the plan had omitted: the 350-line component cap,
  `oxfmt`, locale parity, and the flag-registration contract.

## Outcome

This plan improves Video Mode without reopening work that already landed in the
August upgrade cycle. It has seven independently verifiable phases:

1. Close the outstanding acceptance evidence and add reusable benchmark fixtures.
2. Upgrade Remotion and HyperFrames behind compatibility tests.
3. Add explicit project timebase controls and non-destructive In/Out export.
4. Make the timeline scale to large edits with measured rendering budgets.
5. Add project-level recovery, conflict handling, and media-health checks.
6. Build the multicamera data, synchronization, and analysis foundation.
7. Add multicamera review, agent tools, timeline application, and interchange.

The plan treats multicamera editing as the main new product capability. The
other phases strengthen foundations that multicamera projects will stress:
fractional frame rates, many clips, long-running analysis, external masters,
save conflicts, and reviewable agent edits.

## Why this is the next useful increment

Neumar already contains most of the capabilities proposed on 2026-08-22:

- Remotion canvas effects and `@remotion/media`
- HyperFrames rendering and Studio selection context
- beat analysis and beat-grid snapping
- durable agent plans, execution logs, resume, and reconciliation
- external-master reference, relink, and consolidation
- server-backed Video Agent conversation history
- rational frame-rate primitives
- row-virtualized timeline rendering

The current references therefore do not justify another broad feature import.
They point to four specific gaps:

- OpenReel added a complete multicamera workflow after the prior review.
- Neumar can represent a rational frame rate but does not let the user choose
  and lock the project timebase.
- Neumar has timeline undo and atomic `project.json` replacement, but no
  project-version browser or safe recovery path for cross-tab save conflicts.
- Neumar virtualizes rows while still mounting every clip in a visible row as a
  DOM component. Large multicamera edits need a measured clip-rendering budget.

## Documents

| File | Purpose |
| --- | --- |
| [`01-current-state-and-delta.md`](01-current-state-and-delta.md) | Audited Neumar baseline, package delta, and unfinished prior commitments |
| [`02-reference-findings.md`](02-reference-findings.md) | Findings from OpenReel, OpenMontage, OpenCut, and video-studio |
| [`03-gap-priority-matrix.md`](03-gap-priority-matrix.md) | Adopt, adapt, defer, and reject decisions with priority and dependency |
| [`04-implementation-plan.md`](04-implementation-plan.md) | Seven implementation checkpoints with files, results, tests, and rollback boundaries |
| [`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md) | Product decisions, throughput analysis, flags, fixtures, telemetry, and release gates |

## Reference baselines

| Repository | Audited HEAD | Date | Change since 2026-08-22 |
| --- | --- | --- | --- |
| Neumar | `dca3854` | 2026-09-04 | Durable Video plans and inbound MCP landed after the prior review |
| OpenMontage | `08e2151` | 2026-09-05 | Documentation showcase only |
| OpenCut | `400f097` | 2026-08-01 | None. The repository is an early rewrite scaffold |
| openreel-video | `5f3c85e` | 2026-08-29 | 259 files, +17,203/-7,843 lines, led by multicamera editing |
| video-studio | `05cec08` | 2026-07-06 | None. Used as an additional architecture reference |

All five HEADs were re-confirmed with `git log -1` in `_sample/` on 2026-09-08.
The openreel diffstat (`git diff --shortstat 2566c34..5f3c85e`) reports exactly
259 files, 17,203 insertions, and 7,843 deletions.

## Repository conventions this plan must obey

These are Neumar rules, not reference-repo ideas. Revision 1 did not state them
and several checkpoints add UI that would trip them.

| Rule | Enforcement |
| --- | --- |
| React components stay at or below 350 lines | `pnpm check:component-size` inside `pnpm validate` |
| Run `npx oxfmt <file>` after editing any `src/` file | `pnpm format:check` inside `pnpm validate` |
| Every user-visible string lands in all six locales | `pnpm check:locale-parity`; Video strings live in `src/config/locale/messages/<lang>/video.ts` |
| Backend logging uses `createLogger()`, never `console.*` | oxlint config in `src-api/.oxlintrc.json` |
| Backend workspace root comes from `getSetting('workDir')`, never `process.cwd()` | convention; applies to every new snapshot, fixture, and multicamera path |
| Every Video agent tool carries permission and cost metadata | `src-api/src/extensions/agent/video/permissions.ts:208` throws `Video tool "X" has no permission metadata.` |
| New feature flags are added to both the `VideoFeatureFlag` union and `VIDEO_FEATURE_FLAG_DEFAULTS` | `src-api/src/shared/video/flags.ts`; the `satisfies Record<VideoFeatureFlag, boolean>` makes an omission a type error |

The multicamera setup and review panels in Phase 6 are the most likely to exceed
the component-size cap. Plan their sub-component split before writing them.

## Baseline verification

The Graphify knowledge graph that `CLAUDE.md` and `AGENTS.md` point at
(`graphify-out/`) is not present in the working tree, so this audit used source,
tests, runbooks, and Git history.

The following focused baseline suites passed on 2026-09-08 and were re-run
unchanged during the revision-2 grounding pass:

```text
Frontend timeline/UI: 3 files, 15 tests
Video IR package:      16 files, 140 tests
API video subset:       6 files, 20 tests
```

Commands:

```bash
pnpm vitest run \
  src/__tests__/video/timelineMath.test.ts \
  src/__tests__/video/timelinePlacement.test.ts \
  src/__tests__/video/timelineUndoArbitration.test.ts

pnpm -C packages/video-ir test

# src-api resolves @neumar/video-ir through its built `lib/` output, so the
# package must be rebuilt before any API subset run that follows a video-ir
# change. `pnpm test:api` does this through `pretest:api`; a subset run does not.
pnpm --filter @neumar/video-ir build
pnpm vitest run --config src-api/vitest.config.ts \
  test/integration/video-agent-history-routes.test.ts \
  test/integration/video-timeline-route.test.ts \
  test/unit/video/project-lock.test.ts \
  test/unit/video/proxy.test.ts \
  test/unit/video/render-plan.test.ts \
  test/unit/video/webcodecs-renderer.test.ts
```

### Command correction

Revision 1 used `pnpm -C src-api exec vitest run`. That form works but is wrong
for this repository: it bypasses the `@neumar/video-ir` build step, so an API
test run after a Phase 2 or Phase 5 IR change silently tests the previously
built `packages/video-ir/lib/`. Every verification block in
[`04-implementation-plan.md`](04-implementation-plan.md) now uses the root
`pnpm vitest run --config src-api/vitest.config.ts` form, preceded by the build
when the checkpoint touches `packages/video-ir/`.

## Recommended product decisions

The approved decisions and defaults used in the plan are:

- Commit all seven phases, including multicamera analysis and editing, to this
  cycle.
- Support and performance-gate Apple Silicon Macs only for this cycle.
- Ship project timebase and In/Out export before multicamera work.
- Support `24`, `25`, `30`, `50`, `60`, `24000/1001`, `30000/1001`, and
  `60000/1001`. Keep drop-frame timecode display out of the first increment.
- Store project revisions locally under the project directory. Do not add a
  cloud database dependency.
- Use Neumar's existing timeline IR for multicamera output. Keep analysis and
  candidate plans as separate artifacts until the user applies them.
- Keep a multicamera wide shot mandatory for automatic editing, matching the
  safe fallback used by OpenReel.
- Do not adopt OpenCut's Rust rewrite, OpenReel's universal-track migration, or
  video-studio's cloud infrastructure as part of this plan.

## Readiness

All seven phases are committed to this cycle and are concrete enough to execute
one checkpoint at a time. The remaining questions in
[`05-open-questions-and-rollout.md`](05-open-questions-and-rollout.md) retain
their recommended defaults unless the product owner revises them before the
affected phase begins.
