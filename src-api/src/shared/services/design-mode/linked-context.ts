import fs from 'node:fs';
import path from 'node:path';

import { getDesignWorkspaceRoot } from './fs';

const BLOCKED_CANONICAL = (() => {
  const raw =
    process.platform === 'win32'
      ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']
      : ['/etc', '/proc', '/sys', '/dev', '/boot'];
  const set = new Set<string>(raw);
  for (const item of raw) {
    try {
      set.add(fs.realpathSync.native(item));
    } catch {
      // keep the literal path when the host does not expose it
    }
  }
  return [...set];
})();

const WIN_ROOT_RE = /^[A-Za-z]:\\?$/;

export function validateLinkedContextDirs(
  dirs: unknown,
  workspaceRoot = getDesignWorkspaceRoot(),
): { dirs: string[]; error?: undefined } | { error: string; dirs?: undefined } {
  if (!Array.isArray(dirs)) {
    return { error: 'linkedContextDirs must be an array' };
  }

  let workspaceReal: string;
  try {
    workspaceReal = fs.realpathSync.native(path.resolve(workspaceRoot));
  } catch {
    return { error: 'workspace root does not exist or is not accessible' };
  }

  const validated: string[] = [];
  for (const item of dirs) {
    if (typeof item !== 'string' || !item.trim()) {
      return {
        error: 'each linked context dir must be a non-empty string',
      };
    }
    if (!path.isAbsolute(item)) {
      return { error: `linked context dir must be an absolute path: ${item}` };
    }

    let realPath: string;
    try {
      realPath = fs.realpathSync.native(path.resolve(item));
      const stat = fs.statSync(realPath);
      if (!stat.isDirectory()) return { error: `not a directory: ${item}` };
    } catch {
      return {
        error: `directory does not exist or is not accessible: ${item}`,
      };
    }

    if (isBlocked(realPath)) {
      return { error: `system directory not allowed: ${item}` };
    }
    if (!isInside(realPath, workspaceReal)) {
      return {
        error: `linked context dir must stay inside the workspace: ${item}`,
      };
    }
    validated.push(realPath);
  }

  return { dirs: [...new Set(validated)] };
}

export function normalizeLinkedContextDirs(
  dirs: unknown,
  workspaceRoot = getDesignWorkspaceRoot(),
): string[] {
  const result = validateLinkedContextDirs(dirs, workspaceRoot);
  if ('error' in result) throw new Error(result.error);
  return result.dirs;
}

function isFilesystemRoot(candidate: string): boolean {
  if (process.platform === 'win32') return WIN_ROOT_RE.test(candidate);
  return candidate === '/';
}

function isBlocked(realPath: string): boolean {
  if (isFilesystemRoot(realPath)) return true;
  return BLOCKED_CANONICAL.some(
    (blocked) =>
      realPath === blocked ||
      realPath.startsWith(blocked + path.sep) ||
      blocked.startsWith(realPath + path.sep),
  );
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
