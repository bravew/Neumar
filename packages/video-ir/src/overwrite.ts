import type { RippleConflict } from './ripple.js';
import type {
  TimelineClip,
  TimelineOp,
  TimelineTrack,
} from './timeline-types.js';

export interface OverwriteResult {
  ops: TimelineOp[];
  conflicts: RippleConflict[];
}

export function planOverwrite(
  track: TimelineTrack,
  region: { startMs: number; endMs: number },
  incomingClip: TimelineClip,
): OverwriteResult {
  if (region.endMs <= region.startMs) {
    return {
      ops: [],
      conflicts: [
        {
          clipId: incomingClip.id,
          reason: 'overlap',
          detail: 'Overwrite region endMs must be greater than startMs',
        },
      ],
    };
  }

  const ops: TimelineOp[] = [];
  for (const clip of [...track.clips].sort((left, right) => {
    return left.startMs - right.startMs;
  })) {
    const clipEndMs = endMs(clip);
    if (clip.startMs >= region.endMs || clipEndMs <= region.startMs) continue;

    if (clip.startMs < region.startMs && clipEndMs > region.endMs) {
      const leftDurationMs = region.startMs - clip.startMs;
      const rightDurationMs = clipEndMs - region.endMs;
      const rightTrimStartMs = clip.trimStartMs + (region.endMs - clip.startMs);
      ops.push({
        kind: 'clip.split',
        clipId: clip.id,
        at: region.startMs,
        before: clip,
        after: [
          {
            ...clip,
            durationMs: leftDurationMs,
            trimEndMs: clip.trimStartMs + leftDurationMs,
          },
          {
            ...clip,
            id: uniqueClipId(track, `${clip.id}-after-overwrite`),
            startMs: region.endMs,
            durationMs: rightDurationMs,
            trimStartMs: rightTrimStartMs,
          },
        ],
      });
      continue;
    }

    if (clip.startMs < region.startMs) {
      const nextDurationMs = region.startMs - clip.startMs;
      ops.push({
        kind: 'clip.trim',
        clipId: clip.id,
        from: timingState(clip),
        to: {
          ...timingState(clip),
          durationMs: nextDurationMs,
          trimEndMs: clip.trimStartMs + nextDurationMs,
        },
      });
      continue;
    }

    if (clipEndMs > region.endMs) {
      const removedMs = region.endMs - clip.startMs;
      const nextDurationMs = clipEndMs - region.endMs;
      ops.push({
        kind: 'clip.trim',
        clipId: clip.id,
        from: timingState(clip),
        to: {
          startMs: region.endMs,
          durationMs: nextDurationMs,
          trimStartMs: clip.trimStartMs + removedMs,
          trimEndMs: clip.trimEndMs,
        },
      });
      continue;
    }

    ops.push({
      kind: 'clip.remove',
      clipId: clip.id,
      snapshot: clip,
    });
  }

  ops.push({
    kind: 'clip.insert',
    trackId: track.id,
    clip: incomingClip,
    at: region.startMs,
  });

  return { ops, conflicts: [] };
}

function timingState(clip: TimelineClip) {
  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
  };
}

function endMs(clip: TimelineClip): number {
  return clip.startMs + clip.durationMs;
}

function uniqueClipId(track: TimelineTrack, preferredId: string): string {
  const existing = new Set(track.clips.map((clip) => clip.id));
  if (!existing.has(preferredId)) return preferredId;
  for (let index = 2; ; index += 1) {
    const candidate = `${preferredId}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
}
