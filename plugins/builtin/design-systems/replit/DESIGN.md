# Design System Inspired by Replit

> Category: Developer Tools
> Collaborative cloud IDE. Warm orange-ember accent on graphite, IBM Plex typography, playful but precise.

## 1. Visual Theme & Atmosphere

Replit balances the precision of an IDE with the friendliness of a community product. Surfaces are graphite (`#0E1525`) with panel lift to `#1C2333`, and the accent is a warm orange-ember (`#F26207`) used for the Run button, primary actions, and the AI Agent pulse. Avatars and presence indicators are common — multiplayer is part of the brand. Type is IBM Plex Sans for UI and IBM Plex Mono for code, giving the system a slightly engineered, slightly humanist feel.

**Key Characteristics:**
- Graphite canvas (`#0E1525`), panels `#1C2333`, code `#0B1120`
- Orange-ember accent (`#F26207`) for Run, AI generate, primary CTA
- IBM Plex Sans for UI, IBM Plex Mono for code
- Strong presence affordances: avatar stack on every shared file, 2px ring on cursor
- Cards use 1px border at `#2B3245` and 8-10px radius

## 2. Color Palette & Roles

### Primary
- **Replit Graphite** (`#0E1525`)
- **Panel** (`#1C2333`)
- **Code Surface** (`#0B1120`)
- **Foreground** (`#F5F9FC`)

### Accents
- **Replit Orange** (`#F26207`): Run, AI generate, primary CTA.
- **Agent Cyan** (`#39E0FF`): AI Agent typing indicator, beta tags.
- **Success** (`#3FCF8E`)
- **Warning** (`#FFB13D`)

### Borders / Muted
- **Border** (`#2B3245`)
- **Muted Text** (`#8B97A8`)

## 3. Typography

- IBM Plex Sans 14px UI, 12px chrome.
- IBM Plex Mono 13px in editor and terminal.
- Display 28-40px, weight 600, slight tracking tighten.

## 4. Component Cues

- Run button: orange fill, white text, sharp 6px radius, plays a small bounce on press.
- Multiplayer cursors: name tag pill matching avatar color, 2px ring on hovered file.
- AI Agent panel: cyan accent line on the left, mono labels, streaming dots.
