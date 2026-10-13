import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTimelineTrackActions } from '@/components/video/timeline/useTimelineTrackActions';
import type { VideoTimelineTrack } from '@/shared/types/video';

function captionTrack(
  over: Partial<VideoTimelineTrack> = {},
): VideoTimelineTrack {
  return {
    id: 'track-caption-es',
    kind: 'caption',
    name: 'Captions (es)',
    language: 'es',
    muted: false,
    locked: false,
    order: 31,
    clips: [],
    ...over,
  } as VideoTimelineTrack;
}

describe('useTimelineTrackActions visibility', () => {
  it('toggles a caption track, which is how the burned-in language is picked', () => {
    const updateTrack = vi.fn();
    const { result } = renderHook(() =>
      useTimelineTrackActions({ updateTrack }),
    );

    result.current.handleToggleTrackVisibility(captionTrack({ hidden: true }));

    expect(updateTrack).toHaveBeenCalledWith('track-caption-es', {
      hidden: false,
    });
  });

  it('toggles a visual track as before', () => {
    const updateTrack = vi.fn();
    const { result } = renderHook(() =>
      useTimelineTrackActions({ updateTrack }),
    );

    result.current.handleToggleTrackVisibility({
      id: 'track-video',
      kind: 'video',
      name: 'Video',
      muted: false,
      locked: false,
      order: 0,
      clips: [],
    } as VideoTimelineTrack);

    expect(updateTrack).toHaveBeenCalledWith('track-video', { hidden: true });
  });

  it('leaves an audio track alone, since hidden does nothing there', () => {
    const updateTrack = vi.fn();
    const { result } = renderHook(() =>
      useTimelineTrackActions({ updateTrack }),
    );

    result.current.handleToggleTrackVisibility({
      id: 'track-audio',
      kind: 'audio-vo',
      name: 'Voice',
      muted: false,
      locked: false,
      order: 1,
      clips: [],
    } as VideoTimelineTrack);

    expect(updateTrack).not.toHaveBeenCalled();
  });
});
