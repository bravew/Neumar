import { describe, expect, it } from 'vitest';

import { ToolLifecycleHookRunner } from '@/core/agent/tool-lifecycle-hooks';

describe('ToolLifecycleHookRunner', () => {
  describe('register and priority ordering', () => {
    it('runs higher priority hooks first', async () => {
      const runner = new ToolLifecycleHookRunner();
      const order: number[] = [];

      runner.register({
        event: 'pre_tool_use',
        handler: async () => {
          order.push(1);
          return { action: 'allow' };
        },
        priority: 1,
      });

      runner.register({
        event: 'pre_tool_use',
        handler: async () => {
          order.push(10);
          return { action: 'allow' };
        },
        priority: 10,
      });

      await runner.runPreToolUse('Bash', {}, 'session-1');
      expect(order).toEqual([10, 1]); // Higher priority first
    });
  });

  describe('runPreToolUse', () => {
    it('returns allow when no hooks deny', async () => {
      const runner = new ToolLifecycleHookRunner();
      runner.register({
        event: 'pre_tool_use',
        handler: async () => ({ action: 'allow' }),
      });

      const result = await runner.runPreToolUse('Read', {}, 'session-1');
      expect(result.action).toBe('allow');
    });

    it('returns deny when a hook denies', async () => {
      const runner = new ToolLifecycleHookRunner();
      runner.register({
        event: 'pre_tool_use',
        handler: async () => ({
          action: 'deny',
          message: 'Blocked by test hook',
        }),
      });

      const result = await runner.runPreToolUse(
        'Bash',
        { command: 'rm -rf /' },
        'session-1',
      );
      expect(result.action).toBe('deny');
      expect(result.message).toBe('Blocked by test hook');
    });

    it('respects matcher pattern', async () => {
      const runner = new ToolLifecycleHookRunner();
      const called: string[] = [];

      runner.register({
        event: 'pre_tool_use',
        matcher: 'Bash',
        handler: async ({ toolName }) => {
          called.push(toolName);
          return { action: 'allow' };
        },
      });

      await runner.runPreToolUse('Bash', {}, 'session-1');
      await runner.runPreToolUse('Read', {}, 'session-1');

      expect(called).toEqual(['Bash']); // Only Bash matched
    });

    it('supports regex matcher', async () => {
      const runner = new ToolLifecycleHookRunner();
      const called: string[] = [];

      runner.register({
        event: 'pre_tool_use',
        matcher: 'Write|Edit',
        handler: async ({ toolName }) => {
          called.push(toolName);
          return { action: 'allow' };
        },
      });

      await runner.runPreToolUse('Write', {}, 'session-1');
      await runner.runPreToolUse('Edit', {}, 'session-1');
      await runner.runPreToolUse('Read', {}, 'session-1');

      expect(called).toEqual(['Write', 'Edit']);
    });

    it('fails open on hook errors', async () => {
      const runner = new ToolLifecycleHookRunner();
      runner.register({
        event: 'pre_tool_use',
        handler: async () => {
          throw new Error('Hook crashed');
        },
      });

      const result = await runner.runPreToolUse('Bash', {}, 'session-1');
      expect(result.action).toBe('allow'); // Fail open
    });

    it('fails open when enforced hook timeout fires', async () => {
      const runner = new ToolLifecycleHookRunner({
        timeoutMs: 5,
        slowWarnMs: 1,
        enforceTimeout: true,
      });
      runner.register({
        event: 'pre_tool_use',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { action: 'deny', message: 'too late' };
        },
      });

      const result = await runner.runPreToolUse('Bash', {}, 'session-1');
      expect(result.action).toBe('allow');
    });
  });

  describe('runPostToolUse', () => {
    it('runs post hooks without errors', async () => {
      const runner = new ToolLifecycleHookRunner();
      let called = false;

      runner.register({
        event: 'post_tool_use',
        handler: async () => {
          called = true;
          return { action: 'allow' };
        },
      });

      await runner.runPostToolUse('Bash', {}, 'result', 'session-1');
      expect(called).toBe(true);
    });
  });

  describe('toSdkHooks', () => {
    it('produces SDK-compatible format', () => {
      const runner = new ToolLifecycleHookRunner();
      runner.register({
        event: 'pre_tool_use',
        matcher: 'Bash',
        handler: async () => ({ action: 'allow' }),
      });
      runner.register({
        event: 'post_tool_use',
        handler: async () => ({ action: 'allow' }),
      });

      const sdkHooks = runner.toSdkHooks();

      expect(sdkHooks.PreToolUse).toHaveLength(1);
      expect(sdkHooks.PreToolUse![0]).toHaveProperty('matcher', 'Bash');
      expect(sdkHooks.PreToolUse![0]).toHaveProperty('hooks');
      expect(sdkHooks.PreToolUse![0]!.hooks).toHaveLength(1);

      expect(sdkHooks.PostToolUse).toHaveLength(1);
      expect(sdkHooks.PostToolUse![0]).toHaveProperty('hooks');
    });

    it('returns empty for no hooks', () => {
      const runner = new ToolLifecycleHookRunner();
      const sdkHooks = runner.toSdkHooks();
      expect(sdkHooks.PreToolUse).toBeUndefined();
      expect(sdkHooks.PostToolUse).toBeUndefined();
    });
  });
});
