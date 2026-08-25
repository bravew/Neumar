import { useCallback, useState } from 'react';

import type { VideoTimelineTrack } from '@/shared/types/video';

import { TrackDeleteDialog } from './TrackDeleteDialog';

/**
 * Guards track deletion: a track with clips on it routes through a confirm
 * dialog instead of deleting immediately (deleting a track silently drops
 * every clip on it, and it's one click on the track header); an empty track
 * still deletes right away. Mirrors `useProjectAssetDeletion`'s
 * `{ requestDelete, dialog }` shape.
 */
export function useTrackDeleteConfirmation(
  removeTrack?: (trackId: string) => void,
) {
  const [pending, setPending] = useState<VideoTimelineTrack | null>(null);

  const requestDeleteTrack = useCallback(
    (track: VideoTimelineTrack) => {
      if (!removeTrack) return;
      if (track.clips.length > 0) {
        setPending(track);
        return;
      }
      removeTrack(track.id);
    },
    [removeTrack],
  );

  const dialog = (
    <TrackDeleteDialog
      pending={pending}
      onConfirm={() => {
        if (pending && removeTrack) removeTrack(pending.id);
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { requestDeleteTrack, dialog };
}
