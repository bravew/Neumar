/**
 * Workspace RAG API Routes
 *
 * Mounted at /rag — wraps the workspace indexer + searcher for the
 * Memory settings UI and any future Tauri-side watcher.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  clearWorkspaceIndex,
  getIndexSummary,
  indexWorkspace,
  openWorkspaceFile,
  searchWorkspace,
} from '@/shared/services/rag';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RagApi');

const rag = new Hono();

let indexingInFlight: Promise<unknown> | null = null;

const reindexSchema = z.object({
  prune: z.boolean().optional(),
  maxFiles: z.number().min(1).max(50_000).optional(),
  paths: z.array(z.string()).optional(),
  skipEmbedding: z.boolean().optional(),
});

rag.get('/status', (c) => {
  return c.json({
    summary: getIndexSummary(),
    busy: !!indexingInFlight,
  });
});

rag.post('/reindex', zValidator('json', reindexSchema), async (c) => {
  if (indexingInFlight) {
    return c.json({ error: 'Indexing already in progress' }, 409);
  }
  const body = c.req.valid('json');
  const promise = indexWorkspace({
    prune: body.prune ?? true,
    maxFiles: body.maxFiles,
    paths: body.paths,
    skipEmbedding: body.skipEmbedding,
  })
    .catch((err) => {
      logger.warn(`Reindex failed: ${err}`);
      throw err;
    })
    .finally(() => {
      indexingInFlight = null;
    });
  indexingInFlight = promise;
  try {
    const stats = await promise;
    return c.json({ stats });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

rag.delete('/index', (c) => {
  if (indexingInFlight) {
    return c.json({ error: 'Indexing in progress — wait first' }, 409);
  }
  const result = clearWorkspaceIndex();
  return c.json(result);
});

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().min(1).max(50).optional(),
  pathFilter: z.string().optional(),
});

rag.post('/search', zValidator('json', searchSchema), async (c) => {
  const body = c.req.valid('json');
  const results = await searchWorkspace(body.query, {
    limit: body.limit,
    pathFilter: body.pathFilter,
  });
  return c.json({ results });
});

const openSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().min(1).optional(),
  endLine: z.number().min(1).optional(),
  maxChars: z.number().min(100).max(50_000).optional(),
});

rag.post('/open', zValidator('json', openSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const lines =
      body.startLine && body.endLine && body.endLine >= body.startLine
        ? { start: body.startLine, end: body.endLine }
        : undefined;
    const result = await openWorkspaceFile(body.path, {
      lines,
      maxChars: body.maxChars,
    });
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }
});

export { rag as ragRoutes };
