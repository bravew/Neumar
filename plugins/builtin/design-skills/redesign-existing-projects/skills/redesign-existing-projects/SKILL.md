---
name: redesign-existing-projects
description: |
  Audit an existing website, app screen, or HTML artifact, then apply a focused
  visual redesign without breaking routes, copy intent, accessibility, or
  product behavior. Use when the brief asks to redesign an existing project,
  improve the current UI, make an artifact feel more polished, or run a
  redesign audit before editing.
triggers:
  - "redesign existing project"
  - "redesign this app"
  - "improve current UI"
  - "polish this design"
  - "redesign audit"
  - "premium redesign"
od:
  mode: prototype
  platform: desktop
  scenario: design
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [typography, color, anti-ai-slop, accessibility-baseline, state-coverage]
  outputs:
    primary: index.html
  capabilities_required:
    - file_read
    - file_write
  example_prompt: "Audit the existing landing page, then redesign it in place with stronger hierarchy, clearer states, and the same routes and content intent."
---

# Redesign Existing Projects Skill

Upgrade an existing interface in place. The job is not to start over; it is to
preserve the user's product, content intent, and working behavior while making
the visual and interaction layer more deliberate.

License note: First-party Neuma-authored skill content for this repository.
Upstream audit reference: the MMS redesign workflow commit included an
MIT-licensed `redesign-skill`, but no upstream text, templates, images, or
third-party code were copied into this bundled skill.

## Workflow

1. Read before editing
   - Identify the framework, styling system, route/component ownership, and
     existing design system.
   - Read the active `DESIGN.md` and any pinned craft references before making
     visual choices.
   - Find the smallest set of files that own the requested surface.

2. Diagnose the current UI
   - List the main hierarchy, spacing, color, typography, interaction, and
     state problems.
   - Separate product/IA issues from visual issues. Do not change navigation,
     copy meaning, data shape, or routes unless the user explicitly asked.
   - Note which elements must remain recognizable for continuity.

3. Plan a focused redesign
   - Keep implementation boundaries intact: existing components stay wired to
     the same data and actions.
   - Replace generic composition with one clear structure: a stronger hero,
     clearer section rhythm, denser dashboard grouping, or better form flow.
   - Use tokens and component conventions from the current project. Add new
     tokens only when they remove repeated one-off values.

4. Apply edits safely
   - Work in small passes: typography and hierarchy, then layout and spacing,
     then interaction states, then responsive fixes.
   - Preserve all existing functional hooks, event handlers, route params, form
     names, test IDs, and persistence keys unless a change is required.
   - Use semantic HTML and accessible control states. Keep focus visible.
   - Do not add a new UI library or migrate styling systems for a redesign.

5. Cover states and breakpoints
   - Include hover, focus, active, loading, empty, error, and disabled states
     where the surface exposes them.
   - Verify mobile, tablet, and desktop layout mentally or with screenshots if
     available. No clipped button text, overlapping content, or horizontal
     scroll on common mobile widths.

6. Self-check before handing off
   - The redesigned surface still performs the original user workflow.
   - The page reads as the same product, not a detached template.
   - No fake metrics, lorem ipsum, dead links, decorative filler, or hidden
     regressions.
   - The diff is reviewable and scoped to the requested surface.

## Output Contract

When editing a project, modify the existing files in place and summarize the
audit findings plus verification. When producing a standalone DesignMode
artifact, emit a self-contained `index.html` with `data-od-id` on redesigned
regions so comment mode can target follow-up feedback.
