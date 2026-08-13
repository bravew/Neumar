import { describe, expect, it } from 'vitest';

import type { Asset } from '@/shared/assets/types';
import {
  catalogAssetToCreativeAssetDescriptor,
  deriveDesignCreativeWorkflowState,
  deriveVideoCreativeWorkflowState,
  designOutputToCreativeAssetDescriptor,
  videoMediaItemToCreativeAssetDescriptor,
} from '@/shared/creative-workflow';
import type { DesignProject } from '@/shared/types/design-mode';
import type {
  VideoLinkedSource,
  VideoMediaItem,
  VideoProject,
} from '@/shared/types/video';

const NOW = '2026-06-21T12:00:00.000Z';

describe('creative workflow model', () => {
  it('maps video projects into shared workflow steps without schema changes', () => {
    const project: VideoProject = {
      id: 'video-1',
      name: 'Launch reel',
      template: 'product-reel',
      prompt: 'Make a launch reel',
      script: 'Intro, demo, CTA',
      assets: [
        videoAsset({
          id: 'media-1',
          provenance: {
            provider: 'seedance',
            model: 'seedance-2',
            generatedFor: { sceneId: 'scene-1', clipId: 'clip-1' },
          },
        }),
      ],
      storyboard: {
        status: 'approved',
        intent: 'Launch reel',
        totalDurationMs: 4000,
        costEstimateUsd: { low: 1, high: 2 },
        scenes: [],
      },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 4000,
          clips: [{ id: 'clip-1', mediaId: 'media-1' }],
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const state = deriveVideoCreativeWorkflowState(project);

    expect(state.mode).toBe('video');
    expect(state.currentStep).toBe('review');
    expect(state.steps.map((step) => [step.step, step.status])).toEqual([
      ['intent', 'complete'],
      ['assets', 'complete'],
      ['plan', 'complete'],
      ['generate', 'complete'],
      ['review', 'active'],
      ['export', 'not-started'],
    ]);
    expect(state.assetSummary.generated).toBe(1);
    expect(state.assets[0]).toMatchObject({
      id: 'media-1',
      role: 'generated',
      provider: 'seedance',
      model: 'seedance-2',
      usageCount: 1,
      currentPlacement: {
        kind: 'video-project',
        projectId: 'video-1',
        sceneId: 'scene-1',
        clipId: 'clip-1',
        usedInProject: true,
      },
    });
  });

  it.each([
    {
      name: 'empty intent',
      project: videoProject({ prompt: '', script: undefined }),
      currentStep: 'intent',
      primaryActionId: 'describe-intent',
      stepStatus: 'active',
    },
    {
      name: 'intent with no assets',
      project: videoProject({ prompt: 'Make a reel', assets: [] }),
      currentStep: 'assets',
      primaryActionId: 'add-assets',
      stepStatus: 'active',
    },
    {
      name: 'unapproved storyboard',
      project: videoProject({
        prompt: 'Make a reel',
        assets: [videoAsset({ id: 'source-1' })],
        storyboard: {
          status: 'draft',
          intent: 'Draft reel',
          totalDurationMs: 4000,
          costEstimateUsd: { low: 1, high: 2 },
          scenes: [
            {
              id: 'story-scene-1',
              intent: 'Open the story',
              durationMs: 4000,
              assetPlan: { kind: 'existing', assetId: 'source-1' },
            },
          ],
        },
      }),
      currentStep: 'plan',
      primaryActionId: 'create-plan',
      stepStatus: 'active',
    },
    {
      name: 'approved plan without generated media',
      project: videoProject({
        prompt: 'Make a reel',
        assets: [videoAsset({ id: 'source-1' })],
        scenes: [{ id: 'scene-1', durationMs: 4000, clips: [] }],
      }),
      currentStep: 'generate',
      primaryActionId: 'generate-media',
      stepStatus: 'active',
    },
    {
      name: 'render failure',
      project: videoProject({
        prompt: 'Make a reel',
        assets: [
          videoAsset({
            id: 'media-1',
            provenance: {
              provider: 'seedance',
              generatedFor: { sceneId: 'scene-1' },
            },
          }),
        ],
        scenes: [
          {
            id: 'scene-1',
            durationMs: 4000,
            clips: [{ id: 'clip-1', mediaId: 'media-1' }],
          },
        ],
        render: { status: 'failed' },
      }),
      currentStep: 'review',
      primaryActionId: 'recover-failure',
      stepStatus: 'failed',
    },
    {
      name: 'render failure after storyboard with empty prompt',
      project: videoProject({
        prompt: '',
        script: undefined,
        assets: [
          videoAsset({
            id: 'media-1',
            provenance: {
              provider: 'seedance',
              generatedFor: { sceneId: 'scene-1' },
            },
          }),
        ],
        storyboard: {
          status: 'approved',
          intent: '',
          totalDurationMs: 4000,
          costEstimateUsd: { low: 1, high: 2 },
          scenes: [
            {
              id: 'story-scene-1',
              intent: 'Opening beat',
              durationMs: 4000,
              assetPlan: { kind: 'existing', assetId: 'media-1' },
            },
          ],
        },
        scenes: [
          {
            id: 'scene-1',
            durationMs: 4000,
            clips: [{ id: 'clip-1', mediaId: 'media-1' }],
          },
        ],
        render: { status: 'failed' },
      }),
      currentStep: 'review',
      primaryActionId: 'recover-failure',
      stepStatus: 'failed',
    },
    {
      name: 'rendered output without generated assets',
      project: videoProject({
        prompt: 'Make a reel',
        assets: [videoAsset({ id: 'source-1' })],
        storyboard: {
          status: 'approved',
          intent: 'Approved reel',
          totalDurationMs: 4000,
          costEstimateUsd: { low: 1, high: 2 },
          scenes: [
            {
              id: 'story-scene-1',
              intent: 'Open the story',
              durationMs: 4000,
              assetPlan: { kind: 'existing', assetId: 'source-1' },
            },
          ],
        },
        render: { status: 'done', outputPath: '/tmp/render.mp4' },
      }),
      currentStep: 'export',
      primaryActionId: 'export-output',
      stepStatus: 'active',
    },
  ] as const)(
    'maps video workflow branch: $name',
    ({ project, currentStep, primaryActionId, stepStatus }) => {
      const state = deriveVideoCreativeWorkflowState(project);

      expect(state.currentStep).toBe(currentStep);
      expect(state.primaryAction.id).toBe(primaryActionId);
      expect(
        state.steps.find((step) => step.step === currentStep)?.status,
      ).toBe(stepStatus);
    },
  );

  it('maps design projects into the same workflow vocabulary', () => {
    const project: DesignProject = {
      id: 'design-1',
      title: 'Hero refresh',
      surface: 'image',
      intent: 'media',
      status: 'ready',
      skillId: null,
      designSystemId: null,
      inspirationDesignSystemIds: [],
      craftRefs: ['brief.md'],
      brief: { audience: 'operators' },
      outputs: [
        {
          id: 'output-1',
          kind: 'png',
          path: '/tmp/hero.png',
          mime: 'image/png',
          provider: 'openai',
          model: 'image-1',
          createdAt: NOW,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const state = deriveDesignCreativeWorkflowState(project);

    expect(state.mode).toBe('design');
    expect(state.currentStep).toBe('review');
    expect(state.steps.map((step) => step.step)).toEqual([
      'intent',
      'assets',
      'plan',
      'generate',
      'review',
      'export',
    ]);
    expect(state.steps.find((step) => step.step === 'generate')?.status).toBe(
      'complete',
    );
    expect(state.assets[0]).toMatchObject({
      id: 'output-1',
      kind: 'image',
      role: 'design-output',
      provider: 'openai',
      model: 'image-1',
      materialization: 'ready',
    });
  });

  it('maps failed design projects to review recovery', () => {
    const project: DesignProject = {
      id: 'design-failed',
      title: 'Broken output',
      surface: 'image',
      status: 'failed',
      skillId: null,
      designSystemId: null,
      inspirationDesignSystemIds: [],
      craftRefs: [],
      brief: { audience: 'operators' },
      outputs: [],
      createdAt: NOW,
      updatedAt: NOW,
    };

    const state = deriveDesignCreativeWorkflowState(project);

    expect(state.currentStep).toBe('review');
    expect(state.primaryAction).toEqual({
      id: 'recover-failure',
      step: 'review',
    });
    expect(state.steps.find((step) => step.step === 'review')?.status).toBe(
      'failed',
    );
  });

  it.each([
    {
      status: 'draft',
      outputs: [],
      currentStep: 'plan',
      primaryActionId: 'create-plan',
    },
    {
      status: 'generating',
      outputs: [],
      currentStep: 'generate',
      primaryActionId: 'generate-media',
    },
    {
      status: 'rendering',
      outputs: [],
      currentStep: 'generate',
      primaryActionId: 'generate-media',
    },
    {
      status: 'complete',
      outputs: [
        {
          id: 'output-1',
          kind: 'png',
          path: '/tmp/hero.png',
          mime: 'image/png',
          createdAt: NOW,
        },
      ],
      currentStep: 'export',
      primaryActionId: 'export-output',
    },
  ] satisfies Array<{
    status: DesignProject['status'];
    outputs: DesignProject['outputs'];
    currentStep: string;
    primaryActionId: string;
  }>)(
    'maps design status $status to $currentStep',
    ({ status, outputs, currentStep, primaryActionId }) => {
      const state = deriveDesignCreativeWorkflowState(
        designProject({
          status,
          outputs,
          brief: { audience: 'operators' },
          craftRefs: ['brief.md'],
        }),
      );

      expect(state.currentStep).toBe(currentStep);
      expect(state.primaryAction.id).toBe(primaryActionId);
    },
  );

  it('normalizes catalog, video, and design asset descriptors', () => {
    const catalog: Asset = {
      id: 'asset-1',
      source: 'ai_gen',
      connectionId: null,
      sourceId: 'job-1',
      clientRequestId: null,
      kind: 'image',
      mime: 'image/png',
      bytes: 2048,
      width: 1024,
      height: 768,
      durationMs: null,
      contentHash: null,
      title: 'Generated hero',
      description: null,
      caption: null,
      ocrText: null,
      transcript: null,
      storagePath: null,
      thumbPath: '/thumb.webp',
      previewPath: '/preview.webp',
      capturedAt: null,
      importedAt: 100,
      modifiedAt: 200,
      provenance: {
        provider: 'openai',
        model: 'image-1',
        promptHash: 'abc123',
        promptExcerpt: 'Crisp hero image',
        license: 'project-owned',
        references: [{ kind: 'asset', id: 'asset-ref' }],
      },
      tags: ['hero'],
      attachments: [
        {
          scope: 'design_project',
          scopeId: 'design-1',
          role: 'reference',
          attachedAt: 100,
        },
      ],
      indexState: 'embedded',
      indexError: null,
    };
    const video = videoAsset({
      id: 'media-1',
      materializationState: 'hydrating',
    });
    const catalogBackedVideo = videoAsset({
      id: 'media-2',
      path: 'catalog:asset-2',
      provenance: {
        provider: 'seedance',
        catalogAssetId: 'asset-2',
        prompt: 'Use this generated video as a cold open',
      },
    });

    expect(catalogAssetToCreativeAssetDescriptor(catalog)).toMatchObject({
      role: 'generated',
      materialization: 'remote-only',
      promptHash: 'abc123',
      usageCount: 1,
      references: [{ kind: 'asset', id: 'asset-ref' }],
      currentPlacement: { usedInProject: false },
    });
    expect(
      catalogAssetToCreativeAssetDescriptor(catalog, {
        projectId: 'design-1',
        scope: 'design_project',
      }),
    ).toMatchObject({
      role: 'reference',
      usageCount: 1,
      currentPlacement: {
        kind: 'catalog',
        projectId: 'design-1',
        usedInProject: true,
      },
    });
    expect(videoMediaItemToCreativeAssetDescriptor(video)).toMatchObject({
      id: 'media-1',
      materialization: 'materializing',
      kind: 'video',
    });
    expect(
      videoMediaItemToCreativeAssetDescriptor(catalogBackedVideo),
    ).toMatchObject({
      id: 'media-2',
      role: 'generated',
      source: 'asset_catalog',
      sourceId: 'asset-2',
      promptExcerpt: 'Use this generated video as a cold open',
      materialization: 'remote-only',
    });
    expect(
      designOutputToCreativeAssetDescriptor(
        {
          id: 'output-1',
          kind: 'html',
          path: '/tmp/page.html',
          mime: 'text/html',
          createdAt: NOW,
        },
        'design-1',
      ),
    ).toMatchObject({
      kind: 'text',
      role: 'design-output',
      currentPlacement: { kind: 'design-output', projectId: 'design-1' },
    });
  });

  it('maps design provenance into creative asset metadata', () => {
    const descriptor = designOutputToCreativeAssetDescriptor(
      {
        id: 'output-2',
        kind: 'png',
        path: '/tmp/render.png',
        mime: 'image/png',
        provider: 'fallback-provider',
        model: 'fallback-model',
        createdAt: NOW,
      },
      'design-1',
      {
        assetId: 'output-2',
        projectId: 'design-1',
        provider: 'openai',
        model: 'image-1',
        promptHash: 'hash-1',
        promptSnapshot: 'Generate a clean operational dashboard mockup.',
        references: ['brief.md', 'brand.png'],
        taskId: 'task-1',
        createdAt: '2026-06-21T13:00:00.000Z',
      },
    );

    expect(descriptor).toMatchObject({
      provider: 'openai',
      model: 'image-1',
      sourceId: 'task-1',
      promptHash: 'hash-1',
      promptExcerpt: 'Generate a clean operational dashboard mockup.',
      references: [
        { kind: 'source', id: 'brief.md', label: 'brief.md' },
        { kind: 'source', id: 'brand.png', label: 'brand.png' },
      ],
      createdAt: '2026-06-21T13:00:00.000Z',
    });
  });

  it('normalizes linked video sources as creative asset descriptors', () => {
    const project = videoProject({
      prompt: 'Make a reel',
      linkedSources: [
        linkedSource({
          id: 'fresh-source',
          displayName: 'B-roll folder',
          index: { state: 'fresh', fileCount: 12 },
        }),
        linkedSource({
          id: 'error-source',
          displayName: 'Broken folder',
          index: { state: 'error', error: 'Missing folder' },
        }),
      ],
    });

    const state = deriveVideoCreativeWorkflowState(project);

    expect(state.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fresh-source',
          source: 'linked_source',
          materialization: 'ready',
          usageCount: 12,
        }),
        expect.objectContaining({
          id: 'error-source',
          source: 'linked_source',
          materialization: 'failed',
        }),
      ]),
    );
  });
});

function designProject(overrides: Partial<DesignProject> = {}): DesignProject {
  return {
    id: 'design',
    title: 'Design project',
    surface: 'image',
    status: 'ready',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {},
    outputs: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function videoProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: 'video',
    name: 'Video project',
    template: 'product-reel',
    prompt: 'Make a video',
    assets: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function videoAsset(overrides: Partial<VideoMediaItem> = {}): VideoMediaItem {
  return {
    id: 'media',
    kind: 'video',
    source: 'clip.mp4',
    path: '/tmp/clip.mp4',
    metadata: {
      durationMs: 4000,
      width: 1920,
      height: 1080,
      fileSize: 4096,
    },
    ...overrides,
  };
}

function linkedSource(
  overrides: Partial<VideoLinkedSource> = {},
): VideoLinkedSource {
  return {
    id: 'source',
    provider: 'local-fs',
    rootPath: '/tmp/source',
    displayName: 'Source',
    role: 'b-roll',
    index: { state: 'unindexed' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
