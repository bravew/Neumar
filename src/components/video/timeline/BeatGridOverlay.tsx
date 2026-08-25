import { msToPixels } from './timelineMath';

export function BeatGridOverlay({
  beatTimesMs,
  headerWidth,
  height,
  pixelsPerSecond,
}: {
  beatTimesMs: number[];
  headerWidth: number;
  height: number;
  pixelsPerSecond: number;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {beatTimesMs.map((timeMs, index) => (
        <div
          key={`${timeMs}-${index}`}
          data-testid="timeline-beat-gridline"
          className="absolute top-8 border-l border-cyan-400/20"
          style={{
            height: Math.max(0, height - 32),
            left: headerWidth + msToPixels(timeMs, pixelsPerSecond),
          }}
        />
      ))}
    </div>
  );
}
