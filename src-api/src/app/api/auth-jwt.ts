import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  getSetting,
  getWebuiSession,
  insertWebuiSession,
  markWebuiSessionUsed,
  revokeWebuiFamily,
  saveSetting,
} from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AuthJWT');

export const authJwtRoutes = new Hono();

const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

const setupSchema = z.object({ password: z.string().min(8) });
const loginSchema = z.object({ password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

function getSecret(): string {
  const secret = process.env.WEBUI_JWT_SECRET;
  if (!secret) throw new Error('WEBUI_JWT_SECRET not configured');
  return secret;
}

async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(password, 12);
}

async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(password, hash);
}

function getPasswordHash(): string | null {
  return getSetting('webui_password_hash') ?? null;
}

function setPasswordHash(hash: string): void {
  saveSetting('webui_password_hash', hash);
}

async function generateTokens(userId: string) {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await sign(
    { sub: userId, iat: now, exp: now + ACCESS_TOKEN_TTL },
    secret,
  );
  const family = crypto.randomUUID();
  const refreshToken = await sign(
    { sub: userId, family, iat: now, exp: now + REFRESH_TOKEN_TTL },
    secret,
  );
  const refreshExpiresAt = new Date(
    (now + REFRESH_TOKEN_TTL) * 1000,
  ).toISOString();
  return { accessToken, refreshToken, family, refreshExpiresAt };
}

authJwtRoutes.get('/status', async (c) => {
  const hash = getPasswordHash();
  return c.json({ configured: hash !== null });
});

authJwtRoutes.post('/setup', zValidator('json', setupSchema), async (c) => {
  try {
    const existing = getPasswordHash();
    if (existing) {
      return c.json(
        { error: 'Password already configured' },
        409 as ContentfulStatusCode,
      );
    }
    const { password } = c.req.valid('json');
    const hash = await hashPassword(password);
    setPasswordHash(hash);
    return c.json({ success: true });
  } catch (err) {
    logger.error('Setup failed:', err);
    return c.json({ error: 'Setup failed' }, 500 as ContentfulStatusCode);
  }
});

authJwtRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  try {
    const { password } = c.req.valid('json');
    const hash = getPasswordHash();
    if (!hash) {
      return c.json(
        { error: 'Not configured — run /auth/jwt/setup first' },
        401 as ContentfulStatusCode,
      );
    }
    const valid = await comparePassword(password, hash);
    if (!valid) {
      return c.json({ error: 'Invalid password' }, 401 as ContentfulStatusCode);
    }
    const { accessToken, refreshToken, family, refreshExpiresAt } =
      await generateTokens('local');
    insertWebuiSession(refreshToken, family, refreshExpiresAt);
    logger.info('WebUI login successful');
    return c.json({ accessToken, refreshToken });
  } catch (err) {
    logger.error('Login failed:', err);
    return c.json({ error: 'Login failed' }, 500 as ContentfulStatusCode);
  }
});

authJwtRoutes.post('/refresh', zValidator('json', refreshSchema), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json');
    const secret = getSecret();
    const payload = (await verify(refreshToken, secret, 'HS256')) as {
      sub: string;
      family: string;
    };
    const session = getWebuiSession(refreshToken);
    if (!session) {
      // Token not in DB — expired/cleaned or issued before session tracking was added
      return c.json(
        { error: 'Invalid or expired refresh token' },
        401 as ContentfulStatusCode,
      );
    }
    if (session.used) {
      // Token reuse detected — revoke the entire family to invalidate any stolen tokens
      logger.warn('Refresh token reuse detected — revoking family', {
        family: payload.family,
      });
      revokeWebuiFamily(payload.family);
      return c.json(
        { error: 'Token reuse detected — please log in again' },
        401 as ContentfulStatusCode,
      );
    }
    markWebuiSessionUsed(refreshToken);
    const {
      accessToken,
      refreshToken: newRefreshToken,
      family: newFamily,
      refreshExpiresAt,
    } = await generateTokens(payload.sub);
    insertWebuiSession(newRefreshToken, newFamily, refreshExpiresAt);
    logger.info('Token refreshed for user:', payload.sub);
    return c.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    logger.warn(
      'Token refresh failed:',
      err instanceof Error ? err.message : String(err),
    );
    return c.json(
      { error: 'Invalid or expired refresh token' },
      401 as ContentfulStatusCode,
    );
  }
});
