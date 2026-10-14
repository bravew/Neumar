import { createMiddleware } from 'hono/factory';
import { jwt } from 'hono/jwt';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('JwtMiddleware');

export const requireJwt = createMiddleware(async (c, next) => {
  const secret = process.env.WEBUI_JWT_SECRET;
  if (!secret?.trim()) {
    logger.warn(
      'JWT authentication is required but WEBUI_JWT_SECRET is not set',
    );
    return c.json({ error: 'Authentication is not configured' }, 401);
  }
  return jwt({ secret, alg: 'HS256' })(c, next);
});

export const jwtMiddleware = createMiddleware(async (c, next) => {
  const remote = process.env.NEUMAR_REMOTE === 'true';
  if (!remote && process.env.WEBUI_AUTH !== 'true') return next();

  const path = c.req.path;
  const publicPath =
    path === '/health' ||
    path === '/health/' ||
    path === '/auth/jwt/status' ||
    path === '/auth/jwt/login' ||
    path === '/auth/jwt/refresh' ||
    (!remote && path === '/auth/jwt/setup');
  if (publicPath) return next();

  return requireJwt(c, next);
});
