/**
 * Workspace RAG Searcher
 *
 * Hybrid retrieval over `workspace_chunks`:
 *   1. FTS5 keyword search (fast lexical recall)
 *   2. Vector cosine search via `vec_workspace` (semantic recall)
 *   3. Reciprocal-rank fusion of the two
 *   4. MMR diversity re-ranking (jaccard on chunk content)
 *
 * Falls back gracefully when sqlite-vec is unavailable.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { getDatabase } from '@/shared/db';
import { getSetting } from '@/shared/db/operations';
import {
  embed,
  getEmbedOptions,
  getMemoryConfig,
  isSqliteVecAvailable,
  jaccardSimilarity,
} from '@/shared/services/memory';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RagSearcher');

export interface WorkspaceChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  language: string;
  content: string;
}

export interface WorkspaceSearchResult {
  chunk: WorkspaceChunk;
  score: number;
  ftsRank?: number;
  vecRank?: number;
  source: 'fts' | 'vector' | 'hybrid';
}

export interface SearchOptions {
  limit?: number;
  /** Optional path glob (POSIX style — substring match for v1). */
  pathFilter?: string;
  /** RRF constant; lower = sharper top-rank emphasis. */
  rrfK?: number;
  /** MMR diversity weight (1.0 = pure relevance, 0.0 = max diversity). */
  mmrLambda?: number;
  /** Skip vector search even if available. */
  skipVector?: boolean;
}

interface ChunkRow {
  id: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol: string | null;
  language: string;
  content: string;
}

function rowToChunk(row: ChunkRow): WorkspaceChunk {
  return {
    id: row.id,
    path: row.path,
    startLine: row.start_line,
    endLine: row.end_line,
    symbol: row.symbol,
    language: row.language,
    content: row.content,
  };
}

/** Escape FTS5 query — wrap each term in quotes to avoid syntax errors. */
function ftsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function ftsSearch(
  query: string,
  limit: number,
  pathFilter?: string,
): { chunk: WorkspaceChunk; rank: number }[] {
  if (!query.trim()) return [];
  const db = getDatabase();
  try {
    const sql = `
      SELECT c.id, c.path, c.start_line, c.end_line, c.symbol, c.language, c.content
      FROM workspace_chunks_fts f
      JOIN workspace_chunks c ON c.rowid = f.rowid
      WHERE workspace_chunks_fts MATCH ?
        ${pathFilter ? 'AND c.path LIKE ?' : ''}
      ORDER BY f.rank
      LIMIT ?
    `;
    const params: unknown[] = [ftsQuery(query)];
    if (pathFilter) params.push(`%${pathFilter}%`);
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as ChunkRow[];
    return rows.map((row, i) => ({ chunk: rowToChunk(row), rank: i + 1 }));
  } catch (err) {
    logger.warn(`FTS search failed: ${err}`);
    return [];
  }
}

async function vectorSearch(
  query: string,
  limit: number,
  pathFilter?: string,
): Promise<{ chunk: WorkspaceChunk; rank: number; distance: number }[]> {
  if (!isSqliteVecAvailable()) return [];
  if (!query.trim()) return [];

  const db = getDatabase();
  const config = getMemoryConfig();
  const embedOptions = getEmbedOptions(config);

  let vec: Float32Array;
  try {
    vec = await embed(query, embedOptions);
  } catch (err) {
    logger.warn(`Embed query failed: ${err}`);
    return [];
  }

  try {
    const sql = `
      SELECT v.chunk_id AS id, v.distance AS distance,
             c.path, c.start_line, c.end_line, c.symbol, c.language, c.content
      FROM vec_workspace v
      JOIN workspace_chunks c ON c.id = v.chunk_id
      WHERE v.embedding MATCH ?
        AND k = ?
        ${pathFilter ? 'AND c.path LIKE ?' : ''}
      ORDER BY v.distance
    `;
    const params: unknown[] = [Buffer.from(vec.buffer), limit];
    if (pathFilter) params.push(`%${pathFilter}%`);
    const rows = db.prepare(sql).all(...params) as (ChunkRow & {
      distance: number;
    })[];
    return rows.map((row, i) => ({
      chunk: rowToChunk(row),
      rank: i + 1,
      distance: row.distance,
    }));
  } catch (err) {
    logger.warn(`Vector search failed: ${err}`);
    return [];
  }
}

/** Reciprocal-rank fusion over two ranked lists keyed by chunk id. */
function fuse(
  ftsResults: { chunk: WorkspaceChunk; rank: number }[],
  vecResults: { chunk: WorkspaceChunk; rank: number }[],
  rrfK: number,
): WorkspaceSearchResult[] {
  const merged = new Map<string, WorkspaceSearchResult>();

  for (const { chunk, rank } of ftsResults) {
    merged.set(chunk.id, {
      chunk,
      score: 1 / (rrfK + rank),
      ftsRank: rank,
      source: 'fts',
    });
  }
  for (const { chunk, rank } of vecResults) {
    const existing = merged.get(chunk.id);
    const contribution = 1 / (rrfK + rank);
    if (existing) {
      existing.score += contribution;
      existing.vecRank = rank;
      existing.source = 'hybrid';
    } else {
      merged.set(chunk.id, {
        chunk,
        score: contribution,
        vecRank: rank,
        source: 'vector',
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.score - a.score);
}

/** Lightweight MMR over WorkspaceSearchResult using jaccard on content. */
function mmrDiversify(
  results: WorkspaceSearchResult[],
  limit: number,
  lambda: number,
): WorkspaceSearchResult[] {
  if (results.length <= limit) return results;

  const maxScore = Math.max(...results.map((r) => r.score));
  const minScore = Math.min(...results.map((r) => r.score));
  const range = maxScore - minScore || 1;

  const selected: WorkspaceSearchResult[] = [];
  const remaining = new Set(results.map((r) => r.chunk.id));
  const byId = new Map(results.map((r) => [r.chunk.id, r]));

  while (selected.length < limit && remaining.size > 0) {
    let bestId: string | null = null;
    let bestMmr = -Infinity;
    for (const id of remaining) {
      const candidate = byId.get(id)!;
      const relevance = (candidate.score - minScore) / range;
      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccardSimilarity(
          candidate.chunk.content,
          sel.chunk.content,
        );
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = lambda * relevance - (1 - lambda) * maxSim;
      if (mmr > bestMmr) {
        bestMmr = mmr;
        bestId = id;
      }
    }
    if (!bestId) break;
    selected.push(byId.get(bestId)!);
    remaining.delete(bestId);
  }
  return selected;
}

export async function searchWorkspace(
  query: string,
  options: SearchOptions = {},
): Promise<WorkspaceSearchResult[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
  const candidates = limit * 4;
  const rrfK = options.rrfK ?? 60;
  const lambda = options.mmrLambda ?? 0.7;

  const ftsResults = ftsSearch(query, candidates, options.pathFilter);
  const vecResults = options.skipVector
    ? []
    : await vectorSearch(query, candidates, options.pathFilter);

  if (ftsResults.length === 0 && vecResults.length === 0) return [];

  const fused = fuse(ftsResults, vecResults, rrfK);
  return mmrDiversify(fused, limit, lambda);
}

export interface OpenChunkOptions {
  /** Optional inclusive line range — clamps to file length. */
  lines?: { start: number; end: number };
  /** Hard cap on returned characters. */
  maxChars?: number;
}

export async function openWorkspaceFile(
  relPath: string,
  options: OpenChunkOptions = {},
): Promise<{ path: string; content: string; truncated: boolean }> {
  const workDir = getSetting('workDir');
  if (!workDir) throw new Error('workDir not configured');
  const root = resolve(workDir);
  const abs = resolve(root, relPath);
  // Path traversal guard — must stay inside the workspace root.
  const rel = relative(root, abs);
  if (rel.startsWith('..') || rel.startsWith('/')) {
    throw new Error(`Refusing to open path outside workspace: ${relPath}`);
  }
  let text = await readFile(abs, 'utf8');
  if (options.lines) {
    const lines = text.split(/\r?\n/);
    const start = Math.max(1, options.lines.start) - 1;
    const end = Math.min(lines.length, options.lines.end);
    text = lines.slice(start, end).join('\n');
  }
  const cap = options.maxChars ?? 12_000;
  const truncated = text.length > cap;
  if (truncated) text = text.slice(0, cap);
  return { path: rel, content: text, truncated };
}
