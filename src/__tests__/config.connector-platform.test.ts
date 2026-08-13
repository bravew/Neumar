import { afterEach, describe, expect, it, vi } from 'vitest';

async function importConnectorFlag() {
  vi.resetModules();
  const config = await import('@/config');
  return config.CONNECTOR_PLATFORM_V2_ENABLED;
}

describe('connector platform frontend build flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to enabled when no Vite build flag is configured', async () => {
    expect(await importConnectorFlag()).toBe(true);
  });

  it('can be disabled by VITE_NEUMA_CONNECTORS_PLATFORM_V2 at build time', async () => {
    vi.stubEnv('VITE_NEUMA_CONNECTORS_PLATFORM_V2', 'false');
    expect(await importConnectorFlag()).toBe(false);

    vi.stubEnv('VITE_NEUMA_CONNECTORS_PLATFORM_V2', '0');
    expect(await importConnectorFlag()).toBe(false);
  });

  it('can be explicitly enabled by VITE_NEUMA_CONNECTORS_PLATFORM_V2', async () => {
    vi.stubEnv('VITE_NEUMA_CONNECTORS_PLATFORM_V2', 'true');
    expect(await importConnectorFlag()).toBe(true);

    vi.stubEnv('VITE_NEUMA_CONNECTORS_PLATFORM_V2', '1');
    expect(await importConnectorFlag()).toBe(true);
  });
});
