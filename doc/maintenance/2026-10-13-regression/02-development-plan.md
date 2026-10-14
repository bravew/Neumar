# Development plan

Status: ready for checkpoint review, not yet implemented. Baseline `c0926618`. Finding IDs refer to [the evidence register](01-findings.md). The first objective is containment and reliable validation; deletion and restructuring follow verified caller maps.

## Throughput and ownership

1. **Blocking first steps.** Record the baseline and repair the host-dependent test in checkpoint 1. Security containment in checkpoint 2 should begin immediately in parallel; do not wait for a broad cleanup to fix S1. Required repository checks must be made executable before making them merge requirements.
2. **Independent workstreams.** CI/test infrastructure, API network/process boundaries, FFmpeg lifecycle, transcript contracts, and shell/onboarding fixes can be investigated in parallel. Keep each implementation PR narrow and independently testable.
3. **Shared mutable state.** Serialize edits to `package.json`, `pnpm-lock.yaml`, locale modules, the size allowlist, `http-daemon.ts`, `video-edit-server.ts`, and common video IR schemas. Assign one owner per shared file during each batch. Rebase and rerun affected integration tests after another stream changes a shared contract.
4. **Smallest safe decomposition.** Seven checkpoints below; several contain small independent PRs. No single “cleanup everything” PR. No new framework, dependency upgrade, or generic abstraction is required just to start this work.

## 1. Establish a reproducible merge gate

**Likely files:** `.github/workflows/ci.yml`, existing workflow checks, root/API package scripts and configs, `src-api/test/unit/agent-runtimes/resolve.test.ts`, repository rulesets through a separately approved settings change.

**Work:**

- Isolate runtime discovery tests through the existing `PathDiscoveryOptions` seam. Cover npm-only discovery and Homebrew precedence independently.
- Run quality and test jobs on ordinary non-draft PRs and the final integration branch. Include dependency-bot changes; do not silently exempt the very changes that can alter behavior.
- Run `pnpm validate`, API lint, and API test-file typechecking. Add changed-surface gates for video IR and Rust. Ensure required jobs report a stable aggregate result even when a workspace-specific job is skipped legitimately.
- Use baseline-aware checks for existing lint/size debt. Reject new suppressions or warning growth in changed code unless a reviewed exception has an owner, reason, expiry, and regression coverage. Avoid turning all existing warnings into an immediate unrelated cleanup requirement.
- After proving check names and triggers on a harmless PR, propose required status checks and an independent review rule. Repository settings are not changed by this plan. A solo-maintainer exception must be explicit and retain review evidence, rather than pretending self-review is independent approval.

**Observable result:** a feature PR cannot appear ready while quality/test jobs are absent or skipped; local and CI test discovery use the same workspace scripts.

**Verification:**

```bash
pnpm test:api test/unit/agent-runtimes/resolve.test.ts
pnpm validate
pnpm --filter neumar-api lint
pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit
pnpm test:fast
pnpm test:gate
```

Inspect Actions on the exact PR head. Deliberately introduce a reversible failure on a temporary validation branch to prove the required aggregate blocks merge, then remove it and confirm success. Use actionlint for edited workflows with pinned Actions and quoted env inputs. Do not merge the failing probe.

**Exit:** R6 fixed; repeatable check results recorded with Node/pnpm versions; gate and ruleset proposal reviewed. Record unavailable credentials/platform checks explicitly.

## 2. Contain host execution and external I/O

**Likely files:** `src-api/src/http-daemon.ts`, `app/middleware/jwt.ts`, `app/api/{sandbox,files}.ts`, `extensions/sandbox/claude.ts`, `shared/network-policy/`, identified URL consumers, `shared/services/external-mcp/auth.ts`, `src-api/scripts/build.mjs`, Tauri configuration where necessary.

**Work:**

- Address S1 first in a small compatibility-tested change. Default daemon mode binds loopback; explicit remote mode requires authentication before privileged routes are available. Account for packaged desktop and intended WebUI clients.
- Remove shell interpolation from file opening and sandbox package operations, keeping package execution inside the stated isolation boundary.
- Fix actual filesystem containment gaps with existing policy helpers and operation-specific trusted roots. Handle symlinks and nonexistent write targets; do not reduce legitimate desktop roots to a blanket workspace-only rule.
- Move untrusted downloads and OAuth discovery to the existing network policy, with DNS-bound connections, redirect checks, timeout and byte limits. Preserve intentionally local integrations through explicit policy.
- Fail closed on missing MCP socket metadata and verify native binary cache/download integrity. Stage CSP/capability changes separately if they affect supported preview workflows.

**Observable result:** default launch exposes no unauthenticated LAN host-execution surface; filenames remain literal; sandbox preparation stays isolated; untrusted targets cannot bypass network policy; downloaded native code has verified provenance.

**Verification:** focused route, sandbox, network-policy, external-MCP and file-policy tests through `pnpm test:api <test-path>`; isolated real daemon socket/auth smoke; mock opener assertions for hostile filenames; symlink/redirect/private-address/oversize tests; tampered download/cache fixtures; then `pnpm validate`, API lint and full API typecheck. For Tauri changes run `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo check --manifest-path src-tauri/Cargo.toml --locked`, relevant Cargo tests, and a packaged/local desktop smoke. Never test against the user's active data directory.

**Exit:** S1-S3 and verified containment/network/build-integrity findings fixed or explicitly held with owner and evidence. No exploit payloads or credentials committed into public documentation.

## 3. Repair FFmpeg publication, cancellation, and permission priority

**Likely files:** `shared/services/ffmpeg-skill/{runner,handoff,policy}.ts`, `shared/mcp/ffmpeg-skill-server.ts`, relevant bridge/run cancellation wiring, `extensions/agent/claude/permissions.ts`, corresponding API tests.

**Work:**

- Allocate unique, exclusive final outputs inside the owner's validated root. Apply checks at final publication, not only staging. Persist file/output records only after successful publication; define cleanup on DB failure.
- Connect Stop to the process supervisor through MCP and bridge execution. Prevent delayed publication after cancellation, including cancellation between process completion and handoff.
- Preserve explicit deny/ask policies over general pre-approval. Represent explicit ask separately from default classification if the current result type loses that information.

**Observable result:** repeating an operation cannot replace previous/source files; Stop ends processing and creates no deliverable; explicit permission rules are respected in interactive and headless runs.

**Verification:** real FFmpeg fixture tests for repeated outputs and cancellation; handler-level/bridge tests with delayed children; destination symlink/collision tests; permission matrix including allowedTools + explicit ask/deny. Run targeted API tests, `pnpm check:ffmpeg-skill`, API lint/typechecks, `pnpm validate`, then relevant broader tests. Preserve the vendored payload and pin unless a separately reviewed upstream fix is required.

**Exit:** S4-S6 closed with tests that fail on the reviewed baseline and pass after the fix. Direct runner unit tests alone do not satisfy cancellation acceptance.

## 4. Restore transcript and shell integration contracts

**Likely files:** `packages/video-ir/src/{timeline-schema,timeline-types,transcript-edit}.ts`, transcript UI/store and API route tests, `ChatDock.tsx`, `InitialMessageSender.tsx`, `OutcomeAutomationLists.tsx`, `OnboardingFlow.tsx`, relevant locales.

**Work:**

- Align caption runtime schemas with the typed/compiler contract; test the real API operation boundary and persisted reload.
- Invalidate selection when source transcript identity changes without losing valid selection merely because the panel mounts.
- Make initial prompt delivery durable and exactly once across dock close, slow load, navigation, retries, and reopened tasks. Use existing run/message contracts rather than adding a second execution path.
- Carry automation category and labeled scope answers through dock mounting and submission.
- Preserve explicit plan-mode settings on onboarding reruns. Apply fresh-install defaults only when no explicit preference exists.
- Resolve empty-caption restore and translation-budget decisions before implementing their behavior changes. Reproduce fork-cost behavior separately before changing accounting.

**Observable result:** generated captions can be edited/saved/reloaded, transcript replacement cannot edit old indices, the dock cannot lose or duplicate a send, automation retains scope, and setup preserves user choices.

**Verification:** workspace-specific frontend/API regression files; `pnpm --filter @neumar/video-ir test` and `validate`; `pnpm validate`; API test typecheck; `pnpm test:fast`. Add a focused browser scenario for dock lifecycle and transcript editing against an isolated temporary API, and explicitly run it using the project's Playwright configuration. Seeding a transcript is acceptable for editing tests but is not evidence of working live ASR or translation.

**Exit:** R1-R5 closed; intentional exclusions and live-provider checks recorded. Six-locale parity holds for any new UI text.

## 5. Remove proven orphans and obsolete allowances

**Likely files:** the dead-code candidate islands in `01-findings.md`, tests/locales used exclusively by retired code, `scripts/component-size-allowlist.json`; manifests/lockfile only after a dependency is proven unused.

**Work:**

- Build a checked inventory of static/dynamic imports, registration, CLI/build entry points, desktop consumers, and plugin manifests. Start with the old root app island and a small API orphan batch.
- Remove each proven island and its exclusive tests/exports/locales in one coherent PR. Do not use Knip's incomplete scan or untracked WIP as deletion authority.
- Remove the nine allowances whose files already satisfy the default limit. Ratchet remaining ceilings downward when extraction genuinely reduces a file.
- Evaluate dependency candidates after caller removal. Preserve lockfile resolution for unrelated packages and check packaged assets/peer/binary use.
- Treat test-only code as an implementation/retirement question. Keep the live V1 route, both shells, channels, publish feature gates, and extension APIs until their contracts are decided.

**Observable result:** each deletion has a verified former entry graph and no dangling runtime/locale/config reference; ordinary files no longer receive unnecessary size exemptions.

**Verification:** exact-path/symbol searches across all workspaces and registration/config sources; affected tests; production frontend/API builds for changed entry graphs; locale parity, plugin registry, component size and `pnpm validate`; inspect generated/build diffs. Compare exported tool/route inventories where relevant. Do not commit generated files incidentally.

**Exit:** a small documented removal batch passes checks. Counts of deleted lines are secondary to preserved behavior.

## 6. Resolve architecture ownership and reduce the highest-risk modules

**Likely files:** channel/runtime contract docs, `core/agent/`, `shared/channels/`, `shared/services/gateway/`, legacy Slack wiring, video tool wrapper and schemas, DB migration utilities/tests, shared catalogs, selected hooks/components, tracked `doc/` architecture pages.

**Work:**

- Produce a channel responsibility matrix covering each provider, inbound webhook, credentials, user identity, permissions, persistence, scheduling and stop behavior. Choose a canonical runtime only after reviewing this matrix.
- Decide V1 task compatibility and unsupported-route visibility. Where a feature is deliberately unavailable, make the capability response/UI truthful. Keep revival work separate from deletion work.
- Fix the video reference wrapper's generic type contract before extracting tool groups. Migrate callers and remove the superseded internal helper in the same PR. Preserve tool names and wire schemas.
- Audit supported migration upgrade histories and missing-table behavior. Add drift fixtures that execute the complete registry; preserve applied version identities.
- Split modules by current responsibility, starting with tested seams in `video-edit-server.ts`, the Claude adapter, or `useAgent`. Shared catalog extraction is warranted only when it removes a real duplicated contract and has no runtime-specific dependencies.
- Update architecture docs from current code, including storage, entry points, supported runtimes, and check coverage. Historical audit recommendations must not be described as implemented architecture.

**Observable result:** each live subsystem has an explicit owner and contract; selected type/upgrade hazards are covered; one large module is smaller without a second compatibility implementation left behind.

**Verification:** old/new route, tool and event behavior comparison; typed valid/invalid input checks; channel contract fixtures and approved live-provider smoke where available; full migration registry tests on fresh/current/drifted snapshots; source/runtime tests and `pnpm validate`; review docs links against actual call paths. For unavailable provider credentials state exactly what remains unverified.

**Exit:** reviewed architecture decisions and at least one independently verified extraction. No broad rewrite is justified solely by file size.

## 7. Make maintenance recurring and contributor quality reviewable

**Likely files/settings:** `doc/maintenance/`, contribution/PR templates if adopted, existing validation scripts, narrowly scoped CI reports, repository rulesets after separate approval.

**Work:**

- Every PR records intent, affected contracts, regression evidence, exact tested commit, unverified cases, and tool/session attribution when known. A model name in product code does not identify the code author.
- Every corrective PR records the introducing change if proven, failing scenario, why the existing gate missed it, and the prevention test/check. Link the original finding and close it only when verified.
- Once per week, and before each release, review new warnings/suppressions, size-ceiling increases, orphan candidates, unsupported feature surfaces, migration changes, security findings, and unresolved regressions. Publish a small repository report and select bounded cleanup PRs. Scheduling this process is a separate implementation action; this plan does not claim a live recurring job.
- Apply the probation/block policy in `03-lessons-and-contributors.md` only to verified, attributable repeated defects. Keep appeals, expiry, and remediation criteria. Treat malicious intent as a separate evidence question.
- Measure escaped regressions, time to repair, required-check execution, unresolved high-priority findings and expired exceptions. Do not reward deletion count or punish every follow-up fix.

**Observable result:** maintenance has an owner, cadence, open findings, verification artifacts and expiring exceptions; repeated quality failures lead to reviewable action rather than unsupported accusations.

**Verification:** replay the policy against the documented historical cases, ensuring stacked PRs/manual CI/different authors are handled correctly; test changed checks with clean and failing fixtures; inspect attribution/privacy and blocklist schema; verify reports contain source/PR links and exact check outcomes.

**Exit:** agreed cadence and owner; enforceable gate definitions; policy accepted with no speculative entries.

## Open decisions before dependent implementation

- Is remote HTTP operation required by default launchers, or only explicit remote mode? Inventory callers first; default loopback is the proposed containment.
- Should explicit `alwaysAsk` override run pre-approval? Recommended yes, consistent with explicit user choice. Preserve explicit deny regardless.
- Should transcript restore ignore unrelated empty caption tracks, and which translation operations consume project budgets?
- Retire `/task/:taskId` with tested redirects, or maintain V1 compatibility? Both routes are currently live.
- Keep, implement, or retire test-only services, social publishing adapters and dormant plugin APIs after caller/consumer review?
- Who owns weekly maintenance and security follow-up, and what solo-maintainer review exception is acceptable?

The user selected contract mapping before channel consolidation and visibility review before changing placeholder features. Those decisions permit the investigations above; they do not authorize silently choosing a new channel runtime or implementing all stubs.

## Plan readiness

The checkpoints define observable results and verification. Start with checkpoint 1 and urgent S1 containment after selecting implementation scope. Revise any checkpoint whose caller inventory changes its boundaries. Stop only the dependent branch of work when a behavior decision or unavailable platform/provider blocks it; continue independent authorized work. No checkpoint is complete just because its unit tests pass while its required integration boundary remains untested.
