/**
 * Application Configuration
 *
 * Centralized configuration for the application.
 * Branding values are imported from @/config/branding (sourced from /branding.json).
 */

import { branding } from './branding';

// Re-export branding constants for backward compatibility
export {
  APP_DISPLAY_NAME,
  APP_NAME,
  APP_IDENTIFIER,
  APP_SLUG,
  branding,
} from './branding';

// =============================================================================
// API Configuration
// =============================================================================

/**
 * API port configuration
 * - Development: 5126 (run `pnpm dev:api` separately)
 * - Production: 2620 (bundled sidecar)
 */
export const API_PORT = import.meta.env.PROD ? 2620 : 5126;

/**
 * API base URL
 */
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/**
 * Companion site API base URL for hosted prompt repositories.
 * When unset, DesignMode falls back to built-in prompt templates.
 */
export const SITE_API_BASE_URL =
  import.meta.env.VITE_SITE_API_BASE_URL ?? branding.site?.apiBaseUrl ?? '';

export const EXECUTION_DIAGNOSTICS_UI_ENABLED = !['0', 'false', 'off'].includes(
  (import.meta.env.VITE_NEUMA_DIAGNOSTICS_UI_ENABLED ?? '').toLowerCase(),
);

function readBooleanBuildFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return fallback;
}

/**
 * Connector platform V2 is a build-time frontend decision. Keep it out of
 * persisted client settings so stale local settings cannot hide the tab.
 */
export const CONNECTOR_PLATFORM_V2_ENABLED = readBooleanBuildFlag(
  import.meta.env.VITE_NEUMA_CONNECTORS_PLATFORM_V2,
  true,
);
