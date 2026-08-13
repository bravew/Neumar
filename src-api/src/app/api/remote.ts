/**
 * Web Remote (read-only) routes
 *
 * Surfaces a JWT-gated, observer-only view of running tasks for the
 * Phase 6.0 web remote UI. Mutating endpoints are explicitly blocked at
 * the route level — interactive remote control is deferred to Phase 6.1.
 */

import { Hono } from 'hono';
import { verify } from 'hono/jwt';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { getAllTasks } from '@/shared/db/operations';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RemoteRoutes');
const REMOTE_SSE_MAX_DURATION_MS = 30 * 60_000;
const REMOTE_SSE_HEARTBEAT_MS = 15_000;

export const remoteRoutes = new Hono();

remoteRoutes.use('*', async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return c.json(
      { error: 'Web Remote is read-only in 6.0' },
      405 as ContentfulStatusCode,
    );
  }
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const secret = process.env.WEBUI_JWT_SECRET;
  if (!token || !secret) {
    return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);
  }
  try {
    await verify(token, secret, 'HS256');
  } catch {
    return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);
  }
  return next();
});

remoteRoutes.get('/tasks', (c) => {
  const tasks = getAllTasks().slice(0, 100);
  return c.json({ tasks });
});

remoteRoutes.get('/messages/:taskId', (c) => {
  const taskId = c.req.param('taskId');
  return streamSSE(c, async (sse) => {
    let closed = false;
    let wakeFromSleep: () => void = () => {};
    const close = () => {
      closed = true;
      wakeFromSleep();
    };
    const deadline = Date.now() + REMOTE_SSE_MAX_DURATION_MS;
    const unsubscribe = taskEventBus.subscribe(taskId, (msg) => {
      if (closed) return;
      sse.writeSSE({ data: JSON.stringify(msg) }).catch(close);
      const type = (msg as { type?: string } | null)?.type;
      if (
        type === 'done' ||
        type === 'error' ||
        type === 'RUN_FINISHED' ||
        type === 'RUN_ERROR'
      ) {
        close();
      }
    });
    c.req.raw.signal?.addEventListener('abort', () => {
      close();
      unsubscribe();
    });
    try {
      while (!closed && Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, REMOTE_SSE_HEARTBEAT_MS);
          wakeFromSleep = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        if (!closed) {
          await sse.writeSSE({ event: 'heartbeat', data: '{}' }).catch(close);
        }
      }
    } finally {
      closed = true;
      unsubscribe();
      logger.debug(`Remote SSE closed for task ${taskId}`);
    }
  });
});
