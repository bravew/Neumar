import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/agent-runtimes/resolve.js', () => ({
  getConfiguredExecutablePath: vi.fn((agentId: string) => {
    if (agentId === 'claude') {
      throw new Error('synthetic PATH walk failure');
    }
    return null;
  }),
  resolveConfiguredBinary: vi.fn(() => null),
  resolveOnPath: vi.fn(() => null),
}));

describe('agent runtime detection resilience', () => {
  afterEach(async () => {
    const { invalidateDetectionCache } =
      await import('../../../src/shared/agent-runtimes/detect.js');
    invalidateDetectionCache();
  });

  it('keeps the runtime picker populated when one probe throws', async () => {
    const { detectAgents } =
      await import('../../../src/shared/agent-runtimes/detect.js');
    const { AGENT_DEFS } =
      await import('../../../src/shared/agent-runtimes/registry.js');

    const agents = await detectAgents({ force: true });

    expect(agents).toHaveLength(AGENT_DEFS.length);
    const claude = agents.find((agent) => agent.id === 'claude');
    expect(claude).toMatchObject({ available: false });
    expect(claude?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('synthetic PATH walk failure'),
        }),
      ]),
    );
    expect(agents.map((agent) => agent.id)).toEqual(
      AGENT_DEFS.map((def) => def.id),
    );
  });
});
