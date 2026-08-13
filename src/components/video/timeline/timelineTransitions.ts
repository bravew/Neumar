import {
  isVisualTimelineClip,
  isVisualTimelineTrack,
  normalizeVideoTransition,
  videoTransitionRegistryEntry,
  type VideoTimelineTransition,
  type VideoTimelineTrack,
  type VideoVisualTimelineClip,
} from '@/shared/types/video';

export type TimelineTransitionSeamBlockedReason =
  | 'no-adjacent-clip'
  | 'gap'
  | 'locked-track'
  | 'unsupported-media'
  | 'too-short';

export interface TimelineTransitionSeam {
  seamId: string;
  trackId: string;
  fromClipId: string;
  toClipId: string;
  startMs: number;
  maxDurationMs: number;
  neighborMaxDurationMs: number;
  transition: VideoTimelineTransition | null;
  canAcceptTransition: boolean;
  blockedReason?: TimelineTransitionSeamBlockedReason;
}

// Keep these in sync with src-api/src/shared/video/transition-seams.ts.
export const TRANSITION_SEAM_MIN_DURATION_MS = 33;
export const TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS = 3000;

export function timelineTransitionSeamId(
  trackId: string,
  fromClipId: string,
  toClipId: string,
): string {
  return `seam:${trackId}:${fromClipId}:${toClipId}`;
}

export function deriveTimelineTransitionSeams(
  tracks: readonly VideoTimelineTrack[],
  fps: number,
): TimelineTransitionSeam[] {
  return tracks.flatMap((track) => {
    if (!isVisualTimelineTrack(track)) return [];
    // Effect clips (vivid overlays) never carry transitions; excluding them
    // here cannot fabricate a seam because seams require time-adjacent ends.
    const clips = sortVisualClipsForSeams(
      track.clips.filter(isVisualTimelineClip),
    );
    const seams: TimelineTransitionSeam[] = [];
    for (let index = 0; index < clips.length - 1; index += 1) {
      const fromClip = clips[index];
      const toClip = clips[index + 1];
      if (!fromClip || !toClip) continue;

      const touches = clipsTouchWithinFrame(fromClip, toClip, fps);
      const neighborMaxDurationMs = timelineTransitionNeighborMaxMs(
        fromClip,
        toClip,
      );
      const maxDurationMs = timelineTransitionEffectiveMaxMs(fromClip, toClip);
      const blockedReason = transitionSeamBlockedReason(
        track.locked,
        touches,
        neighborMaxDurationMs,
      );
      const canAcceptTransition = blockedReason === undefined;
      const transition = touches ? (fromClip.transitionToNext ?? null) : null;

      seams.push({
        seamId: timelineTransitionSeamId(track.id, fromClip.id, toClip.id),
        trackId: track.id,
        fromClipId: fromClip.id,
        toClipId: toClip.id,
        startMs: fromClip.startMs + fromClip.durationMs,
        maxDurationMs,
        neighborMaxDurationMs,
        transition,
        canAcceptTransition,
        ...(blockedReason ? { blockedReason } : {}),
      });
    }
    return seams;
  });
}

export function timelineTransitionEffectiveMaxMs(
  fromClip: Pick<VideoVisualTimelineClip, 'durationMs' | 'transitionToNext'>,
  toClip: Pick<VideoVisualTimelineClip, 'durationMs'>,
): number {
  const transition = normalizeVideoTransition(fromClip.transitionToNext);
  const presetMaxDurationMs =
    transition.kind === 'cut'
      ? TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS
      : videoTransitionRegistryEntry(transition.kind).maxDurationMs;
  return Math.max(
    0,
    Math.min(
      presetMaxDurationMs,
      timelineTransitionNeighborMaxMs(fromClip, toClip),
    ),
  );
}

export function timelineTransitionNeighborMaxMs(
  fromClip: Pick<VideoVisualTimelineClip, 'durationMs'>,
  toClip: Pick<VideoVisualTimelineClip, 'durationMs'>,
): number {
  return Math.max(
    0,
    Math.min(
      TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS,
      Math.floor(fromClip.durationMs / 2),
      Math.floor(toClip.durationMs / 2),
    ),
  );
}

export function clipsTouchWithinFrame(
  fromClip: Pick<VideoVisualTimelineClip, 'durationMs' | 'startMs'>,
  toClip: Pick<VideoVisualTimelineClip, 'startMs'>,
  fps: number,
): boolean {
  const fromEndFrame = msToFrame(fromClip.startMs + fromClip.durationMs, fps);
  const toStartFrame = msToFrame(toClip.startMs, fps);
  return Math.abs(toStartFrame - fromEndFrame) <= 1;
}

function sortVisualClipsForSeams(
  clips: readonly VideoVisualTimelineClip[],
): VideoVisualTimelineClip[] {
  return [...clips].sort(
    (left, right) =>
      left.startMs - right.startMs || left.id.localeCompare(right.id),
  );
}

function transitionSeamBlockedReason(
  lockedTrack: boolean,
  touches: boolean,
  maxDurationMs: number,
): TimelineTransitionSeamBlockedReason | undefined {
  if (!touches) return 'gap';
  if (lockedTrack) return 'locked-track';
  if (maxDurationMs < TRANSITION_SEAM_MIN_DURATION_MS) return 'too-short';
  return undefined;
}

function msToFrame(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, Math.round((ms / 1000) * fps));
}
