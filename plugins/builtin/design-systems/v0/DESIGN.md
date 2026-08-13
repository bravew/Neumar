# Design System Inspired by v0

> Category: Developer Tools
> Vercel's generative UI playground. Pure-black canvas, Geist typography, one electric accent.

## 1. Visual Theme & Atmosphere

v0 is what happens when a developer-tools company turns its design language inward. The canvas is true black (`#000000`), the typography is Geist (Sans and Mono), and the rest of the system is restraint. UI cards float on the black via 1px shadow-as-border (`box-shadow: 0 0 0 1px rgba(255,255,255,0.10)`), never with strokes. Generated code, prompts, and previews share the same flat plane. The single accent is an electric blue used for primary actions, focus rings, and the diff highlight when a generation lands.

**Key Characteristics:**
- True black canvas (`#000000`) with `#0A0A0A` cards — hairline contrast between layers
- Shadow-as-border at 10% white, never traditional 1px strokes
- Geist Sans tightened tracking for headings, Geist Mono for prompts and code
- Single electric blue accent (`#0070F3`) — focus ring, primary CTA, generation marker
- Streaming UI: tokens animate in with a faint shimmer, no layout shift

## 2. Color Palette & Roles

### Primary
- **True Black** (`#000000`): Canvas.
- **Carbon** (`#0A0A0A`): Cards, panels.
- **Hairline** (`#1F1F1F`): 1px borders / shadow color base.
- **Foreground** (`#EDEDED`): Primary text on black.

### Accents
- **Electric Blue** (`#0070F3`): Primary CTA, focus, link.
- **Generation Pulse** (`#3D8BFD`): Streaming token shimmer mid-state.
- **Error** (`#F87171`)
- **Success** (`#22C55E`)

### Surfaces / Code
- **Code Block** (`#0E0E10`): Slightly raised, no border, mono.
- **Inline Code** (`#161618`): Pill, 6px radius.

## 3. Typography

- Geist Sans: 14px UI, 32-72px display with -0.04em tracking.
- Geist Mono: 13px in code, prompts, terminal-feeling labels.

## 4. Component Cues

- Generation progress: thin horizontal bar at the top of the preview pane, blue gradient.
- Side-by-side prompt + preview, with a draggable splitter on a hairline.
- "Add to v0" / "Open in editor" buttons are square, 32px, mono label.
