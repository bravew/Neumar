import { describe, expect, it } from 'vitest';

import {
  applyRenderPlanSceneModel,
  buildRenderPlan,
} from '@/shared/video/render-plan';
import type { VideoProject } from '@/shared/video/types';

describe('video render plan', () => {
  it('estimates scene cost, cache hits, budget warnings, and provider labels', () => {
    const plan = buildRenderPlan(projectFixture());

    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0]).toMatchObject({
      sceneId: 'scene-existing',
      modelId: 'local',
      model: 'local',
      estimatedCostUsd: 0,
      estimatedDurationSec: 0,
      cached: true,
    });
    expect(plan.scenes[1]).toMatchObject({
      sceneId: 'scene-generated',
      modelId: 'seedance-2-0-fast',
      model: 'BytePlus Seedance 2.0 Fast',
      estimatedCostUsd: 0.32,
      estimatedDurationSec: 4,
      cached: false,
    });
    expect(plan.totalCostUsd).toBe(0.32);
    expect(plan.totalEtaSec).toBe(4);
    expect(plan.warnings).toContain(
      'Estimated render plan cost exceeds the project budget cap.',
    );
  });

  it('requires a storyboard', () => {
    const project = projectFixture();
    delete project.storyboard;

    expect(() => buildRenderPlan(project)).toThrow(
      'Storyboard required before creating a render plan',
    );
  });

  it('applies a compatible per-scene model and recomputes the plan', () => {
    const project = projectFixture();
    const next = applyRenderPlanSceneModel(
      project,
      'scene-generated',
      'seedance-2-0',
    );
    const scene = next.storyboard?.scenes[1];

    expect(scene?.assetPlan).toMatchObject({
      kind: 'ai-clip',
      provider: 'seedance-2-0',
    });
    expect(next.renderPlan?.scenes[1]).toMatchObject({
      sceneId: 'scene-generated',
      modelId: 'seedance-2-0',
      model: 'BytePlus Seedance 2.0',
      estimatedCostUsd: 0.48,
    });
    expect(project.storyboard!.scenes[1]!.assetPlan).toMatchObject({
      provider: 'seedance-2-0-fast',
    });
  });

  it('rejects incompatible model selections', () => {
    expect(() =>
      applyRenderPlanSceneModel(
        projectFixture(),
        'scene-generated',
        'seedream-5-0-lite',
      ),
    ).toThrow('is not compatible with ai-clip');
  });

  it('blocks render plans when required asset credits are missing', () => {
    const project = projectFixture();
    project.assets[0] = {
      ...project.assets[0]!,
      provenance: {
        provider: 'assets',
        attribution: 'Photo by Ada on Pexels',
        attributionRequired: true,
        sourceDisplayName: 'Ada photo',
      },
    };

    expect(() => buildRenderPlan(project)).toThrow(
      'ATTRIBUTION_MISSING: Ada photo',
    );

    project.storyboard!.scenes.push({
      id: 'scene-credits',
      durationMs: 3000,
      intent: 'Credits: Photo by Ada on Pexels',
      assetPlan: { kind: 'existing', assetId: 'asset-1' },
    });
    expect(buildRenderPlan(project).warnings).toContain(
      'Estimated render plan cost exceeds the project budget cap.',
    );
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Render plan',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'asset-1',
        kind: 'video',
        source: 'user',
        path: 'videos/project-1/assets/video.mp4',
        metadata: { durationMs: 4000 },
      },
    ],
    storyboard: {
      status: 'approved',
      intent: 'Render plan',
      totalDurationMs: 8000,
      costEstimateUsd: { low: 0, high: 0.4 },
      scenes: [
        {
          id: 'scene-existing',
          durationMs: 4000,
          intent: 'Existing footage',
          assetPlan: { kind: 'existing', assetId: 'asset-1' },
        },
        {
          id: 'scene-generated',
          durationMs: 4000,
          intent: 'Generated clip',
          assetPlan: {
            kind: 'ai-clip',
            prompt: 'Generated clip',
            provider: 'seedance-2-0-fast',
            durationMs: 4000,
          },
        },
      ],
    },
    render: {
      status: 'idle',
      updatedAt: '2026-05-20T00:00:00.000Z',
    },
    budget: { capUsd: 0.2, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}
