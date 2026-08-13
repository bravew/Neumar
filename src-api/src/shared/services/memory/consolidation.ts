/**
 * Memory Consolidation Engine
 *
 * Periodically reviews, merges, and distills memories to maintain quality.
 * Similar memories are clustered by embedding cosine similarity and merged
 * via LLM into comprehensive summaries.
 *
 * Safety:
 * - Never consolidates pinned memories
 * - Never merges across scopes
 * - Never merges across languages (v2 §9.9)
 */

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import type { EmbedOptions } from './embedder';
import {
  createMemory,
  getCachedEmbedding,
  logConsolidationRun,
  storeEmbedding,
} from './store';
import type {
  ConsolidationConfig,
  LLMCallFn,
  Memory,
  MemoryRow,
} from './types';
import { rowToMemory } from './types';

const logger = createLogger('MemoryConsolidation');

export interface ConsolidationResult {
  memoriesReviewed: number;
  memoriesMerged: number;
  memoriesArchived: number;
  clustersFound: number;
  durationMs: number;
}

/**
 * Compute cosine similarity between two Float32Arrays.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find clusters of semantically similar memories using single-linkage clustering.
 * Only clusters memories that share the same scope and language.
 */
export function findSimilarClusters(
  memories: Memory[],
  embeddings: Map<string, Float32Array>,
  threshold: number,
): Memory[][] {
  // Group by (scope_type + scope_id + language) to prevent cross-scope/language merges
  const groups = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = `${m.scopeType}:${m.scopeId ?? ''}:${m.language ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(m);
    groups.set(key, group);
  }

  const allClusters: Memory[][] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Build adjacency list based on similarity threshold
    const visited = new Set<string>();
    const adj = new Map<string, string[]>();

    for (let i = 0; i < group.length; i++) {
      const memA = group[i]!;
      const embA = embeddings.get(memA.id);
      if (!embA) continue;

      for (let j = i + 1; j < group.length; j++) {
        const memB = group[j]!;
        const embB = embeddings.get(memB.id);
        if (!embB) continue;

        const sim = cosineSimilarity(embA, embB);
        if (sim >= threshold) {
          const neighborsA = adj.get(memA.id) ?? [];
          neighborsA.push(memB.id);
          adj.set(memA.id, neighborsA);

          const neighborsB = adj.get(memB.id) ?? [];
          neighborsB.push(memA.id);
          adj.set(memB.id, neighborsB);
        }
      }
    }

    // BFS to find connected components (clusters)
    const memoryMap = new Map(group.map((m) => [m.id, m]));

    for (const m of group) {
      if (visited.has(m.id) || !adj.has(m.id)) continue;

      const cluster: Memory[] = [];
      const queue = [m.id];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const mem = memoryMap.get(current);
        if (mem) cluster.push(mem);

        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }

      if (cluster.length >= 2) {
        allClusters.push(cluster);
      }
    }
  }

  return allClusters;
}

/**
 * Merge a cluster of similar memories into a single comprehensive memory using LLM.
 */
export async function mergeMemoryCluster(
  cluster: Memory[],
  callLLM: LLMCallFn,
): Promise<{ content: string; importance: number }> {
  const contents = cluster.map((m) => `- ${m.content}`).join('\n');

  const prompt = `These memories contain overlapping information. Merge them into a single, comprehensive statement that preserves all unique facts. Output ONLY the merged text, nothing else.

Memories:
${contents}

Merged memory:`;

  try {
    const merged = await callLLM(prompt);
    const cleanMerged = merged.trim();

    // Preserve highest importance from cluster
    const maxImportance = Math.max(...cluster.map((m) => m.importance));

    return {
      content: cleanMerged.slice(0, 2000),
      importance: maxImportance,
    };
  } catch (err) {
    logger.warn(`LLM merge failed: ${err}`);
    // Fallback: concatenate unique content
    const unique = [...new Set(cluster.map((m) => m.content))];
    return {
      content: unique.join('; '),
      importance: Math.max(...cluster.map((m) => m.importance)),
    };
  }
}

/**
 * Run memory consolidation — find similar clusters, merge, and archive originals.
 */
export async function runConsolidation(
  config: ConsolidationConfig,
  callLLM: LLMCallFn,
  embedOptions: EmbedOptions,
): Promise<ConsolidationResult> {
  const startTime = Date.now();

  const db = getDatabase();

  // Get all active, non-pinned memories with embeddings
  const rows = db
    .prepare(
      `SELECT * FROM memories
       WHERE lifecycle_status = 'active'
         AND memory_type != 'pinned'
         AND has_embedding = 1
       ORDER BY created_at DESC
       LIMIT 2000`,
    )
    .all() as MemoryRow[];

  const memories = rows.map(rowToMemory);

  if (memories.length < config.minMemoriesForRun) {
    logger.info(
      `Consolidation skipped: only ${memories.length} memories (min: ${config.minMemoriesForRun})`,
    );
    return {
      memoriesReviewed: memories.length,
      memoriesMerged: 0,
      memoriesArchived: 0,
      clustersFound: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Load embeddings from vec_memories
  const embeddings = new Map<string, Float32Array>();
  const { getModelName } = await import('./embedder');
  const modelName = getModelName(embedOptions);

  for (const m of memories) {
    const cached = getCachedEmbedding(m.content, modelName);
    if (cached) {
      embeddings.set(m.id, cached);
    }
  }

  // Find similar clusters
  const clusters = findSimilarClusters(
    memories,
    embeddings,
    config.similarityThreshold,
  );

  let memoriesMerged = 0;
  let memoriesArchived = 0;

  // Process clusters (cap at maxMergePerRun)
  const clustersToProcess = clusters.slice(0, config.maxMergePerRun);

  for (const cluster of clustersToProcess) {
    try {
      // Merge cluster via LLM
      const { content, importance } = await mergeMemoryCluster(
        cluster,
        callLLM,
      );

      // Create merged memory
      const oldest = cluster.reduce(
        (min, m) => (new Date(m.createdAt) < new Date(min.createdAt) ? m : min),
        cluster[0]!,
      );

      const merged = createMemory({
        content,
        category: oldest!.category,
        importance,
        source: 'auto_capture',
        memoryType: oldest!.memoryType,
        scopeType: oldest!.scopeType,
        scopeId: oldest!.scopeId ?? undefined,
        confidence: Math.max(...cluster.map((m) => m.confidence)),
        language: oldest!.language ?? undefined,
      });

      // Store embedding for merged memory (storeEmbedding handles generation internally)
      try {
        await storeEmbedding(merged.id, content, embedOptions);
      } catch {
        // Non-fatal
      }

      // Update merged memory with consolidation metadata
      const consolidatedIds = cluster.map((m) => m.id);
      db.prepare(
        `UPDATE memories
         SET consolidated_from = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(JSON.stringify(consolidatedIds), merged.id);

      // Archive original memories
      const archiveStmt = db.prepare(
        `UPDATE memories
         SET lifecycle_status = 'archived',
             parent_id = ?,
             valid_until = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`,
      );

      for (const original of cluster) {
        archiveStmt.run(merged.id, original.id);
        memoriesArchived++;
      }

      memoriesMerged++;
    } catch (err) {
      logger.warn(`Cluster merge failed: ${err}`);
    }
  }

  const durationMs = Date.now() - startTime;

  // Log the run
  logConsolidationRun({
    memoriesReviewed: memories.length,
    memoriesMerged,
    memoriesArchived,
    memoriesPruned: 0,
    entitiesCreated: 0,
    edgesCreated: 0,
    durationMs,
  });

  logger.info(
    `Consolidation complete: ${clusters.length} clusters found, ${memoriesMerged} merged, ` +
      `${memoriesArchived} archived (${durationMs}ms)`,
  );

  return {
    memoriesReviewed: memories.length,
    memoriesMerged,
    memoriesArchived,
    clustersFound: clusters.length,
    durationMs,
  };
}

/** Interval handle for periodic consolidation */
let consolidationInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic consolidation.
 */
export function startConsolidation(
  config: ConsolidationConfig,
  callLLM: LLMCallFn,
  embedOptions: EmbedOptions,
): void {
  stopConsolidation();

  if (!config.enabled) {
    logger.info('Consolidation disabled');
    return;
  }

  const intervalMs = config.intervalDays * 24 * 60 * 60 * 1000;

  consolidationInterval = setInterval(() => {
    runConsolidation(config, callLLM, embedOptions).catch((err) => {
      logger.warn(`Periodic consolidation failed: ${err}`);
    });
  }, intervalMs);

  logger.info(`Consolidation started (interval: ${config.intervalDays} days)`);
}

/** Stop periodic consolidation. */
export function stopConsolidation(): void {
  if (consolidationInterval) {
    clearInterval(consolidationInterval);
    consolidationInterval = null;
  }
}
