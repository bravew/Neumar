import { describe, expect, it } from 'vitest';

import { videoSourceTools } from '@/shared/mcp/video-server/server';
import type { LoadedPlugin } from '@/shared/plugins';
import { buildPluginRuntimeConfig } from '@/shared/plugins/runtime';
import {
  buildExactAllowedToolsForVideoPluginRun,
  computeVideoPluginRunGate,
  createVideoPluginRunSnapshot,
  type NamedMcpToolDefinition,
  resolveVideoPlugin,
  type VideoPluginManifest,
} from '@/shared/video/plugins';

describe('video plugin runtime gate', () => {
  it('keeps unreviewed local plugins restricted', () => {
    const plugin = createPlugin('local');
    const gate = computeVideoPluginRunGate(plugin, {
      approvedCapabilities: ['network:youtube'],
    });

    expect(gate.restricted).toBe(true);
    expect(gate.promptContext).toBeUndefined();
    expect(gate.deniedCapabilities).toEqual([
      'media:generate',
      'network:youtube',
      'prompt:inject',
      'research:web',
    ]);
    expect(
      buildExactAllowedToolsForVideoPluginRun(
        [
          {
            serverName: 'video-edit',
            tools: [
              mockTool('video_get_project_summary'),
              mockTool('video_fetch_source'),
              mockTool('video_generate_voiceover'),
            ],
          },
          { serverName: 'video', tools: [mockTool('apply_cut_plan')] },
          { serverName: 'broll', tools: [mockTool('youtube')] },
        ],
        gate,
        ['WebSearch', 'Read'],
      ),
    ).toEqual(['mcp__video-edit__video_get_project_summary', 'Read']);
  });

  it('grants reviewed local plugins and freezes replayable snapshots', () => {
    const plugin = createPlugin('local');
    const gate = computeVideoPluginRunGate(plugin, {
      lastReviewedDigest: plugin.manifestDigest,
      approvedCapabilities: ['network:youtube'],
    });
    const allowedTools = buildExactAllowedToolsForVideoPluginRun(
      [
        {
          serverName: 'media',
          tools: [
            mockTool('media_generate_image'),
            mockTool('media_list_capabilities'),
          ],
        },
        { serverName: 'broll', tools: [mockTool('youtube')] },
      ],
      gate,
      ['WebSearch', 'Read'],
    );
    const snapshot = createVideoPluginRunSnapshot(gate, {
      inputs: { topic: 'launch' },
      allowedTools,
      enabledMcpServers: ['video-edit', 'media', 'broll'],
      createdAt: '2026-06-16T00:00:00.000Z',
    });

    expect(gate.restricted).toBe(false);
    expect(gate.promptContext?.stageChecklist).toContain(
      'research: research-search (required)',
    );
    expect(gate.grantedCapabilities).toEqual([
      'media:generate',
      'network:youtube',
      'prompt:inject',
      'research:web',
    ]);
    expect(allowedTools).toEqual([
      'mcp__media__media_generate_image',
      'mcp__media__media_list_capabilities',
      'mcp__broll__youtube',
      'WebSearch',
      'Read',
    ]);
    expect(snapshot.id).toHaveLength(64);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.payload).toMatchObject({
      inputs: { topic: 'launch' },
      restricted: false,
      promptGuideIncluded: true,
      allowedTools,
      enabledMcpServers: ['video-edit', 'media', 'broll'],
    });
  });

  it('keeps full runtime config off replayable snapshots', () => {
    const plugin = createPlugin('local');
    const manifestWithConfig = {
      name: plugin.id,
      version: plugin.version,
      description: 'Configured social reel plugin',
      skills: 'skills',
      metadata: {
        neuma: {
          surfaces: ['video'],
          videoManifest: 'video-plugin.json',
          configSchema: [
            { key: 'apiToken', type: 'secret', sensitive: true },
            { key: 'mode', type: 'enum' },
            { key: 'retries', type: 'number' },
          ],
        },
      },
    } satisfies LoadedPlugin['manifest'];
    plugin.config = buildPluginRuntimeConfig(manifestWithConfig, {
      apiToken: 'secret-token',
      mode: 'careful',
      retries: 3,
    });
    const gate = computeVideoPluginRunGate(plugin, {
      lastReviewedDigest: plugin.manifestDigest,
    });
    const snapshot = createVideoPluginRunSnapshot(gate, {
      createdAt: '2026-07-04T00:00:00.000Z',
    });

    expect(gate.config?.values).toMatchObject({
      apiToken: 'secret-token',
      mode: 'careful',
      retries: 3,
    });
    expect(gate.promptContext?.config).toEqual({
      publicValues: { mode: 'careful', retries: 3 },
      sensitiveKeys: ['apiToken'],
    });
    expect(snapshot.config).toEqual({
      keys: ['apiToken', 'mode', 'retries'],
      sensitiveKeys: ['apiToken'],
      publicValues: { mode: 'careful', retries: 3 },
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
  });

  it('forces restricted mode when a reviewed plugin digest changes', () => {
    const plugin = createPlugin('local');
    const gate = computeVideoPluginRunGate(plugin, {
      lastReviewedDigest: 'previous-digest',
    });

    expect(gate.restricted).toBe(true);
    expect(gate.grants).toContainEqual(
      expect.objectContaining({
        capability: 'prompt:inject',
        granted: false,
      }),
    );
  });

  it('gates auto-cut timeline mutation behind reviewed edit capability', () => {
    const plugin = createAutoCutPlugin();
    const unapprovedGate = computeVideoPluginRunGate(plugin);
    const unapprovedTools = buildExactAllowedToolsForVideoPluginRun(
      [{ serverName: 'video', tools: videoSourceTools }],
      unapprovedGate,
    );

    expect(videoSourceTools.map((tool) => tool.name)).not.toContain(
      'import_source',
    );
    expect(unapprovedGate.deniedCapabilities).toContain('video:edit');
    expect(unapprovedTools).toEqual([
      'mcp__video__analyze_source',
      'mcp__video__suggest_cuts',
      'mcp__video__get_packed_transcript',
      'mcp__video__inspect_source_range',
      'mcp__video__run_bounded_qa',
    ]);

    const approvedGate = computeVideoPluginRunGate(plugin, {
      approvedCapabilities: plugin.capabilities,
      lastReviewedDigest: plugin.manifestDigest,
    });
    const approvedTools = buildExactAllowedToolsForVideoPluginRun(
      [{ serverName: 'video', tools: videoSourceTools }],
      approvedGate,
    );
    const snapshot = createVideoPluginRunSnapshot(approvedGate, {
      allowedTools: approvedTools,
      enabledMcpServers: ['video'],
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    expect(approvedGate.grantedCapabilities).toEqual([
      'media:transcribe',
      'prompt:inject',
      'video:analyze',
      'video:edit',
    ]);
    expect(approvedTools).toContain('mcp__video__apply_cut_plan');
    expect(snapshot.payload).toMatchObject({
      allowedTools: approvedTools,
      enabledMcpServers: ['video'],
    });
  });
});

function createPlugin(scope: LoadedPlugin['scope']) {
  const manifest = baseManifest();
  const genericManifest = {
    name: manifest.name,
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

  return resolveVideoPlugin({
    manifest,
    rootDir: `/tmp/${manifest.name}`,
    manifestPath: `/tmp/${manifest.name}/video-plugin.json`,
    substratePlugin: {
      manifest: genericManifest,
      scope,
      path: `/tmp/${manifest.name}`,
      skills: [],
    },
  });
}

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
      pipeline: {
        stages: [
          { id: 'research', atoms: ['research-search'] },
          { id: 'storyboard', atoms: ['storyboard-draft'] },
          { id: 'visuals', atoms: ['ai-image'] },
        ],
      },
      output: { preset: 'social-vertical' },
      capabilities: [
        'prompt:inject',
        'research:web',
        'media:generate',
        'network:youtube',
      ],
      networkAccess: {
        allowedHosts: ['example.com'],
        allowedPaths: { 'example.com': ['/research/'] },
        reason: 'Research and optional YouTube acquisition.',
      },
    },
  };
}

function createAutoCutPlugin() {
  const manifest: VideoPluginManifest = {
    specVersion: '1.0.0',
    name: 'talking-head-auto-cut',
    title: 'Talking Head Auto-cut',
    compatibility: {
      neuma: '>=26.6.15 <27.0.0',
      videoPluginApi: '^1.0.0',
    },
    description: 'Analyze source footage and apply approved word-safe cuts.',
    video: {
      kind: 'flow',
      mode: 'explainer',
      aspectRatios: ['16:9'],
      engine: { id: 'html' },
      pipeline: {
        stages: [
          { id: 'transcribe', atoms: ['source-transcribe'] },
          { id: 'analyze', atoms: ['source-analyze'] },
          { id: 'plan-cuts', atoms: ['auto-cut-plan'] },
          { id: 'assemble', atoms: ['timeline-assemble'] },
          { id: 'preview', atoms: ['render-preview'] },
          { id: 'qa', atoms: ['qa-check'] },
        ],
      },
      genui: {
        surfaces: [
          {
            id: 'strategy-confirmation',
            kind: 'confirmation',
            persist: 'project',
            title: 'Auto-cut strategy',
            prompt: 'Approve the proposed strategy before timeline mutation.',
            capabilitiesRequired: [
              'media:transcribe',
              'video:analyze',
              'video:edit',
            ],
          },
        ],
      },
      output: { preset: 'web-1080p' },
      capabilities: [
        'prompt:inject',
        'media:transcribe',
        'video:analyze',
        'video:edit',
      ],
      networkAccess: { allowedHosts: ['none'] },
    },
  };
  const genericManifest = {
    name: manifest.name,
    version: '1.0.0',
    description: 'Talking-head auto-cut plugin',
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
      scope: 'bundled',
      path: `/tmp/${manifest.name}`,
      skills: [],
    },
  });
}

function mockTool(name: string): NamedMcpToolDefinition {
  return { name };
}
