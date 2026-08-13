import { describe, expect, it } from 'vitest';

import {
  hydratedDroppedAssetDurationPatch,
  timelineClipFromDroppedAsset,
} from '@/components/video/timeline/droppedAssetClip';
import type {
  VideoMediaItem,
  VideoTimelineClip,
  VideoTimelineTrack,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

describe('droppedAssetClip', () => {
  it('uses an explicit duration when referenced asset metadata is missing', () => {
    const clip = timelineClipFromDroppedAsset(
      mediaItemFixture({ metadata: { durationMs: 0 } }),
      videoTrackFixture,
      250,
      { durationMs: 37_314 },
    );

    expect(clip).toMatchObject({
      durationMs: 37_314,
      sourceDurationMs: 37_314,
      trimEndMs: 37_314,
    });
  });

  it('contains likely logos on white for vertical drops', () => {
    const clip = timelineClipFromDroppedAsset(
      mediaItemFixture({
        id: 'asset-logo',
        kind: 'image',
        path: 'videos/project/assets/Enercare_Logo.png',
        metadata: { durationMs: 0, width: 1024, height: 1024 },
        provenance: {
          provider: 'upload',
          sourceDisplayName: 'Enercare_Logo.png',
        },
      }),
      videoTrackFixture,
      0,
      { aspectRatio: '9:16' },
    );

    expect(clip).toMatchObject({
      kind: 'image',
      transforms: { fit: 'contain', background: '#ffffff' },
    });
  });

  it('uses blur-pad for heavy aspect mismatches', () => {
    const clip = timelineClipFromDroppedAsset(
      mediaItemFixture(),
      videoTrackFixture,
      0,
      { aspectRatio: '9:16' },
    );

    expect(clip).toMatchObject({
      kind: 'video',
      transforms: { fit: 'blur-pad' },
    });
  });

  it('repairs an untouched one-second placeholder after hydration', () => {
    const patch = hydratedDroppedAssetDurationPatch(
      clipFixture({
        durationMs: 1000,
        sourceDurationMs: 1000,
        trimEndMs: 1000,
      }),
      mediaItemFixture({ metadata: { durationMs: 37_314 } }),
    );

    expect(patch).toEqual({
      durationMs: 37_314,
      sourceDurationMs: 37_314,
      trimEndMs: 37_314,
    });
  });

  it('does not resize a placeholder the user has already trimmed', () => {
    const patch = hydratedDroppedAssetDurationPatch(
      clipFixture({ durationMs: 750, sourceDurationMs: 1000, trimEndMs: 750 }),
      mediaItemFixture({ metadata: { durationMs: 37_314 } }),
    );

    expect(patch).toBeNull();
  });
});

const videoTrackFixture: VideoTimelineTrack = {
  id: 'track-video',
  kind: 'video',
  name: 'Video',
  muted: false,
  locked: false,
  hidden: false,
  order: 0,
  clips: [],
};

function mediaItemFixture(overrides: Partial<VideoMediaItem> = {}) {
  return {
    id: 'asset-video',
    kind: 'video',
    source: 'downloaded',
    path: 'catalog:catalog-video',
    materializationState: 'referenced',
    metadata: {
      durationMs: 37_314,
      width: 1280,
      height: 720,
    },
    provenance: {
      provider: 'immich',
      catalogAssetId: 'catalog-video',
    },
    ...overrides,
  } satisfies VideoMediaItem;
}

function clipFixture(
  overrides: Partial<VideoVisualTimelineClip> = {},
): VideoTimelineClip {
  return {
    id: 'clip-video',
    kind: 'video',
    name: 'Video',
    sourceRef: { kind: 'asset', assetId: 'asset-video' },
    startMs: 0,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    sourceDurationMs: 1000,
    muted: false,
    ...overrides,
  } satisfies VideoTimelineClip;
}
