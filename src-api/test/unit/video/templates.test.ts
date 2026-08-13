import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import {
  readContentGraph,
  readFrameHtml,
  readSelectedTemplate,
  writeContentGraph,
  writeFrameHtml,
} from '@/shared/video/content-graph/persistence';
import { createProject, writeProject } from '@/shared/video/store';
import {
  createProjectFromTemplate,
  expandTemplateStoryboard,
  saveProjectAsTemplate,
} from '@/shared/video/templates/agent-bridge';
import { BUILTIN_VIDEO_TEMPLATES } from '@/shared/video/templates/builtin';
import type { VideoTemplate } from '@/shared/video/templates/types';
import { VideoTemplateSchema } from '@/shared/video/templates/validator';
import type { MediaItem, Storyboard } from '@/shared/video/types';

describe('video templates', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-templates-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('ships valid built-in template IR', () => {
    expect(BUILTIN_VIDEO_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    for (const template of BUILTIN_VIDEO_TEMPLATES) {
      expect(VideoTemplateSchema.parse(template).id).toBe(template.id);
    }
  });

  it('registers Remotion-specific templates with composition ids', () => {
    expect(
      BUILTIN_VIDEO_TEMPLATES.filter(
        (template) => template.renderer === 'remotion',
      ).map((template) => template.compositionId),
    ).toEqual(
      expect.arrayContaining([
        'ExplainerLowerThirdsTemplate',
        'PodcastWaveformTemplate',
      ]),
    );
  });

  it('expands template inputs into deterministic storyboard scenes', () => {
    const template = BUILTIN_VIDEO_TEMPLATES.find(
      (candidate) => candidate.id === 'punch-in-ugc-15s-vertical',
    );
    expect(template).toBeTruthy();

    const storyboard = expandTemplateStoryboard(template!, {
      hook: 'Stop scrolling',
      product: 'Neumar Clips',
      cta: 'Try it today',
      brandColor: '#ff5722',
    });

    expect(storyboard.status).toBe('draft');
    expect(storyboard.totalDurationMs).toBe(15_000);
    expect(storyboard.intent).toContain('Stop scrolling');
    expect(storyboard.scenes[0]?.caption?.text).toBe('Stop scrolling');
    expect(storyboard.scenes.at(-1)?.intent).toContain('Try it today');
  });

  it('rejects executable content in custom template text', () => {
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'unsafe-template',
      displayName: '<script>alert(1)</script>',
      source: 'custom',
    };

    expect(() => VideoTemplateSchema.parse(template)).toThrow(
      /executable content/i,
    );
  });

  it('validates optional template intro and outro bookends', () => {
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'bookend-template',
      storyboardSeed: {
        ...BUILTIN_VIDEO_TEMPLATES[0]!.storyboardSeed,
        intro: { kind: 'fade', durationMs: 500 },
        outro: { kind: 'fade', durationMs: 800 },
      },
      source: 'custom',
    } satisfies VideoTemplate;

    expect(VideoTemplateSchema.parse(template).storyboardSeed).toMatchObject({
      intro: { kind: 'fade', durationMs: 500 },
      outro: { kind: 'fade', durationMs: 800 },
    });

    expect(() =>
      VideoTemplateSchema.parse({
        ...template,
        id: 'bad-bookend-template',
        storyboardSeed: {
          ...template.storyboardSeed,
          intro: { kind: 'fade', durationMs: 5000 },
        },
      }),
    ).toThrow();
  });

  it('validates optional HTML content-graph payloads on storyboard templates', () => {
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'html-draft-template',
      source: 'custom',
      html: {
        engine: 'html',
        aspectRatio: '16:9',
        durationSec: 5,
        contentGraph: {
          schemaVersion: 1,
          intent: 'single-frame',
          nodes: [
            {
              id: 'intro',
              kind: 'text',
              text: 'A reusable HTML title frame',
              durationSec: 5,
            },
          ],
          edges: [],
        },
        frameHtml: {
          intro: '<div data-hv-text="headline">Reusable title</div>',
        },
        provenance: {
          templateId: 'frame-clean-title',
          sourceUrls: ['https://example.com/source'],
          agentModel: 'claude-sonnet',
        },
      },
    } satisfies VideoTemplate;

    expect(VideoTemplateSchema.parse(template).html).toMatchObject({
      engine: 'html',
      aspectRatio: '16:9',
      durationSec: 5,
    });
  });

  it('validates HTML source payloads without the template text length limit', () => {
    const longHtml = `<script>window.__ok = true;</script><main>${'x'.repeat(5000)}</main>`;
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'long-html-draft-template',
      source: 'custom',
      html: {
        engine: 'html',
        aspectRatio: '16:9',
        durationSec: 5,
        contentGraph: {
          schemaVersion: 1,
          intent: 'single-frame',
          nodes: [
            {
              id: 'intro',
              kind: 'text',
              text: 'Long frame',
            },
          ],
          edges: [],
        },
        frameHtml: {
          intro: longHtml,
        },
      },
    };

    expect(VideoTemplateSchema.parse(template).html?.frameHtml.intro).toBe(
      longHtml,
    );
  });

  it('rejects executable URL content in HTML template payloads', () => {
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'unsafe-html-draft-template',
      source: 'custom',
      html: {
        engine: 'html',
        aspectRatio: '16:9',
        durationSec: 5,
        contentGraph: {
          schemaVersion: 1,
          intent: 'single-frame',
          nodes: [
            {
              id: 'intro',
              kind: 'text',
              text: 'Unsafe frame',
            },
          ],
          edges: [],
        },
        frameHtml: {
          intro: '<a href="javascript:alert(1)">Bad link</a>',
        },
      },
    };

    expect(() => VideoTemplateSchema.parse(template)).toThrow(
      /executable URL content/i,
    );
  });

  it('validates advanced template transition specs', () => {
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'advanced-transition-template',
      storyboardSeed: {
        ...BUILTIN_VIDEO_TEMPLATES[0]!.storyboardSeed,
        scenes: [
          {
            ...BUILTIN_VIDEO_TEMPLATES[0]!.storyboardSeed.scenes[0]!,
            transition: {
              kind: 'flip',
              direction: 'from-left',
              durationMs: 750,
            },
          },
        ],
      },
      source: 'custom',
    } satisfies VideoTemplate;

    expect(
      VideoTemplateSchema.parse(template).storyboardSeed.scenes[0]?.transition,
    ).toEqual({
      kind: 'flip',
      direction: 'from-left',
      durationMs: 750,
    });

    expect(() =>
      VideoTemplateSchema.parse({
        ...template,
        id: 'bad-transition-direction-template',
        storyboardSeed: {
          ...template.storyboardSeed,
          scenes: [
            {
              ...template.storyboardSeed.scenes[0]!,
              transition: { kind: 'iris', direction: 'from-left' },
            },
          ],
        },
      }),
    ).toThrow(/does not support direction/i);

    expect(() =>
      VideoTemplateSchema.parse({
        ...template,
        id: 'bad-transition-kind-template',
        storyboardSeed: {
          ...template.storyboardSeed,
          scenes: [
            {
              ...template.storyboardSeed.scenes[0]!,
              transition: { kind: 'sparkle-wipe' },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it('resolves asset-slot template plans to project asset ids', () => {
    const template = {
      ...BUILTIN_VIDEO_TEMPLATES[0]!,
      id: 'asset-slot-template',
      displayName: 'Asset slot template',
      inputs: [
        {
          key: 'heroAsset',
          kind: 'asset',
          label: 'Hero asset',
          required: true,
          assetKind: 'image',
        },
      ],
      storyboardSeed: {
        intent: 'Use {{heroAsset}}',
        scenes: [
          {
            durationMs: 1000,
            intent: 'Show the selected hero asset.',
            assetPlan: {
              kind: 'existing',
              assetKey: 'heroAsset',
            },
          },
        ],
      },
      source: 'custom',
    } satisfies VideoTemplate;

    expect(VideoTemplateSchema.parse(template).id).toBe(template.id);

    const storyboard = expandTemplateStoryboard(
      template,
      { heroAsset: '/workspace/hero.png' },
      { heroAsset: 'asset-123' },
    );

    expect(storyboard.scenes[0]?.assetPlan).toEqual({
      kind: 'existing',
      assetId: 'asset-123',
      trimMs: undefined,
    });
  });

  it('saves project source assets as required template asset inputs', async () => {
    const project = await createProject({
      name: 'Reusable testimonial',
      template: 'custom',
    });
    const asset: MediaItem = {
      id: 'asset-source',
      kind: 'video',
      source: 'user',
      path: 'videos/reusable/assets/source.mp4',
      metadata: { durationMs: 5000 },
    };
    const storyboard: Storyboard = {
      status: 'approved',
      intent: 'Reusable project',
      totalDurationMs: 5000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 5000,
          intent: 'Show the customer clip.',
          assetPlan: { kind: 'existing', assetId: asset.id, trimMs: [0, 5000] },
        },
      ],
    };
    await writeProject({
      ...project,
      assets: [asset],
      brandKit: { primaryColor: '#123456', fontFamily: 'Inter' },
      storyboard,
    });

    const template = await saveProjectAsTemplate(project.id, {
      displayName: 'Reusable testimonial',
      category: 'testimonial',
      license: 'proprietary',
    });

    expect(template.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'asset1',
          kind: 'asset',
          assetKind: 'video',
          required: true,
        }),
        expect.objectContaining({
          key: 'brandPrimary',
          kind: 'color',
          default: '#123456',
        }),
      ]),
    );
    expect(template.storyboardSeed.scenes[0]?.assetPlan).toEqual({
      kind: 'existing',
      assetKey: 'asset1',
      trimMs: [0, 5000],
    });
    expect(template.styleDefaults.primaryColor).toBe('{{brandPrimary}}');
    expect(VideoTemplateSchema.parse(template).id).toBe(template.id);
  });

  it('saves content-graph projects as HTML gallery templates', async () => {
    const project = await createProject({
      name: 'Reusable HTML card',
      template: 'custom',
    });
    await writeContentGraph(project.id, {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'Yesterday closing recap',
          durationSec: 5,
        },
      ],
      edges: [],
    });
    await writeFrameHtml(
      project.id,
      'intro',
      '<section data-hv-text="headline">Yesterday close</section>',
    );

    const template = await saveProjectAsTemplate(project.id, {
      displayName: 'Reusable HTML card',
      category: 'recap',
      license: 'CC-BY',
    });

    expect(template.html).toMatchObject({
      engine: 'html',
      aspectRatio: '16:9',
      durationSec: 5,
    });
    expect(template.html?.contentGraph.nodes[0]?.id).toBe('intro');
    expect(template.html?.frameHtml.intro).toContain('data-hv-text');
    expect(VideoTemplateSchema.parse(template).id).toBe(template.id);

    const templateJsonPath = path.join(
      workDir,
      'videos',
      'templates',
      `${template.id}.json`,
    );
    await expect(fs.stat(templateJsonPath)).rejects.toThrow();
    await expect(
      fs.stat(
        path.join(
          workDir,
          '.neuma',
          'video-templates',
          template.id,
          'template.video.yaml',
        ),
      ),
    ).resolves.toBeTruthy();
  });

  it('creates a project from an HTML gallery template snapshot', async () => {
    const sourceProject = await createProject({
      name: 'Source HTML card',
      template: 'custom',
    });
    await writeContentGraph(sourceProject.id, {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'Yesterday closing recap',
          durationSec: 5,
        },
      ],
      edges: [],
    });
    await writeFrameHtml(
      sourceProject.id,
      'intro',
      '<section data-hv-text="headline">Yesterday close</section>',
    );
    const saved = await saveProjectAsTemplate(sourceProject.id, {
      displayName: 'Reusable HTML card',
      category: 'recap',
      license: 'CC0',
    });

    const { project, template } = await createProjectFromTemplate({
      templateId: saved.id,
      inputs: { headline: 'Updated close' },
      name: 'Draft from HTML card',
    });

    expect(project.name).toBe('Draft from HTML card');
    expect(project.template).toBe('custom');
    expect(project.templateSnapshot).toMatchObject({
      id: saved.id,
      displayName: 'Reusable HTML card',
      source: 'custom',
    });
    expect(template.html?.contentGraph.nodes[0]?.id).toBe('intro');
    expect(await readSelectedTemplate(project.id)).toBe(saved.id);
    expect((await readContentGraph(project.id))?.intent).toBe('single-frame');
    expect(await readFrameHtml(project.id, 'intro')).toContain(
      'Yesterday close',
    );
  });
});
