import { describe, expect, it } from 'vitest';

import { resolveClipAsset } from '@/components/video/timeline/timelineMedia';
import type { VideoProject, VideoTimelineClip } from '@/shared/types/video';

const sceneAsset = {
  id: 'asset-1',
  kind: 'video',
} as VideoProject['assets'][number];

const project = {
  id: 'p1',
  assets: [sceneAsset],
  storyboard: {
    scenes: [
      { id: 'scene-1', assetPlan: { kind: 'existing', assetId: 'asset-1' } },
    ],
  },
} as unknown as VideoProject;

function sceneClip(kind: VideoTimelineClip['kind']): VideoTimelineClip {
  return {
    id: `clip-${kind}`,
    kind,
    sourceRef: { kind: 'scene', sceneId: 'scene-1' },
    startMs: 0,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    ...(kind === 'caption' ? { text: 'Enercare' } : {}),
    ...(kind === 'effect' ? { effectType: 'fade' } : {}),
  } as VideoTimelineClip;
}

describe('resolveClipAsset', () => {
  it('resolves the scene-backed asset for a visual (video) clip', () => {
    expect(resolveClipAsset(project, sceneClip('video'))).toBe(sceneAsset);
  });

  it('returns undefined for a caption clip so it renders no scene thumbnail', () => {
    expect(resolveClipAsset(project, sceneClip('caption'))).toBeUndefined();
  });

  it('returns undefined for an effect clip', () => {
    expect(resolveClipAsset(project, sceneClip('effect'))).toBeUndefined();
  });
});
