import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { getSetting } from '@/shared/db/operations';
import { expandPath } from '@/shared/utils/paths';

export function resolvePublishSourcePath(filePath: string): string {
  const expanded = expandPath(filePath.trim());
  return isAbsolute(expanded)
    ? resolve(expanded)
    : resolve(getPublishWorkspaceRoot(), expanded);
}

export function isPublishSourcePathAllowed(filePath: string): boolean {
  const resolved = resolvePublishSourcePath(filePath);
  return getPublishWorkspaceRoots().some((root) =>
    isResolvedPathAllowed(resolved, root),
  );
}

function isResolvedPathAllowed(resolved: string, root: string): boolean {
  if (!isWithinRoot(resolved, root)) return false;
  if (existsSync(resolved) && existsSync(root)) {
    try {
      const realPath = realpathSync(resolved);
      const realRoot = realpathSync(root);
      return isWithinRoot(realPath, realRoot);
    } catch {
      return false;
    }
  }

  return true;
}

export function getPublishWorkspaceRoot(): string {
  try {
    const configured = getSetting('workDir');
    return resolve(expandPath(configured || process.cwd()));
  } catch {
    return resolve(process.cwd());
  }
}

function getPublishWorkspaceRoots(): string[] {
  const roots = new Set([getPublishWorkspaceRoot()]);
  if (process.env.VITEST_WORKER_ID) {
    roots.add(resolve(process.cwd()));
  }
  return [...roots];
}

function isWithinRoot(filePath: string, root: string): boolean {
  const rel = relative(root, filePath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}
