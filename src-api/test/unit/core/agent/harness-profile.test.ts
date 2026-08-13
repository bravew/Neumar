import { describe, expect, it } from 'vitest';

import {
  applyHarnessProfileToConfig,
  harnessProfileRegistry,
  mergeHarnessProfiles,
  resolveHarnessProfile,
} from '@/core/agent/harness-profile';

describe('harness profiles', () => {
  it('merges built-in Claude and Codex profiles by provider/model/transport', () => {
    expect(
      resolveHarnessProfile({
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        transport: 'sdk',
      })?.id,
    ).toBe('claude-sdk-reasoning');

    expect(
      resolveHarnessProfile({
        provider: 'claude',
        model: 'claude-haiku-4-20250514',
        transport: 'sdk',
      })?.capabilities.reasoning,
    ).toBe(false);

    expect(
      resolveHarnessProfile({
        provider: 'codex',
        model: 'codex:gpt-5.3-codex',
        transport: 'cli',
      })?.id,
    ).toBe('codex-cli-default');

    expect(
      resolveHarnessProfile({
        provider: 'deepagents',
        model: 'claude-sonnet-4-20250514',
      }),
    ).toBeUndefined();
  });

  it('merges nested profile defaults without dropping base capabilities', () => {
    const merged = mergeHarnessProfiles(
      {
        id: 'base',
        provider: 'claude',
        capabilities: { tools: true, mcp: true },
        defaults: { providerConfig: { a: 1 } },
        limits: { maxTurns: 10 },
      },
      {
        capabilities: { mcp: false },
        defaults: { providerConfig: { b: 2 } },
        limits: { maxOutputTokens: 1000 },
      },
    );

    expect(merged.capabilities).toEqual({ tools: true, mcp: false });
    expect(merged.defaults?.providerConfig).toEqual({ b: 2 });
    expect(merged.limits).toEqual({ maxTurns: 10, maxOutputTokens: 1000 });
  });

  it('applies explicit profile defaults to agent config', () => {
    harnessProfileRegistry.register({
      id: 'custom-test-profile',
      provider: 'claude',
      capabilities: {},
      defaults: { providerConfig: { fromProfile: true } },
    });

    const config = applyHarnessProfileToConfig({
      provider: 'claude',
      harnessProfileId: 'custom-test-profile',
      providerConfig: { fromConfig: true },
    });

    expect(config.providerConfig).toEqual({
      fromProfile: true,
      fromConfig: true,
    });
  });
});
