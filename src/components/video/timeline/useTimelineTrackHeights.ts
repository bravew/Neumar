import { useCallback } from 'react';

import type { VideoTimelineTrack } from '@/shared/types/video';

import { getTimelineTrackHeight } from './timelineLayout';
import { useTimelineUiStore } from './useTimelineUiStore';

/**
 * Per-track height override resolver. Falls back to the static layout default
 * when no user resize is stored.
 */
export function useTimelineTrackHeights() {
  const trackHeights = useTimelineUiStore((state) => state.trackHeights);
  const getTrackHeight = useCallback(
    (track: VideoTimelineTrack | undefined) => {
      if (!track) return getTimelineTrackHeight(track);
      return trackHeights[track.id] ?? getTimelineTrackHeight(track);
    },
    [trackHeights],
  );
  return { trackHeights, getTrackHeight };
}
