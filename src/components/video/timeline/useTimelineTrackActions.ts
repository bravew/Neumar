import { useCallback } from 'react';

import {
  isVisualTimelineTrack,
  type VideoTimeline,
  type VideoTimelineTrack,
} from '@/shared/types/video';

type TimelineTrackUpdate = Partial<
  Pick<
    VideoTimeline['tracks'][number],
    'muted' | 'locked' | 'name' | 'syncLocked'
  >
> & { hidden?: boolean };

interface UseTimelineTrackActionsOptions {
  updateTrack: (trackId: string, update: TimelineTrackUpdate) => void;
  removeTrack?: (trackId: string) => void;
}

export function useTimelineTrackActions({
  updateTrack,
  removeTrack,
}: UseTimelineTrackActionsOptions) {
  const handleToggleTrackMute = useCallback(
    (track: VideoTimelineTrack) => {
      updateTrack(track.id, { muted: !track.muted });
    },
    [updateTrack],
  );

  const handleToggleTrackLock = useCallback(
    (track: VideoTimelineTrack) => {
      updateTrack(track.id, { locked: !track.locked });
    },
    [updateTrack],
  );

  const handleToggleTrackSyncLock = useCallback(
    (track: VideoTimelineTrack) => {
      updateTrack(track.id, { syncLocked: !track.syncLocked });
    },
    [updateTrack],
  );

  const handleToggleTrackVisibility = useCallback(
    (track: VideoTimelineTrack) => {
      if (!isVisualTimelineTrack(track)) return;
      updateTrack(track.id, { hidden: !track.hidden });
    },
    [updateTrack],
  );

  const handleDeleteTrack = useCallback(
    (track: VideoTimelineTrack) => {
      if (!removeTrack) return;
      removeTrack(track.id);
    },
    [removeTrack],
  );

  const handleRenameTrack = useCallback(
    (trackId: string, name: string) => {
      updateTrack(trackId, { name });
    },
    [updateTrack],
  );

  return {
    handleToggleTrackMute,
    handleToggleTrackLock,
    handleToggleTrackSyncLock,
    handleToggleTrackVisibility,
    handleDeleteTrack,
    handleRenameTrack,
  };
}
