import type { AgentMessage } from '@/core/agent/types';

import type {
  ChatProviderDialect,
  ProviderAssistantEnvelope,
  ProviderTurnState,
} from './types';
import { appendProviderToolCalls, buildImageUserMessage } from './types';

export const standardDialect: ChatProviderDialect = {
  id: 'standard',
  buildUserMessage(text, images = []) {
    return buildImageUserMessage(text, images);
  },
  consumeDelta(delta: unknown, state: ProviderTurnState): AgentMessage[] {
    if (!delta || typeof delta !== 'object') return [];
    const record = delta as Record<string, unknown>;
    const messages: AgentMessage[] = [];
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
      content: state.content || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  },
  requestOptions(): Record<string, unknown> {
    return {};
  },
};
