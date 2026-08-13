import { describe, expect, it } from 'vitest';

import type { LoadedPlugin } from '@/shared/plugins';
import {
  compileVideoPluginNetworkPolicy,
  resolveVideoPlugin,
  validateVideoPluginManifest,
  type VideoPluginManifest,
} from '@/shared/video/plugins';

const genericManifest = {
  name: 'social-reel',
  version: '1.0.0',
  description: 'Social reel plugin',
  skills: 'skills',
  metadata: {
    neuma: {
      surfaces: ['video'],
      videoManifest: 'video-plugin.json',
    },
  },
} satisfies LoadedPlugin['manifest'];

function baseManifest(): VideoPluginManifest {
  return {
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
      useCase: {
        query: 'Make a reel about {{topic}}.',
        activation: { keywords: ['reel'], assetKinds: ['image'] },
      },
      pipeline: {
        stages: [
          { id: 'research', atoms: ['research-search'] },
          { id: 'storyboard', atoms: ['storyboard-draft'] },
          {
            id: 'critique',
            atoms: ['render-preview', 'qa-check'],
            repeat: true,
            until: 'qa.pass || iterations>=2',
          },
        ],
      },
      output: {
        preset: 'social-vertical',
        fps: 30,
      },
      capabilities: ['prompt:inject', 'research:web'],
      networkAccess: {
        allowedHosts: ['example.com'],
        allowedPaths: { 'example.com': ['/research/'] },
        reason: 'Research the requested topic.',
      },
    },
  };
}

describe('video plugin manifest validation', () => {
  it('accepts and resolves a valid manifest', () => {
    const manifest = baseManifest();
    const parsed = validateVideoPluginManifest(manifest, {
      genericManifest,
      folderName: 'social-reel',
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest?.name).toBe('social-reel');

    const plugin = resolveVideoPlugin({
      manifest: parsed.manifest!,
      rootDir: '/tmp/social-reel',
      manifestPath: '/tmp/social-reel/video-plugin.json',
      substratePlugin: {
        manifest: genericManifest,
        scope: 'bundled',
        path: '/tmp/social-reel',
        skills: [],
      },
    });

    expect(plugin.capabilities).toEqual(['prompt:inject', 'research:web']);
    expect(plugin.promptGuide).toContain('Active Video Plugin: Social Reel');
  });

  it('rejects repeat stages without until', () => {
    const manifest = baseManifest();
    manifest.video.pipeline.stages[2] = {
      id: 'critique',
      atoms: ['qa-check'],
      repeat: true,
    };

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/repeat stages must declare until/);
  });

  it('rejects unknown atoms before resolve', () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    const video = manifest.video as {
      pipeline: { stages: Array<{ atoms: string[] }> };
    };
    video.pipeline.stages[0]!.atoms = ['unknown-atom'];

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/Invalid option/);
  });

  it('rejects manifests missing atom-required capabilities', () => {
    const manifest = baseManifest();
    manifest.video.capabilities = ['prompt:inject'];

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/missing capability.*research:web/);
  });

  it('accepts the source-editing auto-cut atom contract', () => {
    const manifest = baseManifest();
    manifest.name = 'talking-head-auto-cut';
    manifest.title = 'Talking Head Auto-cut';
    manifest.description = 'Analyze source footage and propose word-safe cuts.';
    manifest.video.mode = 'explainer';
    manifest.video.pipeline.stages = [
      { id: 'transcribe', atoms: ['source-transcribe'] },
      { id: 'analyze', atoms: ['source-analyze', 'source-evidence'] },
      { id: 'plan', atoms: ['auto-cut-plan'] },
      { id: 'assemble', atoms: ['timeline-assemble'] },
      { id: 'qa', atoms: ['render-preview', 'qa-check'] },
    ];
    manifest.video.capabilities = [
      'prompt:inject',
      'media:transcribe',
      'video:analyze',
      'video:edit',
    ];
    manifest.video.genui = {
      surfaces: [
        {
          id: 'strategy-confirmation',
          kind: 'confirmation',
          persist: 'project',
          title: 'Auto-cut strategy',
          prompt: 'Review the proposed source-editing strategy.',
          capabilitiesRequired: [
            'media:transcribe',
            'video:analyze',
            'video:edit',
          ],
        },
      ],
    };

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(true);

    const plugin = resolveVideoPlugin({
      manifest: parsed.manifest!,
      rootDir: '/tmp/talking-head-auto-cut',
      manifestPath: '/tmp/talking-head-auto-cut/video-plugin.json',
      substratePlugin: {
        manifest: {
          ...genericManifest,
          name: 'talking-head-auto-cut',
        },
        scope: 'bundled',
        path: '/tmp/talking-head-auto-cut',
        skills: [],
      },
    });

    expect(plugin.impliedCapabilities).toEqual([
      'media:transcribe',
      'prompt:inject',
      'video:analyze',
    ]);
    expect(plugin.capabilities).toContain('video:edit');
    expect(plugin.genuiSurfaces).toMatchObject([
      { id: 'strategy-confirmation', kind: 'confirmation' },
    ]);
  });

  it('rejects raw execution hooks on auto-cut manifests', () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    const video = manifest.video as Record<string, unknown>;
    video.command = 'ffmpeg -i input.mp4 output.mp4';

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/Unrecognized key.*command/);
  });

  it('rejects wildcard network access', () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    const video = manifest.video as {
      networkAccess: { allowedHosts: string[] };
    };
    video.networkAccess.allowedHosts = ['*'];

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/wildcard network access/);
  });

  it('rejects incompatible host ranges', () => {
    const manifest = baseManifest();
    manifest.compatibility.neuma = '>=99.0.0 <100.0.0';

    const parsed = validateVideoPluginManifest(manifest, {
      hostVersion: '26.6.15',
    });
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/requires Neuma/);
  });

  it('rejects hyperframes and out-of-set fps/aspect ratios', () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    const video = manifest.video as {
      engine: { id: string };
      aspectRatios: string[];
      output: { fps: number };
    };
    video.engine.id = 'hyperframes';
    video.aspectRatios = ['4:3'];
    video.output.fps = 25;

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/Invalid option/);
  });

  it('rejects remotion template refs that fail adapter validation', () => {
    const manifest = baseManifest() as unknown as Record<string, unknown>;
    const video = manifest.video as {
      engine: {
        id: 'remotion';
        templateRef: {
          id: string;
          engineId: string;
          sourcePath: string;
          mode: 'native';
        };
      };
    };
    video.engine = {
      id: 'remotion',
      templateRef: {
        id: 'native',
        engineId: 'remotion',
        sourcePath: 'src/index.ts',
        mode: 'native',
      },
    };

    const parsed = validateVideoPluginManifest(manifest);
    expect(parsed.ok).toBe(false);
    expect(issueText(parsed)).toMatch(/nativeCompositionId/);
  });

  it('compiles allowed hosts into a deny-by-default network policy', () => {
    const compiled = compileVideoPluginNetworkPolicy(baseManifest());
    expect(compiled.policy.default).toBe('deny');
    expect(compiled.policy.egress).toMatchObject([
      {
        host: 'example.com',
        ports: [443],
        methods: ['GET', 'POST'],
        paths: ['/research/'],
      },
    ]);
  });
});

function issueText(result: { issues: Array<{ message: string }> }): string {
  return result.issues.map((issue) => issue.message).join(' ');
}
