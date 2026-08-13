import { describe, expect, it } from 'vitest';

import { PromptBuildHookRunner } from '@/core/agent/hooks';

const input = {
  prompt: 'hello',
  systemContext: 'base',
  contextMode: 'full' as const,
};

describe('PromptBuildHookRunner', () => {
  it('composes prompt hook output in priority order', async () => {
    const runner = new PromptBuildHookRunner();
    runner.register(async () => ({ appendContext: 'low' }), 1);
    runner.register(async () => ({ prependContext: 'high' }), 10);

    await expect(runner.compose('base', input)).resolves.toBe(
      'high\n\nbase\n\nlow',
    );
  });

  it('skips timed-out hooks when enforcement is enabled', async () => {
    const runner = new PromptBuildHookRunner({
      timeoutMs: 5,
      slowWarnMs: 1,
      enforceTimeout: true,
    });
    runner.register(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { systemPrompt: 'too late' };
    });

    await expect(runner.compose('base', input)).resolves.toBe('base');
  });
});
