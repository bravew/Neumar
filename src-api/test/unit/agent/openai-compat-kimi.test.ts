import { describe, expect, it } from 'vitest';

import { kimiK3Dialect } from '@/extensions/agent/openai-compat/dialects/kimi-k3';
import { createProviderTurnState } from '@/extensions/agent/openai-compat/dialects/types';
import { normalizeOpenAIUsage } from '@/extensions/agent/openai-compat/dialects/types';

describe('Kimi K3 OpenAI-compatible dialect', () => {
  it('streams reasoning separately and preserves the exact assistant envelope', () => {
    const state = createProviderTurnState();

    expect(
      kimiK3Dialect.consumeDelta(
        { reasoning_content: 'inspect ', content: null },
        state,
      ),
    ).toEqual([{ type: 'thinking', content: 'inspect ' }]);
    expect(
      kimiK3Dialect.consumeDelta(
        {
          reasoning_content: 'files',
          content: 'Done',
          tool_calls: [
            {
              index: 0,
              id: 'call-1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":' },
            },
          ],
        },
        state,
      ),
    ).toEqual([
      { type: 'thinking', content: 'files' },
      { type: 'text', content: 'Done' },
    ]);
    kimiK3Dialect.consumeDelta(
      {
        tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }],
      },
      state,
    );

    expect(kimiK3Dialect.buildAssistantEnvelope(state)).toEqual({
      role: 'assistant',
      reasoning_content: 'inspect files',
      content: 'Done',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"README.md"}' },
        },
      ],
    });
  });

  it('sends only K3-supported reasoning controls', () => {
    expect(kimiK3Dialect.requestOptions({ reasoningEffort: 'high' })).toEqual({
      reasoning_effort: 'high',
      stream_options: { include_usage: true },
    });
  });

  it('maps validated image input to a K3 data URL', () => {
    expect(
      kimiK3Dialect.buildUserMessage('Describe this image', [
        { data: 'aGVsbG8=', mimeType: 'image/png' },
      ]),
    ).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,aGVsbG8=' },
        },
      ],
    });
    expect(() =>
      kimiK3Dialect.buildUserMessage('bad image', [
        { data: 'aGVsbG8=', mimeType: 'image/svg+xml' },
      ]),
    ).toThrow(/does not support image type/);
  });

  it('maps strict structured output without sampling parameters', () => {
    expect(
      kimiK3Dialect.requestOptions({
        outputFormat: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
          },
        },
      }),
    ).toEqual({
      reasoning_effort: 'max',
      stream_options: { include_usage: true },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'neuma_response',
          schema: {
            type: 'object',
            properties: { answer: { type: 'string' } },
          },
          strict: true,
        },
      },
    });
  });

  it('normalizes reasoning and prefix-cache usage', () => {
    expect(
      normalizeOpenAIUsage({
        prompt_tokens: 120,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 100 },
        completion_tokens_details: { reasoning_tokens: 30 },
      }),
    ).toEqual({
      input_tokens: 120,
      output_tokens: 40,
      reasoning_output_tokens: 30,
      cache_read_input_tokens: 100,
    });
  });
});
