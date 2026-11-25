# Feature slice delivery and integrated-head verification

Status: contract, scope enforcement, and tests. **The live GitHub App
demonstration is still outstanding.** No App is installed, no token exists, and
nothing here pushes, opens a PR, dispatches a workflow, or calls GitHub. Issue
#365's "demonstrate before closing" items that need a real App (a pilot slice
routed to its `epic/<N>-<slug>` branch through the publisher, a real `CI Gate`
run, and recorded evidence in a real PR) have not been done. The maintainer chose
to build the adapter first; the demonstration remains open work.

This is checkpoint 2 of epic #359. It builds on:

- #364, the reviewed brief and revision-bound approval:
  [feature-brief-process.md](feature-brief-process.md)
- #362, the unprivileged worker and restricted publisher:
  [cloud-bug-publisher.md](cloud-bug-publisher.md)
- #363, exact-head CI verification: `scripts/verify-pr-gate.mjs`

Implementation: [`scripts/feature-slice/`](../../scripts/feature-slice/). Tests:
[`src/__tests__/scripts/featureSlice.test.ts`](../../src/__tests__/scripts/featureSlice.test.ts).

## Why a separate publisher entry point

`publishBugFix` is the bug lane. It requires a `bug` label, rejects `enhancement`
and `epic` issues as reclassified, and requires a reproduced defect with a
regression test that fails on the base. A slice has none of those. The adapter
therefore composes #362's primitives (`assertOwnedBranch`, `assertTargetBase`,
`assertPublisherIdentity`, `evaluatePatchPolicy`, `assertSafePush`,
`prepareUnprivilegedWorker`, `requiredChecksForFiles`, `buildPullRequestBody`)
and does not change any of them.

## Entry points

| Function | Job |
| --- | --- |
| `startFeatureSliceWorker` | Re-reads the issue, brief, and approval, then builds the worker context. |
| `publishFeatureSlice` | Scope, approval, target, and closing-keyword checks, then push and PR. |
| `verifySliceApproval` | The recheck both of the above use. |
| `evaluateSliceScope` | Owned and scheduled shared files, with #362's deny-list on top. |
| `checkMergeSerialization` | Blocks merge of unserialized shared-file edits. |
| `checkEpicReadiness` | Refuses "ready for epic -> main PR" unless the exact head is verified and reviewed. |

Every external boundary is injected: `readSliceIssue`, `readApprovalInput`,
`readBranchState`, `git.push`, `github.*`, `readEpicHead`, `readGateInputs`,
`readReview`, `hasFileAtRef`, and `now`.

## Brief and approval recheck

The approval is read at worker start and again as the last read before the push
and before each PR write, using `revalidateClaim`. The scope comes from the brief
revision whose digest matched, never from the worker.

| Outcome | Meaning |
| --- | --- |
| `return-to-planning` | The brief changed, approval was withdrawn or never covered this revision, or the slice left the brief. Go back to #364. Nothing is pushed. |
| `paused` | A read failed, or the issue is held, closed, or waiting on a decision. The state is unknown, so nothing is written. |
| `paused-out-of-scope` | The patch left the slice's files. Nothing is pushed. |
| `refused` | The request is malformed or unsafe (main target, epic closing keyword, bad identity). |

If a brief edit lands after the push but before the PR write, the branch stays
pushed and no PR is created. The result reports `pushed: true`.

## Scope

A path passes only if the slice lists it under `Owned files` or `Shared files`
(a directory entry covers everything below it). A shared file, as defined by
`isSharedFile` in `scripts/feature-brief/brief.mjs`, passes only when listed under
`Shared files`; listing it under `Owned files` does not count. Globs in either
list fail closed. A rename must have both paths in scope.

#362's deny-list stays in force on top and a brief cannot unlock it: `.github/**`,
Tauri capability, entitlement, and `tauri.conf.json` files, release, publish,
signing, and build scripts, branding, `AGENTS.md`, `LESSONS.md`, `CLAUDE.md`, and
any raise of a component-size ceiling or lint-warning count. A manifest or lockfile
passes only when the brief schedules that exact path.

The changed-file list must come from the caller's own `baseSha..localHead` diff.
The worker's report is compared against it and never replaces it.

## Target and closing keyword

The PR targets the epic branch named in the approval and nothing else. `main`,
release branches, other workers' branches, and any other epic branch are refused.
The PR body must contain exactly one closing reference, `Closes #<slice-issue>`.
A reference to the epic issue, to another issue, or in a cross-repository or URL
form is refused before any push. This is what lets
`.github/workflows/epic-close-issues.yml` close the slice on squash merge while
the epic closes with its own PR into `main`.

## Shared-file serialization

`checkMergeSerialization` blocks merge when two pending slices edit the same
shared file with no `Depends on` order between them, and when a slice edits a
shared file it did not schedule. A dependency order is necessary, not sufficient:
the later slice must still rebase onto the earlier one and rerun its affected
tests (`LESSONS.md`, "Working with parallel agents").

## Integrated epic head

`checkEpicReadiness` answers one question for one SHA: the tip of the epic branch.
It refuses unless all of these hold:

1. `verifyPrGate` verifies that exact SHA: every required job and `CI Gate`
   completed with `success`, produced by GitHub Actions, on that head.
   For a check made before the PR exists, pass `pr: { headRefOid: <epic head> }`.
2. A review is recorded for that same SHA, from a reviewer who is not one of
   `publisherLogins`, recorded within `maxReviewAgeMs` (default 24 hours), with a
   `ready-for-human` verdict and zero blocking findings, and `decideReviewVerdict`
   agrees.
3. The epic branch includes `.github/workflows/ci.yml` and
   `.github/workflows/epic-close-issues.yml`.
4. When `browserE2eRequired` is set, the newest `Browser E2E` run is a success on
   that SHA. Dispatch CI with `run_e2e=true` for epics that change UI.
5. The epic head did not move while the check ran.

The result always carries `autoMerge: false`. The module has no merge seam. A
human opens and merges the epic -> main PR.

## Gaps and assumptions

- The live App demonstration, a real `CI Gate` run, and a recorded pilot slice are
  not done.
- The #364 brief does not map a slice id to its GitHub issue number. The caller
  supplies `sliceIssue`, and the branch must be `agent/issue-<sliceIssue>-<slug>`.
- Nothing is wired into a workflow. The readers and writers are seams for the
  runner to supply.
- Closing keywords in commit messages are not inspected; `CommitInfo` carries no
  message.
