import { mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  type ContentGraph,
  topoSortContentGraph,
  totalContentGraphDurationSec,
  validateContentGraph,
} from '@neumar/video-ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  _resetVideoEngineRegistry,
  ensureBuiltinVideoEnginesRegistered,
  getVideoEngine,
  listVideoEnginesWithBuiltins,
} from '@/shared/video/engines';
import { HtmlEngineError } from '@/shared/video/engines/html/errors';
import type { ProjectSoundtrack } from '@/shared/video/soundtrack';
import type { FetchedSource } from '@/shared/video/source/ingest';
import {
  VIDEO_SOURCE_INGEST_PROVIDER,
  buildSourceProvenance,
} from '@/shared/video/source/provenance';
import {
  _resetTemplateGalleryCache,
  loadTemplateGallery,
} from '@/shared/video/templates/gallery-loader';
import type { MediaItem, VideoProject } from '@/shared/video/types';

// =============================================================================
// End-to-end test of every feature shipped in PR #230 (html-video foundations),
// composed across three realistic "HTML video" projects.
//
// What this exercises end-to-end:
//   1. Template gallery loader → reads template.video.yaml from disk, validates
//      via Zod schema, binds the declared engine to VIDEO_ENGINE_REGISTRY.
//   2. Content-graph IR → builds a 3-/1-/4-frame narrative graph per project,
//      validates, topo-sorts, sums per-frame durations.
//   3. Source ingestion → buildSourceProvenance stamps an article-derived
//      MediaItem with the upstream URL + ISO fetched timestamp.
//   4. Soundtrack model → attaches music + per-frame narration keyed by
//      content-graph node id, round-trips on disk.
//   5. Engine registry → both built-ins reachable; html adapter reports
//      installed=false and render() throws the typed not-implemented error
//      (Cross-Phase Principle 3 — no silent fallback).
//
// Where the actual HTML render pipeline lives — Phase 1 M3 (depends on
// @hyperframes/engine + chrome-headless-shell) — is explicitly out of scope
// per dev-doc/html-video/06-05/01-html-render-engine-and-adapter.md. This
// suite is the maximum-coverage e2e of what PR #230 actually ships.
// =============================================================================

let workDir: string;
let userRoot: string;
let brandingRoot: string;

const templateYaml = (id: string, engine: string, category: string) => `
spec_version: 1
id: ${id}
name: ${id}
description: ${id} test template
engine: ${engine}
source_entry: source/index.html
category: ${category}
tags: []
output:
  formats: [mp4]
  default_format: mp4
  resolution:
    default: { width: 1920, height: 1080 }
    supported_aspects: ["16:9"]
  fps: { default: 30, supported: [30, 60] }
  duration: { type: variable, min_sec: 3, max_sec: 60 }
  alpha: false
  audio: { supported: true, expected_inputs: [bgm, narration] }
inputs:
  schema:
    type: object
    properties:
      title: { type: string, maxLength: 200 }
license:
  spdx: Apache-2.0
  attribution_required: false
  redistribution_allowed: true
  commercial_use: true
provenance:
  origin: { kind: in-house }
  transformation: Original design.
version: 0.1.0
`;

async function writeTemplate(root: string, id: string, yaml: string) {
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'template.video.yaml'), yaml, 'utf8');
}

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'html-video-e2e-'));
  userRoot = path.join(workDir, 'user');
  brandingRoot = path.join(workDir, 'branding');

  _resetVideoEngineRegistry();
  _resetTemplateGalleryCache();
  ensureBuiltinVideoEnginesRegistered();

  // Branded defaults
  await writeTemplate(
    brandingRoot,
    'frame-data-bars',
    templateYaml('frame-data-bars', 'remotion', 'data-viz'),
  );
  await writeTemplate(
    brandingRoot,
    'frame-bold-title',
    templateYaml('frame-bold-title', 'remotion', 'social-shorts'),
  );
  await writeTemplate(
    brandingRoot,
    'frame-editorial-anchor',
    // Declares engine=html — pre-existing-and-registered, so engine binding
    // passes even though the html adapter throws on actual render. This is
    // the seam doing its job (Cross-Phase Principle 3).
    templateYaml('frame-editorial-anchor', 'html', 'documentary'),
  );
  // User override of one branded template (precedence is tested below).
  await writeTemplate(
    userRoot,
    'frame-bold-title',
    templateYaml('frame-bold-title', 'remotion', 'social-shorts'),
  );
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Gallery + engine registry
// -----------------------------------------------------------------------------

describe('template gallery loader', () => {
  it('loads three templates from branding + user, user wins on override', async () => {
    const result = await loadTemplateGallery({
      userRoot,
      brandingRoot,
      ttlMs: 0,
    });
    expect(result.issues).toEqual([]);
    expect(result.templates.map((t) => t.id).sort()).toEqual([
      'frame-bold-title',
      'frame-data-bars',
      'frame-editorial-anchor',
    ]);
    const override = result.templates.find((t) => t.id === 'frame-bold-title');
    expect(override?.rootKind).toBe('user');
  });
});

describe('engine registry', () => {
  it('honestly reports both engines as installed (Playwright + Remotion)', async () => {
    const engines = await listVideoEnginesWithBuiltins();
    const byId = Object.fromEntries(engines.map((e) => [e.id, e]));
    expect(byId.remotion?.installed).toBe(true);
    expect(byId.html?.installed).toBe(true);
    expect(byId.html?.capabilities.paradigms).toContain('html-css-gsap');
  });

  it('html engine validate() rejects a template ref with no sourcePath', () => {
    const html = getVideoEngine('html');
    const result = html.validate({ id: 't', engineId: 'html', sourcePath: '' });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('missing-source-path');
  });

  it('html engine render() surfaces typed HtmlEngineError on missing source', async () => {
    const html = getVideoEngine('html');
    await expect(
      html.render(
        {
          template: {
            id: 't',
            engineId: 'html',
            sourcePath: '/does/not/exist.html',
          },
          config: {
            format: 'mp4',
            resolution: { width: 320, height: 240 },
            fps: 30,
            duration: 0.5,
            outputPath: path.join(workDir, 'no-such-source.mp4'),
          },
        },
        { workDir: workDir },
      ),
    ).rejects.toBeInstanceOf(HtmlEngineError);
  });
});

// -----------------------------------------------------------------------------
// Three "HTML video" projects, planned end-to-end
// -----------------------------------------------------------------------------

interface ProjectFixture {
  name: string;
  templateId: 'frame-data-bars' | 'frame-bold-title' | 'frame-editorial-anchor';
  graph: ContentGraph;
  expectedOrder: string[];
  expectedDurationSec: number;
  source?: FetchedSource;
  soundtrack: ProjectSoundtrack;
}

const projects: ProjectFixture[] = [
  // --- Project A: data-viz explainer, 3 frames ---------------------------------
  {
    name: 'Q3 Metrics Explainer',
    templateId: 'frame-data-bars',
    graph: {
      schemaVersion: 1,
      intent: 'data-viz',
      synopsis: 'Q3 revenue, signups, retention',
      nodes: [
        // Out-of-order on purpose; topo sort + dependency edges fix it.
        {
          id: 'frame_outro',
          kind: 'text',
          text: 'Thanks for watching.',
          durationSec: 2,
        },
        {
          id: 'frame_intro',
          kind: 'entity',
          props: { logo: 'logo.svg', brand: 'Neumar' },
          durationSec: 3,
        },
        {
          id: 'frame_metrics',
          kind: 'data',
          data: { revenue: 12.4, signups: 18000, retention: 0.91 },
          durationSec: 6,
        },
      ],
      edges: [
        { from: 'frame_intro', to: 'frame_metrics', kind: 'dependency' },
        { from: 'frame_metrics', to: 'frame_outro', kind: 'dependency' },
      ],
    },
    expectedOrder: ['frame_intro', 'frame_metrics', 'frame_outro'],
    expectedDurationSec: 3 + 6 + 2,
    soundtrack: {
      musicAssetId: 'media:bgm-1',
      musicVolumeDb: -18,
      narrationVolumeDb: 0,
      narrationByFrame: {
        frame_intro: 'Welcome to our Q3 wrap-up.',
        frame_metrics: 'Revenue rose 12.4 percent quarter over quarter.',
        frame_outro: 'Thanks for watching.',
      },
      fadeInSec: 0.5,
      fadeOutSec: 1.5,
    },
  },
  // --- Project B: single-frame product reel ------------------------------------
  {
    name: 'Product Launch Reel',
    templateId: 'frame-bold-title',
    graph: {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [
        {
          id: 'intro_title',
          kind: 'text',
          text: 'Meet Neumar Studio',
          durationSec: 5,
        },
      ],
      edges: [],
    },
    expectedOrder: ['intro_title'],
    expectedDurationSec: 5,
    soundtrack: {
      // No music or narration — reel uses native template audio.
    },
  },
  // --- Project C: article → 4-frame editorial cut ------------------------------
  {
    name: 'Article-to-Video',
    templateId: 'frame-editorial-anchor',
    graph: {
      schemaVersion: 1,
      intent: 'explainer',
      synopsis: 'Derived from a fetched article',
      nodes: [
        {
          id: 'hook',
          kind: 'text',
          text: 'What 200 nautical miles really means.',
          durationSec: 4,
        },
        {
          id: 'key_stat',
          kind: 'data',
          data: { miles: 200, region: 'EEZ' },
          durationSec: 5,
        },
        // contrast edge between key_stat and counterpoint must NOT affect order.
        {
          id: 'counterpoint',
          kind: 'text',
          text: 'But coastal states disagree.',
          durationSec: 4,
        },
        {
          id: 'closing',
          kind: 'text',
          text: 'Subscribe for more.',
          durationSec: 3,
        },
      ],
      edges: [
        { from: 'hook', to: 'key_stat', kind: 'sequence' },
        { from: 'key_stat', to: 'counterpoint', kind: 'contrast' },
        { from: 'counterpoint', to: 'closing', kind: 'dependency' },
      ],
    },
    expectedOrder: ['hook', 'key_stat', 'counterpoint', 'closing'],
    expectedDurationSec: 4 + 5 + 4 + 3,
    source: {
      url: 'https://example.com/200nm-eez',
      title: '200 nautical miles, explained',
      markdown: '# 200nm\nBody body body.',
      kind: 'article',
      truncated: false,
    },
    soundtrack: {
      musicAssetId: 'media:bgm-3',
      narrationByFrame: {
        hook: 'Two hundred nautical miles.',
        key_stat: 'That is the standard EEZ boundary.',
        counterpoint: 'But coastal states often draw the line differently.',
        closing: 'Subscribe for more deep dives.',
      },
      fadeInSec: 0.25,
      // fadeOutSec omitted so default helper applies.
    },
  },
];

describe.each(projects)('html video project: $name', (fixture) => {
  it('content-graph validates with no errors', () => {
    const result = validateContentGraph(fixture.graph);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('topo-sorts into the expected play order', () => {
    expect(topoSortContentGraph(fixture.graph)).toEqual(fixture.expectedOrder);
  });

  it('computes the expected total duration', () => {
    expect(totalContentGraphDurationSec(fixture.graph)).toBe(
      fixture.expectedDurationSec,
    );
  });

  it('binds to a registered template (engine binding ok)', async () => {
    const gallery = await loadTemplateGallery({
      userRoot,
      brandingRoot,
      ttlMs: 0,
    });
    const tmpl = gallery.templates.find((t) => t.id === fixture.templateId);
    expect(tmpl).toBeDefined();
    // The engine declared by the template is registered.
    expect(['remotion', 'html']).toContain(tmpl!.metadata.engine);
  });

  it('stamps source provenance on a derived MediaItem when fed by article ingestion', () => {
    if (!fixture.source) return;
    const baseItem: MediaItem = {
      id: 'media:derived-1',
      kind: 'image',
      source: 'ai-image',
      path: 'workspace/derived-1.png',
      metadata: { durationMs: 0 } as MediaItem['metadata'],
      provenance: { provider: 'seedream-5-0', model: 'seedream-5-0' },
    };
    const stamped: MediaItem = {
      ...baseItem,
      provenance: {
        ...baseItem.provenance,
        ...buildSourceProvenance(fixture.source),
      },
    };
    expect(stamped.provenance?.sourceUrl).toBe(fixture.source.url);
    expect(stamped.provenance?.sourceDisplayName).toBe(fixture.source.title);
    expect(stamped.provenance?.sourceFetchedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(stamped.provenance?.provider).toBe(VIDEO_SOURCE_INGEST_PROVIDER);
    // Original generative model id is preserved.
    expect(stamped.provenance?.model).toBe('seedream-5-0');
  });

  it('round-trips the soundtrack across project save + load', async () => {
    const project: Pick<
      VideoProject,
      'id' | 'name' | 'soundtrack' | 'createdAt' | 'updatedAt'
    > = {
      id: `proj-${fixture.templateId}`,
      name: fixture.name,
      soundtrack: fixture.soundtrack,
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    };
    const filePath = path.join(workDir, `${project.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(project), 'utf8');
    const loaded = JSON.parse(
      await fs.readFile(filePath, 'utf8'),
    ) as typeof project;
    expect(loaded.soundtrack).toEqual(fixture.soundtrack);

    // narrationByFrame keys must be a subset of the content-graph node ids,
    // matching dev-doc/html-video/06-05/05-soundtrack-and-audio.md.
    const nodeIds = new Set(fixture.graph.nodes.map((n) => n.id));
    for (const key of Object.keys(loaded.soundtrack?.narrationByFrame ?? {})) {
      expect(nodeIds.has(key)).toBe(true);
    }
  });
});

// =============================================================================
// Render-path slice (Phase 1 M3 + Phase 2 M2): for each fixture project,
// lower the content-graph into a Storyboard, then materialize each scene
// via a stubbed adapter that produces real bytes on disk. Asserts the seam
// from IR → Storyboard → MediaItem-backed scenes is intact.
// =============================================================================

describe.each(projects)('render-path slice: $name', (fixture) => {
  it('lowers + materializes the content-graph into a render-ready storyboard', async () => {
    const { compileContentGraphToStoryboard } =
      await import('@/shared/video/content-graph/compile');
    const { materializeHtmlStoryboard } =
      await import('@/shared/video/content-graph/materialize');
    const { loadTemplateGallery } =
      await import('@/shared/video/templates/gallery-loader');

    const gallery = await loadTemplateGallery({
      userRoot,
      brandingRoot,
      ttlMs: 0,
    });
    const template = gallery.templates.find((t) => t.id === fixture.templateId);
    expect(template).toBeDefined();

    const compiled = compileContentGraphToStoryboard(fixture.graph, {
      template: template!,
    });

    expect(compiled.storyboard.scenes).toHaveLength(fixture.graph.nodes.length);
    expect(compiled.totalDurationMs).toBe(
      Math.round(fixture.expectedDurationSec * 1000),
    );
    expect(Object.keys(compiled.nodeIdToSceneId).sort()).toEqual(
      [...fixture.expectedOrder].sort(),
    );

    // Materialize with a stub adapter so the test stays hermetic.
    const adapter = {
      id: 'html',
      name: 'stub',
      upstreamVersion: 'test',
      capabilities: {
        paradigms: ['html-css-gsap'] as const,
        outputFormats: ['mp4'] as const,
        maxResolution: { width: 3840, height: 2160 },
        alpha: false,
        audio: 'multi' as const,
        subtitles: 'burn-in' as const,
        renderTarget: ['local-chromium'] as const,
        fps: [30],
        licensing: 'Apache-2.0',
      },
      isInstalled: () => true,
      validate: () => ({ ok: true, issues: [] }),
      async render(
        input: import('@/shared/video/engines/types').EngineRenderInput,
      ): Promise<import('@/shared/video/engines/types').EngineRenderOutput> {
        await fs.mkdir(path.dirname(input.config.outputPath), {
          recursive: true,
        });
        await fs.writeFile(input.config.outputPath, Buffer.alloc(32));
        return {
          outputPath: input.config.outputPath,
          meta: {
            durationSec:
              input.config.duration === 'auto'
                ? 5
                : Number(input.config.duration),
            fileSizeBytes: 32,
            actualResolution: input.config.resolution,
            fps: input.config.fps,
            renderedFrames: 1,
            renderWallClockSec: 0.01,
            engineVersion: 'stub/0.0.0',
          },
          diagnostics: [],
        };
      },
    } satisfies import('@/shared/video/engines/types').VideoEngineAdapter;

    const projWorkDir = path.join(
      workDir,
      `render-${fixture.templateId}-${crypto.randomUUID()}`,
    );
    let counter = 0;
    const result = await materializeHtmlStoryboard(compiled, {
      template: template!,
      workDir: projWorkDir,
      renderConfig: { width: 640, height: 360, fps: 30 },
      adapter,
      newId: () => `media-${++counter}`,
    });

    expect(result.mediaItems).toHaveLength(fixture.graph.nodes.length);
    for (const scene of result.storyboard.scenes) {
      expect(scene.assetPlan.kind).toBe('existing');
      if (scene.assetPlan.kind === 'existing') {
        expect(scene.assetPlan.assetId).toMatch(/^media-\d+$/);
      }
      // Each scene's MediaItem points at a real file on disk.
      const item = result.mediaItems.find(
        (m) =>
          scene.assetPlan.kind === 'existing' &&
          m.id === scene.assetPlan.assetId,
      );
      expect(item).toBeDefined();
      const stat = await fs.stat(item!.path);
      expect(stat.size).toBeGreaterThan(0);
    }
  });
});
