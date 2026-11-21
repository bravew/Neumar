/**
 * The download tool's per-run attachment.
 *
 * A model turn asks for a batch and then ends: the tool returns a receipt, the
 * host records the request, and the question card takes over. Nothing is
 * downloaded until the user's answer starts the continuation, so an
 * unanswered, cancelled or denied request starts nothing.
 *
 * MCP has no portable provider tool-call id, so the receipt (a single-use
 * batch id minted by this attachment) is paired with the adapter's actual tool
 * result id. Never with a URL or "the most recent call": calls may overlap.
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import {
  DOWNLOAD_MEDIA_TOOL,
  downloadMediaInputSchema,
  type DownloadMediaInput,
} from '@neumar/video-ir';
import { z } from 'zod';

import type { AgentMessage, AgentProvider } from '@/core/agent/types';
import type { BridgeInProcessServer } from '@/core/agent/types';

import {
  createDownloadMediaMcpServer,
  MEDIA_DOWNLOAD_SERVER_NAME,
  type DownloadRequestReceipt,
} from '@/shared/mcp/media-download-server';
import {
  ffmpegSkillTransportFor,
  type FfmpegSkillTransport,
} from '@/shared/services/ffmpeg-skill/handoff';

import {
  requestDownloadDestination,
  type DestinationRequest,
} from './requests';

const receiptSchema = z.strictObject({
  batchId: z.uuid(),
  status: z.literal('awaiting_destination'),
});
const textBlocks = z.tuple([
  z.object({ type: z.literal('text'), text: z.string() }),
]);

/** The batch id in a tool result this attachment produced, if any. */
export function downloadReceiptId(output: unknown): string | undefined {
  if (typeof output !== 'string' || output.length > 2048) return undefined;
  try {
    const parsed: unknown = JSON.parse(output);
    const blocks = textBlocks.safeParse(parsed);
    const receipt = receiptSchema.safeParse(
      blocks.success ? JSON.parse(blocks.data[0].text) : parsed,
    );
    return receipt.success ? receipt.data.batchId : undefined;
  } catch {
    return undefined;
  }
}

export interface DownloadAttachmentScope {
  taskId: string;
  sessionId: string;
  runId: string;
  language?: string;
}

export interface DownloadAttachment {
  transport: FfmpegSkillTransport;
  /** Claude SDK in-process config, when the provider mounts it directly. */
  inProcessMcpServers?: Record<string, McpServerConfig>;
  /** Subprocess loopback-bridge entry, when the provider uses the bridge. */
  bridgeInProcessServers?: BridgeInProcessServer[];
  /** Appended to the run's system context; '' when downloads are unavailable. */
  systemContext: string;
  /** Correlates tool results with their receipts and records the request. */
  observe(message: AgentMessage): AsyncGenerator<AgentMessage>;
}

const DOWNLOAD_INSTRUCTIONS =
  'To save web videos for the user, call the managed `download_media` tool with the ' +
  'URLs. It returns a receipt and the user chooses a folder next: after the receipt, ' +
  'end this turn. Do not choose a path, retry the call, or claim a download finished.';

/**
 * A new attachment per agent run. Requests are held in memory only until their
 * tool result arrives; the grant and the question are the durable record.
 */
export function createTaskDownloadAttachment(
  scope: DownloadAttachmentScope,
  provider: AgentProvider | undefined,
): DownloadAttachment {
  const transport = ffmpegSkillTransportFor(provider);
  if (transport === 'unsupported') {
    return {
      transport,
      systemContext: '',
      observe: passthrough,
    };
  }

  const pending = new Map<string, DownloadMediaInput>();
  const calls = new Set<string>();

  const handler = (rawInput: unknown): DownloadRequestReceipt => {
    if (pending.size >= 20)
      throw new Error('Too many pending download batches.');
    const input = downloadMediaInputSchema.parse(rawInput);
    const batchId = crypto.randomUUID();
    pending.set(batchId, input);
    return { batchId, status: 'awaiting_destination' };
  };

  const observe = async function* (
    message: AgentMessage,
  ): AsyncGenerator<AgentMessage> {
    if (
      message.type === 'tool_use' &&
      message.id &&
      (message.name === DOWNLOAD_MEDIA_TOOL ||
        message.name ===
          `mcp__${MEDIA_DOWNLOAD_SERVER_NAME}__${DOWNLOAD_MEDIA_TOOL}`)
    ) {
      calls.add(message.id);
      // The transcript and history do not need the signed source URLs.
      yield { ...message, input: {} };
      return;
    }
    if (
      message.type === 'tool_use_args_delta' &&
      calls.has(message.id ?? message.toolUseId ?? '')
    ) {
      return;
    }
    if (
      message.type === 'tool_result' &&
      message.toolUseId &&
      calls.delete(message.toolUseId)
    ) {
      const batchId = message.isError
        ? undefined
        : downloadReceiptId(message.output);
      const input = batchId ? pending.get(batchId) : undefined;
      if (!batchId || !input) {
        pending.clear();
        yield {
          ...message,
          isError: true,
          output:
            'The download request could not be matched. No download started.',
        };
        return;
      }
      pending.delete(batchId);
      let request: DestinationRequest;
      try {
        request = requestDownloadDestination(
          {
            taskId: scope.taskId,
            sessionId: scope.sessionId,
            runId: scope.runId,
            toolCallId: message.toolUseId,
            batchId,
          },
          input,
          scope.language,
        );
      } catch (error) {
        yield {
          ...message,
          isError: true,
          output: `The download request was refused: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
        return;
      }
      // The tool result names the question that now holds the batch. The
      // question itself is delivered as an interrupt, not as this text.
      yield {
        ...message,
        output: JSON.stringify({
          batchId,
          status: 'awaiting_destination',
          questionId: request.questionId,
        }),
      };
      return;
    }
    yield message;
  };

  if (transport === 'in-process') {
    return {
      transport,
      inProcessMcpServers: {
        [MEDIA_DOWNLOAD_SERVER_NAME]: createDownloadMediaMcpServer(handler),
      },
      systemContext: DOWNLOAD_INSTRUCTIONS,
      observe,
    };
  }
  return {
    transport,
    bridgeInProcessServers: [
      {
        name: MEDIA_DOWNLOAD_SERVER_NAME,
        createServer: () => createDownloadMediaMcpServer(handler).instance,
      },
    ],
    systemContext: DOWNLOAD_INSTRUCTIONS,
    observe,
  };
}

async function* passthrough(
  message: AgentMessage,
): AsyncGenerator<AgentMessage> {
  yield message;
}
