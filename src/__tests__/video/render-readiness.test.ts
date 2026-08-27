import { describe, expect, it } from 'vitest';

import {
  canRenderProject,
  hasRenderableTimeline,
  renderBlockedReason,
} from '@/components/video/render-readiness';
import type { VideoProject, VideoTimeline } from '@/shared/types/video';

describe('video render readiness', () => {
  it('allows rendering when the storyboard is approved', () => {
    expect(canRenderProject(project(), true)).toBe(true);
  });

  it('blocks rendering on an unapproved storyboard even with a full timeline', () => {
    // The API refuses any render whose storyboard is not approved, whatever
    // the timeline holds. Offering the button here produced a click that
    // flipped the status to running and back with no output and no message.
    const manualProject = project({ timeline: timelineWithClip() });

    expect(hasRenderableTimeline(manualProject)).toBe(true);
    expect(canRenderProject(manualProject, false)).toBe(false);
    expect(renderBlockedReason(manualProject, false)).toBe(
      'storyboard-not-approved',
    );
  });

  it('blocks rendering when neither storyboard nor timeline is ready', () => {
    expect(
      canRenderProject(
        project({ timeline: { ...timelineWithClip(), tracks: [] } }),
        false,
      ),
    ).toBe(false);
  });
});

function project(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    id: 'video-1',
    name: 'Video',
    template: 'product-reel',
    prompt: 'Make a video',
    assets: [],
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}

function timelineWithClip(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 3000,
    fps: 30,
    tracks: [
      {
        id: 'track-1',
        kind: 'video',
        name: 'Video',
        muted: false,
        locked: false,
        order: 0,
        clips: [
          {
            id: 'clip-1',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'asset-1' },
            startMs: 0,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
          },
        ],
      },
    ],
  };
}
