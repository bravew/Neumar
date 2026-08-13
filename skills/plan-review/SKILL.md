---
name: plan-review
description: |
  Engineering plan review covering architecture, data flow, edge cases, and test matrix.
  Use when: reviewing technical designs, architecture proposals, implementation plans.
version: 1.0.0
trigger: /plan-review
category: development
icon: clipboard-check
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

A systematic engineering plan review that evaluates technical designs for completeness, correctness, and risk. Ensures plans are ready for implementation.

## Review Dimensions

### 1. Requirements Completeness
- Are all user stories / acceptance criteria addressed?
- Are non-functional requirements covered (performance, security, accessibility)?
- Are edge cases and error scenarios documented?
- Is the scope clearly bounded — what's in vs. out?

### 2. Architecture Assessment
- Does the design fit existing system patterns?
- Are component boundaries clear?
- Is the data model sound?
- Are integration points well-defined?
- Is there a migration path from current state?

### 3. Data Flow Analysis
- Trace the happy path end-to-end
- Trace the error path end-to-end
- Check for data consistency across boundaries
- Verify no data loss scenarios
- Check for unnecessary data duplication

### 4. Risk Identification
- What are the unknowns?
- What assumptions need validation?
- Where are the single points of failure?
- What's the blast radius if something goes wrong?
- Is there a rollback strategy?

### 5. Test Matrix
- What needs unit tests?
- What needs integration tests?
- What needs E2E tests?
- What's hard to test and how will we verify it?
- What performance tests are needed?

### 6. Operational Readiness
- How will we monitor this in production?
- What alerts should be set up?
- How will we debug issues?
- Is there documentation for on-call engineers?

## Output Format

```
## Plan Review: [plan title]

**Verdict**: ✅ Ready to implement | ⚠️ Needs revision | 🚫 Significant gaps

### Strengths
- [What's well designed]

### Gaps & Concerns
| # | Area | Concern | Severity | Suggestion |
|---|------|---------|----------|------------|
| 1 | Architecture | [concern] | High | [suggestion] |

### Missing Items
- [ ] [item that should be in the plan]

### Test Matrix
| Scenario | Type | Priority |
|----------|------|----------|
| [scenario] | Unit/Integration/E2E | P0/P1/P2 |

### Questions for the Author
1. [question that needs answering before implementation]
```

## Review Principles

- **Be constructive** — Don't just find problems; suggest solutions
- **Prioritize** — Not all gaps are equal; focus on what blocks implementation
- **Consider the audience** — Is this plan implementable by the team?
- **Check for premature optimization** — Is complexity justified?
- **Verify incremental delivery** — Can this be shipped in phases?
