import { describe, expect, it } from 'vitest';

import {
  normalizeSdkPlanInput,
  normalizeVideoAgentSdkPlan,
} from '@/shared/video/agent-sdk';
import type { VideoProject } from '@/shared/video/types';

describe('video agent SDK planner normalization', () => {
  it('normalizes Claude add-scene plans into approval actions', () => {
    const action = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can add that scene.',
      action: {
        name: 'addScene',
        summary: 'Add a product proof scene.',
        args: {
          afterSceneId: 'scene-1',
          intent: 'Show a customer proof point',
          captionText: 'A customer result closes the loop.',
          durationMs: 4200,
        },
      },
    });

    expect(action).toMatchObject({
      type: 'action',
      name: 'addScene',
      summary: 'Add a product proof scene.',
      reasoning: {
        rationale: 'Add a product proof scene.',
      },
      requiresApproval: true,
      status: 'pending',
      args: {
        afterSceneId: 'scene-1',
        plan: {
          durationMs: 4200,
          intent: 'Show a customer proof point',
          caption: { text: 'A customer result closes the loop.' },
        },
      },
    });
  });

  it('preserves omitted captions for add-scene actions', () => {
    const action = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can add that scene.',
      action: {
        name: 'addScene',
        summary: 'Add a source clip scene.',
        args: {
          afterSceneId: 'scene-1',
          intent: 'Show the dashboard',
          durationMs: 3000,
        },
      },
    });

    expect(action?.args).toMatchObject({
      afterSceneId: 'scene-1',
      plan: { durationMs: 3000, intent: 'Show the dashboard' },
    });
    expect(
      (action?.args as { plan?: { caption?: unknown } }).plan?.caption,
    ).toBeUndefined();
  });

  it('preserves Claude user-visible reasoning details', () => {
    const action = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can search for matching b-roll.',
      action: {
        name: 'searchLinkedAssets',
        summary: 'Search for launch b-roll.',
        args: { query: 'launch b-roll', role: 'b-roll' },
        reasoning: {
          rationale: 'The selected scene needs supporting visuals.',
          considered: ['Scene "Open"', 'Linked asset search role'],
          sourceClips: ['asset-1'],
        },
      },
    });

    expect(action?.reasoning).toEqual({
      rationale: 'The selected scene needs supporting visuals.',
      considered: ['Scene "Open"', 'Linked asset search role'],
      sourceClips: ['asset-1'],
    });
  });

  it('uses selected scene context for scene-scoped actions', () => {
    const action = normalizeVideoAgentSdkPlan(
      projectFixture(),
      {
        response: 'I can update the caption.',
        action: {
          name: 'setCaption',
          summary: 'Update the selected scene caption.',
          args: { text: 'Updated caption' },
        },
      },
      { selectedSceneId: 'scene-2' },
    );

    expect(action).toMatchObject({
      name: 'setCaption',
      args: { sceneId: 'scene-2', text: 'Updated caption' },
    });
  });

  it('normalizes timeline bookend and audio seam actions', () => {
    const bookend = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can add the intro fade.',
      action: {
        name: 'setTimelineBookend',
        summary: 'Add an intro fade.',
        args: { position: 'intro', durationMs: 500 },
      },
    });
    expect(bookend).toMatchObject({
      name: 'setTimelineBookend',
      args: { position: 'intro', kind: 'fade', durationMs: 500 },
    });

    const audioSeam = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can keep the audio cut hard.',
      action: {
        name: 'setClipAudioSeam',
        summary: 'Keep audio hard cut.',
        args: { clipId: 'clip-scene-1', mode: 'cut' },
      },
    });
    expect(audioSeam).toMatchObject({
      name: 'setClipAudioSeam',
      args: { clipId: 'clip-scene-1', mode: 'cut' },
    });
  });

  it('normalizes canonical timeline op actions', () => {
    const action = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can move that clip.',
      action: {
        name: 'applyTimelineOp',
        summary: 'Move the opening clip later.',
        args: {
          summary: 'Move the opening clip later.',
          op: {
            kind: 'clip.move',
            clipId: 'clip-scene-1',
            from: { trackId: 'track-video-main', startMs: 0 },
            to: { trackId: 'track-video-main', startMs: 500 },
          },
        },
      },
    });

    expect(action).toMatchObject({
      name: 'applyTimelineOp',
      args: {
        summary: 'Move the opening clip later.',
        op: {
          kind: 'clip.move',
          clipId: 'clip-scene-1',
        },
      },
      reasoning: {
        considered: expect.arrayContaining(['Timeline operation kind']),
      },
    });
  });

  it('normalizes canonical timeline op batch actions', () => {
    const action = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can cut the selected transcript range.',
      action: {
        name: 'applyTimelineOps',
        summary: 'Cut selected transcript text.',
        args: {
          summary: 'Cut selected transcript text.',
          ops: [
            {
              kind: 'clip.removeTimeRange',
              trackId: 'track-video-main',
              startMs: 1000,
              endMs: 1600,
              magnetic: true,
            },
          ],
          rippleImpact: { downstreamClipCount: 1, shiftMs: -600 },
        },
      },
    });

    expect(action).toMatchObject({
      name: 'applyTimelineOps',
      args: {
        summary: 'Cut selected transcript text.',
        ops: [
          {
            kind: 'clip.removeTimeRange',
            trackId: 'track-video-main',
            startMs: 1000,
            endMs: 1600,
            magnetic: true,
          },
        ],
        rippleImpact: { downstreamClipCount: 1, shiftMs: -600 },
      },
      reasoning: {
        considered: expect.arrayContaining(['Timeline operation batch']),
      },
    });
  });

  it('downgrades unsupported action names to action:null instead of throwing', () => {
    const normalized = normalizeSdkPlanInput({
      response: 'Working on it.',
      action: {
        name: 'proposeTimelineOps',
        summary: 'Propose timeline cuts.',
        args: { ops: [] },
        reasoning: { rationale: 'why' },
      },
    });
    expect(normalized).toMatchObject({
      response: 'Working on it.',
      action: null,
    });
  });

  it('lifts misplaced summary and remaps facts/summary in reasoning', () => {
    const normalized = normalizeSdkPlanInput({
      response: 'Adding scene.',
      action: {
        name: 'addScene',
        args: { intent: 'New' },
        reasoning: {
          summary: 'Add a scene to reinforce the point.',
          facts: ['Scene "Open"'],
        },
      },
    }) as { action: Record<string, unknown> };

    expect(normalized.action).toMatchObject({
      name: 'addScene',
      summary: 'Add a scene to reinforce the point.',
      reasoning: {
        rationale: 'Add a scene to reinforce the point.',
        considered: ['Scene "Open"'],
      },
    });
    expect(normalized.action.reasoning).not.toHaveProperty('summary');
    expect(normalized.action.reasoning).not.toHaveProperty('facts');
  });

  it('falls back to top-level response for action.summary when nothing else exists', () => {
    const normalized = normalizeSdkPlanInput({
      response: 'Cutting render now.',
      action: {
        name: 'cancelRender',
        args: {},
      },
    }) as { action: Record<string, unknown> };
    expect(normalized.action.summary).toBe('Cutting render now.');
  });

  it('drops invalid Claude action plans instead of emitting broken cards', () => {
    const action = normalizeVideoAgentSdkPlan(projectFixture(), {
      response: 'I can update the caption.',
      action: {
        name: 'setCaption',
        summary: 'Update a caption.',
        args: {},
      },
    });

    expect(action).toBeNull();
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Agent SDK test',
    template: 'explainer',
    prompt: 'Test the planner',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    storyboard: {
      status: 'approved',
      intent: 'Storyboard',
      totalDurationMs: 6000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 3000,
          intent: 'Open',
          caption: { text: 'Opening caption' },
          assetPlan: { kind: 'ai-image', prompt: 'Open' },
        },
        {
          id: 'scene-2',
          durationMs: 3000,
          intent: 'Close',
          caption: { text: 'Closing caption' },
          assetPlan: { kind: 'ai-image', prompt: 'Close' },
        },
      ],
    },
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}
