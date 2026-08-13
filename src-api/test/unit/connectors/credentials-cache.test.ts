import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetCredentialCacheForTests,
  clearCachedAccessToken,
  getCachedAccessToken,
  setCachedAccessToken,
} from '@/shared/connectors/providers/composio/credentials-cache';

describe('credentials cache', () => {
  beforeEach(() => {
    __resetCredentialCacheForTests();
  });

  it('returns a fresh token before the refresh margin', () => {
    const now = 1_000_000;
    // 1-hour token; 30 min in we still have 30 min left, well past the 60s
    // refresh margin so the cache should serve the value.
    setCachedAccessToken('ca_1', 'tok-1', 3600, now);
    expect(getCachedAccessToken('ca_1', now)).toBe('tok-1');
    expect(getCachedAccessToken('ca_1', now + 30 * 60 * 1000)).toBe('tok-1');
  });

  it('evicts within the refresh margin to force a re-fetch', () => {
    const now = 1_000_000;
    // 5-minute token; at +3 min the entry has 2 min left (>60s margin →
    // still fresh). At +4m 10s only 50s remain — inside the margin →
    // evict so the orchestrator re-fetches before the token actually
    // expires.
    setCachedAccessToken('ca_2', 'tok-2', 300, now);
    expect(getCachedAccessToken('ca_2', now + 3 * 60 * 1000)).toBe('tok-2');
    expect(
      getCachedAccessToken('ca_2', now + 4 * 60 * 1000 + 10_000),
    ).toBeNull();
    // Subsequent lookup also returns null (entry was evicted on the prior
    // call, not transient).
    expect(
      getCachedAccessToken('ca_2', now + 4 * 60 * 1000 + 10_000),
    ).toBeNull();
  });

  it('defaults the ttl when Composio omits expires_in', () => {
    const now = 1_000_000;
    setCachedAccessToken('ca_3', 'tok-3', undefined, now);
    // Should still be live well past 60s
    expect(getCachedAccessToken('ca_3', now + 25 * 60 * 1000)).toBe('tok-3');
  });

  it('clearCachedAccessToken with no arg wipes everything', () => {
    setCachedAccessToken('ca_a', 'a', 600);
    setCachedAccessToken('ca_b', 'b', 600);
    clearCachedAccessToken();
    expect(getCachedAccessToken('ca_a')).toBeNull();
    expect(getCachedAccessToken('ca_b')).toBeNull();
  });

  it('clearCachedAccessToken targets a single account id', () => {
    setCachedAccessToken('ca_a', 'a', 600);
    setCachedAccessToken('ca_b', 'b', 600);
    clearCachedAccessToken('ca_a');
    expect(getCachedAccessToken('ca_a')).toBeNull();
    expect(getCachedAccessToken('ca_b')).toBe('b');
  });
});
