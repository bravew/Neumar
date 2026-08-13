# Craft references

Brand-agnostic craft knowledge. Each file is a small, dense rulebook on one
dimension of professional UI craft (typography, color, motion, …). Skills
opt into the references they need; the daemon injects only the requested
ones into the system prompt above the active skill body.

## Why a third axis next to `skills/` and `design-systems/`

| Axis | Scope | Example |
|---|---|---|
| `skills/` | Artifact shape | `saas-landing`, `dashboard`, `pricing-page` |
| `design-systems/` | Brand visual language (the 9-section `DESIGN.md`) | `linear-app`, `apple`, `notion` |
| `craft/` | **Universal** craft knowledge — true regardless of brand | letter-spacing rules, accent-overuse caps, anti-AI-slop |

`DESIGN.md` tells the agent which colors and fonts a brand uses. `craft/`
tells the agent the universal rules a competent designer applies on top —
e.g. ALL CAPS always needs ≥0.06em tracking, regardless of the brand.

## How a skill opts in

Add an `od.craft.requires` array to the skill's front-matter. Only the
listed sections are injected, so a skill that needs only typography pays
no token cost for color/motion content.

```yaml
od:
  craft:
    requires: [typography, color, anti-ai-slop]
```

Allowed values match the file names in this directory minus the `.md`
extension. Unknown values are silently ignored (forward-compatible).

### Why silent fallback instead of fail-fast?

A skeptical reader will ask: "If a skill requests a planned-but-not-yet-vendored
section and the corresponding file doesn't exist yet, shouldn't we warn
the user?" We choose forward-compatibility over fail-fast: a skill
authored today can list a planned slug and start benefiting the moment
the matching `craft/<slug>.md` is vendored in a follow-up PR, with no
skill edit needed. The cost of a missed reference is a missing
paragraph in the system prompt, not a broken skill, so the loud failure
mode is not worth the friction.

Note for skill authors arriving from older guidance: an earlier draft
used `motion` as the future-slug placeholder. The shipped equivalent
today is `animation-discipline`. Use that one if your skill emits
motion.

### Enforcement levels

Craft files mix auto-checked rules and guidance.

- **Auto-checked.** Rules wired into `src-api/src/shared/services/design-mode/lint.ts`.
  The linter reports these as findings back to the UI and to the agent for
  self-correction. Artifact persistence is not currently hard-blocked on P0 hits.
- **Guidance.** The rest. The agent reads the rules, reviewers apply them, and
  the linter only promotes specific low-risk checks over time.

## Files

| File | Section name | When to require |
|---|---|---|
| `typography.md` | `typography` | Any skill that emits typed content (~all skills) |
| `color.md` | `color` | Any skill that emits styled output (~all skills) |
| `anti-ai-slop.md` | `anti-ai-slop` | Marketing pages, landing pages, decks |
| `state-coverage.md` | `state-coverage` | Any skill with stateful UI: dashboards, mobile apps, forms, list/table views |
| `animation-discipline.md` | `animation-discipline` | Any skill that ships motion: mobile apps, multi-screen flows, gamified UI, transitions, microinteractions |

**Partial-stateful skills.** A skill that's mostly static but contains an
embedded form, data table, or query surface should opt in. State-coverage
rules apply to the stateful component, not the whole page.

More sections (`icons`, `craft-details`) will be added in follow-up PRs as
we wire the linter side.

## Attribution

Craft content is adapted from the MIT-licensed
[refero_skill](https://github.com/referodesign/refero_skill) project
(© Refero Design), with edits to fit Neuma DesignMode's house style and
project-level design tokens instead of generic Tailwind hex values.
