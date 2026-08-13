import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

async function collect(
  gen: AsyncGenerator<AgentMessage>,
): Promise<AgentMessage[]> {
  const out: AgentMessage[] = [];
  for await (const m of gen) out.push(m);
  return out;
}

describe('Mock Agent Adapter', () => {
  describe('Plugin metadata', () => {
    it('registers as the mock provider with replay capabilities', async () => {
      const { mockAgentPlugin } = await import('@/extensions/agent/mock');
      const meta = mockAgentPlugin.metadata;
      expect(meta.type).toBe('mock');
      expect(meta.transport).toBe('sdk');
      expect(meta.requiresApiKey).toBe(false);
      expect(meta.supportsStreaming).toBe(true);
    });

    it('is included in the built-in provider set', async () => {
      const { builtinAgentPlugins } = await import('@/core/agent');
      expect(builtinAgentPlugins.some((p) => p.metadata.type === 'mock')).toBe(
        true,
      );
    });
  });

  describe('Replay', () => {
    it('replays the happy-path trace as an AgentMessage stream', async () => {
      const { createMockAgent } = await import('@/extensions/agent/mock');
      process.env.NEUMA_MOCK_NO_DELAY = '1';
      const agent = createMockAgent({
        provider: 'mock',
        model: 'hello-read-edit', // per-config trace selection
      });

      const msgs = await collect(agent.run('any prompt'));
      const types = msgs.map((m) => m.type);

      expect(types[0]).toBe('session');
      expect(types).toContain('thinking');
      expect(types).toContain('tool_use');
      expect(types).toContain('tool_result');
      expect(types.at(-1)).toBe('done');

      // tool_use carries name + input; its result follows immediately.
      const toolUse = msgs.find((m) => m.type === 'tool_use');
      expect(toolUse?.name).toBe('Read');
      const toolResult = msgs.find((m) => m.type === 'tool_result');
      expect(toolResult?.toolUseId).toBe('toolu_01');
      expect(toolResult?.isError).toBe(false);

      // The final report surfaces as assistant text.
      const text = msgs.filter((m) => m.type === 'text').map((m) => m.content);
      expect(text.some((t) => t?.includes('New Title'))).toBe(true);
    });

    it('surfaces tool errors from the failed-path trace', async () => {
      const { createMockAgent } = await import('@/extensions/agent/mock');
      process.env.NEUMA_MOCK_NO_DELAY = '1';
      const agent = createMockAgent({
        provider: 'mock',
        model: 'tool-error-recovery',
      });

      const msgs = await collect(agent.run('any prompt'));
      const errored = msgs.find((m) => m.type === 'tool_result' && m.isError);
      expect(errored).toBeDefined();
      expect(msgs.some((m) => m.type === 'error')).toBe(true);
    });

    it('throws a clear error for an unknown trace id', async () => {
      const { createMockAgent } = await import('@/extensions/agent/mock');
      const agent = createMockAgent({
        provider: 'mock',
        model: 'does-not-exist',
      });
      const msgs = await collect(agent.run('any prompt'));
      const err = msgs.find((m) => m.type === 'error');
      expect(err?.content).toMatch(/matched no recording/i);
    });
  });
});
