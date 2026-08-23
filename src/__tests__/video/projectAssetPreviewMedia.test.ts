import { describe, expect, it } from 'vitest';

import { projectAssetPreviewMedia } from '@/components/video/assets/projectAssetMedia';
import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

function asset(kind: ProjectAsset['kind']): ProjectAsset {
  return {
    id: 'asset-1',
    kind,
    source: 'user',
    path: `videos/p1/assets/file.${kind === 'audio' ? 'mp3' : 'mp4'}`,
    metadata: { durationMs: 1000 },
  } as ProjectAsset;
}

describe('projectAssetPreviewMedia', () => {
  it('gives audio a playable stream, since there is no frame to show', () => {
    const preview = projectAssetPreviewMedia('p1', asset('audio'));
    expect(preview.kind).toBe('audio');
    expect(preview.url).toContain('/assets/asset-1/stream');
    expect(preview.poster).toBeNull();
  });

  it('still returns a looping stream for video', () => {
    const preview = projectAssetPreviewMedia('p1', asset('video'));
    expect(preview.kind).toBe('video');
    expect(preview.url).toContain('/assets/asset-1/stream');
  });
});
