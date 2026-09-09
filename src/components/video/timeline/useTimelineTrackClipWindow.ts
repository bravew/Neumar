import { useMemo } from 'react';

import type { VideoTimelineClip } from '@/shared/types/video';

import {
  buildClipIntervalIndex,
  queryClipWindow,
  type ClipTimeWindow,
} from './clipWindow';
import type { TimelineClipDropTarget } from './timelineClipDrag';

interface UseTimelineTrackClipWindowOptions {
  trackId: string;
  /** The track's clips, in whatever order the document holds them. */
  clips: readonly VideoTimelineClip[];
  /** Same clips, sorted — reused as the fallback when no window is supplied. */
  sortedClips: VideoTimelineClip[];
  clipWindow?: ClipTimeWindow;
  pinnedClipIds?: ReadonlySet<string>;
  selectedLinkGroupIds: ReadonlySet<string>;
  clipMoveDropTarget?: TimelineClipDropTarget | null;
}

/**
 * The clips one track actually mounts.
 *
 * Track-local pinning lives here because this is the level that knows which
 * clips belong to a highlighted link group, and which track is the current drop
 * target — a drop target renders its whole track so the indicator has neighbours
 * to measure against.
 */
export function useTimelineTrackClipWindow({
  trackId,
  clips,
  sortedClips,
  clipWindow,
  pinnedClipIds,
  selectedLinkGroupIds,
  clipMoveDropTarget,
}: UseTimelineTrackClipWindowOptions): VideoTimelineClip[] {
  const clipIndex = useMemo(() => buildClipIntervalIndex(clips), [clips]);

  const pinned = useMemo(() => {
    const ids = new Set(pinnedClipIds ?? []);
    if (selectedLinkGroupIds.size > 0) {
      for (const clip of clips) {
        if (clip.linkGroupId && selectedLinkGroupIds.has(clip.linkGroupId)) {
          ids.add(clip.id);
        }
      }
    }
    if (clipMoveDropTarget?.trackId === trackId) {
      for (const clip of clips) ids.add(clip.id);
    }
    return ids;
  }, [clipMoveDropTarget, clips, pinnedClipIds, selectedLinkGroupIds, trackId]);

  return useMemo(
    () =>
      clipWindow ? queryClipWindow(clipIndex, clipWindow, pinned) : sortedClips,
    [clipIndex, clipWindow, pinned, sortedClips],
  );
}
