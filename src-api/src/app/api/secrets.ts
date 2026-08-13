/**
 * Secrets API Routes
 *
 * Endpoints for managing encrypted secrets.
 * Values are write-only — listing returns names only.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  deleteSecret,
  listSecretsWithHints,
  storeSecret,
} from '@/shared/security/secrets';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SecretsAPI');

export const secretsRoutes = new Hono();

// Env-var style: starts with a letter, followed by letters/digits/underscores only.
const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const storeSecretSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      SECRET_NAME_RE,
      'Name must start with a letter and contain only letters, digits, or underscores',
    ),
  value: z.string().min(1),
});

const secretNameParamSchema = z.object({
  name: z.string().regex(SECRET_NAME_RE),
});

/** GET /secrets — list secrets with last-4-char hints (values never returned) */
secretsRoutes.get('/', async (c) => {
  try {
    const secrets = await listSecretsWithHints();
    return c.json({ secrets });
  } catch (err) {
    logger.error('Failed to list secrets:', err);
    return c.json(
      { error: 'Failed to list secrets' },
      500 as ContentfulStatusCode,
    );
  }
});

/** POST /secrets — store a secret */
secretsRoutes.post('/', zValidator('json', storeSecretSchema), async (c) => {
  try {
    const { name, value } = c.req.valid('json');
    await storeSecret(name, value);
    return c.json({ success: true, name }, 201 as ContentfulStatusCode);
  } catch (err) {
    logger.error('Failed to store secret:', err);
    return c.json(
      { error: 'Failed to store secret' },
      500 as ContentfulStatusCode,
    );
  }
});

/** DELETE /secrets/:name — delete a secret */
secretsRoutes.delete(
  '/:name',
  zValidator('param', secretNameParamSchema),
  async (c) => {
    try {
      const { name } = c.req.valid('param');
      await deleteSecret(name);
      return c.json({ success: true });
    } catch (err) {
      logger.error('Failed to delete secret:', err);
      return c.json(
        { error: 'Failed to delete secret' },
        500 as ContentfulStatusCode,
      );
    }
  },
);
