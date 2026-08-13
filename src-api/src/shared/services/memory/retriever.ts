/**
 * Memory Retriever — Hybrid search (vector ANN + FTS5 BM25) with RRF fusion.
 *
 * Inspired by OpenClaw's hybrid search design: vector search excels at
 * paraphrase matching, BM25 excels at exact tokens (IDs, env vars, code symbols).
 * RRF fusion combines both signals without requiring score normalization.
 *
 * v2 additions: decay-weighted scoring, MMR diversity re-ranking, scoped search,
 * lifecycle filtering, cognitive type boosts.
 */

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import { calculateStrength } from './decay';
import type { EmbedOptions } from './embedder';
import { embed } from './embedder';
import { mmrRerank } from './mmr';
import { recordAccess } from './store';
import type {
  LLMCallFn,
  MemoryCategory,
  MemoryRow,
  MemorySearchResult,
  MemoryType,
} from './types';
import { daysSince, rowToMemory } from './types';

const logger = createLogger('MemoryRetriever');

// Standard RRF constant
const RRF_K = 60;

/**
 * LLM-based reranking: ask a lightweight model to select the most task-relevant
 * memories from a candidate set. Falls back to original order on failure.
 * Skips entirely if candidate count <= limit.
 */
export async function llmRerank(
  candidates: MemorySearchResult[],
  query: string,
  limit: number,
  callLLM: LLMCallFn,
): Promise<MemorySearchResult[]> {
  if (candidates.length <= limit) return candidates.slice(0, limit);

  try {
    const manifest = candidates
      .slice(0, 20) // Cap at 20 candidates to control token usage
      .map((r) => {
        const age = daysSince(r.memory.createdAt);
        return `- id=${r.memory.id} [${r.memory.category}] ${r.memory.content.slice(0, 80)}... (${age}d old)`;
      })
      .join('\n');

    const prompt = `Select the memories most useful for this query (up to ${limit}). Return JSON: {"ids": ["id1", "id2"]}.
Only include memories you are certain will help. If unsure, return fewer.
Query: ${query}
Memories:
${manifest}`;

    const response = await callLLM(prompt);
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return candidates.slice(0, limit);

    const parsed = JSON.parse(match[0]) as { ids: string[] };
    if (!Array.isArray(parsed.ids)) return candidates.slice(0, limit);

    const idSet = new Set(parsed.ids);
    const reranked = candidates.filter((r) => idSet.has(r.memory.id));
    // If LLM returned fewer than expected, pad with remaining by original score
    if (reranked.length < limit) {
      for (const c of candidates) {
        if (reranked.length >= limit) break;
        if (!idSet.has(c.memory.id)) reranked.push(c);
      }
    }
    return reranked.slice(0, limit);
  } catch (err) {
    logger.warn(`LLM rerank failed, falling back to score order: ${err}`);
    return candidates.slice(0, limit);
  }
}

// Type-aware retrieval boosts (v2)
const TYPE_BOOSTS: Record<MemoryType, number> = {
  pinned: 0.005, // Always boosted — user explicitly pinned
  procedural: 0.003, // Skill knowledge is high-value
  semantic: 0.002, // Facts are standard value
  episodic: 0.001, // Interactions are lower value unless very recent
};

/**
 * Hybrid search: combine sqlite-vec KNN + FTS5 BM25 via Reciprocal Rank Fusion.
 * v2: includes decay scoring, MMR diversity, scoped search, lifecycle filtering.
 */
export async function searchMemories(
  queryText: string,
  options: {
    limit?: number;
    threshold?: number;
    category?: MemoryCategory;
    embedOptions: EmbedOptions;
    // v2 options
    memoryType?: MemoryType;
    scope?: {
      profileId?: string;
      projectId?: string;
      sessionId?: string;
    };
    includeStale?: boolean; // Include stale memories (default: false)
    mmrLambda?: number; // MMR diversity parameter (default: 0.7)
    // v3: optional LLM reranking (requires callLLM from caller)
    callLLM?: LLMCallFn;
  },
): Promise<MemorySearchResult[]> {
  const {
    limit = 5,
    threshold = 0.3,
    category,
    embedOptions,
    memoryType,
    scope,
    includeStale = false,
    mmrLambda = 0.7,
  } = options;
  const db = getDatabase();
  const candidatePool = limit * 4; // Over-fetch for fusion

  // Lazy import to avoid circular dependency
  const { isSqliteVecAvailable } = await import('./index');

  // 1. Vector search (if sqlite-vec available)
  let vectorResults: { memory_id: string; distance: number }[] = [];

  if (isSqliteVecAvailable()) {
    try {
      const queryVector = await embed(queryText, embedOptions);

      vectorResults = db
        .prepare(
          `
        SELECT memory_id, distance
        FROM vec_memories
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      `,
        )
        .all(queryVector, candidatePool) as {
        memory_id: string;
        distance: number;
      }[];
    } catch (err) {
      logger.warn(`Vector search failed: ${err}`);
    }
  }

  // 2. FTS5 BM25 keyword search
  let ftsResults: { id: string; rank: number }[] = [];
  try {
    // Preserve all Unicode letters and numbers (fixes CJK stripping bug §9.2).
    // \p{L} = any letter (Latin, CJK, Devanagari, Arabic, etc.)
    // \p{N} = any number. The `u` flag enables Unicode mode.
    // Strip non-letter/number chars, then quote each token to prevent
    // FTS5 operator interpretation (AND, OR, NOT, etc.)
    const ftsTokens = queryText
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Wrap in quotes for literal phrase matching — prevents FTS5 parse errors
    const ftsQuery = ftsTokens.length > 0 ? `"${ftsTokens}"` : '';
    if (ftsQuery.length > 0) {
      ftsResults = db
        .prepare(
          `
        SELECT m.id, memories_fts.rank
        FROM memories_fts
        JOIN memories m ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
        )
        .all(ftsQuery, candidatePool) as { id: string; rank: number }[];
    }
  } catch (err) {
    logger.warn(`FTS5 search failed: ${err}`);
  }

  // 3. RRF fusion — combine scores from both result sets
  const scores = new Map<string, number>();

  vectorResults.forEach((r, i) => {
    const rank = i + 1;
    scores.set(
      r.memory_id,
      (scores.get(r.memory_id) ?? 0) + 1 / (RRF_K + rank),
    );
  });

  ftsResults.forEach((r, i) => {
    const rank = i + 1;
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + rank));
  });

  // 4. Fetch full memory records and post-process
  const sortedIds = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2); // Fetch more than needed for filtering

  if (sortedIds.length === 0) return [];

  const placeholders = sortedIds.map(() => '?').join(',');
  const params: unknown[] = sortedIds.map(([id]) => id);

  // Build WHERE clause with v2 filters
  const conditions: string[] = [`id IN (${placeholders})`];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  if (memoryType) {
    conditions.push('memory_type = ?');
    params.push(memoryType);
  }

  // Lifecycle filter: exclude archived by default, optionally include stale
  if (includeStale) {
    conditions.push("lifecycle_status != 'archived'");
  } else {
    conditions.push("lifecycle_status = 'active'");
  }

  // Scope filtering: merge results from applicable scopes (parameterized)
  if (scope) {
    const scopeConditions: string[] = ["scope_type = 'global'"];
    if (scope.profileId) {
      scopeConditions.push('(scope_type = ? AND scope_id = ?)');
      params.push('profile', scope.profileId);
    }
    if (scope.projectId) {
      scopeConditions.push('(scope_type = ? AND scope_id = ?)');
      params.push('project', scope.projectId);
    }
    if (scope.sessionId) {
      scopeConditions.push('(scope_type = ? AND scope_id = ?)');
      params.push('session', scope.sessionId);
    }
    conditions.push(`(${scopeConditions.join(' OR ')})`);
  }

  const sql = `SELECT * FROM memories WHERE ${conditions.join(' AND ')}`;
  const rows = db.prepare(sql).all(...params) as MemoryRow[];
  const memoryMap = new Map(rows.map((r) => [r.id, rowToMemory(r)]));

  // 5. Build results with decay-based scoring (v2)
  const results: MemorySearchResult[] = [];

  // Read config once for decay check, session indexing, and LLM reranking
  let memConfig: {
    decayEnabled: boolean;
    sessionIndexing: boolean;
    llmRerankEnabled: boolean;
  } = {
    decayEnabled: false,
    sessionIndexing: false,
    llmRerankEnabled: false,
  };
  try {
    const config = (await import('./config')).getMemoryConfig();
    memConfig = config;
  } catch {
    // Config not available — use defaults
  }

  for (const [id, rrfScore] of sortedIds) {
    const memory = memoryMap.get(id);
    if (!memory) continue;

    let score = rrfScore;

    if (memConfig.decayEnabled) {
      // Use decay strength as the primary scoring factor (replaces old boosts)
      const strength = calculateStrength(memory);
      score += strength * 0.003;
    } else {
      // Legacy scoring: recency + importance + frequency
      const ageMs = Date.now() - new Date(memory.createdAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 7) score += 0.002 * (1 - ageDays / 7);
      score += memory.importance * 0.001;
      if (memory.accessCount > 5) score += 0.0005;
    }

    // Type-aware boost (v2)
    score += TYPE_BOOSTS[memory.memoryType] ?? 0;

    // Scale threshold for RRF scores: user-facing threshold is 0–1 (e.g., 0.3)
    // but RRF scores are typically 0.001–0.03, so we scale by 0.01.
    if (score >= threshold * 0.01) {
      results.push({ memory, score });
    }
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // 6. MMR diversity re-ranking (v2)
  let diverseResults = mmrRerank(results, { limit, lambda: mmrLambda });

  // 6b. LLM reranking (v3) — refine MMR results with an LLM if enabled
  if (options.callLLM && memConfig.llmRerankEnabled) {
    try {
      diverseResults = await llmRerank(
        diverseResults,
        queryText,
        limit,
        options.callLLM,
      );
    } catch (err) {
      logger.warn(
        `LLM rerank failed in searchMemories, using MMR results: ${err}`,
      );
    }
  }

  // Record access for returned memories
  // Guard against synthetic session IDs (Phase 7D)
  for (const r of diverseResults) {
    if (!r.memory.id.startsWith('session:')) {
      recordAccess(r.memory.id);
    }
  }

  // 7. Merge session results (Phase 7D)
  const topResults = [...diverseResults];

  try {
    if (memConfig.sessionIndexing) {
      const { searchSessions } = await import('./session-indexer');
      const sessionResults = await searchSessions(
        queryText,
        embedOptions,
        Math.ceil(limit / 3),
      );

      for (const sr of sessionResults) {
        if (topResults.length >= limit) break;
        topResults.push({
          memory: {
            id: `session:${sr.taskId}`,
            content: sr.content.slice(0, 200),
            category: 'fact' as MemoryCategory,
            importance: 0.5,
            source: 'auto_capture' as const,
            sessionId: sr.taskId,
            accessCount: 0,
            lastAccessedAt: null,
            hasEmbedding: true,
            createdAt: sr.createdAt,
            updatedAt: sr.createdAt,
            // v2 defaults for synthetic session memories
            memoryType: 'episodic' as const,
            scopeType: 'session' as const,
            scopeId: sr.taskId,
            decayRate: 0,
            lastAccessedStrength: 0.5,
            confidence: 0.5,
            validFrom: null,
            validUntil: null,
            parentId: null,
            consolidatedFrom: null,
            lifecycleStatus: 'active' as const,
            language: null,
            metadata: null,
            visibility: 'private' as const,
          },
          score: sr.score * 0.8, // Slight penalty vs explicit memories
        });
      }
    }
  } catch {
    // Session indexing not available — skip silently
  }

  return topResults;
}

/**
 * FTS5-only keyword search — exposed as a standalone fallback when
 * semantic search misses exact tokens (IDs, env vars, code symbols).
 */
export function ftsOnlySearch(
  queryText: string,
  options?: { limit?: number },
): MemorySearchResult[] {
  const limit = options?.limit ?? 10;
  const db = getDatabase();

  try {
    const ftsTokens = queryText
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Quote each token individually so FTS5 matches all terms independently
    // (implicit AND). A single-quoted phrase like "a b" would require adjacency.
    const ftsQuery = ftsTokens
      .split(' ')
      .filter(Boolean)
      .map((t) => `"${t}"`)
      .join(' ');
    if (ftsQuery.length === 0) return [];

    const rows = db
      .prepare(
        `
        SELECT m.*
        FROM memories_fts
        JOIN memories m ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
          AND m.lifecycle_status = 'active'
        ORDER BY memories_fts.rank
        LIMIT ?
      `,
      )
      .all(ftsQuery, limit) as MemoryRow[];

    return rows.map((row, i) => ({
      memory: rowToMemory(row),
      score: 1 / (1 + i), // Simple rank-based score
    }));
  } catch (err) {
    logger.warn(`FTS-only search failed: ${err}`);
    return [];
  }
}
