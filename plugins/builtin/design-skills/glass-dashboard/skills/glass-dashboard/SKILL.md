---
name: glass-dashboard
description: |
  Build a premium glassmorphism dashboard — frosted translucent cards over a
  soft gradient backdrop, a responsive KPI/metric grid, a live activity panel,
  and a floating control bar. Use when the brief asks for a glass dashboard,
  glassmorphism UI, conference/meeting room dashboard, analytics console, or a
  frosted-glass control panel.
triggers:
  - "glass dashboard"
  - "glassmorphism"
  - "frosted glass ui"
  - "dashboard ui"
  - "control panel"
  - "metrics console"
  - "meeting room ui"
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
    requires: [state-coverage]
  outputs:
    primary: index.html
  capabilities_required:
    - file_write
  example_prompt: "Design a glassmorphism operations dashboard with KPI cards, a live activity panel, and a floating control bar."
---

# Glass Dashboard Skill

Produce a premium dashboard with a **glassmorphism** aesthetic: frosted,
translucent surfaces floating over a soft gradient backdrop, with a clear
information hierarchy and a calm, focused layout. A complete, rendered seed
ships beside this skill at `example.html` — start from it, then adapt the copy,
metrics, and grid to the brief. Keep the glass treatment and token system; do
not invent a new visual language.

License note: First-party Neuma-authored skill content for this repository. No
upstream proprietary text, images, templates, or third-party code were copied.

## Self-contained rule (sandbox)

The example renders inside a strict srcdoc sandbox. Keep every artifact
**self-contained**: inline CSS, inline SVG icons, system font stack, and CSS
gradients. Do **not** reference external videos, fonts, avatar hosts, or image
CDNs — they are unreliable in the sandbox and read as broken assets. If the user
supplies real imagery, prefer a `data:` URI over a remote URL.

## Workflow

1. Define the surface
   - Identify the dashboard's job: operations/metrics console, meeting/conference
     room, analytics overview, or a control panel. Choose the cards accordingly.
   - Pick a single accent and a 2-stop background gradient that reads in both
     light and dark.

2. Glass treatment (the core look)
   - Surfaces use `background: rgba(...)` at 45–60% opacity, a hairline
     translucent border, and `backdrop-filter: blur(...)` (10–16px).
   - Layer depth with soft shadows, not heavy borders.
   - **Accessibility fallback:** wrap the blur in
     `@supports (backdrop-filter: blur(2px))`; provide a solid-surface fallback
     under `@supports not (...)` so text stays legible where blur is unsupported.

3. Layout
   - Top bar: identity, view switcher, and a search/action affordance.
   - A responsive KPI/metric grid (auto-fit, min ~220px) of glass cards.
   - A live activity / participants panel with a subtle animated indicator.
   - A floating control bar pinned near the bottom for primary actions.

4. State coverage
   - Cards: normal, hover/focus, loading (skeleton), and empty states.
   - Live indicator: active vs idle.
   - Controls: default, hover, active/pressed, and disabled.

5. Accessibility & motion
   - Body text contrast over glass must stay ≥ 4.5:1 — darken/solidify the
     surface behind text rather than lowering opacity until it fails.
   - Every control is keyboard-reachable with a visible focus ring.
   - Wrap continuous animations in `@media (prefers-reduced-motion: reduce)` and
     disable or calm them.

6. Self-check
   - Blur fallback present and legible.
   - No external resource URLs anywhere in the artifact.
   - Reduced-motion respected; focus rings visible.
   - Each KPI states a label, value, and trend — not a value alone.

## Output Contract

Emit a single self-contained HTML artifact named `index.html` with `data-od-id`
on the dashboard shell, the top bar, each KPI card, the activity panel, the live
indicator, and each control-bar action.
