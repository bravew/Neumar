import { describe, expect, it } from 'vitest';

import {
  generateAggregateState,
  generateCompletionPercent,
  generateProgress,
  generateSceneStatuses,
} from '@/components/video/generateSceneStatus';
import type { VideoJob, VideoProject } from '@/shared/types/video';

function scene(id: string, kind: string, assetId = 'asset-1') {
  return {
    id,
    durationMs: 4000,
    intent: `Scene ${id}`,
    assetPlan:
      kind === 'ai-image'
        ? { kind: 'ai-image', prompt: 'title' }
        : { kind, assetId },
  };
}

function project(kinds: string[]): Pick<VideoProject, 'storyboard'> {
  return {
    storyboard: {
      status: 'edited',
      intent: 'Montage',
      totalDurationMs: 4000 * kinds.length,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: kinds.map((kind, i) => scene(`scene-${i + 1}`, kind)),
    },
  } as unknown as Pick<VideoProject, 'storyboard'>;
}

function clipGenJob(sceneId: string, status: VideoJob['status']): VideoJob {
  return {
    id: `job-${sceneId}`,
    projectId: 'project-1',
    kind: 'clip-gen',
    status,
    payload: { sceneId },
    caller: 'in-app',
  } as unknown as VideoJob;
}

describe('generate scene status', () => {
  it('treats scenes backed by existing media as needing no generation', () => {
    // The ChongQing shape: one generated title card, the rest local masters.
    const statuses = generateSceneStatuses(
      project(['ai-image', ...Array(47).fill('existing')]),
      [],
    );

    expect(statuses).toHaveLength(48);
    expect(statuses.filter((s) => s.state === 'ready')).toHaveLength(47);
    expect(generateProgress(statuses)).toMatchObject({
      generative: 1,
      done: 0,
      notQueued: 1,
    });
  });

  it('marks a generative scene with no job as not queued, never as queued', () => {
    // Jobs only exist once the storyboard is approved. Showing "Queued" here
    // promised a worker that was never going to pick the scene up.
    const statuses = generateSceneStatuses(project(['ai-image']), []);

    expect(statuses[0]?.state).toBe('not-queued');
  });

  it('reports the real job state once jobs exist', () => {
    const statuses = generateSceneStatuses(
      project(['ai-image', 'ai-clip', 'ai-image', 'existing']),
      [
        clipGenJob('scene-1', 'done'),
        clipGenJob('scene-2', 'running'),
        clipGenJob('scene-3', 'error'),
      ],
    );

    expect(statuses.map((s) => s.state)).toEqual([
      'done',
      'running',
      'error',
      'ready',
    ]);
    expect(generateProgress(statuses)).toMatchObject({
      generative: 3,
      done: 1,
      running: 1,
      failed: 1,
      notQueued: 0,
    });
  });

  it('ignores jobs from other kinds', () => {
    const sync = {
      ...clipGenJob('scene-1', 'done'),
      kind: 'linked-source.sync',
    } as unknown as VideoJob;

    const statuses = generateSceneStatuses(project(['ai-image']), [sync]);

    expect(statuses[0]?.state).toBe('not-queued');
  });

  it('image-pan stills count as ready, not as generation work', () => {
    const statuses = generateSceneStatuses(
      project(['image-pan', 'image-pan']),
      [],
    );

    expect(statuses.every((s) => s.state === 'ready')).toBe(true);
    expect(generateProgress(statuses).generative).toBe(0);
  });

  describe('aggregate state', () => {
    const agg = (kinds: string[], jobs: VideoJob[], approved = false) =>
      generateAggregateState(
        generateSceneStatuses(project(kinds), jobs),
        approved,
      );

    it('never reports the render status', () => {
      // The ChongQing shape: 47 local masters and one generated title card,
      // on an unapproved storyboard. The old badge read the render and said
      // `idle`; the truth is that nothing can be queued yet.
      expect(agg(['ai-image', ...Array(47).fill('existing')], [])).toBe(
        'awaiting-approval',
      );
    });

    it('says so when no scene needs generating at all', () => {
      expect(agg(['existing', 'image-pan'], [])).toBe('nothing-to-generate');
    });

    it('puts a failure ahead of everything still in flight', () => {
      expect(
        agg(
          ['ai-image', 'ai-clip'],
          [clipGenJob('scene-1', 'error'), clipGenJob('scene-2', 'running')],
          true,
        ),
      ).toBe('attention');
    });

    it('reports running before queued', () => {
      expect(
        agg(
          ['ai-image', 'ai-clip'],
          [clipGenJob('scene-1', 'running'), clipGenJob('scene-2', 'queued')],
          true,
        ),
      ).toBe('running');
    });

    it('only completes when every generative scene is done', () => {
      expect(
        agg(
          ['ai-image', 'ai-clip'],
          [clipGenJob('scene-1', 'done'), clipGenJob('scene-2', 'queued')],
          true,
        ),
      ).toBe('queued');
      expect(
        agg(
          ['ai-image', 'ai-clip'],
          [clipGenJob('scene-1', 'done'), clipGenJob('scene-2', 'done')],
          true,
        ),
      ).toBe('complete');
    });

    it('measures completion against generative scenes only', () => {
      const statuses = generateSceneStatuses(
        project(['ai-image', 'ai-clip', 'existing', 'existing']),
        [clipGenJob('scene-1', 'done')],
      );
      // 1 of 2 generative scenes, not 1 of 4 rows.
      expect(generateCompletionPercent(statuses)).toBe(50);
      expect(
        generateCompletionPercent(
          generateSceneStatuses(project(['existing']), []),
        ),
      ).toBe(0);
    });
  });
});
