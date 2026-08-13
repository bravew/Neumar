/**
 * Agent Runtimes API
 *
 * Detection, install/update guidance, and gated install/update operations
 * for supported code-agent CLIs. See doc-dev/plan/2026-05-02-agent-runtime-detection-install-update.md.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  cancelOperation,
  catalog,
  buildRuntimeConnectionTestResult,
  describeOptions,
  detectAgent,
  detectAgents,
  getOperation,
  invalidateDetectionCache,
  startOperation,
} from '@/shared/agent-runtimes';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AgentRuntimesAPI');
const agentRuntimes = new Hono();

const StartSchema = z.object({
  method: z.string().min(1).max(80),
  confirmedCommandHash: z.string().regex(/^[a-f0-9]{64}$/),
});

agentRuntimes.get('/', async (c) => {
  try {
    const runtimes = await detectAgents();
    return c.json({
      success: true,
      runtimes,
      catalog: catalog(),
      platform: process.platform,
    });
  } catch (err) {
    logger.error('detectAgents failed:', err);
    return c.json({ success: false, error: errorMessage(err) }, 500);
  }
});

agentRuntimes.post('/rescan', async (c) => {
  try {
    invalidateDetectionCache();
    const runtimes = await detectAgents({ force: true });
    return c.json({
      success: true,
      runtimes,
      catalog: catalog(),
      platform: process.platform,
    });
  } catch (err) {
    logger.error('rescan failed:', err);
    return c.json({ success: false, error: errorMessage(err) }, 500);
  }
});

agentRuntimes.get('/operations', (c) => {
  // Listing is intentionally not exposed broadly; restrict to the lookup
  // endpoint below to avoid leaking historical operations metadata.
  return c.json(
    { success: false, error: 'Use /agent-runtimes/operations/:id' },
    404,
  );
});

agentRuntimes.get('/operations/:id', (c) => {
  const id = c.req.param('id');
  const record = getOperation(id);
  if (!record) {
    return c.json({ success: false, error: 'operation not found' }, 404);
  }
  return c.json({ success: true, operation: record });
});

agentRuntimes.delete('/operations/:id', (c) => {
  const id = c.req.param('id');
  const ok = cancelOperation(id);
  if (!ok) {
    return c.json(
      { success: false, error: 'operation not cancellable or not found' },
      404,
    );
  }
  return c.json({ success: true, cancelled: true });
});

agentRuntimes.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const status = await detectAgent(id);
    if (!status) {
      return c.json({ success: false, error: 'agent not found' }, 404);
    }
    return c.json({ success: true, runtime: status });
  } catch (err) {
    logger.error(`detectAgent(${id}) failed:`, err);
    return c.json({ success: false, error: errorMessage(err) }, 500);
  }
});

agentRuntimes.post('/:id/test-connection', async (c) => {
  const id = c.req.param('id');
  try {
    const status = await detectAgent(id);
    if (!status) {
      return c.json({ success: false, error: 'agent not found' }, 404);
    }
    return c.json({
      success: true,
      result: buildRuntimeConnectionTestResult(status),
    });
  } catch (err) {
    logger.error(`test connection for ${id} failed:`, err);
    return c.json({ success: false, error: errorMessage(err) }, 500);
  }
});

agentRuntimes.get('/:id/install-options', (c) => {
  const id = c.req.param('id');
  const options = describeOptions(id, 'install');
  if (options === null) {
    return c.json({ success: false, error: 'agent not found' }, 404);
  }
  return c.json({ success: true, options, platform: process.platform });
});

agentRuntimes.get('/:id/update-options', (c) => {
  const id = c.req.param('id');
  const options = describeOptions(id, 'update');
  if (options === null) {
    return c.json({ success: false, error: 'agent not found' }, 404);
  }
  return c.json({ success: true, options, platform: process.platform });
});

agentRuntimes.post(
  '/:id/install',
  zValidator('json', StartSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const result = startOperation({
      agentId: id,
      intent: 'install',
      optionId: body.method,
      confirmedCommandHash: body.confirmedCommandHash,
    });
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, result.status);
    }
    return c.json({ success: true, operation: result.operation }, 202);
  },
);

agentRuntimes.post(
  '/:id/update',
  zValidator('json', StartSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const result = startOperation({
      agentId: id,
      intent: 'update',
      optionId: body.method,
      confirmedCommandHash: body.confirmedCommandHash,
    });
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, result.status);
    }
    return c.json({ success: true, operation: result.operation }, 202);
  },
);

export { agentRuntimes as agentRuntimesRoutes };
