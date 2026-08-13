---
name: reference-design-contract
description: |
  Convert a reference product, screenshot set, Figma note, or style audit into
  a reusable design contract with tokens, component rules, accessibility gates,
  and implementation constraints. Use when the user asks for a reference design
  contract, design-system brief, UI audit, or source-of-truth handoff.
triggers:
  - "reference design contract"
  - "design contract"
  - "design system brief"
  - "style audit"
  - "component contract"
  - "handoff contract"
od:
  mode: document
  platform: desktop
  scenario: design-system
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
    generates: true
    sections: [tokens, components, states, accessibility, implementation]
  outputs:
    primary: DESIGN-CONTRACT.md
    secondary: example.html
  capabilities_required:
    - file_write
  example_prompt: "Create a reference design contract from these product screenshots: navigation, cards, buttons, states, token rules, and implementation constraints."
---

# Reference Design Contract Skill

Create a concise design contract that turns references into reusable rules.
The contract is for agents and engineers who need to implement the same design
language repeatedly without guessing.

License note: First-party Neuma-authored skill content for this repository. No
upstream proprietary text, images, templates, or third-party code were copied.

## Workflow

1. Inventory the references
   - List every source the user provided: screenshot, Figma node, current app
     page, brand guide, or written brief.
   - Do not fetch external URLs yourself unless an approved tool/context pack
     already provided bounded metadata.
   - If references conflict, record the conflict instead of silently blending.

2. Extract the system decisions
   - Color roles: background, surface, text, muted text, border, accent,
     success, warning, danger.
   - Typography roles: display, heading, body, label, code/mono.
   - Layout rhythm: grid, max width, section spacing, density, breakpoints.
   - Component families: buttons, inputs, cards, navigation, tables, dialogs,
     empty/loading/error states.

3. Write `DESIGN-CONTRACT.md`
   - Start with a one-paragraph product/design intent.
   - Include token tables with names, role descriptions, and example values.
   - Include component contracts with required anatomy, variants, states, and
     accessibility requirements.
   - Include implementation rules: what to reuse, what not to invent, how to
     handle responsive behavior, and which areas require user confirmation.

4. Produce a compact preview
   - Write `example.html` as a single-page visual summary of the contract.
   - The preview is not the source of truth; `DESIGN-CONTRACT.md` is.
   - Use semantic sections and `data-od-id` attributes for review comments.

5. Self-check
   - No "make it modern" filler. Every rule must map to a reference or a
     stated assumption.
   - Every component has default, hover/focus, disabled, loading, and error
     guidance when relevant.
   - Accessibility notes include focus rings, contrast, target size, keyboard
     behavior, and reduced-motion expectations.

## Output Contract

Write both files into the project:

```
DESIGN-CONTRACT.md
example.html
```

Then summarize the highest-risk assumptions in three bullets or fewer.
