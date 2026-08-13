import { describe, expect, it } from 'vitest';

import { proposeVideoAgentAction } from '@/shared/video/agent-actions';
import type { VideoProject } from '@/shared/video/types';

describe('video agent action proposals', () => {
  it('turns scene edit requests into regeneration actions', () => {
    const proposal = proposeVideoAgentAction(
      projectFixture(),
      'make scene 2 a wider shot',
      { selectedSceneId: 'scene-1', aspectRatio: '16:9', step: 'board' },
    );

    expect(proposal).toMatchObject({
      type: 'action',
      name: 'regenerateScene',
      requiresApproval: true,
      status: 'pending',
      args: {
        sceneId: 'scene-2',
        durationMs: 4000,
      },
    });
    expect(proposal?.id).toBeTruthy();
    expect(JSON.stringify(proposal?.args)).toContain('wide product detail');
  });

  it('sets transitions on the first scene in a between pair', () => {
    const proposal = proposeVideoAgentAction(
      projectFixture(),
      'add a fade transition between scenes 1 and 2',
    );

    expect(proposal).toMatchObject({
      name: 'setTransition',
      args: { sceneId: 'scene-1', transition: 'fade' },
    });
  });

  it.each([
    ['add a cube transition between scenes 1 and 2', 'cube'],
    ['add a soft wipe transition between scenes 1 and 2', 'soft-wipe'],
    ['add a pixelize transition between scenes 1 and 2', 'pixelize'],
    ['add a polygon iris transition between scenes 1 and 2', 'polygon-iris'],
  ] as const)('recognizes advanced transition request: %s', (message, kind) => {
    const proposal = proposeVideoAgentAction(projectFixture(), message);

    expect(proposal).toMatchObject({
      name: 'setTransition',
      args: { sceneId: 'scene-1', transition: kind },
    });
  });

  it('extracts music tempo and uses storyboard duration', () => {
    const proposal = proposeVideoAgentAction(
      projectFixture(),
      'generate music at 90 bpm',
    );

    expect(proposal).toMatchObject({
      name: 'generateMusic',
      args: {
        prompt: 'generate music at 90 bpm',
        durationMs: 7000,
        tempoBpm: 90,
      },
    });
  });

  it('uses selected scene context for caption actions', () => {
    const proposal = proposeVideoAgentAction(
      projectFixture(),
      'set caption to "Launch today"',
      { selectedSceneId: 'scene-2' },
    );

    expect(proposal).toMatchObject({
      name: 'setCaption',
      args: { sceneId: 'scene-2', text: 'Launch today' },
    });
  });

  it('renders with an explicit aspect ratio from the message', () => {
    const proposal = proposeVideoAgentAction(
      projectFixture(),
      'render this at 9:16',
      { aspectRatio: '16:9' },
    );

    expect(proposal).toMatchObject({
      name: 'render',
      args: { aspectRatio: '9:16', mode: 'speed' },
    });
  });

  it('turns render verification requests into verifyRender actions', () => {
    const proposal = proposeVideoAgentAction(
      {
        ...projectFixture(),
        render: {
          status: 'done',
          outputPath: '/workspace/render.mp4',
          updatedAt: '2026-05-20T00:00:00.000Z',
        },
      },
      'verify the latest render',
    );

    expect(proposal).toMatchObject({
      name: 'verifyRender',
      args: { outputPath: '/workspace/render.mp4', maxIterations: 3 },
    });
  });

  it('turns bookend fade requests into timeline bookend actions', () => {
    const proposal = proposeVideoAgentAction(
      projectFixture(),
      'add a 500ms fade-in at the start',
    );

    expect(proposal).toMatchObject({
      name: 'setTimelineBookend',
      args: { position: 'intro', kind: 'fade', durationMs: 500 },
    });
  });

  it('turns audio seam requests into clip audio seam actions', () => {
    const proposal = proposeVideoAgentAction(
      projectWithTimeline(),
      'make the audio hard cut on this transition',
      { selectedSceneId: 'scene-1' },
    );

    expect(proposal).toMatchObject({
      name: 'setClipAudioSeam',
      args: { clipId: 'clip-scene-1', mode: 'cut' },
    });
  });

  it('turns selected transcript cut requests into timeline op batches', () => {
    const proposal = proposeVideoAgentAction(
      projectWithTimeline(),
      'cut this selected phrase',
      {
        selectedSceneId: 'scene-1',
        transcriptSelection: {
          sceneId: 'scene-1',
          clipId: 'clip-scene-1',
          startMs: 1000,
          endMs: 1600,
          text: 'selected phrase',
        },
      },
    );

    expect(proposal).toMatchObject({
      name: 'applyTimelineOps',
      args: {
        ops: [
          {
            kind: 'clip.removeTimeRange',
            trackId: 'track-video-main',
            startMs: 1000,
            endMs: 1600,
            magnetic: true,
          },
        ],
        rippleImpact: {
          downstreamClipCount: 1,
          shiftMs: -600,
        },
      },
    });
  });

  it('returns null when no supported edit intent is present', () => {
    expect(
      proposeVideoAgentAction(projectFixture(), 'what is the status?'),
    ).toBeNull();
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Launch cutdown',
    template: 'product-reel',
    prompt: 'Make a launch video',
    assets: [],
    storyboard: {
      status: 'draft',
      intent: 'Launch video',
      totalDurationMs: 7000,
      costEstimateUsd: { low: 0, high: 1 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 3000,
          intent: 'opening hero shot',
          caption: { text: 'Meet the product' },
          assetPlan: { kind: 'ai-image', prompt: 'hero product' },
        },
        {
          id: 'scene-2',
          durationMs: 4000,
          intent: 'wide product detail',
          caption: { text: 'Built for teams' },
          assetPlan: { kind: 'ai-image', prompt: 'product detail' },
        },
      ],
    },
    settings: { defaultRenderMode: 'speed' },
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  };
}

function projectWithTimeline(): VideoProject {
  const project = projectFixture();
  return {
    ...project,
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 7000,
      fps: 30,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          hidden: false,
          order: 0,
          clips: [
            {
              id: 'clip-scene-1',
              kind: 'video',
              name: 'Scene 1',
              sourceRef: { kind: 'scene', sceneId: 'scene-1' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
              sourceDurationMs: 3000,
            },
            {
              id: 'clip-scene-2',
              kind: 'video',
              name: 'Scene 2',
              sourceRef: { kind: 'scene', sceneId: 'scene-2' },
              sceneId: 'scene-2',
              startMs: 3000,
              durationMs: 4000,
              trimStartMs: 0,
              trimEndMs: 4000,
              sourceDurationMs: 4000,
            },
          ],
        },
      ],
    },
  };
}
