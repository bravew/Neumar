import { lstat, realpath } from 'fs/promises';
import path from 'path';

import type {
  BridgeRemoteReason,
  BridgeResolution,
  ImmichBridgeAsset,
  PathMapping,
  ResolveBridgeInput,
} from './types';

export async function resolveBridgePath(
  input: ResolveBridgeInput,
): Promise<BridgeResolution> {
  if (input.lanBridgeEnabled === false) {
    return remote('lan_bridge_disabled');
  }

  const mapping = selectMapping(input.asset, input.mappings);
  if (!mapping) {
    return remote('no_verified_mapping');
  }

  const suffix = input.asset.originalPath.slice(
    normalizeImmichPrefix(mapping.immichPathPrefix).length,
  );
  if (hasTraversal(suffix)) {
    return remote('path_traversal', mapping.id);
  }

  const rootPath = path.resolve(mapping.localMountPath);
  const absolutePath = path.resolve(rootPath, suffix);
  if (!isContained(rootPath, absolutePath)) {
    return remote('containment_violation', mapping.id);
  }

  try {
    const rootStat = await lstat(rootPath);
    if (rootStat.isSymbolicLink()) {
      return remote('symlink_rejected', mapping.id);
    }
  } catch (error) {
    return remote('mount_unavailable', mapping.id, error);
  }

  let fileStat;
  try {
    fileStat = await lstat(absolutePath);
  } catch (error) {
    const code = errorCode(error);
    return remote(
      code === 'ENOENT' ? 'missing_file' : 'local_read_error',
      mapping.id,
      error,
    );
  }

  if (fileStat.isSymbolicLink()) {
    return remote('symlink_rejected', mapping.id);
  }
  if (!fileStat.isFile()) {
    return remote('not_a_file', mapping.id);
  }
  if (fileStat.size !== input.asset.fileSizeBytes) {
    return remote('size_mismatch', mapping.id);
  }

  try {
    const [realRootPath, realFilePath] = await Promise.all([
      realpath(rootPath),
      realpath(absolutePath),
    ]);
    if (!isContained(realRootPath, realFilePath)) {
      return remote('containment_violation', mapping.id);
    }
  } catch (error) {
    return remote('local_read_error', mapping.id, error);
  }

  return {
    kind: 'local',
    absolutePath,
    sizeBytes: fileStat.size,
    mappingId: mapping.id,
    checksum: input.asset.checksum,
  };
}

export function selectMapping(
  asset: ImmichBridgeAsset,
  mappings: PathMapping[],
): PathMapping | undefined {
  const originalPath = asset.originalPath.replaceAll('\\', '/');
  return mappings
    .filter(
      (mapping) =>
        mapping.verified &&
        !mapping.disabled &&
        originalPath.startsWith(
          normalizeImmichPrefix(mapping.immichPathPrefix),
        ),
    )
    .sort(
      (a, b) =>
        normalizeImmichPrefix(b.immichPathPrefix).length -
        normalizeImmichPrefix(a.immichPathPrefix).length,
    )[0];
}

export function normalizeImmichPrefix(prefix: string): string {
  const normalized = normalizeImmichPath(prefix);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function normalizeImmichPath(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/'));
}

function hasTraversal(suffix: string): boolean {
  return suffix
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

function remote(
  reason: BridgeRemoteReason,
  mappingId?: string,
  error?: unknown,
): BridgeResolution {
  return {
    kind: 'remote',
    reason,
    mappingId,
    detail: error instanceof Error ? error.message : undefined,
  };
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
