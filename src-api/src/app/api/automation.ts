/**
 * Automation API Routes
 *
 * Hono routes for automation CRUD, execution, run history, and engine status.
 * Follows the pattern from agent.ts: zValidator + c.req.valid + c.json.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import * as engine from '@/shared/automation/engine';
import { on, off, type AutomationHookHandler } from '@/shared/automation/hooks';
import { getTemplate, getTemplates } from '@/shared/automation/templates';
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
} from '@/shared/automation/types';
import { enqueueTask, getQueueStats } from '@/shared/db/operations';
import { EnqueueTaskSchema } from '@/shared/db/schemas';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AutomationAPI');
const automation = new Hono();

// ============================================================================
// Webhook Endpoint (must be before parameterized routes)
// ============================================================================

automation.post('/hooks/:slug', async (c) => {
  const slug = c.req.param('slug');
  try {
    const response = await engine.handleWebhookRequest(slug, c.req.raw);
    return response;
  } catch (err) {
    logger.error('Webhook handler error:', err);
    return c.json({ success: false, error: 'Internal error' }, 500);
  }
});

// ============================================================================
// Engine Status (must be before parameterized routes)
// ============================================================================

automation.get('/status', (c) => {
  return c.json({ success: true, data: engine.getStatus() });
});

// ============================================================================
// Active Runs (must be before /:id routes to avoid "runs" being captured as :id)
// ============================================================================

automation.get('/runs/active', (c) => {
  return c.json({ success: true, data: engine.getActiveRuns() });
});

// ============================================================================
// Run by ID
// ============================================================================

automation.get('/runs/:runId', (c) => {
  const runId = c.req.param('runId');
  const run = engine.getRun(runId);
  if (!run) {
    return c.json({ success: false, error: 'Run not found' }, 404);
  }
  return c.json({ success: true, data: run });
});

// ============================================================================
// Cancel Run
// ============================================================================

automation.post('/runs/:runId/cancel', async (c) => {
  const runId = c.req.param('runId');
  try {
    await engine.cancel(runId);
    return c.json({ success: true, data: { runId, status: 'cancelled' } });
  } catch (err) {
    logger.error('Failed to cancel run:', err);
    return c.json({ success: false, error: errorMessage(err) }, 400);
  }
});

// ============================================================================
// Queue Status (must be before /:id to avoid "queue" being captured as :id)
// ============================================================================

automation.get('/queue/status', (c) => {
  const profileId = c.req.query('profileId');
  return c.json({ success: true, data: getQueueStats(profileId) });
});

// ============================================================================
// Enqueue Task
// ============================================================================

automation.post(
  '/queue/enqueue',
  zValidator('json', EnqueueTaskSchema),
  (c) => {
    const { taskId, profileId, priority } = c.req.valid('json');
    const success = enqueueTask(taskId, profileId, priority ?? 0);
    if (!success) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }
    return c.json({ success: true, data: { taskId, profileId } }, 202);
  },
);

// ============================================================================
// List Automations
// ============================================================================

automation.get('/', (c) => {
  return c.json({ success: true, data: engine.list() });
});

// ============================================================================
// Create Automation
// ============================================================================

automation.post('/', zValidator('json', CreateAutomationSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const result = await engine.create(body);
    return c.json({ success: true, data: result }, 201);
  } catch (err) {
    logger.error('Failed to create automation:', err);
    return c.json({ success: false, error: errorMessage(err) }, 400);
  }
});

// ============================================================================
// SSE Event Stream (MUST be before /:id to avoid parameter capture)
// ============================================================================

/**
 * SSE endpoint for real-time automation events.
 * The frontend connects to this to receive push notifications for:
 * - run:completed, run:failed (heartbeat/cron results)
 * - automation:expired, automation:budget_exhausted (lifecycle)
 * - run:delivery_suppressed (quiet heartbeat ticks)
 */
automation.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    const handler: AutomationHookHandler = async (payload) => {
      try {
        await stream.writeSSE({
          event: payload.event,
          data: JSON.stringify({
            event: payload.event,
            automationId: payload.automationId,
            runId: payload.runId,
            data: payload.data,
            timestamp: payload.timestamp,
          }),
        });
      } catch {
        // Client disconnected — will be cleaned up below
      }
    };

    // Subscribe to all events the frontend cares about
    const events = [
      'run:completed',
      'run:failed',
      'run:cancelled',
      'run:delivery_suppressed',
      'run:condition_not_met',
      'automation:expired',
      'automation:budget_exhausted',
      'automation:max_runs_reached',
      'automation:consecutive_failures',
    ] as const;

    for (const event of events) {
      on(event, handler);
    }

    // Send initial keepalive
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }) });

    // Keep connection alive with periodic heartbeat (every 30s)
    const keepalive = setInterval(async () => {
      try {
        await stream.writeSSE({ event: 'keepalive', data: '' });
      } catch {
        clearInterval(keepalive);
      }
    }, 30_000);

    // Wait for client disconnect
    try {
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    } finally {
      clearInterval(keepalive);
      for (const event of events) {
        off(event, handler);
      }
      logger.info('SSE client disconnected from automation events');
    }
  });
});

// ============================================================================
// Templates (MUST be before /:id to avoid parameter capture)
// ============================================================================

automation.get('/templates', (c) => {
  return c.json({ success: true, data: getTemplates() });
});

automation.get('/templates/:templateId', (c) => {
  const template = getTemplate(c.req.param('templateId'));
  if (!template) {
    return c.json({ success: false, error: 'Template not found' }, 404);
  }
  return c.json({ success: true, data: template });
});

// ============================================================================
// Get Automation by ID (parameterized — MUST be after /events, /templates)
// ============================================================================

automation.get('/:id', (c) => {
  const id = c.req.param('id');
  const result = engine.get(id);
  if (!result) {
    return c.json({ success: false, error: 'Automation not found' }, 404);
  }
  return c.json({ success: true, data: result });
});

// ============================================================================
// Update Automation
// ============================================================================

automation.put(
  '/:id',
  zValidator('json', UpdateAutomationSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    try {
      const result = await engine.update(id, body);
      return c.json({ success: true, data: result });
    } catch (err) {
      logger.error('Failed to update automation:', err);
      return c.json({ success: false, error: errorMessage(err) }, 400);
    }
  },
);

// ============================================================================
// Delete Automation
// ============================================================================

automation.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await engine.remove(id);
    return c.json({ success: true, data: { id } });
  } catch (err) {
    logger.error('Failed to delete automation:', err);
    return c.json({ success: false, error: errorMessage(err) }, 400);
  }
});

// ============================================================================
// Toggle Automation
// ============================================================================

automation.patch(
  '/:id/toggle',
  zValidator('json', z.object({ enabled: z.boolean() })),
  async (c) => {
    const id = c.req.param('id');
    const { enabled } = c.req.valid('json');
    try {
      const result = await engine.toggle(id, enabled);
      return c.json({ success: true, data: result });
    } catch (err) {
      logger.error('Failed to toggle automation:', err);
      return c.json({ success: false, error: errorMessage(err) }, 400);
    }
  },
);

// ============================================================================
// Trigger Manual Run
// ============================================================================

automation.post('/:id/run', async (c) => {
  const id = c.req.param('id');
  try {
    const run = engine.enqueue(id, 'manual');
    return c.json({ success: true, data: run }, 202);
  } catch (err) {
    logger.error('Failed to trigger run:', err);
    return c.json({ success: false, error: errorMessage(err) }, 400);
  }
});

// ============================================================================
// Run History for Automation
// ============================================================================

automation.get('/:id/runs', (c) => {
  const id = c.req.param('id');
  return c.json({ success: true, data: engine.getRuns(id) });
});

automation.delete(
  '/:id/runs',
  zValidator(
    'json',
    z.object({ runIds: z.array(z.string().uuid()).min(1).max(500) }),
  ),
  async (c) => {
    const { runIds } = c.req.valid('json');
    const deleted = engine.deleteRuns(runIds);
    return c.json({ success: true, deleted });
  },
);

export { automation as automationRoutes };
