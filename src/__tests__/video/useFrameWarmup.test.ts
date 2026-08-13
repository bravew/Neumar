import { describe, expect, it } from 'vitest';

import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import { getFrameWarmupSources } from '@/components/video/preview/useFrameWarmup';

describe('getFrameWarmupSources', () => {
  it('warms active and upcoming video sources inside the lookahead window', () => {
    expect(getFrameWarmupSources(previewData(), 20, 30)).toEqual([
      '/asset-a.mp4',
      '/asset-b.mp4',
    ]);
  });

  it('skips image clips and deduplicates repeated video sources', () => {
    expect(getFrameWarmupSources(previewData(), 45, 60)).toEqual([
      '/asset-b.mp4',
      '/asset-c.mp4',
    ]);
  });
});

function previewData(): RemotionPreviewData {
  return {
    vividOverlays: [],
    compositionWidth: 1280,
    compositionHeight: 720,
    durationInFrames: 180,
    fps: 30,
    visualClips: [
      visualClip('a', 0, 40, 'video', '/asset-a.mp4'),
      visualClip('image', 35, 30, 'image', '/still.png'),
      visualClip('b', 50, 40, 'video', '/asset-b.mp4'),
      visualClip('b-repeat', 70, 20, 'video', '/asset-b.mp4'),
      visualClip('c', 100, 40, 'video', '/asset-c.mp4'),
    ],
    audioClips: [],
    captions: [],
  };
}

function visualClip(
  id: string,
  fromFrame: number,
  durationInFrames: number,
  mediaKind: 'image' | 'video',
  src: string,
): RemotionPreviewData['visualClips'][number] {
  return {
    id,
    fromFrame,
    sourceStartFrame: 0,
    sourceEndFrame: durationInFrames,
    durationInFrames,
    layer: 0,
    trackId: 'track-video',
    trackKind: 'video',
    label: id,
    mediaKind,
    src,
  };
}
