/**
 * Branding Configuration — Frontend
 *
 * Type definitions and exports for branding values.
 * The actual values are injected by Vite at build time from /branding.json.
 * See vite.config.ts `define.__BRANDING__` for the injection point.
 *
 * To rebrand: edit /branding.json then run `pnpm brand:sync`.
 */

// ============================================================================
// Branding Type Definition
// ============================================================================

export interface BrandingUrls {
  /** Main product website */
  website: string;
  /** Download page URL */
  download: string;
  /** Support/help URL */
  support: string;
  /** Documentation URL */
  docs: string;
}

export interface BrandingTheme {
  /** Primary brand color in OKLCH format (light mode) */
  primaryColor: string;
  /** Primary brand color in OKLCH format (dark mode) */
  primaryColorDark: string;
  /** Machine-readable ID for the brand accent color (e.g., "brand") */
  accentColorId: string;
  /** Human-readable name for the brand accent color (e.g., "Brand") */
  accentColorName: string;
  /** Shadow tint color for light mode (hex) */
  shadowColorLight: string;
  /** Shadow tint color for dark mode (hex) */
  shadowColorDark: string;
}

export interface BrandingApi {
  /** Base name for the compiled API binary */
  binaryName: string;
}

export interface BrandingSite {
  /** Base URL for the companion web app API */
  apiBaseUrl?: string;
}

export interface BrandingConfig {
  /** Display name shown to users */
  displayName: string;
  /** URL-safe slug, lowercase with hyphens */
  slug: string;
  /** Reverse-domain identifier */
  identifier: string;
  /** Short tagline / subtitle */
  tagline: string;
  /** Full description for about pages */
  description: string;
  /** Copyright holder name */
  copyrightHolder: string;
  /** Product URLs */
  urls: BrandingUrls;
  /** Theme / visual identity */
  theme: BrandingTheme;
  /** API configuration */
  api: BrandingApi;
  /** Companion web site configuration */
  site?: BrandingSite;
}

// ============================================================================
// Branding Values (injected by Vite at build time)
// ============================================================================

/**
 * The branding config object, injected at build time by Vite's `define`.
 * See vite.config.ts for the injection and /branding.json for the source values.
 */
declare const __BRANDING__: BrandingConfig;

export const branding: BrandingConfig = __BRANDING__;

// ============================================================================
// Convenience Exports — most commonly used branding values
//
// Naming convention (consistent across frontend & backend):
//   APP_DISPLAY_NAME — human-readable display name (from branding.json displayName)
//   APP_SLUG         — URL-safe machine identifier  (from branding.json slug)
//   APP_NAME         — alias for APP_DISPLAY_NAME (frontend backward-compat)
// ============================================================================

/** Application display name (from branding.json) — canonical export */
export const APP_DISPLAY_NAME = branding.displayName;

/**
 * Alias for APP_DISPLAY_NAME.
 * Prefer APP_DISPLAY_NAME in new code for cross-layer consistency with the backend.
 */
export const APP_NAME = APP_DISPLAY_NAME;

/** Application URL-safe slug (from branding.json) */
export const APP_SLUG = branding.slug;

/** Application reverse-domain identifier (from branding.json) */
export const APP_IDENTIFIER = branding.identifier;

/** Application tagline */
export const APP_TAGLINE = branding.tagline;

/** User data directory name, derived from slug */
export const APP_DATA_DIR = `.${branding.slug}`;

/** SQLite database name, derived from slug */
export const APP_DB_NAME = `${branding.slug}.db`;
