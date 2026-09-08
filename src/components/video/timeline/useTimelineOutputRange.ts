import { useCallback, useMemo } from 'react';

import type { VideoTimeline } from '@/shared/types/video';

import { setOutputIn, setOutputOut, timelineFrameRate } from './outputRange';

interface UseTimelineOutputRangeOptions {
  timeline: VideoTimeline | null;
  activeTimeline: Pick<VideoTimeline, 'fps' | 'frameRate'>;
  playheadMs: number;
  timelineDurationMs: number;
  setOutputRange: (
    range: { inFrame: number; outFrameExclusive: number } | null,
  ) => void;
}

/**
 * In/Out point handlers for the timeline's keyboard and toolbar surfaces.
 *
 * The playhead is the anchor for both: pressing I marks the frame under the
 * playhead as the first rendered frame, O marks it as the last. Both read the
 * current range from the store rather than closing over it, so a keypress that
 * lands mid-drag still sees the range the store actually holds.
 */
export function useTimelineOutputRange({
  timeline,
  activeTimeline,
  playheadMs,
  timelineDurationMs,
  setOutputRange,
}: UseTimelineOutputRangeOptions) {
  const rate = useMemo(
    () => timelineFrameRate(activeTimeline),
    [activeTimeline],
  );

  const handleSetOutputIn = useCallback(() => {
    setOutputRange(
      setOutputIn(timeline?.outputRange, playheadMs, rate, timelineDurationMs),
    );
  }, [playheadMs, rate, setOutputRange, timeline, timelineDurationMs]);

  const handleSetOutputOut = useCallback(() => {
    setOutputRange(
      setOutputOut(timeline?.outputRange, playheadMs, rate, timelineDurationMs),
    );
  }, [playheadMs, rate, setOutputRange, timeline, timelineDurationMs]);

  const handleClearOutputRange = useCallback(() => {
    setOutputRange(null);
  }, [setOutputRange]);

  return { handleSetOutputIn, handleSetOutputOut, handleClearOutputRange };
}
