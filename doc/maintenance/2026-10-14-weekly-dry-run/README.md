# Weekly maintenance review, 2026-10-14

Dry run of the process in [review-process.md](../review-process.md), produced
against this worktree's checked head. It exercises the report format and records
real check output. It is not a scheduled run; no recurring job exists.

Owner: unassigned. The owner field is defined in
[review-process.md](../review-process.md#cadence-and-owner). This dry run was
produced by an implementing agent, and assigning the recurring owner is a
maintainer decision tracked in [#199](https://github.com/bravew/Neumar/issues/199).
Reviewer: implementing agent for #230.
Head: `d182f23f27100a18066d5804f2ec4f774f41dd98` (`issue/230-weekly-maintenance-review`,
rebased onto `origin/epic/194-maintenance-process`).
Node and pnpm: Node v26.11.1, pnpm 11.22.0. The Node baseline CI uses is 22; see
Unverified.
Previous report: none. This is the first run, so every trend is a baseline.

## Comparability with the earlier review

The earlier review was measured at `c0926618`. This head differs from it only in
tracked documentation: `git diff --stat c0926618 HEAD -- src src-api packages`
is empty, so the source, API, and shared-package trees are byte-identical. The
warning counts, allowlist entries, suppression counts, orphan candidates, and
migration files below are therefore directly comparable to the baseline. No
product behavior changed between the two heads.

## Check outcomes

Every command below was run in this worktree on the head above. The exit code and
counts are the real output.

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm validate` | Pass, exit 0 | Emitted 453 frontend lint warnings and 0 lint errors. All sub-checks passed: brand, critique-i18n, locale parity, design-system flags, design media catalog, uuid routing, ag-ui version (0.0.59 lockstep), plugin registry (226 entries), HyperFrames skill, FFmpeg skill (2.4.2, 42 tools), HyperFrames upgrade check, frontend and API typecheck, root and API format, component size (897 files scanned, 68 allowlisted). The HyperFrames upgrade check reports an available update 0.8.80 to 0.8.155 and changed no files. |
| `pnpm test:fast` | Fail, exit 1 | Frontend: 399 files, 1776 tests, all passed. API: 2 failed, 593 passed, 3 skipped files; 2 failed, 3859 passed, 7 skipped tests. Both failures are detailed below. |
| `pnpm --filter neumar-api lint` | Pass, exit 0 | 10 warnings, 0 errors. |
| `pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit` | Pass, exit 0 | Includes API test files. |
| `pnpm lint` (frontend) | Pass, exit 0 | 453 warnings, 0 errors. |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked` | Fail, exit 101 | Failed in the `neumar` build script because the sidecar resource `src-api/dist/neumar-api-aarch64-apple-darwin` does not exist. This is a missing build artifact, not a source defect; see Unverified. |

### `pnpm test:fast` failures

1. `test/unit/agent-runtimes/resolve.test.ts` line 251, "resolves
   npm-installed OpenCode through the shared extended PATH". This is the known
   test-isolation failure tracked in [#195](https://github.com/bravew/Neumar/issues/195)
   and named in [LESSONS.md](../../../LESSONS.md). The resolver finds the host's
   Homebrew OpenCode before the temporary npm fixture. It reproduces on this host
   because Homebrew OpenCode is installed.
2. `test/unit/plugins/loader.test.ts`, "invalidates loader generation when
   watched skill files change". The failure is `Error: Hook timed out in
   30000ms` in the file's `afterEach`, which tears down the plugin hot-reload
   watcher. Re-running the file alone passed: 7 tests passed in 22.00s. This is a
   load-sensitive timing failure under the full parallel run, not a reproduction
   in isolation. It is a new observation with no tracking issue, and it is
   selected for a bounded cleanup pull request below. It is not the `#195`
   failure and should not be reported as one.

## Findings

Severity follows the earlier review: P0 urgent containment, P1 fix before
expanding the affected feature, P2 planned cleanup. A finding carried from the
earlier review names its source review and commit.

| ID | Surface | Finding | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| W1 | New warnings and suppressions | The frontend warning baseline is unchanged at 453, but 28 `eslint-disable-next-line` directives exist under `src/`, of which 25 suppress `react-hooks/exhaustive-deps`. API code adds 71 more, and 5 `@ts-expect-error` directives exist. No new suppression was introduced in this window. | `pnpm lint`, `grep -rn eslint-disable-next-line src/` | unassigned | Open, carried from the 2026-10-13 review |
| C1 | Size ceilings | The allowlist still holds 68 entries and no ceiling changed in this window. Nine entries are obsolete: the file is at or below the 350-line default, so the allowance is unnecessary. | `scripts/component-size-allowlist.json`; `node scripts/check-component-size.mjs` | unassigned | Open, carried from the 2026-10-13 review; tracked in [#217](https://github.com/bravew/Neumar/issues/217) |
| O1 | Orphan candidates | Four API modules named in the earlier review remain present with no importer found by exact-path search: `extensions/mcp/sandbox-server.ts`, `core/config/hierarchy.ts`, `shared/services/pipeline/cli-dispatch.ts`, `shared/services/video-analysis.ts`. This run confirmed the absence of importers, not their removal. | `grep -rn` for each path under `src-api/src` | unassigned | Open, carried from the 2026-10-13 review; tracked in [#218](https://github.com/bravew/Neumar/issues/218) |
| U1 | Unsupported surfaces | The chat plugin apply route returns 501, and the memory extract and consolidate routes return 501. All three messages are truthful and direct callers elsewhere. Both `/task/:taskId` and `/task-v2/:taskId` remain mounted, and both settings shells remain live. No change in this window. | `src-api/src/app/api/plugins.ts:330`, `src-api/src/app/api/memory.ts:497`, `:524`, `src/app/router.tsx:57,65` | unassigned | Open, carried from the 2026-10-13 review; tracked in [#223](https://github.com/bravew/Neumar/issues/223) |
| M1 | Migrations | The migrations directory holds 60 files: 58 numbered migrations plus `runner.ts` and `utils.ts`. None changed in this window. The migration-drift finding from the earlier review is unchanged and still needs the full-registry run against fresh, current, and drifted snapshots. | `git diff c0926618 HEAD -- src-api/src/shared/db` is empty | unassigned | Open, carried from the 2026-10-13 review; tracked in [#225](https://github.com/bravew/Neumar/issues/225) |
| S1 | Security | The P0 daemon binding finding is unchanged and unfixed. The default listener still omits `hostname`, and privileged routes are reachable without JWT unless `WEBUI_AUTH=true`. | `src-api/src/http-daemon.ts:478`, `src-api/src/app/middleware/jwt.ts:12`, `src-api/src/app/api/sandbox.ts:179` | unassigned | Open, carried from the 2026-10-13 review; tracked in [#200](https://github.com/bravew/Neumar/issues/200) |
| S2-S9 | Security | The remaining security findings S2 through S9 are unchanged. The source trees are identical to the reviewed baseline, so none has been fixed. | [01-findings.md](../2026-10-13-regression/01-findings.md) | unassigned | Open, carried from the 2026-10-13 review; tracked in [#201](https://github.com/bravew/Neumar/issues/201) to [#207](https://github.com/bravew/Neumar/issues/207) |
| R1-R6 | Unresolved regressions | All six regressions from the earlier review are unchanged. R6 (the `resolve.test.ts` isolation bug) reproduced in this run. | `pnpm test:fast`; [01-findings.md](../2026-10-13-regression/01-findings.md) | unassigned | Open, carried from the 2026-10-13 review; tracked in [#211](https://github.com/bravew/Neumar/issues/211) to [#216](https://github.com/bravew/Neumar/issues/216) and [#195](https://github.com/bravew/Neumar/issues/195) |
| T1 | Unresolved regression (new) | The plugin loader test times out under the full parallel run and passes alone. This is a load-sensitive timing assumption a user meets on a busy machine, and it is the class [LESSONS.md](../../../LESSONS.md) calls out. | `pnpm test:fast` (2 failed), isolated `pnpm test:api test/unit/plugins/loader.test.ts` (7 passed, 22.00s) | unassigned | New, observed in this run |
| E1 | Expired exceptions | No exception registry exists yet. Exceptions are named in the earlier review's findings, but none carries an owner, a reason, and an expiry in a machine-readable place, so none can be listed as expired. | [review-process.md](../review-process.md#review-scope) surface 8 | unassigned | New, observed in this run |

## Metrics

The previous column is the value the 2026-10-13 review recorded, carried from
[README.md](../2026-10-13-regression/README.md) and
[03-lessons-and-contributors.md](../2026-10-13-regression/03-lessons-and-contributors.md).
This run is the baseline for the metrics the earlier review did not record.

| Metric | This run | Previous | Trend |
| --- | ---: | ---: | --- |
| Escaped regressions introduced since the last report | 1 (T1, new) | 6 (R1 to R6) | Baseline. R1 to R6 predate this run and are not counted again. |
| Time to repair, escaped regressions closed since the last report | Not applicable, none closed | R6 introduced `83c425bb`, still open | Baseline. R6 has been open since the initial snapshot. |
| Required-check execution on merged heads | Not measured. No merges in the window, and the CI job conditions were read rather than exercised. | 77 of 84 merged PRs never ran the automatic quality and test jobs | Unchanged by this run. The `quality` and `test` jobs in `.github/workflows/ci.yml` still require a `release/` or `release-v` head or a manual dispatch. |
| Unresolved P0 findings | 1 (S1) | 1 (S1) | No change. |
| Unresolved P1 findings | 9 (S2, S3, S4, S5, S6, S7, S9, R1, R3) | same set | No change. Source trees are identical to the baseline. |
| Expired exceptions | 0, because no registry exists | not recorded | Baseline. |

Deletion count is not a metric and is not recorded.

## Cleanup selected

These are the bounded cleanup pull requests this run selects. Each names one
finding and the check that will show the change. None is started by this report.

| Scope | Finding | Closing check |
| --- | --- | --- |
| Isolate the plugin hot-reload teardown in `src-api/test/unit/plugins/loader.test.ts` so the watcher closes within the hook timeout, and assert the watcher stops deterministically instead of relying on a 30s hook budget. | T1 | `pnpm test:api test/unit/plugins/loader.test.ts` passes, and `pnpm test:fast` shows no hook timeout. |
| Remove the nine obsolete allowlist entries whose files already fit the 350-line default. | C1 | `pnpm check:component-size` passes with 59 allowlisted entries. |
| Remove one proven API orphan, starting with the smallest, after an exact-path caller search across the workspaces and the CLI and plugin entry points. | O1 | `pnpm --filter neumar-api lint`, API typecheck, and the affected API tests pass. |

The other findings are carried, not selected this run. S1 remains the highest
priority and is already tracked in [#200](https://github.com/bravew/Neumar/issues/200).

## LESSONS.md

No change. This run found no failure pattern that is not already a lesson. The
two failures it observed map to existing rules: the `resolve.test.ts` failure is
the "test isolation: stub the seam, not the environment" lesson, and the plugin
loader timeout is the "a red under load is a timing assumption a user will meet
on a busy machine" clause of the "when a check fails in your area, fix it or file
it" lesson. Neither adds a new pattern, so neither "Seen" count is incremented
here; incrementing requires a review day, and this is a dry run.

The promoted lesson, seen on three review days and moved to
[AGENTS.md](../../../AGENTS.md), is the same process the runbook defines. This dry
run is the first review day for the new process itself, so nothing is promoted
yet.

## Unverified

- **Node 22 baseline.** This run used Node v26.11.1, the same local runner the
  earlier review used. CI uses Node 22. The `resolve.test.ts` and plugin loader
  failures were not reproduced under Node 22.
- **`cargo check`.** The command failed in the Tauri build script because the
  sidecar resource `src-api/dist/neumar-api-aarch64-apple-darwin` is absent. The
  Rust source was not checked. Producing that artifact needs the API binary build
  step, which was not run. This is not evidence of a Rust defect.
- **Browser end-to-end tests.** `pnpm test:e2e:browser` was not run. It starts its
  own API and a browser, and no browser scenario was in scope for a
  documentation change.
- **Gate evals.** `pnpm test:gate` was not run. It needs `EVALS_TIER=gate` and
  the eval fixtures, and no eval surface changed.
- **Live providers and packaged desktop.** No provider credentials were used and
  no packaged build was produced, so no live-provider or desktop behavior is
  verified.
- **Required-check execution on merged heads.** Read from
  `.github/workflows/ci.yml` job conditions, not exercised against a pull request
  in this window. The metric is carried from the earlier review, not re-measured.
- **Exception registry.** No machine-readable exception registry exists, so the
  expired-exception metric cannot be measured beyond "none recorded".
- **Link check.** Every relative link in the runbook and this report was resolved
  against the checkout by hand; no automated link checker was run.

## Scheduling

Scheduling the review is a separate maintainer decision and is not live. No
workflow, cron, or external job runs this process. This report is a manual dry
run.
