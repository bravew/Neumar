import { describe, expect, it } from 'vitest';

import {
  buildMacosSeatbeltProfile,
  createSandboxSpawnPlan,
} from '@/extensions/agent/process-agent/sandbox';

describe('process-agent sandbox', () => {
  it('builds a deny-by-default macOS Seatbelt profile scoped to workspace and tmp', () => {
    const profile = buildMacosSeatbeltProfile({
      cwd: '/tmp/neuma-workspace/app',
      workspaceRoot: '/tmp/neuma-workspace',
      profile: { allowNetwork: false },
    });

    expect(profile).toContain('(deny default)');
    expect(profile).toContain('(allow process*)');
    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(subpath "/tmp/neuma-workspace")');
    expect(profile).toContain('(subpath "/tmp/neuma-workspace/app")');
  });

  it('escapes Scheme string paths in generated profiles', () => {
    const profile = buildMacosSeatbeltProfile({
      cwd: '/tmp/neuma "quoted"',
      workspaceRoot: '/tmp/neuma "quoted"',
      profile: {
        readonlyPaths: ['/tmp/path with "quote" and \\ slash'],
      },
    });

    expect(profile).toContain('/tmp/neuma \\"quoted\\"');
    expect(profile).toContain('/tmp/path with \\"quote\\" and \\\\ slash');
  });

  it('returns explicit soft mode when requested', () => {
    const plan = createSandboxSpawnPlan({
      command: 'node',
      args: ['script.js'],
      cwd: '/tmp/work',
      workspaceRoot: '/tmp/work',
      sessionId: 'session-1',
      env: { PATH: '/usr/bin' },
      profile: { mode: 'soft' },
    });

    expect(plan.command).toBe('node');
    expect(plan.args).toEqual(['script.js']);
    expect(plan.mode).toBe('soft');
    expect(plan.reducedIsolation).toBe(true);
    expect(plan.reason).toMatch(/requested/);
  });
});
