# Daily desktop preview

Internal, ad-hoc signed, **unnotarized** macOS arm64 build of the newest `main` commit
that has a passing `CI Gate`. Issue #366, epic #360. It is for the maintainer and
trusted testers. It is not a release.

Workflow: [daily-preview.yml](../../.github/workflows/daily-preview.yml).
Logic: [scripts/daily-preview.mjs](../../scripts/daily-preview.mjs) and
[scripts/lib/daily-preview.mjs](../../scripts/lib/daily-preview.mjs).
Smoke test: [scripts/daily-preview-smoke.sh](../../scripts/daily-preview-smoke.sh).

## What it does and does not do

| Does | Does not |
|---|---|
| Runs daily at 20:00 UTC and on manual dispatch | Run on `push`, `pull_request` or `release` |
| Freezes the `main` head when the plan job starts | Build a commit whose `CI Gate` is missing, pending, failed or cancelled |
| Builds with `NEUMAR_PREVIEW_BUILD=true ./scripts/build.sh mac-arm` | Reference any secret, or use Apple, Tauri updater, Cloudflare or R2 credentials |
| Uploads one artifact per day and commit, kept 14 days | Create a tag, a GitHub Release, or touch `latest.json` and the stable updater feed |
| Re-downloads the artifact in a separate job, checks SHA256SUMS, mounts the DMG and starts the sidecar | Developer ID sign or notarize |
| Advances `state/daily-preview` only after verify passes | Run on a schedule from `build.yml` (that workflow holds signing and publishing) |

Scheduled runs can start several minutes late. The commit is frozen when the plan job
starts, not at 20:00 sharp.

## Jobs

1. **plan** (ubuntu, read-only). Resolves `main`, reads `last-good.json` from the
   `state/daily-preview` branch, and asks GitHub for the `CI Gate` check run on that exact
   SHA from the GitHub Actions app (id 15368). Outputs `action`:
   - `no-change`: `main` equals last-good. Ends here. No macOS runner starts.
   - `build`: new commits and the gate is `success`.
   - `abort`: the gate is missing, pending, failed, cancelled, or could not be read. The
     job fails and the pointer stays.
2. **build** (macOS, `contents: read`). Frozen lockfile, preview build, stages
   `neumar-preview_<date>-<sha7>_aarch64.dmg`, `preview-manifest.json` and `SHA256SUMS`,
   uploads `daily-preview-<date>-<sha7>`.
3. **verify** (macOS, `contents: read`). Downloads the artifact into a fresh directory,
   checks every file against `SHA256SUMS` (a missing, changed or unlisted file fails),
   checks the manifest names the planned commit and records the updater as disabled, then
   runs the smoke test.
4. **record** (ubuntu, `contents: write`, the only writer). Runs no build output. Moves
   `state/daily-preview` forward with a plain, non-force push. If the pointer moved since
   the plan read it, the job fails and the old pointer stays.

A failure in any job leaves last-good where it was, so the next run tries the same range
again. Nothing is recorded for a partial success.

## Preview isolation

`NEUMAR_PREVIEW_BUILD=true` makes `scripts/build.sh`:

- clear `plugins.updater.endpoints` in `tauri.conf.json` (the pubkey is kept because the
  plugin refuses to start without one; empty endpoints return an error before any
  network call),
- build the frontend with `VITE_NEUMAR_PREVIEW_BUILD=true`, which turns every entry
  point of `AppUpdaterProvider` into a no-op,
- use frozen-lockfile installs,
- refuse to combine with `--sign`.

A preview therefore cannot see, poll or install from the stable feed. The manifest
records `updater: disabled`, and `verify-artifact` rejects anything else.

## Running it by hand

```bash
# Decide only. Starts the plan job, never a macOS runner.
gh workflow run daily-preview.yml -f plan_only=true

# Full run on the current main head.
gh workflow run daily-preview.yml

gh run list --workflow daily-preview.yml --limit 5
gh run watch <run-id>
```

`plan_only=true` skips build, verify and record, so the pointer never moves.

## Installing a preview

```bash
gh run download <run-id> -n daily-preview-<date>-<sha7> -D ~/Downloads/neumar-preview
cd ~/Downloads/neumar-preview && shasum -a 256 -c SHA256SUMS
```

The build is not notarized, so Gatekeeper blocks the first launch of a downloaded app.
After checking the checksums, either right-click the app and choose Open, or clear the
quarantine flag on the copy in `/Applications`:

```bash
xattr -dr com.apple.quarantine "/Applications/<App Name>.app"
```

Only do this for a preview you downloaded from this repository's workflow run. Never do
it for a file from anywhere else. A preview is ad-hoc signed, so macOS may also ask to
re-grant permissions that a Developer ID build would keep.

Previews share the normal app data directory. The API honors `NEUMAR_APP_DATA_DIR`
(see `src-api/src/config/app-dir.ts`), and the smoke test relies on it. Whether a
Finder-launched app passes that variable to its sidecar is unverified, so back up your
data before trying a preview against it.

## Reading the pointer

```bash
git fetch origin state/daily-preview
git show FETCH_HEAD:last-good.json
```

`last-good.json` holds `schema`, `sha`, `advancedAt`, `runUrl` and `artifact`. A pointer
that does not parse, has an unknown `schema`, or has a malformed `sha` fails the plan job.
An unreadable pointer is treated as unknown, never as "no pointer". The first run, when
the branch does not exist yet, is the only case that builds from nothing.

To reset deliberately, delete the `state/daily-preview` branch. The next run builds the
newest green `main`.

## Failure guide

| Symptom | Likely cause | Action |
|---|---|---|
| plan fails with `ci-pending` | `CI Gate` still running at the cutoff | Wait for it and dispatch again |
| plan fails with `ci-failed` | Gate failed or was cancelled on that SHA | Fix `main` or re-run CI on that commit. A newer run of the gate wins over an older one |
| plan fails with `ci-missing` | No gate ran on that SHA | Check `ci.yml` triggers for `main` pushes |
| plan fails with `ci-unknown` | GitHub API error or truncated response | Re-run the workflow |
| build fails | Packaging error | Read the build log. The pointer did not move |
| verify fails on a checksum | Corrupt or tampered artifact | Re-run the workflow. Treat a repeat as a security issue |
| verify fails in the smoke test | Bad bundle, missing sidecar, or `/health` not ok within 60 s | The smoke test prints the sidecar log |
| record fails with `pointer moved` | Another run advanced it first | Nothing to do. Dispatch again if needed |

## Maintenance

- Retention is `RETENTION_DAYS` in the workflow (14).
- `state/daily-preview` holds one small JSON file and is not a release branch. Its history
  is the audit trail of what was last good and when.
- Actions are pinned to the same commit SHAs as `build.yml`. Update them together.
- Tests: `src/__tests__/daily-preview/` (decision logic, CLI with a fake `gh`, workflow
  safety properties, `build.sh` preview mode) and
  `src/__tests__/shared/app-updater-preview.test.tsx`.

## Known gaps

- The macOS build, DMG smoke test and the full workflow have not run end to end. They need
  a real dispatch on a macOS runner. Until then they are checked only by `actionlint`,
  `shellcheck`, and the tests above.
- Previews are arm64 only. Intel, Linux and Windows are out of scope.
