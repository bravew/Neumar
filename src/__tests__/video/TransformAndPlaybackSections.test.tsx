import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TransformAndPlaybackSections } from '@/components/video/clipInspector/TransformAndPlaybackSections';
import { en } from '@/config/locale';
import type { VideoVisualTimelineClip } from '@/shared/types/video';

describe('TransformAndPlaybackSections', () => {
  it('uses fine scale slider steps with accessible value text', () => {
    render(
      <TransformAndPlaybackSections
        clip={visualClip({
          scale: 1.23,
          scaleX: 1.11,
          scaleY: 0.95,
        })}
        aspectRatio="16:9"
        labels={en.video.editor.clipInspector}
        updateClip={vi.fn()}
        setPlaybackSpeed={vi.fn()}
        setPlaybackReverse={vi.fn()}
        rotateClips={vi.fn()}
        flipClips={vi.fn()}
        setTransform={vi.fn()}
      />,
    );

    expect(screen.getByRole('slider', { name: 'Scale' })).toHaveAttribute(
      'step',
      '0.01',
    );
    expect(screen.getByRole('slider', { name: 'Scale' })).toHaveAttribute(
      'aria-valuetext',
      '123%',
    );
    expect(screen.getByRole('slider', { name: 'Scale X' })).toHaveAttribute(
      'step',
      '0.01',
    );
    expect(screen.getByRole('slider', { name: 'Scale Y' })).toHaveAttribute(
      'step',
      '0.01',
    );
  });
});

function visualClip(
  transforms: NonNullable<VideoVisualTimelineClip['transforms']>,
): VideoVisualTimelineClip {
  return {
    id: 'clip-1',
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: 'asset-1' },
    startMs: 0,
    durationMs: 1000,
    trimStartMs: 0,
    trimEndMs: 1000,
    transforms,
  };
}
