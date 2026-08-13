import { describe, expect, it } from 'vitest';

import type { LoadedPlugin } from '@/shared/plugins';
import {
  applyVideoPlugin,
  hydrateVideoPluginUseCaseQuery,
  resolveVideoPlugin,
  scoreVideoPlugin,
  selectVideoPlugins,
  type VideoPluginManifest,
} from '@/shared/video/plugins';

describe('video plugin selection', () => {
  it('prefilters and ranks plugins from lexical intent', () => {
    const social = createPlugin('social-reel', 'Social Reel', 'shorts', [
      'reel',
      'short',
      'instagram',
    ]);
    const recap = createPlugin('event-recap', 'Event Recap', 'recap', [
      'event',
      'conference',
    ]);

    expect(scoreVideoPlugin(social, 'make an instagram reel')).toBeGreaterThan(
      scoreVideoPlugin(recap, 'make an instagram reel'),
    );
    expect(selectVideoPlugins([recap, social], { query: 'reel' })[0]?.id).toBe(
      'social-reel',
    );
  });

  it('hydrates use-case queries with input defaults and safe fallbacks', () => {
    const plugin = createPlugin('social-reel', 'Social Reel', 'shorts', [
      'reel',
    ]);

    expect(hydrateVideoPluginUseCaseQuery(plugin)).toBe(
      'Make a shorts video about this project.',
    );
    expect(hydrateVideoPluginUseCaseQuery(plugin, { topic: 'launch' })).toBe(
      'Make a shorts video about launch.',
    );
  });

  it('returns the exact run context needed by the agent gate', () => {
    const plugin = createPlugin('social-reel', 'Social Reel', 'shorts', [
      'reel',
    ]);
    const applied = applyVideoPlugin(plugin, {
      inputs: { topic: 'launch' },
      approvedCapabilities: plugin.capabilities,
      lastReviewedDigest: plugin.manifestDigest,
      signatureOk: true,
    });

    expect(applied.prompt).toBe('Make a shorts video about launch.');
    expect(applied.context).toMatchObject({
      pluginId: 'social-reel',
      pluginInputs: { topic: 'launch' },
      approvedPluginCapabilities: plugin.capabilities,
      lastReviewedPluginDigest: plugin.manifestDigest,
      pluginSignatureOk: true,
    });
    expect(applied.gate.restricted).toBe(false);
  });
});

function createPlugin(
  name: string,
  title: string,
  mode: VideoPluginManifest['video']['mode'],
  keywords: string[],
) {
  const manifest: VideoPluginManifest = {
    specVersion: '1.0.0',
    name,
    title,
    compatibility: {
      neuma: '>=26.6.15 <27.0.0',
      videoPluginApi: '^1.0.0',
    },
    description: `Create ${title.toLowerCase()} videos.`,
    tags: keywords,
    video: {
      kind: 'flow',
      mode,
      aspectRatios: ['9:16'],
      engine: { id: 'html' },
      useCase: {
        query: `Make a ${mode} video about {{topic}}.`,
        activation: { keywords },
      },
      pipeline: {
        stages: [{ id: 'storyboard', atoms: ['storyboard-draft'] }],
      },
      output: { preset: 'social-vertical' },
      capabilities: ['prompt:inject'],
      networkAccess: { allowedHosts: ['none'] },
    },
  };
  const genericManifest = {
    name: manifest.name,
    version: '1.0.0',
    description: `${title} plugin`,
    skills: 'skills',
    metadata: {
      neuma: {
        surfaces: ['video'],
        videoManifest: 'video-plugin.json',
      },
    },
  } satisfies LoadedPlugin['manifest'];

  return resolveVideoPlugin({
    manifest,
    rootDir: `/tmp/${manifest.name}`,
    manifestPath: `/tmp/${manifest.name}/video-plugin.json`,
    substratePlugin: {
      manifest: genericManifest,
      scope: 'local',
      path: `/tmp/${manifest.name}`,
      skills: [],
    },
  });
}
