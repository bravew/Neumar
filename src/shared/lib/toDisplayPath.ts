function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Path shown in the task files panel. Files inside the session root become
 * root-relative (`output/name.ext`). Anything else is returned unchanged.
 */
export function toDisplayPath(
  absPath: string,
  sessionRoot: string | undefined,
): string {
  if (!sessionRoot) return absPath;
  const path = normalizePath(absPath);
  const root = normalizePath(sessionRoot);
  if (path === root) return '.';
  const prefix = `${root}/`;
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  return absPath;
}
