import {
  durationFramesToMs,
  durationMsToFrames,
  normalizeFrameRate,
  type FrameRateLike,
} from '@neumar/video-ir';

import type {
  VideoTimeline,
  VideoTimelineOutputRange,
} from '@/shared/types/video';

export interface OutputRangePixels {
  inMs: number;
  outMs: number;
  /** Excluded head, in ms. Zero when the range starts at the timeline start. */
  headMs: number;
  /** Excluded tail, in ms. Zero when the range runs to the timeline end. */
  tailMs: number;
}

export function timelineFrameRate(
  timeline: Pick<VideoTimeline, 'fps' | 'frameRate'> | undefined,
): FrameRateLike {
  return timeline?.frameRate ?? timeline?.fps ?? 30;
}

export function msToTimelineFrame(ms: number, rate: FrameRateLike): number {
  return durationMsToFrames(Math.max(0, ms), normalizeFrameRate(rate), 'floor');
}

export function timelineFrameToMs(frame: number, rate: FrameRateLike): number {
  return durationFramesToMs(Math.max(0, frame), normalizeFrameRate(rate));
}

/**
 * Where the range sits on the ruler, plus the two excluded spans the UI dims.
 * Returns `null` when nothing is excluded, so the ruler paints no overlay for a
 * project that renders in full.
 */
export function outputRangePixels(
  timeline: Pick<
    VideoTimeline,
    'durationMs' | 'fps' | 'frameRate' | 'outputRange'
  >,
): OutputRangePixels | null {
  const range = timeline.outputRange;
  if (!range) return null;
  const rate = timelineFrameRate(timeline);
  const inMs = Math.min(
    timelineFrameToMs(range.inFrame, rate),
    timeline.durationMs,
  );
  const outMs = Math.min(
    timelineFrameToMs(range.outFrameExclusive, rate),
    timeline.durationMs,
  );
  if (inMs <= 0 && outMs >= timeline.durationMs) return null;
  return {
    inMs,
    outMs,
    headMs: Math.max(0, inMs),
    tailMs: Math.max(0, timeline.durationMs - outMs),
  };
}

/**
 * Set the in point at the playhead.
 *
 * Setting an in point at or past the current out point pushes the out point one
 * frame later rather than rejecting the edit — an editor tapping I past O means
 * "start here", not "do nothing".
 */
export function setOutputIn(
  current: VideoTimelineOutputRange | undefined,
  playheadMs: number,
  rate: FrameRateLike,
  timelineDurationMs: number,
): VideoTimelineOutputRange {
  const lastFrame = Math.max(1, msToTimelineFrame(timelineDurationMs, rate));
  const inFrame = Math.max(
    0,
    Math.min(msToTimelineFrame(playheadMs, rate), lastFrame - 1),
  );
  const currentOut = current?.outFrameExclusive ?? lastFrame;
  return {
    inFrame,
    outFrameExclusive: Math.max(inFrame + 1, Math.min(currentOut, lastFrame)),
  };
}

/**
 * Set the out point at the playhead. The playhead sits at the start of a frame,
 * and the out bound is exclusive, so the frame under the playhead is included —
 * which is what "set out here" means to an editor.
 */
export function setOutputOut(
  current: VideoTimelineOutputRange | undefined,
  playheadMs: number,
  rate: FrameRateLike,
  timelineDurationMs: number,
): VideoTimelineOutputRange {
  const lastFrame = Math.max(1, msToTimelineFrame(timelineDurationMs, rate));
  const outFrameExclusive = Math.max(
    1,
    Math.min(msToTimelineFrame(playheadMs, rate) + 1, lastFrame),
  );
  const currentIn = current?.inFrame ?? 0;
  return {
    inFrame: Math.max(0, Math.min(currentIn, outFrameExclusive - 1)),
    outFrameExclusive,
  };
}

/**
 * How many clip boundaries would move if the project re-snapped to a new rate.
 * The setting dialog shows this before locking, because re-snapping is the part
 * of a timebase change a user cannot see coming.
 */
export function countResnappedBoundaries(
  timeline: Pick<VideoTimeline, 'tracks'>,
  fromRate: FrameRateLike,
  toRate: FrameRateLike,
): number {
  const from = normalizeFrameRate(fromRate);
  const to = normalizeFrameRate(toRate);
  if (from.num === to.num && from.den === to.den) return 0;

  let moved = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      for (const ms of [clip.startMs, clip.startMs + clip.durationMs]) {
        const snappedTo = timelineFrameToMs(msToTimelineFrame(ms, to), to);
        if (Math.abs(snappedTo - ms) > 0.5) moved += 1;
      }
    }
  }
  return moved;
}
