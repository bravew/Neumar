---
name: brainstorm
description: |
  Structured ideation with forcing questions, design thinking, and devil's advocate.
  Use when: exploring ideas, planning features, solving open-ended problems.
version: 1.0.0
trigger: /brainstorm
category: development
icon: lightbulb
---

> When generating output, use the user's preferred language for all headings, labels, and prose.

## Overview

A structured brainstorming skill that generates high-quality ideas through forcing questions, design thinking, and systematic exploration. Avoids "brainstorm theater" — every session produces actionable output.

## Modes

### Mode 1: Deep Exploration (Default)
Full brainstorming session with research, ideation, and synthesis.

### Mode 2: Quick Spark
Rapid idea generation without deep research. Good for unblocking.

## Phase 1: Frame the Problem

Before generating ideas, make sure you're solving the right problem:

1. **What is the actual problem?** (Not the solution someone already proposed)
2. **Who has this problem?** (Be specific about the user)
3. **Why does it matter?** (What's the impact of not solving it?)
4. **What constraints exist?** (Time, budget, tech, team size)
5. **What has already been tried?** (Learn from previous attempts)

### Forcing Questions
Challenge assumptions with:
- "What if we had to solve this in 1 day instead of 1 month?"
- "What if we had unlimited budget?"
- "What if we had to solve this without code?"
- "What would the opposite approach look like?"
- "Who else has solved a similar problem in a different domain?"

## Phase 2: Generate Ideas

Use multiple ideation techniques:

### Technique 1: Analogical Thinking
- What does this remind you of in other domains?
- How do other industries solve similar problems?
- What patterns from nature apply?

### Technique 2: Constraint Removal
- Remove one constraint at a time
- What becomes possible?
- Can we partially relax the constraint?

### Technique 3: User Journey Mapping
- Walk through the user's experience step by step
- Where are the pain points?
- Where could we delight?

### Technique 4: "Yes, And..."
- Build on each idea rather than dismissing
- Combine two weak ideas into one strong one
- Push ideas to their logical extreme

## Phase 3: Evaluate and Prioritize

### Impact vs. Effort Matrix
Rate each idea:
- **Impact**: How much does this move the needle? (1-5)
- **Effort**: How hard is this to implement? (1-5)
- **Confidence**: How sure are we this works? (1-5)

### Devil's Advocate
For the top 3 ideas, argue against them:
- What could go wrong?
- What are we assuming that might be false?
- Who would oppose this and why?

## Phase 4: Synthesize

### Output Format
```
## Brainstorm: [topic]

### Problem Statement
[Refined problem statement after exploration]

### Top Ideas

#### 1. [Idea Name]
- **What**: [Description]
- **Why**: [Why this solves the problem]
- **How**: [High-level approach]
- **Effort**: [Low/Medium/High]
- **Impact**: [Low/Medium/High]
- **Risks**: [Key risks]

#### 2. [Idea Name]
...

### Rejected Ideas (and why)
- [Idea]: [Why it was rejected]

### Next Steps
1. [Immediate action item]
2. [Follow-up research needed]
3. [Decision to be made]
```

## Anti-Patterns
- **Brainstorm theater** — generating ideas with no intent to act
- **HIPPO effect** — deferring to the highest-paid person's opinion
- **Group think** — converging on one idea too quickly
- **Scope creep** — expanding the problem during ideation
