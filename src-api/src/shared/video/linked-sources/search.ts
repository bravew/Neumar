import { getDatabase } from '@/shared/db';
import {
  embed,
  getEmbedOptions,
  getEmbeddingDim,
  getLocalModelStatus,
  getMemoryConfig,
  getModelName,
  isSqliteVecAvailable,
} from '@/shared/services/memory';
import { createLogger } from '@/shared/utils/logger';
import type {
  AspectRatio,
  LinkedAsset,
  LinkedAssetKind,
  LinkedAssetSearchCapability,
  LinkedAssetSearchHit,
  LinkedSource,
  LinkedSourceRole,
} from '@/shared/video/types';

import { rowToLinkedAsset } from './crawler';

const logger = createLogger('LinkedAssetSearch');
const RRF_K = 60;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface LinkedAssetSearchInput {
  query?: string;
  kind?: Exclude<LinkedAssetKind, 'other'>;
  sourceIds?: string[];
  role?: LinkedSourceRole;
  durationMs?: { min?: number; max?: number };
  aspectRatio?: AspectRatio;
  limit?: number;
}

interface RankedId {
  id: string;
  rank: number;
  matchedOn: LinkedAssetSearchHit['matchedOn'];
  snippet?: string;
}

interface AssetRow {
  id: string;
  project_id: string;
  source_id: string;
  external_id: string;
  name: string;
  mime: string | null;
  kind: LinkedAssetKind;
  size_bytes: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  thumbnail_cache_path: string | null;
  description: string | null;
  caption_provider: string | null;
  caption_model: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedded_at: string | null;
  modified_at: string | null;
  indexed_at: string;
}

export async function indexLinkedAssetsForSource(
  projectId: string,
  source: LinkedSource,
): Promise<{ indexed: number; embedded: number; skippedVector: number }> {
  const db = getDatabase();
  const assets = db
    .prepare(
      `SELECT * FROM linked_assets
       WHERE project_id = ? AND source_id = ?
       ORDER BY indexed_at DESC`,
    )
    .all(projectId, source.id)
    .map(rowToLinkedAsset);

  let indexed = 0;
  let embedded = 0;
  let skippedVector = 0;
  const now = new Date().toISOString();
  const config = getMemoryConfig();
  const embedOptions = getEmbedOptions(config);
  const modelName = getModelName(embedOptions);
  const embeddingDim = getEmbeddingDim(
    embedOptions.provider,
    embedOptions.model,
  );
  const canVector = canUseVectorEmbeddings();

  const updateText = db.prepare(
    `UPDATE linked_assets
     SET description = ?,
         caption_provider = ?,
         caption_model = ?
     WHERE id = ?`,
  );
  const updateEmbedding = db.prepare(
    `UPDATE linked_assets
     SET embedding_model = ?,
         embedding_dim = ?,
         embedded_at = ?
     WHERE id = ?`,
  );
  const deleteVector = canVector.ok
    ? db.prepare(`DELETE FROM vec_linked_assets WHERE linked_asset_id = ?`)
    : null;
  const insertVector = canVector.ok
    ? db.prepare(
        `INSERT INTO vec_linked_assets (linked_asset_id, embedding) VALUES (?, ?)`,
      )
    : null;

  for (const asset of assets) {
    const description =
      asset.description?.trim() || filenameCaption(asset, source);
    updateText.run(
      description,
      asset.captionProvider ?? 'local-filename',
      asset.captionModel ?? 'filename-v1',
      asset.id,
    );
    indexed += 1;

    if (!canVector.ok) {
      skippedVector += 1;
      continue;
    }
    if (
      asset.embeddedAt &&
      asset.embeddingModel === modelName &&
      asset.embeddingDim === embeddingDim
    ) {
      continue;
    }

    try {
      const vector = await embed(description, embedOptions);
      try {
        deleteVector?.run(asset.id);
      } catch {
        // vec_linked_assets may not exist if sqlite-vec failed to initialize.
      }
      insertVector?.run(asset.id, Buffer.from(vector.buffer));
      updateEmbedding.run(modelName, vector.length, now, asset.id);
      embedded += 1;
    } catch (error) {
      skippedVector += 1;
      logger.debug(`linked asset embedding skipped for ${asset.id}: ${error}`);
    }
  }

  return { indexed, embedded, skippedVector };
}

export async function searchLinkedAssets(
  projectId: string,
  sources: LinkedSource[],
  input: LinkedAssetSearchInput = {},
): Promise<{
  results: LinkedAssetSearchHit[];
  capability: LinkedAssetSearchCapability;
}> {
  const limit = clampLimit(input.limit);
  const candidateLimit = Math.min(limit * 4, MAX_LIMIT * 2);
  const query = input.query?.trim() ?? '';
  const scopedInput = scopeInputToSources(input, sources);
  if (!query) {
    return {
      results: recentAssets(projectId, sources, scopedInput, limit),
      capability: {
        vector: false,
        fts: true,
        degraded: true,
        reason: 'empty_query',
      },
    };
  }

  const vectorCapability = canUseVectorEmbeddings();
  const [vectorResults, ftsResults, substringResults] = await Promise.all([
    vectorCapability.ok
      ? vectorSearch(projectId, query, scopedInput, candidateLimit)
      : Promise.resolve([]),
    ftsSearch(projectId, query, scopedInput, candidateLimit),
    substringSearch(projectId, query, scopedInput, candidateLimit),
  ]);

  const fused = fuseRankings([
    vectorResults,
    ftsResults,
    substringResults,
  ]).slice(0, limit * 2);
  if (fused.length === 0) {
    return {
      results: [],
      capability: {
        vector: vectorCapability.ok,
        fts: true,
        degraded: !vectorCapability.ok,
        reason: vectorCapability.ok ? undefined : vectorCapability.reason,
      },
    };
  }

  const rows = fetchRowsById(fused.map((item) => item.id));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const maxScore = Math.max(...fused.map((item) => item.score), 0.0001);
  const byId = new Map(rows.map((row) => [row.id, rowToLinkedAsset(row)]));

  const results: LinkedAssetSearchHit[] = [];
  for (const item of fused) {
    const asset = byId.get(item.id);
    if (!asset) continue;
    const source = sourceMap.get(asset.sourceId);
    results.push({
      asset,
      score: Math.min(item.score / maxScore, 1),
      matchedOn: item.matchedOn,
      thumbnailUrl: thumbnailUrl(projectId, asset),
      sourceDisplayName: source?.displayName,
      matchSnippet: item.snippet ?? snippetFor(asset, query),
    });
    if (results.length >= limit) break;
  }

  return {
    results,
    capability: {
      vector: vectorCapability.ok && vectorResults.length > 0,
      fts: true,
      degraded: !vectorCapability.ok,
      reason: vectorCapability.ok ? undefined : vectorCapability.reason,
    },
  };
}

function canUseVectorEmbeddings():
  | { ok: true }
  | { ok: false; reason: string } {
  if (!isSqliteVecAvailable()) {
    return { ok: false, reason: 'sqlite_vec_unavailable' };
  }

  const config = getMemoryConfig();
  if (config.embeddingProvider === 'local') {
    const status = getLocalModelStatus();
    if (status.state !== 'ready') {
      return { ok: false, reason: 'local_embedding_model_not_ready' };
    }
  } else if (!config.embeddingApiKey) {
    return { ok: false, reason: 'embedding_api_key_missing' };
  }

  return { ok: true };
}

async function vectorSearch(
  projectId: string,
  query: string,
  input: LinkedAssetSearchInput,
  limit: number,
): Promise<RankedId[]> {
  try {
    const config = getMemoryConfig();
    const vector = await embed(query, getEmbedOptions(config));
    const filter = buildFilter(projectId, input, 'a');
    const rows = getDatabase()
      .prepare(
        `SELECT v.linked_asset_id AS id, v.distance AS distance
         FROM vec_linked_assets v
         JOIN linked_assets a ON a.id = v.linked_asset_id
         ${filter.joinSql}
           AND v.embedding MATCH ?
           AND k = ?
         ORDER BY v.distance`,
      )
      .all(...filter.args, Buffer.from(vector.buffer), limit) as Array<{
      id: string;
      distance: number;
    }>;
    return rows.map((row, index) => ({
      id: row.id,
      rank: index + 1,
      matchedOn: 'embedding',
    }));
  } catch (error) {
    logger.debug(`linked asset vector search skipped: ${error}`);
    return [];
  }
}

function ftsSearch(
  projectId: string,
  query: string,
  input: LinkedAssetSearchInput,
  limit: number,
): RankedId[] {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  try {
    const filter = buildFilter(projectId, input, 'a');
    const rows = getDatabase()
      .prepare(
        `SELECT a.id,
                snippet(linked_assets_fts, 1, '', '', '...', 12) AS snippet
         FROM linked_assets_fts
         JOIN linked_assets a ON a.rowid = linked_assets_fts.rowid
         ${filter.joinSql}
           AND linked_assets_fts MATCH ?
         ORDER BY linked_assets_fts.rank
         LIMIT ?`,
      )
      .all(...filter.args, fts, limit) as Array<{
      id: string;
      snippet: string | null;
    }>;
    return rows.map((row, index) => ({
      id: row.id,
      rank: index + 1,
      matchedOn: 'metadata',
      snippet: row.snippet ?? undefined,
    }));
  } catch (error) {
    logger.debug(`linked asset FTS search skipped: ${error}`);
    return [];
  }
}

function substringSearch(
  projectId: string,
  query: string,
  input: LinkedAssetSearchInput,
  limit: number,
): RankedId[] {
  const filter = buildFilter(projectId, input, 'a');
  const needle = `%${query.toLowerCase()}%`;
  const rows = getDatabase()
    .prepare(
      `SELECT a.*
       FROM linked_assets a
       ${filter.joinSql}
         AND (
           LOWER(a.name) LIKE ?
           OR LOWER(COALESCE(a.description, '')) LIKE ?
           OR LOWER(COALESCE(a.mime, '')) LIKE ?
         )
       ORDER BY
         CASE
           WHEN LOWER(a.name) = ? THEN 0
           WHEN LOWER(a.name) LIKE ? THEN 1
           WHEN LOWER(a.name) LIKE ? THEN 2
           ELSE 3
         END,
         a.indexed_at DESC
       LIMIT ?`,
    )
    .all(
      ...filter.args,
      needle,
      needle,
      needle,
      query.toLowerCase(),
      `${query.toLowerCase()}%`,
      needle,
      limit,
    ) as AssetRow[];

  return rows.map((row, index) => ({
    id: row.id,
    rank: index + 1,
    matchedOn: row.name.toLowerCase().includes(query.toLowerCase())
      ? 'filename'
      : 'metadata',
    snippet: row.description ?? undefined,
  }));
}

function recentAssets(
  projectId: string,
  sources: LinkedSource[],
  input: LinkedAssetSearchInput,
  limit: number,
): LinkedAssetSearchHit[] {
  const filter = buildFilter(projectId, input, 'a');
  const rows = getDatabase()
    .prepare(
      `SELECT a.*
       FROM linked_assets a
       ${filter.joinSql}
       ORDER BY a.indexed_at DESC, a.name ASC
       LIMIT ?`,
    )
    .all(...filter.args, limit) as AssetRow[];
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return rows.map((row, index) => {
    const asset = rowToLinkedAsset(row);
    const source = sourceMap.get(asset.sourceId);
    return {
      asset,
      score: 1 - index / Math.max(rows.length, 1),
      matchedOn: 'metadata',
      thumbnailUrl: thumbnailUrl(projectId, asset),
      sourceDisplayName: source?.displayName,
      matchSnippet: asset.description,
    };
  });
}

function buildFilter(
  projectId: string,
  input: LinkedAssetSearchInput,
  alias: string,
): { joinSql: string; args: unknown[] } {
  const where = [`${alias}.project_id = ?`];
  const args: unknown[] = [projectId];

  if (input.kind) {
    where.push(`${alias}.kind = ?`);
    args.push(input.kind);
  }
  if (input.sourceIds?.length) {
    where.push(
      `${alias}.source_id IN (${input.sourceIds.map(() => '?').join(', ')})`,
    );
    args.push(...input.sourceIds);
  }
  if (input.durationMs?.min !== undefined) {
    where.push(`${alias}.duration_ms >= ?`);
    args.push(input.durationMs.min);
  }
  if (input.durationMs?.max !== undefined) {
    where.push(`${alias}.duration_ms <= ?`);
    args.push(input.durationMs.max);
  }
  const aspect = aspectBounds(input.aspectRatio);
  if (aspect) {
    where.push(`${alias}.width IS NOT NULL`);
    where.push(`${alias}.height IS NOT NULL`);
    where.push(
      `CAST(${alias}.width AS REAL) / ${alias}.height BETWEEN ? AND ?`,
    );
    args.push(aspect.min, aspect.max);
  }
  return { joinSql: `WHERE ${where.join(' AND ')}`, args };
}

function scopeInputToSources(
  input: LinkedAssetSearchInput,
  sources: LinkedSource[],
): LinkedAssetSearchInput {
  const roleSourceIds = input.role
    ? sources
        .filter((source) => source.role === input.role)
        .map((source) => source.id)
    : undefined;
  if (!roleSourceIds) return input;
  const requested = input.sourceIds?.length ? new Set(input.sourceIds) : null;
  const sourceIds = roleSourceIds.filter(
    (sourceId) => !requested || requested.has(sourceId),
  );
  return {
    ...input,
    sourceIds: sourceIds.length ? sourceIds : ['__no_source__'],
  };
}

function fetchRowsById(ids: string[]): AssetRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return getDatabase()
    .prepare(`SELECT * FROM linked_assets WHERE id IN (${placeholders})`)
    .all(...ids) as AssetRow[];
}

function fuseRankings(lists: RankedId[][]): Array<{
  id: string;
  score: number;
  matchedOn: LinkedAssetSearchHit['matchedOn'];
  snippet?: string;
}> {
  const merged = new Map<
    string,
    {
      id: string;
      score: number;
      matchedOn: LinkedAssetSearchHit['matchedOn'];
      snippet?: string;
      bestRank: number;
    }
  >();

  for (const list of lists) {
    for (const item of list) {
      const existing = merged.get(item.id);
      const contribution = 1 / (RRF_K + item.rank);
      if (!existing) {
        merged.set(item.id, {
          id: item.id,
          score: contribution,
          matchedOn: item.matchedOn,
          snippet: item.snippet,
          bestRank: item.rank,
        });
        continue;
      }
      existing.score += contribution;
      if (item.rank < existing.bestRank) {
        existing.bestRank = item.rank;
        existing.matchedOn = item.matchedOn;
        existing.snippet = item.snippet ?? existing.snippet;
      }
      if (existing.matchedOn !== 'filename' && item.matchedOn === 'filename') {
        existing.matchedOn = 'filename';
        existing.snippet = item.snippet ?? existing.snippet;
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.bestRank - b.bestRank;
  });
}

function toFtsQuery(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function filenameCaption(asset: LinkedAsset, source: LinkedSource): string {
  const parts = [
    `${asset.kind} asset named ${asset.name}`,
    source.displayName ? `from ${source.displayName}` : '',
    asset.durationMs
      ? `duration ${Math.round(asset.durationMs / 1000)} seconds`
      : '',
    asset.width && asset.height
      ? `${asset.width} by ${asset.height} pixels`
      : '',
    asset.mime ? `mime type ${asset.mime}` : '',
  ].filter(Boolean);
  return parts.join(', ');
}

function snippetFor(asset: LinkedAsset, query: string): string | undefined {
  const text = asset.description || asset.name;
  const lower = text.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index < 0) return text.slice(0, 160);
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + query.length + 80);
  return text.slice(start, end);
}

function thumbnailUrl(projectId: string, asset: LinkedAsset): string {
  if (!asset.thumbnailCachePath) return '';
  return `/video/projects/${encodeURIComponent(projectId)}/linked-assets/${encodeURIComponent(
    asset.id,
  )}/thumbnail`;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function aspectBounds(aspectRatio: AspectRatio | undefined) {
  if (!aspectRatio) return null;
  const target =
    aspectRatio === '16:9'
      ? 16 / 9
      : aspectRatio === '9:16'
        ? 9 / 16
        : aspectRatio === '4:5'
          ? 4 / 5
          : 1;
  const tolerance = 0.08;
  return { min: target - tolerance, max: target + tolerance };
}
