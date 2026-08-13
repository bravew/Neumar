# Design System Inspired by Krea

> Category: AI & LLM
> Realtime creative tools — image, video, 3D. Soft pastel canvas, glassy panels, warm coral accent.

## 1. Visual Theme & Atmosphere

Krea's product feels like a creative app first and an AI tool second. Surfaces are soft pastel — a creamy off-white (`#F7F4EE`) on the canvas with translucent glass panels floating above artwork. The accent is a warm coral (`#FF5C39`) used for primary CTAs, the realtime indicator, and the recording dot during livegen. Type is Inter or Söhne, with a touch of higher line-height to keep panels feeling approachable. Tools are arranged in a left-rail floating dock with rounded 16px tile icons.

**Key Characteristics:**
- Pastel cream canvas (`#F7F4EE`) — never pure white
- Glassmorphism for panels: `backdrop-filter: blur(24px)` over a 60% white tint
- Coral accent (`#FF5C39`) for primary CTA and realtime status
- Floating left dock: 56px wide, 16px-radius tiles, soft drop shadow
- Realtime canvas: subtle pulsing border ring during generation

## 2. Color Palette & Roles

### Primary
- **Cream Canvas** (`#F7F4EE`)
- **Glass Panel** (`#FFFFFFCC` / 80% white over blur)
- **Foreground** (`#1B1A19`)

### Accents
- **Coral** (`#FF5C39`): Primary CTA, realtime status dot.
- **Sky** (`#3FAEFF`): Secondary affordance, link.
- **Mint Success** (`#4FCB8E`)

### Borders / Muted
- **Border** (`#E7E2D8`)
- **Muted Text** (`#6E6A63`)

## 3. Typography

- Söhne or Inter, 14px UI, 16px body, 1.5 line-height.
- 11px mono for parameter readouts (steps, cfg, seed).
- Display 32-48px, weight 500, slightly looser tracking.

## 4. Component Cues

- Realtime canvas card: 16px radius, subtle warm glow from coral when generating.
- Tool dock: 56px wide, 8px gap between tiles, 16px tile radius.
- Output gallery: square thumbnails, 8px radius, 12px gutter, hover lifts 2px.
