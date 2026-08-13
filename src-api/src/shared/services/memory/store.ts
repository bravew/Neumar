/**
 * Memory Store — CRUD operations for the memories table.
 *
 * All functions use the shared getDatabase() singleton.
 * Embedding operations are handled by embedder.ts + the vec0 table;
 * this module only manages metadata rows and delegates embedding ops.
 */

import { createHash, randomUUID } from 'node:crypto';

import { getDatabase } from '@/shared/db';
import {
  EMBEDDER_LRU_BUDGET_BYTES,
  getMemoryBudgetSupervisor,
} from '@/shared/services/memory-budget';
import { createLogger } from '@/shared/utils/logger';

import { getMemoryConfig } from './config';
import {
  getEmbeddingDim,
  type EmbeddingProvider,
  type EmbedOptions,
} from './embedder';
import type {
  CreateMemoryInput,
  LifecycleStatus,
  Memory,
  MemoryCategory,
  MemoryConfig,
  MemoryEntity,
  MemoryEntityEdge,
  MemoryEntityEdgeRow,
  MemoryEntityRow,
  MemoryRow,
  MemoryStats,
  MemoryType,
  ScopeType,
  UpdateMemoryInput,
} from './types';
import { rowToEntity, rowToEntityEdge, rowToMemory } from './types';

const logger = createLogger('MemoryStore');
const EMBEDDER_PRESSURE_TARGET_BYTES = Math.floor(
  EMBEDDER_LRU_BUDGET_BYTES / 2,
);

function mirrorMemoryAsync(memory: Memory): void {
  import('./file-mirror')
    .then(({ mirrorMemoryToDisk }) => mirrorMemoryToDisk(memory))
    .catch((err) => {
      logger.warn(`Failed to mirror memory ${memory.id} to disk: ${err}`);
    });
}

function removeMirroredMemoryAsync(id: string): void {
  import('./file-mirror')
    .then(({ removeMemoryFromDisk }) => removeMemoryFromDisk(id))
    .catch((err) => {
      logger.warn(`Failed to remove mirrored memory ${id}: ${err}`);
    });
}

// ── Sensitive content patterns (block from team-visible memories) ──

const SENSITIVE_PATTERNS = [
  /\bsk-[A-Za-z0-9]{20,}/, // OpenAI / Anthropic API keys
  /\bghp_[A-Za-z0-9]{36}/, // GitHub personal access tokens
  /\bBearer\s+[A-Za-z0-9_.~+-]{20,}/i, // Bearer tokens
  /password\s*[:=]\s*\S+/i, // password assignments
  /secret\s*[:=]\s*\S+/i, // secret assignments
];

/** Check if content contains sensitive patterns that should not be shared. */
export function containsSensitiveContent(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

// ── Create ──

export function createMemory(input: CreateMemoryInput): Memory {
  const db = getDatabase();

  // Memory limit enforcement (Gotcha #14):
  // Evict lowest-importance + oldest memory when at capacity
  const config = getMemoryConfig();
  const count = getMemoryCount();
  if (count >= config.maxMemories) {
    const evictTarget = db
      .prepare(
        'SELECT id FROM memories ORDER BY importance ASC, created_at ASC LIMIT 1',
      )
      .get() as { id: string } | undefined;
    if (evictTarget) {
      deleteMemory(evictTarget.id);
      logger.info(
        `🗑️ Evicted memory ${evictTarget.id} (at capacity: ${config.maxMemories})`,
      );
    }
  }

  const id = randomUUID();

  // Block sensitive content in team-visible memories
  const visibility = input.visibility ?? 'private';
  if (visibility === 'team' && containsSensitiveContent(input.content)) {
    logger.warn(
      'Blocked team memory with sensitive content (API keys, credentials)',
    );
    throw new Error('Cannot create team memory containing sensitive content');
  }

  const stmt = db.prepare(`
    INSERT INTO memories (
      id, content, category, importance, source, session_id,
      memory_type, scope_type, scope_id, decay_rate, confidence,
      valid_from, valid_until, language, metadata, visibility
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    input.content,
    input.category ?? 'other',
    input.importance ?? 0.7,
    input.source ?? 'manual',
    input.sessionId ?? null,
    input.memoryType ?? 'semantic',
    input.scopeType ?? 'global',
    input.scopeId ?? null,
    input.decayRate ?? 0.023,
    input.confidence ?? 0.7,
    input.validFrom ?? null,
    input.validUntil ?? null,
    input.language ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    visibility,
  );

  const memory = getMemory(id);
  if (!memory) throw new Error('Failed to create memory');
  mirrorMemoryAsync(memory);
  return memory;
}

// ── Read ──

export function getMemory(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
    | MemoryRow
    | undefined;
  return row ? rowToMemory(row) : null;
}

/** Allowed columns for ORDER BY — prevents SQL injection via sortBy. */
const SORTABLE_COLUMNS = new Set([
  'created_at',
  'importance',
  'category',
  'content',
  'memory_type',
  'scope_type',
  'confidence',
  'lifecycle_status',
  'visibility',
]);

export function listMemories(options?: {
  category?: MemoryCategory;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  // v2 filters
  memoryType?: MemoryType;
  scopeType?: ScopeType;
  scopeId?: string;
  lifecycleStatus?: LifecycleStatus;
}): Memory[] {
  const db = getDatabase();
  const {
    category,
    limit = 50,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc',
    search,
    memoryType,
    scopeType,
    scopeId,
    lifecycleStatus,
  } = options ?? {};

  let sql = 'SELECT * FROM memories';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  if (search) {
    const escapedSearch = search.replace(/[%_]/g, '\\$&');
    conditions.push("content LIKE ? ESCAPE '\\'");
    params.push(`%${escapedSearch}%`);
  }

  if (memoryType) {
    conditions.push('memory_type = ?');
    params.push(memoryType);
  }

  if (scopeType) {
    conditions.push('scope_type = ?');
    params.push(scopeType);
  }

  if (scopeId) {
    conditions.push('scope_id = ?');
    params.push(scopeId);
  }

  if (lifecycleStatus) {
    conditions.push('lifecycle_status = ?');
    params.push(lifecycleStatus);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  // Safe column name via allowlist
  const col = SORTABLE_COLUMNS.has(sortBy) ? sortBy : 'created_at';
  const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as MemoryRow[];
  return rows.map(rowToMemory);
}

// ── Update ──

/** Allowed columns for dynamic UPDATE — prevents SQL injection via key manipulation. */
const UPDATABLE_COLUMNS = new Set([
  'content',
  'category',
  'importance',
  'memory_type',
  'scope_type',
  'scope_id',
  'confidence',
  'valid_from',
  'valid_until',
  'lifecycle_status',
  'language',
  'metadata',
  'visibility',
]);

export function updateMemory(
  id: string,
  input: UpdateMemoryInput,
): Memory | null {
  const db = getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];

  const fields: { key: string; value: unknown }[] = [
    { key: 'content', value: input.content },
    { key: 'category', value: input.category },
    { key: 'importance', value: input.importance },
    { key: 'memory_type', value: input.memoryType },
    { key: 'scope_type', value: input.scopeType },
    { key: 'scope_id', value: input.scopeId },
    { key: 'confidence', value: input.confidence },
    { key: 'valid_from', value: input.validFrom },
    { key: 'valid_until', value: input.validUntil },
    { key: 'lifecycle_status', value: input.lifecycleStatus },
    { key: 'language', value: input.language },
    {
      key: 'metadata',
      value: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
    { key: 'visibility', value: input.visibility },
  ];

  for (const { key, value } of fields) {
    if (value !== undefined && UPDATABLE_COLUMNS.has(key)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return getMemory(id);

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE memories SET ${sets.join(', ')} WHERE id = ?`).run(
    ...params,
  );
  const memory = getMemory(id);
  if (memory) mirrorMemoryAsync(memory);
  return memory;
}

// ── Delete ──

export function deleteMemory(id: string): boolean {
  const db = getDatabase();

  // Delete embedding from vec_memories (if exists) + metadata in one transaction
  const deleteTransaction = db.transaction(() => {
    try {
      db.prepare('DELETE FROM vec_memories WHERE memory_id = ?').run(id);
    } catch {
      // vec_memories may not exist if sqlite-vec not loaded — safe to ignore
    }
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  });

  const deleted = deleteTransaction();
  if (deleted) removeMirroredMemoryAsync(id);
  return deleted;
}

/**
 * Delete all memories matching a scope (for /forget — GDPR right to erasure).
 * Returns the number of memories deleted.
 */
export function deleteMemoriesByScope(
  scopeType: ScopeType,
  scopeId: string,
): number {
  const db = getDatabase();
  // Delete embeddings first (foreign key not enforced), then memories
  const tx = db.transaction(() => {
    try {
      db.prepare(
        `DELETE FROM vec_memories WHERE memory_id IN (
           SELECT id FROM memories WHERE scope_type = ? AND scope_id = ?
         )`,
      ).run(scopeType, scopeId);
    } catch (err) {
      // Only suppress "table not found" — vec_memories may not exist if sqlite-vec not loaded
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('no such table')) {
        logger.debug('vec_memories cleanup skipped (table not found)');
      } else {
        throw err;
      }
    }
    const result = db
      .prepare('DELETE FROM memories WHERE scope_type = ? AND scope_id = ?')
      .run(scopeType, scopeId);
    return result.changes;
  });
  return tx();
}

// ── Access tracking ──

export function recordAccess(id: string): void {
  const db = getDatabase();
  // Increment access count, update timestamp, and reset decay strength
  // (spacing effect: frequently accessed memories resist decay)
  db.prepare(
    `
    UPDATE memories
    SET access_count = access_count + 1,
        last_accessed_at = datetime('now'),
        last_accessed_strength = importance
    WHERE id = ?
  `,
  ).run(id);
}

// ── Stats ──

export function getMemoryStats(): MemoryStats {
  const db = getDatabase();

  const total = (
    db.prepare('SELECT COUNT(*) as count FROM memories').get() as {
      count: number;
    }
  ).count;

  const withEmbeddings = (
    db
      .prepare('SELECT COUNT(*) as count FROM memories WHERE has_embedding = 1')
      .get() as { count: number }
  ).count;

  const categoryRows = db
    .prepare(
      'SELECT category, COUNT(*) as count FROM memories GROUP BY category',
    )
    .all() as { category: string; count: number }[];

  const byCategory: Record<string, number> = {};
  for (const row of categoryRows) {
    byCategory[row.category] = row.count;
  }

  const oldest = db
    .prepare('SELECT MIN(created_at) as val FROM memories')
    .get() as { val: string | null };

  const newest = db
    .prepare('SELECT MAX(created_at) as val FROM memories')
    .get() as { val: string | null };

  // v2 stats
  const typeRows = db
    .prepare(
      'SELECT memory_type, COUNT(*) as count FROM memories GROUP BY memory_type',
    )
    .all() as { memory_type: string; count: number }[];

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.memory_type] = row.count;
  }

  const scopeRows = db
    .prepare(
      'SELECT scope_type, COUNT(*) as count FROM memories GROUP BY scope_type',
    )
    .all() as { scope_type: string; count: number }[];

  const byScope: Record<string, number> = {};
  for (const row of scopeRows) {
    byScope[row.scope_type] = row.count;
  }

  const lifecycleRows = db
    .prepare(
      'SELECT lifecycle_status, COUNT(*) as count FROM memories GROUP BY lifecycle_status',
    )
    .all() as { lifecycle_status: string; count: number }[];

  const byLifecycle: Record<string, number> = {};
  for (const row of lifecycleRows) {
    byLifecycle[row.lifecycle_status] = row.count;
  }

  return {
    total,
    byCategory: byCategory as Record<MemoryCategory, number>,
    withEmbeddings,
    oldestMemory: oldest.val,
    newestMemory: newest.val,
    byType: byType as Record<MemoryType, number>,
    byScope: byScope as Record<ScopeType, number>,
    byLifecycle: byLifecycle as Record<LifecycleStatus, number>,
  };
}

// ── Helpers ──

export function setHasEmbedding(id: string, has: boolean): void {
  const db = getDatabase();
  db.prepare('UPDATE memories SET has_embedding = ? WHERE id = ?').run(
    has ? 1 : 0,
    id,
  );
}

export function getMemoryCount(options?: {
  category?: MemoryCategory;
  search?: string;
}): number {
  const db = getDatabase();
  const { category, search } = options ?? {};

  let sql = 'SELECT COUNT(*) as count FROM memories';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  if (search) {
    const escapedSearch = search.replace(/[%_]/g, '\\$&');
    conditions.push("content LIKE ? ESCAPE '\\'");
    params.push(`%${escapedSearch}%`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  return (db.prepare(sql).get(...params) as { count: number }).count;
}

// ── Embedding operations (Phase 2) ──

/**
 * Generate and store embedding for a memory.
 * Uses the embedding cache to avoid redundant API calls (Phase 7A).
 * Runs the embedding generation async, then stores in same transaction.
 */
export async function storeEmbedding(
  memoryId: string,
  content: string,
  options: EmbedOptions,
): Promise<void> {
  // Lazy import to avoid circular dependency (index.ts → store.ts → index.ts)
  const { isSqliteVecAvailable } = await import('./index');

  if (!isSqliteVecAvailable()) {
    logger.debug(
      `⏭️ sqlite-vec not available — skipping embedding for ${memoryId}`,
    );
    return;
  }

  // Determine model name for cache key (uses shared helper from embedder.ts)
  const { getModelName } = await import('./embedder');
  const modelName = getModelName(options);

  // Check cache first
  let vector = getCachedEmbedding(content, modelName);

  if (!vector) {
    // Generate new embedding
    const { embed } = await import('./embedder');
    vector = await embed(content, options);

    // Cache the result
    cacheEmbedding(content, modelName, vector);
    logger.debug(
      `🔢 Generated embedding for ${memoryId} (model: ${modelName})`,
    );
  } else {
    logger.debug(`📦 Cache hit for embedding (model: ${modelName})`);
  }

  const db = getDatabase();

  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO vec_memories (memory_id, embedding)
      VALUES (?, ?)
    `,
    ).run(memoryId, vector);

    db.prepare('UPDATE memories SET has_embedding = 1 WHERE id = ?').run(
      memoryId,
    );
  })();

  logger.info(
    `✅ Stored embedding for memory ${memoryId} (${vector.length}-dim)`,
  );
}

/**
 * Remove embedding for a memory.
 */
export async function deleteEmbedding(memoryId: string): Promise<void> {
  const { isSqliteVecAvailable } = await import('./index');
  if (!isSqliteVecAvailable()) return;

  const db = getDatabase();
  db.prepare('DELETE FROM vec_memories WHERE memory_id = ?').run(memoryId);
  db.prepare('UPDATE memories SET has_embedding = 0 WHERE id = ?').run(
    memoryId,
  );
}

/**
 * Re-create the vec_memories table with a new dimension.
 * Drops all existing embeddings — they must be re-generated.
 */
export async function recreateVecTable(dim: number): Promise<void> {
  const { isSqliteVecAvailable } = await import('./index');
  if (!isSqliteVecAvailable()) return;

  const db = getDatabase();
  db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS vec_memories');
    db.exec(`
      CREATE VIRTUAL TABLE vec_memories USING vec0(
        memory_id TEXT PARTITION KEY,
        embedding float[${dim}] distance_metric=cosine
      )
    `);
    db.exec('UPDATE memories SET has_embedding = 0');
  })();

  logger.info(`Recreated vec_memories with dimension ${dim}`);
}

// ── Embedding Cache (Phase 7A) ──

/**
 * Compute SHA-256 hash of content for embedding cache key.
 */
function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Look up a cached embedding by content hash + model name.
 * Returns Float32Array if found, null otherwise.
 */
export function getCachedEmbedding(
  content: string,
  model: string,
): Float32Array | null {
  const db = getDatabase();
  const hash = contentHash(content);

  const row = db
    .prepare(
      'SELECT embedding, dim FROM embedding_cache WHERE content_hash = ? AND model = ?',
    )
    .get(hash, model) as { embedding: Buffer; dim: number } | undefined;

  if (!row) return null;

  db.prepare(
    `UPDATE embedding_cache
     SET accessed_at = datetime('now')
     WHERE content_hash = ? AND model = ?`,
  ).run(hash, model);

  // Copy to a new ArrayBuffer to guarantee 4-byte alignment for Float32Array.
  // better-sqlite3 may return a Buffer whose byteOffset isn't 4-byte aligned.
  const aligned = new ArrayBuffer(row.dim * 4);
  new Uint8Array(aligned).set(
    new Uint8Array(row.embedding.buffer, row.embedding.byteOffset, row.dim * 4),
  );
  return new Float32Array(aligned);
}

/**
 * Store an embedding in the cache.
 */
export function cacheEmbedding(
  content: string,
  model: string,
  embedding: Float32Array,
): void {
  const db = getDatabase();
  const hash = contentHash(content);

  // Store Float32Array as BLOB
  const buffer = Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );

  db.prepare(
    `
    INSERT OR REPLACE INTO embedding_cache (content_hash, model, embedding, dim)
    VALUES (?, ?, ?, ?)
  `,
  ).run(hash, model, buffer, embedding.length);

  enforceEmbeddingCacheBudget();
}

interface EmbeddingCacheBudgetRow {
  content_hash: string;
  model: string;
  sizeBytes: number;
}

/**
 * Keep the embedding cache bounded by evicting least-recently-accessed rows.
 */
export function enforceEmbeddingCacheBudget(
  maxBytes = EMBEDDER_LRU_BUDGET_BYTES,
): number {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT content_hash, model, length(embedding) AS sizeBytes
       FROM embedding_cache
       ORDER BY COALESCE(accessed_at, created_at) ASC`,
    )
    .all() as EmbeddingCacheBudgetRow[];

  let totalBytes = rows.reduce((total, row) => total + row.sizeBytes, 0);
  let removed = 0;
  let bytesRemoved = 0;

  const deleteRow = db.prepare(
    'DELETE FROM embedding_cache WHERE content_hash = ? AND model = ?',
  );
  const prune = db.transaction(() => {
    for (const row of rows) {
      if (totalBytes <= maxBytes) break;
      const result = deleteRow.run(row.content_hash, row.model);
      if (result.changes === 0) continue;
      removed += result.changes;
      bytesRemoved += row.sizeBytes;
      totalBytes -= row.sizeBytes;
    }
  });

  prune();

  if (removed > 0) {
    getMemoryBudgetSupervisor().recordEviction({
      cache: 'embedder-lru',
      reason: 'capacity',
      entriesRemoved: removed,
      bytesRemoved,
    });
  }

  return removed;
}

getMemoryBudgetSupervisor().registerPressureHandler('embedder-lru', () => {
  enforceEmbeddingCacheBudget(EMBEDDER_PRESSURE_TARGET_BYTES);
});

/**
 * Invalidate cache entries for a specific model (used when switching providers).
 */
export function invalidateCache(model?: string): number {
  const db = getDatabase();
  if (model) {
    const result = db
      .prepare('DELETE FROM embedding_cache WHERE model = ?')
      .run(model);
    return result.changes;
  }
  const result = db.prepare('DELETE FROM embedding_cache').run();
  return result.changes;
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): {
  total: number;
  totalBytes: number;
  budgetBytes: number;
  models: Record<string, number>;
} {
  const db = getDatabase();
  const total = (
    db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get() as {
      count: number;
    }
  ).count;

  const rows = db
    .prepare(
      'SELECT model, COUNT(*) as count FROM embedding_cache GROUP BY model',
    )
    .all() as { model: string; count: number }[];

  const models: Record<string, number> = {};
  for (const row of rows) {
    models[row.model] = row.count;
  }

  const totalBytes = (
    db
      .prepare(
        'SELECT COALESCE(SUM(length(embedding)), 0) as bytes FROM embedding_cache',
      )
      .get() as {
      bytes: number;
    }
  ).bytes;

  return { total, totalBytes, budgetBytes: EMBEDDER_LRU_BUDGET_BYTES, models };
}

// ── Reindex Engine (Phase 7B) ──

export interface ReindexProgress {
  total: number;
  processed: number;
  cached: number;
  errors: number;
  status: 'running' | 'completed' | 'failed';
}

// Global reindex state (only one reindex at a time)
let reindexProgress: ReindexProgress | null = null;
let reindexStartedAt: number | null = null;

/** Maximum time a reindex can run before being considered stale (10 minutes). */
const REINDEX_STALE_MS = 10 * 60 * 1000;

/**
 * Get current reindex progress (null if not running).
 * Automatically clears stale "running" state if the reindex has been
 * stuck for longer than REINDEX_STALE_MS (e.g. server crash mid-reindex).
 */
export function getReindexProgress(): ReindexProgress | null {
  if (
    reindexProgress?.status === 'running' &&
    reindexStartedAt &&
    Date.now() - reindexStartedAt > REINDEX_STALE_MS
  ) {
    logger.warn('Clearing stale reindex progress (exceeded timeout)');
    reindexProgress.status = 'failed';
    reindexStartedAt = null;
  }
  return reindexProgress;
}

/**
 * Reindex all memories — re-generate embeddings.
 * If `force` is true, re-embeds everything (even cached).
 * If `force` is false, skips memories with existing embeddings.
 *
 * Runs in batches to avoid blocking the event loop.
 */
export async function reindexMemories(
  options: EmbedOptions,
  force = false,
): Promise<ReindexProgress> {
  // Check for stale state before blocking
  getReindexProgress();

  if (reindexProgress?.status === 'running') {
    throw new Error('Reindex already in progress');
  }

  const { isSqliteVecAvailable } = await import('./index');
  if (!isSqliteVecAvailable()) {
    throw new Error('sqlite-vec not available — cannot reindex');
  }

  const db = getDatabase();

  // Determine which memories need re-embedding
  const whereClause = force ? '' : 'WHERE has_embedding = 0';
  const memories = db
    .prepare(
      `SELECT id, content FROM memories ${whereClause} ORDER BY created_at DESC`,
    )
    .all() as { id: string; content: string }[];

  reindexProgress = {
    total: memories.length,
    processed: 0,
    cached: 0,
    errors: 0,
    status: 'running',
  };
  reindexStartedAt = Date.now();

  if (memories.length === 0) {
    reindexProgress.status = 'completed';
    reindexStartedAt = null;
    return reindexProgress;
  }

  // If force reindex, clear all existing vec_memories entries
  if (force) {
    try {
      db.exec('DELETE FROM vec_memories');
    } catch {
      // vec_memories may not exist — safe to ignore
    }
    db.prepare('UPDATE memories SET has_embedding = 0').run();
  }

  const { embed, getModelName } = await import('./embedder');
  const modelName = getModelName(options);

  // Process in batches of 10 to avoid blocking
  const BATCH_SIZE = 10;
  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);

    for (const mem of batch) {
      try {
        // Check cache first
        let vector = getCachedEmbedding(mem.content, modelName);
        if (vector) {
          reindexProgress.cached++;
        } else {
          vector = await embed(mem.content, options);
          cacheEmbedding(mem.content, modelName, vector);
        }

        db.transaction(() => {
          // Delete existing vec entry if present
          try {
            db.prepare('DELETE FROM vec_memories WHERE memory_id = ?').run(
              mem.id,
            );
          } catch {
            /* may not exist */
          }

          db.prepare(
            'INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)',
          ).run(mem.id, vector);
          db.prepare('UPDATE memories SET has_embedding = 1 WHERE id = ?').run(
            mem.id,
          );
        })();

        reindexProgress.processed++;
      } catch (err) {
        reindexProgress.errors++;
        logger.warn(`Reindex failed for memory ${mem.id}: ${err}`);
      }
    }

    // Yield to event loop between batches
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  reindexProgress.status = 'completed';
  reindexStartedAt = null;
  logger.info(
    `Reindex complete: ${reindexProgress.processed}/${reindexProgress.total} ` +
      `(${reindexProgress.cached} cached, ${reindexProgress.errors} errors)`,
  );

  return reindexProgress;
}

/**
 * Check if embedding dimension has changed and handle migration.
 * Called at startup after initializeMemory().
 *
 * Compares stored `memory.embeddingDim` with the current provider's dimension.
 * If different, recreates vec_memories and triggers background reindex.
 */
export async function checkDimensionChange(
  config: MemoryConfig,
): Promise<void> {
  const { isSqliteVecAvailable } = await import('./index');
  if (!isSqliteVecAvailable()) return;

  const currentDim = getEmbeddingDim(
    config.embeddingProvider as EmbeddingProvider,
    config.embeddingModel || undefined,
  );
  const storedDim = config.embeddingDim;

  if (currentDim !== storedDim) {
    logger.info(
      `Embedding dimension changed: ${storedDim} → ${currentDim}. Recreating vec_memories...`,
    );

    await recreateVecTable(currentDim);

    // Also recreate vec_session_chunks if session indexing is enabled (Phase 7D)
    try {
      const db = getDatabase();
      db.exec('DROP TABLE IF EXISTS vec_session_chunks');
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_session_chunks USING vec0(
          chunk_id INTEGER PARTITION KEY,
          embedding float[${currentDim}] distance_metric=cosine
        )
      `);
      db.exec('UPDATE session_memory_chunks SET has_embedding = 0');
      logger.info(`Recreated vec_session_chunks with dimension ${currentDim}`);
    } catch {
      // session_memory_chunks table may not exist yet — safe to ignore
    }

    // Save new dimension to config
    const { saveMemoryConfig } = await import('./config');
    saveMemoryConfig({ embeddingDim: currentDim });

    // Trigger background reindex (non-blocking)
    const { getEmbedOptions } = await import('./config');
    reindexMemories(getEmbedOptions(config), true).catch((err) => {
      logger.warn(`Background reindex after dimension change failed: ${err}`);
    });
  }
}

// ── Pin / Unpin (v2) ──

/**
 * Pin a memory so it never decays.
 * Stores original type/decay rate in metadata for unpin restoration.
 */
export function pinMemory(id: string): Memory | null {
  const db = getDatabase();
  const memory = getMemory(id);
  if (!memory) return null;

  // Store original type/rate so unpin can restore them
  const meta = memory.metadata ?? {};
  if (memory.memoryType !== 'pinned') {
    meta._originalType = memory.memoryType;
    meta._originalDecayRate = memory.decayRate;
  }

  db.prepare(
    `
    UPDATE memories
    SET memory_type = 'pinned',
        decay_rate = 0,
        metadata = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(JSON.stringify(meta), id);

  const pinned = getMemory(id);
  if (pinned) mirrorMemoryAsync(pinned);
  return pinned;
}

/**
 * Unpin a memory — restore its original type and decay rate.
 */
export function unpinMemory(id: string): Memory | null {
  const db = getDatabase();
  const memory = getMemory(id);
  if (!memory || memory.memoryType !== 'pinned') return memory;

  const meta = memory.metadata ?? {};
  const originalType = (meta._originalType as string) || 'semantic';
  const originalRate = (meta._originalDecayRate as number) ?? 0.023;

  // Clean up restoration metadata
  delete meta._originalType;
  delete meta._originalDecayRate;
  const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;

  db.prepare(
    `
    UPDATE memories
    SET memory_type = ?,
        decay_rate = ?,
        metadata = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(originalType, originalRate, metaStr, id);

  const unpinned = getMemory(id);
  if (unpinned) mirrorMemoryAsync(unpinned);
  return unpinned;
}

// ── Entity Graph CRUD (v2) ──

export function createEntity(input: {
  name: string;
  entityType: MemoryEntity['entityType'];
  summary?: string;
  metadata?: Record<string, unknown>;
}): MemoryEntity {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(
    `
    INSERT INTO memory_entities (id, name, entity_type, summary, metadata)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    input.name,
    input.entityType,
    input.summary ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
  );

  return getEntity(id)!;
}

export function getEntity(id: string): MemoryEntity | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM memory_entities WHERE id = ?')
    .get(id) as MemoryEntityRow | undefined;
  return row ? rowToEntity(row) : null;
}

export function findEntityByName(name: string): MemoryEntity | null {
  const db = getDatabase();
  // Case-insensitive exact match
  const row = db
    .prepare(
      'SELECT * FROM memory_entities WHERE LOWER(name) = LOWER(?) LIMIT 1',
    )
    .get(name) as MemoryEntityRow | undefined;
  return row ? rowToEntity(row) : null;
}

export function listEntities(options?: {
  entityType?: MemoryEntity['entityType'];
  limit?: number;
  offset?: number;
}): MemoryEntity[] {
  const db = getDatabase();
  const { entityType, limit = 50, offset = 0 } = options ?? {};

  let sql = 'SELECT * FROM memory_entities';
  const params: unknown[] = [];

  if (entityType) {
    sql += ' WHERE entity_type = ?';
    params.push(entityType);
  }

  sql += ' ORDER BY last_seen_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as MemoryEntityRow[];
  return rows.map(rowToEntity);
}

export function updateEntityMention(id: string): void {
  const db = getDatabase();
  db.prepare(
    `
    UPDATE memory_entities
    SET mention_count = mention_count + 1,
        last_seen_at = datetime('now')
    WHERE id = ?
  `,
  ).run(id);
}

export function deleteEntity(id: string): boolean {
  const db = getDatabase();
  // CASCADE will delete edges via FK constraint
  const result = db.prepare('DELETE FROM memory_entities WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Entity Edge CRUD ──

export function createEntityEdge(input: {
  sourceEntityId: string;
  targetEntityId: string;
  relation: string;
  confidence?: number;
  validFrom?: string;
  sourceMemoryId?: string;
}): MemoryEntityEdge {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(
    `
    INSERT INTO memory_entity_edges
      (id, source_entity_id, target_entity_id, relation, confidence, valid_from, source_memory_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    input.sourceEntityId,
    input.targetEntityId,
    input.relation,
    input.confidence ?? 0.7,
    input.validFrom ?? null,
    input.sourceMemoryId ?? null,
  );

  return getEntityEdge(id)!;
}

export function getEntityEdge(id: string): MemoryEntityEdge | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM memory_entity_edges WHERE id = ?')
    .get(id) as MemoryEntityEdgeRow | undefined;
  return row ? rowToEntityEdge(row) : null;
}

export function getEntityEdges(entityId: string): MemoryEntityEdge[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM memory_entity_edges
       WHERE (source_entity_id = ? OR target_entity_id = ?)
         AND valid_until IS NULL
       ORDER BY created_at DESC`,
    )
    .all(entityId, entityId) as MemoryEntityEdgeRow[];
  return rows.map(rowToEntityEdge);
}

/**
 * Get the entity relationship graph for a given entity, traversing N hops.
 */
export function getEntityGraph(
  entityId: string,
  depth: number = 1,
): { entities: MemoryEntity[]; edges: MemoryEntityEdge[] } {
  const db = getDatabase();
  const visitedEntityIds = new Set<string>();
  const allEdges: MemoryEntityEdge[] = [];
  let frontier = [entityId];

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const newIds = frontier.filter((id) => !visitedEntityIds.has(id));
    if (newIds.length === 0) break;
    for (const id of newIds) visitedEntityIds.add(id);

    // Batch edge query for the entire frontier (avoids N+1)
    const placeholders = newIds.map(() => '?').join(',');
    const edgeRows = db
      .prepare(
        `SELECT * FROM memory_entity_edges
         WHERE (source_entity_id IN (${placeholders}) OR target_entity_id IN (${placeholders}))
           AND valid_until IS NULL`,
      )
      .all(...newIds, ...newIds) as MemoryEntityEdgeRow[];

    const nextFrontier: string[] = [];
    for (const row of edgeRows) {
      const edge = rowToEntityEdge(row);
      allEdges.push(edge);
      const neighbor = newIds.includes(edge.sourceEntityId)
        ? edge.targetEntityId
        : edge.sourceEntityId;
      if (!visitedEntityIds.has(neighbor)) {
        nextFrontier.push(neighbor);
      }
    }

    frontier = nextFrontier;
  }

  // Add leaf-node frontier entities
  for (const eid of frontier) visitedEntityIds.add(eid);

  // Batch entity lookup (avoids N+1)
  const allIds = [...visitedEntityIds];
  const entityPlaceholders = allIds.map(() => '?').join(',');
  const entityRows = db
    .prepare(
      `SELECT * FROM memory_entities WHERE id IN (${entityPlaceholders})`,
    )
    .all(...allIds) as MemoryEntityRow[];
  const entities = entityRows.map(rowToEntity);

  // Deduplicate edges by ID
  const uniqueEdges = [...new Map(allEdges.map((e) => [e.id, e])).values()];

  return { entities, edges: uniqueEdges };
}

// ── Consolidation Log ──

export function logConsolidationRun(entry: {
  memoriesReviewed: number;
  memoriesMerged: number;
  memoriesArchived: number;
  memoriesPruned: number;
  entitiesCreated: number;
  edgesCreated: number;
  durationMs: number;
}): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO memory_consolidation_log
      (id, memories_reviewed, memories_merged, memories_archived,
       memories_pruned, entities_created, edges_created, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    randomUUID(),
    entry.memoriesReviewed,
    entry.memoriesMerged,
    entry.memoriesArchived,
    entry.memoriesPruned,
    entry.entitiesCreated,
    entry.edgesCreated,
    entry.durationMs,
  );
}
