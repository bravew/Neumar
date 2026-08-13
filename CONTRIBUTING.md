# Contributing to Neumar

Thanks for your interest in contributing. This guide covers the basics of setting up your environment and submitting changes.

## Getting started

```bash
pnpm install                  # install workspace dependencies
pnpm dev:all                  # API server + Tauri desktop app
pnpm dev:web                  # frontend only (port 3420) — fastest HMR
pnpm dev:api                  # API server only (port 5126)
```

See `CLAUDE.md` and `AGENTS.md` at the repo root for a full architecture overview, coding conventions, and command reference.

## Before opening a PR

```bash
pnpm validate                 # brand:check + lint + typecheck:all + format:check + check:component-size
pnpm test:fast                # frontend + API unit/integration tests
```

- Run `npx oxfmt <file>` on any file you touch under `src/` before `pnpm validate` to avoid formatting-diff lint failures.
- Components are capped at 350 lines (`scripts/check-component-size.mjs`, enforced in CI) — extract sub-components when you exceed it.
- User-visible strings go through the `useLanguage()` hook and must be added to all six locales (`en`, `zh`, `es`, `fr`, `hi`, `pt`) under `src/config/locale/`.
- Don't run `pnpm test:all` for routine changes — it spawns Playwright and real-server E2E processes. Reach for it only before a release.

## Commit and PR conventions

- Keep commits focused and atomic; write clear, descriptive commit messages.
- Reference related issues in your PR description.
- CI (`.github/workflows/ci.yml`) runs automatically on release-branch PRs; for regular PRs, trigger it manually via `workflow_dispatch` when you want it to run.
- Fill out the PR template — it asks for a summary and a test plan.

## Reporting bugs and requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. Include reproduction steps, expected vs. actual behavior, and your environment (OS, Node version) for bugs.

## Security issues

Do not open a public issue for a security vulnerability — see `SECURITY.md` for how to report privately.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you're expected to uphold it.

## License

By contributing, you agree that your contributions will be licensed under the project's [Apache License 2.0](LICENSE).
