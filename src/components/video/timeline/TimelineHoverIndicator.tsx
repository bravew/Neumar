import { useLayoutEffect, useRef } from 'react';

import { formatTimelineTime, msToPixels } from './timelineMath';

interface TimelineHoverIndicatorProps {
  headerWidth: number;
  height: number;
  hoverMs: number | null;
  pixelsPerSecond: number;
}

export function TimelineHoverIndicator({
  headerWidth,
  height,
  hoverMs,
  pixelsPerSecond,
}: TimelineHoverIndicatorProps) {
  const lineRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const node = lineRef.current;
    if (!node || hoverMs === null) return;
    const left = headerWidth + msToPixels(hoverMs, pixelsPerSecond);
    node.style.left = `${left}px`;
  }, [headerWidth, hoverMs, pixelsPerSecond]);

  if (hoverMs === null || height <= 0) return null;

  return (
    <div
      ref={lineRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 z-20"
      style={{ height }}
    >
      <div className="bg-primary/45 absolute left-0 h-full w-px" />
      <div className="bg-background/90 text-muted-foreground border-border absolute top-8 left-2 rounded border px-1 py-px text-[10px] leading-4 font-medium whitespace-nowrap shadow-sm">
        {formatTimelineTime(hoverMs)}
      </div>
    </div>
  );
}
