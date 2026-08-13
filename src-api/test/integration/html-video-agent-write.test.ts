import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type ContentGraph } from '@neumar/video-ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compileContentGraphToStoryboard } from '@/shared/video/content-graph/compile';
import { materializeHtmlStoryboard } from '@/shared/video/content-graph/materialize';
import {
  readContentGraph,
  readFrameHtml,
  readSelectedTemplate,
  selectTemplate,
  writeContentGraph,
  writeFrameHtml,
} from '@/shared/video/content-graph/persistence';
import type {
  EngineRenderInput,
  EngineRenderOutput,
  VideoEngineAdapter,
} from '@/shared/video/engines/types';
import {
  getVideoProjectDirForRoot,
  getVideoWorkspaceRoot,
} from '@/shared/video/store';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';

// Phase 2 M3 end-to-end: drive the same flow an agent session would —
// select a template, write a content-graph, write one frame override —
// then run the materializer and assert the override was consumed.

let workDirRoot: string;
let originalWorkDir: string | undefined;
let projectId: string;

beforeAll(() => {
  workDirRoot = mkdtempSync(path.join(tmpdir(), 'agent-write-'));
  originalWorkDir = process.env.NEUMA_VIDEO_WORKDIR;
  process.env.NEUMA_VIDEO_WORKDIR = workDirRoot;
  projectId = 'agent-write-test';
});
afterAll(() => {
  rmSync(workDirRoot, { recursive: true, force: true });
  if (originalWorkDir === undefined) delete process.env.NEUMA_VIDEO_WORKDIR;
  else process.env.NEUMA_VIDEO_WORKDIR = originalWorkDir;
});

function fakeTemplate(): GalleryTemplate {
  return {
    id: 'frame-clean-title',
    rootKind: 'branding',
    rootDir: workDirRoot,
    metadataPath: path.join(
      workDirRoot,
      'tpl-root',
      'frame-clean-title',
      'template.video.yaml',
    ),
    warnings: [],
    metadata: {
      spec_version: 1 as const,
      id: 'frame-clean-title',
      name: 'Title',
      engine: 'html',
      source_entry: 'source/index.html',
      category: 'intro-outro',
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
  };
}

function fakeAdapter(): {
  adapter: VideoEngineAdapter;
  renders: EngineRenderInput[];
} {
  const renders: EngineRenderInput[] = [];
  const adapter: VideoEngineAdapter = {
    id: 'html',
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
      const buf = Buffer.from('stub-mp4');
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
  return { adapter, renders };
}

const graph = (
  nodes: ContentGraph['nodes'],
  edges: ContentGraph['edges'] = [],
): ContentGraph => ({
  schemaVersion: 1,
  intent: 'explainer',
  nodes,
  edges,
});

describe('agent-write flow (Phase 2 M3)', () => {
  it('persists template selection, content-graph, and frame override; materializer consumes the override', async () => {
    // 1. Select template (Slice C `video_select_template`).
    await selectTemplate(projectId, 'frame-clean-title');
    expect(await readSelectedTemplate(projectId)).toBe('frame-clean-title');

    // 2. Write content-graph (Slice D `video_write_content_graph`).
    const g = graph(
      [
        { id: 'intro', kind: 'text', text: 'Hi', durationSec: 1 },
        { id: 'outro', kind: 'text', text: 'Bye', durationSec: 1 },
      ],
      [{ from: 'intro', to: 'outro', kind: 'dependency' }],
    );
    await writeContentGraph(projectId, g);
    expect((await readContentGraph(projectId))?.nodes).toHaveLength(2);

    // 3. Write a per-frame HTML override for 'intro' only.
    await writeFrameHtml(
      projectId,
      'intro',
      '<html><body><h1>Agent-authored intro</h1></body></html>',
    );
    expect(await readFrameHtml(projectId, 'intro')).toContain('Agent-authored');
    expect(await readFrameHtml(projectId, 'outro')).toBeNull();

    // 4. Compile + materialize. Use the project dir as the materializer's
    // workDir so it finds the override file (same resolver Slice B's
    // queue prepass uses).
    const compiled = compileContentGraphToStoryboard(g, {
      template: fakeTemplate(),
    });
    const projectDir = getVideoProjectDirForRoot(
      getVideoWorkspaceRoot(),
      projectId,
    );
    const { adapter, renders } = fakeAdapter();
    await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir: projectDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => `media-${renders.length}`,
    });

    expect(renders).toHaveLength(2);
    // Scene 1 ('intro') used the override.
    expect(renders[0]?.template.sourcePath).toMatch(/frames\/intro\.html$/);
    expect(renders[0]?.template.version).toMatch(/^override:/);
    // Scene 2 ('outro') fell back to the template source.
    expect(renders[1]?.template.sourcePath).toMatch(/source\/index\.html$/);
    expect(renders[1]?.template.version).not.toMatch(/^override:/);
  });
});
