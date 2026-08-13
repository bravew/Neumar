/**
 * Memory API Routes
 *
 * All routes under /memory — follows existing Hono patterns with Zod validation.
 * Provides CRUD, search, stats, and config endpoints.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  createMemory,
  createMemorySchema,
  deleteEmbedding,
  deleteMemory,
  getEmbedOptions,
  getLocalModelStatus,
  getMemory,
  getMemoryConfig,
  getMemoryCount,
  getMemoryStats,
  listEntities,
  listMemories,
  getEntityGraph,
  getMemoryDirectory,
  pinMemory,
  mirrorAllMemoriesToDisk,
  promoteMemories,
  saveMemoryConfig,
  searchMemories,
  searchMemorySchema,
  storeEmbedding,
  syncMemoryFilesFromDisk,
  triggerLocalModelDownload,
  unpinMemory,
  updateMemory,
  updateMemorySchema,
} from '@/shared/services/memory';
import type {
  LifecycleStatus,
  MemoryCategory,
  MemoryType,
  ScopeType,
} from '@/shared/services/memory';
import {
  ENTITY_TYPES,
  LIFECYCLE_STATUSES,
  MEMORY_CATEGORIES,
  MEMORY_TYPES,
  SCOPE_TYPES,
} from '@/shared/services/memory';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MemoryAPI');

const memory = new Hono();

// ── Fixed routes MUST be registered before parameterized /:id routes ──
// Hono matches in registration order; /:id would swallow /stats, /config, etc.

// GET /memory — list memories
memory.get('/', async (c) => {
  const category = c.req.query('category') as MemoryCategory | undefined;
  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 1000)
    : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const sortBy = (c.req.query('sortBy') ?? 'created_at') as
    | 'created_at'
    | 'importance'
    | 'category'
    | 'content';
  const sortOrder = (c.req.query('sortOrder') ?? 'desc') as 'asc' | 'desc';
  const search = c.req.query('search') || undefined;

  const rawMemoryType = c.req.query('memoryType');
  const memoryType = (MEMORY_TYPES as readonly string[]).includes(
    rawMemoryType ?? '',
  )
    ? (rawMemoryType as MemoryType)
    : undefined;
  const rawScopeType = c.req.query('scopeType');
  const scopeType = (SCOPE_TYPES as readonly string[]).includes(
    rawScopeType ?? '',
  )
    ? (rawScopeType as ScopeType)
    : undefined;
  const rawLifecycle = c.req.query('lifecycleStatus');
  const lifecycleStatus = (LIFECYCLE_STATUSES as readonly string[]).includes(
    rawLifecycle ?? '',
  )
    ? (rawLifecycle as LifecycleStatus)
    : undefined;

  const memories = listMemories({
    category,
    limit,
    offset,
    sortBy,
    sortOrder,
    search,
    memoryType,
    scopeType,
    lifecycleStatus,
  });
  const total = getMemoryCount({ category, search });
  return c.json({ memories, total });
});

// GET /memory/stats
memory.get('/stats', async (c) => {
  const stats = getMemoryStats();
  return c.json(stats);
});

// GET /memory/config
memory.get('/config', async (c) => {
  const config = getMemoryConfig();
  // Redact API key in response
  return c.json({
    ...config,
    embeddingApiKey: config.embeddingApiKey ? '***' : '',
  });
});

// POST /memory/config — update config (Zod-validated)
const memoryConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  autoCapture: z.boolean().optional(),
  autoRecall: z.boolean().optional(),
  embeddingProvider: z.enum(['local', 'openai', 'gemini']).optional(),
  embeddingApiKey: z.string().optional(),
  embeddingModel: z.string().optional(),
  maxMemories: z.number().int().min(1).optional(),
  captureMaxChars: z.number().int().min(10).optional(),
  recallLimit: z.number().int().min(1).max(50).optional(),
  recallThreshold: z.number().min(0).max(1).optional(),
  embeddingDim: z.number().int().min(1).optional(),
  llmCapture: z.boolean().optional(),
  llmCaptureInterval: z.number().int().min(1).optional(),
  sessionIndexing: z.boolean().optional(),
  // v2 fields
  decayEnabled: z.boolean().optional(),
  consolidationEnabled: z.boolean().optional(),
  entityExtractionEnabled: z.boolean().optional(),
  captureGuardLevel: z.enum(['strict', 'standard', 'relaxed']).optional(),
  // v3 fields (memdir-inspired)
  llmRerankEnabled: z.boolean().optional(),
  llmRerankModel: z.string().optional(),
  maxRecallTokens: z.number().int().min(0).optional(),
  journalMode: z.boolean().optional(),
});

memory.post(
  '/config',
  zValidator('json', memoryConfigUpdateSchema),
  async (c) => {
    const body = c.req.valid('json');
    saveMemoryConfig(body);
    return c.json({ success: true });
  },
);

// GET /memory/export — export all memories as JSON
memory.get('/export', async (c) => {
  const config = getMemoryConfig();

  // Paginated fetch to avoid loading entire table into memory at once
  const PAGE_SIZE = 500;
  const allMemories = [];
  let offset = 0;
  let page: ReturnType<typeof listMemories>;

  do {
    page = listMemories({ limit: PAGE_SIZE, offset });
    allMemories.push(...page);
    offset += PAGE_SIZE;
  } while (page.length === PAGE_SIZE);

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: { ...config, embeddingApiKey: '' }, // Redact API key
    memoryCount: allMemories.length,
    memories: allMemories.map((m) => ({
      content: m.content,
      category: m.category,
      importance: m.importance,
      source: m.source,
      createdAt: m.createdAt,
    })),
  };

  c.header('Content-Type', 'application/json');
  c.header(
    'Content-Disposition',
    `attachment; filename="memories-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  return c.json(exportData);
});

// GET /memory/reindex/status — check reindex progress
memory.get('/reindex/status', async (c) => {
  const { getReindexProgress } = await import('@/shared/services/memory/store');
  const progress = getReindexProgress();
  if (!progress) {
    return c.json({ status: 'idle' });
  }
  return c.json(progress);
});

// GET /memory/cache/stats — embedding cache statistics
memory.get('/cache/stats', async (c) => {
  const { getCacheStats } = await import('@/shared/services/memory/store');
  return c.json(getCacheStats());
});

// GET /memory/model/status — local embedding model status
memory.get('/model/status', async (c) => {
  return c.json(getLocalModelStatus());
});

// POST /memory/model/download — trigger local model download
memory.post('/model/download', async (c) => {
  triggerLocalModelDownload();
  return c.json({ status: 'started' }, 202);
});

// POST /memory/batch-delete — bulk delete memories
const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});

memory.post(
  '/batch-delete',
  zValidator('json', batchDeleteSchema),
  async (c) => {
    const { ids } = c.req.valid('json');

    // Wrap in a transaction for atomicity and performance (single disk sync)
    let deleted = 0;
    const { getDatabase } = await import('@/shared/db');
    const db = getDatabase();
    db.transaction(() => {
      for (const id of ids) {
        if (deleteMemory(id)) deleted++;
      }
    })();

    return c.json({ deleted, total: ids.length });
  },
);

// GET /memory/files/path — resolve the file-backed memory folder
memory.get('/files/path', async (c) => {
  return c.json({ path: getMemoryDirectory() });
});

// POST /memory/files/sync — reconcile SQLite rows with .neuma/memory/*.md
const memoryFileSyncSchema = z.object({
  pruneDeleted: z.boolean().optional(),
});

memory.post(
  '/files/sync',
  zValidator('json', memoryFileSyncSchema),
  async (c) => {
    const { pruneDeleted } = c.req.valid('json');
    const synced = await syncMemoryFilesFromDisk({ pruneDeleted });
    const mirrored = await mirrorAllMemoriesToDisk();
    return c.json({ mirrored, ...synced });
  },
);

// POST /memory/promote — consolidate selected memories into a durable topic note
const memoryPromoteSchema = z.object({
  title: z.string().min(1).max(160),
  memoryIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

memory.post('/promote', zValidator('json', memoryPromoteSchema), async (c) => {
  try {
    const promoted = promoteMemories(c.req.valid('json'));
    const config = getMemoryConfig();
    storeEmbedding(
      promoted.id,
      promoted.content,
      getEmbedOptions(config),
    ).catch((err) => {
      logger.warn(
        `Failed to store embedding for promoted memory ${promoted.id}: ${err}`,
      );
    });
    return c.json(promoted, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// POST /memory — create
memory.post('/', zValidator('json', createMemorySchema), async (c) => {
  const input = c.req.valid('json');
  const mem = createMemory({
    content: input.content,
    category: input.category,
    importance: input.importance,
    source: 'api',
    memoryType: input.memoryType,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    confidence: input.confidence,
    language: input.language,
    visibility: input.visibility,
  });

  // Store embedding (non-blocking — failure is non-fatal)
  const config = getMemoryConfig();
  storeEmbedding(mem.id, input.content, getEmbedOptions(config)).catch(
    (err) => {
      logger.warn(`Failed to store embedding for memory ${mem.id}: ${err}`);
    },
  );

  return c.json(mem, 201);
});

// POST /memory/search — hybrid search
memory.post('/search', zValidator('json', searchMemorySchema), async (c) => {
  const input = c.req.valid('json');
  const config = getMemoryConfig();

  try {
    const results = await searchMemories(input.query, {
      limit: input.limit,
      threshold: input.threshold,
      category: input.category,
      embedOptions: getEmbedOptions(config),
    });
    return c.json({ results });
  } catch (err) {
    logger.warn(`Search failed: ${err}`);
    return c.json({ results: [], error: 'Search failed' }, 500);
  }
});

// POST /memory/reindex — force re-embedding (runs in background)
memory.post('/reindex', async (c) => {
  const config = getMemoryConfig();
  const force = c.req.query('force') === 'true';

  try {
    const { reindexMemories, getReindexProgress } =
      await import('@/shared/services/memory/store');

    // If a reindex is already running, report it
    const current = getReindexProgress();
    if (current?.status === 'running') {
      return c.json({ error: 'Reindex already in progress' }, 409);
    }

    // Fire-and-forget — client polls GET /memory/reindex/status
    reindexMemories(getEmbedOptions(config), force).catch((err) => {
      logger.warn(`Background reindex failed: ${err}`);
    });

    return c.json(
      {
        status: 'started',
        message:
          'Reindex started. Poll GET /memory/reindex/status for progress.',
      },
      202,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// POST /memory/import — import memories from JSON (Zod-validated envelope)
const memoryImportSchema = z.object({
  memories: z
    .array(
      z.object({
        content: z.string().min(1).max(10_000),
        category: z.string().optional(),
        importance: z.number().min(0).max(1).optional(),
        source: z.string().optional(),
        createdAt: z.string().optional(),
      }),
    )
    .max(10_000),
});

memory.post('/import', zValidator('json', memoryImportSchema), async (c) => {
  const body = c.req.valid('json');
  const config = getMemoryConfig();
  const { createHash } = await import('node:crypto');
  let imported = 0;
  let skipped = 0;

  // Fast dedup: build a set of existing content hashes to avoid O(n) embedding calls
  const { getDatabase } = await import('@/shared/db');
  const db = getDatabase();
  const existingHashes = new Set<string>();
  const rows = db.prepare('SELECT content FROM memories').all() as {
    content: string;
  }[];
  for (const row of rows) {
    existingHashes.add(createHash('sha256').update(row.content).digest('hex'));
  }

  for (const item of body.memories) {
    // Fast content-hash dedup (avoids expensive embedding calls)
    const hash = createHash('sha256').update(item.content).digest('hex');
    if (existingHashes.has(hash)) {
      skipped++;
      continue;
    }

    try {
      const mem = createMemory({
        content: item.content,
        category: (item.category as MemoryCategory) || 'other',
        importance: item.importance ?? 0.7,
        source: 'api',
      });

      existingHashes.add(hash); // Prevent duplicates within the same import batch

      // Store embedding (non-blocking — log failures for diagnostics)
      storeEmbedding(mem.id, item.content, getEmbedOptions(config)).catch(
        (err) => {
          logger.warn(`Import: failed to embed memory ${mem.id}: ${err}`);
        },
      );
      imported++;
    } catch {
      skipped++;
    }
  }

  return c.json({
    success: true,
    imported,
    skipped,
    total: body.memories.length,
  });
});

// ── v2 routes (entities, pin, consolidation, analytics) ──

// GET /memory/entities — list entities
memory.get('/entities', async (c) => {
  const rawType = c.req.query('type');
  const entityType = (ENTITY_TYPES as readonly string[]).includes(rawType ?? '')
    ? (rawType as
        | 'person'
        | 'project'
        | 'technology'
        | 'organization'
        | 'concept')
    : undefined;
  const rawLim = parseInt(c.req.query('limit') ?? '50', 10);
  const rawOff = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Number.isFinite(rawLim)
    ? Math.min(Math.max(rawLim, 1), 1000)
    : 50;
  const offset = Number.isFinite(rawOff) ? Math.max(rawOff, 0) : 0;

  const entities = listEntities({ entityType, limit, offset });
  return c.json({ entities, total: entities.length });
});

// GET /memory/entities/:id/graph — entity relationship graph
memory.get('/entities/:id/graph', async (c) => {
  const id = c.req.param('id');
  const depth = parseInt(c.req.query('depth') ?? '1', 10);

  const graph = getEntityGraph(id, Math.min(depth, 3));
  return c.json(graph);
});

// POST /memory/entities/extract — force entity extraction from recent memories
memory.post('/entities/extract', async (c) => {
  return c.json(
    {
      error:
        'Entity extraction requires an LLM callback — use the MCP tool instead',
    },
    501,
  );
});

// POST /memory/:id/pin — pin a memory
memory.post('/:id/pin', async (c) => {
  const id = c.req.param('id');
  const mem = pinMemory(id);
  if (!mem) return c.json({ error: 'Not found' }, 404);
  return c.json(mem);
});

// POST /memory/:id/unpin — unpin a memory
memory.post('/:id/unpin', async (c) => {
  const id = c.req.param('id');
  const mem = unpinMemory(id);
  if (!mem) return c.json({ error: 'Not found' }, 404);
  return c.json(mem);
});

// POST /memory/consolidate — trigger consolidation run
memory.post('/consolidate', async (c) => {
  return c.json(
    {
      error:
        'Consolidation requires an LLM callback — use the settings UI or startup scheduling',
    },
    501,
  );
});

// GET /memory/analytics — memory system analytics
memory.get('/analytics', async (c) => {
  const stats = getMemoryStats();
  const { getDatabase } = await import('@/shared/db');
  const db = getDatabase();

  // Consolidation log
  let lastConsolidation = null;
  try {
    const row = db
      .prepare(
        'SELECT * FROM memory_consolidation_log ORDER BY run_at DESC LIMIT 1',
      )
      .get() as
      | {
          run_at: string;
          memories_reviewed: number;
          memories_merged: number;
          memories_archived: number;
          duration_ms: number;
        }
      | undefined;
    if (row) {
      lastConsolidation = {
        runAt: row.run_at,
        memoriesReviewed: row.memories_reviewed,
        memoriesMerged: row.memories_merged,
        memoriesArchived: row.memories_archived,
        durationMs: row.duration_ms,
      };
    }
  } catch {
    // Table may not exist yet
  }

  // Entity stats
  let entityStats = {
    totalEntities: 0,
    totalEdges: 0,
    byType: {} as Record<string, number>,
  };
  try {
    const entityCount = (
      db.prepare('SELECT COUNT(*) as count FROM memory_entities').get() as {
        count: number;
      }
    ).count;
    const edgeCount = (
      db.prepare('SELECT COUNT(*) as count FROM memory_entity_edges').get() as {
        count: number;
      }
    ).count;
    const entityTypeRows = db
      .prepare(
        'SELECT entity_type, COUNT(*) as count FROM memory_entities GROUP BY entity_type',
      )
      .all() as { entity_type: string; count: number }[];

    const byType: Record<string, number> = {};
    for (const row of entityTypeRows) {
      byType[row.entity_type] = row.count;
    }
    entityStats = { totalEntities: entityCount, totalEdges: edgeCount, byType };
  } catch {
    // Tables may not exist yet
  }

  return c.json({
    ...stats,
    entities: entityStats,
    consolidation: { lastRun: lastConsolidation },
  });
});

// ── Parameterized routes MUST come last to avoid swallowing fixed paths ──

// GET /memory/:id
memory.get('/:id', async (c) => {
  const mem = getMemory(c.req.param('id'));
  if (!mem) return c.json({ error: 'Not found' }, 404);
  return c.json(mem);
});

// PUT /memory/:id — update
memory.put('/:id', zValidator('json', updateMemorySchema), async (c) => {
  const input = c.req.valid('json');
  const id = c.req.param('id');
  const mem = updateMemory(id, input);
  if (!mem) return c.json({ error: 'Not found' }, 404);

  // Re-embed when content changes (fire-and-forget)
  if (input.content) {
    const config = getMemoryConfig();
    const embedOptions = getEmbedOptions(config);
    deleteEmbedding(id)
      .then(() => storeEmbedding(id, input.content!, embedOptions))
      .catch((err) => {
        logger.warn(`Failed to re-embed memory ${id}: ${err}`);
      });
  }

  return c.json(mem);
});

// DELETE /memory/:id
memory.delete('/:id', async (c) => {
  const deleted = deleteMemory(c.req.param('id'));
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ── Recall audit (per-session provenance) ──
memory.get('/audit/:sessionId', async (c) => {
  const { listRecallAudit } = await import('@/shared/services/memory/audit');
  const sessionId = c.req.param('sessionId');
  const rawLimit = Number(c.req.query('limit'));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;
  const entries = listRecallAudit(sessionId, { limit });
  return c.json({ entries });
});

memory.delete('/audit/:sessionId', async (c) => {
  const { clearRecallAudit } = await import('@/shared/services/memory/audit');
  const cleared = clearRecallAudit(c.req.param('sessionId'));
  return c.json({ cleared });
});

export { memory as memoryRoutes };
