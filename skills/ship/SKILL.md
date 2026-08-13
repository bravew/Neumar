---
name: ship
description: |
  Full shipping workflow: test, review, version, changelog, and PR creation.
  Use when: preparing to ship code, creating releases, merging PRs.
version: 1.0.0
trigger: /ship
category: development
icon: rocket
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

A complete shipping workflow that ensures code is tested, reviewed, versioned, and documented before it reaches production. No shortcuts on quality.

## Pre-Ship Checklist

### Phase 1: Verify Tests
1. Run the full test suite — all tests must pass
2. Check for flaky tests that passed by luck
3. Verify test coverage for the changes being shipped
4. Run linters and type checkers

### Phase 2: Self-Review
Before asking for review:
1. Read your own diff as if seeing it for the first time
2. Check for debug code, console.logs, TODO comments
3. Verify error handling is complete
4. Check that naming is clear and consistent
5. Ensure no unnecessary changes are included

### Phase 3: Version & Changelog
1. Determine version bump (major, minor, patch) per semver:
   - **Major**: Breaking API changes
   - **Minor**: New features, backward-compatible
   - **Patch**: Bug fixes, backward-compatible
2. Update version in package.json or equivalent
3. Write changelog entry:

```
## [X.Y.Z] - YYYY-MM-DD

### Added
- [New feature description]

### Changed
- [Modified behavior description]

### Fixed
- [Bug fix description]

### Removed
- [Removed feature description]
```

### Phase 4: Create PR
1. Write a clear PR title (under 70 characters)
2. Write a description that includes:
   - **What**: Summary of changes
   - **Why**: Motivation and context
   - **How**: Key implementation decisions
   - **Testing**: How this was tested
   - **Screenshots**: If UI changes are involved
3. Add relevant labels and reviewers
4. Link related issues

### Phase 5: Post-Merge
1. Verify the merge was clean (no conflicts)
2. Check CI/CD pipeline passes
3. Monitor for errors after deployment
4. Update any related documentation
5. Close related issues

## Operating Modes

- **Quick ship**: Skip changelog, minimal PR description. For hotfixes only.
- **Standard ship**: Full workflow. Default for all feature work.
- **Release ship**: Full workflow + version bump + release notes + tag.

## Anti-Patterns
- **Ship and pray** — Deploying without monitoring
- **Mega PR** — Shipping too many changes at once (>500 lines)
- **No description** — PRs without context are review killers
- **Skipping tests** — "It works on my machine" is not a test plan
