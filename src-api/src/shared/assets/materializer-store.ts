import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import {
  assetUrls,
  isSha256,
  licenseSnapshotFor,
  parseSourceFileHint,
  parseLicense,
  sourceFileHintForAsset,
  sourceFileHintsMatch,
  type CacheRow,
  type MaterializationRow,
} from './materializer-helpers';
import type {
  MaterializeRequest,
  MaterializeResult,
} from './materializer-types';
import type { Asset } from './types';

export function insertMaterializationRow(
  db: Database.Database,
  now: number,
  req: MaterializeRequest,
  asset: Asset,
  activePath: string,
  payload: { contentHash: string | null; bytes: number },
): MaterializationRow {
  const id = randomUUID();
  const license = licenseSnapshotFor(asset);
  try {
    db.prepare(
      `INSERT INTO asset_materializations (
        id, asset_id, scope, scope_id, active_path, content_hash, bytes,
        created_at, license_snapshot_json, client_request_id, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      asset.id,
      req.scope,
      req.scopeId,
      activePath,
      payload.contentHash,
      payload.bytes,
      now,
      license ? JSON.stringify(license) : null,
      req.clientRequestId ?? null,
      req.role ?? null,
    );
  } catch (error) {
    const existing = findIdempotentMaterializationRow(db, req);
    if (existing) return existing;
    throw error;
  }
  return {
    id,
    active_path: activePath,
    content_hash: payload.contentHash,
    bytes: payload.bytes,
    license_snapshot_json: license ? JSON.stringify(license) : null,
  };
}

export function findIdempotentMaterializationRow(
  db: Database.Database,
  req: MaterializeRequest,
): MaterializationRow | null {
  if (!req.clientRequestId) return null;
  return (
    (db
      .prepare(
        `SELECT id, active_path, content_hash, bytes, license_snapshot_json
         FROM asset_materializations
         WHERE scope = ? AND scope_id = ? AND asset_id = ?
           AND client_request_id = ?`,
      )
      .get(req.scope, req.scopeId, req.assetId, req.clientRequestId) as
      | MaterializationRow
      | undefined) ?? null
  );
}

export function materializeResultFromRow(
  assetId: string,
  row: MaterializationRow,
  cacheHit: boolean,
): MaterializeResult {
  return {
    materializationId: row.id,
    activePath: row.active_path,
    contentHash: row.content_hash,
    bytes: row.bytes,
    cacheHit,
    license: parseLicense(row.license_snapshot_json),
    urls: assetUrls(assetId),
  };
}

export function cacheRow(
  db: Database.Database,
  contentHash: string | null,
): CacheRow | null {
  if (!isSha256(contentHash)) return null;
  return (
    (db
      .prepare(
        `SELECT content_hash, cache_path, bytes
         FROM asset_cache
         WHERE content_hash = ?`,
      )
      .get(contentHash) as CacheRow | undefined) ?? null
  );
}

export function cacheRowByOrigin(
  db: Database.Database,
  asset: Asset,
): CacheRow | null {
  if (!asset.connectionId || !asset.sourceId) return null;
  return (
    (db
      .prepare(
        `SELECT content_hash, cache_path, bytes
         FROM asset_cache
         WHERE origin_provider = ?
           AND origin_connection_id = ?
           AND origin_source_id = ?
         ORDER BY last_used_at DESC
         LIMIT 1`,
      )
      .get(asset.source, asset.connectionId, asset.sourceId) as
      | CacheRow
      | undefined) ?? null
  );
}

export function cacheRowBySourceFileHint(
  db: Database.Database,
  asset: Asset,
): CacheRow | null {
  const hint = sourceFileHintForAsset(asset);
  if (!hint) return null;
  const rows = db
    .prepare(
      `SELECT content_hash, cache_path, bytes, source_file_hint_json
       FROM asset_cache
       WHERE origin_provider = ?
         AND bytes = ?
         AND source_file_hint_json IS NOT NULL
       ORDER BY last_used_at DESC
       LIMIT 25`,
    )
    .all(asset.source, hint.size) as Array<
    CacheRow & { source_file_hint_json: string | null }
  >;
  for (const row of rows) {
    const cachedHint = parseSourceFileHint(row.source_file_hint_json);
    if (sourceFileHintsMatch(hint, cachedHint)) {
      return {
        content_hash: row.content_hash,
        cache_path: row.cache_path,
        bytes: row.bytes,
      };
    }
  }
  return null;
}

export function touchCacheRow(
  db: Database.Database,
  now: number,
  contentHash: string,
): void {
  db.prepare(
    'UPDATE asset_cache SET last_used_at = ? WHERE content_hash = ?',
  ).run(now, contentHash);
}
