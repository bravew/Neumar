import path from 'node:path';

import { getSetting } from '@/shared/db/operations';
import { expandPath } from '@/shared/utils/paths';

export function getAssetsWorkspaceRoot(): string {
  const configured = getSetting('workDir');
  return path.resolve(expandPath(configured ?? process.cwd()));
}

export function resolveWorkspaceStoragePath(
  storagePath: string,
  workspaceRoot: string = getAssetsWorkspaceRoot(),
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.isAbsolute(storagePath)
    ? path.resolve(storagePath)
    : path.resolve(workspaceRoot, storagePath);
  const relativePath = path.relative(workspaceRoot, absolutePath);

  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Asset path must stay within the configured workspace');
  }

  return {
    absolutePath,
    relativePath: normalizeStoragePath(relativePath),
  };
}

export function normalizeStoragePath(storagePath: string): string {
  return storagePath.split(path.sep).join('/');
}

export function safeUploadFileName(name: string): string {
  const baseName = path
    .basename(name)
    .replace(/[^\w .()-]/g, '_')
    .trim();
  return baseName || 'asset.bin';
}
