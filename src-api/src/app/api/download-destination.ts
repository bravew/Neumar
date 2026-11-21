/**
 * A folder the native picker returned, checked before the card submits it.
 *
 * The answer itself is validated again when the continuation claims its grant,
 * so this endpoint is a courtesy: it lets the card say "not allowed" while the
 * picker is still open instead of after a refused resume. It creates nothing
 * and grants nothing.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  bindDestination,
  destinationPolicy,
  DestinationDenied,
} from '@/shared/services/media-download/destination';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DownloadDestination');

const bodySchema = z.strictObject({
  taskId: z.string().min(1).max(256),
  path: z.string().min(1).max(4096),
});

export function downloadDestinationRoutes(): Hono {
  const app = new Hono();

  app.post('/downloads/destination', async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', code: 'invalid_request' }, 400);
    }
    try {
      // Never create the task's output folder from a probe.
      const grant = bindDestination(
        destinationPolicy(parsed.data.taskId),
        parsed.data.path,
        false,
      );
      return c.json({ directory: grant.directory });
    } catch (error) {
      const denied = error instanceof DestinationDenied;
      if (!denied) {
        logger.warn('Destination check failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return c.json(
        {
          error: denied
            ? error.message
            : 'This folder is unavailable or not permitted.',
          code: 'destination_denied',
        },
        403,
      );
    }
  });

  return app;
}
