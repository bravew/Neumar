/**
 * Folder Permission Helpers
 *
 * Pure functions (no side effects) for folder permission CRUD.
 * Works with the `allowedFolders` array stored in Settings.
 *
 * Paths are normalized before comparison (trailing separators stripped,
 * lowercased on case-insensitive OS) so that "/Users/me/proj/" and
 * "/Users/me/proj" match correctly.
 */

import type { FolderPermission } from '@/shared/types/folder-permissions';

const MAX_RECENT_FOLDERS = 10;

/**
 * Detect case-insensitive filesystem at runtime.
 * navigator.platform is deprecated but sufficient for this heuristic:
 * macOS and Windows both have case-insensitive default filesystems.
 */
const IS_CASE_INSENSITIVE =
  typeof navigator !== 'undefined'
    ? /mac|win/i.test(navigator.platform)
    : false;

/**
 * Normalize a path for comparison:
 * - Strip trailing slashes/backslashes
 * - Lowercase on case-insensitive filesystems (macOS/Windows)
 */
export function normalizePath(p: string): string {
  const stripped = p.replace(/[/\\]+$/, '');
  return IS_CASE_INSENSITIVE ? stripped.toLowerCase() : stripped;
}

/**
 * Returns allowed folders sorted by lastUsed descending, capped at MAX_RECENT_FOLDERS.
 */
export function getRecentFolders(
  allowedFolders: FolderPermission[],
): FolderPermission[] {
  return [...allowedFolders]
    .sort(
      (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime(),
    )
    .slice(0, MAX_RECENT_FOLDERS);
}

/**
 * Upsert a folder (matched by normalized path). Returns a new array.
 */
export function addOrUpdateFolder(
  allowedFolders: FolderPermission[],
  folder: FolderPermission,
): FolderPermission[] {
  const normalizedNew = normalizePath(folder.path);
  const idx = allowedFolders.findIndex(
    (f) => normalizePath(f.path) === normalizedNew,
  );
  if (idx !== -1) {
    const updated = [...allowedFolders];
    updated[idx] = folder;
    return updated;
  }
  return [...allowedFolders, folder];
}

/**
 * Remove a folder by normalized path. Returns a new array.
 */
export function removeFolder(
  allowedFolders: FolderPermission[],
  path: string,
): FolderPermission[] {
  const normalized = normalizePath(path);
  return allowedFolders.filter((f) => normalizePath(f.path) !== normalized);
}

/**
 * Look up a folder by normalized path.
 */
export function getFolderPermission(
  allowedFolders: FolderPermission[],
  path: string,
): FolderPermission | undefined {
  const normalized = normalizePath(path);
  return allowedFolders.find((f) => normalizePath(f.path) === normalized);
}

/**
 * Check if a folder has the alwaysAllow flag set.
 */
export function isFolderAlwaysAllowed(
  allowedFolders: FolderPermission[],
  path: string,
): boolean {
  const folder = getFolderPermission(allowedFolders, path);
  return folder?.alwaysAllow === true;
}

/**
 * Extract the last path segment for display.
 * Handles both POSIX (/) and Windows (\) path separators.
 */
export function extractFolderName(path: string): string {
  // Strip trailing slashes/backslashes, then split on either separator
  const segments = path.replace(/[/\\]+$/, '').split(/[/\\]/);
  return segments[segments.length - 1] || path;
}

/**
 * Check if a path points to a directory (Tauri desktop only).
 * Returns false in browser mode or on any error.
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const info = await stat(path);
    return info.isDirectory;
  } catch {
    return false;
  }
}
