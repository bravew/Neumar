import { describe, expect, it } from 'vitest';

import '@/shared/services/gateway/channels';
import { getRegisteredChannelMetadata } from '@/shared/services/gateway/channels/registry';
import type { ChannelRuntimeClass } from '@/shared/services/gateway/channels/types';

const EXPECTED_RUNTIME_CLASSES: Record<string, ChannelRuntimeClass> = {
  discord: 'official',
  telegram: 'official',
  feishu: 'official',
  linear: 'official',
  whatsapp: 'official',
  imessage: 'bridge',
  sms: 'experimental',
};

describe('gateway channel capabilities', () => {
  it('publishes runtime classes for registered gateway adapters', () => {
    for (const [id, runtimeClass] of Object.entries(EXPECTED_RUNTIME_CLASSES)) {
      expect(getRegisteredChannelMetadata(id)?.capabilities?.runtimeClass).toBe(
        runtimeClass,
      );
    }
  });
});
