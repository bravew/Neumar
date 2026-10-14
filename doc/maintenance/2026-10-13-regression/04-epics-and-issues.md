# Epics and issues

The development plan is tracked as seven epics, one per checkpoint, and 37 sub-issues. Each sub-issue is written so one agent can implement it alone in its own git worktree. This page is the index. The issue bodies hold the scope, owned files, acceptance criteria, and verification commands, and they are the working copy. If an issue and this page disagree, fix the page.

## How the work flows

Each epic has a long-lived branch named `epic/<epic issue>-<slug>`, created from `main` by the maintainer. Sub-issues never target `main`. This follows the stacked-integration model recorded in [LESSONS.md](../../../LESSONS.md): one agent, one worktree, one branch, and validation of the final integrated head.

1. An agent picks a sub-issue with no open blocker and creates a worktree from the epic branch.
2. It commits only the files the issue owns, with a regression test that fails before the change and passes after it.
3. It opens a PR whose base is the epic branch and whose body says `Closes #<sub-issue>`.
4. A merged PR closes the sub-issue through [epic-close-issues.yml](../../../.github/workflows/epic-close-issues.yml), which acts on PRs merged into `epic/**` and skips the epic's own number.
5. When every sub-issue is closed, one epic PR merges the epic branch into `main` with `Closes #<epic>`. The PR records the head sha that `pnpm validate`, `pnpm test:fast` and the epic's surface checks ran on.

```bash
git fetch origin
git worktree add ../neumar-wt/<issue>-<slug> -b issue/<issue>-<slug> origin/epic/<epic>-<slug>
```

Worktrees give each agent its own index, so two sessions cannot commit each other's staged files ([git worktree](https://git-scm.com/docs/git-worktree)). A sub-issue lists its blockers. Do not start one until its blocker has merged into the epic branch.

## Epics

| Epic | Checkpoint | Branch | Sub-issues |
| --- | ---: | --- | ---: |
| [#188](https://github.com/bravew/Neumar/issues/188) reproducible merge gate and test isolation | 1 | `epic/188-merge-gate` | 5 |
| [#189](https://github.com/bravew/Neumar/issues/189) contain host execution and external I/O | 2 | `epic/189-containment` | 8 |
| [#190](https://github.com/bravew/Neumar/issues/190) repair FFmpeg publication, cancellation, and permission priority | 3 | `epic/190-ffmpeg-permissions` | 3 |
| [#191](https://github.com/bravew/Neumar/issues/191) restore transcript and shell integration contracts | 4 | `epic/191-transcript-shell` | 6 |
| [#192](https://github.com/bravew/Neumar/issues/192) remove proven orphans and obsolete allowances | 5 | `epic/192-dead-code` | 5 |
| [#193](https://github.com/bravew/Neumar/issues/193) resolve architecture ownership and reduce the highest-risk modules | 6 | `epic/193-architecture-ownership` | 7 |
| [#194](https://github.com/bravew/Neumar/issues/194) recurring maintenance and contributor quality policy | 7 | `epic/194-maintenance-process` | 3 |

Merge the epics into `main` in this order. E1 first, so later epic PRs run the repaired gate. Then E2 and E3, which fix the highest-risk defects. Then E4, E5, E6, and E7. Rebase an epic branch onto `main` before its final PR.

Each epic branch was created from the commit that added these documents, so the links in the issue bodies resolve on the epic branch.

## Sub-issues

### Epic #188 reproducible merge gate and test isolation

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#195](https://github.com/bravew/Neumar/issues/195) | fix(test): isolate runtime discovery in resolve.test.ts (R6) | R6 | fix | none |
| [#196](https://github.com/bravew/Neumar/issues/196) | ci: run quality and test jobs on every non-draft PR, including PRs into epic branches | merge-gate metrics in 03-lessons-and-contributors.md | change | none |
| [#197](https://github.com/bravew/Neumar/issues/197) | ci: add API lint, API test typecheck, video-ir validate, and changed-surface Rust checks | validate scope gap (README baseline table) | change | #196 |
| [#198](https://github.com/bravew/Neumar/issues/198) | chore(quality): baseline-aware gate for lint warnings, suppressions, and size ceilings | 453 warnings; allowlist ceiling raises (dd346af1) | change | none |
| [#199](https://github.com/bravew/Neumar/issues/199) | decide: required status checks and solo-maintainer review rule for main and epic branches | merge metrics: zero required checks, zero approving reviews | decision | #196 |

### Epic #189 contain host execution and external I/O

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#200](https://github.com/bravew/Neumar/issues/200) | fix(security): bind the daemon to loopback by default and require auth for remote mode (S1, P0) | S1 (P0) | fix | none |
| [#201](https://github.com/bravew/Neumar/issues/201) | fix(security): open files and editors without a shell command string (S2) | S2 | fix | none |
| [#202](https://github.com/bravew/Neumar/issues/202) | fix(security): validate and isolate sandbox package installation (S3) | S3 | fix | none |
| [#203](https://github.com/bravew/Neumar/issues/203) | fix(security): check file containment on the resolved path, including symlinks | files.ts:92 (additional work in 01-findings.md) | fix | #201 |
| [#204](https://github.com/bravew/Neumar/issues/204) | fix(security): route untrusted URL fetches through safeFetch (S7) | S7 (plus remote-oauth.ts and media-server.ts review) | fix | none |
| [#205](https://github.com/bravew/Neumar/issues/205) | fix(security): external MCP auth fails closed on missing peer address (S8) | S8 (P2) | fix | none |
| [#206](https://github.com/bravew/Neumar/issues/206) | fix(build): verify the native SQLite addon digest and key the cache by version (S9) | S9 | fix | none |
| [#207](https://github.com/bravew/Neumar/issues/207) | decide: Tauri CSP and capability narrowing, compatibility-tested | csp: null note in 01-findings.md | decision | none |

### Epic #190 repair FFmpeg publication, cancellation, and permission priority

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#208](https://github.com/bravew/Neumar/issues/208) | fix(ffmpeg): publish outputs exclusively inside the validated root (S4) | S4 | fix | none |
| [#209](https://github.com/bravew/Neumar/issues/209) | fix(ffmpeg): carry Stop through the MCP handler to the runner and the publication step (S5) | S5 | fix | #208 |
| [#210](https://github.com/bravew/Neumar/issues/210) | fix(permissions): an explicit ask or deny outranks run pre-approval (S6) | S6 | fix | none |

### Epic #191 restore transcript and shell integration contracts

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#211](https://github.com/bravew/Neumar/issues/211) | fix(video-ir): caption operation schema accepts the fields the compiler emits (R1) | R1 | fix | none |
| [#212](https://github.com/bravew/Neumar/issues/212) | fix(video): replacing a source transcript clears the word selection (R2) | R2 | fix | none |
| [#213](https://github.com/bravew/Neumar/issues/213) | fix(chat-dock): deliver the first prompt exactly once across close, slow load, and navigation (R3) | R3 | fix | none |
| [#214](https://github.com/bravew/Neumar/issues/214) | fix(automation): scope event waits for the dock and carries its category (R4) | R4 | fix | #213 |
| [#215](https://github.com/bravew/Neumar/issues/215) | fix(onboarding): setup reruns preserve an explicit plan-mode setting (R5) | R5 | fix | none |
| [#216](https://github.com/bravew/Neumar/issues/216) | decide: empty-caption restore, translation budget, and fork cost semantics | Consider items in 01-findings.md | decision | none |

### Epic #192 remove proven orphans and obsolete allowances

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#217](https://github.com/bravew/Neumar/issues/217) | chore(frontend): delete the old root app island and the nine obsolete size allowances | dead-code batch 1 and allowlist entries | change | none |
| [#218](https://github.com/bravew/Neumar/issues/218) | chore(api): remove proven orphan modules, one at a time | dead-code batch (API orphan candidates) | change | none |
| [#219](https://github.com/bravew/Neumar/issues/219) | chore(frontend): remove the gateway settings island after a route and feature parity check | dead-code batch (gateway settings island) | change | #217 |
| [#220](https://github.com/bravew/Neumar/issues/220) | chore(deps): remove dependencies proven unused after caller removal | dead-code batch (dependencies) | change | #217, #218, #219 |
| [#221](https://github.com/bravew/Neumar/issues/221) | decide: keep, finish, or retire test-only modules and dormant adapters | dead-code batch (test-only modules) | decision | none |

### Epic #193 resolve architecture ownership and reduce the highest-risk modules

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#222](https://github.com/bravew/Neumar/issues/222) | docs: channel responsibility matrix before choosing a canonical runtime | architecture debt (two channel registries, two Slack stacks) | decision | none |
| [#223](https://github.com/bravew/Neumar/issues/223) | chore: decide V1 task route retirement and make 501 surfaces truthful | unsupported routes; V1/V2 task routes | decision | none |
| [#224](https://github.com/bravew/Neumar/issues/224) | refactor(video): type the video tool wrapper so valid input compiles, then remove the test casts | tool typing (01-findings.md) | change | none |
| [#225](https://github.com/bravew/Neumar/issues/225) | test(db): run the full migration registry against fresh, current, and drifted snapshots | migration drift (01-findings.md) | change | none |
| [#226](https://github.com/bravew/Neumar/issues/226) | fix(api): app-owned data resolves through getAppDir() and honors NEUMAR_APP_DATA_DIR | app-data isolation (01-findings.md) | fix | none |
| [#227](https://github.com/bravew/Neumar/issues/227) | docs: update the architecture pages from the manifests, database call paths, and CI | docs drift (01-findings.md, prior architecture review) | docs | none |
| [#228](https://github.com/bravew/Neumar/issues/228) | refactor(video): extract one tested tool group out of video-edit-server.ts | hotspot growth table (01-findings.md) | change | #224 |

### Epic #194 recurring maintenance and contributor quality policy

| Issue | Title | Findings | Kind | Blocked by |
| --- | --- | --- | --- | --- |
| [#229](https://github.com/bravew/Neumar/issues/229) | docs(process): PR template that records intent, exact tested commit, and attribution | checkpoint 7 | docs | none |
| [#230](https://github.com/bravew/Neumar/issues/230) | docs(process): weekly and pre-release maintenance review with a report format | checkpoint 7 | docs | none |
| [#231](https://github.com/bravew/Neumar/issues/231) | docs(process): incident record template, empty blocklist schema, and policy replay | checkpoint 7; contributor policy in 03-lessons-and-contributors.md | docs | none |

## Files two sub-issues must not edit at once

| File | Order |
| --- | --- |
| `.github/workflows/ci.yml` | #196, then #197 |
| `src-api/src/app/api/files.ts` | #201, then #203 |
| `src-api/src/shared/services/ffmpeg-skill/handoff.ts` | #208, then #209 (abort check only) |
| `src/components/chat-dock/ChatDock.tsx` | #213, then #214 |
| `packages/video-ir/src/timeline-schema.ts` | #211 owns it for the epic, other streams rebase after it |
| `src-api/src/shared/mcp/video-edit-server.ts` | #224, then #228 |
| `src-api/src/http-daemon.ts` | #200 only |
| `scripts/component-size-allowlist.json` and locale modules | #217, then #219, then #223 if UI text changes |
| `package.json` and `pnpm-lock.yaml` | #220 runs after #217, #218, #219. #197 may add scripts first. |

Across epics the same files can collide when the epic PRs reach `main`. The merge order above settles that. If two open epics need the same file, comment on both issues and let the earlier epic merge first.

## Decisions that need the maintainer

These issues carry the `needs-decision` label. Record the decision as a comment on the issue before any dependent change merges.

- [#199](https://github.com/bravew/Neumar/issues/199) decide: required status checks and solo-maintainer review rule for main and epic branches
- [#207](https://github.com/bravew/Neumar/issues/207) decide: Tauri CSP and capability narrowing, compatibility-tested
- [#216](https://github.com/bravew/Neumar/issues/216) decide: empty-caption restore, translation budget, and fork cost semantics
- [#221](https://github.com/bravew/Neumar/issues/221) decide: keep, finish, or retire test-only modules and dormant adapters
- [#222](https://github.com/bravew/Neumar/issues/222) docs: channel responsibility matrix before choosing a canonical runtime
- [#223](https://github.com/bravew/Neumar/issues/223) chore: decide V1 task route retirement and make 501 surfaces truthful

Two fix issues also carry a decision. The permission priority in [#210](https://github.com/bravew/Neumar/issues/210) has a recommended default on the issue. The remote-mode contract in [#200](https://github.com/bravew/Neumar/issues/200) starts with a caller inventory.

## Known baseline

`pnpm test:fast` fails at `src-api/test/unit/agent-runtimes/resolve.test.ts:251` on hosts with Homebrew OpenCode until [#195](https://github.com/bravew/Neumar/issues/195) lands. A PR that hits only that failure names it, with the sha it ran on, instead of calling it a regression.
