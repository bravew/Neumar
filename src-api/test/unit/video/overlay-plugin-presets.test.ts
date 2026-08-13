import { afterEach, describe, expect, it } from 'vitest';

import {
  clearPluginOverlayPresetsForTests,
  findPluginOverlayPreset,
  listPluginOverlayPresets,
  registerVideoPluginOverlayPresets,
} from '@/shared/video/overlays/plugin-presets';
import { resolveVividOverlayWithPlugins } from '@/shared/video/overlays/server-resolve';
import type { VideoPlugin } from '@/shared/video/plugins/types';

function pluginFixture(overrides: {
  trustTier: VideoPlugin['trustTier'];
  overlayPresets?: unknown[];
}): VideoPlugin {
  return {
    id: 'user/test-pack',
    trustTier: overrides.trustTier,
    manifest: {
      video: {
        overlayPresets: overrides.overlayPresets ?? [
          {
            id: 'brand-highlight',
            backend: 'html',
            category: 'callout',
            label: 'Brand highlight',
            description: 'Marker sweep in brand colors.',
            documentId: 'marker-highlight',
            controls: [
              {
                id: 'text',
                type: 'text',
                label: 'Text',
                defaultValue: 'Our brand',
              },
            ],
            defaultDurationMs: 2500,
            minDurationMs: 500,
          },
        ],
      },
    },
  } as unknown as VideoPlugin;
}

afterEach(() => clearPluginOverlayPresetsForTests());

describe('video plugin overlay preset packs (data-only)', () => {
  it('merges presets from trusted-tier plugins, namespaced', () => {
    registerVideoPluginOverlayPresets(pluginFixture({ trustTier: 'local' }));
    const preset = findPluginOverlayPreset(
      'plugin:user/test-pack/brand-highlight',
    );
    expect(preset).toMatchObject({
      backend: 'html',
      documentId: 'marker-highlight',
      labelKey: 'Brand highlight',
      capability: 'native',
    });
    expect(listPluginOverlayPresets()).toHaveLength(1);
  });

  it('skips plugins outside the trusted tiers', () => {
    registerVideoPluginOverlayPresets(
      pluginFixture({ trustTier: 'marketplace' }),
    );
    registerVideoPluginOverlayPresets(pluginFixture({ trustTier: 'url' }));
    expect(listPluginOverlayPresets()).toHaveLength(0);
  });

  it('rejects presets referencing non-built-in documents', () => {
    registerVideoPluginOverlayPresets(
      pluginFixture({
        trustTier: 'bundled',
        overlayPresets: [
          {
            id: 'evil',
            backend: 'html',
            category: 'callout',
            label: 'Evil',
            description: 'Points at a document that does not exist.',
            documentId: 'not-a-built-in',
            controls: [],
            defaultDurationMs: 1000,
            minDurationMs: 100,
          },
          {
            id: 'evil-lottie',
            backend: 'lottie',
            category: 'ambient',
            label: 'Evil lottie',
            description: 'Unknown lottie asset.',
            documentId: 'lottie:not-real',
            controls: [],
            defaultDurationMs: 1000,
            minDurationMs: 100,
          },
        ],
      }),
    );
    expect(listPluginOverlayPresets()).toHaveLength(0);
  });

  it('resolves plugin presets through the server-side resolver with defaults', () => {
    registerVideoPluginOverlayPresets(pluginFixture({ trustTier: 'saved' }));
    const resolved = resolveVividOverlayWithPlugins({
      presetId: 'plugin:user/test-pack/brand-highlight',
      backend: 'html',
      controls: {},
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.controls.text).toBe('Our brand');
    expect(resolved!.errors).toEqual([]);
    // built-ins still take precedence and unknown ids stay null
    expect(
      resolveVividOverlayWithPlugins({
        presetId: 'html.marker-highlight',
        backend: 'html',
        controls: {},
      }),
    ).not.toBeNull();
    expect(
      resolveVividOverlayWithPlugins({
        presetId: 'plugin:user/test-pack/missing',
        backend: 'html',
        controls: {},
      }),
    ).toBeNull();
  });
});
