import { readFile } from 'node:fs/promises';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import {
  contentTypeForSpritesheet,
  installCommunityPet,
  listCommunityPets,
  listCustomPets,
  readCustomPetSpritesheet,
} from '@/shared/pets/pet-registry';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PetsAPI');

// Slug regex from MEMORY.md (mirrors `sanitizePetId` shape): word-char start
// then word / dot / dash. Applied at every route boundary that takes an id
// so path-traversal patterns fail before any downstream handler runs.
const PET_ID_SCHEMA = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[\w][\w.-]*$/);

export const petsRoutes = new Hono();

petsRoutes.get('/custom', async (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.json(await listCustomPets({ baseUrl }));
});

petsRoutes.get('/community', async (c) => {
  const query = c.req.query();
  const page = parseIntegerQuery(query.page, 0);
  const limit = parseIntegerQuery(query.limit, 48);

  try {
    return c.json(await listCommunityPets({ page, limit }));
  } catch (error) {
    logger.error('Failed to list community pets:', error);
    return c.json(
      { error: 'Failed to load community pets' },
      502 as ContentfulStatusCode,
    );
  }
});

petsRoutes.post(
  '/community/install',
  zValidator(
    'json',
    z.object({
      id: PET_ID_SCHEMA,
      force: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const { id, force } = c.req.valid('json');
    const baseUrl = new URL(c.req.url).origin;

    try {
      const result = await installCommunityPet(id, { force });
      return c.json({
        ...result,
        pet: {
          ...result.pet,
          spritesheetUrl: `${baseUrl}/pets/custom/${encodeURIComponent(result.pet.id)}/spritesheet`,
        },
      });
    } catch (error) {
      logger.error('Failed to install community pet:', error);
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to install community pet',
        },
        502 as ContentfulStatusCode,
      );
    }
  },
);

petsRoutes.get(
  '/custom/:id/spritesheet',
  zValidator('param', z.object({ id: PET_ID_SCHEMA })),
  async (c) => {
    const { id } = c.req.valid('param');
    const sheet = await readCustomPetSpritesheet(id);
    if (!sheet) {
      return c.json({ error: 'Pet not found' }, 404 as ContentfulStatusCode);
    }

    try {
      const bytes = await readFile(sheet.absPath);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': contentTypeForSpritesheet(sheet.ext),
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      logger.error('Failed to read custom pet spritesheet:', error);
      return c.json(
        { error: 'Failed to read pet spritesheet' },
        500 as ContentfulStatusCode,
      );
    }
  },
);

function parseIntegerQuery(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
