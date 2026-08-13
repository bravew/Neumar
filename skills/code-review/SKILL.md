---
name: code-review
description: |
  Pre-landing code review that finds bugs, security issues, and structural problems.
  Use when: reviewing PRs, auditing code changes, pre-merge quality check.
version: 1.0.0
trigger: /review
category: development
icon: eye
---

> When generating output, use the user's preferred language for all headings, labels, and prose. Follow the structure below but localize all text.

## Overview

A systematic code review skill that catches bugs, security issues, and structural problems before they reach production. Inspired by professional code review workflows.

## Review Process

### Phase 1: Context Gathering
1. Identify the scope of changes (files modified, lines changed)
2. Read the PR description or commit messages for intent
3. Understand the broader system context — what does this code connect to?
4. Check if there are related tests

### Phase 2: Critical Issues Scan
Priority order — stop and report critical issues immediately:

1. **Security vulnerabilities**
   - Injection risks (SQL, command, XSS)
   - Authentication/authorization bypasses
   - Hardcoded secrets or credentials
   - Unsafe deserialization
   - Missing input validation

2. **Correctness bugs**
   - Logic errors, off-by-one mistakes
   - Null/undefined access without guards
   - Race conditions in async code
   - Missing error handling on I/O operations
   - Incorrect type assumptions

3. **Data integrity**
   - Missing database transactions for multi-step operations
   - Inconsistent state updates
   - Missing validation at system boundaries

### Phase 3: Structural Review
1. **Architecture alignment** — Does this change fit the existing patterns?
2. **Separation of concerns** — Is business logic mixed with presentation?
3. **Error propagation** — Are errors handled at the right level?
4. **API design** — Are contracts clear? Breaking changes flagged?
5. **Test coverage** — Are critical paths tested? Edge cases covered?

### Phase 4: Style & Maintainability
1. **Naming clarity** — Do names communicate intent?
2. **Complexity** — Can anything be simplified?
3. **Duplication** — Is there copy-paste that should be extracted?
4. **Comments** — Are complex sections explained? Are stale comments removed?

## Output Format

### Review Summary
```
## Code Review: [scope description]

**Verdict**: ✅ Approve | ⚠️ Approve with suggestions | 🚫 Request changes

### Critical Issues (must fix)
- [issue]: [location] — [why it matters] — [suggested fix]

### Suggestions (should fix)
- [issue]: [location] — [why] — [fix]

### Nits (optional)
- [observation]: [location]

### What's Good
- [positive observation about the code]
```

## Operating Modes

- **Quick scan**: Focus on security and correctness only. Skip style nits. Best for hotfixes.
- **Standard**: Full review covering all phases. Default mode.
- **Deep review**: Also assess architecture, naming, test quality, and documentation.

## Decision Framework

| Severity | Block merge? | Example |
|----------|-------------|---------|
| Critical | Yes | Security vulnerability, data loss risk, crash |
| High | Yes | Logic bug, missing error handling, broken API contract |
| Medium | No (suggest) | Missing test, unclear naming, mild complexity |
| Low | No (nit) | Style preference, minor optimization |
