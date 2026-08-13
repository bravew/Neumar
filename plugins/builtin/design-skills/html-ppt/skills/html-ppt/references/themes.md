# Themes Catalog

Every theme is a short CSS file in `assets/themes/` that overrides tokens
defined in `assets/base.css`. Switch themes by changing the `href` of
`<link id="theme-link">` or by pressing **T** when the deck has a
`data-themes="a,b,c"` attribute on `<body>` or `<html>`.

All themes define the same variables: `--bg`, `--bg-soft`, `--surface`,
`--surface-2`, `--border`, `--text-1/2/3`, `--accent`, `--accent-2/3`,
`--good`, `--warn`, `--bad`, `--grad`, `--grad-soft`, `--radius*`, `--shadow*`,
`--font-sans`, and `--font-display`.

## Light & Calm

| name | description | when to use |
|---|---|---|
| `minimal-white` | Restrained white layout, Inter, strong text hierarchy, very subtle shadow. | Internal reports, one-on-one technical reviews, serious topics that should not compete with content. |
| `editorial-serif` | Magazine-style Playfair serif with a warm cream base. | Brand stories and text-heavy talks. |
| `soft-pastel` | Soft pastel three-color gradients. | Product launches, consumer-facing decks, and light topics. |
| `xiaohongshu-white` | White editorial social style with warm red accents and serif titles. | Social carousels, lifestyle, and aesthetic content. |
| `solarized-light` | Classic low-glare palette. | Long workshops and teaching material. |
| `catppuccin-latte` | Catppuccin light palette. | Developer-friendly technical talks. |

## Bold & Statement

| name | description | when to use |
|---|---|---|
| `sharp-mono` | Pure black and white with Archivo Black and hard shadows. | Manifestos and high-impact visuals. |
| `neo-brutalism` | Thick strokes, hard shadows, and bright yellow accents. | Startup pitches and assertive product stories. |
| `bauhaus` | Geometry with primary red, yellow, and blue. | Design talks, art history, and product aesthetics. |
| `swiss-grid` | Swiss grid, Helvetica feel, and a 12-column background. | Serious typography and design-industry decks. |
| `memphis-pop` | Memphis pop background dots with oversized type. | Youthful, trend-forward, or brand-collaboration decks. |

## Cool & Dark

| name | description | when to use |
|---|---|---|
| `catppuccin-mocha` | Catppuccin dark palette. | Internal developer talks and long viewing sessions. |
| `dracula` | Classic Dracula purple-red color system. | Code-heavy technical sharing. |
| `tokyo-night` | Tokyo Night blue-black palette. | Cool-toned infrastructure and engineering decks. |
| `nord` | Nordic cool blue and white palette. | Infrastructure and cloud products. |
| `gruvbox-dark` | Warm retro dark palette. | Terminal, Vim, and Unix-community talks. |
| `rose-pine` | Soft rose-pine dark palette. | Design/development crossover topics. |
| `arctic-cool` | Light blue, cyan, and slate palette. | Business analysis, finance, and calm rational topics. |

## Warm & Vibrant

| name | description | when to use |
|---|---|---|
| `sunset-warm` | Orange, coral, and amber gradients. | Lifestyle, awards, celebrations, and upbeat stories. |

## Effect-Heavy

| name | description | when to use |
|---|---|---|
| `glassmorphism` | Frosted glass with colorful ambient light spots. | Product feature reveals and Apple-style launch decks. |
| `aurora` | Aurora gradients with blur and saturation. | Covers, CTAs, and closing slides. |
| `rainbow-gradient` | White base with flowing rainbow accents. | Festive, joyful, and celebration slides. |
| `blueprint` | Engineering blueprint style with grid texture. | System architecture and engineering diagrams. |
| `terminal-green` | Green-screen terminal style with monospace glow. | CLI, security, and retro-futurist decks. |

## v2 Additions

### Light & Professional

| name | description | when to use |
|---|---|---|
| `corporate-clean` | Pure white, navy accent, Inter, and conservative borders. | Board reports, B2B sales, finance, and insurance. |
| `pitch-deck-vc` | YC-style white deck with blue-purple gradients and generous whitespace. | Fundraising, seed rounds, and VC meetings. |
| `academic-paper` | Paper white, serif body copy, black ink, and blue links. | Academic reports, research sharing, and conference papers. |
| `japanese-minimal` | Ivory base, vermilion accent, large whitespace, and Noto Serif. | Brand refreshes, craft stories, and contemplative narratives. |
| `engineering-whiteprint` | White coordinate grid, navy ink lines, and monospace type. | System design, API docs, and architecture white papers. |

### Bold & Editorial

| name | description | when to use |
|---|---|---|
| `magazine-bold` | Cream base, oversized Playfair serif titles, and orange spot color. | Columns, cover stories, and brand magazines. |
| `news-broadcast` | White base, red vertical bars, uppercase Oswald, and hard shadows. | Breaking news, press briefings, and data broadcasts. |
| `midcentury` | Cream base with mustard, teal, burnt orange, and sharp geometry. | Design history, interiors, and retro brands. |
| `retro-tv` | Warm cream, CRT scanlines, and amber-orange accents. | Nostalgic narratives and 1980s/1990s themes. |

### Dramatic Effects

| name | description | when to use |
|---|---|---|
| `cyberpunk-neon` | Black base with neon pink, cyan, yellow, glow, and JetBrains Mono. | Hacker culture, underground scenes, and cyberpunk talks. |
| `vaporwave` | Deep purple with pink/cyan gradients and ambient bloom. | Music, trend art, and retro digital aesthetics. |
| `y2k-chrome` | Silver chrome gradients, rainbow accents, large radii, and Space Grotesk. | Y2K nostalgia, fashion brands, and Gen-Z decks. |

## How To Apply

```html
<link rel="stylesheet" id="theme-link" href="../assets/themes/aurora.css">
```

Or enable `T` cycling by listing themes on the body:

```html
<body data-themes="minimal-white,aurora,catppuccin-mocha" data-theme-base="../assets/themes/">
```

## How To Extend

Copy an existing theme, rename it, and override only the variables you want to
change. Keep each theme under about 200 lines. Prefer adjusting tokens to
adding new selectors.
