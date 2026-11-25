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

The weekly and pre-release runs below are run by hand. A recurring job for them
is a separate maintainer decision, and none is live. The one scheduled piece is
the [nightly review](#nightly-review), which feeds this process and does not
replace it.

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

## Nightly review

[nightly-lessons.yml](../../.github/workflows/nightly-lessons.yml) reads the
commits that landed on `main` since the last completed review and proposes
evidence-backed changes to [LESSONS.md](../../LESSONS.md). It exists so a
failure pattern is noticed the day it recurs, and so the count of review days
that [AGENTS.md](../../AGENTS.md) uses for promotion is kept by a script instead
of by memory. No model is called. The weekly and pre-release runs stay as they
are and read the nightly output as one input.

### What it reads

The range is `<reviewed-through>..HEAD` on the first-parent line of `main`, where
`main` allows only squash merges, so one commit is one merged PR. The cursor is
line 1 of LESSONS.md: `<!-- reviewed-through: <sha> (<date>) -->`. For each
commit the collector reads the pull request, the `CI Gate` check run, and the
files it changed, then applies these detectors:

| Detector | Evidence | Writes a lesson? |
| --- | --- | --- |
| `ci-gate` | `CI Gate` from GitHub Actions app 15368 is missing or not successful on the merged commit | Yes, "A check that skips your change is not validation" |
| `allowlist-growth` | A `current` ceiling went up or an entry was added in `component-size-allowlist.json` | Yes, "Never raise a threshold or allowlist ceiling" |
| `baseline-growth` | A count or an exception grew in `lint-warning-baseline.json` | Yes, same lesson |
| `new-suppression` | An added `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` outside test files | Yes, same lesson |
| `revert` | Subject starts with `Revert` | No, candidate only |
| `fix-forward` | A `fix` commit cites a PR merged earlier in the same range | No, candidate only |
| `reopened-issue` | An issue a commit closed was reopened afterwards | No, candidate only |

Creating either JSON file is not growth and is not reported. Naming a failure
pattern is judgment, so a candidate stays in the report until a person decides.
A person can also supply a validated proposal file with `--proposals`.

Commit subjects, bodies and issue text are untrusted data. They are matched
against fixed patterns, never executed, never placed in a shell command, and
rendered in the report inside code spans.

### Incomplete reads fail closed

A failed or truncated read means "unknown", never "nothing found". The run is
incomplete, and it fails, when any of these happens:

- the cursor is not an ancestor of the head,
- a pull request, check run, file or issue-event read errors,
- the check runs for a commit report a `total_count` larger than what came back,
- the range holds more than 300 commits (run a catch-up first).

An incomplete run writes no lesson, opens no PR, and leaves the cursor where it
was. The command exits 2 and the report says why.

### Review days, replays and promotion

Each distinct UTC review date counts once in a lesson's `Seen` line, so three
incidents on one date are one review day. Three separate dates make a lesson a
candidate for AGENTS.md, and the report says so. The script never edits
AGENTS.md. A person moves the rule and leaves a pointer in LESSONS.md.

Replaying a range is a no-op. Every evidence line carries its references (PR
number, short commit, or `path:line`), and a proposal whose references are all
already cited in that lesson is dropped, without touching the `Seen` line. The
same incident found on a later date does not become a second review day.

### Quiet days and the proposal PR

A run with no new commits, or no new evidence, opens no PR. The report is in the
run summary and in the `nightly-lessons` artifact, kept for 90 days. A day with
no report is a day the review did not run.

When there is a change to LESSONS.md, the `propose` job opens one PR from
`automation/nightly-lessons-<date>` into `main`. It never pushes to `main`. The
`review` job holds read permissions only. The `propose` job holds write
permissions, applies the patch from the review job, and refuses a patch that
touches any file but LESSONS.md or a `main` that moved after the review read it.
Only one nightly PR is open at a time, so an unreviewed proposal is not stacked.

The PR is a Markdown-only change, and `claude-code-review.yml` excludes `**/*.md`
by default, so the independent AI review does not look at it. The checks that do
run are `CI Gate`, which includes the structural test of LESSONS.md in
`src/__tests__/scripts/nightlyLessons.test.ts` (cursor line, `Seen` count equals
the listed dates, dates ordered and unique, every lesson has evidence), and the
formatting and link review a person does. A person reviews every evidence line
against its source before merging. Merging moves the cursor.

### One-time catch-up

LESSONS.md line 1 reads `c0926618 (2026-10-13)`, and the file already carries an
`2026-11-21` entry for epic #351 that no review run recorded. The first nightly
run would otherwise read 22 commits of history and write machine-inferred
evidence for all of them next to a hand-written entry.

Start from an agreed cursor instead. Run the workflow once by hand with
`catch_up: true`, or locally:

```bash
node scripts/nightly-lessons.mjs --repo bravew/Neumar --out /tmp/catch-up --catch-up --apply
```

Catch-up reports every finding in the gap as a candidate, writes no lesson, and
changes only line 1. The existing `2026-11-21` entry is never touched or counted
again. A person reads the report, adds any lesson it supports through the normal
LESSONS.md step below, and merges the cursor move. From then on, scheduled runs
begin at that head. A read-only dry run over `c0926618..c759a315` found 22
commits, `CI Gate` successful on 19, failed on 2, and absent on 1.

### Stop, resume, and what is not covered

- **Stop.** Set the repository variable `NIGHTLY_LESSONS_DISABLED` to `true`.
  Both jobs are skipped. Delete the variable to resume. The cursor is unchanged,
  so the next run reads the whole gap.
- **Cursor on quiet days.** The cursor moves only when a PR merges. A long quiet
  stretch leaves it where it was, and the range grows. Use `catch_up` to move it
  after a long gap. A state branch that records quiet runs is a possible later
  change and needs a maintainer decision.
- **CI on the PR.** A PR opened with `GITHUB_TOKEN` does not start other
  workflows. Close and reopen it to run `CI Gate`. The publisher GitHub App from
  [#358](https://github.com/bravew/Neumar/issues/358) removes that step when it exists.
- **Repository setting.** "Allow GitHub Actions to create and approve pull
  requests" must be on for the `propose` job.

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
- [nightly-lessons.yml](../../.github/workflows/nightly-lessons.yml) and
  [nightly-lessons.mjs](../../scripts/nightly-lessons.mjs): the nightly review
  and its collector, with tests in
  `src/__tests__/scripts/nightlyLessons.test.ts`.
- [LESSONS.md](../../LESSONS.md): the rules the review adds to and increments.
- [AGENTS.md](../../AGENTS.md): where a lesson moves after three review days.
