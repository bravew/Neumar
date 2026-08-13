import { describe, expect, it } from 'vitest';

import {
  assertMarketplaceEligible,
  MarketplaceProviderError,
} from '@/core/sandbox';

import { ClaudeProvider } from '@/extensions/sandbox/claude';
import { CodexProvider } from '@/extensions/sandbox/codex';
import { NativeProvider } from '@/extensions/sandbox/native';

describe('assertMarketplaceEligible', () => {
  it('rejects native (enforcement=none, isolation=none)', () => {
    expect(() => assertMarketplaceEligible(new NativeProvider())).toThrow(
      MarketplaceProviderError,
    );
  });

  it('rejects codex while it reports reduced enforcement', () => {
    expect(() => assertMarketplaceEligible(new CodexProvider())).toThrow(
      /enforcement=reduced/,
    );
  });

  it('rejects claude while it reports reduced enforcement (ASRT beta)', () => {
    expect(() => assertMarketplaceEligible(new ClaudeProvider())).toThrow(
      /enforcement=reduced/,
    );
  });

  it('error carries the provider type and enforcement', () => {
    try {
      assertMarketplaceEligible(new NativeProvider());
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(MarketplaceProviderError);
      const err = e as MarketplaceProviderError;
      expect(err.providerType).toBe('native');
      expect(err.enforcement).toBe('none');
    }
  });
});
