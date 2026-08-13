---
name: retro
description: |
  Weekly engineering retrospective with commit analysis and trends.
  Use when: weekly retros, sprint reviews, monthly engineering reviews.
version: 1.0.0
trigger: /retro
category: development
icon: history
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

A structured engineering retrospective that analyzes recent work, identifies patterns, and generates actionable improvements. Uses git history and project state as evidence.

## Phase 1: Data Gathering

Collect evidence before forming opinions:

### Git Analysis
1. Review commits from the retro period (default: last 7 days)
   - `git log --since="7 days ago" --oneline --stat`
2. Identify themes — which areas of code changed most?
3. Count: commits, files changed, lines added/removed
4. Note: any reverts, hotfixes, or emergency changes

### Work Analysis
1. What was planned vs. what was delivered?
2. Were there unexpected tasks that diverted effort?
3. Which tasks took longer than expected? Why?
4. Which tasks were completed faster than expected? Why?

## Phase 2: Retrospective Categories

### What Went Well
- Completed deliverables
- Good practices observed in the code
- Effective collaboration moments
- Things that were easier than expected

### What Could Be Better
- Recurring pain points
- Technical debt that slowed things down
- Communication gaps
- Process friction

### Action Items
For each "could be better" item, propose a specific action:
- **What**: Concrete improvement
- **Who**: Who should own this
- **When**: By when should this be done
- **How**: First step to take

## Phase 3: Trend Analysis

Look for patterns across multiple retros:

1. **Recurring themes** — Is the same issue appearing week after week?
2. **Improving areas** — What's getting better over time?
3. **New concerns** — What appeared for the first time?
4. **Action item follow-up** — Were previous action items completed?

## Output Format

```
## Engineering Retrospective: [date range]

### Summary
- **Commits**: [count]
- **Files changed**: [count]
- **Key areas**: [top 3 areas of activity]

### What Went Well
- [item with evidence]

### What Could Be Better
- [item with evidence]

### Action Items
| # | Action | Owner | Due | Priority |
|---|--------|-------|-----|----------|
| 1 | [action] | [who] | [when] | High/Med/Low |

### Trends
- [trend observation with data]

### Previous Action Items Status
| # | Action | Status |
|---|--------|--------|
| 1 | [from last retro] | ✅ Done / 🔄 In Progress / ❌ Not Started |
```

## Retrospective Principles

- **No blame** — Focus on systems and processes, not individuals
- **Evidence-based** — Support observations with data from git/tools
- **Forward-looking** — Every problem should produce an action item
- **Time-boxed** — Keep the retro focused and concise
- **Follow through** — Track action items across retros
