import {
  isTransitionKind,
  normalizeTransition,
  transitionRegistryEntry,
} from '@/shared/video/types';
import type {
  TimelineClip,
  TimelineTrack,
  TimelineTransition,
  TransitionDegradation,
  TransitionDirection,
  TransitionKind,
  TransitionSpec,
  VideoProject,
  VideoRenderPath,
  VideoTimeline,
  VisualTimelineClip,
} from '@/shared/video/types';

export type TimelineTransitionSeamBlockedReason =
  | 'gap'
  | 'locked-track'
  | 'too-short';

export interface TimelineTransitionClipContext {
  id: string;
  label: string;
  sceneId?: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimelineTransitionSeamView {
  seamId: string;
  seamIndex: number;
  trackId: string;
  trackName: string;
  fromClipId: string;
  toClipId: string;
  startMs: number;
  fromClip: TimelineTransitionClipContext;
  toClip: TimelineTransitionClipContext;
  currentTransition: TimelineTransition | null;
  constraints: {
    minDurationMs: number;
    maxDurationMs: number;
    neighborMaxDurationMs: number;
    globalMaxDurationMs: number;
  };
  canAcceptTransition: boolean;
  blockedReason?: TimelineTransitionSeamBlockedReason;
}

export interface TimelineTransitionResolution {
  requestedTransition: TransitionSpec;
  effectiveTransition: TimelineTransition | null;
  requestedDurationMs?: number;
  effectiveDurationMs?: number;
  clamped: boolean;
  warnings: TransitionDegradation[];
}

// Keep these in sync with src/components/video/timeline/timelineTransitions.ts.
export const TRANSITION_SEAM_MIN_DURATION_MS = 33;
export const TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS = 3000;

const RENDERERS: VideoRenderPath[] = ['remotion', 'ffmpeg'];

export function timelineTransitionSeamId(
  trackId: string,
  fromClipId: string,
  toClipId: string,
): string {
  return `seam:${trackId}:${fromClipId}:${toClipId}`;
}

export function deriveTimelineTransitionSeams(
  project: VideoProject,
): TimelineTransitionSeamView[] {
  const timeline = project.timeline;
  if (!timeline) return [];
  const fps = timelineFps(timeline);
  const seams: TimelineTransitionSeamView[] = [];

  for (const track of [...timeline.tracks].sort(compareTracks)) {
    if (!isVisualTimelineTrack(track)) continue;
    const clips = sortVisualClips(track.clips);
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
      const currentTransition = touches
        ? (fromClip.transitionToNext ?? null)
        : null;
      seams.push({
        seamId: timelineTransitionSeamId(track.id, fromClip.id, toClip.id),
        seamIndex: seams.length,
        trackId: track.id,
        trackName: track.name,
        fromClipId: fromClip.id,
        toClipId: toClip.id,
        startMs: fromClip.startMs + fromClip.durationMs,
        fromClip: clipContext(project, fromClip),
        toClip: clipContext(project, toClip),
        currentTransition,
        constraints: {
          minDurationMs: TRANSITION_SEAM_MIN_DURATION_MS,
          maxDurationMs,
          neighborMaxDurationMs,
          globalMaxDurationMs: TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS,
        },
        canAcceptTransition: blockedReason === undefined,
        ...(blockedReason ? { blockedReason } : {}),
      });
    }
  }

  return seams;
}

export function findTimelineTransitionSeam(
  project: VideoProject,
  seamId: string,
): TimelineTransitionSeamView | undefined {
  return deriveTimelineTransitionSeams(project).find(
    (seam) => seam.seamId === seamId,
  );
}

export function resolveTimelineTransitionForSeam(
  project: VideoProject,
  seam: TimelineTransitionSeamView,
  transition: TimelineTransition,
): TimelineTransitionResolution {
  if (!seam.canAcceptTransition) {
    throw new Error(
      `Seam ${seam.seamId} cannot accept a transition: ${seam.blockedReason ?? 'blocked'}`,
    );
  }
  const requestedTransition = normalizeRequestedTransition(transition);
  if (requestedTransition.kind === 'cut') {
    return {
      requestedTransition,
      effectiveTransition: null,
      clamped: false,
      warnings: [],
    };
  }

  const entry = transitionRegistryEntry(requestedTransition.kind);
  const maxDurationMs = Math.min(
    entry.maxDurationMs,
    TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS,
    seam.constraints.neighborMaxDurationMs,
  );
  if (maxDurationMs < entry.minDurationMs) {
    throw new Error(
      `Seam ${seam.seamId} is too short for ${requestedTransition.kind}: max ${maxDurationMs}ms is below the ${entry.minDurationMs}ms minimum.`,
    );
  }

  const requestedDurationMs =
    requestedTransition.durationMs ?? entry.defaultDurationMs;
  const effectiveDurationMs = clamp(
    Math.round(requestedDurationMs),
    entry.minDurationMs,
    maxDurationMs,
  );
  const direction =
    requestedTransition.direction &&
    entry.directions.includes(requestedTransition.direction)
      ? requestedTransition.direction
      : undefined;
  const effectiveTransition = {
    kind: requestedTransition.kind,
    durationMs: effectiveDurationMs,
    ...(direction ? { direction } : {}),
  } satisfies TransitionSpec;

  return {
    requestedTransition,
    effectiveTransition,
    requestedDurationMs,
    effectiveDurationMs,
    clamped:
      requestedDurationMs !== effectiveDurationMs ||
      requestedTransition.direction !== direction,
    warnings: transitionFallbackWarnings(
      project.id,
      seam.seamIndex,
      requestedTransition.kind,
    ),
  };
}

export function transitionFallbackWarnings(
  projectId: string,
  seamIndex: number,
  kind: TransitionKind,
): TransitionDegradation[] {
  const entry = transitionRegistryEntry(kind);
  return RENDERERS.flatMap((renderer) => {
    if (entry.native.includes(renderer)) return [];
    const fallbackKind = entry.fallbackFor[renderer];
    return fallbackKind
      ? [
          {
            seamIndex,
            requestedKind: kind,
            fallbackKind,
            renderer,
            projectId,
          },
        ]
      : [];
  });
}

export function timelineTransitionNeighborMaxMs(
  fromClip: Pick<VisualTimelineClip, 'durationMs'>,
  toClip: Pick<VisualTimelineClip, 'durationMs'>,
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

export function timelineTransitionEffectiveMaxMs(
  fromClip: Pick<VisualTimelineClip, 'durationMs' | 'transitionToNext'>,
  toClip: Pick<VisualTimelineClip, 'durationMs'>,
): number {
  const transition = normalizeTransition(fromClip.transitionToNext);
  const presetMaxDurationMs =
    transition.kind === 'cut'
      ? TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS
      : transitionRegistryEntry(transition.kind).maxDurationMs;
  return Math.max(
    0,
    Math.min(
      presetMaxDurationMs,
      timelineTransitionNeighborMaxMs(fromClip, toClip),
    ),
  );
}

export function clipsTouchWithinFrame(
  fromClip: Pick<VisualTimelineClip, 'durationMs' | 'startMs'>,
  toClip: Pick<VisualTimelineClip, 'startMs'>,
  fps: number,
): boolean {
  const fromEndFrame = msToFrame(fromClip.startMs + fromClip.durationMs, fps);
  const toStartFrame = msToFrame(toClip.startMs, fps);
  return Math.abs(toStartFrame - fromEndFrame) <= 1;
}

function normalizeRequestedTransition(
  transition: TimelineTransition,
): TransitionSpec {
  const rawKind = typeof transition === 'string' ? transition : transition.kind;
  if (!isTransitionKind(rawKind)) {
    throw new Error(`Unsupported transition kind: ${rawKind}`);
  }
  const entry = transitionRegistryEntry(rawKind);
  const direction =
    typeof transition === 'string'
      ? undefined
      : supportedDirection(transition.direction, entry.directions);
  const durationMs =
    typeof transition === 'string' || transition.durationMs === undefined
      ? undefined
      : Math.round(transition.durationMs);
  return {
    kind: rawKind,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(direction ? { direction } : {}),
  };
}

function supportedDirection(
  value: TransitionDirection | undefined,
  directions: readonly TransitionDirection[],
): TransitionDirection | undefined {
  return value && directions.includes(value) ? value : undefined;
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

function clipContext(
  project: VideoProject,
  clip: VisualTimelineClip,
): TimelineTransitionClipContext {
  return {
    id: clip.id,
    label: clipLabel(project, clip),
    ...(clip.sceneId ? { sceneId: clip.sceneId } : {}),
    startMs: clip.startMs,
    endMs: clip.startMs + clip.durationMs,
    durationMs: clip.durationMs,
  };
}

function clipLabel(project: VideoProject, clip: VisualTimelineClip): string {
  if (clip.name) return clip.name;
  const scene = clip.sceneId
    ? project.storyboard?.scenes.find((item) => item.id === clip.sceneId)
    : undefined;
  if (scene?.intent) return scene.intent;
  const sourceRef = clip.sourceRef;
  if (sourceRef.kind === 'asset') {
    const asset = project.assets.find((item) => item.id === sourceRef.assetId);
    return asset?.source ? `${asset.source} ${asset.kind}` : sourceRef.assetId;
  }
  if (sourceRef.kind === 'scene') return sourceRef.sceneId;
  return clip.id;
}

function sortVisualClips(clips: readonly TimelineClip[]): VisualTimelineClip[] {
  return clips
    .filter(isVisualTimelineClip)
    .sort(
      (left, right) =>
        left.startMs - right.startMs || left.id.localeCompare(right.id),
    );
}

function compareTracks(left: TimelineTrack, right: TimelineTrack): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function isVisualTimelineTrack(track: TimelineTrack): boolean {
  return (
    track.kind === 'video' || track.kind === 'broll' || track.kind === 'overlay'
  );
}

function isVisualTimelineClip(clip: TimelineClip): clip is VisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function timelineFps(timeline: VideoTimeline): number {
  if (timeline.frameRate)
    return timeline.frameRate.num / timeline.frameRate.den;
  return timeline.fps;
}

function msToFrame(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, Math.round((ms / 1000) * fps));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
