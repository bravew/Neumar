import type { ModeDefinition } from './types';

/**
 * The last resumable path seen in each mode, for this window's lifetime.
 * Switching modes returns there instead of the mode's root, so an open
 * conversation or project survives a trip to another mode.
 */
interface ModeEntry {
  to: string;
  /**
   * Router state at that path. Home hands a new task's first prompt to the
   * task page this way, so returning before it was sent must carry it back.
   */
  state: unknown;
}

const lastPaths = new Map<string, ModeEntry>();

export function pathMatches(pathname: string, pattern: RegExp | string) {
  return typeof pattern === 'string'
    ? pathname === pattern
    : pattern.test(pathname);
}

export function isResumablePath(mode: ModeDefinition, pathname: string) {
  return (mode.resumePaths ?? mode.matches).some((pattern) =>
    pathMatches(pathname, pattern),
  );
}

export function rememberModePath(
  mode: ModeDefinition,
  location: { pathname: string; search?: string; state?: unknown },
): void {
  if (isResumablePath(mode, location.pathname)) {
    lastPaths.set(mode.id, {
      to: `${location.pathname}${location.search ?? ''}`,
      state: location.state ?? null,
    });
  }
}

/**
 * Where selecting a mode goes: its root when the user is already on one of
 * its resumable pages, otherwise the last path they left it on.
 */
export function modeEntry(
  mode: ModeDefinition,
  currentPathname: string,
): ModeEntry {
  const root = { to: mode.rootPath, state: null };
  if (isResumablePath(mode, currentPathname)) return root;
  return lastPaths.get(mode.id) ?? root;
}

/** Drops remembered paths that point at a deleted item. */
export function forgetModePathsContaining(id: string): void {
  for (const [modeId, entry] of lastPaths) {
    if (entry.to.includes(id)) lastPaths.delete(modeId);
  }
}

/** Test-only. */
export function resetModePathsForTests(): void {
  lastPaths.clear();
}
