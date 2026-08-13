import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { loadVideoPlugins } from '@/shared/video/plugins';

const tempDirs: string[] = [];
const testDir = dirname(fileURLToPath(import.meta.url));
const builtinPluginRoot = join(
  testDir,
  '..',
  '..',
  '..',
  '..',
  '..',
  'plugins',
  'builtin',
);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('video plugin loader', () => {
  it('loads video manifests through the generic plugin shim', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuma-video-plugins-'));
    tempDirs.push(root);
    const pluginDir = join(root, 'social-reel');
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'social-reel',
        version: '1.0.0',
        description: 'Social reel plugin',
        metadata: {
          neuma: {
            surfaces: ['video'],
            videoManifest: 'video-plugin.json',
          },
        },
      }),
    );
    await writeFile(
      join(pluginDir, 'video-plugin.json'),
      JSON.stringify({
        specVersion: '1.0.0',
        name: 'social-reel',
        title: 'Social Reel',
        compatibility: {
          neuma: '>=26.6.15 <27.0.0',
          videoPluginApi: '^1.0.0',
        },
        description: 'Create researched social reels.',
        video: {
          kind: 'flow',
          mode: 'shorts',
          aspectRatios: ['9:16'],
          engine: { id: 'html' },
          pipeline: {
            stages: [{ id: 'storyboard', atoms: ['storyboard-draft'] }],
          },
          output: { preset: 'social-vertical' },
          capabilities: ['prompt:inject'],
          networkAccess: { allowedHosts: ['none'] },
        },
      }),
    );

    const result = await loadVideoPlugins({
      projectPluginRoot: root,
      builtinPluginRoot,
      watch: false,
      register: false,
    });

    expect(result.issues).toEqual([]);
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining([
        'social-reel',
        'event-recap',
        'explainer',
        'talking-head-auto-cut',
      ]),
    );
    expect(
      result.plugins.find((plugin) => plugin.id === 'social-reel'),
    ).toMatchObject({
      id: 'social-reel',
      title: 'Social Reel',
      trustTier: 'local',
    });
  });

  it('rejects video manifest paths that escape the plugin root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuma-video-plugins-'));
    tempDirs.push(root);
    const pluginDir = join(root, 'social-reel');
    await mkdir(pluginDir, { recursive: true });

    const result = await loadVideoPlugins({
      substratePlugins: [
        {
          manifest: {
            name: 'social-reel',
            version: '1.0.0',
            description: 'Social reel plugin',
            skills: 'skills',
            metadata: {
              neuma: {
                surfaces: ['video'],
                videoManifest: '../video-plugin.json',
              },
            },
          },
          scope: 'project',
          path: pluginDir,
          skills: [],
        },
      ],
      register: false,
    });

    expect(result.plugins).toEqual([]);
    expect(result.issues[0]?.code).toBe('manifest-path-escapes-plugin');
  });

  it('loads repo-shipped built-in video plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuma-video-plugins-'));
    tempDirs.push(root);

    const result = await loadVideoPlugins({
      projectPluginRoot: root,
      builtinPluginRoot,
      watch: false,
      register: false,
    });

    expect(result.issues).toEqual([]);
    expect(result.plugins.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining([
        'social-reel',
        'event-recap',
        'explainer',
        'talking-head-auto-cut',
      ]),
    );
    const autoCut = result.plugins.find(
      (plugin) => plugin.id === 'talking-head-auto-cut',
    );
    expect(autoCut).toMatchObject({
      trustTier: 'bundled',
      genuiSurfaces: [
        {
          id: 'strategy-confirmation',
          kind: 'confirmation',
          persist: 'project',
          capabilitiesRequired: [
            'media:transcribe',
            'video:analyze',
            'video:edit',
          ],
        },
      ],
    });
    expect(autoCut?.stages.map((stage) => stage.atoms)).toEqual([
      ['source-transcribe'],
      ['source-analyze'],
      ['auto-cut-plan'],
      ['timeline-assemble'],
      ['render-preview'],
      ['qa-check'],
    ]);
    expect(autoCut?.capabilities).toEqual([
      'media:transcribe',
      'prompt:inject',
      'video:analyze',
      'video:edit',
    ]);
  });
});
