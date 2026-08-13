import {
  findKeyframeAt,
  findKeyframeTrack,
  keyframeTrackValidationError,
  keyframeValueValidationError,
  normalizeKeyframeTrack,
} from './keyframes.js';
import {
  buildVividOverlayMotionTemplateTracks,
  findVividOverlayMotionTemplate,
  vividOverlayMotionTemplateSupportsCategory,
} from './overlay-motion-templates.js';
import {
  isVividOverlayClip,
  parseVividOverlayParams,
  VIVID_OVERLAY_EFFECT_TYPE,
  vividOverlayControlKeyframeErrors,
  vividOverlayControlErrors,
  VividOverlayParamsSchema,
  vividOverlaySourceRef,
  type VividOverlayBackendId,
  type VividOverlayCategory,
  type VividOverlayControlDef,
  type VividOverlayControlKeyframeTrack,
  type VividOverlayControlValue,
  type VividOverlayLoopMode,
  type VividOverlayMotionTemplateId,
  type VividOverlayMotionTemplateStrength,
  type VividOverlayParams,
} from './overlay-types.js';
import {
  clipPlaybackFromFields,
  effectiveDurationFrames,
  isDefaultClipPlayback,
  localFrameToSourceFrame,
  normalizeClipPlayback,
} from './playback.js';
import {
  durationFramesToMs,
  durationMsToFrames,
  frameToMs,
  msToFrame,
  type FrameRateLike,
} from './timebase.js';
import type {
  AudioClipAudioPatch,
  AudioFadeCurve,
  AudioTimelineClip,
  AudioTimelineTrack,
  AudioTransitionSpec,
  ClipPlayback,
  ClipPlaybackTimingPolicy,
  ClipTimingState,
  ClipTransform,
  EffectTimelineClip,
  Keyframe,
  KeyframeTrack,
  Timeline,
  TimelineClip,
  TimelineOp,
  TimelineSourceRef,
  TimelineTrack,
  TrackUpdatePatch,
} from './timeline-types.js';

export type EditLinkPolicy = 'linked' | 'primary-only';
export type CutRetainMode = 'both' | 'left' | 'right';
export type TimelineTrimEdge = 'left' | 'right';

export interface EditBuilderOptions {
  idFactory?: () => string;
}

export interface EditBuildAffectedRange {
  startFrame: number;
  endFrame: number;
}

export interface EditBuildMetadata {
  affectedRange?: EditBuildAffectedRange;
  affectedTrackIds: string[];
  changedClipIds: string[];
  createdClipIds: string[];
  removedClipIds: string[];
  shiftedClipIds: string[];
  inspectClipIds: string[];
}

export interface EditBuildConflict {
  code: string;
  message: string;
  clipId?: string;
  trackId?: string;
}

export interface EditBuildResult {
  ops: TimelineOp[];
  metadata: EditBuildMetadata;
  conflicts: EditBuildConflict[];
}

export class EditBuilderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EditBuilderError';
  }
}

export interface BuildCutClipInput {
  clipId: string;
  atFrame: number;
  retain?: CutRetainMode;
  ripple?: boolean;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildCutRangeInput {
  trackId?: string;
  startFrame: number;
  endFrame: number;
  ripple?: boolean;
}

export interface BuildDuplicateClipsInput {
  clipIds: string[];
  placement?:
    | { kind: 'after-originals' }
    | { kind: 'at-frame'; startFrame: number; trackId?: string }
    | { kind: 'offset-frames'; deltaFrames: number };
  linkPolicy?: EditLinkPolicy;
}

export interface BuildDeleteClipsInput {
  clipIds: string[];
  ripple?: boolean;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildMoveClipInput {
  clipId: string;
  toFrame: number;
  toTrackId?: string;
  magnetic?: boolean;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildTrimClipInput {
  clipId: string;
  edge: TimelineTrimEdge;
  /** Positive values trim inward; negative values extend the selected edge. */
  deltaFrames: number;
  magnetic?: boolean;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildSetClipSpeedInput {
  clipIds: string[];
  speed: number;
  timingPolicy?: ClipPlaybackTimingPolicy;
  ripple?: boolean;
  linkPolicy?: EditLinkPolicy;
  pitchCorrection?: boolean;
  smoothSlowMo?: boolean;
  interpolationQuality?: ClipPlayback['interpolationQuality'];
}

export interface BuildReverseClipInput {
  clipIds: string[];
  reverse: boolean;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildRotateClipInput {
  clipIds: string[];
  degrees: number;
  relative?: boolean;
}

export interface BuildFlipClipInput {
  clipIds: string[];
  horizontal?: boolean;
  vertical?: boolean;
  mode?: 'toggle' | 'set';
}

export interface BuildSetClipTransformInput {
  clipIds: string[];
  transform: ClipTransform;
  merge?: boolean;
}

export type AudioClipFadeEdge = 'in' | 'out' | 'both';
export type AudioVolumeKeyframeMode = 'replace' | 'upsert';

export interface BuildSetAudioClipGainInput {
  clipIds: string[];
  gainDb: number | null;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildSetAudioClipMuteInput {
  clipIds: string[];
  muted: boolean;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildSetAudioClipFadeInput {
  clipIds: string[];
  edge: AudioClipFadeEdge;
  durationMs: number;
  curve?: AudioFadeCurve;
  linkPolicy?: EditLinkPolicy;
}

export interface BuildSetAudioTrackVolumeInput {
  trackIds: string[];
  volumeDb: number | null;
}

export interface BuildSetAudioTrackMuteInput {
  trackIds: string[];
  muted: boolean;
}

export interface BuildSetAudioTransitionInput {
  clipId: string;
  transition: AudioTransitionSpec | null;
}

export interface BuildCrossfadeAudioClipsInput {
  fromClipId: string;
  toClipId: string;
  durationMs: number;
  curve?: AudioFadeCurve;
}

export interface BuildDuckAudioInput {
  trackId: string;
  duckUnderTrackId: string | null;
  volumeDb?: number | null;
}

export interface BuildSetAudioVolumeKeyframesInput {
  clipId: string;
  keys: Keyframe[];
  mode?: AudioVolumeKeyframeMode;
}

export interface BuildReplaceAudioClipSourceInput {
  clipId: string;
  sourceRef: TimelineSourceRef;
  sourceDurationMs?: number;
  trimStartMs?: number;
  name?: string;
  transcriptText?: string | null;
}

export interface BuildCloseGapInput {
  trackId: string;
  gapStartFrame: number;
  gapEndFrame: number;
}

interface ClipLocation {
  track: TimelineTrack;
  clip: TimelineClip;
}

interface AudioClipLocation {
  track: AudioTimelineTrack;
  clip: AudioTimelineClip;
}

interface SplitClipPair {
  left: TimelineClip;
  right: TimelineClip;
  leftId: string;
  rightId: string;
  splitFrame: number;
  splitMs: number;
  sourceBoundaryFrame: number;
}

export function buildCutClipOps(
  timeline: Timeline,
  input: BuildCutClipInput,
  options: EditBuilderOptions = {},
): EditBuildResult {
  const retain = input.retain ?? 'both';
  const linkPolicy = input.linkPolicy ?? 'linked';
  const primary = requireClipLocation(timeline, input.clipId);
  const targets = splitTargetsForClip(timeline, primary.clip, linkPolicy);
  const idFactory = options.idFactory ?? defaultIdFactory;
  const linkGroups = splitLinkGroups(targets, idFactory);
  const splitOps: TimelineOp[] = [];
  const removeOps: TimelineOp[] = [];
  const createdClipIds: string[] = [];
  const removedClipIds: string[] = [];
  const changedClipIds: string[] = [];
  const affectedTrackIds = new Set<string>();
  const removeLinkGroups = new Set<string>();

  for (const target of targets) {
    const split = splitClipAtFrame(timeline, target.clip, input.atFrame, {
      idFactory,
      leftLinkGroupId: linkGroups.get(target.clip.linkGroupId ?? '')?.left,
      rightLinkGroupId: linkGroups.get(target.clip.linkGroupId ?? '')?.right,
    });
    affectedTrackIds.add(target.track.id);
    changedClipIds.push(target.clip.id);
    createdClipIds.push(split.leftId, split.rightId);
    splitOps.push({
      kind: 'clip.split',
      clipId: target.clip.id,
      at: split.splitMs,
      before: target.clip,
      after: [split.left, split.right],
    });
    if (retain === 'left') {
      pushRetainedCutRemove(
        removeOps,
        removedClipIds,
        removeLinkGroups,
        split.right,
        input.ripple,
      );
    } else if (retain === 'right') {
      pushRetainedCutRemove(
        removeOps,
        removedClipIds,
        removeLinkGroups,
        split.left,
        input.ripple,
      );
    }
  }

  const inspectClipIds =
    retain === 'both'
      ? createdClipIds
      : createdClipIds.filter((id) => !removedClipIds.includes(id));
  return buildResult([...splitOps, ...removeOps], {
    affectedRange: { startFrame: input.atFrame, endFrame: input.atFrame },
    affectedTrackIds: [...affectedTrackIds],
    changedClipIds,
    createdClipIds,
    removedClipIds,
    inspectClipIds,
  });
}

export function buildDuplicateClipsOps(
  timeline: Timeline,
  input: BuildDuplicateClipsInput,
  options: EditBuilderOptions = {},
): EditBuildResult {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const locations = uniqueLocations(
    expandClipIds(timeline, input.clipIds, input.linkPolicy ?? 'primary-only'),
  );
  if (locations.length === 0) {
    throw new EditBuilderError(
      'At least one clip is required',
      'empty_selection',
    );
  }
  const rate = frameRateForTimeline(timeline);
  const anchorStartMs = Math.min(...locations.map(({ clip }) => clip.startMs));
  const afterOriginalsMs = Math.max(
    ...locations.map(({ clip }) => clip.startMs + clip.durationMs),
  );
  const placement = input.placement ?? { kind: 'after-originals' as const };
  const groupRemap = duplicatedLinkGroups(timeline, locations, idFactory);
  const ops: TimelineOp[] = [];
  const createdClipIds: string[] = [];
  const affectedTrackIds = new Set<string>();

  for (const location of locations) {
    const nextId = idFactory();
    const startMs = duplicateStartMs(
      location.clip,
      placement,
      rate,
      anchorStartMs,
      afterOriginalsMs,
    );
    const targetTrackId =
      placement.kind === 'at-frame' && placement.trackId
        ? placement.trackId
        : location.track.id;
    const targetTrack = findTrack(timeline, targetTrackId);
    assertTrackAcceptsClip(targetTrack, location.clip);
    assertTrackUnlocked(targetTrack);
    const clip = withClipFields(location.clip, {
      id: nextId,
      startMs,
      linkGroupId: remappedLinkGroupId(location.clip, groupRemap),
    });
    ops.push({
      kind: 'clip.insert',
      trackId: targetTrackId,
      clip,
      at: startMs,
    });
    createdClipIds.push(nextId);
    affectedTrackIds.add(targetTrackId);
  }

  return buildResult(ops, {
    affectedTrackIds: [...affectedTrackIds],
    createdClipIds,
    inspectClipIds: createdClipIds,
  });
}

export function buildCutRangeOps(
  timeline: Timeline,
  input: BuildCutRangeInput,
): EditBuildResult {
  if (input.endFrame <= input.startFrame) {
    throw new EditBuilderError(
      'Cut range endFrame must be after startFrame',
      'range_invalid',
      { startFrame: input.startFrame, endFrame: input.endFrame },
    );
  }
  const rate = frameRateForTimeline(timeline);
  const startMs = frameToMs(input.startFrame, rate);
  const endMs = frameToMs(input.endFrame, rate);
  if (input.trackId) {
    assertTrackUnlocked(findTrack(timeline, input.trackId));
  }
  return buildResult(
    [
      {
        kind: 'clip.removeTimeRange',
        trackId: input.trackId,
        startMs,
        endMs,
        magnetic: input.ripple,
      },
    ],
    {
      affectedRange: {
        startFrame: input.startFrame,
        endFrame: input.endFrame,
      },
      affectedTrackIds: input.trackId ? [input.trackId] : [],
    },
  );
}

export function buildDeleteClipsOps(
  timeline: Timeline,
  input: BuildDeleteClipsInput,
): EditBuildResult {
  const linkPolicy = input.linkPolicy ?? 'linked';
  const expandedLocations = expandClipIds(timeline, input.clipIds, linkPolicy);
  const locations = deleteLocations(timeline, input.clipIds, linkPolicy);
  const ops = locations
    .slice()
    .sort((left, right) => right.clip.startMs - left.clip.startMs)
    .map<TimelineOp>(({ clip }) => ({
      kind: 'clip.remove',
      clipId: clip.id,
      snapshot: clip,
      magnetic: input.ripple,
    }));
  return buildResult(ops, {
    affectedTrackIds: unique(expandedLocations.map(({ track }) => track.id)),
    removedClipIds: unique(expandedLocations.map(({ clip }) => clip.id)),
  });
}

export function buildMoveClipOps(
  timeline: Timeline,
  input: BuildMoveClipInput,
): EditBuildResult {
  const location = requireClipLocation(timeline, input.clipId);
  if (input.linkPolicy === 'primary-only' && location.clip.linkGroupId) {
    throw new EditBuilderError(
      'Primary-only linked clip moves are not supported yet',
      'linked_primary_only_unsupported',
      { clipId: input.clipId },
    );
  }
  assertTrackUnlocked(location.track);
  const targetTrack = input.toTrackId
    ? findTrack(timeline, input.toTrackId)
    : location.track;
  assertTrackUnlocked(targetTrack);
  assertTrackAcceptsClip(targetTrack, location.clip);
  const toMs = frameToMs(input.toFrame, frameRateForTimeline(timeline));
  const movedLocations = linkedLocationsForMetadata(
    timeline,
    location.clip,
    input.linkPolicy,
  );
  return buildResult(
    [
      {
        kind: 'clip.move',
        clipId: input.clipId,
        from: { trackId: location.track.id, startMs: location.clip.startMs },
        to: { trackId: targetTrack.id, startMs: toMs },
        magnetic: input.magnetic,
      },
    ],
    {
      affectedRange: {
        startFrame: Math.min(
          frameForMs(timeline, location.clip.startMs),
          input.toFrame,
        ),
        endFrame: Math.max(
          frameForMs(
            timeline,
            location.clip.startMs + location.clip.durationMs,
          ),
          input.toFrame + frameCountForMs(timeline, location.clip.durationMs),
        ),
      },
      affectedTrackIds: unique([
        ...movedLocations.map(({ track }) => track.id),
        targetTrack.id,
      ]),
      changedClipIds: clipIdsMovedByLinkedOperation(timeline, location.clip),
      inspectClipIds: [input.clipId],
    },
  );
}

export function buildTrimClipOps(
  timeline: Timeline,
  input: BuildTrimClipInput,
): EditBuildResult {
  const location = requireClipLocation(timeline, input.clipId);
  if (input.linkPolicy === 'primary-only' && location.clip.linkGroupId) {
    throw new EditBuilderError(
      'Primary-only linked clip trims are not supported yet',
      'linked_primary_only_unsupported',
      { clipId: input.clipId },
    );
  }
  assertTrackUnlocked(location.track);
  const from = timingState(location.clip);
  const to = trimTimingByFrames(timeline, location.clip, input);
  const trimmedLocations = linkedLocationsForMetadata(
    timeline,
    location.clip,
    input.linkPolicy,
  );
  return buildResult(
    [
      {
        kind: 'clip.trim',
        clipId: input.clipId,
        from,
        to,
        magnetic: input.magnetic,
      },
    ],
    {
      affectedRange: rangeForTiming(timeline, to),
      affectedTrackIds: unique(trimmedLocations.map(({ track }) => track.id)),
      changedClipIds: clipIdsMovedByLinkedOperation(timeline, location.clip),
      inspectClipIds: [input.clipId],
    },
  );
}

export function buildSetClipSpeedOps(
  timeline: Timeline,
  input: BuildSetClipSpeedInput,
): EditBuildResult {
  const timingPolicy = input.timingPolicy ?? 'preserve-source-span';
  const linkPolicy = input.linkPolicy ?? 'linked';
  const locations = uniqueLocations(
    expandClipIds(timeline, input.clipIds, linkPolicy),
  );
  const ops: TimelineOp[] = [];
  const trimGroups = new Set<string>();
  const changedClipIds: string[] = [];
  const affectedTrackIds = new Set<string>();

  for (const location of locations) {
    const currentPlayback = normalizeClipPlayback(
      location.clip.playback,
      location.clip.params,
    );
    const nextPlayback = normalizeClipPlayback({
      ...currentPlayback,
      speed: input.speed,
      ...(input.pitchCorrection !== undefined
        ? { pitchCorrection: input.pitchCorrection }
        : {}),
      ...(input.smoothSlowMo !== undefined
        ? { smoothSlowMo: input.smoothSlowMo }
        : {}),
      ...(input.interpolationQuality !== undefined
        ? { interpolationQuality: input.interpolationQuality }
        : {}),
    });
    ops.push({
      kind: 'clip.setPlayback',
      clipId: location.clip.id,
      before: location.clip.playback ?? null,
      after: isDefaultClipPlayback(nextPlayback) ? null : nextPlayback,
      timingPolicy,
    });
    changedClipIds.push(location.clip.id);
    affectedTrackIds.add(location.track.id);

    const trimKey = location.clip.linkGroupId ?? location.clip.id;
    if (trimGroups.has(trimKey)) continue;
    const to = speedTiming(timeline, location.clip, nextPlayback, timingPolicy);
    if (!timingEquals(timingState(location.clip), to)) {
      ops.push({
        kind: 'clip.trim',
        clipId: location.clip.id,
        from: timingState(location.clip),
        to,
        magnetic: input.ripple,
      });
    }
    trimGroups.add(trimKey);
  }

  return buildResult(ops, {
    affectedTrackIds: [...affectedTrackIds],
    changedClipIds,
    inspectClipIds: changedClipIds,
  });
}

export function buildReverseClipOps(
  timeline: Timeline,
  input: BuildReverseClipInput,
): EditBuildResult {
  const locations = uniqueLocations(
    expandClipIds(timeline, input.clipIds, input.linkPolicy ?? 'linked'),
  );
  const ops = locations.map<TimelineOp>(({ clip }) => {
    const currentPlayback = normalizeClipPlayback(clip.playback, clip.params);
    const nextPlayback = normalizeClipPlayback({
      ...currentPlayback,
      reverse: input.reverse,
    });
    return {
      kind: 'clip.setPlayback',
      clipId: clip.id,
      before: clip.playback ?? null,
      after: isDefaultClipPlayback(nextPlayback) ? null : nextPlayback,
    };
  });
  return buildResult(ops, {
    affectedTrackIds: unique(locations.map(({ track }) => track.id)),
    changedClipIds: locations.map(({ clip }) => clip.id),
    inspectClipIds: locations.map(({ clip }) => clip.id),
  });
}

export function buildRotateClipOps(
  timeline: Timeline,
  input: BuildRotateClipInput,
): EditBuildResult {
  const locations = visualLocations(timeline, input.clipIds);
  const ops = locations.map<TimelineOp>(({ clip }) => {
    const before = clip.transforms ?? null;
    const currentRotation = clip.transforms?.rotation ?? 0;
    const rotation = input.relative
      ? normalizeRotation(currentRotation + input.degrees)
      : normalizeRotation(input.degrees);
    return {
      kind: 'clip.setTransform',
      clipId: clip.id,
      before,
      after: { ...(clip.transforms ?? {}), rotation },
    };
  });
  return transformBuildResult(ops, locations);
}

export function buildFlipClipOps(
  timeline: Timeline,
  input: BuildFlipClipInput,
): EditBuildResult {
  if (!input.horizontal && !input.vertical) {
    throw new EditBuilderError(
      'At least one flip axis is required',
      'flip_axis_required',
    );
  }
  const locations = visualLocations(timeline, input.clipIds);
  const mode = input.mode ?? 'toggle';
  const ops = locations.map<TimelineOp>(({ clip }) => {
    const transform = clip.transforms ?? {};
    const next: ClipTransform = { ...transform };
    if (input.horizontal) {
      const value = transform.scaleX ?? transform.scale ?? 1;
      next.scaleX = mode === 'toggle' ? -value : -Math.abs(value);
    }
    if (input.vertical) {
      const value = transform.scaleY ?? transform.scale ?? 1;
      next.scaleY = mode === 'toggle' ? -value : -Math.abs(value);
    }
    return {
      kind: 'clip.setTransform',
      clipId: clip.id,
      before: clip.transforms ?? null,
      after: next,
    };
  });
  return transformBuildResult(ops, locations);
}

export function buildSetClipTransformOps(
  timeline: Timeline,
  input: BuildSetClipTransformInput,
): EditBuildResult {
  const locations = visualLocations(timeline, input.clipIds);
  const merge = input.merge ?? true;
  const ops = locations.map<TimelineOp>(({ clip }) => ({
    kind: 'clip.setTransform',
    clipId: clip.id,
    before: clip.transforms ?? null,
    after: merge
      ? { ...(clip.transforms ?? {}), ...input.transform }
      : input.transform,
  }));
  return transformBuildResult(ops, locations);
}

export function buildSetAudioClipGainOps(
  timeline: Timeline,
  input: BuildSetAudioClipGainInput,
): EditBuildResult {
  if (input.gainDb !== null) assertVolumeDbValid(input.gainDb);
  return buildAudioClipPatchOps(
    timeline,
    input.clipIds,
    () => ({ gainDb: input.gainDb }),
    input.linkPolicy,
  );
}

export function buildSetAudioClipMuteOps(
  timeline: Timeline,
  input: BuildSetAudioClipMuteInput,
): EditBuildResult {
  return buildAudioClipPatchOps(
    timeline,
    input.clipIds,
    () => ({ muted: input.muted }),
    input.linkPolicy,
  );
}

export function buildSetAudioClipFadeOps(
  timeline: Timeline,
  input: BuildSetAudioClipFadeInput,
): EditBuildResult {
  assertNonNegativeInteger(input.durationMs, 'durationMs');
  const curve = input.curve ?? 'linear';
  return buildAudioClipPatchOps(
    timeline,
    input.clipIds,
    (clip) => {
      const durationMs = Math.min(input.durationMs, clip.durationMs);
      const patch: AudioClipAudioPatch = {};
      if (input.edge === 'in' || input.edge === 'both') {
        patch.fadeInMs = durationMs;
        patch.fadeInCurve = durationMs > 0 ? curve : null;
      }
      if (input.edge === 'out' || input.edge === 'both') {
        patch.fadeOutMs = durationMs;
        patch.fadeOutCurve = durationMs > 0 ? curve : null;
      }
      return patch;
    },
    input.linkPolicy,
  );
}

export function buildSetAudioTrackVolumeOps(
  timeline: Timeline,
  input: BuildSetAudioTrackVolumeInput,
): EditBuildResult {
  if (input.volumeDb !== null) assertVolumeDbValid(input.volumeDb);
  const locations = audioTracks(timeline, input.trackIds);
  const ops = locations.map<TimelineOp>((track) => ({
    kind: 'track.update',
    trackId: track.id,
    before: { volumeDb: track.volumeDb ?? null },
    after: { volumeDb: input.volumeDb },
  }));
  return buildResult(ops, {
    affectedTrackIds: locations.map((track) => track.id),
  });
}

export function buildSetAudioTrackMuteOps(
  timeline: Timeline,
  input: BuildSetAudioTrackMuteInput,
): EditBuildResult {
  const locations = audioTracks(timeline, input.trackIds);
  const ops = locations.map<TimelineOp>((track) => ({
    kind: 'track.update',
    trackId: track.id,
    before: { muted: track.muted },
    after: { muted: input.muted },
  }));
  return buildResult(ops, {
    affectedTrackIds: locations.map((track) => track.id),
  });
}

export function buildSetAudioTransitionOps(
  timeline: Timeline,
  input: BuildSetAudioTransitionInput,
): EditBuildResult {
  const location = requireAudioClipLocation(timeline, input.clipId);
  assertTrackUnlocked(location.track);
  let nextClip: AudioTimelineClip | null = null;
  let after: AudioTransitionSpec | null = null;
  if (input.transition !== null) {
    nextClip = requireNextAdjacentAudioClip(location);
    after = normalizeAudioTransition(location.clip, nextClip, input.transition);
  }
  const inspectClipIds = [location.clip.id];
  if (nextClip) inspectClipIds.push(nextClip.id);
  return buildResult(
    [
      {
        kind: 'clip.setAudioTransition',
        clipId: location.clip.id,
        before: location.clip.audioTransitionToNext ?? null,
        after,
      },
    ],
    {
      affectedTrackIds: [location.track.id],
      changedClipIds: [location.clip.id],
      inspectClipIds,
      affectedRange: rangeForTiming(timeline, location.clip),
    },
  );
}

export function buildCrossfadeAudioClipsOps(
  timeline: Timeline,
  input: BuildCrossfadeAudioClipsInput,
): EditBuildResult {
  assertNonNegativeInteger(input.durationMs, 'durationMs');
  const from = requireAudioClipLocation(timeline, input.fromClipId);
  const to = requireAudioClipLocation(timeline, input.toClipId);
  if (from.track.id !== to.track.id) {
    throw new EditBuilderError(
      'Audio crossfade clips must be on the same track',
      'audio_crossfade_track_mismatch',
      { clipId: input.fromClipId, trackId: from.track.id },
    );
  }
  assertTrackUnlocked(from.track);
  assertAdjacentAudioClips(from.clip, to.clip);
  return buildSetAudioTransitionOps(timeline, {
    clipId: input.fromClipId,
    transition: {
      kind: 'crossfade',
      durationMs: input.durationMs,
      curve: input.curve,
    },
  });
}

export function buildDuckAudioOps(
  timeline: Timeline,
  input: BuildDuckAudioInput,
): EditBuildResult {
  const track = requireAudioTrack(timeline, input.trackId);
  assertTrackUnlocked(track);
  if (input.duckUnderTrackId !== null) {
    findTrack(timeline, input.duckUnderTrackId);
  }
  if (input.volumeDb !== undefined && input.volumeDb !== null) {
    assertVolumeDbValid(input.volumeDb);
  }
  const before: TrackUpdatePatch = {
    duckUnderTrackId: track.duckUnderTrackId ?? null,
  };
  const after: TrackUpdatePatch = { duckUnderTrackId: input.duckUnderTrackId };
  if (input.volumeDb !== undefined) {
    before.volumeDb = track.volumeDb ?? null;
    after.volumeDb = input.volumeDb;
  }
  return buildResult(
    [
      {
        kind: 'track.update',
        trackId: track.id,
        before,
        after,
      },
    ],
    { affectedTrackIds: [track.id] },
  );
}

export function buildSetAudioVolumeKeyframesOps(
  timeline: Timeline,
  input: BuildSetAudioVolumeKeyframesInput,
): EditBuildResult {
  const location = requireAudioClipLocation(timeline, input.clipId);
  assertTrackUnlocked(location.track);
  const track = normalizedVolumeKeyframeTrack(location.clip, input.keys);
  const mode = input.mode ?? 'replace';
  const ops =
    mode === 'replace'
      ? [
          {
            kind: 'keyframe.setTrack' as const,
            clipId: location.clip.id,
            property: 'volumeDb' as const,
            before:
              findKeyframeTrack(location.clip.keyframes, 'volumeDb') ?? null,
            after: track,
          },
        ]
      : (track?.keys ?? []).map<TimelineOp>((key) => ({
          kind: 'keyframe.upsert',
          clipId: location.clip.id,
          property: 'volumeDb',
          key,
          before:
            findKeyframeAt(
              findKeyframeTrack(location.clip.keyframes, 'volumeDb'),
              key.atMs,
            ) ?? null,
        }));
  return buildResult(ops, {
    affectedTrackIds: [location.track.id],
    changedClipIds: [location.clip.id],
    inspectClipIds: [location.clip.id],
    affectedRange: rangeForTiming(timeline, location.clip),
  });
}

export function buildReplaceAudioClipSourceOps(
  timeline: Timeline,
  input: BuildReplaceAudioClipSourceInput,
): EditBuildResult {
  const location = requireAudioClipLocation(timeline, input.clipId);
  assertTrackUnlocked(location.track);
  const trimStartMs = input.trimStartMs ?? 0;
  assertNonNegativeInteger(trimStartMs, 'trimStartMs');
  const trimEndMs = trimStartMs + location.clip.durationMs;
  if (input.sourceDurationMs !== undefined) {
    assertNonNegativeInteger(input.sourceDurationMs, 'sourceDurationMs');
    if (trimEndMs > input.sourceDurationMs) {
      throw new EditBuilderError(
        'Replacement source is shorter than the preserved clip duration',
        'audio_source_too_short',
        { clipId: input.clipId },
      );
    }
  }
  const clip = replacementAudioClip(location.clip, {
    sourceRef: input.sourceRef,
    trimStartMs,
    trimEndMs,
    sourceDurationMs: input.sourceDurationMs,
    name: input.name,
    transcriptText: input.transcriptText,
  });
  return buildResult(
    [
      {
        kind: 'clip.remove',
        clipId: location.clip.id,
        snapshot: location.clip,
      },
      {
        kind: 'clip.insert',
        trackId: location.track.id,
        clip,
        at: location.clip.startMs,
      },
    ],
    {
      affectedTrackIds: [location.track.id],
      changedClipIds: [location.clip.id],
      inspectClipIds: [location.clip.id],
      affectedRange: rangeForTiming(timeline, location.clip),
    },
  );
}

export interface BuildAddVividOverlayClipInput {
  trackId: string;
  presetId: string;
  backend: VividOverlayBackendId;
  startMs: number;
  durationMs: number;
  controls?: Record<string, VividOverlayControlValue>;
  sourceAssetId?: string;
  loop?: VividOverlayLoopMode;
  name?: string;
}

export function buildAddVividOverlayClipOps(
  timeline: Timeline,
  input: BuildAddVividOverlayClipInput,
  options: EditBuilderOptions = {},
): EditBuildResult {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const track = findTrack(timeline, input.trackId);
  if (track.kind !== 'overlay') {
    throw new EditBuilderError(
      'Vivid overlay clips require an overlay track',
      'track_clip_kind_mismatch',
      { trackId: track.id },
    );
  }
  assertTrackUnlocked(track);
  if (!Number.isInteger(input.durationMs) || input.durationMs <= 0) {
    throw new EditBuilderError(
      'Overlay duration must be a positive integer',
      'invalid_duration',
      { durationMs: input.durationMs },
    );
  }
  if (!Number.isInteger(input.startMs) || input.startMs < 0) {
    throw new EditBuilderError(
      'Overlay start must be a non-negative integer',
      'invalid_start',
      { startMs: input.startMs },
    );
  }
  const params = VividOverlayParamsSchema.parse({
    presetId: input.presetId,
    backend: input.backend,
    controls: input.controls ?? {},
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
    ...(input.loop ? { loop: input.loop } : {}),
  });
  const clip: EffectTimelineClip = {
    id: idFactory(),
    kind: 'effect',
    effectType: VIVID_OVERLAY_EFFECT_TYPE,
    ...(input.name ? { name: input.name } : {}),
    sourceRef: vividOverlaySourceRef(input.presetId),
    startMs: input.startMs,
    durationMs: input.durationMs,
    trimStartMs: 0,
    trimEndMs: input.durationMs,
    params,
  };
  return buildResult(
    [{ kind: 'clip.insert', trackId: track.id, clip, at: input.startMs }],
    {
      affectedTrackIds: [track.id],
      createdClipIds: [clip.id],
      inspectClipIds: [clip.id],
    },
  );
}

export interface BuildSetClipParamsInput {
  clipId: string;
  /** Shallow-merged into the clip's current params; a `null` value deletes the key. */
  patch: Record<string, unknown>;
}

export function buildSetClipParamsOps(
  timeline: Timeline,
  input: BuildSetClipParamsInput,
): EditBuildResult {
  const location = requireClipLocation(timeline, input.clipId);
  const before = location.clip.params ?? null;
  const after: Record<string, unknown> = { ...(before ?? {}) };
  for (const [key, value] of Object.entries(input.patch)) {
    if (value === null) {
      delete after[key];
    } else {
      after[key] = value;
    }
  }
  if (isVividOverlayClip(location.clip) && !parseVividOverlayParams(after)) {
    throw new EditBuilderError(
      'Patched params are not a valid vivid overlay payload',
      'invalid_overlay_params',
      { clipId: input.clipId },
    );
  }
  const ops: TimelineOp[] = [
    { kind: 'clip.setParams', clipId: location.clip.id, before, after },
  ];
  return buildResult(ops, {
    affectedTrackIds: [location.track.id],
    changedClipIds: [location.clip.id],
    inspectClipIds: [location.clip.id],
  });
}

export interface BuildSetVividOverlayControlsInput {
  clipId: string;
  /** Merged into params.controls. */
  controls?: Record<string, VividOverlayControlValue>;
  loop?: VividOverlayLoopMode;
  sourceAssetId?: string;
  /**
   * The preset's control definitions (from the app-layer registry — video-ir
   * has no catalog). When provided, the merged controls are validated and the
   * builder throws on unknown ids, wrong types, or out-of-range numbers.
   */
  controlDefs?: readonly VividOverlayControlDef[];
}

export function buildSetVividOverlayControlsOps(
  timeline: Timeline,
  input: BuildSetVividOverlayControlsInput,
): EditBuildResult {
  const location = requireClipLocation(timeline, input.clipId);
  if (!isVividOverlayClip(location.clip)) {
    throw new EditBuilderError(
      'Overlay control edits require a vivid overlay clip',
      'clip_kind_invalid',
      { clipId: input.clipId },
    );
  }
  const params = parseVividOverlayParams(location.clip.params);
  if (!params) {
    throw new EditBuilderError(
      'Clip params are not a valid vivid overlay payload',
      'invalid_overlay_params',
      { clipId: input.clipId },
    );
  }
  const mergedControls = { ...params.controls, ...(input.controls ?? {}) };
  if (input.controlDefs) {
    const errors = vividOverlayControlErrors(mergedControls, input.controlDefs);
    if (errors.length > 0) {
      throw new EditBuilderError(
        `Invalid overlay controls: ${errors.join('; ')}`,
        'invalid_overlay_controls',
        { clipId: input.clipId },
      );
    }
  }
  const after = VividOverlayParamsSchema.parse({
    ...params,
    controls: mergedControls,
    ...(input.loop ? { loop: input.loop } : {}),
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
  });
  const ops: TimelineOp[] = [
    {
      kind: 'clip.setParams',
      clipId: location.clip.id,
      before: location.clip.params ?? null,
      after,
    },
  ];
  return buildResult(ops, {
    affectedTrackIds: [location.track.id],
    changedClipIds: [location.clip.id],
    inspectClipIds: [location.clip.id],
  });
}

export interface BuildSetVividOverlayControlKeyframesInput {
  clipId: string;
  controlId: string;
  /**
   * Replaces this control's keyframe track. Empty keys clear the track.
   * Only numeric preset controls are accepted when controlDefs are provided.
   */
  keys: readonly Keyframe[];
  controlDefs?: readonly VividOverlayControlDef[];
}

export function buildSetVividOverlayControlKeyframesOps(
  timeline: Timeline,
  input: BuildSetVividOverlayControlKeyframesInput,
): EditBuildResult {
  const location = requireClipLocation(timeline, input.clipId);
  if (!isVividOverlayClip(location.clip)) {
    throw new EditBuilderError(
      'Overlay control keyframes require a vivid overlay clip',
      'clip_kind_invalid',
      { clipId: input.clipId },
    );
  }
  const params = parseVividOverlayParams(location.clip.params);
  if (!params) {
    throw new EditBuilderError(
      'Clip params are not a valid vivid overlay payload',
      'invalid_overlay_params',
      { clipId: input.clipId },
    );
  }

  const nextTracks: VividOverlayControlKeyframeTrack[] = [
    ...(params.controlKeyframes ?? []).filter(
      (track) => track.controlId !== input.controlId,
    ),
  ];
  if (input.keys.length > 0) {
    nextTracks.push({
      controlId: input.controlId,
      keys: [...input.keys],
    });
  }

  if (input.controlDefs) {
    const errors = vividOverlayControlKeyframeErrors(
      nextTracks,
      input.controlDefs,
      location.clip.durationMs,
    );
    if (errors.length > 0) {
      throw new EditBuilderError(
        `Invalid overlay control keyframes: ${errors.join('; ')}`,
        'invalid_overlay_control_keyframes',
        { clipId: input.clipId },
      );
    }
  }

  const nextParams: VividOverlayParams = { ...params };
  if (nextTracks.length > 0) {
    nextParams.controlKeyframes = nextTracks;
  } else {
    delete nextParams.controlKeyframes;
  }
  const after = VividOverlayParamsSchema.parse(nextParams);
  const ops: TimelineOp[] = [
    {
      kind: 'clip.setParams',
      clipId: location.clip.id,
      before: location.clip.params ?? null,
      after,
    },
  ];
  return buildResult(ops, {
    affectedTrackIds: [location.track.id],
    changedClipIds: [location.clip.id],
    inspectClipIds: [location.clip.id],
  });
}

export interface BuildApplyVividOverlayMotionTemplateInput {
  clipId: string;
  templateId: VividOverlayMotionTemplateId;
  strength?: VividOverlayMotionTemplateStrength;
  category?: VividOverlayCategory;
  appliedAt?: string;
}

export function buildApplyVividOverlayMotionTemplateOps(
  timeline: Timeline,
  input: BuildApplyVividOverlayMotionTemplateInput,
): EditBuildResult {
  const location = requireClipLocation(timeline, input.clipId);
  if (!isVividOverlayClip(location.clip)) {
    throw new EditBuilderError(
      'Overlay motion templates require a vivid overlay clip',
      'clip_kind_invalid',
      { clipId: input.clipId },
    );
  }
  const params = parseVividOverlayParams(location.clip.params);
  if (!params) {
    throw new EditBuilderError(
      'Clip params are not a valid vivid overlay payload',
      'invalid_overlay_params',
      { clipId: input.clipId },
    );
  }
  const template = findVividOverlayMotionTemplate(input.templateId);
  if (!template) {
    throw new EditBuilderError(
      `Unknown overlay motion template: ${input.templateId}`,
      'overlay_motion_template_unknown',
      { clipId: input.clipId },
    );
  }
  if (!vividOverlayMotionTemplateSupportsCategory(template, input.category)) {
    throw new EditBuilderError(
      `Overlay motion template ${template.id} is not compatible with ${input.category}`,
      'overlay_motion_template_incompatible',
      { clipId: input.clipId },
    );
  }

  const strength = input.strength ?? 'normal';
  const tracks = buildVividOverlayMotionTemplateTracks({
    templateId: template.id,
    strength,
    clipDurationMs: location.clip.durationMs,
    transforms: location.clip.transforms,
  });
  if (tracks.length === 0) {
    throw new EditBuilderError(
      `Overlay motion template ${template.id} produced no tracks`,
      'overlay_motion_template_empty',
      { clipId: input.clipId },
    );
  }

  const affectedProperties = tracks.map((track) => track.property);
  const ops: TimelineOp[] = tracks.map((track) => ({
    kind: 'keyframe.setTrack',
    clipId: location.clip.id,
    property: track.property,
    before: findKeyframeTrack(location.clip.keyframes, track.property),
    after: track,
  }));
  const after = VividOverlayParamsSchema.parse({
    ...params,
    motionTemplate: {
      source: 'motion-template',
      templateId: template.id,
      strength,
      appliedAt: input.appliedAt ?? new Date().toISOString(),
      affectedProperties,
    },
  });
  ops.push({
    kind: 'clip.setParams',
    clipId: location.clip.id,
    before: location.clip.params ?? null,
    after,
  });

  return buildResult(ops, {
    affectedTrackIds: [location.track.id],
    changedClipIds: [location.clip.id],
    inspectClipIds: [location.clip.id],
  });
}

export function buildCloseGapOps(
  timeline: Timeline,
  input: BuildCloseGapInput,
): EditBuildResult {
  if (input.gapEndFrame <= input.gapStartFrame) {
    throw new EditBuilderError(
      'Gap endFrame must be after gapStartFrame',
      'gap_invalid',
      {
        gapStartFrame: input.gapStartFrame,
        gapEndFrame: input.gapEndFrame,
      },
    );
  }
  const track = findTrack(timeline, input.trackId);
  assertTrackUnlocked(track);
  const rate = frameRateForTimeline(timeline);
  const gapStartMs = frameToMs(input.gapStartFrame, rate);
  const gapEndMs = frameToMs(input.gapEndFrame, rate);
  const gapDurationMs = gapEndMs - gapStartMs;
  const overlapping = track.clips.find(
    (clip) =>
      clip.startMs < gapEndMs && clip.startMs + clip.durationMs > gapStartMs,
  );
  if (overlapping) {
    throw new EditBuilderError(
      'Cannot close a range that overlaps a clip',
      'gap_not_empty',
      { trackId: track.id, clipId: overlapping.id },
    );
  }
  const movedClips = track.clips
    .filter((clip) => clip.startMs >= gapEndMs)
    .sort((left, right) => left.startMs - right.startMs);
  const ops = movedClips.map<TimelineOp>((clip) => ({
    kind: 'clip.move',
    clipId: clip.id,
    from: { trackId: track.id, startMs: clip.startMs },
    to: { trackId: track.id, startMs: clip.startMs - gapDurationMs },
  }));
  return buildResult(ops, {
    affectedRange: {
      startFrame: input.gapStartFrame,
      endFrame:
        movedClips.length > 0
          ? frameForMs(
              timeline,
              Math.max(
                ...movedClips.map((clip) => clip.startMs + clip.durationMs),
              ),
            )
          : input.gapEndFrame,
    },
    affectedTrackIds: [track.id],
    changedClipIds: movedClips.map((clip) => clip.id),
    shiftedClipIds: movedClips.map((clip) => clip.id),
    inspectClipIds: movedClips.map((clip) => clip.id),
  });
}

const AUDIO_CLIP_AUDIO_PATCH_KEYS = [
  'gainDb',
  'muted',
  'fadeInMs',
  'fadeOutMs',
  'fadeInCurve',
  'fadeOutCurve',
] as const;

type AudioClipAudioPatchKey = (typeof AUDIO_CLIP_AUDIO_PATCH_KEYS)[number];

function buildAudioClipPatchOps(
  timeline: Timeline,
  clipIds: readonly string[],
  patchForClip: (clip: AudioTimelineClip) => AudioClipAudioPatch,
  linkPolicy: EditLinkPolicy | undefined,
): EditBuildResult {
  const locations = audioClipLocations(
    timeline,
    clipIds,
    linkPolicy ?? 'primary-only',
  );
  const ops = locations.map<TimelineOp>(({ clip }) => {
    const after = patchForClip(clip);
    return {
      kind: 'clip.setAudio',
      clipId: clip.id,
      before: audioPatchFromClip(clip, audioPatchKeys(after)),
      after,
    };
  });
  return audioClipBuildResult(timeline, ops, locations);
}

function audioClipBuildResult(
  timeline: Timeline,
  ops: TimelineOp[],
  locations: readonly AudioClipLocation[],
): EditBuildResult {
  return buildResult(ops, {
    affectedTrackIds: unique(locations.map(({ track }) => track.id)),
    changedClipIds: locations.map(({ clip }) => clip.id),
    inspectClipIds: locations.map(({ clip }) => clip.id),
    affectedRange: rangeForLocations(timeline, locations),
  });
}

function audioPatchKeys(patch: AudioClipAudioPatch): AudioClipAudioPatchKey[] {
  return AUDIO_CLIP_AUDIO_PATCH_KEYS.filter((key) => key in patch);
}

function audioPatchFromClip(
  clip: AudioTimelineClip,
  keys: readonly AudioClipAudioPatchKey[],
): AudioClipAudioPatch {
  const patch: AudioClipAudioPatch = {};
  for (const key of keys) {
    switch (key) {
      case 'gainDb':
        patch.gainDb = clip.gainDb ?? null;
        break;
      case 'muted':
        patch.muted = clip.muted ?? null;
        break;
      case 'fadeInMs':
        patch.fadeInMs = clip.fadeInMs ?? null;
        break;
      case 'fadeOutMs':
        patch.fadeOutMs = clip.fadeOutMs ?? null;
        break;
      case 'fadeInCurve':
        patch.fadeInCurve = clip.fadeInCurve ?? null;
        break;
      case 'fadeOutCurve':
        patch.fadeOutCurve = clip.fadeOutCurve ?? null;
        break;
      default: {
        const exhaustive: never = key;
        return exhaustive;
      }
    }
  }
  return patch;
}

function audioClipLocations(
  timeline: Timeline,
  clipIds: readonly string[],
  policy: EditLinkPolicy,
): AudioClipLocation[] {
  if (clipIds.length === 0) {
    throw new EditBuilderError(
      'At least one audio clip is required',
      'empty_selection',
    );
  }
  const result: AudioClipLocation[] = [];
  for (const clipId of clipIds) {
    const location = requireAudioClipLocation(timeline, clipId);
    result.push(location);
    if (policy !== 'linked' || !location.clip.linkGroupId) continue;
    result.push(
      ...locationsForLinkGroup(timeline, location.clip.linkGroupId)
        .filter(isAudioClipLocation)
        .filter(({ clip }) => clip.id !== location.clip.id),
    );
  }
  const uniqueResult = uniqueAudioLocations(result);
  for (const { track } of uniqueResult) {
    assertTrackUnlocked(track);
  }
  return uniqueResult;
}

function audioTracks(
  timeline: Timeline,
  trackIds: readonly string[],
): AudioTimelineTrack[] {
  if (trackIds.length === 0) {
    throw new EditBuilderError(
      'At least one audio track is required',
      'empty_selection',
    );
  }
  const tracks = trackIds.map((trackId) =>
    requireAudioTrack(timeline, trackId),
  );
  for (const track of tracks) {
    assertTrackUnlocked(track);
  }
  return uniqueAudioTracks(tracks);
}

function requireAudioClipLocation(
  timeline: Timeline,
  clipId: string,
): AudioClipLocation {
  const location = requireClipLocation(timeline, clipId);
  if (!isAudioClipLocation(location)) {
    throw new EditBuilderError(
      'Audio edits require audio clips',
      'audio_clip_required',
      { clipId },
    );
  }
  return location;
}

function requireAudioTrack(
  timeline: Timeline,
  trackId: string,
): AudioTimelineTrack {
  const track = findTrack(timeline, trackId);
  if (!isAudioTrack(track)) {
    throw new EditBuilderError(
      'Audio track edit requires an audio track',
      'audio_track_required',
      { trackId },
    );
  }
  return track;
}

function requireNextAdjacentAudioClip(
  location: AudioClipLocation,
): AudioTimelineClip {
  const next = nextAudioClip(location.track, location.clip);
  if (!next) {
    throw new EditBuilderError(
      'Audio transition requires a following audio clip',
      'audio_transition_missing_next',
      { clipId: location.clip.id, trackId: location.track.id },
    );
  }
  assertAdjacentAudioClips(location.clip, next);
  return next;
}

function nextAudioClip(
  track: AudioTimelineTrack,
  clip: AudioTimelineClip,
): AudioTimelineClip | null {
  return (
    track.clips
      .filter((item) => item.startMs >= clip.startMs + clip.durationMs)
      .sort((left, right) => left.startMs - right.startMs)[0] ?? null
  );
}

function assertAdjacentAudioClips(
  from: AudioTimelineClip,
  to: AudioTimelineClip,
): void {
  if (from.startMs + from.durationMs === to.startMs) return;
  throw new EditBuilderError(
    'Audio transition requires adjacent audio clips',
    'audio_clips_not_adjacent',
    { clipId: from.id },
  );
}

function normalizeAudioTransition(
  from: AudioTimelineClip,
  to: AudioTimelineClip,
  transition: AudioTransitionSpec,
): AudioTransitionSpec {
  assertNonNegativeInteger(transition.durationMs, 'durationMs');
  const durationMs = Math.min(
    transition.durationMs,
    from.durationMs,
    to.durationMs,
  );
  if (transition.kind === 'cut') {
    return { kind: 'cut', durationMs };
  }
  return {
    kind: 'crossfade',
    durationMs,
    curve: transition.curve ?? 'equal-power',
  };
}

function normalizedVolumeKeyframeTrack(
  clip: AudioTimelineClip,
  keys: readonly Keyframe[],
): KeyframeTrack | null {
  if (keys.length === 0) return null;
  for (const key of keys) {
    assertKeyframeFitsClip(clip, key);
    assertVolumeDbValid(key.value);
  }
  const track = normalizeKeyframeTrack({
    property: 'volumeDb',
    keys: [...keys],
  });
  const error = keyframeTrackValidationError(track);
  if (error) {
    throw new EditBuilderError(error, 'keyframe_track_invalid');
  }
  return track;
}

function assertKeyframeFitsClip(clip: AudioTimelineClip, key: Keyframe): void {
  assertNonNegativeInteger(key.atMs, 'atMs');
  if (key.atMs <= clip.durationMs) return;
  throw new EditBuilderError(
    'Audio volume keyframe must fit inside the clip duration',
    'keyframe_timing_invalid',
    { clipId: clip.id, atMs: key.atMs },
  );
}

function replacementAudioClip(
  clip: AudioTimelineClip,
  input: {
    sourceRef: TimelineSourceRef;
    trimStartMs: number;
    trimEndMs: number;
    sourceDurationMs: number | undefined;
    name: string | undefined;
    transcriptText: string | null | undefined;
  },
): AudioTimelineClip {
  const next: AudioTimelineClip = {
    ...clip,
    sourceRef: input.sourceRef,
    trimStartMs: input.trimStartMs,
    trimEndMs: input.trimEndMs,
  };
  if (input.sourceDurationMs === undefined) {
    delete next.sourceDurationMs;
  } else {
    next.sourceDurationMs = input.sourceDurationMs;
  }
  if (input.name !== undefined) {
    next.name = input.name;
  }
  if (input.transcriptText === null) {
    delete next.transcriptText;
  } else if (input.transcriptText !== undefined) {
    next.transcriptText = input.transcriptText;
  }
  return next;
}

function assertVolumeDbValid(value: number): void {
  const error = keyframeValueValidationError('volumeDb', value);
  if (!error) return;
  throw new EditBuilderError(error, 'volume_db_invalid');
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (Number.isInteger(value) && value >= 0) return;
  throw new EditBuilderError(
    `${field} must be a non-negative integer`,
    'non_negative_integer_required',
    { [field]: value },
  );
}

function rangeForLocations(
  timeline: Timeline,
  locations: readonly AudioClipLocation[],
): EditBuildAffectedRange | undefined {
  if (locations.length === 0) return undefined;
  return {
    startFrame: Math.min(
      ...locations.map(({ clip }) => frameForMs(timeline, clip.startMs)),
    ),
    endFrame: Math.max(
      ...locations.map(({ clip }) =>
        frameForMs(timeline, clip.startMs + clip.durationMs),
      ),
    ),
  };
}

function splitClipAtFrame(
  timeline: Timeline,
  clip: TimelineClip,
  atFrame: number,
  options: {
    idFactory: () => string;
    leftLinkGroupId?: string;
    rightLinkGroupId?: string;
  },
): SplitClipPair {
  if (clip.kind === 'caption') {
    throw new EditBuilderError(
      'Caption clip splitting uses caption-specific operations',
      'caption_split_unsupported',
      { clipId: clip.id },
    );
  }
  const rate = frameRateForTimeline(timeline);
  const startFrame = frameForMs(timeline, clip.startMs);
  const durationFrames = frameCountForMs(timeline, clip.durationMs);
  const endFrame = startFrame + durationFrames;
  if (atFrame <= startFrame || atFrame >= endFrame) {
    throw new EditBuilderError(
      'Split frame must be inside clip bounds',
      'split_out_of_bounds',
      { clipId: clip.id, atFrame, startFrame, endFrame },
    );
  }
  const splitOffsetFrames = atFrame - startFrame;
  const splitOffsetMs = durationFramesToMs(splitOffsetFrames, rate);
  const splitMs = frameToMs(atFrame, rate);
  const trimStartFrame = frameForMs(timeline, clip.trimStartMs);
  const trimEndFrame = frameForMs(timeline, clip.trimEndMs);
  const sourceBoundaryFrame = localFrameToSourceFrame(splitOffsetFrames, {
    trimStartFrame,
    trimEndFrame,
    playback: clipPlaybackFromFields(clip),
  });
  const sourceBoundaryMs = frameToMs(sourceBoundaryFrame, rate);
  const reverseBoundaryMs =
    clipPlaybackFromFields(clip)?.reverse === true
      ? Math.min(clip.trimEndMs, frameToMs(sourceBoundaryFrame + 1, rate))
      : null;
  const leftId = options.idFactory();
  const rightId = options.idFactory();
  const leftKeyframes = splitKeyframes(clip.keyframes, splitOffsetMs, 'left');
  const rightKeyframes = splitKeyframes(clip.keyframes, splitOffsetMs, 'right');
  const left = withClipFields(clip, {
    id: leftId,
    durationMs: splitOffsetMs,
    trimStartMs:
      reverseBoundaryMs === null ? clip.trimStartMs : reverseBoundaryMs,
    trimEndMs: reverseBoundaryMs === null ? sourceBoundaryMs : clip.trimEndMs,
    keyframes: leftKeyframes,
    linkGroupId: options.leftLinkGroupId,
  });
  const right = withClipFields(clip, {
    id: rightId,
    startMs: splitMs,
    durationMs: clip.durationMs - splitOffsetMs,
    trimStartMs:
      reverseBoundaryMs === null ? sourceBoundaryMs : clip.trimStartMs,
    trimEndMs: reverseBoundaryMs === null ? clip.trimEndMs : reverseBoundaryMs,
    keyframes: rightKeyframes,
    linkGroupId: options.rightLinkGroupId,
  });
  return {
    left,
    right,
    leftId,
    rightId,
    splitFrame: atFrame,
    splitMs,
    sourceBoundaryFrame,
  };
}

function splitTargetsForClip(
  timeline: Timeline,
  clip: TimelineClip,
  policy: EditLinkPolicy,
): ClipLocation[] {
  return policy === 'linked' && clip.linkGroupId
    ? locationsForLinkGroup(timeline, clip.linkGroupId)
    : [requireClipLocation(timeline, clip.id)];
}

function splitLinkGroups(
  targets: ClipLocation[],
  idFactory: () => string,
): Map<string, { left: string; right: string }> {
  const grouped = new Map<string, number>();
  for (const { clip } of targets) {
    if (!clip.linkGroupId) continue;
    grouped.set(clip.linkGroupId, (grouped.get(clip.linkGroupId) ?? 0) + 1);
  }
  const result = new Map<string, { left: string; right: string }>();
  for (const [linkGroupId, count] of grouped) {
    if (count < 2) continue;
    result.set(linkGroupId, {
      left: idFactory(),
      right: idFactory(),
    });
  }
  return result;
}

function duplicatedLinkGroups(
  timeline: Timeline,
  locations: ClipLocation[],
  idFactory: () => string,
): Map<string, string> {
  const selectedCounts = new Map<string, number>();
  for (const { clip } of locations) {
    if (!clip.linkGroupId) continue;
    selectedCounts.set(
      clip.linkGroupId,
      (selectedCounts.get(clip.linkGroupId) ?? 0) + 1,
    );
  }
  const result = new Map<string, string>();
  for (const [linkGroupId, selectedCount] of selectedCounts) {
    if (
      selectedCount > 1 &&
      selectedCount === locationsForLinkGroup(timeline, linkGroupId).length
    ) {
      result.set(linkGroupId, idFactory());
    }
  }
  return result;
}

function duplicateStartMs(
  clip: TimelineClip,
  placement: NonNullable<BuildDuplicateClipsInput['placement']>,
  rate: FrameRateLike,
  anchorStartMs: number,
  afterOriginalsMs: number,
): number {
  switch (placement.kind) {
    case 'after-originals':
      return afterOriginalsMs + (clip.startMs - anchorStartMs);
    case 'at-frame':
      return (
        frameToMs(placement.startFrame, rate) + (clip.startMs - anchorStartMs)
      );
    case 'offset-frames':
      return clip.startMs + durationFramesToMs(placement.deltaFrames, rate);
    default: {
      const exhaustive: never = placement;
      return exhaustive;
    }
  }
}

function remappedLinkGroupId(
  clip: TimelineClip,
  remap: Map<string, string>,
): string | undefined {
  return clip.linkGroupId ? remap.get(clip.linkGroupId) : undefined;
}

function deleteLocations(
  timeline: Timeline,
  clipIds: readonly string[],
  linkPolicy: EditLinkPolicy,
): ClipLocation[] {
  if (linkPolicy === 'primary-only') {
    const locations = clipIds.map((clipId) =>
      requireClipLocation(timeline, clipId),
    );
    const linked = locations.find(({ clip }) => clip.linkGroupId);
    if (linked) {
      throw new EditBuilderError(
        'Primary-only linked clip deletion is not supported yet',
        'linked_primary_only_unsupported',
        { clipId: linked.clip.id },
      );
    }
    return uniqueLocations(locations);
  }
  const locations = expandClipIds(timeline, clipIds, linkPolicy);
  const seenGroups = new Set<string>();
  return uniqueLocations(locations).filter(({ clip }) => {
    if (!clip.linkGroupId) return true;
    if (seenGroups.has(clip.linkGroupId)) return false;
    seenGroups.add(clip.linkGroupId);
    return true;
  });
}

function expandClipIds(
  timeline: Timeline,
  clipIds: readonly string[],
  policy: EditLinkPolicy,
): ClipLocation[] {
  const locations: ClipLocation[] = [];
  for (const clipId of clipIds) {
    const location = requireClipLocation(timeline, clipId);
    if (policy === 'linked' && location.clip.linkGroupId) {
      locations.push(
        ...locationsForLinkGroup(timeline, location.clip.linkGroupId),
      );
    } else {
      locations.push(location);
    }
  }
  return uniqueLocations(locations);
}

function trimTimingByFrames(
  timeline: Timeline,
  clip: TimelineClip,
  input: BuildTrimClipInput,
): ClipTimingState {
  if (input.deltaFrames === 0) {
    throw new EditBuilderError(
      'Trim delta must be a non-zero frame count',
      'trim_delta_invalid',
      { clipId: clip.id, deltaFrames: input.deltaFrames },
    );
  }
  if (input.deltaFrames < 0) {
    return extendTimingByFrames(
      timeline,
      clip,
      input.edge,
      Math.abs(input.deltaFrames),
    );
  }
  const rate = frameRateForTimeline(timeline);
  const startFrame = frameForMs(timeline, clip.startMs);
  const durationFrames = frameCountForMs(timeline, clip.durationMs);
  if (input.deltaFrames >= durationFrames) {
    throw new EditBuilderError(
      'Trim would remove the entire clip',
      'trim_too_short',
      { clipId: clip.id, deltaFrames: input.deltaFrames, durationFrames },
    );
  }
  const trimStartFrame = frameForMs(timeline, clip.trimStartMs);
  const trimEndFrame = frameForMs(timeline, clip.trimEndMs);
  const playback = clipPlaybackFromFields(clip);
  if (input.edge === 'left') {
    const sourceBoundaryFrame = localFrameToSourceFrame(input.deltaFrames, {
      trimStartFrame,
      trimEndFrame,
      playback,
    });
    const nextStartMs = frameToMs(startFrame + input.deltaFrames, rate);
    const nextDurationMs = durationFramesToMs(
      durationFrames - input.deltaFrames,
      rate,
    );
    if (playback?.reverse) {
      return {
        startMs: nextStartMs,
        durationMs: nextDurationMs,
        trimStartMs: clip.trimStartMs,
        trimEndMs: frameToMs(sourceBoundaryFrame + 1, rate),
      };
    }
    return {
      startMs: nextStartMs,
      durationMs: nextDurationMs,
      trimStartMs: frameToMs(sourceBoundaryFrame, rate),
      trimEndMs: clip.trimEndMs,
    };
  }
  const nextDurationFrames = durationFrames - input.deltaFrames;
  const sourceBoundaryFrame = localFrameToSourceFrame(nextDurationFrames, {
    trimStartFrame,
    trimEndFrame,
    playback,
  });
  if (playback?.reverse) {
    return {
      startMs: clip.startMs,
      durationMs: durationFramesToMs(nextDurationFrames, rate),
      trimStartMs: frameToMs(sourceBoundaryFrame + 1, rate),
      trimEndMs: clip.trimEndMs,
    };
  }
  return {
    startMs: clip.startMs,
    durationMs: durationFramesToMs(nextDurationFrames, rate),
    trimStartMs: clip.trimStartMs,
    trimEndMs: frameToMs(sourceBoundaryFrame, rate),
  };
}

function extendTimingByFrames(
  timeline: Timeline,
  clip: TimelineClip,
  edge: TimelineTrimEdge,
  deltaFrames: number,
): ClipTimingState {
  const rate = frameRateForTimeline(timeline);
  const startFrame = frameForMs(timeline, clip.startMs);
  const durationFrames = frameCountForMs(timeline, clip.durationMs);
  const trimStartFrame = frameForMs(timeline, clip.trimStartMs);
  const trimEndFrame = frameForMs(timeline, clip.trimEndMs);
  const sourceDurationFrames = sourceDurationFramesForClip(timeline, clip);
  const playback = clipPlaybackFromFields(clip);

  if (edge === 'left') {
    if (playback?.reverse) {
      if (trimEndFrame + deltaFrames > sourceDurationFrames) {
        throw new EditBuilderError(
          'Trim extension exceeds available source handles',
          'trim_source_bounds',
          { clipId: clip.id },
        );
      }
      return {
        startMs: frameToMs(startFrame - deltaFrames, rate),
        durationMs: durationFramesToMs(durationFrames + deltaFrames, rate),
        trimStartMs: clip.trimStartMs,
        trimEndMs: frameToMs(trimEndFrame + deltaFrames, rate),
      };
    }
    if (deltaFrames > startFrame || deltaFrames > trimStartFrame) {
      throw new EditBuilderError(
        'Trim extension exceeds available source handles',
        'trim_source_bounds',
        { clipId: clip.id },
      );
    }
    return {
      startMs: frameToMs(startFrame - deltaFrames, rate),
      durationMs: durationFramesToMs(durationFrames + deltaFrames, rate),
      trimStartMs: frameToMs(trimStartFrame - deltaFrames, rate),
      trimEndMs: clip.trimEndMs,
    };
  }

  if (playback?.reverse) {
    if (deltaFrames > trimStartFrame) {
      throw new EditBuilderError(
        'Trim extension exceeds available source handles',
        'trim_source_bounds',
        { clipId: clip.id },
      );
    }
    return {
      startMs: clip.startMs,
      durationMs: durationFramesToMs(durationFrames + deltaFrames, rate),
      trimStartMs: frameToMs(trimStartFrame - deltaFrames, rate),
      trimEndMs: clip.trimEndMs,
    };
  }
  if (trimEndFrame + deltaFrames > sourceDurationFrames) {
    throw new EditBuilderError(
      'Trim extension exceeds available source handles',
      'trim_source_bounds',
      { clipId: clip.id },
    );
  }
  return {
    startMs: clip.startMs,
    durationMs: durationFramesToMs(durationFrames + deltaFrames, rate),
    trimStartMs: clip.trimStartMs,
    trimEndMs: frameToMs(trimEndFrame + deltaFrames, rate),
  };
}

function speedTiming(
  timeline: Timeline,
  clip: TimelineClip,
  playback: ClipPlayback,
  policy: ClipPlaybackTimingPolicy,
): ClipTimingState {
  const rate = frameRateForTimeline(timeline);
  const startFrame = frameForMs(timeline, clip.startMs);
  const durationFrames = frameCountForMs(timeline, clip.durationMs);
  const trimStartFrame = frameForMs(timeline, clip.trimStartMs);
  const trimEndFrame = frameForMs(timeline, clip.trimEndMs);
  if (policy === 'preserve-source-span') {
    const sourceFrames = trimEndFrame - trimStartFrame;
    return {
      ...timingState(clip),
      durationMs: durationFramesToMs(
        effectiveDurationFrames(sourceFrames, playback),
        rate,
      ),
    };
  }
  const sourceFrames = Math.max(1, Math.round(durationFrames * playback.speed));
  if (playback.reverse) {
    const nextTrimStartFrame = trimEndFrame - sourceFrames;
    if (nextTrimStartFrame < 0) {
      throw new EditBuilderError(
        'Speed change exceeds available source handles',
        'speed_source_bounds',
        { clipId: clip.id },
      );
    }
    return {
      ...timingState(clip),
      trimStartMs: frameToMs(nextTrimStartFrame, rate),
    };
  }
  const nextTrimEndFrame = trimStartFrame + sourceFrames;
  const sourceDurationFrames = sourceDurationFramesForClip(timeline, clip);
  if (nextTrimEndFrame > sourceDurationFrames) {
    throw new EditBuilderError(
      'Speed change exceeds available source handles',
      'speed_source_bounds',
      { clipId: clip.id },
    );
  }
  return {
    ...timingState(clip),
    startMs: frameToMs(startFrame, rate),
    trimEndMs: frameToMs(nextTrimEndFrame, rate),
  };
}

function sourceDurationFramesForClip(
  timeline: Timeline,
  clip: TimelineClip,
): number {
  if (clip.kind === 'image') return Number.POSITIVE_INFINITY;
  return typeof clip.sourceDurationMs === 'number'
    ? frameForMs(timeline, clip.sourceDurationMs)
    : Number.POSITIVE_INFINITY;
}

function visualLocations(
  timeline: Timeline,
  clipIds: readonly string[],
): Array<
  ClipLocation & {
    clip: Extract<TimelineClip, { kind: 'video' | 'image' | 'overlay' }>;
  }
> {
  return clipIds.map((clipId) => {
    const location = requireClipLocation(timeline, clipId);
    if (!isVisualClip(location.clip)) {
      throw new EditBuilderError(
        'Visual transform edits require visual clips',
        'clip_kind_invalid',
        { clipId },
      );
    }
    return { track: location.track, clip: location.clip };
  });
}

function transformBuildResult(
  ops: TimelineOp[],
  locations: readonly ClipLocation[],
): EditBuildResult {
  return buildResult(ops, {
    affectedTrackIds: unique(locations.map(({ track }) => track.id)),
    changedClipIds: locations.map(({ clip }) => clip.id),
    inspectClipIds: locations.map(({ clip }) => clip.id),
  });
}

function splitKeyframes(
  keyframes: TimelineClip['keyframes'],
  atMs: number,
  side: 'left' | 'right',
): TimelineClip['keyframes'] {
  if (!keyframes) return undefined;
  const tracks = keyframes
    .map((track) => ({
      ...track,
      keys: track.keys
        .filter((key) =>
          side === 'left' ? key.atMs <= atMs : key.atMs >= atMs,
        )
        .map((key) =>
          side === 'left'
            ? key
            : { ...key, atMs: Math.max(0, key.atMs - atMs) },
        ),
    }))
    .filter((track) => track.keys.length > 0);
  return tracks.length > 0 ? tracks : undefined;
}

function pushRetainedCutRemove(
  ops: TimelineOp[],
  removedClipIds: string[],
  seenLinkGroups: Set<string>,
  clip: TimelineClip,
  magnetic: boolean | undefined,
): void {
  if (clip.linkGroupId) {
    if (seenLinkGroups.has(clip.linkGroupId)) {
      removedClipIds.push(clip.id);
      return;
    }
    seenLinkGroups.add(clip.linkGroupId);
  }
  ops.push({
    kind: 'clip.remove',
    clipId: clip.id,
    snapshot: clip,
    magnetic,
  });
  removedClipIds.push(clip.id);
}

function withClipFields(
  clip: TimelineClip,
  fields: Partial<TimelineClip> & { id?: string },
): TimelineClip {
  const next = { ...clip, ...fields } as TimelineClip;
  if (hasOwn(fields, 'linkGroupId') && fields.linkGroupId === undefined) {
    delete next.linkGroupId;
  }
  if (hasOwn(fields, 'keyframes') && fields.keyframes === undefined) {
    delete next.keyframes;
  }
  return next;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function timingState(clip: TimelineClip): ClipTimingState {
  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
  };
}

function timingEquals(left: ClipTimingState, right: ClipTimingState): boolean {
  return (
    left.startMs === right.startMs &&
    left.durationMs === right.durationMs &&
    left.trimStartMs === right.trimStartMs &&
    left.trimEndMs === right.trimEndMs
  );
}

function rangeForTiming(
  timeline: Timeline,
  timing: ClipTimingState,
): EditBuildAffectedRange {
  const startFrame = frameForMs(timeline, timing.startMs);
  return {
    startFrame,
    endFrame: startFrame + frameCountForMs(timeline, timing.durationMs),
  };
}

function frameRateForTimeline(timeline: Timeline): FrameRateLike {
  return timeline.frameRate ?? timeline.fps;
}

function frameForMs(timeline: Timeline, ms: number): number {
  return msToFrame(ms, frameRateForTimeline(timeline));
}

function frameCountForMs(timeline: Timeline, ms: number): number {
  return durationMsToFrames(ms, frameRateForTimeline(timeline));
}

function requireClipLocation(timeline: Timeline, clipId: string): ClipLocation {
  const location = findClipLocation(timeline, clipId);
  if (!location) {
    throw new EditBuilderError('Clip not found', 'clip_not_found', { clipId });
  }
  return location;
}

function findClipLocation(
  timeline: Timeline,
  clipId: string,
): ClipLocation | undefined {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

function findTrack(timeline: Timeline, trackId: string): TimelineTrack {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new EditBuilderError('Track not found', 'track_not_found', {
      trackId,
    });
  }
  return track;
}

function locationsForLinkGroup(
  timeline: Timeline,
  linkGroupId: string,
): ClipLocation[] {
  return timeline.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.linkGroupId === linkGroupId)
      .map((clip) => ({ track, clip })),
  );
}

function clipIdsMovedByLinkedOperation(
  timeline: Timeline,
  clip: TimelineClip,
): string[] {
  return clip.linkGroupId
    ? locationsForLinkGroup(timeline, clip.linkGroupId).map(
        ({ clip }) => clip.id,
      )
    : [clip.id];
}

function linkedLocationsForMetadata(
  timeline: Timeline,
  clip: TimelineClip,
  linkPolicy: EditLinkPolicy | undefined,
): ClipLocation[] {
  return linkPolicy !== 'primary-only' && clip.linkGroupId
    ? locationsForLinkGroup(timeline, clip.linkGroupId)
    : [requireClipLocation(timeline, clip.id)];
}

function assertTrackAcceptsClip(
  track: TimelineTrack,
  clip: TimelineClip,
): void {
  if (
    track.kind === 'video' ||
    track.kind === 'broll' ||
    track.kind === 'overlay'
  ) {
    if (isVisualClip(clip)) return;
    if (track.kind === 'overlay' && clip.kind === 'effect') return;
  } else if (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  ) {
    if (clip.kind === 'audio') return;
  } else if (track.kind === 'caption' && clip.kind === 'caption') {
    return;
  }
  throw new EditBuilderError(
    'Clip kind is not compatible with target track',
    'track_clip_kind_mismatch',
    { trackId: track.id, clipId: clip.id },
  );
}

function assertTrackUnlocked(track: TimelineTrack): void {
  if (!track.locked) return;
  throw new EditBuilderError('Track is locked', 'track_locked', {
    trackId: track.id,
  });
}

function isVisualClip(
  clip: TimelineClip,
): clip is Extract<TimelineClip, { kind: 'video' | 'image' | 'overlay' }> {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function isAudioTrack(track: TimelineTrack): track is AudioTimelineTrack {
  return (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  );
}

function isAudioClipLocation(
  location: ClipLocation,
): location is AudioClipLocation {
  return isAudioTrack(location.track) && location.clip.kind === 'audio';
}

function uniqueLocations(locations: readonly ClipLocation[]): ClipLocation[] {
  const seen = new Set<string>();
  const result: ClipLocation[] = [];
  for (const location of locations) {
    if (seen.has(location.clip.id)) continue;
    seen.add(location.clip.id);
    result.push(location);
  }
  return result;
}

function uniqueAudioLocations(
  locations: readonly AudioClipLocation[],
): AudioClipLocation[] {
  const seen = new Set<string>();
  const result: AudioClipLocation[] = [];
  for (const location of locations) {
    if (seen.has(location.clip.id)) continue;
    seen.add(location.clip.id);
    result.push(location);
  }
  return result;
}

function uniqueAudioTracks(
  tracks: readonly AudioTimelineTrack[],
): AudioTimelineTrack[] {
  const seen = new Set<string>();
  const result: AudioTimelineTrack[] = [];
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
  }
  return result;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function buildResult(
  ops: TimelineOp[],
  metadata: Partial<EditBuildMetadata>,
): EditBuildResult {
  return {
    ops,
    conflicts: [],
    metadata: {
      affectedTrackIds: metadata.affectedTrackIds ?? [],
      changedClipIds: metadata.changedClipIds ?? [],
      createdClipIds: metadata.createdClipIds ?? [],
      removedClipIds: metadata.removedClipIds ?? [],
      shiftedClipIds: metadata.shiftedClipIds ?? [],
      inspectClipIds: metadata.inspectClipIds ?? [],
      ...(metadata.affectedRange
        ? { affectedRange: metadata.affectedRange }
        : {}),
    },
  };
}

function normalizeRotation(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function defaultIdFactory(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function')
    return randomUUID.call(globalThis.crypto);
  throw new EditBuilderError(
    'No idFactory provided and crypto.randomUUID is unavailable',
    'id_factory_unavailable',
  );
}
