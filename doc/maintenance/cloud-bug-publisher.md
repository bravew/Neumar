# Cloud bug fix worker and restricted publisher

Status: contract, policy validator, verification report, and tests. Nothing is
wired into a workflow, no GitHub App is installed, no token exists, and this
change does not push, open a PR, or call GitHub. Enablement remains the
checklist in the monitor runbook (section 10 of
`doc/maintenance/cloud-issue-monitor.md`, added by #361).

This is checkpoint 2 of epic #358 and builds on #361's read-only monitor. The
monitor decides whether an issue may be attempted and owns the durable claim.
This document defines what the worker may do, what the publisher must check
immediately before a push, and how the publisher avoids duplicate PRs.

Related material:

- Implementation: [`scripts/bug-publisher/`](../../scripts/bug-publisher/)
- Tests: [`src/__tests__/scripts/bugPublisher.test.ts`](../../src/__tests__/scripts/bugPublisher.test.ts)
- Claim, label, and stop-switch contract:
  `doc/maintenance/cloud-issue-monitor.md` (added by #361; merge that
  sub-issue before this one)
- Repository policy: [AGENTS.md](../../AGENTS.md), [LESSONS.md](../../LESSONS.md)

## 1. Privilege split

The worker and publisher are separate steps with separate credentials. A
worker never receives a token the publisher holds, and the publisher never runs
worker code.

| | Unprivileged worker | Restricted publisher |
| --- | --- | --- |
| Repository access | read-only checkout | push to one owned branch |
| Credentials | model credentials only | GitHub App installation token |
| Writes | a patch and a verification report | branch push, PR create/update |
| GitHub identity | none | App installation, not `GITHUB_TOKEN`, not a PAT |
| Failure mode | clean abort with a report | refuse to push or open a PR |

The publisher uses a GitHub App installation token because GitHub suppresses
`ci.yml` and review workflows for PRs created with the workflow `GITHUB_TOKEN`
(already noted in `.github/workflows/release.yml`). A personal access token is
also rejected so the App is the PR author and `bravew` can review normally.

The token's installed permissions must be a subset of:

| Permission | Level |
| --- | --- |
| `contents` | `write` |
| `pull_requests` | `write` |
| `issues` | `read` or `write` (commenting needs write) |
| `metadata` | `read` |

Anything else, including `workflows`, `administration`, `secrets`, and
`actions`, fails closed. The App installation must not be a bypass actor for
`main`, release branches, or `epic/**` rulesets. GitHub App tokens are
repository-scoped, so the "owned branch only" limit is enforced by the
publisher code and by branch protection, not by token scope.

## 2. Worker contract

`prepareUnprivilegedWorker` refuses to start unless all of these hold:

- the issue number, claim `runId`, and claim `epoch` are present;
- the branch is exactly `agent/issue-<N>-<slug>` for this issue;
- the base is a full git SHA;
- the runner declares `repoAccess: 'read-only'`;
- the sandbox is an absolute path inside the runner's temp root, outside the
  host home and outside the repository.

`scrubWorkerEnvironment` then removes every credential the worker must not
hold, including `GH_TOKEN`, `GITHUB_TOKEN`, `ACTIONS_*`, `PUBLISHER_*`,
`AWS_*`, `R2_*`, `CLOUDFLARE_*`, signing/notarization variables, and SSH/GPG
agent sockets. It relocates `HOME`, `XDG_*`, `GH_CONFIG_DIR`, git config,
`TMPDIR`, the npm cache, and `NEUMAR_APP_DATA_DIR` into the sandbox. A
non-credential variable such as `PATH`, `LANG`, or a model key is preserved.

The worker produces:

- one commit series on the owned branch, authored by the App identity;
- a regression test that fails on the pinned base SHA and passes on the
  proposed head SHA, at the real caller boundary;
- a structured verification report (section 3).

If the reported behavior cannot be reproduced, the worker calls `abortWorker`
and stops. The report says `reproduced: false` and `aborted: true`; the
publisher refuses it and no PR is opened.

## 3. Verification report

`validateVerificationReport` accepts only a report for the exact issue, claim,
branch, base SHA, head SHA, and changed-file set. Required evidence:

| Field | Requirement |
| --- | --- |
| `reproduced` | `true` |
| `regression.testPath` | repository-relative test path |
| `regression.command` | the exact command that was run |
| `regression.callerBoundary` | the route, handler, bridge, or publisher boundary |
| `regression.failsOnBase` / `passesOnHead` | both `true` |
| `regression.baseSha` / `headSha` | match the pinned base and proposed head |
| `sanitization.appDataDir` | absolute temp path, not inside the host home |
| `sanitization.hostHomeUntouched` | `true` |
| `sanitization.thirdPartyCalls` | `none` or `stubbed` |
| `sanitization.credentialsPresent` | `false` |
| `checks` | every required check `passed` |
| `changedFiles` | exactly the files in the patch |
| `prTemplate` | title at most 70 characters, exact head SHA, Node and pnpm versions, attribution, intent, affected contracts, verification summary, corrective fields or `not applicable`, `closesIssue` equal to the bug issue |

Required checks are derived from the changed files:

- always `pnpm validate`;
- `src-api/`: `pnpm --filter neumar-api lint` and
  `pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit`;
- `packages/video-ir/`: `pnpm --filter @neumar/video-ir validate` and
  `pnpm --filter @neumar/video-ir test`;
- `src-video/`: `pnpm --filter @neumar/video validate`;
- `src-tauri/`: `cargo check --manifest-path src-tauri/Cargo.toml --locked`
  and `cargo fmt --manifest-path src-tauri/Cargo.toml --check`.

`buildPullRequestBody` renders those fields into the repository PR template.
The body must contain exactly one closing keyword, and it must name the bug
issue, not epic #358.

## 4. Publisher pre-push checks

`publishBugFix` is the only entry point that mutates GitHub. In order:

1. **Static contract.** Issue, claim, owned branch, target base, identity,
   base/head SHAs, report head/base, and `reproduced` are checked first.
2. **Patch policy.** The hard deny-list and frozen-debt comparison in section 5.
3. **Report validation.** Section 3.
4. **Preflight.** Read the durable state, call the injected `verifyClaim`, and
   re-read the issue. The issue must be open, a bug, not held, not
   `needs-decision`, not security-sensitive, not reclassified as
   `enhancement`/`epic`, and its approval must still resolve to `approved`.
5. **PR duplicate guard.** List open PRs. Refuse if another branch already
   closes the issue, or if the owned branch has more than one open PR. This
   happens before the push so a duplicate does not leave an orphan branch.
6. **Push safety.** Refuse a non-fast-forward, a commit not authored by the
   App bot, a missing commit list, or a list that does not end at the local
   head. A restart where the remote head already equals the local head skips
   the push.
7. **TOCTOU re-check.** Immediately before `git.push`, repeat the claim and
   issue checks and re-read the branch state through the injected
   `readBranchState` (remote head and commits ahead of base). Refuse if a human
   commit appeared, the push would not be a fast-forward, or the state is
   unreadable. After the push, re-read it once more and refuse to continue if
   the remote head is no longer the reviewed head. Then repeat the
   claim/approval check once more before creating or updating the PR, because a
   restart after a push still mutates GitHub.
8. **Idempotent PR.** Re-list open PRs. Update the one owned PR, or create one.
   If the create response is lost, re-list and adopt the PR that exists. The
   final list must contain exactly one open PR on the owned branch.

The injected `verifyClaim` and `resolveApproval` are #361's contract:

```js
verifyClaim(state, { issue, runId, epoch }, now)
// => { ok: boolean, reason: 'ok' | 'disabled' | 'no-claim'
//      | 'claim-superseded' | 'lease-expired' }

resolveApproval(freshIssue, trustedActors, config)
// => { status: 'approved' | 'absent' | 'untrusted' | 'unverifiable' }
```

The modules do not import the monitor directly, so this change does not depend
on #361 being merged first. The production wiring passes the monitor's own
functions.

## 5. Hard path and policy deny-list

The publisher refuses a patch that touches any of these paths, regardless of
what the issue says:

| Category | Paths |
| --- | --- |
| CI and repository automation | `.github/**` |
| Desktop capabilities and signing config | `src-tauri/capabilities/**`, `src-tauri/tauri.conf.json`, `src-tauri/entitlements.plist` |
| Release, publish, R2, build, signing scripts | `scripts/release*`, `scripts/publish*`, `scripts/r2-upload*`, `scripts/build.sh`, `scripts/sign-*` |
| Brand identity | `branding/**`, `branding.json` |
| Shared policy docs | `AGENTS.md`, `LESSONS.md`, `CLAUDE.md` |
| Dependency manifests and lockfiles | any `package.json`, `pnpm-lock.yaml`, `Cargo.toml`, `Cargo.lock` unless the trusted approval record names that exact path |

Authorization is an exact repository path, never a glob and never a sentence
parsed out of issue text. It only unlocks dependency manifests and lockfiles;
it cannot unlock the hard deny-list.

Frozen debt is compared against the base branch, not merely inspected:

- `scripts/component-size-allowlist.json`: reject a new entry or any `current`
  ceiling increase. Lowering or removing an entry is allowed.
- `scripts/lint-warning-baseline.json`: reject any new or increased warning
  count, any new or increased suppression count, any new or edited exception,
  and any version change. Reducing debt is allowed.
- If either file is touched and the base/head contents are missing or
  unparseable, the publisher fails closed.

This is the machine-checkable form of the `AGENTS.md` and `LESSONS.md` rules
against raising a threshold or adding a suppression to make a gate pass.

## 6. GitHub App installation token

`scripts/bug-publisher/github-app.mjs` reads only
`PUBLISHER_APP_ID` and `PUBLISHER_APP_PRIVATE_KEY` from the environment. It
does not read a key file, does not fall back to `GITHUB_TOKEN`, and never logs
the token. `createAppJwt` builds an RS256 JWT with `iat` 60 seconds in the past
and a 9-minute lifetime. `exchangeInstallationToken` POSTs to
`/app/installations/<id>/access_tokens`, validates the returned permissions
against the table in section 1, and returns the token and expiry.

The installation id is an explicit argument, not a third credential. The tests
generate a throwaway RSA key and inject a fake fetch; they do not use a real
key, do not contact GitHub, and do not install an App.

## 7. What the tests cover

Run the focused suite:

```bash
pnpm test src/__tests__/scripts/bugPublisher.test.ts
```

The suite covers:

- every hard deny-list category, every manifest, unsafe path spellings, exact
  authorization, and allowlist/warning-baseline growth;
- branch ownership and target-base rules;
- least-privilege App identity and forbidden installation-token permissions;
- report validation: reproduction, base/head drift, regression evidence,
  required checks, changed-file parity, sanitization, PR template, and closing
  only the bug issue;
- worker environment scrubbing, sandbox isolation, read-only enforcement, and
  clean abort;
- push safety: human commits, non-fast-forward, missing commit evidence;
- publisher scenarios: fresh create, restart after push, lost PR-creation
  response, repeated publish, inability to reproduce, policy and report
  refusals, non-App identity, wrong target base, duplicate PRs, closed/held/
  reclassified issues, approval withdrawn between claim and push, a human
  commit appearing between preflight and push, a branch that changes after the
  push, and the kill switch (`disabled`, `lease-expired`,
  `claim-superseded`).

No test executes git, `gh`, a real GitHub API call, or a model. The sandbox is
a temp directory, so the suite does not touch the host home.

## 8. Known gaps

These are enable-time checks, not claims of this change:

- No real branch was pushed and no real PR was created. The tests prove the
  contract with injected fakes; they do not prove that a live App-created PR
  triggers `ci.yml` and the review workflow. That is #363's demonstration.
- The Contents API state binding and the intake workflow do not exist yet.
  Production must pass the monitor's real `verifyClaim` and `resolveApproval`.
- The publisher assumes the runner has already read the base and head copies of
  the allowlist and warning baseline from git. That reader is not part of this
  module.
- `scripts/` is outside oxlint's scope and the `.mjs` files are not type-checked
  against `index.d.mts`. Keep the declaration file in step with the
  implementation.
- The "regression test fails on base, passes on head" evidence is validated,
  not executed, by this suite. The worker run that produces it is the real
  demonstration.
