import { lstat } from 'fs/promises';
import path from 'path';

export interface PersonalMediaLocalPathPolicyResult {
  valid: boolean;
  reason?: string;
  normalizedImmichPathPrefix?: string;
  normalizedLocalMountPath?: string;
}

export interface PersonalMediaLocalPathPolicyInput {
  immichPathPrefix: string;
  localMountPath: string;
  requireExistingMount?: boolean;
}

export async function validatePersonalMediaLocalPathPolicy(
  input: PersonalMediaLocalPathPolicyInput,
): Promise<PersonalMediaLocalPathPolicyResult> {
  const prefixResult = normalizeImmichPrefix(input.immichPathPrefix);
  if (!prefixResult.valid) {
    return prefixResult;
  }

  if (input.localMountPath.includes('\0')) {
    return { valid: false, reason: 'local_mount_path_invalid' };
  }

  const normalizedLocalMountPath = path.resolve(input.localMountPath);
  if (!path.isAbsolute(input.localMountPath)) {
    return { valid: false, reason: 'local_mount_path_must_be_absolute' };
  }

  if (input.requireExistingMount !== false) {
    try {
      const stat = await lstat(normalizedLocalMountPath);
      if (stat.isSymbolicLink()) {
        return { valid: false, reason: 'local_mount_symlink_rejected' };
      }
      if (!stat.isDirectory()) {
        return { valid: false, reason: 'local_mount_not_directory' };
      }
    } catch {
      return { valid: false, reason: 'local_mount_unavailable' };
    }
  }

  return {
    valid: true,
    normalizedImmichPathPrefix: prefixResult.normalizedImmichPathPrefix,
    normalizedLocalMountPath,
  };
}

export function resolvePersonalMediaMappedPath(input: {
  originalPath: string;
  immichPathPrefix: string;
  localMountPath: string;
}): PersonalMediaLocalPathPolicyResult & { absolutePath?: string } {
  const prefixResult = normalizeImmichPrefix(input.immichPathPrefix);
  if (!prefixResult.valid) {
    return prefixResult;
  }

  if (hasTraversal(input.originalPath.replaceAll('\\', '/'))) {
    return { valid: false, reason: 'path_traversal' };
  }

  const originalPath = normalizeImmichPath(input.originalPath);
  const prefix = prefixResult.normalizedImmichPathPrefix;
  if (!prefix) {
    return { valid: false, reason: 'immich_path_prefix_invalid' };
  }
  if (!originalPath.startsWith(prefix)) {
    return { valid: false, reason: 'prefix_mismatch' };
  }

  const suffix = originalPath.slice(prefix.length);
  if (hasTraversal(suffix)) {
    return { valid: false, reason: 'path_traversal' };
  }

  const rootPath = path.resolve(input.localMountPath);
  const absolutePath = path.resolve(rootPath, suffix);
  if (!isContained(rootPath, absolutePath)) {
    return { valid: false, reason: 'containment_violation' };
  }

  return {
    valid: true,
    normalizedImmichPathPrefix: prefix,
    normalizedLocalMountPath: rootPath,
    absolutePath,
  };
}

function normalizeImmichPrefix(
  value: string,
): PersonalMediaLocalPathPolicyResult {
  if (value.includes('\0')) {
    return { valid: false, reason: 'immich_path_prefix_invalid' };
  }
  if (hasTraversal(value.replaceAll('\\', '/'))) {
    return { valid: false, reason: 'path_traversal' };
  }

  const normalized = normalizeImmichPath(value);
  if (!normalized.startsWith('/')) {
    return { valid: false, reason: 'immich_path_prefix_must_be_absolute' };
  }

  return {
    valid: true,
    normalizedImmichPathPrefix: normalized.endsWith('/')
      ? normalized
      : `${normalized}/`,
  };
}

function normalizeImmichPath(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/'));
}

function hasTraversal(value: string): boolean {
  return value
    .split('/')
    .filter(Boolean)
    .some((part) => part === '..');
}

function isContained(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
