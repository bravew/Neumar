import type { AgentMessage } from '@/core/agent/types';

import type {
  ChatProviderDialect,
  ProviderAssistantEnvelope,
  ProviderRequestOptions,
  ProviderTurnState,
} from './types';
import { appendProviderToolCalls, buildImageUserMessage } from './types';

const KIMI_IMAGE_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const KIMI_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const kimiK3Dialect: ChatProviderDialect = {
  id: 'kimi-k3',
  buildUserMessage(text, images = []) {
    for (const image of images) {
      if (!KIMI_IMAGE_TYPES.has(image.mimeType)) {
        throw new Error(
          `Kimi K3 does not support image type ${image.mimeType}`,
        );
      }
      const estimatedBytes = Math.floor((image.data.length * 3) / 4);
      if (estimatedBytes > KIMI_MAX_IMAGE_BYTES) {
        throw new Error('Kimi K3 image input exceeds the 20 MB limit');
      }
    }
    return buildImageUserMessage(text, images);
  },
  consumeDelta(delta: unknown, state: ProviderTurnState): AgentMessage[] {
    if (!delta || typeof delta !== 'object') return [];
    const record = delta as Record<string, unknown>;
    const messages: AgentMessage[] = [];
    if (typeof record.reasoning_content === 'string') {
      state.reasoningContent += record.reasoning_content;
      messages.push({ type: 'thinking', content: record.reasoning_content });
    }
    if (typeof record.content === 'string') {
      state.content += record.content;
      messages.push({ type: 'text', content: record.content });
    }
    appendProviderToolCalls(record, state);
    return messages;
  },
  buildAssistantEnvelope(state: ProviderTurnState): ProviderAssistantEnvelope {
    const toolCalls = [...state.toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call);
    return {
      role: 'assistant',
      reasoning_content: state.reasoningContent,
      content: state.content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  },
  requestOptions(options: ProviderRequestOptions): Record<string, unknown> {
    return {
      reasoning_effort: options.reasoningEffort ?? 'max',
      stream_options: { include_usage: true },
      ...(options.outputFormat
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'neuma_response',
                schema: options.outputFormat.schema,
                strict: true,
              },
            },
          }
        : {}),
    };
  },
};
