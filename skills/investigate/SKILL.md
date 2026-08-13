---
name: investigate
description: |
  Systematic root-cause debugging with 4-phase methodology.
  Use when: tracking down bugs, investigating failures, diagnosing unexpected behavior.
version: 1.0.0
trigger: /investigate
category: development
icon: search
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

A systematic debugging methodology for finding root causes of bugs and unexpected behavior. Follows a structured 4-phase approach to avoid premature conclusions.

## Phase 1: Reproduce

Before investigating, establish a reliable reproduction:

1. **Confirm the symptom** — What exactly is happening vs. what's expected?
2. **Reproduce reliably** — Can you trigger it consistently?
3. **Isolate the trigger** — What's the minimal set of conditions?
4. **Document the reproduction** — Steps, environment, inputs

If you cannot reproduce:
- Check logs for the original occurrence
- Look for intermittent patterns (timing, load, specific data)
- Set up targeted logging to catch the next occurrence

## Phase 2: Narrow the Scope

Use bisection and elimination to find the fault zone:

1. **Timeline bisection** — When did this start working vs. breaking?
   - Use `git log` and `git bisect` if the failure is recent
   - Check deployment logs for recent changes
2. **Layer isolation** — Is the issue in frontend, backend, database, or infrastructure?
   - Add logging at layer boundaries
   - Test each layer independently
3. **Data isolation** — Does it happen with all data or specific inputs?
   - Try with minimal data
   - Try with the specific failing data

## Phase 3: Form and Test Hypotheses

1. **Read the error carefully** — Error messages often contain the answer
2. **Form a hypothesis** — "I think X is happening because Y"
3. **Design a test** — What observation would confirm or deny this?
4. **Execute the test** — Add logging, breakpoints, or assertions
5. **Evaluate** — Did the evidence support the hypothesis?
6. **Iterate** — If not, form a new hypothesis based on what you learned

Common root causes to consider:
- **State corruption** — Is shared state being modified unexpectedly?
- **Timing/ordering** — Is there a race condition or event ordering issue?
- **Environment difference** — Works locally but not in staging/prod?
- **Data edge case** — Specific data that triggers an unhandled path?
- **Dependency change** — Did a library update change behavior?

## Phase 4: Fix and Verify

1. **Apply the minimal fix** — Change only what's necessary
2. **Write a regression test** — Reproduce the bug as a test case FIRST
3. **Verify the fix** — Does the test pass now?
4. **Check for related issues** — Could this same bug exist elsewhere?
5. **Document the root cause** — Update comments or docs if the code is tricky

## Output Format

```
## Investigation Report

**Symptom**: [what was observed]
**Root cause**: [what was actually wrong]
**Evidence**: [how we confirmed]

### Fix
[description of the fix]

### Regression Test
[test that would catch this if it regressed]

### Prevention
[what would prevent similar bugs in the future]
```

## Anti-Patterns to Avoid

- **Shotgun debugging** — Don't make random changes hoping something works
- **Premature conclusion** — Don't assume the first theory is correct without evidence
- **Fix the symptom** — Don't hide the bug; fix the root cause
- **Skip the test** — Always write a regression test for bugs you fix
