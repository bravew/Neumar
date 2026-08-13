import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  selectTemplate,
  writeContentGraph,
  writeTemplateVariables,
} from '@/shared/video/content-graph/persistence';
import { recordVideoResearchBrief } from '@/shared/video/plugins/atoms/research';
import {
  buildVideoHtmlTemplateContext,
  buildVideoSessionPrompt,
} from '@/shared/video/session-prompt';
import { createProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

describe('video session prompt', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-session-prompt-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('injects selected HTML template and content graph context', async () => {
    const project = await createProject({
      name: 'HTML market recap',
      template: 'custom',
      prompt: 'Create a market recap HTML video',
    });
    await selectTemplate(project.id, 'frame-clean-title');
    await writeTemplateVariables(project.id, {
      headline: 'S&P closing recap',
    });
    await writeContentGraph(project.id, {
      schemaVersion: 1,
      intent: 'single-frame',
      nodes: [
        {
          id: 'intro',
          kind: 'text',
          text: 'S&P closing recap',
          durationSec: 5,
        },
      ],
      edges: [],
    });

    const htmlTemplateContext = await buildVideoHtmlTemplateContext(project.id);
    const prompt = buildVideoSessionPrompt(project, { htmlTemplateContext });

    expect(prompt).toContain('## HTML / Motion Template Context');
    expect(prompt).toContain('"selectedTemplateId": "frame-clean-title"');
    expect(prompt).toContain('"name": "Clean Title Card"');
    expect(prompt).toContain('"headline": "S&P closing recap"');
    expect(prompt).toContain('"nodeCount": 1');
    expect(prompt).toContain('video_save_as_template');
  });

  it('injects active editor selection and current-context guidance', () => {
    const project = projectWithTimeline();

    const prompt = buildVideoSessionPrompt(project, {
      selectedSceneId: 'scene-1',
      aspectRatio: '16:9',
      editorSelection: {
        playheadMs: 1000,
        selectedClipIds: ['clip-image-1'],
        previewFrame: {
          atMs: 1000,
          sceneId: 'scene-1',
          clipId: 'clip-image-1',
          aspectRatio: '16:9',
          source: 'timeline-preview',
        },
      },
    });

    expect(prompt).toContain('## Active Editor Context');
    expect(prompt).toContain('video_get_current_context');
    expect(prompt).toContain('clip.setTransform');
    expect(prompt).toContain(
      'When video_list_overlay_presets returns taste metadata',
    );
    expect(prompt).toContain('video_save_overlay_style_from_template');
    expect(prompt).toContain('video_save_user_overlay_document');
    expect(prompt).toContain('explicitly opts into custom document generation');
    expect(prompt).toContain('video_apply_overlay_motion_template');
    expect(prompt).toContain('avoidWhen');
    expect(prompt).toContain('Do not read or edit project.json directly');
    expect(prompt).toContain('"selectedClipIds": [');
    expect(prompt).toContain('"clip-image-1"');
    expect(prompt).toContain('"previewFrame"');
    expect(prompt).toContain('"sourceTimeMs": 1000');
  });

  it('injects the latest persisted research brief', async () => {
    const project = await createProject({
      name: 'Launch recap',
      template: 'custom',
      prompt: 'Make a factual launch recap',
    });
    const { brief } = await recordVideoResearchBrief(project.id, {
      topic: 'Acme launch',
      findings: ['Acme launched its handheld scanner in Toronto.'],
      facts: { venue: 'Toronto Convention Centre' },
      suggestedBeats: ['Open with the product reveal.'],
      citations: [
        {
          title: 'Launch article',
          url: 'https://example.com/acme-launch',
        },
      ],
    });

    const prompt = buildVideoSessionPrompt(project, { researchBrief: brief });

    expect(prompt).toContain('## Research Brief');
    expect(prompt).toContain('Acme launched its handheld scanner in Toronto');
    expect(prompt).toContain('"venue": "Toronto Convention Centre"');
    expect(prompt).toContain('https://example.com/acme-launch');
    expect(prompt).toContain('video_record_research_brief');
  });

  it('injects active plugin pipeline guidance when granted', () => {
    const project = projectWithTimeline();
    const prompt = buildVideoSessionPrompt(project, {
      plugin: {
        id: 'social-reel',
        title: 'Social Reel',
        version: '1.0.0',
        promptGuide:
          '## Active Video Plugin: Social Reel\nRun the plugin pipeline in order.',
        stageChecklist: [
          'research: research-search (optional)',
          'qa: render-preview, qa-check (required, repeat until qa.pass || iterations>=2)',
        ],
      },
    });

    expect(prompt).toContain('## Active Video Plugin: Social Reel');
    expect(prompt).toContain('Stage checklist:');
    expect(prompt).toContain(
      '- [ ] qa: render-preview, qa-check (required, repeat until qa.pass || iterations>=2)',
    );
    expect(prompt).toContain('Respect each stage order');
  });

  it('injects explicitly selected project assets', () => {
    const project = projectWithTimeline();

    const prompt = buildVideoSessionPrompt(project, {
      projectAssetIds: ['asset-image-1'],
    });
    const expectedPath = path.join(
      workDir,
      'videos/project-1/assets/frame.png',
    );

    expect(prompt).toContain('## Selected Project Assets');
    expect(prompt).toContain('"selectedProjectAssetIds": [');
    expect(prompt).toContain('"asset-image-1"');
    expect(prompt).toContain(`"filePath": "${expectedPath}"`);
    expect(prompt).toContain(
      'For selected image edits like reducing reflections',
    );
    expect(prompt).toContain('mcp__media__media_generate_image');
    expect(prompt).toContain('reference_image_url');
    expect(prompt).toContain('Do not write or run Python/Pillow scripts');
    expect(prompt).toContain(
      'These are the project assets the user explicitly selected for this turn.',
    );
  });

  it('marks referenced selected project assets as requiring hydration', () => {
    const project = projectWithTimeline();
    project.assets.push({
      id: 'asset-cloud-1',
      kind: 'image',
      source: 'downloaded',
      path: 'catalog:cloud-image-1',
      materializationState: 'referenced',
      metadata: { durationMs: 0, width: 4000, height: 3000 },
      provenance: {
        provider: 'immich',
        sourceDisplayName: '20260529_111719.jpg',
        catalogAssetId: 'cloud-image-1',
        thumbnailUrl: 'http://localhost:5126/api/assets/thumb/cloud-image-1',
      },
    });

    const prompt = buildVideoSessionPrompt(project, {
      projectAssetIds: ['asset-cloud-1'],
    });

    expect(prompt).toContain('"materializationState": "referenced"');
    expect(prompt).toContain('"renderable": false');
    expect(prompt).toContain('"requiresHydration": true');
    expect(prompt).toContain('"hydrateWith": "video_attach_asset"');
    expect(prompt).toContain('"assetId": "asset-cloud-1"');
    expect(prompt).toContain(
      'If a selected image asset is referenced or requiresHydration',
    );
    expect(prompt).toContain('Do not pass catalog:, thumbnailUrl');
  });
});

function projectWithTimeline(): VideoProject {
  const now = '2026-06-14T00:00:00.000Z';
  return {
    schemaVersion: 2,
    id: 'project-1',
    name: 'Timeline context',
    template: 'custom',
    prompt: 'Improve the selected image framing',
    assets: [
      {
        id: 'asset-image-1',
        kind: 'image',
        source: 'user',
        path: 'videos/project-1/assets/frame.png',
        metadata: { durationMs: 0, width: 1254, height: 1254 },
      },
    ],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    storyboard: {
      status: 'edited',
      intent: 'Selected image demo',
      totalDurationMs: 5000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 5000,
          intent: 'Show selected image',
          caption: { text: 'Animation' },
          assetPlan: { kind: 'existing', assetId: 'asset-image-1' },
        },
      ],
    },
    scenes: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 5000,
      fps: 30,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video',
          muted: false,
          locked: false,
          order: 0,
          clips: [
            {
              id: 'clip-image-1',
              kind: 'image',
              name: 'Animation',
              sourceRef: { kind: 'asset', assetId: 'asset-image-1' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 5000,
              trimStartMs: 0,
              trimEndMs: 5000,
              transforms: {
                scaleX: 1,
                scaleY: 1,
                positionX: 0.5,
                positionY: 0.5,
              },
            },
          ],
        },
      ],
    },
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}
