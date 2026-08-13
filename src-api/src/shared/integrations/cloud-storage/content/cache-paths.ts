import { lstat, mkdir } from 'fs/promises';
import { resolve, sep } from 'path';

import { getSetting } from '@/shared/db/operations';

export interface CloudCachePathInput {
  provider: string;
  connectionId: string;
  providerItemId: string;
  fingerprint: string;
}

export function getCloudCacheRoot(workspaceRoot = getWorkspaceRoot()): string {
  return resolve(workspaceRoot, '.neuma', 'cloud-cache');
}

export function getCloudCachePath(
  input: CloudCachePathInput,
  workspaceRoot = getWorkspaceRoot(),
): string {
  const root = getCloudCacheRoot(workspaceRoot);
  const filePath = resolve(
    root,
    safeSegment(input.provider),
    safeSegment(input.connectionId),
    safeSegment(input.providerItemId),
    safeSegment(input.fingerprint),
  );
  assertContained(root, filePath);
  return filePath;
}

export async function ensureCloudCacheDirectory(
  filePath: string,
): Promise<void> {
  await mkdir(resolve(filePath, '..'), { recursive: true });
}

export async function assertNoSymlink(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Cloud cache path is a symlink: ${path}`);
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return;
    throw error;
  }
}

function getWorkspaceRoot(): string {
  return getSetting('workDir') ?? process.cwd();
}

function safeSegment(value: string): string {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '..' ||
    value.includes('..')
  ) {
    throw new Error(`Unsafe cloud cache path segment: ${value}`);
  }
  return encodeURIComponent(value);
}

function assertContained(root: string, filePath: string): void {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!filePath.startsWith(normalizedRoot)) {
    throw new Error('Cloud cache path escaped workspace root');
  }
}
