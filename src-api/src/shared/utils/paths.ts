/**
 * Path utilities for the API
 *
 * Uses ~/.<slug>/ as the standard data directory across all platforms.
 * This follows the Unix dotfile convention used by developer tools like:
 * - ~/.claude/ (Claude Code)
 * - ~/.npm/ (npm)
 * - ~/.docker/ (Docker)
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  APP_DIR_NAME,
  CONFIG_FILE_NAME,
  MCP_CONFIG_FILE_NAME,
  SESSIONS_DIR_NAME,
  SKILLS_DIR_NAME,
} from '@/config/constants';

/**
 * Get the application data directory
 * Returns ~/.<slug> on all platforms
 */

export function getAppDataDir(): string {
  const override = process.env.NEUMAR_APP_DATA_DIR?.trim();
  if (override) return override;
  const home = os.homedir();
  return path.join(home, APP_DIR_NAME);
}

/**
 * Get the application config directory
 * Same as app data dir for simplicity
 */
export function getConfigDir(): string {
  return getAppDataDir();
}

/**
 * Get the default sessions directory
 */
export function getSessionsDir(): string {
  return path.join(getAppDataDir(), SESSIONS_DIR_NAME);
}

/**
 * Get the default config file path
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Get the default MCP config path
 */
export function getMcpConfigPath(): string {
  return path.join(getConfigDir(), MCP_CONFIG_FILE_NAME);
}

/**
 * Get the default skills directory
 */
export function getSkillsDir(): string {
  return path.join(getAppDataDir(), SKILLS_DIR_NAME);
}

/**
 * Expand ~ to home directory, strip shell-style quotes, and normalize
 * path separators for the current platform.
 */
export function expandPath(inputPath: string): string {
  // Strip wrapping quotes that may leak from shell or config values
  let result = inputPath.replace(/^["']|["']$/g, '');
  if (result.startsWith('~')) {
    result = path.join(os.homedir(), result.slice(1));
  }
  // Normalize path separators for Windows
  if (process.platform === 'win32') {
    result = result.replace(/\//g, '\\');
  }
  return result;
}

/** Resolve via `fs.access`, returning a boolean rather than throwing. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
