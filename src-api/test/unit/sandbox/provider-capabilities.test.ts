import { describe, expect, it } from 'vitest';

import {
  DOCKER_METADATA,
  E2B_METADATA,
  NATIVE_METADATA,
  type SandboxProviderMetadata,
} from '@/core/sandbox/plugin';
import type { SandboxCapabilities } from '@/core/sandbox/types';

import {
  CLAUDE_SANDBOX_METADATA,
  ClaudeProvider,
} from '@/extensions/sandbox/claude';
import { CODEX_CLI_METADATA, CodexProvider } from '@/extensions/sandbox/codex';
import { NativeProvider } from '@/extensions/sandbox/native';

/**
 * Marketplace eligibility is the contract that gates Phase 7 untrusted
 * execution. It must be true only when the provider reports hard enforcement
 * AND non-none isolation. These tests freeze that contract.
 */

function eligibilityHolds(
  c: Pick<
    SandboxCapabilities,
    'enforcement' | 'isolation' | 'marketplaceEligible'
  >,
): boolean {
  if (c.marketplaceEligible) {
    return c.enforcement === 'hard' && c.isolation !== 'none';
  }
  return true;
}

describe('SandboxProviderMetadata enforcement contract', () => {
  const all: SandboxProviderMetadata[] = [
    NATIVE_METADATA,
    DOCKER_METADATA,
    E2B_METADATA,
    CODEX_CLI_METADATA,
    CLAUDE_SANDBOX_METADATA,
  ];

  it.each(all.map((m) => [m.type, m]))(
    '%s metadata: marketplace eligibility implies hard enforcement and non-none isolation',
    (_type, m) => {
      expect(eligibilityHolds(m)).toBe(true);
    },
  );

  it('native metadata is enforcement=none and not marketplace eligible', () => {
    expect(NATIVE_METADATA.enforcement).toBe('none');
    expect(NATIVE_METADATA.isolation).toBe('none');
    expect(NATIVE_METADATA.marketplaceEligible).toBe(false);
  });

  it('codex metadata is reduced until shell/package-install paths are closed', () => {
    expect(CODEX_CLI_METADATA.enforcement).toBe('reduced');
    expect(CODEX_CLI_METADATA.marketplaceEligible).toBe(false);
    expect(CODEX_CLI_METADATA.reducedIsolationReason).toBeTruthy();
  });

  it('claude metadata is reduced (ASRT beta)', () => {
    expect(CLAUDE_SANDBOX_METADATA.enforcement).toBe('reduced');
    expect(CLAUDE_SANDBOX_METADATA.marketplaceEligible).toBe(false);
    expect(CLAUDE_SANDBOX_METADATA.reducedIsolationReason).toBeTruthy();
  });

  it('docker and e2b metadata advertise hard enforcement and marketplace eligibility', () => {
    for (const m of [DOCKER_METADATA, E2B_METADATA]) {
      expect(m.enforcement).toBe('hard');
      expect(m.isolation).not.toBe('none');
      expect(m.marketplaceEligible).toBe(true);
      expect(m.supportsNetworkPolicy).toBe(true);
    }
  });
});

describe('Provider getCapabilities() runtime values', () => {
  it('NativeProvider reports none/none and not marketplace eligible', () => {
    const c = new NativeProvider().getCapabilities();
    expect(c.enforcement).toBe('none');
    expect(c.isolation).toBe('none');
    expect(c.marketplaceEligible).toBe(false);
    expect(eligibilityHolds(c)).toBe(true);
  });

  it('CodexProvider reports reduced isolation with a reason', () => {
    const c = new CodexProvider().getCapabilities();
    expect(c.enforcement).toBe('reduced');
    expect(c.marketplaceEligible).toBe(false);
    expect(c.reducedIsolationReason).toBeTruthy();
  });

  it('ClaudeProvider reports reduced isolation with a reason', () => {
    const c = new ClaudeProvider().getCapabilities();
    expect(c.enforcement).toBe('reduced');
    expect(c.marketplaceEligible).toBe(false);
    expect(c.reducedIsolationReason).toBeTruthy();
  });
});
