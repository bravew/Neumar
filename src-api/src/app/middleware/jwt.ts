import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('JwtMiddleware');

const SKIP_PATHS = ['/auth/jwt', '/health'];

export const jwtMiddleware = createMiddleware(async (c, next) => {
  // Skip if WebUI auth is not enabled
  if (process.env.WEBUI_AUTH !== 'true') {
    return next();
  }

  // Skip auth paths and health checks
  const path = c.req.path;
  if (SKIP_PATHS.some((p) => path.startsWith(p))) {
    return next();
  }

  const secret = process.env.WEBUI_JWT_SECRET;
  if (!secret) {
    logger.warn(
      'WEBUI_AUTH=true but WEBUI_JWT_SECRET not set — blocking request',
    );
    return c.json({ error: 'Server misconfiguration' }, 500);
  }

  try {
    const jwtHandler = jwt({ secret, alg: 'HS256' });
    return jwtHandler(c, next);
  } catch (err) {
    logger.warn(
      'JWT verification failed:',
      err instanceof Error ? err.message : String(err),
    );
    return c.json({ error: 'Unauthorized' }, 401);
  }
});
