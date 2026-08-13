---
summary: "Configuration constants, config loader, and the multi-brand system — branding.json, brand-sync, propagation architecture, and rebranding"
read_when:
  - Working with app configuration or constants
  - Rebranding or creating a new brand
  - Understanding how branding values propagate through the codebase
title: "Configuration & Branding"
---

# Configuration System

## Constants

`config/constants.ts` defines key defaults:

| Constant | Default | Description |
|----------|---------|-------------|
| `APP_DIR_NAME` | `.<slug>` | Application data directory name (resolves to `~/.<slug>/` via `getAppDir()`) — derived from `branding.slug` |
| `DEFAULT_API_PORT` | `2620` | API server port (production); dev defaults to `5126` in `src-api/src/index.ts` |
| `DEFAULT_SANDBOX_PROVIDER` | `codex` | Default sandbox backend |
| `DEFAULT_AGENT_PROVIDER` | `claude` | Default agent backend |
| `DEFAULT_AGENT_MODEL` | `claude-sonnet-5` | Default AI model |
| `DEFAULT_SANDBOX_POOL_SIZE` | `5` | Maximum concurrent sandbox instances |
| `LINEAR_CONFIG_FILE_NAME` | `linear.enc.json` | Encrypted Linear config file |
| `PIPELINE_PHASE_TIMEOUT_MS` | `600000` (10 min) | Per-phase agent timeout |
| `PIPELINE_TOTAL_TIMEOUT_MS` | `3600000` (60 min) | Total pipeline timeout |
| `DEFAULT_POLL_INTERVAL_MS` | `300000` (5 min) | Dev-only polling interval |
| `PR_REVIEW_POLL_INTERVAL_MS` | `300000` (5 min) | PR review check interval |
| `PR_REVIEW_WINDOW_MS` | `86400000` (24 hr) | Maximum PR review wait window |
| `PR_REVIEW_MAX_FIX_ITERATIONS` | `10` | Maximum review fix cycles |
| `WEBHOOK_DELIVERY_TTL_MS` | `3600000` (1 hr) | Webhook dedup cache TTL |
| `PIPELINE_STATE_TTL_MS` | `604800000` (7 days) | Pipeline state eviction TTL |
| `LINEAR_WEBHOOK_IPS` | `[35.231.147.226, ...]` | Linear webhook source IPs for allowlisting |

**TypeScript strictness:** The API tsconfig enables `noUncheckedIndexedAccess`, requiring
explicit null checks on array/object index access (e.g., `arr[0]!` or guard clauses).

## Config Loader

`config/loader.ts` provides:
- Multi-source loading: file-based config → environment variables → runtime overrides
- File watching for hot-reload of configuration changes
- Deep-merge strategy for nested configuration objects
- Frontend settings sync via API endpoint

---

# Branding System

All product identity — name, slug, identifier, URLs, theme colors, visual assets, and
binary name — is defined per-brand in `branding/<slug>/branding.json`. Each brand folder
is self-contained with its own config and visual assets. The active brand is mirrored to
the root `/branding.json` by the sync script.

## Multi-Brand Directory Structure

```
branding/
├── default/                    # Default brand (tracked in git)
│   ├── branding.json           # Brand configuration (source of truth)
│   ├── logo.png                # App logo (512×512)
│   ├── app-icon.png            # Web/PWA icon (1024×1024)
│   ├── favicon.ico             # Browser favicon
│   ├── icons/                  # Tauri desktop icons (all platforms)
│   │   ├── icon.png            # Linux / generic (512×512)
│   │   ├── icon.icns           # macOS app bundle
│   │   ├── icon.ico            # Windows ICO
│   │   ├── 32x32.png ... 128x128@2x.png
│   │   ├── Square*.png, StoreLogo.png  # Windows Store
│   │   ├── android/            # Android mipmap icons
│   │   └── ios/                # iOS AppIcon set
│   ├── generate-assets.py      # Python utility to regenerate all icon sizes from source
│   └── pencil-new.pen          # Source design file
├── my-brand/                   # Custom brand (gitignored)
│   ├── branding.json
│   ├── logo.png
│   └── ...
```

Only `branding/default/` is tracked in git. Other brand folders are gitignored, allowing
teams to maintain private brand configurations locally.

## Propagation Architecture

Branding values flow through three channels:

```
branding/<slug>/branding.json   ← Source of truth (per-brand folder)
    │
    ├──▶ scripts/brand-sync.js (pnpm brand:sync)
    │      │
    │      ├── Copies brand config + assets to runtime locations:
    │      │   ├── branding.json (root)         ← mirror of active brand config
    │      │   ├── src/assets/logo.png          ← from branding/<slug>/logo.png
    │      │   ├── public/favicon.ico           ← from branding/<slug>/favicon.ico
    │      │   ├── public/app-icon.png          ← from branding/<slug>/app-icon.png
    │      │   └── src-tauri/icons/             ← from branding/<slug>/icons/ (recursive)
    │      │
    │      └── Patches downstream config files:
    │          ├── src-api/src/config/branding.ts  (auto-generated backend module)
    │          ├── index.html                       (<title> tag)
    │          ├── src-tauri/tauri.conf.json        (productName, identifier, externalBin)
    │          ├── src-tauri/Cargo.toml             (package name, lib name, description)
    │          ├── src-tauri/src/lib.rs             (sidecar name, db name)
    │          ├── src-tauri/src/main.rs            (Rust lib crate name call)
    │          ├── src-tauri/capabilities/default.json (FS scopes, sidecar permissions)
    │          ├── src/config/style/theme.css       (brand primary colors and shadow tints)
    │          ├── package.json                     (package name, pnpm filter references)
    │          ├── src-api/package.json             (API package name, binary build commands)
    │          └── .github/workflows/build.yml      (CI binary names, release name, launcher scripts)
    │
    ├──▶ Vite define (build time)
    │      └── __BRANDING__ global → src/config/branding.ts (frontend)
    │
    ├──▶ Runtime readers (read root branding.json directly, NOT patched by brand-sync)
    │      ├── scripts/ensure-api-binary.js     (binary name for dev sidecar setup)
    │      ├── scripts/build.sh                 (binary name, app bundle name, cache dir)
    │      └── scripts/version.sh               (comment header with display name)
    │
    └──▶ Direct JSON.parse at build time
           └── vite.config.ts reads root branding.json
```

## Brand Selection

```bash
pnpm brand:sync                        # Sync active brand (reads slug from root branding.json)
pnpm brand:sync -- --brand=my-brand    # Switch to a specific brand
pnpm brand:sync -- --brand=default     # Switch back to the default brand
pnpm brand:sync -- --check             # CI mode — verify files are in sync without writing
```

The `--brand=<slug>` argument selects which brand folder to activate. The script looks
for `branding/<slug>/branding.json`, copies assets to their runtime locations, and patches
all downstream config files. Without `--brand`, it reads the slug from the existing root
`branding.json`.

## Branding Fields

| Field | Purpose | Where Used |
|-------|---------|------------|
| `displayName` | User-facing product name | Title bar, About page, docs, CI release name |
| `slug` | URL-safe identifier | Data directory (`~/.<slug>/`), package name, config keys |
| `identifier` | Reverse-domain ID | macOS bundle ID, Tauri identifier, cache paths |
| `tagline` | Short subtitle | About page |
| `description` | Full description | About page, Cargo.toml |
| `copyrightHolder` | Copyright holder name | About page |
| `urls.*` | Product URLs | About page links, documentation |
| `theme.*` | Brand colors and shadows | CSS custom properties, accent color presets |
| `api.binaryName` | Compiled API binary name | Sidecar reference, build output |

## Visual Assets

Visual assets are stored alongside `branding.json` in the brand folder and are
**automatically copied** by `brand-sync.js` to their runtime locations:

| Brand Folder File | Copied To | Purpose | Sizes |
|-------------------|-----------|---------|-------|
| `logo.png` | `src/assets/logo.png` | App logo (sidebar, About, settings) | 512×512 recommended |
| `favicon.ico` | `public/favicon.ico` | Browser tab favicon | Multi-size ICO (16, 32, 48) |
| `app-icon.png` | `public/app-icon.png` | Web/PWA icon | 1024×1024 recommended |
| `icons/` | `src-tauri/icons/` | Desktop icons (all platforms) | See below |

**Tauri icon directory** (`icons/`) contains platform-specific icon variants
auto-generated from a single 1024×1024 source image:

| File | Platform | Size |
|------|----------|------|
| `icon.png` | Linux / generic | 512×512 |
| `icon.icns` | macOS app bundle | Multi-resolution |
| `icon.ico` | Windows ICO | Multi-resolution |
| `Square*.png`, `StoreLogo.png` | Windows (MSIX/Store) | 30×30 – 310×310 |
| `android/mipmap-*/` | Android launcher icons | mdpi – xxxhdpi |
| `ios/AppIcon-*` | iOS | 20×20@2x – 512@2x |

> **Tip:** Each brand folder can include a `generate-assets.py` Python script to regenerate
> all icon variants from a source image. Alternatively, use `tauri icon <source.png>` to
> generate the Tauri-specific icons.

## Frontend Branding

`src/config/branding.ts` exports typed `BrandingConfig` using Vite's `define` injection —
values are inlined at build time with zero runtime cost. Components import brand values as:

```typescript
import { APP_NAME, branding } from '@/config/branding';
import ImageLogo from '@/assets/logo.png'; // Static import, bundled by Vite
```

## Backend Branding

`src-api/src/config/branding.ts` is auto-generated by `brand-sync.js` with the same typed
interface as the frontend. Constants like `APP_DATA_DIR`, `APP_SLUG`, `APP_DB_NAME` are
derived from the branding slug.

## Complete Rebranding Checklist

To fully rebrand the application:

1. **Create a new brand folder** — `branding/<my-slug>/` with:
   - `branding.json` — brand config (`displayName`, `slug`, `identifier`, `urls`, `theme`,
     `copyrightHolder`, `api.binaryName`)
   - `logo.png` — Main app logo (512×512 PNG)
   - `favicon.ico` — Browser favicon (multi-size ICO)
   - `app-icon.png` — Web/PWA icon (1024×1024 PNG)
   - `icons/` — Desktop icons for all platforms (use `tauri icon <source.png>` or a
     custom `generate-assets.py` to generate from a source image)
2. **Run `pnpm brand:sync -- --brand=<my-slug>`** — Copies assets and propagates
   config to all downstream files.
3. **Rebuild** — Run `pnpm build` (frontend) and `./scripts/build.sh` (full app) to verify.

---

*See also: [Backend Overview](index.md) · [i18n & Theming](../frontend/i18n-and-theming.md) · [Build & Deployment](../build/index.md)*
