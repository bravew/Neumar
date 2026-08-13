import type { TimelineClip } from './timeline-types.js';

export interface RippleShiftOptions {
  fromMs: number;
  deltaMs: number;
  excludeClipIds?: ReadonlySet<string>;
}

export interface RippleConflict {
  clipId: string;
  reason: 'negative-start' | 'overlap' | 'sync-lock';
  detail?: string;
}

export interface RippleResult {
  clips: TimelineClip[];
  conflicts: RippleConflict[];
}

export function rippleShiftClips(
  clips: readonly TimelineClip[],
  options: RippleShiftOptions,
): TimelineClip[] {
  if (options.deltaMs === 0) return [...clips];
  return clips.map((clip) => {
    if (options.excludeClipIds?.has(clip.id) || clip.startMs < options.fromMs) {
      return clip;
    }
    const shiftedStartMs = clip.startMs + options.deltaMs;
    if (shiftedStartMs >= 0) {
      return {
        ...clip,
        startMs: shiftedStartMs,
      };
    }
    const clippedMs = Math.min(clip.durationMs, -shiftedStartMs);
    return {
      ...clip,
      startMs: 0,
      durationMs: clip.durationMs - clippedMs,
      trimStartMs: clip.trimStartMs + clippedMs,
    };
  });
}

export function rippleShiftClipsStrict(
  clips: readonly TimelineClip[],
  options: RippleShiftOptions & { syncLockedTrack?: boolean },
): RippleResult {
  if (options.deltaMs === 0) {
    return { clips: [...clips], conflicts: [] };
  }

  const conflicts: RippleConflict[] = [];
  const shifted = clips.map((clip) => {
    if (options.excludeClipIds?.has(clip.id) || clip.startMs < options.fromMs) {
      return clip;
    }
    if (options.syncLockedTrack) {
      conflicts.push({
        clipId: clip.id,
        reason: 'sync-lock',
        detail: 'Ripple would move a clip on a sync-locked track',
      });
      return clip;
    }
    const shiftedStartMs = clip.startMs + options.deltaMs;
    if (shiftedStartMs < 0) {
      conflicts.push({
        clipId: clip.id,
        reason: 'negative-start',
        detail: `Ripple would move clip before 0ms (${shiftedStartMs}ms)`,
      });
      return clip;
    }
    return { ...clip, startMs: shiftedStartMs };
  });

  return {
    clips: shifted,
    conflicts: [...conflicts, ...findOverlapConflicts(shifted)],
  };
}

function findOverlapConflicts(
  clips: readonly TimelineClip[],
): RippleConflict[] {
  const ordered = [...clips].sort(
    (left, right) => left.startMs - right.startMs,
  );
  const conflicts: RippleConflict[] = [];
  let previous: TimelineClip | undefined;
  for (const clip of ordered) {
    if (previous && clip.startMs < previous.startMs + previous.durationMs) {
      conflicts.push({
        clipId: clip.id,
        reason: 'overlap',
        detail: `Clip overlaps ${previous.id}`,
      });
    }
    previous = clip;
  }
  return conflicts;
}
