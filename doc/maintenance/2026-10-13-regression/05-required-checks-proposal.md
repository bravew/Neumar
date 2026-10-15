# Required checks and review rule for main and epic branches

Status: proposal, not applied. This document changes no repository setting.

Issue [#199](https://github.com/bravew/Neumar/issues/199), checkpoint 5 of 5 in
epic #188. The findings this proposal rests on are in
[01-findings.md](01-findings.md) and
[03-lessons-and-contributors.md](03-lessons-and-contributors.md). Applying
anything described here is a separate maintainer action that needs the
maintainer's decision. The decision itself has not been recorded on the issue
yet, and only the maintainer can record it.

## 1. What the repository enforces today

`gh api repos/bravew/Neumar/rulesets` returns two branch rulesets. Both are
repository-sourced and both are active.

| Ruleset | Id | Target refs | Rules |
| --- | ---: | --- | --- |
| `main` | 20760066 | `~DEFAULT_BRANCH` | deletion, non_fast_forward, pull_request |
| `protect main` | 20760091 | `refs/heads/main` | deletion, non_fast_forward, pull_request, copilot_code_review |

Both `pull_request` rules carry `required_approving_review_count` of 0, an empty
`required_reviewers` list, `require_code_owner_review` false, and
`require_last_push_approval` false. Both carry
`require_extra_approval_for_unattributed_changes` true. The `main` ruleset
allows only `squash` merges and `protect main` allows `merge`, `squash` and
`rebase`. Because the rulesets layer and the most restrictive version of a rule
applies, the effective merge method on the default branch is squash only. The 25
most recent commits on `main` are each single parent commits.

Neither ruleset contains a `required_status_checks` rule.
`gh api repos/bravew/Neumar/rules/branches/main` lists only `deletion`,
`non_fast_forward`, `pull_request` twice, and `copilot_code_review`. Classic
branch protection is not in use,
`gh api repos/bravew/Neumar/branches/main/protection` returns 404 with the
message "Branch not protected".

No ruleset targets epic branches.
`gh api repos/bravew/Neumar/rules/branches/epic%2F188-merge-gate` returns an
empty list, so a sub-issue pull request into an epic branch is subject to no
ruleset at all today.

Both rulesets have `bypass_actors` empty and report
`current_user_can_bypass` of `never`, so even the repository admin cannot bypass
them.

The review record is the other half of the picture. The repository has exactly
one collaborator, `bravew`, with admin permission. All 59 merged pull requests
into `main` were authored by `bravew`. The merged pull requests #187, #176,
#175, #167 and #155 each have zero approved reviews.
[03-lessons-and-contributors.md](03-lessons-and-contributors.md) records zero
approving review records in the 84 pull request sample and 67 of 84 with no
review record of any kind. Pull request #237, the probe used in section 2, also
has zero reviews.

This is not only a staffing fact. The GitHub documentation states that pull
request authors cannot approve their own pull requests, so with one collaborator
a required approving review count above zero can never be satisfied by an
ordinary approval.

## 2. The check to require, taken from a real run

The aggregate check name is `CI Gate`. It is produced by the `ci-gate` job in
`.github/workflows/ci.yml`, declared at line 201 with `name: CI Gate` on line
202. The string `CI Gate` appears in no other workflow file in the repository.

The name was read from pull request #237, which is the sub-issue pull request
for #197 into `epic/188-merge-gate`.

`gh pr checks 237 --repo bravew/Neumar` reports

```text
CI Gate	fail	3s	https://github.com/bravew/Neumar/actions/runs/38511301316/job/115681881006
```

`gh pr view 237 --repo bravew/Neumar --json statusCheckRollup` reports the same
check in the rollup, with `"name": "CI Gate"`, `"workflowName": "CI"`,
`"status": "COMPLETED"` and `"conclusion": "FAILURE"`. The run URL is
<https://github.com/bravew/Neumar/actions/runs/38511301316>.

The same check reported success on the push run for the current epic head
`952c9258`, at
<https://github.com/bravew/Neumar/actions/runs/38510500059/job/115679960971>.

The check is attached to the GitHub Actions app. Reading the check runs for
`952c9258` gives `"app": "github-actions"` and `"app_id": 15368`, so a ruleset
can pin the check to that integration rather than matching the name alone.

The run for pull request #237 is red at the time of writing. Its `Test` job and
its `API Lint & Test Typecheck` job both finished as failures, so the gate
correctly failed as well. The frontend failure is five assertions in
`src/__tests__/ci-workflow-gate.test.ts`, a file added by #196 that pins the
`ci.yml` text which #237 changes. That is a statement about pull request #237
and its own test file, not about the check name. The check name is proven by the
rollup entry and by the gate job log.

The gate log is the reason the aggregate is the right thing to require rather
than the individual jobs. It records

```text
##[error]Test finished as 'failure', expected 'success'.
##[error]API Lint & Test Typecheck finished as 'failure', expected 'success'.
##[error]Build finished as 'skipped', expected 'success'.
```

`Build` was only skipped, because a job that depends on a failed job is skipped
and, per the GitHub documentation on required status checks, a skipped dependent
job may not block merging on its own. The aggregate catches that case and the
individual job would not. The run failed with exit code 1.

## 3. Proposed required check

Require the single check `CI Gate` with `integration_id` 15368.

For `main`, add the rule to a ruleset that targets the default branch. For
`epic/**`, add a new ruleset, because no ruleset matches those refs today.

Keep the required check in its own ruleset with `bypass_actors` empty, separate
from the ruleset that carries the review rule in section 4. That way the
solo-maintainer exception described below cannot also be used to skip the
build gate.

Recommended parameters.

| Setting | Value |
| --- | --- |
| `required_status_checks` | one entry, `context` of `CI Gate`, `integration_id` of 15368 |
| `strict_required_status_checks_policy` on `main` | true |
| `strict_required_status_checks_policy` on `epic/**` | false, see the tradeoff below |
| `do_not_enforce_on_create` | false |

Do not require the individual job names `Lint, Types & Format`, `Test`,
`API Lint & Test Typecheck`, `Video IR Suite`, `Rust Checks`, `Build` or
`Browser E2E`. Three reasons, all observable in this repository.

- A workflow that is filtered by path leaves its required check pending and
  blocks merging, and `workflow-lint.yml` and `docs-media-check.yml` are both
  path-filtered.
- `Rust Checks` legitimately has nothing to do when `src-tauri/` did not change.
  On pull request #237 it reported success in 11 seconds because the job itself
  decides internally, which is the safe shape, but a job that instead skips at
  the job level would read as skipped.
- A skipped dependent job may not block merging, which is exactly the hole the
  aggregate was built to close.

Strict mode on `main` means a pull request into `main` must be tested against
the latest `main`, which matches the lesson "Validate the final integrated head,
not each branch in a stack". Strict mode on `epic/**` is a genuine tradeoff.
Several sub-issue pull requests target one epic branch in parallel, and each
sibling merge would invalidate the others and force a rebase plus a fresh gate
run. Since `ci.yml` already runs on every push to `epic/**`, the integrated head
of an epic branch is validated after each sub-issue merge without strict mode.
The maintainer should pick strict mode for `epic/**` only if the rebase cost is
acceptable.

## 4. Review rule and the solo-maintainer exception

The target review rule is one approving review, with stale reviews dismissed on
push and the last push requiring approval.

| Setting | Target value |
| --- | --- |
| `required_approving_review_count` | 1 |
| `dismiss_stale_reviews_on_push` | true |
| `require_last_push_approval` | true |
| `require_code_owner_review` | false, the repository has no CODEOWNERS file |
| `required_review_thread_resolution` | true |

That rule cannot be met in this repository today. There is one collaborator, and
the GitHub documentation states that a pull request author cannot approve their
own pull request. A count of 1 would therefore make every pull request
unmergeable. The exception must be explicit and must not be described as
independent review.

Proposed exception wording, to be used in the ruleset description and in the
pull request body.

> Solo maintainer exception. This repository has one collaborator. A required
> approval of 1 can only be satisfied by a second person, so while the
> maintainer is the sole collaborator the maintainer merges through a recorded
> bypass. Each such merge records the head sha, the exact commands that were
> run, the Node and pnpm versions, and what was inspected. A recorded bypass is
> not independent approval and must not be described as review by another
> person.

Mechanism. Add the maintainer as a bypass actor on the review ruleset only, with
`actor_type` of `User` and `bypass_mode` of `pull_request`. Do not use
`bypass_mode` of `exempt`, which the ruleset API documents as running no rules
and creating no bypass audit entry. The recorded bypass is what makes the
exception visible rather than silent.

Where the record lives. `bravew/Neumar` is owned by a user account, not an
organization, and the audit log endpoint returns 404 for it. The durable record
is therefore the ruleset itself. Both rulesets expose a version history,
`gh api repos/bravew/Neumar/rulesets/20760066/history` and
`gh api repos/bravew/Neumar/rulesets/20760091/history` both return real
versions, and the rule suites endpoint
`gh api repos/bravew/Neumar/rulesets/rule-suites` returns a real record for a
push to `refs/heads/main`. The pull request body carries the evidence for the
specific merge.

The evidence requirement needs enforcement of its own, because a ruleset cannot
check a pull request body. The complement is a workflow check that fails when a
pull request authored by the sole collaborator has no evidence block. That is a
separate change and is not part of this proposal.

While the repository has one collaborator, `require_extra_approval_for_unattributed_changes`
stays true in both existing rulesets. It adds an extra approval for Copilot
authored pull requests that are not attributed to a person, and it interacts
with the configured count.

## 5. Rollback

The rollback is one command per ruleset, and the current state is recorded here
so the pre-change state can be restored exactly.

If the maintainer adds new rulesets for the required check and the review rule,
rollback is a delete.

```bash
gh api -X DELETE repos/bravew/Neumar/rulesets/<new-ruleset-id>
```

Find the id first with

```bash
gh api repos/bravew/Neumar/rulesets --jq '.[] | "\(.id) \(.name)"'
```

If the maintainer instead edits the existing rulesets 20760066 and 20760091,
rollback is a single `PUT` back to the payloads in the appendix. The ruleset
history gives a second anchor. Version 47257031 is the current head version of
ruleset 20760066 and version 46393628 is the current head version of ruleset
20760091.

Verify the rollback with

```bash
gh api repos/bravew/Neumar/rules/branches/main --jq '[.[].type]'
gh api repos/bravew/Neumar/rulesets --jq '[.[].name]'
```

The first command must no longer list `required_status_checks`, and the second
must list only `main` and `protect main`.

## 6. Verification before relying on this

Run these after applying, on the exact branches that are targeted.

```bash
gh api repos/bravew/Neumar/rules/branches/main --jq '[.[].type]'
gh api repos/bravew/Neumar/rules/branches/epic%2F188-merge-gate --jq '[.[].type]'
gh api repos/bravew/Neumar/rulesets --jq '.[] | "\(.id) \(.name) \(.enforcement)"'
```

Three things could not be verified here and must be checked by the maintainer on
a throwaway pull request before the rule is trusted.

- The fnmatch pattern that covers epic branches. The documentation shows `qa/*`
  matching one slash and `qa/**/*` matching deeper names, and does not state how
  `refs/heads/epic/**` behaves for `epic/188-merge-gate`. Include both
  `refs/heads/epic/**` and `refs/heads/epic/**/*` and confirm with the rules for
  a specific branch.
- Whether a bypass actor on the review ruleset leaves the count of 1 satisfied
  by the count of 0 in the other two rulesets, or whether the bypass must be
  repeated. Confirm on a probe pull request.
- Whether `strict_required_status_checks_policy` on `epic/**` causes the rebase
  churn described in section 3.

The `evaluate` enforcement mode, which would allow testing rules without
enforcing them, is documented as available only with GitHub Enterprise, so the
rules cannot be dry-run on this repository.

## 7. What this document does not do

This document changes no repository setting. It adds no ruleset, edits no
ruleset, adds no bypass actor and no required status check. Nothing in it has
been applied. Applying it is a maintainer action that needs the maintainer's
decision, and that decision is not recorded yet. The maintainer should record
the decision as a comment on issue #199 before any setting changes.

The proposal is also narrower than it could be. It does not propose a CODEOWNERS
file, does not propose changing the allowed merge methods, and does not propose
a contributor probation or blocklist, which is tracked separately.

## Sources

Each link below was checked and resolves.

- Pull request #237, the probe, <https://github.com/bravew/Neumar/pull/237>
- Issue #199, <https://github.com/bravew/Neumar/issues/199>
- The run that produced the red `CI Gate`,
  <https://github.com/bravew/Neumar/actions/runs/38511301316>
- The `CI Gate` job in that run,
  <https://github.com/bravew/Neumar/actions/runs/38511301316/job/115681881006>
- The run that produced a green `CI Gate` on the epic head,
  <https://github.com/bravew/Neumar/actions/runs/38510500059>
- Ruleset 20760066, <https://github.com/bravew/Neumar/rules/20760066>
- Ruleset 20760091, <https://github.com/bravew/Neumar/rules/20760091>
- GitHub documentation on required status checks and skipped checks,
  <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks>
- GitHub documentation on rule layering, which states that the most restrictive
  version of a rule applies,
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets>
- GitHub documentation stating that pull request authors cannot approve their own
  pull requests,
  <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request>
- GitHub REST documentation for repository rulesets, which gives the
  `required_status_checks` parameters and the ruleset update and delete
  endpoints, <https://docs.github.com/en/rest/repos/rules>
- GitHub documentation on ruleset patterns, which describes fnmatch syntax,
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository>

## Appendix. Current ruleset payloads, for rollback

Ruleset 20760066, name `main`.

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["squash"]
      }
    }
  ],
  "bypass_actors": []
}
```

Ruleset 20760091, name `protect main`.

```json
{
  "name": "protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "required_reviewers": [],
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "copilot_code_review",
      "parameters": { "review_on_push": true, "review_draft_pull_requests": false }
    }
  ],
  "bypass_actors": []
}
```

Restore with `PUT /repos/bravew/Neumar/rulesets/20760066` and
`PUT /repos/bravew/Neumar/rulesets/20760091`. Confirm the required body fields
against the REST documentation for the update endpoint before sending, since
that endpoint takes a full ruleset representation.
