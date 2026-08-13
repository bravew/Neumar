# Design System Inspired by Bolt.new

> Category: Developer Tools
> Build, run, and deploy in the browser. Dark slate canvas, electric lime accent, mono-led labeling.

## 1. Visual Theme & Atmosphere

Bolt's identity is "the IDE that ships." The canvas is a deep slate (`#0E1116`), panels are a hair lighter (`#151A21`), and the system reads like a tuned developer environment — not a dashboard. The accent is a confident electric lime (`#9EF01A`) reserved for the primary action ("Run", "Deploy", live-server status dot). Side-rail icons sit in a 48px column; the chat composer occupies a fixed bottom drawer. Toolbars are mono-labeled, 12px, with a hairline divider between zones.

**Key Characteristics:**
- Slate canvas (`#0E1116`), panels `#151A21`, code surface `#0B0E12`
- Electric lime accent (`#9EF01A`) reserved for run/deploy/live state
- JetBrains Mono for chrome labels, Inter for chat and prose
- Three-pane layout: chat left, file tree center, preview right — splitters always 1px
- Status dot uses the accent at full opacity when live, 30% when idle

## 2. Color Palette & Roles

### Primary
- **Slate Canvas** (`#0E1116`)
- **Panel** (`#151A21`)
- **Code Surface** (`#0B0E12`)
- **Foreground** (`#E6EDF3`)

### Accents
- **Bolt Lime** (`#9EF01A`): Run, Deploy, live status dot.
- **Warning Amber** (`#F2B33D`)
- **Error Red** (`#FF6B6B`)
- **Link Blue** (`#5EB1FF`)

### Borders / Muted
- **Hairline** (`#1F2630`)
- **Muted Text** (`#8B9199`)

## 3. Typography

- JetBrains Mono 12px for tab labels, status bar, file paths.
- Inter 14px for chat, doc content.
- Headings 18-24px, weight 600.

## 4. Component Cues

- File tabs: 28px height, mono label, 1px bottom border becomes lime when "running".
- Run button: lime fill, black text, 6px radius, 32px height — single primary CTA in the toolbar.
- Inline diff in preview pane: green/red tinted gutter, mono code, 13px.
