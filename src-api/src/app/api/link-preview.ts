import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { getLinkPreview } from '@/shared/link-preview';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('LinkPreviewAPI');
const linkPreview = new Hono();

const LinkPreviewRequestSchema = z
  .object({
    url: z.string().url().max(4096),
  })
  .strict();

linkPreview.post(
  '/',
  zValidator('json', LinkPreviewRequestSchema),
  async (c) => {
    const { url } = c.req.valid('json');
    try {
      return c.json(await getLinkPreview(url));
    } catch (error) {
      logger.warn(
        `Failed to resolve link preview for ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return c.json({
        kind: 'unsupported' as const,
        url,
        reason: 'fetch-failed' as const,
      });
    }
  },
);

export { linkPreview as linkPreviewRoutes };
