/**
 * Graphify API Routes
 *
 * Mounted at /graphify. Wraps the runner so the Library "Knowledge Graph"
 * tab can trigger a rebuild and read the resulting graph.json /
 * GRAPH_REPORT.md without shelling out from the renderer.
 */

import { Hono } from 'hono';

import {
  getGraphifyStatus,
  readGraphJson,
  readGraphReport,
  rebuildGraph,
} from '@/shared/services/graphify/runner';

const graphify = new Hono();

graphify.get('/status', (c) => c.json(getGraphifyStatus()));

graphify.post('/rebuild', async (c) => {
  const immediate = c.req.query('immediate') === 'true';
  // Fire-and-await so the API caller can render a spinner.
  await rebuildGraph({ immediate });
  return c.json(getGraphifyStatus());
});

graphify.get('/report', async (c) => {
  const text = await readGraphReport();
  if (!text) return c.json({ error: 'No report available' }, 404);
  return c.body(text, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

graphify.get('/graph', async (c) => {
  const json = await readGraphJson();
  if (!json) return c.json({ error: 'No graph.json available' }, 404);
  return c.json(json);
});

export { graphify as graphifyRoutes };
