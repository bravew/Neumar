import { msToPixels } from './timelineMath';
import type { TimelineSnapResult } from './timelineSnap';

interface SnapOverlayProps {
  headerWidth: number;
  pixelsPerSecond: number;
  snap: TimelineSnapResult | null;
}

export function SnapOverlay({
  headerWidth,
  pixelsPerSecond,
  snap,
}: SnapOverlayProps) {
  if (!snap) return null;
  return (
    <div
      aria-hidden
      className="bg-primary pointer-events-none absolute top-0 bottom-0 z-30 w-px opacity-80"
      style={{
        left: headerWidth + msToPixels(snap.target.timeMs, pixelsPerSecond),
      }}
    />
  );
}
