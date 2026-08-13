import fs from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { AssetsError, type AssetRegistry } from './registry';
import type { Asset } from './types';

export interface AssetDerivativeSource {
  asset: Asset;
  contentHash: string;
  sourcePath: string;
}

interface PathRow {
  path: string;
}

export async function resolveAssetDerivativeSource(input: {
  db: Database.Database;
  registry: AssetRegistry;
  assetId: string;
  contentHash: string;
  workspaceRoot: string;
}): Promise<AssetDerivativeSource> {
  const asset = input.registry.get(input.assetId);
  if (!asset) throw new AssetsError('Asset not found', 404);

  const candidates = [
    cachePathForHash(input.db, input.contentHash),
    materializationPathForHash(input.db, input.assetId, input.contentHash),
    localStoragePathForHash(input.registry, asset, input.contentHash),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!isInside(input.workspaceRoot, resolved)) continue;
    const stat = await fs.stat(resolved).catch(() => null);
    if (stat?.isFile()) {
      return { asset, contentHash: input.contentHash, sourcePath: resolved };
    }
  }

  throw new AssetsError('Asset derivative source is not available', 404, {
    assetId: input.assetId,
    contentHash: input.contentHash,
  });
}

export function assetDerivativeDir(
  workspaceRoot: string,
  group: 'proxies' | 'artifacts',
  contentHash: string,
): string {
  assertContentHash(contentHash);
  return path.join(
    workspaceRoot,
    '.cache',
    'assets',
    group,
    contentHash.slice(0, 2),
    contentHash.slice(2),
  );
}

export function relativeWorkspacePath(
  workspaceRoot: string,
  filePath: string,
): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Asset derivative path escaped workspace');
  }
  return relativePath.split(path.sep).join('/');
}

function cachePathForHash(
  db: Database.Database,
  contentHash: string,
): string | null {
  const row = db
    .prepare(
      'SELECT cache_path AS path FROM asset_cache WHERE content_hash = ?',
    )
    .get(contentHash) as PathRow | undefined;
  return row?.path ?? null;
}

function materializationPathForHash(
  db: Database.Database,
  assetId: string,
  contentHash: string,
): string | null {
  const row = db
    .prepare(
      `SELECT active_path AS path
       FROM asset_materializations
       WHERE asset_id = ? AND content_hash = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(assetId, contentHash) as PathRow | undefined;
  return row?.path ?? null;
}

function localStoragePathForHash(
  registry: AssetRegistry,
  asset: Asset,
  contentHash: string,
): string | null {
  if (asset.contentHash !== contentHash || !asset.storagePath) return null;
  try {
    return registry.storagePathFor(asset.id).absolutePath;
  } catch {
    return null;
  }
}

function isInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  return (
    target === resolvedRoot || target.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function assertContentHash(contentHash: string): void {
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) {
    throw new AssetsError('Invalid asset content hash', 400);
  }
}
