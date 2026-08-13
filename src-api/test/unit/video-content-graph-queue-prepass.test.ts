import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runHtmlMaterializerPrepass } from '@/shared/video/content-graph/queue-prepass';
import type {
  EngineRenderInput,
  EngineRenderOutput,
  VideoEngineAdapter,
} from '@/shared/video/engines/types';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';
import type {
  HtmlFrameSeed,
  Storyboard,
  StoryboardScene,
  VideoProject,
} from '@/shared/video/types';

let workspaceRoot: string;
let workDir: string;

beforeAll(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), 'queue-prepass-ws-'));
  workDir = mkdtempSync(path.join(tmpdir(), 'queue-prepass-wd-'));
});
afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

const fakeTemplate = (): GalleryTemplate => ({
  id: 'frame-bold',
  rootKind: 'branding',
  rootDir: workspaceRoot,
  metadataPath: path.join(workspaceRoot, 'frame-bold', 'template.video.yaml'),
  warnings: [],
  metadata: {
    spec_version: 1 as const,
    id: 'frame-bold',
    name: 'Bold',
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
      fps: { default: 30, supported: [30] },
      duration: { type: 'variable', min_sec: 1, max_sec: 10 },
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

function fakeAdapter(): VideoEngineAdapter {
  return {
    id: 'html',
    name: 'fake',
    upstreamVersion: 'test/0.0.0',
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
    async render(input: EngineRenderInput): Promise<EngineRenderOutput> {
      const buf = Buffer.from('stub-mp4-bytes');
      await fs.mkdir(path.dirname(input.config.outputPath), {
        recursive: true,
      });
      await fs.writeFile(input.config.outputPath, buf);
      const durationSec =
        input.config.duration === 'auto' ? 5 : Number(input.config.duration);
      return {
        outputPath: input.config.outputPath,
        meta: {
          durationSec,
          fileSizeBytes: buf.length,
          actualResolution: input.config.resolution,
          fps: input.config.fps,
          renderedFrames: Math.round(durationSec * input.config.fps),
          renderWallClockSec: 0.01,
          engineVersion: 'test/0.0.0',
        },
        diagnostics: [],
      };
    },
  };
}

const seededScene = (
  id: string,
  templateId: string,
  duration: number,
): StoryboardScene => ({
  id: `cg-${id}`,
  durationMs: duration,
  intent: 'data',
  assetPlan: { kind: 'existing', assetId: '__html-frame-placeholder__' },
  htmlFrameSeed: {
    nodeId: id,
    templateId,
    engine: 'html',
    variables: { text: id },
  } satisfies HtmlFrameSeed,
});

const buildStoryboard = (scenes: StoryboardScene[]): Storyboard => ({
  status: 'approved',
  intent: 'explainer',
  totalDurationMs: scenes.reduce((s, sc) => s + sc.durationMs, 0),
  costEstimateUsd: { low: 0, high: 0 },
  scenes,
});

const buildProject = (storyboard?: Storyboard): VideoProject => ({
  id: 'proj-1',
  name: 'Test',
  template: 'custom',
  prompt: 'test',
  assets: [],
  storyboard,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
});

describe('runHtmlMaterializerPrepass', () => {
  it('passes through projects whose storyboard has no html scenes', async () => {
    const proj = buildProject(
      buildStoryboard([
        {
          id: 'plain',
          durationMs: 1000,
          intent: 'data',
          assetPlan: { kind: 'existing', assetId: 'a' },
        },
      ]),
    );
    const resolveTemplate = vi.fn(async () => fakeTemplate());
    const result = await runHtmlMaterializerPrepass(proj, {
      workspaceRoot,
      workDir,
      resolveTemplate,
    });
    expect(result).toBe(proj);
    expect(resolveTemplate).not.toHaveBeenCalled();
  });

  it('passes through projects with no storyboard at all', async () => {
    const proj = buildProject(undefined);
    const result = await runHtmlMaterializerPrepass(proj, {
      workspaceRoot,
      workDir,
    });
    expect(result).toBe(proj);
  });

  it('materialises every html scene, fills assetIds, appends MediaItems', async () => {
    const sb = buildStoryboard([
      seededScene('a', 'frame-bold', 1_000),
      seededScene('b', 'frame-bold', 2_000),
      seededScene('c', 'frame-bold', 1_500),
    ]);
    const proj = buildProject(sb);
    const adapter = fakeAdapter();
    const renderSpy = vi.spyOn(adapter, 'render');
    const result = await runHtmlMaterializerPrepass(proj, {
      workspaceRoot,
      workDir,
      resolveTemplate: async () => fakeTemplate(),
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
    });
    expect(renderSpy).toHaveBeenCalledTimes(3);
    expect(result.storyboard?.scenes.map((s) => s.assetPlan)).toEqual([
      { kind: 'existing', assetId: expect.any(String) },
      { kind: 'existing', assetId: expect.any(String) },
      { kind: 'existing', assetId: expect.any(String) },
    ]);
    // Original assets unchanged; new MediaItems appended for each scene.
    expect(result.assets).toHaveLength(3);
    expect(result.assets.every((m) => m.source === 'html-engine')).toBe(true);
    renderSpy.mockRestore();
  });

  it('throws if the resolver cannot find the template', async () => {
    const proj = buildProject(
      buildStoryboard([seededScene('a', 'frame-missing', 1_000)]),
    );
    const resolveTemplate = vi.fn(async () => {
      throw new Error('not found in gallery');
    });
    await expect(
      runHtmlMaterializerPrepass(proj, {
        workspaceRoot,
        workDir,
        resolveTemplate,
      }),
    ).rejects.toThrow(/not found in gallery/);
  });
});
