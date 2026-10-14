<!-- reviewed-through: c0926618 (2026-10-13) -->
# Lessons from merged work

Neumar's code is written, reviewed, merged, and released by agents and by the
maintainer. Each review of merged work records what had to be fixed again, what
should not have merged, and what was verified too thinly. Read this before
changing code.

Each lesson is a rule, then why, then the evidence. "Seen" counts the separate
review days that found it. A lesson seen on three review days moves into
[AGENTS.md](AGENTS.md), so every agent applies it without a separate read.

The first review is 2026-10-13, covering merged PRs #1 to #187 and the tree at
`c0926618`. It is the only review so far, so every lesson below is "Seen 1x".
Several lessons have many instances inside that one review, and the instance
count is part of the evidence. The full review lives in
[doc/maintenance/2026-10-13-regression](doc/maintenance/2026-10-13-regression/README.md).

## Validation

**A check that skips your change is not validation. Run the closest check on the
exact commit you want merged, and write down what ran.**
- The automatic quality and test jobs in `.github/workflows/ci.yml` run only on
  `release/*` or `release-v*` heads. 77 of 84 merged PRs never ran them. Every PR
  still showed green check names, because audit and manifest jobs do run.
- #176 repaired frontend tests that #175 had broken. The tests were never run for
  #175. #176 passed only because someone dispatched CI by hand on its commit.
- Four release PRs merged with a quality or Test failure already completed on the
  matching head: #2, #24, #26, #106. A cancelled run is not a pass either.
- Seen 1x (2026-10-13).

**A unit test that stops short of the real boundary does not prove the feature.**
- #175 proves the runner cancels when handed a signal. The MCP handler at
  `src-api/src/shared/mcp/ffmpeg-skill-server.ts:122` never passes one, so Stop
  cannot cancel a running operation.
- #187 tests caption edits in memory. The strict operation schema at
  `packages/video-ir/src/timeline-schema.ts:483` rejects the `words` and
  `sourceAnchor` fields the compiler itself emits, so the API path fails.
- #90 tests deny and default classification. It misses an explicit interactive
  `alwaysAsk`, which `permissions.ts:419` lets a pre-approved tool bypass.
- #155 covers component rendering. It misses closing the chat dock before its
  lazy thread connects, which loses the first prompt.
- Test the transport, schema, handler, or lifecycle the user actually reaches.
- Seen 1x (2026-10-13).

**A claim in a PR body is a claim to verify at the final path.**
- #175 promised no overwrite and bounded, cancellable runs. Final publication at
  `shared/services/ffmpeg-skill/handoff.ts:328` copies to a deterministic
  destination with plain `copyFile`, so a repeat run replaces the deliverable.
- The runner refuses to overwrite its staged output, which is where the tests
  looked. The unprotected write is one function later.
- Seen 1x (2026-10-13).

**Validate the final integrated head, not each branch in a stack.**
- #102 introduced the `toolResultText` helper and one import. #103, stacked on the
  same branch, added the import again. The duplicate import and two type errors
  reached `main`, and #105 existed only to clean them up.
- Squash-commit stats are the real change. Stacked PR totals double-count.
- Seen 1x (2026-10-13).

**Never raise a threshold or allowlist ceiling to make a check pass.**
- `scripts/component-size-allowlist.json` ceilings were raised three times in one
  commit (`dd346af1`: RightSidebar 1675 to 1726, TaskV2MessageBubble 724 to 739,
  MediaLightbox 549 to 554). The raised value then becomes the new baseline.
- `pnpm validate` passes with 453 frontend correctness warnings under it. The
  pass bar is not the quality bar.
- Extract the responsibility, or record an exception with an owner, a reason, and
  an expiry. Raising a number is neither.
- Seen 1x (2026-10-13).

**When a check fails in your area, fix it or file it. Do not label it "fails on
main" and move on.**
- `pnpm test:fast` fails at `src-api/test/unit/agent-runtimes/resolve.test.ts:251`
  on a machine with Homebrew OpenCode installed. It is a real test-isolation bug
  that hid behind "environment specific" for the life of the repo.
- "Fails on main" means on freshly fetched `origin/main`, and you name the sha you
  ran. A red under load is a timing assumption a user will meet on a busy machine.
- Seen 1x (2026-10-13).

## Contracts and integration boundaries

**Reproduce on the surface the caller uses: the HTTP route, the MCP handler, the
bridge, the packaged build, the chosen runtime.**
- #187, #175, #90 and #155 above are all one shape: the tested layer was not the
  layer that failed. The compiler was right and the schema was wrong; the runner
  was right and the handler was wrong; the classifier was right and the
  precedence was wrong.
- Run the API test that exercises the route, or the integration test that crosses
  the bridge. If no such test exists, that is the missing work, not a reason to
  test the inner function twice.
- Seen 1x (2026-10-13).

**Test isolation: stub the seam, not the environment.**
- `resolve.test.ts:239` stubs HOME and PATH, then calls a resolver that reads the
  real filesystem and checks `/opt/homebrew/bin` first (`resolve.ts:124`). The
  fixture never wins on a developer machine.
- Inject the discovery function through the existing `PathDiscoveryOptions` seam,
  and assert precedence with controlled fixtures. Do not change production search
  order to satisfy a test.
- Seen 1x (2026-10-13).

**A test never reaches a real third-party service, and a fake process a test
starts ends when the test does.**
- Tests that read the real filesystem, real home directory, or a real network
  target pass or fail based on the machine. That is not a signal about the code.
- Seen 1x (2026-10-13).

## Types, state, and data

**Fix the type, do not cast around it in the tests.**
- `shared/mcp/video-edit-server.ts:2562` types every tool handler as
  `(args: never, ...)` and round-trips results with `as unknown as`. #102 and #103
  cleared the resulting errors by adding `as never` and `as unknown as` at more
  than 20 test call sites.
- Parameterize the wrapper so valid input compiles. Keep a cast only where the
  test deliberately exercises an invalid runtime input.
- Seen 1x (2026-10-13).

**A default must never overwrite a value the user set.**
- `src/components/onboarding/OnboardingFlow.tsx:51` saves `planMode: 'on'` on
  every completion, including a setup rerun, so an explicit `off` or `auto` is
  lost.
- Before writing a setting, find every place the user can set it. Test with a
  user-owned value present.
- Seen 1x (2026-10-13).

**A failed read, parse, or migration means "unknown". It never means "empty".**
- `shared/db/migrations/utils.ts:20` cannot tell a missing table from a missing
  column, so an unguarded `ALTER TABLE` on `video_intent_log` aborted ten later
  migrations. The failure was silent because the database handle was published
  before migrations finished. #44 repaired the case and added registry coverage.
- Skipping every absent table would be the opposite mistake, because it hides real
  corruption. Decide per migration, and assert the expected schema after upgrade.
- Seen 1x (2026-10-13).

**A generated contract and its runtime validator must be derived from one source.**
- Caption types at `packages/video-ir/src/timeline-types.ts:305` include `words`
  and `sourceAnchor`. The strict schema at `timeline-schema.ts:483` does not. The
  compiler emits what the schema rejects.
- Duplicated catalogs across `src/` and `src-api/src/` are pinned only by parity
  tests. Prefer one package export over two copies and a test that keeps them
  equal.
- Seen 1x (2026-10-13).

## Security and filesystem boundaries

**A name check is not a network policy. Untrusted URLs go through `safeFetch`
with resolved-address and redirect validation.**
- `shared/channels/channel-manager.ts:1937` fetches a URL taken from MCP tool
  output after only a synchronous `validateBaseUrl` pre-check, follows redirects,
  and buffers the body before checking its size.
- `extensions/agent/openai-compat/media.ts:78` fetches a provider-returned image
  URL with no visible target policy, timeout, or byte bound.
- Keep an explicitly local integration on an explicitly local policy. Do not
  replace every fixed-endpoint fetch.
- Seen 1x (2026-10-13).

**Never build a shell command from a path, package name, or any other value the
agent or the user controls.**
- `app/api/files.ts:1085` interpolates a file path into a quoted command string
  passed to `execAsync`. Quotes do not make a filename literal.
- `extensions/sandbox/claude.ts:255` joins package names into `pip install` and
  `npm install` strings and runs them outside the sandbox.
- Use argument arrays with fixed binaries. Package installation belongs inside the
  same isolation boundary as execution.
- Seen 1x (2026-10-13).

**Validate containment on the resolved path, and check the final write, not only
the staging write.**
- `app/api/files.ts:92` compares a normalized path with a root by string prefix,
  which accepts a sibling such as `/tmp-other` for `/tmp`, and later reads follow
  symlinks.
- FFmpeg publication validates the staged output, then writes to a destination
  that can be a symlink.
- Seen 1x (2026-10-13).

**App-owned data goes through `getAppDir()`, never a home-directory path built by
hand.**
- `shared/services/git-workspace.ts:27` derives app repositories and sessions from
  `homedir()`, ignoring `NEUMAR_APP_DATA_DIR`.
- `shared/services/publish/destinations/local-archive.ts:30` defaults to a
  `.neuma` directory, which is the previous brand and breaks isolation.
- A path that ignores the app-data override makes tests and packaging write to the
  developer's real home.
- Seen 1x (2026-10-13).

**A security gap a document names is an open bug, not a description. File it in
the same change that writes the sentence.**
- Tracked docs still claim a browser IndexedDB fallback, Vite 7, and Node 20
  targets, so a reader cannot tell current behavior from history.
- Seen 1x (2026-10-13).

## Deleting, duplicating, and merging

**When you replace an internal API, migrate every caller and delete the old one in
the same wave.**
- Live parallel paths today: `/task/:taskId` and `/task-v2/:taskId`, both settings
  shells behind `ui.simpleShell` (default false), two channel registries, two
  Slack stacks, and mirrored video catalogs.
- A compatibility layer left behind becomes the thing the next change has to
  update twice.
- Seen 1x (2026-10-13).

**One commit, one goal. A fix found on the way gets its own commit.**
- #175 shipped the FFmpeg skill plus attachment upload, planning settings, and
  error presentation, and the test repair arrived in #176.
- Seen 1x (2026-10-13).

**Merge only the reviewed head, and record what was run at that head.**
- #103 merged a branch whose own formatting and type checks were red, and it was
  found later.
- The reviewed head is the sha you ran. If you push after review, review again.
- Seen 1x (2026-10-13).

## Working with parallel agents

These rules are adopted for the epic work in
[doc/maintenance/2026-10-13-regression/02-development-plan.md](doc/maintenance/2026-10-13-regression/02-development-plan.md),
which is indexed with its issues and commands in
[04-epics-and-issues.md](doc/maintenance/2026-10-13-regression/04-epics-and-issues.md).
No local failure has been recorded for them yet, so they are unproven here and
carry no "Seen" count.

- **One agent, one worktree, one branch.** Two sessions committing from one
  checkout ship each other's staged files under the wrong subject.
- **After committing, `git show --stat HEAD` lists your files and only yours.** An
  empty commit means another session took your index.
- **Serialize edits to shared files**: `package.json`, `pnpm-lock.yaml`, locale
  modules, the size allowlist, `http-daemon.ts`, `video-edit-server.ts`, and the
  shared video IR schemas. Rebase and rerun affected integration tests when
  another stream changes a shared contract.
- **Sub-issues merge into the epic branch, never into `main`.** The epic closes
  with one reviewed PR into `main` after every sub-issue is done.

## Adding to this file

- Add a lesson only with evidence: a PR number, a commit, or a file and line, plus
  what was run and what was missed.
- Increment "Seen" when a later review finds the same rule again. Say which review
  day, not only the count.
- After three review days, move the rule into [AGENTS.md](AGENTS.md) and leave a
  pointer here.
- Keep the rule first. If it needs a paragraph of setup, it is not a rule yet.
