import {
  durationFramesToMs,
  durationMsToFrames,
  normalizeFrameRate,
  type FrameRate,
  type FrameRateLike,
} from '@neumar/video-ir';

import type {
  EdlAudioClip,
  EdlAudioTrack,
  EdlCaption,
  EdlOverlay,
  EdlSegment,
  EditDecisionList,
  VideoTimeline,
  VideoTimelineOutputRange,
} from './types';

/**
 * An output range resolved against a real timeline: still in project frames,
 * but clamped to what the timeline actually contains and carrying the
 * millisecond bounds every downstream consumer needs.
 */
export interface ResolvedOutputRange {
  inFrame: number;
  outFrameExclusive: number;
  durationFrames: number;
  inMs: number;
  outMs: number;
  durationMs: number;
  rate: FrameRate;
}

/**
 * Clamp a stored range to the timeline it belongs to.
 *
 * Returns `null` for "render everything", which covers an absent range and a
 * range that turns out to cover the whole timeline — downstream code then takes
 * the untouched path older builds took, rather than a shift-by-zero that could
 * still perturb rounding.
 */
export function resolveOutputRange(
  timeline: Pick<VideoTimeline, 'durationMs' | 'outputRange'> | undefined,
  rate: FrameRateLike,
): ResolvedOutputRange | null {
  const stored = timeline?.outputRange;
  if (!stored) return null;
  const normalized = normalizeFrameRate(rate);
  const timelineFrames = Math.max(
    1,
    durationMsToFrames(timeline?.durationMs ?? 0, normalized, 'ceil'),
  );

  const inFrame = Math.max(0, Math.min(stored.inFrame, timelineFrames - 1));
  const outFrameExclusive = Math.max(
    inFrame + 1,
    Math.min(stored.outFrameExclusive, timelineFrames),
  );
  if (inFrame === 0 && outFrameExclusive >= timelineFrames) return null;

  return {
    inFrame,
    outFrameExclusive,
    durationFrames: outFrameExclusive - inFrame,
    inMs: durationFramesToMs(inFrame, normalized),
    outMs: durationFramesToMs(outFrameExclusive, normalized),
    durationMs: durationFramesToMs(outFrameExclusive - inFrame, normalized),
    rate: normalized,
  };
}

/**
 * Trim an EDL to the output range and shift render-local time back to zero.
 *
 * Every engine consumes the EDL, so applying the range here is what makes
 * "no engine may ignore a set range" true by construction rather than by three
 * parallel implementations. Project-time provenance survives on the returned
 * EDL's `outputRange`, so QA reports and export metadata can still say which
 * part of the project this output came from.
 */
export function applyOutputRangeToEdl(
  edl: EditDecisionList,
  range: ResolvedOutputRange | null,
): EditDecisionList {
  if (!range) return edl;

  const segments = edl.segments.flatMap((segment) =>
    clipSegmentToRange(segment, range),
  );
  const overlays = edl.overlays.flatMap((overlay) => {
    const clipped = clipSegmentToRange(overlay, range);
    return clipped.map((entry) => ({
      ...entry,
      kind: overlay.kind,
      ...(overlay.ptsShiftMs === undefined
        ? {}
        : { ptsShiftMs: overlay.ptsShiftMs }),
    })) as EdlOverlay[];
  });

  return {
    ...edl,
    durationMs: range.durationMs,
    segments,
    overlays,
    audioTracks: edl.audioTracks.map((track) =>
      clipAudioTrackToRange(track, range),
    ),
    captions: edl.captions.flatMap((caption) =>
      clipCaptionToRange(caption, range),
    ),
    outputRange: {
      inFrame: range.inFrame,
      outFrameExclusive: range.outFrameExclusive,
      projectStartMs: range.inMs,
      projectEndMs: range.outMs,
    },
  };
}

/**
 * How much of a clip survives the range, expressed as the offset into the clip
 * and the surviving duration. Returns `null` when the clip falls entirely
 * outside.
 */
function overlapWithRange(
  timelineStartMs: number,
  durationMs: number,
  range: ResolvedOutputRange,
): { offsetIntoClipMs: number; durationMs: number; startMs: number } | null {
  const clipEndMs = timelineStartMs + durationMs;
  if (clipEndMs <= range.inMs || timelineStartMs >= range.outMs) return null;
  const visibleStartMs = Math.max(timelineStartMs, range.inMs);
  const visibleEndMs = Math.min(clipEndMs, range.outMs);
  const visibleDurationMs = visibleEndMs - visibleStartMs;
  if (visibleDurationMs <= 0) return null;
  return {
    offsetIntoClipMs: visibleStartMs - timelineStartMs,
    durationMs: visibleDurationMs,
    startMs: visibleStartMs - range.inMs,
  };
}

/**
 * A clip trimmed at a range boundary must also advance into its source, or the
 * surviving part would play the wrong frames. Playback rate scales that
 * advance: at 2x, one second of timeline consumed two seconds of source.
 */
function sourceAdvanceMs(offsetIntoClipMs: number, speed: number): number {
  return Math.round(offsetIntoClipMs * speed);
}

function clipSegmentToRange<T extends EdlSegment>(
  segment: T,
  range: ResolvedOutputRange,
): T[] {
  const overlap = overlapWithRange(
    segment.timelineStartMs,
    segment.durationMs,
    range,
  );
  if (!overlap) return [];
  const speed = segment.playback?.speed ?? 1;
  const advanceMs = sourceAdvanceMs(overlap.offsetIntoClipMs, speed);
  const trimmedHead = overlap.offsetIntoClipMs > 0;
  const trimmedTail =
    overlap.durationMs < segment.durationMs - overlap.offsetIntoClipMs;

  return [
    {
      ...segment,
      timelineStartMs: overlap.startMs,
      sourceStartMs: segment.sourceStartMs + advanceMs,
      durationMs: overlap.durationMs,
      ...(segment.sourceDurationMs === undefined
        ? {}
        : {
            sourceDurationMs: Math.max(1, segment.sourceDurationMs - advanceMs),
          }),
      // A transition or entrance that the range cut through no longer has the
      // frames it needs, so it is dropped rather than played at the wrong
      // length against a hard boundary.
      ...(trimmedHead && segment.entranceMs !== undefined
        ? { entranceMs: undefined }
        : {}),
      ...(trimmedTail
        ? { exitMs: undefined, transitionToNext: undefined }
        : {}),
    } as T,
  ];
}

function clipAudioTrackToRange(
  track: EdlAudioTrack,
  range: ResolvedOutputRange,
): EdlAudioTrack {
  return {
    ...track,
    clips: track.clips.flatMap((clip) => clipAudioClipToRange(clip, range)),
  };
}

function clipAudioClipToRange(
  clip: EdlAudioClip,
  range: ResolvedOutputRange,
): EdlAudioClip[] {
  const overlap = overlapWithRange(
    clip.timelineStartMs,
    clip.durationMs,
    range,
  );
  if (!overlap) return [];
  const speed = clip.playback?.speed ?? 1;
  const advanceMs = sourceAdvanceMs(overlap.offsetIntoClipMs, speed);
  const trimmedHead = overlap.offsetIntoClipMs > 0;
  const trimmedTail =
    overlap.durationMs < clip.durationMs - overlap.offsetIntoClipMs;

  return [
    {
      ...clip,
      timelineStartMs: overlap.startMs,
      sourceStartMs: clip.sourceStartMs + advanceMs,
      durationMs: overlap.durationMs,
      // A fade the range cut into would ramp against a hard cut instead of the
      // silence it was written for.
      ...(trimmedHead ? { fadeInMs: undefined } : {}),
      ...(trimmedTail
        ? { fadeOutMs: undefined, audioTransitionToNext: undefined }
        : {}),
    },
  ];
}

function clipCaptionToRange(
  caption: EdlCaption,
  range: ResolvedOutputRange,
): EdlCaption[] {
  const overlap = overlapWithRange(
    caption.startMs,
    caption.endMs - caption.startMs,
    range,
  );
  if (!overlap) return [];
  return [
    {
      ...caption,
      startMs: overlap.startMs,
      endMs: overlap.startMs + overlap.durationMs,
      ...(overlap.offsetIntoClipMs > 0 ? { entranceMs: undefined } : {}),
    },
  ];
}

/**
 * Suffix for output file names so a ranged export never silently overwrites a
 * full-timeline one.
 */
export function outputRangeFileSuffix(
  range: ResolvedOutputRange | null,
): string {
  if (!range) return '';
  return `-f${range.inFrame}-${range.outFrameExclusive}`;
}

export function outputRangeFromFrames(
  inFrame: number,
  outFrameExclusive: number,
): VideoTimelineOutputRange {
  if (!Number.isInteger(inFrame) || !Number.isInteger(outFrameExclusive)) {
    throw new Error('Output range bounds must be whole frames');
  }
  if (inFrame < 0) throw new Error('Output range must start at or after 0');
  if (outFrameExclusive <= inFrame) {
    throw new Error('Output range must end after it starts');
  }
  return { inFrame, outFrameExclusive };
}
