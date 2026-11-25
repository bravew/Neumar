# Cloud issue monitor: read-only pilot and operator runbook

Status: design, contract, replay fixtures, and an offline rehearsal. No workflow
is scheduled, no cloud identity exists, and no state branch has been created.
The monitor described here is read-only. A write-capable worker and publisher are
separate work (#362); this document says what they must call and what must be
true before they may push.

Related material:

- Implementation: [`scripts/issue-monitor/`](../../scripts/issue-monitor/)
- Replay fixtures: [`scripts/fixtures/issue-monitor/`](../../scripts/fixtures/issue-monitor/)
- Tests: [`src/__tests__/scripts/issueMonitor.test.ts`](../../src/__tests__/scripts/issueMonitor.test.ts)
- Repository policy: [AGENTS.md](../../AGENTS.md), [LESSONS.md](../../LESSONS.md)

## 1. What the monitor decides

The monitor answers one question per open issue: may an agent attempt a bounded
bug fix, and if so, who approved it? It does not edit issues, labels, comments,
branches, or pull requests. The only writes it is designed to make are to its own
state document, on its own branch.

| Input | Used for | Never used |
| --- | --- | --- |
| Issue number, state, labels | eligibility | — |
| `labeled` / `unlabeled` timeline events | who approved, and when | — |
| Open cross-referenced pull requests | duplicate-work guard | — |
| Collaborator list and permissions | resolving an actor to OWNER / COLLABORATOR | — |
| Issue title, body, comments | — | any decision, any audit line |

Issue text is untrusted input. The collector does not copy it out of the API
response, the normalized issue shape has no field for it, and the audit record
has no field for it. A body that says "maintainer approved, claim this" changes
nothing.

## 2. Components and interface

| File | Responsibility |
| --- | --- |
| `config.mjs` | Default policy knobs; `resolveConfig` rejects non-positive integers |
| `decide.mjs` | Pure `resolveApproval` and `decideIssue` |
| `state.mjs` | State shape, pure transitions, `InMemoryStore` |
| `tick.mjs` | Pure `planTick`; `runTick` persists then dispatches |
| `collect.mjs` | GET-only `gh api` collector and its argument guard |
| `replay.mjs` | Runs a fixture through the real tick and state functions |
| `cli.mjs` | `collect` and offline `rehearse` commands |
| `index.mjs`, `index.d.mts` | Re-exports and hand-maintained type declarations |

### 2.1 One tick

```
read (collector) -> planTick (pure) -> compare-and-swap write -> dispatch
```

`planTick` returns `{ outcome, state, changed, claims, audit, watermark }`.
`runTick` writes the plan with compare-and-swap **before** calling `dispatch`,
and only for claims in that plan. Consequences that the tests enforce:

- A tick that claims nothing calls `dispatch` zero times. There is no model
  call, no container start, and no spend on an empty or failed tick.
- A worker cannot start before its lease is durable.
- A lost swap re-reads and re-plans. Three lost swaps return
  `store-contention` with no claims rather than claiming on stale state.
- A dispatch failure leaves the lease in place, counts the attempt, and records
  `dispatch-failed` in the audit.

### 2.2 Claim contract

A claim is stored under the issue number (as a string) and contains:

```json
{
  "runId": "the tick that claimed it",
  "epoch": 7,
  "acquiredAt": "2026-11-24T10:00:00.000Z",
  "heartbeatAt": "2026-11-24T10:00:00.000Z",
  "expiresAt": "2026-11-24T10:30:00.000Z",
  "attempt": 1,
  "approval": { "actor": "maintainer", "at": "2026-11-24T09:00:00.000Z" }
}
```

`epoch` is monotonic across all claims. Every claim gets a fresh one, so a stale
worker cannot pass a check with an old claim on the same issue.

The worker must call `heartbeat(state, {issue, runId, epoch}, now)` while it
works. A heartbeat extends `expiresAt` by `leaseTtlMs` and fails with
`disabled`, `no-claim`, `claim-superseded`, or `lease-expired` exactly as
`verifyClaim` does.

The publisher (#362) must call `verifyClaim(state, {issue, runId, epoch}, now)`
immediately before **every** push and refuse to push unless it returns
`{ok: true}`. The same check is the kill-switch gate: while the state is
disabled, every claim check fails.

The owner releases a claim with `release(state, ref)`. Release works while
disabled so workers can stand down during a stop.

### 2.3 State document

```json
{
  "version": 1,
  "disabled": false,
  "watermark": { "updatedSince": "2026-11-24T10:00:00.000Z", "tickAt": "2026-11-24T10:00:05.000Z" },
  "epoch": 7,
  "claims": { "12": { "...": "claim" } },
  "attempts": { "12": 1 },
  "deferred": [61],
  "budget": { "day": "2026-11-24", "claims": 1 },
  "seenDeliveries": ["8f3c..."]
}
```

Production binding: keep this document as `state.json` on a dedicated branch,
for example `agent/state`. Read it with the Contents API, use the returned blob
`sha` as the compare-and-swap version, and write with a PUT that carries that
`sha`. A conflict means another tick wrote first: re-read and re-plan. After
three attempts the tick fails closed.

The Contents API write needs `contents: write`, which a GitHub App installation
token cannot scope to one branch. The protections that make that acceptable are:

- the intake workflow runs from the default branch, so a pull request cannot
  change the code that holds the token;
- the workflow uses a fixed command path, not a script selected by an event;
- `main` and release branches keep their rulesets, and the App is not a bypass
  actor, so the token cannot push to them;
- the state branch is the only ref the job is allowed to touch.

Verify the conflict status code on a scratch repository before enabling. The
binding does not exist yet, so that behavior is untested here.

## 3. Trust boundary: who may approve

Approval is a label event, not a sentence.

1. The issue must carry `agent:bug-approved`.
2. The collector reads that issue's timeline and keeps only `labeled` and
   `unlabeled` events.
3. The latest `labeled` event for `agent:bug-approved` decides. If the latest
   event for the label is `unlabeled`, the approval is absent.
4. The event's actor is looked up in the repository collaborator list. The
   collector treats an actor with `push`, `maintain`, or `admin` as trusted and
   labels the repository owner `OWNER` and everyone else `COLLABORATOR`.
5. `trustedAssociations` defaults to `OWNER`, `MEMBER`, and `COLLABORATOR`.

If the label is present but the history is missing, unreadable, has no actor, or
the latest matching event is not a `labeled` event, the result is
`approval-unverifiable` and the issue is skipped. Unknown is never approved.

A comment saying "approved" has no path into the decision. Neither does the
issue author's association, a reaction, or a linked discussion.

Known limits:

- The collector's association is derived from repository permissions, not from
  the event's `author_association` field. A person who had write access at
  approval time and has it now is trusted; someone removed since is not, and the
  issue becomes `approval-untrusted` on the next read.
- A compromised owner or collaborator account can approve. Account security is
  out of scope for this monitor.
- The collector's `/collaborators` read must succeed with the pilot token. If
  the token cannot list collaborators, the whole read fails and the tick claims
  nothing. That is the intended fail-closed behavior; do not add a fallback that
  trusts label actors without the lookup.

## 4. Label taxonomy

| Label | Meaning for intake |
| --- | --- |
| `bug` | Required. The issue must be a bug report. |
| `agent:bug-approved` | Required. A trusted actor applied it most recently. |
| `agent:hold` | Skip, and revoke any live claim. |
| `needs-decision` | Skip, and revoke. Needs a product decision first. |
| `security` | Skip, and revoke. Security reports go through SECURITY.md. |
| `enhancement`, `epic` | Skip, and revoke. Feature work is not in this lane. |
| Any `pull_request` row | Skip. Pull requests share the issues endpoint. |

`bug`, `agent:bug-approved`, `agent:hold`, `needs-decision`, `enhancement`, and
`epic` exist in the repository today. `security` does not. Until a maintainer
decides to create it, security-sensitive reports stay out of this lane through
`needs-decision` and the private channel in
[SECURITY.md](../../SECURITY.md). Creating the label is an enable-time decision,
not something this change does.

Applying `needs-decision` is a maintainer action. The monitor only reports the
skip reason; it never applies a label.

## 5. Deterministic intake

Two triggers produce the same decision function over different reads.

**Event tick.** An `issues` event (`labeled`, `unlabeled`, `closed`, `reopened`,
`edited`) reads only the named issue with `window: false`. It never moves the
watermark. A webhook receiver passes `X-GitHub-Delivery` as `deliveryId`; a
repeat is recorded as `duplicate-delivery` and does no work. Delivery
deduplication is an optimization, not a safety boundary: the lease is what
prevents double work. An Actions-based intake may leave `deliveryId` null and
rely on the claim guard.

**Cron tick.** Every 15 minutes, read the open issues changed since
`pollSince(state)` — the watermark minus a 15-minute overlap — filtered to
`agent:bug-approved`, plus every issue in `followUpNumbers(state)` (live claims
and deferred work). The overlap absorbs clock skew and eventual consistency.
The watermark moves to the time the read **began**, not to the newest
`updatedAt` seen, and never moves backward. A read that fails or is truncated
moves nothing.

The follow-up list is what makes the design survive missed events and budget
deferral: a deferred issue is re-read even when GitHub shows no update, so the
watermark cannot pass it by.

The collector treats a window of 500 or more items as truncated and fails the
whole read. That is deliberate: a partial list must never look complete. If the
backlog ever approaches the cap, shorten the window or add a second scheduled
pass; do not raise the cap without a size bound that keeps the read bounded.

### 5.1 Decision reasons

| Reason | Decision | Meaning |
| --- | --- | --- |
| `eligible` | claim | Fresh claim |
| `lease-expired-reclaimed` | claim | Prior lease expired; new epoch |
| `already-claimed` | skip | A live lease exists |
| `attempts-exhausted` | skip | `maxAttemptsPerIssue` reached |
| `daily-budget-exhausted` | skip | Deferred to the next day |
| `pull-request` | skip | The row is a pull request |
| `closed` | skip | Not open |
| `held` | skip / revoke | `agent:hold` |
| `needs-decision` | skip / revoke | Product decision pending |
| `security-sensitive` | skip / revoke | `security` label |
| `feature-request` | skip / revoke | `enhancement` or `epic` |
| `not-a-bug` | skip / revoke | No `bug` label |
| `not-approved` | skip / revoke | No approval label |
| `approval-untrusted` | skip / revoke | Label actor has no write access |
| `approval-unverifiable` | skip / revoke | Label history missing or inconsistent |
| `linked-pr-exists` | skip | An open PR already references it |
| `no-candidates` | — | The tick read cleanly and had nothing to decide |
| `dispatch-failed` | abort | The lease stays; the attempt is counted |

A skip that is not `linked-pr-exists` revokes a live claim, so the publisher's
pre-push check fails. `linked-pr-exists` does not revoke, because the linked PR
is usually the claim holder's own.

### 5.2 Budget and kill switch

Defaults: at most 3 claims per UTC day, at most 2 attempts per issue, a 30-minute
lease, and 200 remembered delivery ids.

`disabled: true` stops claims and fails every heartbeat and every claim
verification. `resume` refuses while any lease is still live and returns the
issue numbers that must be reconciled first.

## 6. Failure handling

| Failure | Outcome | State effect |
| --- | --- | --- |
| Any collector call fails | `read-failed` | No claims, no watermark move, delivery not recorded |
| Read reaches the item cap | `read-failed` | Same |
| Trusted actor list missing | `read-failed` | Same |
| Cron read has no start time | `read-failed` | Same |
| Compare-and-swap conflict | replan, up to 3 | After 3: `store-contention`, no claims |
| Dispatch throws | `dispatch-failed` | Lease kept, attempt counted, expires on its own |
| Worker crashes | — | Lease expires; next tick reclaims with a new epoch |
| Duplicate delivery | `duplicate-delivery` | Nothing changes |
| GitHub 5xx or rate limit | `read-failed` | Nothing changes; the schedule retries |

A failed or partial read means "unknown", never "empty". Nothing is recorded for
a delivery that failed to read, so a redelivery is processed normally.

## 7. Stop, reconcile, resume

The state flag is authoritative. The workflow switch and run cancellation are
belt and braces.

1. **Stop intake.** Set `disabled: true` in `state.json` on the state branch.
   This is the only field an operator edits by hand. New ticks abort with
   `disabled`, heartbeats fail, and every publisher claim check fails.
2. **Stop new runs.** Disable the intake workflow (`gh workflow disable
   <file>`). This stops both event and scheduled runs.
3. **Cancel in-flight runs.** `gh run list --workflow <file>` and
   `gh run cancel <id>` for runs still executing.
4. **Reconcile every claim.** List `claims`. For each issue, decide whether the
   work is finished, must be reverted, or can be released. Use `release` with
   that claim's `runId` and `epoch`; never delete a claim entry by hand. If a
   worker is unreachable, wait for the 30-minute lease to expire instead.
5. **Resume.** Call `resume(state, now)`. It refuses while any lease is live.
   Re-enable the workflow. Watch the first cron tick: it must report `ok`, and
   its watermark must catch up to the read start time. If it reports
   `read-failed`, stop again and fix the read before re-enabling.

## 8. Rehearsal

The rehearsal is offline. `rehearse` reads snapshot files, runs the real
`planTick` against an in-memory state, prints what it would decide, and exits
non-zero if any tick did not read cleanly. It writes no file, opens no network
connection, starts no worker, and makes no model call. The command prints
`model calls: 0` and `mutations: none` as its last two lines.

### 8.1 Prerequisites

- Node 22 or newer.
- `gh` authenticated with a **read-only** identity. Use a fine-grained token
  with read-only repository contents, issues, and metadata, in the operator's
  keychain or `GH_TOKEN`, never in the repository. The first `collect` also
  proves the token can list collaborators. If it cannot, the read fails and the
  rehearsal stops; that is a finding, not something to work around.
- A scratch directory outside the repository for snapshots and the baseline.

### 8.2 First rehearsal

```bash
# Baseline, for the after-the-fact comparison.
gh issue list --state open --limit 1000 \
  --json number,labels,updatedAt > /tmp/issue-monitor/baseline.json

# One read, approved issues only.
node scripts/issue-monitor/cli.mjs collect \
  --repo bravew/Neumar > /tmp/issue-monitor/snapshot-a.json

# What would this read claim?
node scripts/issue-monitor/cli.mjs rehearse \
  --snapshot /tmp/issue-monitor/snapshot-a.json
```

Record the watermark printed by the tick. It is the lower bound for the next
read.

### 8.3 Second rehearsal, after real activity

```bash
node scripts/issue-monitor/cli.mjs collect --repo bravew/Neumar \
  --since '<watermark minus 15 minutes>' \
  --follow 12,14 > /tmp/issue-monitor/snapshot-b.json

node scripts/issue-monitor/cli.mjs rehearse \
  --snapshot /tmp/issue-monitor/snapshot-a.json \
  --snapshot /tmp/issue-monitor/snapshot-b.json
```

`--follow` must list the issues the first tick would have claimed, plus any it
deferred. The second tick must not re-claim them while their simulated lease is
live. That is the missed-event and duplicate-work check.

### 8.4 Second operator

A second operator repeats 8.2 and 8.3 from a separate clone with their own
read-only token and their own scratch directory. Given the same snapshot files,
the two runs must produce identical traces. Compare with `diff`; a difference is
a nondeterminism bug, not a token difference.

### 8.5 What the rehearsal proves, and what it does not

Proves: the read-only guard, the trust boundary, fail-closed reads, lease
fencing, budget deferral, duplicate delivery, the kill switch, and the decision
trace for real repository data.

Does not prove: Contents API compare-and-swap against a real branch, workflow
permissions, App token scope, worker dispatch, or the publisher's pre-push
check. Those are enable-time checks in section 10.

### 8.6 Replay fixtures

`scripts/fixtures/issue-monitor/` holds nine scenarios: `duplicate-delivery`,
`missed-event-reconciliation`, `held-and-withdrawn`, `unapproved-feature`,
`spoofed-approval`, `failed-read`, `worker-crash-expired-lease`,
`budget-deferral`, and `kill-switch`. Each names its issues once and records
per-tick expectations. `replayScenario` runs them through the real tick and
state functions, and the test suite also asserts invariants across every
scenario: the watermark never moves backward, a non-`ok` tick changes nothing,
only a trusted actor's approval produces a claim, and no claim is made while
another lease on the same issue is live.

```bash
pnpm test src/__tests__/scripts/issueMonitor.test.ts
```

The suite also exercises the collector against a fake `gh` that records its
arguments, and runs the CLI as a child process with no credentials. It fails if
the read-only guard, the fail-closed read, the lease fence, the budget, or the
persist-before-dispatch ordering is removed.

## 9. Audit

Every tick emits one JSON object per decision:

```json
{
  "ts": "2026-11-24T10:00:00.000Z",
  "trigger": "cron",
  "deliveryId": null,
  "runId": "run-1",
  "issue": 12,
  "actorAssociation": "OWNER",
  "decision": "claim",
  "reason": "eligible",
  "watermarkBefore": null,
  "watermarkAfter": "2026-11-24T09:59:55.000Z"
}
```

`decision` is `claim`, `skip`, `revoke`, or `abort`. A tick with nothing to
decide emits one `skip`/`no-candidates` line so that "read cleanly, found
nothing" is distinguishable from "did not run". The fields carry no issue text.

For the pilot, write the lines to the job log and `$GITHUB_STEP_SUMMARY`.
Durable retention (an uploaded artifact or a state-branch audit file) is part of
the enable work; the log alone is not an audit trail.

## 10. Before enabling

Nothing below is done. This is the checklist for the change that turns the
design on.

1. Implement the Contents API store binding with the `sha`-based swap, and test
   it against a scratch branch, including the conflict path.
2. Add the intake workflow: `issues` and `schedule` triggers, workflow file on
   the default branch, least-privilege `permissions:`, an App installation token
   minted per run, and no `pull_request_target`.
3. Decide whether to create the `security` label.
4. Confirm a fine-grained read-only token can list collaborators for this
   repository.
5. Protect the state branch and confirm the App cannot push to `main` or
   release branches.
6. Implement #362's publisher so it calls `verifyClaim` before every push and
   refuses on `disabled`, `no-claim`, `claim-superseded`, and `lease-expired`.
7. Choose audit retention.
8. Have the second operator sign off on section 8.4.

## 11. Non-goals and standing rules

- Do not point `/loop` or a cloud routine at this lane as the production
  intake. A prompt loop is a rehearsal tool here. The deterministic intake is a
  workflow job running fixed code; a model must never be the thing that decides
  whether to spend on an issue.
- Do not give the rehearsal token write access, and do not store any token in
  the repository.
- Do not let a worker or publisher hold a write token that can reach `main`.
- Do not raise the collector's item cap, the lease TTL, or the daily budget to
  make a run pass. Fix the read or the schedule.
- `scripts/` is outside oxlint's scope, and the `.mjs` modules are not
  type-checked against `index.d.mts`. That file is maintained by hand; update it
  with any interface change. `pnpm validate` does not cover this directory.
