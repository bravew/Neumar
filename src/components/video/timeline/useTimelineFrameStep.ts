import { useCallback } from 'react';

interface UseTimelineFrameStepInput {
  fps: number;
  playheadMs: number;
  timelineDurationMs: number;
  setPlayheadMs: (timeMs: number) => void;
}

export function useTimelineFrameStep({
  fps,
  playheadMs,
  timelineDurationMs,
  setPlayheadMs,
}: UseTimelineFrameStepInput) {
  return useCallback(
    (frames: number) => {
      const frameMs = 1000 / Math.max(1, fps);
      setPlayheadMs(
        Math.min(
          timelineDurationMs,
          Math.max(0, playheadMs + frames * frameMs),
        ),
      );
    },
    [fps, playheadMs, setPlayheadMs, timelineDurationMs],
  );
}
