import { useEffect, useRef } from 'react';

import { cn } from '@/shared/lib/utils';
import type { VideoTimelineOutputRange } from '@/shared/types/video';

import { msToPixels } from './timelineMath';

export interface TimelineOutputRangeLabels {
  inHandle: string;
  outHandle: string;
  excludedHead: string;
  excludedTail: string;
}

interface TimelineOutputRangeOverlayProps {
  range: VideoTimelineOutputRange;
  inMs: number;
  outMs: number;
  durationMs: number;
  headerWidth: number;
  pixelsPerSecond: number;
  labels: TimelineOutputRangeLabels;
  /** Drag a handle to a new time. The caller snaps it to a frame. */
  onMoveIn: (ms: number) => void;
  onMoveOut: (ms: number) => void;
}

/**
 * The dimmed regions and the two draggable handles that show which part of the
 * timeline a render will emit. Excluded time is dimmed rather than hidden, so
 * the clips outside the range stay visible and editable.
 */
export function TimelineOutputRangeOverlay({
  range,
  inMs,
  outMs,
  durationMs,
  headerWidth,
  pixelsPerSecond,
  labels,
  onMoveIn,
  onMoveOut,
}: TimelineOutputRangeOverlayProps) {
  const inX = msToPixels(inMs, pixelsPerSecond);
  const outX = msToPixels(outMs, pixelsPerSecond);
  const endX = msToPixels(durationMs, pixelsPerSecond);

  return (
    <>
      {inMs > 0 ? (
        <div
          data-testid="timeline-output-range-head"
          aria-label={labels.excludedHead}
          className="bg-background/70 pointer-events-none absolute top-0 bottom-0 z-20"
          style={{ left: headerWidth, width: inX }}
        />
      ) : null}
      {outMs < durationMs ? (
        <div
          data-testid="timeline-output-range-tail"
          aria-label={labels.excludedTail}
          className="bg-background/70 pointer-events-none absolute top-0 bottom-0 z-20"
          style={{ left: headerWidth + outX, width: Math.max(0, endX - outX) }}
        />
      ) : null}
      <RangeHandle
        testId="timeline-output-range-in"
        label={labels.inHandle}
        left={headerWidth + inX}
        headerWidth={headerWidth}
        frame={range.inFrame}
        edge="in"
        pixelsPerSecond={pixelsPerSecond}
        onMove={onMoveIn}
      />
      <RangeHandle
        testId="timeline-output-range-out"
        label={labels.outHandle}
        left={headerWidth + outX}
        headerWidth={headerWidth}
        frame={range.outFrameExclusive}
        edge="out"
        pixelsPerSecond={pixelsPerSecond}
        onMove={onMoveOut}
      />
    </>
  );
}

function RangeHandle({
  testId,
  label,
  left,
  headerWidth,
  frame,
  edge,
  pixelsPerSecond,
  onMove,
}: {
  testId: string;
  label: string;
  left: number;
  headerWidth: number;
  frame: number;
  edge: 'in' | 'out';
  pixelsPerSecond: number;
  onMove: (ms: number) => void;
}) {
  // A drag registers window listeners that only `pointerup` used to remove, so a
  // cancelled gesture (touch interrupted, browser take-over) or an unmount mid-drag
  // left them attached, still calling `onMove` on every subsequent pointer move.
  // The controller ends the drag exactly once from any of those paths.
  const dragRef = useRef<AbortController | null>(null);
  useEffect(() => () => dragRef.current?.abort(), []);

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      // Value semantics come from the frame number, so a screen reader reads
      // "in point, frame 240" rather than a pixel offset.
      aria-valuenow={frame}
      role="slider"
      aria-valuemin={0}
      className={cn(
        'border-primary bg-primary absolute top-0 z-[80] h-4 w-2 border',
        edge === 'in' ? 'rounded-r-sm' : '-translate-x-full rounded-l-sm',
      )}
      style={{ left }}
      onPointerDown={(event) => {
        // The ruler seeks on pointer-down; dragging a handle must not also
        // move the playhead.
        event.stopPropagation();
        const ruler = event.currentTarget.parentElement;
        if (!ruler) return;
        const rect = ruler.getBoundingClientRect();
        dragRef.current?.abort();
        const drag = new AbortController();
        dragRef.current = drag;
        const { signal } = drag;
        const move = (pointer: PointerEvent) => {
          const x = pointer.clientX - rect.left - headerWidth;
          onMove(Math.max(0, (x / pixelsPerSecond) * 1000));
        };
        const end = () => {
          drag.abort();
          if (dragRef.current === drag) dragRef.current = null;
        };
        window.addEventListener('pointermove', move, { signal });
        window.addEventListener('pointerup', end, { signal });
        window.addEventListener('pointercancel', end, { signal });
      }}
    />
  );
}
