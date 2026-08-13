---
name: community-hallmark
description: |
  Shape a community identity page or campaign surface around shared rituals,
  values, member stories, and participation paths. Use when the user asks for
  a community hallmark, member spotlight, chapter page, nonprofit campaign, or
  values-led community landing page.
triggers:
  - "community hallmark"
  - "member spotlight"
  - "community page"
  - "chapter landing"
  - "nonprofit campaign"
  - "values page"
od:
  mode: campaign
  platform: desktop
  scenario: community
  preview:
    type: html
    entry: example.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [state-coverage]
  outputs:
    primary: index.html
  capabilities_required:
    - file_write
  example_prompt: "Design a community hallmark page for a local maker collective with member stories, shared rituals, upcoming gatherings, and a clear join path."
---

# Community Hallmark Skill

Create a community-facing page or campaign that explains what a group stands
for, why members participate, and what a visitor should do next.

License note: First-party Neuma-authored skill content for this repository. No
upstream proprietary text, images, templates, or third-party code were copied.

## Workflow

1. Clarify the community promise
   - Identify the audience, shared values, rituals, tone, and desired action.
   - Avoid generic "join our community" copy. Name the real activity, outcome,
     or habit that binds members together.

2. Build the narrative structure
   - Hero: community name, promise, and one primary action.
   - Values: three to five principles written as behavior, not slogans.
   - Member stories: short cards with specific roles, moments, or outcomes.
   - Rituals/events: recurring gatherings, office hours, challenges, or demos.
   - Participation path: join, volunteer, attend, nominate, sponsor, or share.

3. Design with belonging and clarity
   - Use the active DESIGN.md for tokens and component style.
   - Make people, roles, events, and calls to action scannable.
   - Use imagery only when supplied or safely generated; otherwise use
     patterned blocks, initials, or icon-like marks instead of stock photos.

4. Cover states
   - Include normal, empty, and full-capacity variants for events or signups
     when the page has registration affordances.
   - Include accessible labels for forms, event cards, and member actions.

5. Self-check
   - The page should make the community feel specific within the first screen.
   - No fake metrics unless the user supplied them.
   - Calls to action should name the action: attend, join, nominate, sponsor,
     or subscribe.

## Output Contract

Emit one self-contained HTML artifact named `index.html` unless the user asks
for campaign copy only. Use `data-od-id` on major sections and cards.
