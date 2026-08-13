# Design System Inspired by Midjourney

> Category: AI & LLM
> Image generation as a gallery. Velvet-black canvas, oversized media tiles, sparing cobalt accent.

## 1. Visual Theme & Atmosphere

Midjourney's web UI treats the screen like a museum wall. The canvas is velvet black (`#0B0B0B`), and almost the entire visual weight is carried by user-generated images arranged in a tight masonry grid. UI chrome retreats: navigation is mono-labeled, controls fade to 40-60% opacity until hovered, and tooltips are tiny pills. The single accent is cobalt blue (`#3D6EFF`) used for the focus ring and the prompt-input caret. Cards have no visible border in the gallery — separation is created by 8-12px gutters and the image edges themselves.

**Key Characteristics:**
- Velvet black canvas (`#0B0B0B`) with cards `#141414` only when isolated
- No card borders in the masonry — gutters do the work
- Inter for UI at 13-14px, weight 400-500
- Cobalt accent (`#3D6EFF`) reserved for focus ring + prompt caret
- Hover affordances appear only on hover: copy prompt, upscale, vary, save

## 2. Color Palette & Roles

### Primary
- **Velvet Black** (`#0B0B0B`)
- **Card** (`#141414`)
- **Hairline** (`#222222`)
- **Foreground** (`#F2F2F2`)

### Accents
- **Cobalt** (`#3D6EFF`): Focus ring, caret, primary CTA.
- **Highlight Magenta** (`#E84393`): "Hot" / "Featured" tag.
- **Muted** (`#8C8C8C`)

## 3. Typography

- Inter 13-14px UI, weight 400-500.
- 11px mono for prompt text and metadata (model, seed, aspect).
- Display 22-28px on the homepage hero.

## 4. Component Cues

- Image tile: zero border, 4-6px radius, hover reveals overlay action chips at top-right.
- Prompt bar: full-width pill at the top of the create view, mono input, cobalt caret.
- Job card metadata: mono 11px row of `model · ar · seed`, low opacity until hover.
