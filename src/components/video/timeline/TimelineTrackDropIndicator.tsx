import { cn } from '@/shared/lib/utils';

import type { TimelineClipDropTarget } from './timelineClipDrag';
import { msToPixels } from './timelineMath';

interface TimelineTrackDropIndicatorProps {
  dropTarget: TimelineClipDropTarget;
  pixelsPerSecond: number;
}

export function TimelineTrackDropIndicator({
  dropTarget,
  pixelsPerSecond,
}: TimelineTrackDropIndicatorProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 z-10 border-2',
        dropTarget.accepted
          ? 'border-primary/70 bg-primary/10'
          : 'border-destructive/70 bg-destructive/10',
      )}
    >
      <div
        className={cn(
          'absolute top-0 bottom-0 border-l-2',
          dropTarget.accepted ? 'border-primary' : 'border-destructive',
        )}
        style={{
          left: Math.max(0, msToPixels(dropTarget.startMs, pixelsPerSecond)),
        }}
      />
    </div>
  );
}
