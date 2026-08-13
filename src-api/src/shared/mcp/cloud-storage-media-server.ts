import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  clusterMediaByEvent,
  getPeopleFromMedia,
} from '@/shared/integrations/cloud-storage/personal-media/media-tools';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CloudStorageMediaMCP');

const geoSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    placeName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  })
  .optional();

const mediaItemSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mediaMetadata: z
    .object({
      takenAt: z.string().optional(),
      geo: geoSchema,
      people: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            confidence: z.number().optional(),
            isHidden: z.boolean().optional(),
            isFavorite: z.boolean().optional(),
          }),
        )
        .optional(),
      tags: z.array(z.object({ id: z.string(), value: z.string() })).optional(),
      description: z.string().optional(),
      isFavorite: z.boolean().optional(),
      rating: z.number().optional(),
    })
    .optional(),
});

export const CLOUD_STORAGE_MEDIA_TOOL_NAMES = [
  'cloud_storage_cluster_by_event',
  'cloud_storage_get_people',
] as const;

export const cloudStorageMediaTools = [
  tool(
    'cloud_storage_cluster_by_event',
    'Cluster personal-media items into likely events using takenAt timestamps and optional geo proximity. Pass CloudFile-like items with mediaMetadata from cloud-storage search/list results.',
    {
      items: z.array(mediaItemSchema),
      max_gap_hours: z.number().min(1).max(48).optional(),
      max_distance_km: z.number().min(1).max(500).optional(),
    },
    async ({ items, max_gap_hours, max_distance_km }) => {
      try {
        const clusters = clusterMediaByEvent(items, {
          maxGapHours: max_gap_hours,
          maxDistanceKm: max_distance_km,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ clusters }, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.warn('cloud_storage_cluster_by_event failed', err);
        return {
          content: [{ type: 'text' as const, text: errorMessage(err) }],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
  tool(
    'cloud_storage_get_people',
    'Summarize people detected in personal-media items. Pass CloudFile-like items with mediaMetadata.people from cloud-storage search/list results.',
    {
      items: z.array(mediaItemSchema),
    },
    async ({ items }) => {
      try {
        const people = getPeopleFromMedia(items);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ people }, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.warn('cloud_storage_get_people failed', err);
        return {
          content: [{ type: 'text' as const, text: errorMessage(err) }],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
];

export function createCloudStorageMediaMcpServer() {
  return createSdkMcpServer({
    name: 'cloud-storage-media',
    version: '1.0.0',
    tools: cloudStorageMediaTools,
  });
}
