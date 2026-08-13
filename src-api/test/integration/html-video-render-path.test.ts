import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type ContentGraph } from '@neumar/video-ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compileContentGraphToStoryboard } from '@/shared/video/content-graph/compile';
import { materializeHtmlStoryboard } from '@/shared/video/content-graph/materialize';
import {
  _resetVideoEngineRegistry,
  ensureBuiltinVideoEnginesRegistered,
} from '@/shared/video/engines';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';

// Real-Playwright end-to-end render. Skipped unless VIDEO_EVAL=1 is set
// because launching Chromium + ffmpeg-muxing takes seconds per scene.
// This is the test that proves the full pipeline produces real MP4 bytes.
//
// Run:
//   VIDEO_EVAL=1 pnpm --filter neumar-api exec vitest run \
//     test/integration/html-video-render-path.test.ts

const enabled = process.env.VIDEO_EVAL === '1';
const describeReal = enabled ? describe : describe.skip;

let workDir: string;
let templateRoot: string;

const TEMPLATE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #111; color: #fff; font-family: system-ui; }
  .stage { display: flex; align-items: center; justify-content: center;
           height: 100vh; }
  h1 { font-size: 64px; opacity: 0; animation: fade 1s forwards; }
  @keyframes fade { to { opacity: 1; } }
</style></head>
<body><div class="stage"><h1 id="title">Rendered</h1></div>
<script>
  // Read the injected Neuma globals so the test confirms they reach
  // the page (Phase 1 M3 § 2 — Neuma-rename of __HV_VARS__).
  if (window.__NEUMA_VARS__ && window.__NEUMA_VARS__.title) {
    document.getElementById('title').textContent = window.__NEUMA_VARS__.title;
  }
</script>
</body></html>`;

beforeAll(async () => {
  if (!enabled) return;
  workDir = mkdtempSync(path.join(tmpdir(), 'html-render-eval-'));
  templateRoot = path.join(workDir, 'frame-test', 'source');
  await fs.mkdir(templateRoot, { recursive: true });
  await fs.writeFile(
    path.join(templateRoot, 'index.html'),
    TEMPLATE_HTML,
    'utf8',
  );
  _resetVideoEngineRegistry();
  ensureBuiltinVideoEnginesRegistered();
});

afterAll(() => {
  if (!enabled) return;
  rmSync(workDir, { recursive: true, force: true });
});

const fakeTemplate = (): GalleryTemplate => ({
  id: 'frame-test',
  rootKind: 'branding',
  rootDir: workDir,
  metadataPath: path.join(workDir, 'frame-test', 'template.video.yaml'),
  warnings: [],
  metadata: {
    spec_version: 1 as const,
    id: 'frame-test',
    name: 'Test',
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
      fps: { default: 24, supported: [24, 30] },
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

describeReal('VIDEO_EVAL=1 — starter template renders end-to-end', () => {
  it('frame-clean-title from branding/default/ renders to a valid MP4', async () => {
    const { loadTemplateGallery } =
      await import('@/shared/video/templates/gallery-loader');
    const { runHtmlMaterializerPrepass } =
      await import('@/shared/video/content-graph/queue-prepass');
    const repoRoot = path.resolve(
      (await import('node:url')).fileURLToPath(import.meta.url),
      '..',
      '..',
      '..',
      '..',
    );
    const brandingRoot = path.join(
      repoRoot,
      'branding',
      'default',
      'video-templates',
    );
    const gallery = await loadTemplateGallery({
      userRoot: path.join(workDir, 'user'),
      brandingRoot,
      ttlMs: 0,
    });
    const template = gallery.templates.find(
      (t) => t.id === 'frame-clean-title',
    );
    expect(template).toBeDefined();

    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'Starter Set',
          durationSec: 1,
        },
      ],
      edges: [],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: template!,
      variables: {
        title: 'Starter Set',
        subtitle: 'frame-clean-title renders end-to-end',
        accent_color: '#ff5a36',
        background: 'dark',
      },
    });
    const project = {
      id: 'proj-starter',
      name: 'starter',
      template: 'custom' as const,
      prompt: '',
      assets: [],
      storyboard: { ...compiled.storyboard, status: 'approved' as const },
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    };
    const result = await runHtmlMaterializerPrepass(project, {
      workspaceRoot: workDir,
      workDir,
      renderConfig: { width: 320, height: 180, fps: 24 },
      resolveTemplate: async () => template!,
    });
    expect(result.assets).toHaveLength(1);
    const item = result.assets[0]!;
    const stat = await fs.stat(item.path);
    expect(stat.size).toBeGreaterThan(1024);
    const head = await fs.readFile(item.path, { encoding: 'binary' });
    expect(head.slice(4, 8)).toBe('ftyp');
  }, 60_000);
});

describeReal('VIDEO_EVAL=1 — real Playwright render via queue prepass', () => {
  it('renders 2 frames via runHtmlMaterializerPrepass and re-uses cache on a second pass', async () => {
    const { runHtmlMaterializerPrepass } =
      await import('@/shared/video/content-graph/queue-prepass');

    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'data-viz',
      nodes: [
        { id: 'intro', kind: 'text', text: 'Hello Neuma', durationSec: 1 },
        { id: 'outro', kind: 'text', text: 'Bye Neuma', durationSec: 1 },
      ],
      edges: [{ from: 'intro', to: 'outro', kind: 'dependency' }],
    };
    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const project = {
      id: 'proj-eval',
      name: 'eval',
      template: 'custom' as const,
      prompt: '',
      assets: [],
      storyboard: { ...compiled.storyboard, status: 'approved' as const },
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    };
    const t0 = Date.now();
    const first = await runHtmlMaterializerPrepass(project, {
      workspaceRoot: workDir,
      workDir,
      renderConfig: { width: 320, height: 180, fps: 24 },
      resolveTemplate: async () => fakeTemplate(),
    });
    const firstWall = Date.now() - t0;
    expect(first.assets).toHaveLength(2);
    for (const item of first.assets) {
      const stat = await fs.stat(item.path);
      expect(stat.size).toBeGreaterThan(1024);
      const head = await fs.readFile(item.path, { encoding: 'binary' });
      expect(head.slice(4, 8)).toBe('ftyp');
    }

    // Second pass with identical seeds → cache hit; should be much faster.
    const t1 = Date.now();
    const second = await runHtmlMaterializerPrepass(project, {
      workspaceRoot: workDir,
      workDir,
      renderConfig: { width: 320, height: 180, fps: 24 },
      resolveTemplate: async () => fakeTemplate(),
    });
    const secondWall = Date.now() - t1;
    expect(second.assets).toHaveLength(2);
    expect(secondWall).toBeLessThan(firstWall / 2); // cache → fast
  }, 60_000);

  it('lowers, materializes, and produces real MP4 bytes on disk', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'data-viz',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'Hello Neuma',
          durationSec: 1,
        },
        {
          id: 'outro',
          kind: 'text',
          text: 'Bye Neuma',
          durationSec: 1,
        },
      ],
      edges: [{ from: 'intro', to: 'outro', kind: 'dependency' }],
    };

    const compiled = compileContentGraphToStoryboard(graph, {
      template: fakeTemplate(),
    });
    const result = await materializeHtmlStoryboard(compiled, {
      template: fakeTemplate(),
      workDir,
      renderConfig: { width: 320, height: 180, fps: 24 },
    });

    expect(result.mediaItems).toHaveLength(2);
    for (const item of result.mediaItems) {
      const stat = await fs.stat(item.path);
      expect(stat.size).toBeGreaterThan(1024); // > 1 KB of real MP4 bytes
      // MP4 file-type box: starts with 'ftyp' at offset 4.
      const head = await fs.readFile(item.path, { encoding: 'binary' });
      expect(head.slice(4, 8)).toBe('ftyp');
      expect(item.metadata.durationMs).toBeGreaterThan(0);
    }
  }, 60_000);
});
