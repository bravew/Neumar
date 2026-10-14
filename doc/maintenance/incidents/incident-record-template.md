# Incident record template

One record per confirmed incident. Copy this file, fill every field, and link it
from the weekly review. A record is a description of a system failure, not a
judgement of a person. Write what contract failed and which gate let it through.

An incident counts toward the policy thresholds only when two reviewers, or a
maintainer holding an independent verification artifact, confirm it. Until then
it is a candidate, and the `Maintainer disposition` field says so.

Attribution fields use `unknown` when evidence is unavailable. Do not guess.
Do not name a vendor, model family, or agent session from a product reference in
code or a title; that is not authorship evidence. Keep private session URLs and
identifiers out of this file and put an opaque reference here instead.

- **Record ID:**
- **Status:** candidate | confirmed | repaired | closed | appealed
- **Date recorded:**
- **Recorded by:**

## Introducing change

- **Introducing PR or commit:**
- **Causal evidence:** the specific diff, line, or squash that introduced the
  behavior. A stacked PR total is not causal evidence; use the squash diff.
- **Attribution evidence:** the human accountable for landing it, and the
  authoring tool or session when known. Use an opaque local reference. Write
  `unknown` when the evidence does not exist, and say what would settle it.

## Reproducible scenario

- **Failed contract:** the behavior, schema, or invariant that was expected.
- **Steps:** the shortest sequence that reproduces the failure on the real
  surface a caller uses, such as the HTTP route, MCP handler, bridge, packaged
  build, or chosen runtime.
- **Observed result:**
- **Expected result:**
- **Artifact:** a command, test name, or log that shows the result.

## Severity

- **Level:** P0 urgent containment | P1 fix before expanding the feature |
  P2 planned cleanup. Use the same scale as
  [01-findings.md](../2026-10-13-regression/01-findings.md).
- **Impact:** what a user or system could not do, or what was put at risk.
- **Breadth:** how many callers, routes, platforms, or installs are affected.
- **Reversibility:** whether existing data or published output was changed.

## Review and check gap

- **Gate that should have caught it:**
- **Why it did not:** the check skipped, the boundary the test stopped short of,
  the fixture that did not match the environment, or the job that only ran on
  release heads.
- **What was observed instead:** the green check names, a PR-body claim, or a
  manual run that did not cover this path.

## Repair

- **Repair PR:**
- **Fixing change:** the cause that was fixed, not the symptom that was hidden.
- **Prevention test or check:** the new or changed test at the boundary above,
  and where it runs.

## Verification

- **Verified commit:** the exact head the checks ran on.
- **Commands and results:** each command, its outcome, and any failure, including
  Node and pnpm versions for a local run.
- **Independent artifact:** the reviewer or maintainer artifact that confirms it.
- **Unverified:** what remains untested, and why.

## Disposition

- **Maintainer disposition:** accepted | disputed | no action | probation |
  block | reinstatement. Record who decided and when.
- **Policy effect:** does this record count toward the 90-day thresholds, and
  why. Note if it is one incident across an epic and its sub-PRs, a repair by a
  different author, or an infrastructure failure that does not count.
- **Effective date:** for a block or probation, the date the restriction starts.
- **Expiry:** the date it is reviewed, or `not applicable`.

## Appeal status

- **Appeal status:** none | open | upheld | corrected | withdrawn
- **Appeal link:** the issue or record where an appeal is filed.
- **Appeal outcome:** for a closed appeal, what was corrected, such as
  attribution, severity, or causation.

## Notes

Anything else that helps the next reviewer, including related records and links
to the weekly review that raised it.
