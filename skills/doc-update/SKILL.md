---
name: doc-update
description: |
  Post-ship documentation sync across all project docs.
  Use when: after shipping features, updating APIs, changing behavior.
version: 1.0.0
trigger: /doc-update
category: development
icon: file-text
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

Ensures documentation stays in sync with code changes. Runs after shipping to find and update all docs affected by recent changes.

## Phase 1: Identify What Changed

1. Review recent commits or the PR being documented
2. List all behavioral changes:
   - New features or endpoints
   - Changed API contracts
   - Removed functionality
   - Configuration changes
   - New dependencies

## Phase 2: Find Affected Documentation

Scan these locations for references to the changed code:

1. **README.md** — Project overview, setup instructions, getting started
2. **API documentation** — Endpoint docs, request/response schemas
3. **Configuration docs** — Environment variables, config files
4. **Architecture docs** — System design, data flow diagrams
5. **Inline code comments** — JSDoc, docstrings, header comments
6. **Changelogs** — CHANGELOG.md, release notes
7. **Migration guides** — If breaking changes were introduced

## Phase 3: Update Documentation

For each affected document:

1. **Read the existing content** — Understand what's there
2. **Identify the delta** — What's now wrong or missing?
3. **Make the minimum edit** — Don't rewrite what's still correct
4. **Verify accuracy** — Cross-reference with the actual code
5. **Check examples** — Do code examples still work?

### Writing Guidelines
- **Be specific** — Use exact function names, file paths, config keys
- **Show, don't tell** — Include code examples for anything non-obvious
- **Update, don't append** — Fix the existing docs rather than adding footnotes
- **Keep it current** — Remove references to deprecated features

## Phase 4: Verify Completeness

- [ ] All new features documented
- [ ] All changed behavior documented
- [ ] All removed features' references cleaned up
- [ ] Code examples tested and working
- [ ] Internal links not broken
- [ ] No stale screenshots or diagrams

## Output Format

```
## Documentation Update Report

### Changes Documented
| File | Change | Status |
|------|--------|--------|
| README.md | Added new feature section | ✅ Updated |
| docs/api.md | Updated endpoint schema | ✅ Updated |

### Files That May Need Manual Review
- [file]: [reason it needs human judgment]
```
