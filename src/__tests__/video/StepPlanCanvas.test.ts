import { describe, expect, it } from 'vitest';

import { getCompatiblePlanModelOptions } from '@/components/video/StepPlanCanvas';
import type { VideoProviderView } from '@/shared/types/video';

describe('getCompatiblePlanModelOptions', () => {
  it('filters providers by scene asset plan capability', () => {
    const providers = providerFixtures();

    expect(
      getCompatiblePlanModelOptions(
        { kind: 'ai-clip', prompt: 'Clip' },
        providers,
      ),
    ).toEqual([
      { id: 'seedance-2-0-fast', label: 'Seedance Fast' },
      { id: 'pika-mcp', label: 'Pika MCP' },
    ]);

    expect(
      getCompatiblePlanModelOptions(
        { kind: 'ai-image', prompt: 'Image' },
        providers,
      ),
    ).toEqual([{ id: 'seedream-5-0-lite', label: 'Seedream Lite' }]);

    expect(
      getCompatiblePlanModelOptions(
        { kind: 'broll-search', query: 'office' },
        providers,
      ),
    ).toEqual([{ id: 'pexels', label: 'Pexels' }]);
  });
});

function providerFixtures(): VideoProviderView[] {
  return [
    provider('seedance-2-0-fast', 'Seedance Fast', ['t2v', 'i2v']),
    provider('seedream-5-0-lite', 'Seedream Lite', ['image']),
    provider('pika-mcp', 'Pika MCP', ['t2v', 'i2v', 'lipsync']),
    provider('pexels', 'Pexels', ['broll']),
    provider('kokoro', 'Kokoro', ['voice']),
  ];
}

function provider(
  id: string,
  label: string,
  kinds: string[],
): VideoProviderView {
  return {
    capability: {
      id,
      label,
      kinds,
      status: 'active',
      requiresApiKey: false,
      license: 'commercial-ok',
      probeRequired: false,
    },
    config: {
      id,
      providerId: id,
      enabled: true,
      settings: {},
    },
  };
}
