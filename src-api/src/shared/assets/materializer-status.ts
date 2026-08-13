import { getDatabase } from '@/shared/db';

import { assetUrls, parseLicense } from './materializer-helpers';

export interface AssetMaterializeStatusInput {
  assetId: string;
  scope?: string;
  scopeId?: string;
}

interface MaterializationStatusRow {
  id: string;
  asset_id: string;
  scope: string;
  scope_id: string;
  active_path: string;
  content_hash: string | null;
  bytes: number;
  created_at: number;
  license_snapshot_json: string | null;
  role: string | null;
}

interface ProxyRow {
  preset: string;
  proxy_path: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  generated_at: number;
  last_used_at: number;
}

interface ArtifactRow {
  kind: string;
  data_path: string;
  bytes: number;
  generated_at: number;
}

export function getAssetMaterializeStatus(input: AssetMaterializeStatusInput) {
  const clauses = ['asset_id = ?'];
  const params: unknown[] = [input.assetId];
  if (input.scope) {
    clauses.push('scope = ?');
    params.push(input.scope);
  }
  if (input.scopeId) {
    clauses.push('scope_id = ?');
    params.push(input.scopeId);
  }
  const db = getDatabase();
  const assetRow = db
    .prepare(
      'SELECT content_hash FROM assets WHERE id = ? AND deleted_at IS NULL',
    )
    .get(input.assetId) as { content_hash: string | null } | undefined;
  const materializations = db
    .prepare(
      `SELECT id, asset_id, scope, scope_id, active_path, content_hash, bytes,
              created_at, license_snapshot_json, role
       FROM asset_materializations
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC`,
    )
    .all(...params) as MaterializationStatusRow[];
  const contentHashes = [
    ...new Set(
      [
        assetRow?.content_hash,
        ...materializations.map((row) => row.content_hash),
      ].filter((hash): hash is string => Boolean(hash)),
    ),
  ];
  const urls = assetUrls(input.assetId);
  return {
    asset_id: input.assetId,
    scope: input.scope,
    scope_id: input.scopeId,
    urls,
    materializations: materializations.map((row) => ({
      id: row.id,
      scope: row.scope,
      scope_id: row.scope_id,
      active_path: row.active_path,
      content_hash: row.content_hash,
      bytes: row.bytes,
      created_at: row.created_at,
      role: row.role,
      license: parseLicense(row.license_snapshot_json),
    })),
    artifacts: contentHashes.flatMap((hash) =>
      artifactsForHash(db, input.assetId, hash),
    ),
    proxies: contentHashes.flatMap((hash) =>
      proxiesForHash(db, input.assetId, hash),
    ),
  };
}

function proxiesForHash(
  db: ReturnType<typeof getDatabase>,
  assetId: string,
  contentHash: string,
) {
  const urls = assetUrls(assetId);
  return (
    db
      .prepare(
        `SELECT preset, proxy_path, bytes, width, height, duration_ms,
                generated_at, last_used_at
         FROM asset_proxies
         WHERE content_hash = ?
         ORDER BY preset`,
      )
      .all(contentHash) as ProxyRow[]
  ).map((row) => ({
    content_hash: contentHash,
    ...row,
    url:
      urls.proxy?.[row.preset as keyof NonNullable<typeof urls.proxy>] ?? null,
  }));
}

function artifactsForHash(
  db: ReturnType<typeof getDatabase>,
  assetId: string,
  contentHash: string,
) {
  return (
    db
      .prepare(
        `SELECT kind, data_path, bytes, generated_at
         FROM asset_preview_artifacts
         WHERE content_hash = ?
         ORDER BY kind`,
      )
      .all(contentHash) as ArtifactRow[]
  ).map((row) => ({
    content_hash: contentHash,
    ...row,
    url: artifactUrl(assetId, row.kind),
  }));
}

function artifactUrl(assetId: string, kind: string): string | null {
  const urls = assetUrls(assetId);
  if (kind === 'filmstrip') return urls.filmstrip ?? null;
  if (kind === 'waveform') return urls.waveform ?? null;
  if (kind === 'poster') return urls.poster ?? null;
  return null;
}
