import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type { AgentMessage, OpenAICompatDialect } from '@/core/agent/types';

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ProviderTurnState {
  reasoningContent: string;
  content: string;
  toolCalls: Map<number, ProviderToolCall>;
}

export interface ProviderRequestOptions {
  reasoningEffort?: 'low' | 'high' | 'max';
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
}

export interface ProviderImageInput {
  data: string;
  mimeType: string;
}

export type ProviderAssistantEnvelope = Extract<
  ChatCompletionMessageParam,
  { role: 'assistant' }
> & { reasoning_content?: string };

export interface ChatProviderDialect {
  readonly id: OpenAICompatDialect;
  consumeDelta(delta: unknown, state: ProviderTurnState): AgentMessage[];
  buildUserMessage(
    text: string,
    images?: readonly ProviderImageInput[],
  ): ChatCompletionMessageParam;
  buildAssistantEnvelope(state: ProviderTurnState): ProviderAssistantEnvelope;
  requestOptions(options: ProviderRequestOptions): Record<string, unknown>;
}

export function buildImageUserMessage(
  text: string,
  images: readonly ProviderImageInput[],
): ChatCompletionMessageParam {
  if (images.length === 0) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      ...images.map((image) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${image.mimeType};base64,${image.data}` },
      })),
    ],
  };
}

export function appendProviderToolCalls(
  delta: Record<string, unknown>,
  state: ProviderTurnState,
): void {
  if (!Array.isArray(delta.tool_calls)) return;
  for (const rawCall of delta.tool_calls) {
    if (!rawCall || typeof rawCall !== 'object') continue;
    const call = rawCall as Record<string, unknown>;
    if (typeof call.index !== 'number') continue;
    const rawFunction =
      call.function && typeof call.function === 'object'
        ? (call.function as Record<string, unknown>)
        : {};
    const current = state.toolCalls.get(call.index);
    state.toolCalls.set(call.index, {
      id:
        typeof call.id === 'string'
          ? call.id
          : (current?.id ?? `call_${call.index}`),
      type: 'function',
      function: {
        name:
          typeof rawFunction.name === 'string'
            ? rawFunction.name
            : (current?.function.name ?? ''),
        arguments:
          (current?.function.arguments ?? '') +
          (typeof rawFunction.arguments === 'string'
            ? rawFunction.arguments
            : ''),
      },
    });
  }
}

export function createProviderTurnState(): ProviderTurnState {
  return { reasoningContent: '', content: '', toolCalls: new Map() };
}

export function normalizeOpenAIUsage(
  usage: unknown,
): AgentMessage['usage'] | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as Record<string, unknown>;
  const promptDetails =
    value.prompt_tokens_details &&
    typeof value.prompt_tokens_details === 'object'
      ? (value.prompt_tokens_details as Record<string, unknown>)
      : {};
  const completionDetails =
    value.completion_tokens_details &&
    typeof value.completion_tokens_details === 'object'
      ? (value.completion_tokens_details as Record<string, unknown>)
      : {};
  const read = (entry: unknown): number | undefined =>
    typeof entry === 'number' && Number.isFinite(entry) && entry >= 0
      ? entry
      : undefined;
  const normalized = {
    input_tokens: read(value.prompt_tokens),
    output_tokens: read(value.completion_tokens),
    reasoning_output_tokens: read(completionDetails.reasoning_tokens),
    cache_read_input_tokens: read(promptDetails.cached_tokens),
  };
  return Object.values(normalized).some((entry) => entry !== undefined)
    ? normalized
    : undefined;
}
