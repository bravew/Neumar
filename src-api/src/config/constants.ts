/**
 * Application Constants
 *
 * Centralized configuration constants for the API.
 * Branding values are imported from @/config/branding (sourced from /branding.json).
 * All hardcoded values should be defined here for easy management.
 */

import { statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

import { DEFAULT_CLAUDE_MODEL } from '@/core/agent/claude-models';

import { getSetting } from '@/shared/db/operations';

import {
  APP_DATA_DIR,
  APP_DB_NAME,
  APP_DISPLAY_NAME,
  APP_SLUG,
  branding,
} from './branding';

// ============================================================================
// Application Identity (derived from branding config)
// ============================================================================

/** Application name (slug form, from branding.json) */
export const APP_NAME = APP_SLUG;

/** Application data directory name (from branding.slug) */
export const APP_DIR_NAME = APP_DATA_DIR;

/** Claude Code directory name (system config) */
export const CLAUDE_DIR_NAME = '.claude';

// Re-export branding for convenience
export { APP_DB_NAME, APP_DISPLAY_NAME, APP_SLUG, branding };

// ============================================================================
// Server Configuration
// ============================================================================

/** Default API server port */
export const DEFAULT_API_PORT = 2620;

/** Default API server host */
export const DEFAULT_API_HOST = 'localhost';

// ============================================================================
// Directory Structure
// ============================================================================

/** Default work directory path (absolute — tilde is expanded at startup) */
export const DEFAULT_WORK_DIR = `${homedir()}/${APP_DIR_NAME}`;

/** Sessions subdirectory name */
export const SESSIONS_DIR_NAME = 'sessions';

/** Skills subdirectory name */
export const SKILLS_DIR_NAME = 'skills';

/** Logs subdirectory name */
export const LOGS_DIR_NAME = 'logs';

/** Cache subdirectory name */
export const CACHE_DIR_NAME = 'cache';

// ============================================================================
// Configuration Files
// ============================================================================

/** Main config filename */
export const CONFIG_FILE_NAME = 'config.json';

/** MCP config filename */
export const MCP_CONFIG_FILE_NAME = 'mcp.json';

/** Linear config filename (encrypted) */
export const LINEAR_CONFIG_FILE_NAME = 'linear.enc.json';

/** Auth tokens filename (encrypted) */
export const AUTH_TOKENS_FILE_NAME = 'auth.enc.json';

/** MCP remote OAuth tokens filename (encrypted) */
export const MCP_OAUTH_TOKENS_FILE_NAME = 'mcp-oauth.enc.json';

/** Channel credentials filename (encrypted) */
export const CHANNEL_CREDS_FILE_NAME = 'channel-creds.enc.json';

/** Encrypted secrets filename */
export const SECRETS_FILE_NAME = 'secrets.enc.json';

/** Config file search paths (relative, derived from branding slug) */
export const CONFIG_SEARCH_PATHS = [
  `./${APP_SLUG}.config.json`,
  `./config/${APP_SLUG}.json`,
];

// ============================================================================
// Default Provider Settings
// ============================================================================

/** Default sandbox provider type */
export const DEFAULT_SANDBOX_PROVIDER = 'codex';

/** Default agent provider type */
export const DEFAULT_AGENT_PROVIDER = 'claude';

/** Default agent model */
export const DEFAULT_AGENT_MODEL = DEFAULT_CLAUDE_MODEL;

// ============================================================================
// Timeouts and Limits
// ============================================================================

/** Default script execution timeout (ms) */
export const DEFAULT_SCRIPT_TIMEOUT = 120000;

/** Default API request timeout (ms) */
export const DEFAULT_API_TIMEOUT = 30000;

/** Maximum sandbox pool size */
export const DEFAULT_SANDBOX_POOL_SIZE = 5;

/** Pipeline execution timeouts */
export const PIPELINE_PHASE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per agent phase
export const PIPELINE_TOTAL_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes total per pipeline

/** Polling defaults */
export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (dev-only fallback)

/** PR review loop defaults */
export const PR_REVIEW_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between checks
export const PR_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour max window
export const PR_REVIEW_MAX_FIX_ITERATIONS = 10;

/** Webhook idempotency */
export const WEBHOOK_DELIVERY_TTL_MS = 60 * 60 * 1000; // 1 hour TTL for dedup cache

/** Linear webhook source IPs (for IP allowlisting) */
export const LINEAR_WEBHOOK_IPS = [
  '35.231.147.226',
  '35.243.134.228',
  '34.140.253.14',
  '34.38.87.206',
  '34.134.222.122',
  '35.222.25.142',
];

/** Pipeline state TTL */
export const PIPELINE_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days before eviction

// ============================================================================
// Network Configuration
// ============================================================================

/** Sandbox API port (internal) */
export const SANDBOX_API_PORT = 2620;

/** Get sandbox API URL */
export function getSandboxApiUrl(): string {
  return (
    process.env.SANDBOX_API_URL ||
    `http://${DEFAULT_API_HOST}:${SANDBOX_API_PORT}`
  );
}

// ============================================================================
// Path Helpers (cross-platform compatible)
// ============================================================================

/** Get user home directory */
export function getHomeDir(): string {
  return homedir();
}

/** Get application data directory (e.g., ~/.<slug>) */
export function getAppDir(): string {
  return join(homedir(), APP_DIR_NAME);
}

/** Get Claude Code directory */
export function getClaudeDir(): string {
  return join(homedir(), CLAUDE_DIR_NAME);
}

/** Get application skills directory */
export function getAppSkillsDir(): string {
  return join(getAppDir(), SKILLS_DIR_NAME);
}

/** Get Claude skills directory */
export function getClaudeSkillsDir(): string {
  return join(getClaudeDir(), SKILLS_DIR_NAME);
}

/** Get all skills directories to search */
export function getAllSkillsDirs(): { name: string; path: string }[] {
  return [
    { name: 'app', path: getAppSkillsDir() },
    { name: 'claude', path: getClaudeSkillsDir() },
  ];
}

/** Cached resolved bundled skills directory */
let resolvedBundledSkillsDir: string | null | undefined;

/** Get bundled skills directory (shipped with the app) */
export function getBundledSkillsDir(): string | null {
  if (resolvedBundledSkillsDir !== undefined) return resolvedBundledSkillsDir;

  // Production: Tauri passes RESOURCES_DIR; ../skills/**/* maps to _up_/skills/
  const resourcesDir = process.env.RESOURCES_DIR;
  if (resourcesDir) {
    const bundled = join(resourcesDir, '_up_', 'skills');
    try {
      if (statSync(bundled).isDirectory()) {
        resolvedBundledSkillsDir = bundled;
        return bundled;
      }
    } catch {
      // not found at _up_ path
    }
    // Fallback: direct skills/ in resources
    const direct = join(resourcesDir, 'skills');
    try {
      if (statSync(direct).isDirectory()) {
        resolvedBundledSkillsDir = direct;
        return direct;
      }
    } catch {
      // not found
    }
  }

  // Dev: resolve from workspace root — getSetting('workDir') is the user-configured
  // workspace directory; fall back to process.cwd() only when it is not yet set.
  const workspaceRoot = getSetting('workDir') ?? process.cwd();
  const candidates = [
    resolve(workspaceRoot, '..', 'skills'),
    resolve(workspaceRoot, 'skills'),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) {
        resolvedBundledSkillsDir = candidate;
        return candidate;
      }
    } catch {
      // try next
    }
  }

  resolvedBundledSkillsDir = null;
  return null;
}

/** Get application MCP config path */
export function getAppMcpConfigPath(): string {
  return join(getAppDir(), MCP_CONFIG_FILE_NAME);
}

/** Get Linear integration config path */
export function getLinearConfigPath(): string {
  return join(getAppDir(), LINEAR_CONFIG_FILE_NAME);
}

/** Get auth tokens config path (encrypted) */
export function getAuthTokensPath(): string {
  return join(getAppDir(), AUTH_TOKENS_FILE_NAME);
}

/** Get MCP remote OAuth tokens config path (encrypted) */
export function getMcpOAuthTokensPath(): string {
  return join(getAppDir(), MCP_OAUTH_TOKENS_FILE_NAME);
}

/** Get channel credentials config path (encrypted) */
export function getChannelCredsPath(): string {
  return join(getAppDir(), CHANNEL_CREDS_FILE_NAME);
}

/** Get encrypted secrets file path */
export function getSecretsPath(): string {
  return join(getAppDir(), SECRETS_FILE_NAME);
}

/** Get Claude settings path (contains MCP config) */
export function getClaudeSettingsPath(): string {
  return join(getClaudeDir(), 'settings.json');
}

/** Get all MCP config paths to search */
export function getAllMcpConfigPaths(): { name: string; path: string }[] {
  return [
    { name: 'app', path: getAppMcpConfigPath() },
    { name: 'claude', path: getClaudeSettingsPath() },
  ];
}
