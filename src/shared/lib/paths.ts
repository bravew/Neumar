/**
 * Path utilities
 *
 * Uses ~/.<slug>/ as the standard data directory across all platforms.
 * This follows the Unix dotfile convention used by developer tools like:
 * - ~/.claude/ (Claude Code)
 * - ~/.npm/ (npm)
 * - ~/.docker/ (Docker)
 */

import { APP_DATA_DIR, APP_SLUG } from '@/config/branding';

// Cache for resolved paths
let cachedAppDataDir: string | null = null;
let cachedSeparator: string | null = null;

/**
 * Check if running in Tauri environment
 */
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Get the path separator for the current platform
 */
export async function getPathSeparator(): Promise<string> {
  if (cachedSeparator) {
    return cachedSeparator;
  }

  if (isTauri()) {
    try {
      const { sep } = await import('@tauri-apps/api/path');
      cachedSeparator = sep();
      return cachedSeparator;
    } catch {
      // Fallback
    }
  }

  // Default to Unix separator
  cachedSeparator = '/';
  return cachedSeparator;
}

/**
 * Join path segments using the correct separator for the platform
 */
export async function joinPath(...segments: string[]): Promise<string> {
  const sep = await getPathSeparator();
  return segments.join(sep);
}

/**
 * Get the Claude skills directory path (platform-aware)
 */
export async function getClaudeSkillsDir(): Promise<string> {
  if (isTauri()) {
    try {
      const { homeDir, sep } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      const separator = sep();
      const homeClean =
        home.endsWith('/') || home.endsWith('\\') ? home.slice(0, -1) : home;
      return `${homeClean}${separator}.claude${separator}skills`;
    } catch {
      // Fallback
    }
  }
  return '~/.claude/skills';
}

/**
 * Get the application MCP config path (platform-aware)
 */
export async function getAppMcpPath(): Promise<string> {
  const appDir = await getAppDataDir();
  const sep = await getPathSeparator();
  return `${appDir}${sep}mcp.json`;
}

/**
 * Get the application data directory
 * Returns ~/.<slug> on all platforms (using correct path separator)
 */
export async function getAppDataDir(): Promise<string> {
  if (cachedAppDataDir) {
    return cachedAppDataDir;
  }

  if (isTauri()) {
    try {
      const { homeDir, sep } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      const separator = sep();
      // Remove trailing slash/backslash if present
      const homeClean =
        home.endsWith('/') || home.endsWith('\\') ? home.slice(0, -1) : home;
      cachedAppDataDir = `${homeClean}${separator}${APP_DATA_DIR}`;
      return cachedAppDataDir;
    } catch (error) {
      console.warn('[Paths] Failed to get home dir:', error);
    }
  }

  // Fallback for browser mode
  cachedAppDataDir = `~/${APP_DATA_DIR}`;
  return cachedAppDataDir;
}

/**
 * Get the default working directory for sessions
 */
export async function getDefaultWorkDir(): Promise<string> {
  const appDir = await getAppDataDir();
  return appDir;
}

/**
 * Get the default sessions directory
 */
export async function getSessionsDir(): Promise<string> {
  const appDir = await getAppDataDir();
  const sep = await getPathSeparator();
  return `${appDir}${sep}sessions`;
}

/**
 * Get the default MCP config path
 */
export async function getMcpConfigPath(): Promise<string> {
  const appDir = await getAppDataDir();
  const sep = await getPathSeparator();
  return `${appDir}${sep}mcp.json`;
}

/**
 * Get the default skills directory
 */
export async function getSkillsDir(): Promise<string> {
  const appDir = await getAppDataDir();
  const sep = await getPathSeparator();
  return `${appDir}${sep}skills`;
}

/**
 * Get the default config file path
 */
export async function getConfigPath(): Promise<string> {
  const appDir = await getAppDataDir();
  const sep = await getPathSeparator();
  return `${appDir}${sep}config.json`;
}

/**
 * Expand ~ to home directory (for display purposes)
 * In Tauri, paths are already expanded. This is mainly for
 * converting user input.
 */
export async function expandPath(path: string): Promise<string> {
  if (!path.startsWith('~')) {
    return path;
  }

  if (isTauri()) {
    try {
      const { homeDir } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      // Remove trailing slash or backslash
      const homeClean = home.replace(/[/\\]$/, '');
      return path.replace(/^~/, homeClean);
    } catch (error) {
      console.warn('[Paths] Failed to expand path:', error);
    }
  }

  return path;
}

/**
 * Get the log file path (platform-aware)
 */
export async function getLogPath(): Promise<string> {
  const appDir = await getAppDataDir();
  const sep = await getPathSeparator();
  return `${appDir}${sep}logs${sep}${APP_SLUG}.log`;
}

/**
 * Get a display-friendly version of a path
 * Replaces home directory with ~ for cleaner display
 */
export async function getDisplayPath(path: string): Promise<string> {
  if (isTauri()) {
    try {
      const { homeDir } = await import('@tauri-apps/api/path');
      const home = await homeDir();
      // Remove trailing slash or backslash for comparison
      const homeWithoutSlash = home.replace(/[/\\]$/, '');
      if (path.startsWith(homeWithoutSlash)) {
        return path.replace(homeWithoutSlash, '~');
      }
    } catch {
      // Ignore errors
    }
  }

  return path;
}

/**
 * Get the filename from a path (cross-platform)
 * Works with both Unix (/) and Windows (\) paths
 */
export function getFileName(filePath: string): string {
  if (!filePath) return '';
  // Split on both / and \ and get the last part
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Get the directory from a path (cross-platform)
 * Works with both Unix (/) and Windows (\) paths
 */
export function getDirName(filePath: string): string {
  if (!filePath) return '';
  const lastSlash = Math.max(
    filePath.lastIndexOf('/'),
    filePath.lastIndexOf('\\'),
  );
  if (lastSlash <= 0) {
    // Handle root paths
    if (filePath.startsWith('/')) return '/';
    if (/^[A-Za-z]:\\/.test(filePath)) return filePath.substring(0, 3);
    return '';
  }
  return filePath.substring(0, lastSlash);
}

/**
 * Resolve an artifact path to a canonical absolute form.
 * - Collapses `//`, strips `./` prefix
 * - Resolves relative paths against `workingDir`
 * - Collapses `..` segments
 * - Strips trailing slash
 */
export function resolveArtifactPath(p: string, workingDir?: string): string {
  let result = p.replace(/\/\/+/g, '/');
  if (result.startsWith('./')) result = result.slice(2);
  if (!result.startsWith('/') && workingDir) {
    result = `${workingDir}/${result}`;
  }
  const segments = result.split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '' && resolved.length === 0) resolved.push('');
    else if (seg === '.' || seg === '') {
      /* skip */
    } else if (seg === '..') {
      if (resolved.length > 1) resolved.pop();
    } else resolved.push(seg);
  }
  result = resolved.join('/') || '/';
  if (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1);
  return result;
}

/**
 * Check if a path is absolute (cross-platform)
 * Works with both Unix (/) and Windows (C:\) paths
 */
export function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false;
  // Unix absolute path
  if (filePath.startsWith('/')) return true;
  // Windows absolute path (e.g., C:\, D:\)
  if (/^[A-Za-z]:\\/.test(filePath)) return true;
  return false;
}
