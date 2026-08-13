import type { ContentGraph } from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import {
  ContentGraphCompileError,
  HTML_FRAME_PLACEHOLDER_ASSET_ID,
  compileContentGraphToStoryboard,
} from '@/shared/video/content-graph/compile';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';

function fakeTemplate(partial: Partial<GalleryTemplate> = {}): GalleryTemplate {
  return {
    id: 'frame-data-bars',
    rootKind: 'branding',
    rootDir: '/tmp/branding',
    metadataPath: '/tmp/branding/frame-data-bars/template.video.yaml',
    warnings: [],
    metadata: {
      spec_version: 1 as const,
      id: 'frame-data-bars',
      name: 'Data Bars',
      engine: 'html',
      source_entry: 'source/index.html',
      category: 'data-viz',
      tags: [],
      output: {
        formats: ['mp4'],
        default_format: 'mp4',
        resolution: {
          default: { width: 1920, height: 1080 },
          supported_aspects: ['16:9'],
        },
        fps: { default: 30, supported: [30, 60] },
        duration: { type: 'variable', min_sec: 3, max_sec: 60 },
        alpha: false,
        audio: { supported: true, expected_inputs: ['bgm'] },
      },
      inputs: { schema: { type: 'object' } },
      license: {
        spdx: 'Apache-2.0',
        attribution_required: false,
        redistribution_allowed: true,
        commercial_use: true,
      },
      version: '0.1.0',
    },
    ...partial,
  };
}

describe('compileContentGraphToStoryboard', () => {
  it('lowers a 3-node graph to a 3-scene storyboard in topo order', () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'data-viz',
      nodes: [
        { id: 'outro', kind: 'text', text: 'Bye', durationSec: 2 },
        { id: 'intro', kind: 'text', text: 'Hi', durationSec: 3 },
        { id: 'core', kind: 'data', data: { x: 1 }, durationSec: 5 },
      ],
      edges: [
        { from: 'intro', to: 'core', kind: 'dependency' },
        { from: 'core', to: 'outro', kind: 'dependency' },
      ],
    };
    const out = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    expect(out.storyboard.scenes.map((s) => s.id)).toEqual([
      'cg-intro',
      'cg-core',
      'cg-outro',
    ]);
    expect(out.storyboard.totalDurationMs).toBe(3_000 + 5_000 + 2_000);
    expect(out.nodeIdToSceneId).toEqual({
      intro: 'cg-intro',
      core: 'cg-core',
      outro: 'cg-outro',
    });
  });

  it('stamps each scene with the html placeholder + htmlFrameSeed', () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [{ id: 'only', kind: 'text', text: 'hi', durationSec: 4 }],
      edges: [],
    };
    const out = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate({ id: 'frame-bold-title' }),
      variables: { brand: 'Neumar' },
    });
    const scene = out.storyboard.scenes[0]!;
    expect(scene.assetPlan).toEqual({
      kind: 'existing',
      assetId: HTML_FRAME_PLACEHOLDER_ASSET_ID,
    });
    expect(scene.htmlFrameSeed).toEqual({
      nodeId: 'only',
      templateId: 'frame-bold-title',
      engine: 'html',
      variables: { brand: 'Neumar', text: 'hi' },
    });
  });

  it('uses the per-node duration when set, falling back to the default', () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'other',
      nodes: [
        { id: 'a', kind: 'text', text: 'no-duration' },
        { id: 'b', kind: 'text', text: 'has', durationSec: 7 },
      ],
      edges: [],
    };
    const out = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
      defaultDurationSec: 4,
    });
    expect(out.storyboard.scenes.map((s) => s.durationMs)).toEqual([
      4_000, 7_000,
    ]);
  });

  it('honours node.frameIntent if set, else falls back to node.kind', () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'other',
      nodes: [
        { id: 'a', kind: 'text', text: 'x', frameIntent: 'hero-title' },
        { id: 'b', kind: 'data', data: 42 },
      ],
      edges: [],
    };
    const out = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    expect(out.storyboard.scenes.map((s) => s.intent)).toEqual([
      'hero-title',
      'data',
    ]);
  });

  it('throws ContentGraphCompileError when validation fails', () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [],
      edges: [],
    };
    expect(() =>
      compileContentGraphToStoryboard(graph, { template: fakeTemplate() }),
    ).toThrow(ContentGraphCompileError);
  });

  it('passes the graph intent through to the storyboard', () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'data-viz',
      nodes: [{ id: 'x', kind: 'text', text: 'x', durationSec: 2 }],
      edges: [],
    };
    const out = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    expect(out.storyboard.intent).toBe('data-viz');
  });
});
