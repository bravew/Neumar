import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isConnectorPlatformV2Enabled } from '@/shared/connectors/feature-flag';

describe('connector platform v2 feature flag', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to enabled when no build or runtime override is configured', () => {
    expect(isConnectorPlatformV2Enabled()).toBe(true);
  });

  it('lets explicit environment overrides disable the platform', () => {
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'false');
    expect(isConnectorPlatformV2Enabled()).toBe(false);

    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', '0');
    expect(isConnectorPlatformV2Enabled()).toBe(false);
  });

  it('lets explicit environment overrides enable the platform', () => {
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'true');
    expect(isConnectorPlatformV2Enabled()).toBe(true);

    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', '1');
    expect(isConnectorPlatformV2Enabled()).toBe(true);
  });

  it('ignores invalid overrides and keeps the default enabled state', () => {
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'disabled');
    expect(isConnectorPlatformV2Enabled()).toBe(true);
  });
});
