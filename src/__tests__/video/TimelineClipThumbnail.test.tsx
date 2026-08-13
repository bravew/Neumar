import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  TimelineClipThumbnail,
  timelineClipFilmstripFrameCount,
} from '@/components/video/timeline/TimelineClipThumbnail';
import type { VideoMediaItem, VideoTimelineClip } from '@/shared/types/video';

describe('TimelineClipThumbnail', () => {
  it('requests enough portrait filmstrip frames to cover the clip body', () => {
    const portraitAsset = mediaItem({
      height: 1280,
      id: 'portrait-video',
      width: 720,
    });

    expect(timelineClipFilmstripFrameCount(portraitAsset, 300)).toBe(12);
    expect(
      timelineClipFilmstripFrameCount(
        mediaItem({ height: 1080, id: 'landscape-video', width: 1920 }),
        300,
      ),
    ).toBe(4);

    const { container } = render(
      <TimelineClipThumbnail
        projectId="project-1"
        clip={clipFixture()}
        asset={portraitAsset}
        widthPx={300}
      />,
    );

    const strip = container.querySelector<HTMLElement>(
      '[data-clip-thumb="clip-1"]',
    );
    expect(strip).not.toBeNull();
    expect(strip?.style.backgroundImage).toContain('count=12');
    expect(strip?.style.backgroundRepeat).toBe('repeat-x');
  });
});

function clipFixture(): VideoTimelineClip {
  return {
    id: 'clip-1',
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: 'portrait-video' },
    startMs: 0,
    durationMs: 10000,
    trimStartMs: 0,
    trimEndMs: 10000,
    sourceDurationMs: 10000,
  };
}

function mediaItem({
  height,
  id,
  width,
}: {
  height: number;
  id: string;
  width: number;
}): VideoMediaItem {
  return {
    id,
    kind: 'video',
    source: 'upload',
    path: `/assets/${id}.mp4`,
    metadata: {
      durationMs: 10000,
      height,
      width,
    },
  };
}
