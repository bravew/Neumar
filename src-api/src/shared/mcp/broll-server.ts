/**
 * Video b-roll acquisition MCP server.
 *
 * High-risk acquisition tools live outside the default video-edit surface so
 * the capability gate can register them only when a plugin/run has explicitly
 * been granted the matching capability.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  importYoutubeBroll,
  type YoutubeBrollRunner,
} from '@/shared/video/plugins/atoms/broll/youtube';

export const BROLL_TOOL_NAMES = ['youtube'] as const;

export interface BrollServerOptions {
  projectId?: string;
  youtubeCapabilityGranted?: boolean;
  youtubeRunner?: YoutubeBrollRunner;
  now?: () => Date;
}

const PROJECT_ID_SCHEMA = z
  .string()
  .min(1)
  .optional()
  .describe('Video project id. Defaults to the active session project.');

export function createBrollTools(options: BrollServerOptions = {}) {
  return [
    tool(
      'youtube',
      'Import a YouTube video as unverified b-roll after the run has the network:youtube capability and the user has acknowledged they have rights to use the source. The full source is stored locally with youtube-unverified provenance. Do not trim at import; picture duration owns the timeline.',
      {
        projectId: PROJECT_ID_SCHEMA,
        url: z.string().url(),
        maxDurationSec: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe(
            'Ignored. The full source is kept so later edits can use more of it.',
          ),
        format: z.enum(['mp4', 'best']).optional(),
        rightsAcknowledged: z.literal(true).optional(),
        persistRightsAck: z.boolean().optional(),
        rightsNotes: z.string().min(1).max(1000).optional(),
      },
      async (input) => {
        try {
          const projectId = input.projectId ?? options.projectId;
          if (!projectId) {
            throw new Error('Video project id is required.');
          }
          const result = await importYoutubeBroll(
            projectId,
            {
              url: input.url,
              ...(input.maxDurationSec
                ? { maxDurationSec: input.maxDurationSec }
                : {}),
              ...(input.format ? { format: input.format } : {}),
              rightsAcknowledged: input.rightsAcknowledged,
              persistRightsAck: input.persistRightsAck,
              rightsNotes: input.rightsNotes,
            },
            {
              capabilityGranted: options.youtubeCapabilityGranted,
              runner: options.youtubeRunner,
              now: options.now,
            },
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  projectId,
                  assetId: result.asset.id,
                  sourceId: result.source.id,
                  provenance: result.asset.provenance,
                }),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    ),
  ];
}

export function createBrollMcpServer(options: BrollServerOptions = {}) {
  return createSdkMcpServer({
    name: 'broll',
    version: '0.1.0',
    tools: createBrollTools(options),
  });
}
