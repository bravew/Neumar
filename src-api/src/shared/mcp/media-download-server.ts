/**
 * The `download_media` tool the agent may call.
 *
 * The handler does not download. It records the request and returns a receipt
 * that names the batch; the host then asks the user where to save it. The
 * model cannot pass a path, a grant, or a CLI flag, so an unauthorized
 * destination is unrepresentable rather than merely rejected.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk/core';
import {
  DOWNLOAD_MEDIA_TOOL,
  downloadMediaInputSchema,
} from '@neumar/video-ir';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MediaDownloadMcp');

export const MEDIA_DOWNLOAD_SERVER_NAME = 'media-download';
const SERVER_TIMEOUT_MS = 60_000;

/** What the host records when the model asks for a batch. */
export interface DownloadRequestReceipt {
  batchId: string;
  status: 'awaiting_destination';
}

export type DownloadRequestHandler = (
  input: unknown,
) => DownloadRequestReceipt | Promise<DownloadRequestReceipt>;

/**
 * One `download_media` tool bound to one run. The result is a text block whose
 * body is the JSON receipt, which is what the host reads back from the
 * transcript to correlate the request with its tool call.
 */
export function createDownloadMediaMcpServer(handler: DownloadRequestHandler) {
  return createSdkMcpServer({
    name: MEDIA_DOWNLOAD_SERVER_NAME,
    version: '1.0.0',
    timeout: SERVER_TIMEOUT_MS,
    tools: [
      tool(
        DOWNLOAD_MEDIA_TOOL,
        'Download one or more web videos into the folder the user chooses. ' +
          'Returns a receipt and ends this turn; the user picks the destination next.',
        downloadMediaInputSchema.shape,
        async (args) => {
          try {
            const receipt = await handler(args);
            return {
              content: [
                { type: 'text' as const, text: JSON.stringify(receipt) },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            logger.warn('download_media request refused', { message });
            return {
              content: [{ type: 'text' as const, text: `refused: ${message}` }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
