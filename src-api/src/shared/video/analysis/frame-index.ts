import { getDatabase } from '@/shared/db';
import {
  embed,
  getEmbedOptions,
  getLocalModelStatus,
  getMemoryConfig,
  getModelName,
  isSqliteVecAvailable,
} from '@/shared/services/memory';
import { createLogger } from '@/shared/utils/logger';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import type { MediaItem, VideoProject } from '@/shared/video/types';

const logger = createLogger('VideoFrameSearch');
const RRF_K = 60;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

export interface ProjectFrameIndexResult {
  indexed: number;
  embedded: number;
  skippedVector: number;
}

export interface FrameSearchInput {
  query: string;
  sourceIds?: string[];
  assetIds?: string[];
  limit?: number;
}

export interface FrameSearchHit {
  sourceId?: string;
  assetId?: string;
  atMs: number;
  startMs?: number;
  endMs?: number;
  caption: string;
  tags: string[];
  score: number;
  matchedOn: 'embedding' | 'metadata';
  thumbBase64: string;
}

interface FrameCaption {
  id: string;
  projectId: string;
  sourceId?: string;
  assetId?: string;
  atMs: number;
  startMs?: number;
  endMs?: number;
  caption: string;
  tags: string[];
  captionProvider: string;
  captionModel: string;
  thumbBase64?: string;
}

interface FrameRow {
  id: string;
  project_id: string;
  source_id: string | null;
  asset_id: string | null;
  at_ms: number;
  start_ms: number | null;
  end_ms: number | null;
  caption: string;
  tags_json: string | null;
  thumb_base64: string | null;
  caption_provider: string | null;
  caption_model: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
  embedded_at: string | null;
  indexed_at: string;
}

interface RankedFrame {
  id: string;
  rank: number;
  matchedOn: FrameSearchHit['matchedOn'];
}

export async function indexProjectFrames(
  project: VideoProject,
): Promise<ProjectFrameIndexResult> {
  if (!getVideoFeatureFlag('video.frameSearch')) {
    return { indexed: 0, embedded: 0, skippedVector: 0 };
  }
  const captions = collectProjectFrameCaptions(project);
  const db = getDatabase();
  const now = new Date().toISOString();
  const canVector = canUseVectorEmbeddings();
  const config = getMemoryConfig();
  const embedOptions = getEmbedOptions(config);
  const modelName = getModelName(embedOptions);

  const insertFrame = db.prepare(
    `INSERT INTO media_frames
      (id, project_id, source_id, asset_id, at_ms, start_ms, end_ms, caption,
       tags_json, thumb_base64, caption_provider, caption_model,
       embedding_model, embedding_dim, embedded_at, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let embedded = 0;
  let skippedVector = 0;

  const replaceIndexRows = db.transaction(() => {
    db.prepare(`DELETE FROM media_frames WHERE project_id = ?`).run(project.id);
    if (canVector.ok) {
      try {
        db.prepare(
          `DELETE FROM vec_media_frames
           WHERE frame_id NOT IN (SELECT id FROM media_frames)`,
        ).run();
      } catch {
        // vec_media_frames is optional and may be unavailable in test/dev builds.
      }
    }
    for (const caption of captions) {
      insertFrame.run(
        caption.id,
        caption.projectId,
        caption.sourceId ?? null,
        caption.assetId ?? null,
        caption.atMs,
        caption.startMs ?? null,
        caption.endMs ?? null,
        caption.caption,
        JSON.stringify(caption.tags),
        caption.thumbBase64 ?? null,
        caption.captionProvider,
        caption.captionModel,
        null,
        null,
        null,
        now,
      );
    }
  });
  replaceIndexRows();

  for (const caption of captions) {
    if (!canVector.ok) {
      skippedVector += 1;
      continue;
    }
    try {
      const vector = await embed(frameText(caption), embedOptions);
      db.prepare(
        `INSERT INTO vec_media_frames (frame_id, embedding) VALUES (?, ?)`,
      ).run(caption.id, Buffer.from(vector.buffer));
      db.prepare(
        `UPDATE media_frames
         SET embedding_model = ?,
             embedding_dim = ?,
             embedded_at = ?
         WHERE id = ?`,
      ).run(modelName, vector.length, now, caption.id);
      embedded += 1;
    } catch (error) {
      skippedVector += 1;
      logger.debug(`media frame embedding skipped for ${caption.id}: ${error}`);
    }
  }

  return { indexed: captions.length, embedded, skippedVector };
}

export async function searchProjectFrames(
  projectId: string,
  input: FrameSearchInput,
): Promise<{
  results: FrameSearchHit[];
  capability: {
    enabled: boolean;
    vector: boolean;
    fts: boolean;
    degraded: boolean;
    reason?: string;
  };
}> {
  if (!getVideoFeatureFlag('video.frameSearch')) {
    return {
      results: [],
      capability: {
        enabled: false,
        vector: false,
        fts: false,
        degraded: true,
        reason: 'video.frameSearch disabled',
      },
    };
  }

  const query = input.query.trim();
  const limit = clampLimit(input.limit);
  if (!query) {
    return {
      results: [],
      capability: {
        enabled: true,
        vector: false,
        fts: true,
        degraded: true,
        reason: 'empty_query',
      },
    };
  }

  const vectorCapability = canUseVectorEmbeddings();
  const candidateLimit = Math.min(limit * 4, MAX_LIMIT * 2);
  const [vectorResults, ftsResults, substringResults] = await Promise.all([
    vectorCapability.ok
      ? vectorSearch(projectId, query, input, candidateLimit)
      : Promise.resolve([]),
    Promise.resolve(ftsSearch(projectId, query, input, candidateLimit)),
    Promise.resolve(substringSearch(projectId, query, input, candidateLimit)),
  ]);
  const fused = fuseRankings([
    vectorResults,
    ftsResults,
    substringResults,
  ]).slice(0, limit * 2);
  const rows = fetchRowsById(fused.map((item) => item.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const maxScore = Math.max(...fused.map((item) => item.score), 0.0001);
  const results: FrameSearchHit[] = [];

  for (const item of fused) {
    const row = byId.get(item.id);
    if (!row) continue;
    results.push({
      sourceId: row.source_id ?? undefined,
      assetId: row.asset_id ?? undefined,
      atMs: row.at_ms,
      startMs: row.start_ms ?? undefined,
      endMs: row.end_ms ?? undefined,
      caption: row.caption,
      tags: parseTags(row.tags_json),
      score: Math.min(item.score / maxScore, 1),
      matchedOn: item.matchedOn,
      thumbBase64: row.thumb_base64 ?? '',
    });
    if (results.length >= limit) break;
  }

  return {
    results,
    capability: {
      enabled: true,
      vector: vectorCapability.ok && vectorResults.length > 0,
      fts: true,
      degraded: !vectorCapability.ok,
      reason: vectorCapability.ok ? undefined : vectorCapability.reason,
    },
  };
}

function collectProjectFrameCaptions(project: VideoProject): FrameCaption[] {
  const captions: FrameCaption[] = [];
  for (const analysis of project.sourceAnalyses ?? []) {
    const source = project.sources?.find(
      (item) => item.id === analysis.sourceId,
    );
    for (const [index, beat] of analysis.visualBeats.entries()) {
      const startMs = Math.max(0, beat.startMs);
      const endMs = Math.max(startMs + 1, beat.endMs);
      captions.push({
        id: `${project.id}:source:${analysis.sourceId}:beat:${index}`,
        projectId: project.id,
        sourceId: analysis.sourceId,
        assetId: source?.mediaItemId,
        atMs: Math.round((startMs + endMs) / 2),
        startMs,
        endMs,
        caption: beat.caption,
        tags: beat.tags,
        captionProvider: beat.source,
        captionModel: 'source-analysis-visual-beat',
      });
    }
  }

  for (const asset of project.assets) {
    if (asset.kind !== 'image' && asset.kind !== 'video') continue;
    if (captions.some((caption) => caption.assetId === asset.id)) continue;
    captions.push(assetFallbackCaption(project.id, asset));
  }
  return captions.filter((caption) => caption.caption.trim());
}

function assetFallbackCaption(
  projectId: string,
  asset: MediaItem,
): FrameCaption {
  const durationMs = asset.metadata.durationMs;
  const prompt = asset.provenance?.prompt?.trim();
  const display = asset.provenance?.sourceDisplayName?.trim();
  const caption =
    prompt || display || `${asset.kind} asset ${asset.id} from ${asset.source}`;
  const tags = [
    asset.kind,
    asset.source,
    asset.metadata.width && asset.metadata.height
      ? `${asset.metadata.width}x${asset.metadata.height}`
      : '',
  ].filter(Boolean);
  return {
    id: `${projectId}:asset:${asset.id}:midpoint`,
    projectId,
    assetId: asset.id,
    atMs: Math.round(durationMs / 2),
    startMs: 0,
    endMs: durationMs,
    caption,
    tags,
    captionProvider: 'project-metadata',
    captionModel: 'media-item-v1',
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
  input: FrameSearchInput,
  limit: number,
): Promise<RankedFrame[]> {
  try {
    const config = getMemoryConfig();
    const vector = await embed(query, getEmbedOptions(config));
    const filter = buildFilter(projectId, input, 'f');
    const rows = getDatabase()
      .prepare(
        `SELECT v.frame_id AS id, v.distance AS distance
         FROM vec_media_frames v
         JOIN media_frames f ON f.id = v.frame_id
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
    logger.debug(`media frame vector search skipped: ${error}`);
    return [];
  }
}

function ftsSearch(
  projectId: string,
  query: string,
  input: FrameSearchInput,
  limit: number,
): RankedFrame[] {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  try {
    const filter = buildFilter(projectId, input, 'f');
    const rows = getDatabase()
      .prepare(
        `SELECT f.id
         FROM media_frames_fts
         JOIN media_frames f ON f.rowid = media_frames_fts.rowid
         ${filter.joinSql}
           AND media_frames_fts MATCH ?
         ORDER BY media_frames_fts.rank
         LIMIT ?`,
      )
      .all(...filter.args, fts, limit) as Array<{ id: string }>;
    return rows.map((row, index) => ({
      id: row.id,
      rank: index + 1,
      matchedOn: 'metadata',
    }));
  } catch (error) {
    logger.debug(`media frame FTS search skipped: ${error}`);
    return [];
  }
}

function substringSearch(
  projectId: string,
  query: string,
  input: FrameSearchInput,
  limit: number,
): RankedFrame[] {
  const filter = buildFilter(projectId, input, 'f');
  const needle = `%${query.toLowerCase()}%`;
  const rows = getDatabase()
    .prepare(
      `SELECT f.id
       FROM media_frames f
       ${filter.joinSql}
         AND (
           LOWER(f.caption) LIKE ?
           OR LOWER(COALESCE(f.tags_json, '')) LIKE ?
           OR LOWER(COALESCE(f.asset_id, '')) LIKE ?
           OR LOWER(COALESCE(f.source_id, '')) LIKE ?
         )
       ORDER BY f.at_ms ASC
       LIMIT ?`,
    )
    .all(...filter.args, needle, needle, needle, needle, limit) as Array<{
    id: string;
  }>;
  return rows.map((row, index) => ({
    id: row.id,
    rank: index + 1,
    matchedOn: 'metadata',
  }));
}

function buildFilter(
  projectId: string,
  input: Pick<FrameSearchInput, 'sourceIds' | 'assetIds'>,
  alias: string,
): { joinSql: string; args: unknown[] } {
  const where = [`${alias}.project_id = ?`];
  const args: unknown[] = [projectId];
  if (input.sourceIds?.length) {
    where.push(
      `${alias}.source_id IN (${input.sourceIds.map(() => '?').join(', ')})`,
    );
    args.push(...input.sourceIds);
  }
  if (input.assetIds?.length) {
    where.push(
      `${alias}.asset_id IN (${input.assetIds.map(() => '?').join(', ')})`,
    );
    args.push(...input.assetIds);
  }
  return { joinSql: `WHERE ${where.join(' AND ')}`, args };
}

function fuseRankings(lists: RankedFrame[][]): Array<{
  id: string;
  score: number;
  matchedOn: FrameSearchHit['matchedOn'];
  bestRank: number;
}> {
  const merged = new Map<
    string,
    {
      id: string;
      score: number;
      matchedOn: FrameSearchHit['matchedOn'];
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
          bestRank: item.rank,
        });
        continue;
      }
      existing.score += contribution;
      if (item.rank < existing.bestRank) {
        existing.bestRank = item.rank;
        existing.matchedOn = item.matchedOn;
      }
    }
  }
  return [...merged.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.bestRank - b.bestRank;
  });
}

function fetchRowsById(ids: string[]): FrameRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return getDatabase()
    .prepare(`SELECT * FROM media_frames WHERE id IN (${placeholders})`)
    .all(...ids) as FrameRow[];
}

function frameText(caption: FrameCaption): string {
  return [caption.caption, ...caption.tags].filter(Boolean).join('\n');
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
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

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}
