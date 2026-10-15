# Regression review and maintenance plan

Date: 2026-10-13. Reviewed baseline: `c0926618`, version 26.10.1. Status: review completed; remediation tracked as GitHub epics #188 to #194, not yet executed. This document records a sampled architecture and regression review, not certification of every file or dependency.

## Start here

1. [Findings and evidence](01-findings.md) records current defects, dead-code candidates, architecture drift, and verification limits.
2. [Development plan](02-development-plan.md) gives seven independently verifiable checkpoints, their dependencies, and decisions needed before implementation.
3. [PR lessons and contributor policy](03-lessons-and-contributors.md) records merge failures, validation gaps, and the evidence required for probation or blocking.
4. [Epics and issues](04-epics-and-issues.md) indexes the seven epics and 37 sub-issues, the worktree and epic-branch workflow, and the files that two streams must not edit at once.

The rules this review produced live in [LESSONS.md](../../../LESSONS.md) at the repository root, which [AGENTS.md](../../../AGENTS.md) tells every agent to read before changing code. The documents here hold the evidence behind those rules. Add new lessons to the root file, not to these pages.

The main problem is that changes can merge without exercising their contracts. Recent examples include FFmpeg publication and cancellation, transcript schema validation, chat-dock prompt handoff, and permission precedence. Earlier security boundaries also need review. Removing unused code will help, but it cannot substitute for fixing these paths and preventing another unchecked merge.

## Baseline verification

| Check | Result at the reviewed baseline |
| --- | --- |
| `pnpm validate` | Passed, exit 0. It emitted 453 frontend lint warnings. |
| Frontend portion of `pnpm test:fast` | 402 files, 1,789 tests passed. |
| API portion of `pnpm test:fast` | 594 files passed, 1 failed, 3 skipped; 3,860 tests passed, 1 failed, 7 skipped. Overall command exited 1. |
| `pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit` | Passed in the delegated validation review. Includes API tests. |
| `pnpm --filter neumar-api lint` | Passed with warnings in the delegated validation review. |
| `pnpm check:ffmpeg-skill` | Passed in the delegated recent-PR review. Local pin/hash integrity only. |
| Rust, packaged desktop, browser E2E, live providers, gate evals, independent upstream payload comparison | Not run in this review. |

The failed API test is `test/unit/agent-runtimes/resolve.test.ts:251`. It expects the temporary npm-global OpenCode fixture, but the resolver finds the host's Homebrew OpenCode first. Source inspection confirms that the test uses the real filesystem despite stubbing HOME/PATH. Both the test and that search order originate in initial commit `83c425bb`. Fix test isolation and assert precedence separately; do not change production precedence to satisfy this fixture.

The local runner used Node v26.11.1 and the pinned pnpm 11.22.0. Repeat the failing case under the supported Node 22 CI baseline when fixing it. Do not interpret the local failure as proof that production runtime discovery is broken.

## Decisions made during this review

- Use an evidence-based agent policy and attribution gate. No contributor names have been added to a blocklist.
- Map channel ownership, capabilities, permissions, persistence, and webhooks before proposing a canonical runtime. Preserve all live consumers during that work.
- Trace callers and visibility of unsupported API actions first. Hide misleading controls or document intentional capability limitations; feature implementation requires a separate behavior decision.
- Keep the review and plan in `doc/`. Existing local work is outside this deliverable.

The requested recurring cleanup is defined as a maintenance process in checkpoint 7. Each checkpoint became an epic with its own branch, and each unit of work became a sub-issue ([index](04-epics-and-issues.md)). No scheduler, repository setting, contributor access restriction, or external post has been created. The epic branches are pushed, but no implementation has started.

## Review coverage and prior architecture work

Six bounded reviews covered dead-code reachability, recent feature PRs, older video/dependency PRs, architecture conventions, security/supply chain, and validation quality. The coordinator checked load-bearing source excerpts and corrected several overbroad scan conclusions. Codegraph was unavailable for this checkout; no index was installed or regenerated. Knip's exploratory run did not finish cleanly, so its totals are leads rather than an unused-code inventory.

Prior material inspected includes the local June architecture audit at `dev-doc/Revamp/06-21/01-current-state-audit.md` and May channel rollout audit at `dev-doc/channels/rollout-audit-2026-05-03.md`, plus tracked architecture docs. Those local historical audits are not portable dependencies of this plan. Their observations were rechecked against current code where used. The June audit already identified runtime/tool duplication and large modules. Its proposed new shared engines are design ideas, not evidence that those engines now exist.

No malicious code or live service credential was identified in the inspected areas. Security defects and missing controls are documented as defects, without claims about contributor intent. The static scans do not prove the absence of malicious dependencies, undiscovered vulnerabilities, or removed credentials throughout history.

## Completion for this deliverable

The documentation review is complete when the files and source links have been checked, the root gate result and test failure are reported, and the documents, `LESSONS.md`, and the `AGENTS.md` pointer are committed locally. Implementation is complete only after each epic's sub-issues have merged into its epic branch with before/after regression evidence, and the epic PR has merged into `main` on a head that passed the epic's checks. The current plan does not claim those fixes have landed.
