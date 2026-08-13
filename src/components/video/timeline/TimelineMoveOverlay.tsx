import { cn } from '@/shared/lib/utils';

import type { TimelineClipMoveOverlayState } from './timelineClipDrag';
import {
  getTimelineClipClass,
  getTimelineClipIcon,
  getTimelineClipLabel,
} from './timelineClipVisuals';

interface TimelineMoveOverlayProps {
  preview: TimelineClipMoveOverlayState | null;
}

export function TimelineMoveOverlay({ preview }: TimelineMoveOverlayProps) {
  if (!preview) return null;
  const ClipIcon = getTimelineClipIcon(preview.clip, preview.track);
  const label = getTimelineClipLabel(preview.clip);
  const left = preview.clientX - preview.offsetX;
  const top = preview.clientY - preview.offsetY;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none fixed top-0 left-0 z-50 overflow-hidden rounded-sm border px-2 text-left text-[11px] opacity-90 shadow-lg',
        getTimelineClipClass(preview.track),
        preview.dropTarget?.accepted === false &&
          'border-destructive bg-destructive/10 text-destructive',
      )}
      style={{
        width: preview.width,
        height: preview.height,
        transform: `translate3d(${left}px, ${top}px, 0)`,
      }}
    >
      <span className="flex h-full items-center gap-1.5 truncate">
        <ClipIcon className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}
