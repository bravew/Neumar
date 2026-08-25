import { type DragEvent, useState } from 'react';

import { cn } from '@/shared/lib/utils';

import { TRACK_HEADER_WIDTH } from './timelineLayout';
import { pixelsToMs } from './timelineMath';
import { newTrackKindForDrag } from './timelineNewTrackDrop';
import type { TrackInsertSide } from './timelineTrackInsertion';

interface TimelineNewTrackDropZoneProps {
  pixelsPerSecond: number;
  timelineWidth: number;
  hint: string;
  onDropOnNewTrack: (
    dataTransfer: DataTransfer,
    anchorTrackId: string | null,
    side: TrackInsertSide,
    startMs: number,
  ) => boolean;
}

/**
 * The empty space beneath the lanes, made droppable.
 *
 * Every NLE treats this area as "add a track for this" — Premiere and Resolve
 * both create one when you drop below the last lane — and it is the only place
 * to drop when the timeline has no lane of the right kind yet.
 *
 * It spans the whole track area and sits underneath the lanes rather than
 * being positioned after them: lanes are virtualised into their own coordinate
 * space, and anything trying to measure "just below the last one" drifts out of
 * alignment and starts stealing drops meant for a lane. Painting behind them
 * needs no measurement — whatever a lane doesn't take is empty by definition.
 */
export function TimelineNewTrackDropZone({
  pixelsPerSecond,
  timelineWidth,
  hint,
  onDropOnNewTrack,
}: TimelineNewTrackDropZoneProps) {
  const [active, setActive] = useState(false);

  const startMsFor = (event: DragEvent<HTMLElement>) =>
    pixelsToMs(
      event.clientX - event.currentTarget.getBoundingClientRect().left,
      pixelsPerSecond,
    );

  return (
    <div
      data-timeline-new-track-drop-zone
      className={cn(
        'absolute inset-y-0 z-0 border-2 border-dashed transition-colors',
        active ? 'border-primary bg-primary/10' : 'border-transparent',
      )}
      style={{ left: TRACK_HEADER_WIDTH, width: timelineWidth }}
      onDragOver={(event) => {
        if (!newTrackKindForDrag(event.dataTransfer)) return;
        setActive(true);
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        setActive(false);
        if (
          onDropOnNewTrack(event.dataTransfer, null, 'below', startMsFor(event))
        ) {
          event.preventDefault();
        }
      }}
    >
      {active ? (
        <div className="text-primary pointer-events-none sticky left-0 flex h-full items-end px-3 pb-2 text-[11px] font-medium">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
