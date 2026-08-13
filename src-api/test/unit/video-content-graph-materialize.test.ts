import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type ContentGraph } from '@neumar/video-ir';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  HTML_FRAME_PLACEHOLDER_ASSET_ID,
  compileContentGraphToStoryboard,
} from '@/shared/video/content-graph/compile';
import { materializeHtmlStoryboard } from '@/shared/video/content-graph/materialize';
import type {
  EngineRenderInput,
  EngineRenderOutput,
  VideoEngineAdapter,
} from '@/shared/video/engines/types';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';

let workDirRoot: string;
let workDir: string;

beforeAll(() => {
  workDirRoot = mkdtempSync(path.join(tmpdir(), 'materialize-'));
});
afterAll(() => rmSync(workDirRoot, { recursive: true, force: true }));

beforeEach(() => {
  // Per-test workDir so the html-frame cache populated in one `it` block
  // does not leak into the next one (caused stale cache hits and made the
  // signal-abort test resolve instead of reject).
  workDir = mkdtempSync(path.join(workDirRoot, 'wd-'));
});

const fakeTemplate = (): GalleryTemplate => ({
  id: 'frame-data-bars',
  rootKind: 'branding',
  rootDir: path.join(workDir, 'tpl-root'),
  metadataPath: path.join(
    workDir,
    'tpl-root',
    'frame-data-bars',
    'template.video.yaml',
  ),
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
        default: { width: 640, height: 360 },
        supported_aspects: ['16:9'],
      },
      fps: { default: 30, supported: [30, 60] },
      duration: { type: 'variable', min_sec: 1, max_sec: 60 },
      alpha: false,
      audio: { supported: false },
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
});

const fakeNativeTemplate = (): GalleryTemplate => ({
  id: 'frame-data-rollup',
  rootKind: 'branding',
  rootDir: path.join(workDir, 'tpl-root'),
  metadataPath: path.join(
    workDir,
    'tpl-root',
    'frame-data-rollup',
    'template.video.yaml',
  ),
  warnings: [],
  metadata: {
    spec_version: 1 as const,
    id: 'frame-data-rollup',
    name: 'Data Rollup',
    engine: 'remotion',
    source_entry: 'source/entry.ts',
    native: { compositionId: 'DataRollup' },
    category: 'data-viz',
    tags: [],
    output: {
      formats: ['mp4'],
      default_format: 'mp4',
      resolution: {
        default: { width: 640, height: 360 },
        supported_aspects: ['16:9'],
      },
      fps: { default: 30, supported: [30, 60] },
      duration: { type: 'variable', min_sec: 1, max_sec: 60 },
      alpha: false,
      audio: { supported: false },
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
});

function fakeAdapter(engineId: string = 'html'): {
  adapter: VideoEngineAdapter;
  renders: EngineRenderInput[];
} {
  const renders: EngineRenderInput[] = [];
  const adapter: VideoEngineAdapter = {
    id: engineId,
    name: 'fake',
    upstreamVersion: 'test',
    capabilities: {
      paradigms: ['html-css-gsap'],
      outputFormats: ['mp4'],
      maxResolution: { width: 3840, height: 2160 },
      alpha: false,
      audio: 'multi',
      subtitles: 'burn-in',
      renderTarget: ['local-chromium'],
      fps: [30],
      licensing: 'Apache-2.0',
    },
    isInstalled: () => true,
    validate: () => ({ ok: true, issues: [] }),
    async render(input): Promise<EngineRenderOutput> {
      renders.push(input);
      // Write a stub MP4 to the configured output path so the materializer
      // can register a real-sized MediaItem.
      const buf = Buffer.from('stub-mp4-bytes');
      await fs.mkdir(path.dirname(input.config.outputPath), {
        recursive: true,
      });
      await fs.writeFile(input.config.outputPath, buf);
      return {
        outputPath: input.config.outputPath,
        meta: {
          durationSec:
            input.config.duration === 'auto'
              ? 5
              : Number(input.config.duration),
          fileSizeBytes: buf.length,
          actualResolution: input.config.resolution,
          fps: input.config.fps,
          renderedFrames: Math.round(
            (input.config.duration === 'auto'
              ? 5
              : Number(input.config.duration)) * input.config.fps,
          ),
          renderWallClockSec: 0.02,
          engineVersion: 'test/0.0.0',
        },
        diagnostics: [],
      };
    },
  };
  return { adapter, renders };
}

describe('materializeHtmlStoryboard', () => {
  it('renders each scene + fills its assetId with a fresh MediaItem id', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [
        { id: 'a', kind: 'text', text: 'A', durationSec: 1 },
        { id: 'b', kind: 'text', text: 'B', durationSec: 2 },
        { id: 'c', kind: 'text', text: 'C', durationSec: 3 },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'dependency' },
        { from: 'b', to: 'c', kind: 'dependency' },
      ],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const { adapter, renders } = fakeAdapter();
    let counter = 0;
    const result = await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => `media-${++counter}`,
    });
    expect(renders).toHaveLength(3);
    expect(result.storyboard.scenes.map((s) => s.assetPlan)).toEqual([
      { kind: 'existing', assetId: 'media-1' },
      { kind: 'existing', assetId: 'media-2' },
      { kind: 'existing', assetId: 'media-3' },
    ]);
    expect(result.mediaItems).toHaveLength(3);
    expect(result.mediaItems[0]?.kind).toBe('video');
    expect(result.mediaItems[0]?.metadata.durationMs).toBe(1_000);
    expect(result.sceneIdToAssetId).toEqual({
      'cg-a': 'media-1',
      'cg-b': 'media-2',
      'cg-c': 'media-3',
    });
  });

  it('reports per-scene progress + halts on signal abort', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [
        { id: 'a', kind: 'text', text: 'A', durationSec: 1 },
        { id: 'b', kind: 'text', text: 'B', durationSec: 1 },
      ],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const { adapter, renders } = fakeAdapter();
    const ctrl = new AbortController();
    const progress: Array<[number, number, number]> = [];
    // Abort after the first render completes.
    const wrapped: VideoEngineAdapter = {
      ...adapter,
      async render(input, ctx) {
        const out = await adapter.render(input, ctx);
        ctrl.abort();
        return out;
      },
    };
    await expect(
      materializeHtmlStoryboard(compiled, {
        template: fakeTemplate(),
        workDir,
        renderConfig: { width: 640, height: 360, fps: 30 },
        adapter: wrapped,
        signal: ctrl.signal,
        onProgress: (i, t, pct) => progress.push([i, t, pct]),
        newId: () => `media-${renders.length}`,
      }),
    ).rejects.toThrow(/aborted/);
    // Only the first scene rendered.
    expect(renders).toHaveLength(1);
  });

  it('reuses the cache on a second run with the same seed (skips adapter.render)', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [{ id: 'only', kind: 'text', text: 'O', durationSec: 1 }],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const { adapter, renders } = fakeAdapter();
    // First run populates the cache.
    await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => `media-1`,
    });
    expect(renders).toHaveLength(1);
    // Second run with the same seed → cache hit → adapter.render NOT called.
    await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => `media-2`,
    });
    expect(renders).toHaveLength(1); // still 1 — cache hit served scene 2.
  });

  it('reads a per-frame HTML override at <workDir>/frames/<nodeId>.html', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [{ id: 'override-me', kind: 'text', text: 'X', durationSec: 1 }],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const { adapter, renders } = fakeAdapter();
    await fs.mkdir(path.join(workDir, 'frames'), { recursive: true });
    await fs.writeFile(
      path.join(workDir, 'frames', 'override-me.html'),
      '<html><body>OVERRIDE</body></html>',
      'utf8',
    );
    await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => 'media-override',
    });
    expect(renders).toHaveLength(1);
    expect(renders[0]?.template.sourcePath).toMatch(
      /frames\/override-me\.html$/,
    );
    expect(renders[0]?.template.version).toMatch(/^override:/);
  });

  it('renders a scene with a native Remotion template override', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'data-viz',
      nodes: [
        {
          id: 'metrics',
          kind: 'data',
          data: { revenue: 12.4, signups: 18_000, retention: 0.91 },
          durationSec: 2,
        },
      ],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    compiled.storyboard.scenes[0]!.htmlFrameSeed!.renderOverride = {
      mode: 'native',
      templateId: 'frame-data-rollup',
      engine: 'remotion',
      variables: { title: 'North star metrics', unit: '' },
    };
    const { adapter, renders } = fakeAdapter('remotion');
    await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      resolveTemplate: async (templateId) => {
        if (templateId === 'frame-data-rollup') return fakeNativeTemplate();
        return fakeTemplate();
      },
      workDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => 'media-native',
    });
    expect(renders).toHaveLength(1);
    expect(renders[0]?.template).toMatchObject({
      id: 'frame-data-rollup',
      engineId: 'remotion',
      mode: 'native',
      nativeCompositionId: 'DataRollup',
    });
    expect(renders[0]?.template.sourcePath).toMatch(
      /frame-data-rollup\/source\/entry\.ts$/,
    );
    expect(renders[0]?.variables).toMatchObject({
      title: 'North star metrics',
      items: [
        { label: 'Revenue', value: 12.4 },
        { label: 'Signups', value: 18_000 },
        { label: 'Retention', value: 0.91 },
      ],
    });
  });

  it('refuses to write to an unsafe scene-id path segment', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [{ id: 'x', kind: 'text', text: 'X', durationSec: 1 }],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    // Stamp a malicious scene id post-compile to simulate a future refactor
    // weakening the IR slug guard.
    compiled.storyboard.scenes[0]!.id = '../escape';
    const { adapter } = fakeAdapter();
    await expect(
      materializeHtmlStoryboard(compiled, {
        template: fakeTemplate(),
        workDir,
        renderConfig: { width: 640, height: 360, fps: 30 },
        adapter,
        newId: () => 'media-x',
      }),
    ).rejects.toThrow(/unsafe path segment/);
  });

  it('verifies no placeholder assetId remains after materialization', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [{ id: 'one', kind: 'text', text: 'One', durationSec: 1 }],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const { adapter } = fakeAdapter();
    const result = await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => 'media-only',
    });
    for (const scene of result.storyboard.scenes) {
      expect(
        scene.assetPlan.kind === 'existing' ? scene.assetPlan.assetId : 'n/a',
      ).not.toBe(HTML_FRAME_PLACEHOLDER_ASSET_ID);
    }
  });
});
