/**
 * Branding Configuration — Backend (Auto-Generated)
 *
 * ⚠️  THIS FILE IS AUTO-GENERATED from /branding.json
 *     Do not edit directly. Run `pnpm brand:sync` to regenerate.
 *
 * To rebrand: edit /branding.json then run `pnpm brand:sync`.
 *
 * NOTE: The type definitions below mirror src/config/branding.ts (frontend).
 * If you add a field, update both files and the EXPECTED_SCHEMA in brand-sync.js.
 */

// ============================================================================
// Branding Type Definitions (mirrors src/config/branding.ts)
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
// Branding Values
// ============================================================================

export const branding: BrandingConfig = {
  "displayName": "Neumar",
  "slug": "neumar",
  "identifier": "ai.neumar",
  "tagline": "Your Tireless AI Workhorse",
  "description": "A desktop AI agent application that works tirelessly like a bull and horse to execute tasks through natural language.",
  "copyrightHolder": "Neumar",
  "urls": {
    "website": "https://neumar.app",
    "download": "https://neumar.app/download",
    "support": "https://neumar.app/support",
    "docs": "https://neumar.app/docs"
  },
  "theme": {
    "primaryColor": "oklch(0.45 0.18 30)",
    "primaryColorDark": "oklch(0.65 0.16 30)",
    "accentColorId": "brand",
    "accentColorName": "Brand",
    "shadowColorLight": "#3d1a00",
    "shadowColorDark": "#000000"
  },
  "api": {
    "binaryName": "neumar-api"
  },
  "site": {
    "apiBaseUrl": ""
  }
};

// ============================================================================
// Convenience Exports
// ============================================================================

/** Application display name (from branding.json) */
export const APP_DISPLAY_NAME = branding.displayName;

/** Application URL-safe slug (from branding.json) */
export const APP_SLUG = branding.slug;

/** User data directory name, derived from slug */
export const APP_DATA_DIR = `.${branding.slug}`;

/** SQLite database name, derived from slug */
export const APP_DB_NAME = `${branding.slug}.db`;
