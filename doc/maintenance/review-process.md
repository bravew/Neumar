# Weekly and pre-release maintenance review

This runbook defines the recurring maintenance review. It is written so one
person or one agent can run it from a checkout, publish a report, and select
bounded cleanup work without inventing a process each time.

The review exists because a fix that nothing rechecks decays. The first review
([2026-10-13 regression review](2026-10-13-regression/README.md)) found that 77
of 84 merged pull requests never ran the automatic quality and test jobs, that
four release pull requests merged with a quality or test failure already
completed on the matching head, and that four recent feature pull requests
proved the wrong layer. Repeating the review is how the repository notices the
same class of failure coming back.

Scheduling is not part of this document. A recurring job, a scheduled workflow,
or an external reminder is a separate maintainer decision, and none is live. The
process below is run by hand until the maintainer decides otherwise.

## Cadence and owner

- **Weekly.** Run the review once a week against the current default branch head.
- **Pre-release.** Run the same review against the exact head to be released
  before any `release:new` or `release:publish` step. The pre-release run is the
  gate, so it does not wait for the weekly slot.
- **Owner.** Every report names one accountable owner in its `Owner` field, plus
  the reviewer who produced it when they differ. The owner is the person
  answerable for the open findings and the cleanup selections in that report, not
  every contributor named in it. When no owner is recorded, the report is
  incomplete and the review did not happen.

A weekly run that finds nothing new still publishes a report. The report records
what was checked and the exact check outcomes, so a quiet week is visible
evidence rather than an absent one.

## Review scope

Each run inspects these surfaces. A surface with no change is reported as
unchanged with the command or query that showed it.

1. **New lint warnings and suppressions.** Compare the warning count and the
   per-rule breakdown against the previous report. Count new `eslint-disable`,
   `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`
   directives. A new suppression in changed code is a finding unless a reviewed
   exception with an owner, a reason, and an expiry exists. See
   [LESSONS.md](../../LESSONS.md), "Never raise a threshold or allowlist ceiling
   to make a check pass."
2. **Size-ceiling changes.** Diff
   [component-size-allowlist.json](../../scripts/component-size-allowlist.json).
   A raised `current` ceiling is a finding. A lowered ceiling or a removed entry
   is progress. Do not treat a deletion count as a quality measure on its own.
3. **Orphan candidates.** Recheck the dead-code candidates from the previous
   report and the list in [01-findings.md](2026-10-13-regression/01-findings.md).
   A candidate is only removed after an exact-path and symbol search across every
   workspace, the build entry points, the plugin manifests, and the desktop
   consumers. Knip output is a lead, never a deletion authority.
4. **Unsupported feature surfaces.** Find routes that return 501 or an explicit
   "not implemented" and confirm each one is intentional and truthful. A control
   that offers a feature the API refuses is a finding. The current known surfaces
   are the chat plugin apply route and the memory extract and consolidate routes.
5. **Migration changes.** Any change under `src-api/src/shared/db/migrations/`
   gets a full-registry run against fresh, current, and drifted snapshots. A
   missing table or column means unknown, never empty. Do not renumber applied
   migrations.
6. **Security findings.** Recheck the open findings S1 to S9 in
   [01-findings.md](2026-10-13-regression/01-findings.md). A security gap a
   document names is an open bug, not a description, so a finding that is
   documented but unfixed stays open until an issue tracks it and the fix lands.
7. **Unresolved regressions.** Recheck R1 to R6 and any regression added since.
   A regression closes only when a test at the caller boundary fails before the
   fix and passes after it.
8. **Expired exceptions.** Every exception carries an owner, a reason, and an
   expiry. List the ones that have expired and the ones that expire before the
   next scheduled run. An expired exception is an open finding until it is
   renewed with a new reason or resolved.

## Report format

Publish each run as a new dated directory under `doc/maintenance/`, for example
`doc/maintenance/2026-10-14-weekly/README.md`. Use these headings in this order.
Every row that names a check records the exact command, its exit status, and the
counts it printed. Every finding links the pull request or the source path and
line that shows it.

```
# <cadence> maintenance review, <date>

Owner: <accountable owner>
Reviewer: <who produced the report>
Head: <full commit sha reviewed>
Node and pnpm: <versions used>
Previous report: <link or "none">

## Check outcomes
| Command | Result | Notes |
| --- | --- | --- |
| pnpm validate | <pass or fail, exit code, warning count> | |
| pnpm test:fast | <pass or fail, file and test counts> | |
| pnpm --filter neumar-api lint | | |
| pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit | | |
| closest changed-surface checks | | |

## Findings
| ID | Surface | Finding | Evidence | Owner | Status |
| --- | --- | --- | --- | --- | --- |

## Metrics
| Metric | This run | Previous | Trend |
| --- | ---: | ---: | --- |

## Cleanup selected
<one row per bounded cleanup pull request, with its scope and the finding it closes>

## LESSONS.md
<lesson added or incremented, with its evidence, or "no change">

## Unverified
<checks that could not run, and why>
```

The report distinguishes what this run observed from evidence carried over from
an earlier review. A carried-over line names the review and the commit it came
from. A check that could not run is listed under Unverified with the reason; it
is never reported as a pass.

## Selecting bounded cleanup pull requests

The review selects cleanup work, it does not perform it in the report. A cleanup
pull request is bounded when it meets all of these:

- It has one goal and one subject line. A fix found on the way gets its own pull
  request.
- It names the finding or the metric it moves, and the exact check that will show
  the change.
- It migrates every caller and deletes the superseded path in the same change.
- It does not raise a threshold or an allowlist ceiling to pass a check. An
  exception is recorded with an owner, a reason, and an expiry instead.
- It is small enough to review against the finding in one sitting. When a
  candidate is larger, split it and select the first slice.

The review does not reward deletion count, and it does not punish every
follow-up fix. A corrective pull request that repairs an escaped regression is
responsible work; the escaped regression is the finding, not the repair. The
review selects work by the risk the finding carries and the evidence that will
close it, not by how many lines it removes.

## The LESSONS.md step

Every run ends with one of these outcomes for [LESSONS.md](../../LESSONS.md):

- **Add a lesson.** When a run finds a failure pattern that is not already a
  lesson, add it with its evidence: a pull request number, a commit, or a file
  and line, plus what was run and what was missed. Keep the rule first.
- **Increment a lesson.** When a run finds the same pattern again, increment that
  lesson's "Seen" count and record the review date. Say which review day, not
  only the count.
- **No change.** When no new pattern and no repeat was found, record that in the
  report. This is a valid outcome.

When a lesson reaches three review days, move the rule into
[AGENTS.md](../../AGENTS.md) so every agent applies it without a separate read,
and leave a pointer to it in LESSONS.md. The pointer keeps the evidence
findable; the rule lives in AGENTS.md from then on.

## Metrics

Record these each run. The trend across runs is the point; a single run's number
is only a baseline.

- **Escaped regressions.** Regressions found after merge that a required check
  should have caught. Count the ones introduced since the last report.
- **Time to repair.** From the merge that introduced a regression to the merge
  that fixed it, for each escaped regression closed since the last report.
- **Required-check execution.** The share of merged pull requests in the window
  whose required checks actually ran on the merged head. Skipped, cancelled, and
  absent checks do not count as executed.
- **Unresolved high-priority findings.** The count of open P0 and P1 findings
  from [01-findings.md](2026-10-13-regression/01-findings.md) plus any added
  since, and how many are older than the last two runs.
- **Expired exceptions.** The count of exceptions past their expiry, and the
  count expiring before the next run.

Deletion count is not a metric. It is not recorded as progress, and a run with
more deletions is not a better run than one with fewer.

## Related documents

- [Regression review and maintenance plan](2026-10-13-regression/README.md): the
  evidence, the plan, and the baseline this process rechecks.
- [Findings and evidence](2026-10-13-regression/01-findings.md): the S1 to S9 and
  R1 to R6 findings the review rechecks.
- [PR lessons and contributor policy](2026-10-13-regression/03-lessons-and-contributors.md):
  the merge metrics and the contributor policy.
- [LESSONS.md](../../LESSONS.md): the rules the review adds to and increments.
- [AGENTS.md](../../AGENTS.md): where a lesson moves after three review days.
