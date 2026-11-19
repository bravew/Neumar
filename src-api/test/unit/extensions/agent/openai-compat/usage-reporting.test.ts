import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig, AgentMessage } from '@/core/agent/types';

import { OpenAICompatAgent } from '@/extensions/agent/openai-compat';
import { executeTool } from '@/extensions/agent/openai-compat/tools';

vi.mock('@/extensions/agent/openai-compat/tools', () => ({
  executeTool: vi.fn(),
  getToolDefinitions: vi.fn(() => []),
}));

function stream(chunks: unknown[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

const toolCallChunk = {
  choices: [
    {
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a"}' },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 4, completion_tokens: 1 },
};

function makeLoop(
  create: ReturnType<typeof vi.fn>,
  controller: AbortController,
) {
  const agent = new OpenAICompatAgent({
    apiKey: 'test',
    model: 'test-model',
  } as AgentConfig);
  const client = { chat: { completions: { create } } };
  const session = { id: 'session-1', abortController: controller };
  return () =>
    (
      agent as unknown as {
        agenticLoop: (
          client: unknown,
          messages: unknown[],
          workDir: string,
          session: unknown,
        ) => AsyncGenerator<AgentMessage>;
      }
    ).agenticLoop(client, [{ role: 'user', content: 'hi' }], '/tmp', session);
}

describe('openai-compat usage reporting', () => {
  it('reports the accumulated usage when the run is stopped', async () => {
    const controller = new AbortController();
    vi.mocked(executeTool).mockImplementation(async () => {
      controller.abort();
      return { output: 'ok', isError: false };
    });
    const create = vi.fn(async () => stream([toolCallChunk]));
    const messages: AgentMessage[] = [];
    for await (const message of makeLoop(create, controller)()) {
      messages.push(message);
    }

    const result = messages.find((message) => message.type === 'result');
    expect(result?.usage).toMatchObject({
      input_tokens: 4,
      output_tokens: 1,
    });
  });

  it('reports the accumulated usage before an error propagates', async () => {
    vi.mocked(executeTool).mockResolvedValue({ output: 'ok', isError: false });
    const create = vi
      .fn()
      .mockResolvedValueOnce(stream([toolCallChunk]))
      .mockRejectedValueOnce(new Error('upstream died'));
    const controller = new AbortController();
    const messages: AgentMessage[] = [];

    await expect(
      (async () => {
        for await (const message of makeLoop(create, controller)()) {
          messages.push(message);
        }
      })(),
    ).rejects.toThrow('upstream died');

    const result = messages.find((message) => message.type === 'result');
    expect(result?.usage).toMatchObject({
      input_tokens: 4,
      output_tokens: 1,
    });
  });
});
