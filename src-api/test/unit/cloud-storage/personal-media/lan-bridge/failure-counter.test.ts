import { describe, expect, it, vi } from 'vitest';

import { LanBridgeFailureCounter } from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

describe('LanBridgeFailureCounter', () => {
  it('does not unverify on isolated local bridge failures', () => {
    const counter = new LanBridgeFailureCounter();
    const store = { markVerification: vi.fn() };

    counter.record({
      mappingId: 'mapping-1',
      success: false,
      reason: 'missing_file',
      store,
    });

    expect(store.markVerification).not.toHaveBeenCalled();
  });

  it('marks a mapping unverified after persistent failures in the window', () => {
    const counter = new LanBridgeFailureCounter({
      windowSize: 100,
      failureRatioThreshold: 0.5,
    });
    const store = { markVerification: vi.fn() };

    for (let i = 0; i < 49; i += 1) {
      counter.record({ mappingId: 'mapping-1', success: true, store });
    }
    for (let i = 0; i < 50; i += 1) {
      counter.record({
        mappingId: 'mapping-1',
        success: false,
        reason: 'missing_file',
        store,
      });
    }
    expect(store.markVerification).not.toHaveBeenCalled();

    counter.record({
      mappingId: 'mapping-1',
      success: false,
      reason: 'missing_file',
      store,
    });

    expect(store.markVerification).toHaveBeenCalledWith('mapping-1', false, {
      lastError: 'missing_file',
    });
  });
});
