import { describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent';

import { withSafeRunRetry } from '@/shared/services/agent';

async function collect(stream: AsyncIterable<AgentMessage>) {
  const messages: AgentMessage[] = [];
  for await (const message of stream) messages.push(message);
  return messages;
}

describe('withSafeRunRetry', () => {
  it('retries one transient failure before output and records the attempt', async () => {
    let calls = 0;
    const create = vi.fn(() =>
      (async function* () {
        calls += 1;
        if (calls === 1) {
          yield { type: 'error', message: 'network timeout' } as AgentMessage;
          return;
        }
        yield { type: 'text', content: 'recovered' } as AgentMessage;
      })(),
    );

    await expect(
      collect(withSafeRunRetry(create, new AbortController().signal)),
    ).resolves.toEqual([
      {
        type: 'system',
        subtype: 'auto_retry',
        attempt: 1,
        isProgress: true,
      },
      { type: 'text', content: 'recovered' },
    ]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry after visible output or a tool call', async () => {
    for (const first of [
      { type: 'text', content: 'visible' },
      { type: 'tool_use', name: 'Write', id: 'tool-1' },
    ] satisfies AgentMessage[]) {
      const create = vi.fn(() =>
        (async function* () {
          yield first;
          yield { type: 'error', message: 'network timeout' } as AgentMessage;
        })(),
      );
      const result = await collect(
        withSafeRunRetry(create, new AbortController().signal),
      );
      expect(result).toHaveLength(2);
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it('does not retry after file/media side effects, permission gates, or cancellation', async () => {
    for (const first of [
      { type: 'tool_use', name: 'Write', id: 'file-write' },
      { type: 'tool_use', name: 'media_generate_image', id: 'media-request' },
      {
        type: 'permission_request',
        permission: {
          id: 'approval-1',
          tool: 'upload',
          description: 'Approve upload',
        },
      },
    ] satisfies AgentMessage[]) {
      const create = vi.fn(() =>
        (async function* () {
          yield first;
          yield { type: 'error', message: 'network timeout' } as AgentMessage;
        })(),
      );
      await collect(withSafeRunRetry(create, new AbortController().signal));
      expect(create).toHaveBeenCalledOnce();
    }

    const controller = new AbortController();
    controller.abort();
    const cancelled = vi.fn(() =>
      (async function* () {
        yield { type: 'error', message: 'network timeout' } as AgentMessage;
      })(),
    );
    await collect(withSafeRunRetry(cancelled, controller.signal));
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
