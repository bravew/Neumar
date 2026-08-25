import { type DragEvent, useState } from 'react';

import type { VideoTimelineTrack } from '@/shared/types/video';

import { pixelsToMs } from './timelineMath';
import {
  newTrackKindForDrag,
  resolveTrackDropZone,
} from './timelineNewTrackDrop';
import {
  dispatchTrackDrop,
  trackAcceptsDrag,
  type TimelineTrackDropHandlers,
} from './timelineTrackDropDispatch';
import type { TrackInsertSide } from './timelineTrackInsertion';

interface TrackTransitionDropBridge {
  handleDragOver: (event: DragEvent<HTMLElement>) => boolean;
  handleDragLeave: (event: DragEvent<HTMLElement>) => void;
  handleDrop: (event: DragEvent<HTMLElement>) => boolean;
}

interface UseTimelineTrackDropZoneParams {
  track: VideoTimelineTrack;
  pixelsPerSecond: number;
  dropHandlers: TimelineTrackDropHandlers;
  transitions: TrackTransitionDropBridge;
  onDropOnNewTrack?: (
    dataTransfer: DataTransfer,
    anchorTrackId: string,
    side: TrackInsertSide,
    startMs: number,
  ) => boolean;
}

/**
 * Drag behaviour for one lane, which answers two questions at once: does this
 * drop belong *in* the lane, or in a new lane beside it?
 *
 * Near the top or bottom edge it's the latter — the same insertion band
 * Premiere and Resolve use — and the lane reports which side so it can draw the
 * line the clip will land on.
 */
export function useTimelineTrackDropZone({
  track,
  pixelsPerSecond,
  dropHandlers,
  transitions,
  onDropOnNewTrack,
}: UseTimelineTrackDropZoneParams): {
  insertSide: TrackInsertSide | null;
  dragProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
} {
  const [insertSide, setInsertSide] = useState<TrackInsertSide | null>(null);

  // A drag that carries no new-track kind (an OS file drop, in particular —
  // `newTrackKindForDrag` only recognizes the app's own drag payloads) can
  // never become a new lane, so the edge band degrades to an ordinary lane
  // drop instead of refusing the drop outright.
  const zoneFor = (event: DragEvent<HTMLElement>) => {
    if (!onDropOnNewTrack) return 'lane';
    const zone = resolveTrackDropZone(
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
    );
    if (zone === 'lane') return 'lane';
    return newTrackKindForDrag(event.dataTransfer) ? zone : 'lane';
  };

  const startMsFor = (event: DragEvent<HTMLElement>) =>
    pixelsToMs(
      event.clientX - event.currentTarget.getBoundingClientRect().left,
      pixelsPerSecond,
    );

  return {
    insertSide,
    dragProps: {
      onDragOver: (event) => {
        if (transitions.handleDragOver(event)) return;
        const zone = zoneFor(event);
        if (zone !== 'lane') {
          // The drop makes a new lane, so a locked track — or one that would
          // reject this media — is no reason to refuse it.
          setInsertSide(zone);
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          return;
        }
        setInsertSide(null);
        if (track.locked) return;
        if (!trackAcceptsDrag(event.dataTransfer, track, dropHandlers)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (event) => {
        setInsertSide(null);
        transitions.handleDragLeave(event);
      },
      onDrop: (event) => {
        setInsertSide(null);
        if (transitions.handleDrop(event)) return;
        const zone = zoneFor(event);
        const startMs = startMsFor(event);
        if (zone !== 'lane') {
          if (onDropOnNewTrack?.(event.dataTransfer, track.id, zone, startMs)) {
            event.preventDefault();
          }
          return;
        }
        if (track.locked) return;
        if (
          dispatchTrackDrop(event.dataTransfer, track, startMs, dropHandlers)
        ) {
          event.preventDefault();
        }
      },
    },
  };
}
