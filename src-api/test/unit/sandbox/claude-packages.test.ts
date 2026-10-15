import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '@/extensions/sandbox/claude';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => '/fixture/srt'),
  spawn: vi.fn(() => {
    throw new Error('unexpected process start');
  }),
}));
vi.mock('fs', () => ({ existsSync: vi.fn(() => true) }));

import { execSync, spawn } from 'child_process';

describe('Claude script package boundary', () => {
  let provider: ClaudeProvider;

  beforeEach(async () => {
    provider = new ClaudeProvider();
    await provider.init();
    vi.clearAllMocks();
  });

  it.each([
    'requests;id',
    'requests&&id',
    '$(id)',
    'https://example.com/pkg',
    './pkg',
    '../pkg',
    '/tmp/pkg',
    '--config=x',
    'requests\nother',
    'requests extra',
    '@scope/pkg;id',
  ])('rejects unsafe specification %s before execution', async (spec) => {
    const result = await provider.runScript('/fixture/script.py', '/fixture', {
      packages: [spec],
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Invalid package specification/);
    expect(execSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['script.py', ['requests', 'numpy==2.1.0']],
    ['script.js', ['lodash', '@scope/pkg@1.2.3']],
  ])(
    'refuses %s package lifecycle execution without a verified installation boundary',
    async (script, packages) => {
      const result = await provider.runScript(
        `/fixture/${script}`,
        '/fixture',
        { packages },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /Package installation is disabled.*lifecycle/i,
      );
      expect(execSync).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
  );
});
