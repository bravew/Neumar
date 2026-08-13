---
summary: "Custom i18n system with type-safe translations, OKLCH color system, theme modes, accent colors, and typography"
read_when:
  - Adding or modifying translations
  - Working with theme colors or design tokens
  - Adding support for a new language
title: "i18n & Theming"
---

# Internationalization & Theming

## Internationalization (i18n)

The i18n system is **custom-built** (no external library):

```
config/locale/
├── index.ts              # Language detection, helper functions
└── messages/
    ├── en/               # English translations
    │   ├── common.ts     # Shared strings
    │   ├── home.ts       # Home page strings
    │   ├── settings.ts   # Settings strings (includes connector + memory translations)
    │   ├── task.ts       # Task strings
    │   └── ...
    ├── zh/               # Chinese translations (same structure)
    ├── es/               # Spanish translations
    └── fr/               # French translations
```

**Usage:**

```tsx
const { t, tt } = useLanguage();

// Direct access (type-safe)
<h1>{t.settings.title}</h1>

// With interpolation
<p>{tt('task.duration', { minutes: 5 })}</p>
```

**Supported locales:** `en-US`, `zh-CN`, `es`, `fr` (auto-detected from system or user preference).

Translation keys are organized by feature (e.g., `home.workInFolder`, `home.selectedFolder`,
`home.removeFolder` for the folder picker UI). Key groups include:

- `task.costBreakdown`, `task.totalCost`, `task.inputTokens`, `task.outputTokens`,
  `task.cacheReadTokens`, `task.cacheCreationTokens` — per-message cost tooltip
- `settings.mcpPresets`, `settings.mcpPresetsSearch`, `settings.mcpPresetsInstall`,
  `settings.mcpPresetsInstalled`, `settings.mcpPresetsUninstall`, `settings.mcpPresetsEmpty`
  — MCP presets gallery

## Theming & Design System

**Color system:** OKLCH color space with CSS custom properties defined in `theme.css`.
Brand primary color is configured in `branding.json` under `theme.primaryColor` (synced to
`theme.css` by `brand-sync.js`).

| Feature | Implementation |
|---------|----------------|
| **Theme modes** | Light / Dark / System (`useSyncExternalStore` for OS `prefers-color-scheme`) |
| **Accent colors** | 7 presets: **brand** (default), blue, purple, orange, green, pink, red |
| **Background styles** | Default, warm, cool (adjusts base surface colors) |
| **Typography** | Plus Jakarta Sans + Inter (body), JetBrains Mono + Fira Code (code) — loaded via Google Fonts |
| **Shadows** | Multi-level blue-tinted shadow tokens (2xs through 2xl) using `rgba(0, 29, 109, ...)` in light mode |
| **Animations** | Custom keyframes (grid, ripple, meteor, marquee) |

The `ThemeProvider` derives `resolvedTheme` during render (no extra state), applies CSS
variables to `document.documentElement` via `useEffect`, and persists choices to the database.
Setter functions are stabilized with `useCallback` and the context value is memoized with
`useMemo`.

---

*See also: [Frontend Overview](index.md) · [Components](components.md) · [Configuration & Branding](../backend/configuration.md)*
