import type { TimelineLassoRect } from './useTimelineLassoSelection';

interface TimelineLassoOverlayProps {
  rect: TimelineLassoRect | null;
}

export function TimelineLassoOverlay({ rect }: TimelineLassoOverlayProps) {
  if (!rect) return null;
  return (
    <div
      aria-hidden
      className="border-primary bg-primary/10 pointer-events-none absolute z-30 rounded-sm border"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
