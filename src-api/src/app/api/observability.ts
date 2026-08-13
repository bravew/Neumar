import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import {
  getCostRollup,
  listTraceEvents,
  type CostGroupBy,
} from '@/shared/observability/trace';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ObservabilityAPI');

export const observabilityRoutes = new Hono();

const GROUP_BY = new Set<CostGroupBy>([
  'provider',
  'model',
  'agent',
  'profile',
  'day',
]);

observabilityRoutes.get('/tasks/:id/trace', (c) => {
  try {
    const taskId = c.req.param('id');
    const sinceEventId = c.req.query('since') || undefined;
    const limitRaw = c.req.query('limit');
    const limitParsed = limitRaw ? Number(limitRaw) : undefined;
    const limit = Number.isFinite(limitParsed) ? limitParsed : undefined;
    return c.json({
      events: listTraceEvents(taskId, { sinceEventId, limit }),
    });
  } catch (err) {
    logger.error('Failed to list trace events', err);
    return c.json({ error: 'Failed to list trace events' }, 500);
  }
});

observabilityRoutes.get('/tasks/:id/trace/subscribe', (c) => {
  const taskId = c.req.param('id');
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  return streamSSE(c, async (stream) => {
    const unsubscribe = taskEventBus.subscribe(`trace:${taskId}`, (message) => {
      stream
        .writeSSE({
          event: 'trace.event',
          data: JSON.stringify(message),
        })
        .catch(() => unsubscribe());
    });

    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ type: 'connected', taskId }),
    });

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          resolve();
        },
        { once: true },
      );
    });
  });
});

observabilityRoutes.get('/cost', (c) => {
  try {
    const groupByRaw = c.req.query('group_by') ?? 'provider';
    const groupBy = GROUP_BY.has(groupByRaw as CostGroupBy)
      ? (groupByRaw as CostGroupBy)
      : 'provider';
    return c.json(getCostRollup(c.req.query('range') ?? null, groupBy));
  } catch (err) {
    logger.error('Failed to load cost rollup', err);
    return c.json({ error: 'Failed to load cost rollup' }, 500);
  }
});
