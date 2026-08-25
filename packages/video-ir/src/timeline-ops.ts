import {
  findEffectParameterTrack,
  getClipEffectParameterDefinition,
} from './clip-effects.js';
import {
  findKeyframeAt,
  findKeyframeTrack,
  keyframeTrackValidationError,
  keyframeValueValidationError,
  normalizeKeyframeTrack,
} from './keyframes.js';
import {
  isVividOverlayClip,
  parseVividOverlayParams,
} from './overlay-types.js';
import { normalizeClipPlayback } from './playback.js';
import { rippleShiftClips } from './ripple.js';
import type { RippleConflict } from './ripple.js';
import type {
  AudioClipAudioPatch,
  AudioTimelineClip,
  CaptionTimelineClip,
  ClipLinkState,
  ClipTimingState,
  ClipEffectParameter,
  ClipEffectStack,
  EffectParameterKeyframeTrack,
  Keyframe,
  KeyframeTrack,
  KeyframeableProperty,
  Timeline,
  TimelineClip,
  TimelineHistoryOperation,
  TimelineMarker,
  TimelineOp,
  TimelineTransition,
  TimelineTransitionKind,
  TimelineTrack,
  TrackUpdatePatch,
  VisualTimelineClip,
} from './timeline-types.js';

export interface TimelineOpResult {
  timeline: Timeline;
  inverse: TimelineHistoryOperation;
}

export interface OutOfSyncReport {
  linkGroupId: string;
  clipIds: string[];
  driftMs: number;
  detail: string;
}

export class TimelineOpError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TimelineOpError';
  }
}

export function applyTimelineOp(
  timeline: Timeline,
  op: TimelineOp,
): TimelineOpResult {
  switch (op.kind) {
    case 'clip.insert':
      return applyClipInsert(timeline, op);
    case 'clip.remove':
      return applyClipRemove(timeline, op);
    case 'clip.removeTimeRange':
      return applyClipRemoveTimeRange(timeline, op);
    case 'clip.link':
      return applyClipLink(timeline, op);
    case 'clip.unlink':
      return applyClipUnlink(timeline, op);
    case 'clip.setLinkGroup':
      return applyClipSetLinkGroup(timeline, op);
    case 'clip.move':
      return applyClipMove(timeline, op);
    case 'clip.trim':
      return applyClipTrim(timeline, op);
    case 'clip.extend':
      return applyClipExtend(timeline, op);
    case 'clip.split':
      return applyClipSplit(timeline, op);
    case 'clip.merge':
      return applyClipMerge(timeline, op);
    case 'clip.setTransition':
      return applyClipSetTransition(timeline, op);
    case 'clip.setAudio':
      return applyClipSetAudio(timeline, op);
    case 'clip.setAudioTransition':
      return applyClipSetAudioTransition(timeline, op);
    case 'clip.setTransform':
      return applyClipSetTransform(timeline, op);
    case 'clip.setFilters':
      return applyClipSetFilters(timeline, op);
    case 'clip.setEffects':
      return applyClipSetEffects(timeline, op);
    case 'clip.setParams':
      return applyClipSetParams(timeline, op);
    case 'clip.setPlayback':
      return applyClipSetPlayback(timeline, op);
    case 'keyframe.upsert':
      return applyKeyframeUpsert(timeline, op);
    case 'keyframe.remove':
      return applyKeyframeRemove(timeline, op);
    case 'keyframe.setTrack':
      return applyKeyframeSetTrack(timeline, op);
    case 'effectKeyframe.upsert':
      return applyEffectKeyframeUpsert(timeline, op);
    case 'effectKeyframe.remove':
      return applyEffectKeyframeRemove(timeline, op);
    case 'effectKeyframe.setTrack':
      return applyEffectKeyframeSetTrack(timeline, op);
    case 'caption.splitAtTime':
      return applyCaptionSplitAtTime(timeline, op);
    case 'caption.mergeSibling':
      return applyCaptionMergeSibling(timeline, op);
    case 'caption.regroup':
      return applyCaptionRegroup(timeline, op);
    case 'caption.setTokenText':
      return applyCaptionSetTokenText(timeline, op);
    case 'track.insert':
      return applyTrackInsert(timeline, op);
    case 'track.remove':
      return applyTrackRemove(timeline, op);
    case 'track.update':
      return applyTrackUpdate(timeline, op);
    case 'marker.upsert':
      return applyMarkerUpsert(timeline, op);
    case 'marker.remove':
      return applyMarkerRemove(timeline, op);
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

export function applyTimelineOps(
  timeline: Timeline,
  ops: readonly TimelineOp[],
): { timeline: Timeline; inverses: TimelineOp[] } {
  const result = ops.reduce(
    (state, op) => {
      const result = applyTimelineOp(state.timeline, op);
      return {
        timeline: result.timeline,
        inverses: [...flattenInverse(result.inverse), ...state.inverses],
      };
    },
    { timeline, inverses: [] as TimelineOp[] },
  );
  return {
    timeline: result.timeline,
    inverses: compactLinkedRemoveInverses(result.inverses),
  };
}

function compactLinkedRemoveInverses(inverses: TimelineOp[]): TimelineOp[] {
  const removedGroups = new Set<string>();
  return inverses.filter((op) => {
    if (op.kind !== 'clip.remove') return true;
    const linkGroupId = op.snapshot?.linkGroupId;
    if (!linkGroupId) return true;
    if (removedGroups.has(linkGroupId)) return false;
    removedGroups.add(linkGroupId);
    return true;
  });
}

function finalizeTransitionSeamInvariants(
  before: Timeline,
  next: Timeline,
  inverse: TimelineHistoryOperation,
  expectedTransitionTargets = new Map<string, string>(),
): TimelineOpResult {
  const repaired = repairTransitionSeamInvariants(
    before,
    next,
    expectedTransitionTargets,
  );
  const restoreOps = transitionRestorationOps(before, next, repaired);
  return {
    timeline: repaired,
    inverse:
      restoreOps.length > 0
        ? {
            kind: 'timeline.batch',
            ops: [...flattenInverse(inverse), ...restoreOps],
          }
        : inverse,
  };
}

function replacePrimaryInverse(
  inverse: TimelineHistoryOperation,
  replacement: TimelineOp,
): TimelineHistoryOperation {
  if (inverse.kind !== 'timeline.batch') return replacement;
  return {
    kind: 'timeline.batch',
    ops: [replacement, ...inverse.ops.slice(1)],
  };
}

export function collectTimelineOpConflicts(
  timeline: Timeline,
  ops: readonly TimelineOp[],
): RippleConflict[] {
  let cursor = timeline;
  const conflicts: RippleConflict[] = [];
  for (const op of ops) {
    const opConflicts = detectTimelineOpConflicts(cursor, op);
    conflicts.push(...opConflicts);
    if (opConflicts.length > 0) break;
    cursor = applyTimelineOp(cursor, op).timeline;
  }
  return conflicts;
}

export function findOutOfSyncGroups(timeline: Timeline): OutOfSyncReport[] {
  const groups = new Map<string, TimelineClip[]>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.linkGroupId) continue;
      groups.set(clip.linkGroupId, [
        ...(groups.get(clip.linkGroupId) ?? []),
        clip,
      ]);
    }
  }

  const reports: OutOfSyncReport[] = [];
  for (const [linkGroupId, clips] of groups) {
    if (clips.length < 2) continue;
    const anchor = clips[0]!;
    const driftMs = Math.max(
      ...clips.map((clip) =>
        Math.max(
          Math.abs(clip.startMs - anchor.startMs),
          Math.abs(clip.durationMs - anchor.durationMs),
          Math.abs(clip.trimStartMs - anchor.trimStartMs),
          Math.abs(clip.trimEndMs - anchor.trimEndMs),
        ),
      ),
    );
    if (driftMs <= 0) continue;
    reports.push({
      linkGroupId,
      clipIds: clips.map((clip) => clip.id),
      driftMs,
      detail: `Linked clips in ${linkGroupId} differ by up to ${driftMs}ms`,
    });
  }
  return reports;
}

function applyClipInsert(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.insert' }>,
): TimelineOpResult {
  const track = findTrack(timeline, op.trackId);
  assertClipKindFitsTrack(track, op.clip);
  if (findClipLocation(timeline, op.clip.id)) {
    throw new TimelineOpError(
      `Clip already exists: ${op.clip.id}`,
      'clip_exists',
    );
  }
  const clip = { ...op.clip, startMs: op.at };
  const tracks = timeline.tracks.map((item) =>
    item.id === op.trackId
      ? trackWithClips(item, [
          ...sortClipsByStart(
            op.magnetic && isPrimaryRippleTrack(item)
              ? [
                  ...rippleShiftClips(item.clips, {
                    fromMs: op.at,
                    deltaMs: clip.durationMs,
                  }),
                  clip,
                ]
              : [...item.clips, clip],
          ),
        ])
      : item,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'clip.remove',
      clipId: op.clip.id,
      snapshot: clip,
      magnetic: op.magnetic,
    },
  };
}

function applyClipRemove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.remove' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  if (location.clip.linkGroupId) {
    return applyLinkedClipRemove(timeline, op, location.clip.linkGroupId);
  }
  const clip = location.clip;
  const clipEndMs = endMs(clip);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          op.magnetic && isPrimaryRippleTrack(track)
            ? rippleShiftClips(
                track.clips.filter((item) => item.id !== op.clipId),
                {
                  fromMs: clipEndMs,
                  deltaMs: -clip.durationMs,
                },
              )
            : track.clips.filter((item) => item.id !== op.clipId),
        )
      : track,
  );
  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.insert',
      trackId: location.track.id,
      clip: op.snapshot ?? clip,
      at: clip.startMs,
      magnetic: op.magnetic,
    },
  );
}

function applyLinkedClipRemove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.remove' }>,
  linkGroupId: string,
): TimelineOpResult {
  const groupLocations = clipLocationsForLinkGroup(timeline, linkGroupId);
  const removeIds = new Set(groupLocations.map(({ clip }) => clip.id));
  const tracks = timeline.tracks.map((track) => {
    const removedFromTrack = track.clips.filter((clip) =>
      removeIds.has(clip.id),
    );
    let nextClips: TimelineClip[] = track.clips.filter(
      (clip) => !removeIds.has(clip.id),
    );
    if (op.magnetic && isPrimaryRippleTrack(track)) {
      for (const clip of removedFromTrack.sort(
        (left, right) => right.startMs - left.startMs,
      )) {
        nextClips = rippleShiftClips(nextClips, {
          fromMs: endMs(clip),
          deltaMs: -clip.durationMs,
        });
      }
    }
    return trackWithClips(track, nextClips);
  });

  const insertOps: TimelineOp[] = groupLocations
    .map(({ track, clip }) => ({
      kind: 'clip.insert' as const,
      trackId: track.id,
      clip: op.clipId === clip.id && op.snapshot ? op.snapshot : clip,
      at: clip.startMs,
      magnetic: op.magnetic,
    }))
    .sort((left, right) => left.at - right.at);

  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    { kind: 'timeline.batch', ops: insertOps },
  );
}

function applyClipRemoveTimeRange(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.removeTimeRange' }>,
): TimelineOpResult {
  assertRangeValid(op.startMs, op.endMs);
  const track = op.trackId
    ? findTrack(timeline, op.trackId)
    : findPrimaryRippleTrack(timeline);
  const replacement =
    op.before && op.after
      ? { before: op.before, after: op.after }
      : buildTimeRangeReplacement(
          track,
          op.startMs,
          op.endMs,
          Boolean(op.magnetic),
        );
  for (const clip of replacement.after) {
    assertClipKindFitsTrack(track, clip);
    assertTimingStateValid(timingState(clip));
  }
  const tracks = timeline.tracks.map((item) =>
    item.id === track.id
      ? trackWithClips(
          item,
          replaceClips(item.clips, replacement.before, replacement.after),
        )
      : item,
  );
  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.removeTimeRange',
      trackId: track.id,
      startMs: op.startMs,
      endMs: op.endMs,
      magnetic: op.magnetic,
      before: replacement.after,
      after: replacement.before,
    },
  );
}

function applyClipLink(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.link' }>,
): TimelineOpResult {
  const uniqueClipIds = [...new Set(op.clipIds)];
  if (uniqueClipIds.length < 2) {
    throw new TimelineOpError(
      'Link groups require at least two clips',
      'clip_link_invalid',
    );
  }
  const before = uniqueClipIds.map((clipId) => {
    const { clip } = requireClipLocation(timeline, clipId);
    return { clipId, linkGroupId: clip.linkGroupId };
  });
  const tracks = timeline.tracks.map((track) =>
    trackWithClips(
      track,
      track.clips.map((clip) =>
        uniqueClipIds.includes(clip.id)
          ? { ...clip, linkGroupId: op.linkGroupId }
          : clip,
      ),
    ),
  );

  return {
    timeline: { ...timeline, tracks },
    inverse: inverseForLinkState(before),
  };
}

function applyClipUnlink(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.unlink' }>,
): TimelineOpResult {
  const before =
    op.before ??
    timeline.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => clip.linkGroupId === op.linkGroupId)
        .map((clip) => ({ clipId: clip.id, linkGroupId: op.linkGroupId })),
    );
  if (before.length === 0) {
    throw new TimelineOpError(
      `Link group not found: ${op.linkGroupId}`,
      'clip_link_missing',
    );
  }
  const unlinkIds = new Set(before.map((item) => item.clipId));
  const tracks = timeline.tracks.map((track) =>
    trackWithClips(
      track,
      track.clips.map((clip) =>
        unlinkIds.has(clip.id) ? clearClipLinkGroup(clip) : clip,
      ),
    ),
  );

  return {
    timeline: { ...timeline, tracks },
    inverse: {
      kind: 'clip.setLinkGroup',
      assignments: before.map((item) => ({
        clipId: item.clipId,
        linkGroupId: item.linkGroupId,
      })),
    },
  };
}

function setClipLinkGroup(
  clip: TimelineClip,
  linkGroupId: string | undefined,
): TimelineClip {
  return linkGroupId === undefined
    ? clearClipLinkGroup(clip)
    : { ...clip, linkGroupId };
}

function applyClipSetLinkGroup(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setLinkGroup' }>,
): TimelineOpResult {
  if (op.assignments.length === 0) {
    throw new TimelineOpError(
      'clip.setLinkGroup requires at least one assignment',
      'clip_link_invalid',
    );
  }
  const target = new Map(
    op.assignments.map((item) => [item.clipId, item.linkGroupId]),
  );
  const before: ClipLinkState[] = op.assignments.map((item) => {
    const { clip } = requireClipLocation(timeline, item.clipId);
    return { clipId: item.clipId, linkGroupId: clip.linkGroupId };
  });
  const tracks = timeline.tracks.map((track) =>
    trackWithClips(
      track,
      track.clips.map((clip) =>
        target.has(clip.id)
          ? setClipLinkGroup(clip, target.get(clip.id))
          : clip,
      ),
    ),
  );
  return {
    timeline: { ...timeline, tracks },
    inverse: {
      kind: 'clip.setLinkGroup',
      assignments: before,
    },
  };
}

function applyClipMove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.move' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  const targetTrack = findTrack(timeline, op.to.trackId);
  assertClipKindFitsTrack(targetTrack, location.clip);
  if (location.clip.linkGroupId) {
    return applyLinkedClipMove(timeline, op, location, targetTrack);
  }
  const movedClip = { ...location.clip, startMs: op.to.startMs };
  const oldEndMs = endMs(location.clip);
  const tracks = timeline.tracks.map((track) => {
    if (track.id === location.track.id && track.id === targetTrack.id) {
      if (!(op.magnetic && isPrimaryRippleTrack(track))) {
        return trackWithClips(
          track,
          track.clips.map((clip) => (clip.id === op.clipId ? movedClip : clip)),
        );
      }
      let nextClips: TimelineClip[] = track.clips.filter(
        (clip) => clip.id !== op.clipId,
      );
      nextClips = rippleShiftClips(nextClips, {
        fromMs: oldEndMs,
        deltaMs: -location.clip.durationMs,
      });
      nextClips = rippleShiftClips(nextClips, {
        fromMs: op.to.startMs,
        deltaMs: location.clip.durationMs,
      });
      return trackWithClips(track, sortClipsByStart([...nextClips, movedClip]));
    }
    if (track.id === location.track.id) {
      const nextClips =
        op.magnetic && isPrimaryRippleTrack(track)
          ? rippleShiftClips(
              track.clips.filter((clip) => clip.id !== op.clipId),
              {
                fromMs: oldEndMs,
                deltaMs: -location.clip.durationMs,
              },
            )
          : track.clips.filter((clip) => clip.id !== op.clipId);
      return trackWithClips(track, nextClips);
    }
    if (track.id === targetTrack.id) {
      const nextClips =
        op.magnetic && isPrimaryRippleTrack(track)
          ? rippleShiftClips(track.clips, {
              fromMs: op.to.startMs,
              deltaMs: location.clip.durationMs,
            })
          : track.clips;
      return trackWithClips(
        track,
        op.magnetic && isPrimaryRippleTrack(track)
          ? sortClipsByStart([...nextClips, movedClip])
          : [...nextClips, movedClip],
      );
    }
    return track;
  });
  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.move',
      clipId: op.clipId,
      from: { trackId: targetTrack.id, startMs: op.to.startMs },
      to: { trackId: location.track.id, startMs: location.clip.startMs },
      magnetic: op.magnetic,
    },
  );
}

function applyLinkedClipMove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.move' }>,
  location: { track: TimelineTrack; clip: TimelineClip },
  targetTrack: TimelineTrack,
): TimelineOpResult {
  const linkGroupId = location.clip.linkGroupId;
  if (!linkGroupId) {
    throw new TimelineOpError('Clip is not linked', 'clip_link_missing');
  }
  const deltaMs = op.to.startMs - location.clip.startMs;
  const groupClipIds = new Set(
    clipLocationsForLinkGroup(timeline, linkGroupId).map(({ clip }) => clip.id),
  );
  const movedTarget = { ...location.clip, startMs: op.to.startMs };
  const tracks = timeline.tracks.map((track) => {
    let clips = track.clips
      .filter(
        (clip) =>
          !(clip.id === op.clipId && location.track.id !== targetTrack.id),
      )
      .map((clip) => {
        if (!groupClipIds.has(clip.id)) return clip;
        if (clip.id === op.clipId) return movedTarget;
        return { ...clip, startMs: clip.startMs + deltaMs };
      });
    if (track.id === targetTrack.id && location.track.id !== targetTrack.id) {
      clips = [...clips, movedTarget];
    }
    for (const clip of clips) {
      assertTimingStateValid(timingState(clip));
    }
    return trackWithClips(track, sortClipsByStart(clips));
  });

  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.move',
      clipId: op.clipId,
      from: { trackId: targetTrack.id, startMs: op.to.startMs },
      to: { trackId: location.track.id, startMs: location.clip.startMs },
      magnetic: op.magnetic,
    },
  );
}

function applyClipTrim(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.trim' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  assertTimingStateValid(op.to);
  const from = timingState(location.clip);
  if (location.clip.linkGroupId) {
    return applyLinkedClipTrim(timeline, op, location, from);
  }
  const deltaMs = endTimingMs(op.to) - endTimingMs(from);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          op.magnetic && isPrimaryRippleTrack(track)
            ? rippleShiftClips(
                track.clips.map((clip) =>
                  clip.id === op.clipId ? applyTimingState(clip, op.to) : clip,
                ),
                {
                  fromMs: endTimingMs(from),
                  deltaMs,
                  excludeClipIds: new Set([op.clipId]),
                },
              )
            : track.clips.map((clip) =>
                clip.id === op.clipId ? applyTimingState(clip, op.to) : clip,
              ),
        )
      : track,
  );
  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.trim',
      clipId: op.clipId,
      from: op.to,
      to: from,
      magnetic: op.magnetic,
    },
  );
}

function applyLinkedClipTrim(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.trim' }>,
  location: { track: TimelineTrack; clip: TimelineClip },
  from: ClipTimingState,
): TimelineOpResult {
  const linkGroupId = location.clip.linkGroupId;
  if (!linkGroupId) {
    throw new TimelineOpError('Clip is not linked', 'clip_link_missing');
  }
  const delta = {
    startMs: op.to.startMs - from.startMs,
    durationMs: op.to.durationMs - from.durationMs,
    trimStartMs: op.to.trimStartMs - from.trimStartMs,
    trimEndMs: op.to.trimEndMs - from.trimEndMs,
  };
  const groupClipIds = new Set(
    clipLocationsForLinkGroup(timeline, linkGroupId).map(({ clip }) => clip.id),
  );
  const tracks = timeline.tracks.map((track) =>
    trackWithClips(
      track,
      track.clips.map((clip) => {
        if (!groupClipIds.has(clip.id)) return clip;
        const nextTiming: ClipTimingState =
          clip.id === op.clipId
            ? op.to
            : {
                startMs: clip.startMs + delta.startMs,
                durationMs: clip.durationMs + delta.durationMs,
                trimStartMs: clip.trimStartMs + delta.trimStartMs,
                trimEndMs: clip.trimEndMs + delta.trimEndMs,
              };
        assertTimingStateValid(nextTiming);
        return applyTimingState(clip, nextTiming);
      }),
    ),
  );

  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.trim',
      clipId: op.clipId,
      from: op.to,
      to: from,
      magnetic: op.magnetic,
    },
  );
}

function applyClipExtend(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.extend' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  const from = timingState(location.clip);
  const to: ClipTimingState = {
    ...from,
    durationMs: from.durationMs + op.deltaMs,
    trimEndMs: from.trimEndMs + op.deltaMs,
  };
  if (
    location.clip.kind !== 'image' &&
    typeof location.clip.sourceDurationMs === 'number' &&
    to.trimEndMs > location.clip.sourceDurationMs
  ) {
    throw new TimelineOpError(
      'Clip extension exceeds source duration',
      'clip_timing_invalid',
    );
  }
  assertTimingStateValid(to);
  const result = applyClipTrim(timeline, {
    kind: 'clip.trim',
    clipId: op.clipId,
    from,
    to,
    magnetic: op.magnetic,
  });
  const inverse: TimelineOp = {
    kind: 'clip.extend',
    clipId: op.clipId,
    deltaMs: -op.deltaMs,
    magnetic: op.magnetic,
  };
  return {
    timeline: result.timeline,
    inverse: replacePrimaryInverse(result.inverse, inverse),
  };
}

function applyClipSplit(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.split' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  assertClipKindFitsTrack(location.track, op.after[0]);
  assertClipKindFitsTrack(location.track, op.after[1]);
  const split = transitionAwareSplitClips(timeline, location, op.after);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.flatMap((clip) =>
            clip.id === op.clipId ? [...split.after] : [clip],
          ),
        )
      : track,
  );
  return finalizeTransitionSeamInvariants(
    timeline,
    withDuration({ ...timeline, tracks }),
    {
      kind: 'clip.merge',
      removeClipIds: [split.after[0].id, split.after[1].id],
      clip: op.before,
    },
    split.expectedTransitionTargets,
  );
}

function applyClipMerge(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.merge' }>,
): TimelineOpResult {
  const [leftClipId, rightClipId] = op.removeClipIds;
  if (leftClipId === rightClipId) {
    throw new TimelineOpError(
      'Merged clips must be distinct',
      'clip_merge_invalid',
    );
  }
  const left = requireClipLocation(timeline, leftClipId);
  const right = requireClipLocation(timeline, rightClipId);
  if (left.track.id !== right.track.id) {
    throw new TimelineOpError(
      'Merged clips must share a track',
      'clip_track_mismatch',
    );
  }
  if (left.clip.startMs >= right.clip.startMs) {
    throw new TimelineOpError(
      'Merged clips must be ordered left → right by startMs',
      'clip_merge_invalid',
    );
  }
  assertClipKindFitsTrack(left.track, op.clip);
  const tracks = timeline.tracks.map((track) =>
    track.id === left.track.id
      ? trackWithClips(
          track,
          track.clips.flatMap((clip) => {
            if (clip.id === leftClipId) return [op.clip];
            if (clip.id === rightClipId) return [];
            return [clip];
          }),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'clip.split',
      clipId: op.clip.id,
      at: right.clip.startMs,
      before: op.clip,
      after: [left.clip, right.clip],
    },
  };
}

function applyClipSetTransition(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setTransition' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => ({
    clip:
      op.after === null
        ? omitKey(clip, 'transitionToNext')
        : { ...clip, transitionToNext: op.after },
    inverse: {
      kind: 'clip.setTransition',
      clipId: op.clipId,
      before: op.after,
      after: clip.transitionToNext ?? op.before ?? null,
    },
  }));
}

function applyClipSetAudio(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setAudio' }>,
): TimelineOpResult {
  return applyAudioClipPatch(timeline, op.clipId, (clip) => {
    const changedKeys = audioClipAudioPatchKeys(op.after);
    return {
      clip: applyAudioClipAudioPatch(clip, op.after),
      inverse: {
        kind: 'clip.setAudio',
        clipId: op.clipId,
        before: op.after,
        after: audioClipAudioPatchFromClip(clip, changedKeys),
      },
    };
  });
}

function applyClipSetAudioTransition(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setAudioTransition' }>,
): TimelineOpResult {
  return applyAudioClipPatch(timeline, op.clipId, (clip) => ({
    clip:
      op.after === null
        ? omitKey(clip, 'audioTransitionToNext')
        : { ...clip, audioTransitionToNext: op.after },
    inverse: {
      kind: 'clip.setAudioTransition',
      clipId: op.clipId,
      before: op.after,
      after: clip.audioTransitionToNext ?? null,
    },
  }));
}

function applyClipSetTransform(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setTransform' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => ({
    clip:
      op.after === null
        ? omitKey(clip, 'transforms')
        : { ...clip, transforms: op.after },
    inverse: {
      kind: 'clip.setTransform',
      clipId: op.clipId,
      before: op.after,
      after: clip.transforms ?? op.before ?? null,
    },
  }));
}

function applyClipSetFilters(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setFilters' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => ({
    clip:
      op.after === null
        ? omitKey(clip, 'filters')
        : { ...clip, filters: op.after },
    inverse: {
      kind: 'clip.setFilters',
      clipId: op.clipId,
      before: op.after,
      after: clip.filters ?? op.before ?? null,
    },
  }));
}

function applyClipSetEffects(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setEffects' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => ({
    clip:
      op.after === null
        ? omitKey(clip, 'effects')
        : { ...clip, effects: op.after },
    inverse: {
      kind: 'clip.setEffects',
      clipId: op.clipId,
      before: op.after,
      after: clip.effects ?? op.before ?? null,
    },
  }));
}

function applyClipSetParams(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setParams' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  if (isVividOverlayClip(location.clip)) {
    if (op.after === null || parseVividOverlayParams(op.after) === null) {
      throw new TimelineOpError(
        `Invalid vivid overlay params for clip: ${op.clipId}`,
        'invalid_params',
      );
    }
  }
  const current = location.clip.params ?? null;
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.map((clip) => {
            if (clip.id !== op.clipId) return clip;
            return op.after === null
              ? clipWithoutParams(clip)
              : { ...clip, params: op.after };
          }),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'clip.setParams',
      clipId: op.clipId,
      before: op.after,
      after: current ?? op.before ?? null,
    },
  };
}

function clipWithoutParams(clip: TimelineClip): TimelineClip {
  switch (clip.kind) {
    case 'video':
    case 'image':
    case 'overlay':
    case 'audio':
    case 'caption':
    case 'effect': {
      const { params: _params, ...nextClip } = clip;
      return nextClip;
    }
    default: {
      const exhaustive: never = clip;
      return exhaustive;
    }
  }
}

function applyClipSetPlayback(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'clip.setPlayback' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  const after =
    op.after === null ? null : normalizeClipPlayback(op.after, undefined);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.map((clip) => {
            if (clip.id !== op.clipId) return clip;
            return after === null
              ? clipWithoutPlayback(clip)
              : { ...clip, playback: after };
          }),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'clip.setPlayback',
      clipId: op.clipId,
      before: after,
      after: location.clip.playback ?? op.before ?? null,
      timingPolicy: op.timingPolicy,
    },
  };
}

function clipWithoutPlayback(clip: TimelineClip): TimelineClip {
  switch (clip.kind) {
    case 'video':
    case 'image':
    case 'overlay': {
      const { playback: _playback, ...nextClip } = clip;
      return nextClip;
    }
    case 'audio': {
      const { playback: _playback, ...nextClip } = clip;
      return nextClip;
    }
    case 'caption': {
      const { playback: _playback, ...nextClip } = clip;
      return nextClip;
    }
    case 'effect': {
      const { playback: _playback, ...nextClip } = clip;
      return nextClip;
    }
    default: {
      const exhaustive: never = clip;
      return exhaustive;
    }
  }
}

function applyKeyframeUpsert(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'keyframe.upsert' }>,
): TimelineOpResult {
  return applyClipPatch(timeline, op.clipId, (clip) => {
    assertKeyframeFitsClip(clip, op.key);
    assertKeyframeValueValid(op.property, op.key.value);
    // The live timeline is authoritative for the inverse; a caller-supplied
    // `op.before` must NOT override it (a stale value would resurrect a phantom
    // key on undo when this is actually a fresh insert).
    const before =
      findKeyframeAt(
        findKeyframeTrack(clip.keyframes, op.property),
        op.key.atMs,
      ) ?? null;
    const track = upsertKeyframe(clip.keyframes, op.property, op.key);
    return {
      clip: withKeyframeTrack(clip, op.property, track),
      inverse:
        before === null
          ? {
              kind: 'keyframe.remove',
              clipId: op.clipId,
              property: op.property,
              atMs: op.key.atMs,
              snapshot: op.key,
            }
          : {
              kind: 'keyframe.upsert',
              clipId: op.clipId,
              property: op.property,
              key: before,
              before: op.key,
            },
    };
  });
}

function applyKeyframeRemove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'keyframe.remove' }>,
): TimelineOpResult {
  return applyClipPatch(timeline, op.clipId, (clip) => {
    assertKeyframeLocalMsFitsClip(clip, op.atMs);
    assertKeyframeFitsClip(clip, op.snapshot);
    assertKeyframeValueValid(op.property, op.snapshot.value);
    const track = findKeyframeTrack(clip.keyframes, op.property);
    const snapshot = findKeyframeAt(track, op.atMs);
    if (!track || !snapshot) {
      throw new TimelineOpError(
        `Keyframe not found at ${op.atMs}ms on ${op.property}`,
        'keyframe_missing',
      );
    }
    const nextTrack = removeKeyframe(clip.keyframes, op.property, op.atMs);
    return {
      clip: withKeyframeTrack(clip, op.property, nextTrack),
      inverse: {
        kind: 'keyframe.upsert',
        clipId: op.clipId,
        property: op.property,
        key: snapshot,
        before: null,
      },
    };
  });
}

function applyKeyframeSetTrack(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'keyframe.setTrack' }>,
): TimelineOpResult {
  return applyClipPatch(timeline, op.clipId, (clip) => {
    // Live timeline is authoritative; ignore a possibly-stale `op.before`.
    const before = findKeyframeTrack(clip.keyframes, op.property) ?? null;
    if (op.after) {
      assertKeyframeTrackProperty(op.after, op.property);
      assertKeyframeTrackFitsClip(clip, op.after);
    }
    const nextTrack = op.after ? normalizeKeyframeTrack(op.after) : null;
    return {
      clip: withKeyframeTrack(clip, op.property, nextTrack),
      inverse: {
        kind: 'keyframe.setTrack',
        clipId: op.clipId,
        property: op.property,
        before: op.after,
        after: before,
      },
    };
  });
}

function applyEffectKeyframeUpsert(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'effectKeyframe.upsert' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => {
    const stack = requireEffectStack(clip, op.effectId, op.parameter);
    assertKeyframeFitsClip(clip, op.key);
    assertEffectKeyframeValueValid(stack, op.effectId, op.parameter, op.key);
    const track = findEffectParameterTrack(stack, op.effectId, op.parameter);
    const before = track?.keys.find((key) => key.atMs === op.key.atMs) ?? null;
    const keys = [
      ...(track?.keys.filter((key) => key.atMs !== op.key.atMs) ?? []),
      op.key,
    ].sort((left, right) => left.atMs - right.atMs);
    return {
      clip: withEffectParameterTrack(
        clip,
        {
          effectId: op.effectId,
          parameter: op.parameter,
          keys,
        },
        op.effectId,
        op.parameter,
      ),
      inverse:
        before === null
          ? {
              kind: 'effectKeyframe.remove',
              clipId: op.clipId,
              effectId: op.effectId,
              parameter: op.parameter,
              atMs: op.key.atMs,
              snapshot: op.key,
            }
          : {
              kind: 'effectKeyframe.upsert',
              clipId: op.clipId,
              effectId: op.effectId,
              parameter: op.parameter,
              key: before,
              before: op.key,
            },
    };
  });
}

function applyEffectKeyframeRemove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'effectKeyframe.remove' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => {
    const stack = requireEffectStack(clip, op.effectId, op.parameter);
    assertKeyframeLocalMsFitsClip(clip, op.atMs);
    const track = findEffectParameterTrack(stack, op.effectId, op.parameter);
    const snapshot = track?.keys.find((key) => key.atMs === op.atMs);
    if (!track || !snapshot) {
      throw new TimelineOpError(
        `Effect keyframe not found at ${op.atMs}ms`,
        'effect_keyframe_missing',
      );
    }
    const nextKeys = track.keys.filter((key) => key.atMs !== op.atMs);
    return {
      clip: withEffectParameterTrack(
        clip,
        nextKeys.length > 0 ? { ...track, keys: nextKeys } : null,
        op.effectId,
        op.parameter,
      ),
      inverse: {
        kind: 'effectKeyframe.upsert',
        clipId: op.clipId,
        effectId: op.effectId,
        parameter: op.parameter,
        key: snapshot,
        before: null,
      },
    };
  });
}

function applyEffectKeyframeSetTrack(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'effectKeyframe.setTrack' }>,
): TimelineOpResult {
  return applyVisualClipPatch(timeline, op.clipId, (clip) => {
    const stack = requireEffectStack(clip, op.effectId, op.parameter);
    const before = findEffectParameterTrack(stack, op.effectId, op.parameter);
    if (op.after) {
      for (const key of op.after.keys) {
        assertKeyframeFitsClip(clip, key);
        assertEffectKeyframeValueValid(stack, op.effectId, op.parameter, key);
      }
    }
    return {
      clip: withEffectParameterTrack(
        clip,
        op.after
          ? {
              ...op.after,
              keys: [...op.after.keys].sort((a, b) => a.atMs - b.atMs),
            }
          : null,
        op.effectId,
        op.parameter,
      ),
      inverse: {
        kind: 'effectKeyframe.setTrack',
        clipId: op.clipId,
        effectId: op.effectId,
        parameter: op.parameter,
        before: op.after,
        after: before,
      },
    };
  });
}

function applyCaptionSplitAtTime(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'caption.splitAtTime' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  if (!isCaptionClip(location.clip)) {
    throw new TimelineOpError(
      `Clip is not caption: ${op.clipId}`,
      'clip_kind_mismatch',
    );
  }
  assertCaptionClipFitsTrack(location.track, op.after[0]);
  assertCaptionClipFitsTrack(location.track, op.after[1]);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.flatMap((clip) =>
            clip.id === op.clipId ? [...op.after] : [clip],
          ),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'caption.mergeSibling',
      removeClipIds: [op.after[0].id, op.after[1].id],
      clip: op.before,
    },
  };
}

function applyCaptionMergeSibling(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'caption.mergeSibling' }>,
): TimelineOpResult {
  const [leftClipId, rightClipId] = op.removeClipIds;
  if (leftClipId === rightClipId) {
    throw new TimelineOpError(
      'Merged caption clips must be distinct',
      'clip_merge_invalid',
    );
  }
  const left = requireClipLocation(timeline, leftClipId);
  const right = requireClipLocation(timeline, rightClipId);
  if (!isCaptionClip(left.clip) || !isCaptionClip(right.clip)) {
    throw new TimelineOpError(
      'Merged clips must be captions',
      'clip_kind_mismatch',
    );
  }
  if (left.track.id !== right.track.id) {
    throw new TimelineOpError(
      'Merged caption clips must share a track',
      'clip_track_mismatch',
    );
  }
  if (left.clip.startMs >= right.clip.startMs) {
    throw new TimelineOpError(
      'Merged caption clips must be ordered left → right by startMs',
      'clip_merge_invalid',
    );
  }
  assertCaptionClipFitsTrack(left.track, op.clip);
  const tracks = timeline.tracks.map((track) =>
    track.id === left.track.id
      ? trackWithClips(
          track,
          track.clips.flatMap((clip) => {
            if (clip.id === leftClipId) return [op.clip];
            if (clip.id === rightClipId) return [];
            return [clip];
          }),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'caption.splitAtTime',
      clipId: op.clip.id,
      at: right.clip.startMs,
      before: op.clip,
      after: [left.clip, right.clip],
    },
  };
}

function applyCaptionRegroup(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'caption.regroup' }>,
): TimelineOpResult {
  const track = findTrack(timeline, op.trackId);
  if (track.kind !== 'caption') {
    throw new TimelineOpError(
      `Track is not caption: ${op.trackId}`,
      'track_kind_mismatch',
    );
  }
  for (const clip of op.after) {
    assertCaptionClipFitsTrack(track, clip);
  }
  const tracks = timeline.tracks.map((item) =>
    item.id === track.id ? { ...track, clips: [...op.after] } : item,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'caption.regroup',
      trackId: track.id,
      before: op.after,
      after: op.before,
    },
  };
}

function applyCaptionSetTokenText(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'caption.setTokenText' }>,
): TimelineOpResult {
  const location = requireClipLocation(timeline, op.clipId);
  if (!isCaptionClip(location.clip)) {
    throw new TimelineOpError(
      `Clip is not caption: ${op.clipId}`,
      'clip_kind_mismatch',
    );
  }
  const tokens = location.clip.tokens ?? [];
  const token = tokens.find((item) => item.id === op.tokenId);
  if (!token) {
    throw new TimelineOpError(
      `Caption token not found: ${op.tokenId}`,
      'caption_token_missing',
    );
  }
  const nextTokens = tokens.map((item) =>
    item.id === op.tokenId ? { ...item, text: op.after } : item,
  );
  const nextClip: CaptionTimelineClip = {
    ...location.clip,
    tokens: nextTokens,
    text: captionTextFromTokens(nextTokens),
  };
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.map((clip) => (clip.id === op.clipId ? nextClip : clip)),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'caption.setTokenText',
      clipId: op.clipId,
      tokenId: op.tokenId,
      before: op.after,
      after: token.text,
    },
  };
}

function applyTrackInsert(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'track.insert' }>,
): TimelineOpResult {
  if (timeline.tracks.some((track) => track.id === op.track.id)) {
    throw new TimelineOpError(
      `Track already exists: ${op.track.id}`,
      'track_exists',
    );
  }
  const index = Math.max(0, Math.min(op.index, timeline.tracks.length));
  const tracks = [
    ...timeline.tracks.slice(0, index),
    op.track,
    ...timeline.tracks.slice(index),
  ];
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'track.remove',
      trackId: op.track.id,
      snapshot: op.track,
      index,
    },
  };
}

function applyTrackRemove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'track.remove' }>,
): TimelineOpResult {
  const index = timeline.tracks.findIndex((track) => track.id === op.trackId);
  if (index < 0) {
    throw new TimelineOpError(
      `Track not found: ${op.trackId}`,
      'track_missing',
    );
  }
  const [track] = timeline.tracks.slice(index, index + 1);
  if (!track) {
    throw new TimelineOpError(
      `Track not found: ${op.trackId}`,
      'track_missing',
    );
  }
  const tracks = timeline.tracks.filter((item) => item.id !== op.trackId);
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'track.insert',
      track: op.snapshot ?? track,
      index: op.index ?? index,
    },
  };
}

function applyTrackUpdate(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'track.update' }>,
): TimelineOpResult {
  const current = findTrack(timeline, op.trackId);
  const changedKeys = trackUpdatePatchKeys(op.after);
  const tracks = timeline.tracks.map((track) =>
    track.id === op.trackId ? applyTrackUpdatePatch(track, op.after) : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: {
      kind: 'track.update',
      trackId: op.trackId,
      before: op.after,
      after: trackUpdatePatchFromTrack(current, changedKeys),
    },
  };
}

function applyMarkerUpsert(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'marker.upsert' }>,
): TimelineOpResult {
  const markers = timeline.markers ?? [];
  const before = markers.find((marker) => marker.id === op.marker.id) ?? null;
  const nextMarkers = before
    ? markers.map((marker) => (marker.id === op.marker.id ? op.marker : marker))
    : [...markers, op.marker];
  return {
    timeline: { ...timeline, markers: nextMarkers },
    inverse:
      before === null
        ? { kind: 'marker.remove', markerId: op.marker.id, snapshot: op.marker }
        : { kind: 'marker.upsert', marker: before, before: op.marker },
  };
}

function applyMarkerRemove(
  timeline: Timeline,
  op: Extract<TimelineOp, { kind: 'marker.remove' }>,
): TimelineOpResult {
  const marker = requireMarker(timeline, op.markerId);
  const markers = (timeline.markers ?? []).filter(
    (item) => item.id !== op.markerId,
  );
  return {
    timeline:
      markers.length > 0
        ? { ...timeline, markers }
        : omitKey(timeline, 'markers'),
    inverse: {
      kind: 'marker.upsert',
      marker: op.snapshot ?? marker,
      before: null,
    },
  };
}

function applyClipPatch(
  timeline: Timeline,
  clipId: string,
  patch: (clip: TimelineClip) => {
    clip: TimelineClip;
    inverse: TimelineOp;
  },
): TimelineOpResult {
  const location = requireClipLocation(timeline, clipId);
  const patched = patch(location.clip);
  assertClipKindFitsTrack(location.track, patched.clip);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.map((clip) => (clip.id === clipId ? patched.clip : clip)),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: patched.inverse,
  };
}

function applyVisualClipPatch(
  timeline: Timeline,
  clipId: string,
  patch: (
    clip: Extract<TimelineClip, { kind: 'video' | 'image' | 'overlay' }>,
  ) => {
    clip: Extract<TimelineClip, { kind: 'video' | 'image' | 'overlay' }>;
    inverse: TimelineOp;
  },
): TimelineOpResult {
  const location = requireClipLocation(timeline, clipId);
  if (!isVisualClip(location.clip)) {
    throw new TimelineOpError(
      `Clip is not visual: ${clipId}`,
      'clip_kind_mismatch',
    );
  }
  const patched = patch(location.clip);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.map((clip) => (clip.id === clipId ? patched.clip : clip)),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: patched.inverse,
  };
}

function applyAudioClipPatch(
  timeline: Timeline,
  clipId: string,
  patch: (clip: AudioTimelineClip) => {
    clip: AudioTimelineClip;
    inverse: TimelineOp;
  },
): TimelineOpResult {
  const location = requireClipLocation(timeline, clipId);
  if (!isAudioClip(location.clip)) {
    throw new TimelineOpError(
      `Clip is not audio: ${clipId}`,
      'clip_kind_mismatch',
    );
  }
  const patched = patch(location.clip);
  const tracks = timeline.tracks.map((track) =>
    track.id === location.track.id
      ? trackWithClips(
          track,
          track.clips.map((clip) => (clip.id === clipId ? patched.clip : clip)),
        )
      : track,
  );
  return {
    timeline: withDuration({ ...timeline, tracks }),
    inverse: patched.inverse,
  };
}

function requireClipLocation(
  timeline: Timeline,
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip } {
  const location = findClipLocation(timeline, clipId);
  if (!location) {
    throw new TimelineOpError(`Clip not found: ${clipId}`, 'clip_missing');
  }
  return location;
}

function findClipLocation(
  timeline: Timeline,
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip } | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function findTrack(timeline: Timeline, trackId: string): TimelineTrack {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new TimelineOpError(`Track not found: ${trackId}`, 'track_missing');
  }
  return track;
}

function requireMarker(timeline: Timeline, markerId: string): TimelineMarker {
  const marker = timeline.markers?.find((item) => item.id === markerId);
  if (!marker) {
    throw new TimelineOpError(
      `Marker not found: ${markerId}`,
      'marker_missing',
    );
  }
  return marker;
}

function trackWithClips(
  track: TimelineTrack,
  clips: TimelineClip[],
): TimelineTrack {
  switch (track.kind) {
    case 'video':
    case 'broll':
      return { ...track, clips: clips.filter(isVisualClip) };
    case 'overlay':
      return {
        ...track,
        clips: clips.filter((clip) => isVisualClip(clip) || isEffectClip(clip)),
      };
    case 'audio-vo':
    case 'audio-music':
    case 'audio-sfx':
      return { ...track, clips: clips.filter(isAudioClip) };
    case 'caption':
      return { ...track, clips: clips.filter(isCaptionClip) };
    default: {
      const exhaustive: never = track;
      return exhaustive;
    }
  }
}

const MIN_TRANSITION_DURATION_MS = 33;
const MAX_TRANSITION_DURATION_MS = 3000;
const TRANSITION_PRESET_MAX_DURATION_MS: Record<
  TimelineTransitionKind,
  number
> = {
  cut: 33,
  fade: 3000,
  slide: 2000,
  wipe: 2000,
  iris: 2000,
  dissolve: 3000,
  'soft-wipe': 2000,
  pixelize: 2000,
  'polygon-iris': 2000,
  cover: 2000,
  reveal: 2000,
  flip: 1500,
  'clock-wipe': 2000,
  cube: 1500,
  'zoom-blur': 1500,
  'zoom-in-out': 2000,
};

interface TransitionSeamTarget {
  toClip: VisualTimelineClip;
  maxDurationMs: number;
}

function repairTransitionSeamInvariants(
  before: Timeline,
  next: Timeline,
  expectedTransitionTargets: ReadonlyMap<string, string>,
): Timeline {
  const beforeTargets = transitionSeamTargetIdsByClipId(before);
  const nextSeams = transitionSeamTargetsByClipId(next);
  let changed = false;
  const tracks = next.tracks.map((track) => {
    if (!isVisualTrack(track)) return track;
    const clips = track.clips.map((clip) => {
      if (!isVisualClip(clip)) return clip;
      const expectedTargetId =
        expectedTransitionTargets.get(clip.id) ?? beforeTargets.get(clip.id);
      const repaired = repairVisualTransitionForSeam(
        clip,
        expectedTargetId,
        nextSeams.get(clip.id),
      );
      if (repaired !== clip) changed = true;
      return repaired;
    });
    return changed ? trackWithClips(track, clips) : track;
  });
  return changed ? { ...next, tracks } : next;
}

function transitionRestorationOps(
  before: Timeline,
  next: Timeline,
  repaired: Timeline,
): TimelineOp[] {
  const beforeClips = visualClipsById(before);
  const nextClips = visualClipsById(next);
  const repairedClips = visualClipsById(repaired);
  const restoreOps: TimelineOp[] = [];
  for (const [clipId, repairedClip] of repairedClips) {
    const nextClip = nextClips.get(clipId);
    const beforeClip = beforeClips.get(clipId);
    if (!nextClip || !beforeClip) continue;
    if (
      transitionValuesEqual(
        nextClip.transitionToNext,
        repairedClip.transitionToNext,
      )
    ) {
      continue;
    }
    restoreOps.push({
      kind: 'clip.setTransition',
      clipId,
      before: repairedClip.transitionToNext ?? null,
      after: beforeClip.transitionToNext ?? null,
    });
  }
  return restoreOps;
}

function transitionAwareSplitClips(
  timeline: Timeline,
  location: { track: TimelineTrack; clip: TimelineClip },
  after: [TimelineClip, TimelineClip],
): {
  after: [TimelineClip, TimelineClip];
  expectedTransitionTargets: Map<string, string>;
} {
  const expectedTransitionTargets = new Map<string, string>();
  if (!isVisualClip(location.clip)) {
    return { after, expectedTransitionTargets };
  }
  const targetId = transitionSeamTargetIdsByClipId(timeline).get(
    location.clip.id,
  );
  const targetLocation = targetId ? findClipLocation(timeline, targetId) : null;
  const targetClip =
    targetLocation && isVisualClip(targetLocation.clip)
      ? targetLocation.clip
      : null;
  const sanitized = after.map((clip) =>
    isVisualClip(clip) ? clearVisualTransition(clip) : clip,
  ) as [TimelineClip, TimelineClip];

  const transition = location.clip.transitionToNext;
  if (!transition || !targetClip) {
    return { after: sanitized, expectedTransitionTargets };
  }

  const frameRate = frameRateForTimeline(timeline);
  const nextAfter = sanitized.map((clip) => {
    if (!isVisualClip(clip)) return clip;
    if (!clipsTouchWithinFrame(clip, targetClip, frameRate)) return clip;
    expectedTransitionTargets.set(clip.id, targetClip.id);
    return setVisualTransition(clip, transition);
  }) as [TimelineClip, TimelineClip];
  return { after: nextAfter, expectedTransitionTargets };
}

function repairVisualTransitionForSeam(
  clip: VisualTimelineClip,
  expectedTargetId: string | undefined,
  seam: TransitionSeamTarget | undefined,
): VisualTimelineClip {
  if (!clip.transitionToNext) return clip;
  if (!expectedTargetId || !seam || seam.toClip.id !== expectedTargetId) {
    return clearVisualTransition(clip);
  }
  if (seam.maxDurationMs < MIN_TRANSITION_DURATION_MS) {
    return clearVisualTransition(clip);
  }
  const transition = clampTimelineTransitionDuration(
    clip.transitionToNext,
    seam.maxDurationMs,
  );
  return transition === clip.transitionToNext
    ? clip
    : setVisualTransition(clip, transition);
}

function clampTimelineTransitionDuration(
  transition: TimelineTransition,
  maxDurationMs: number,
): TimelineTransition {
  if (typeof transition === 'string' || transition.durationMs === undefined) {
    return transition;
  }
  const durationMs = Math.round(transition.durationMs);
  const clampedDurationMs = Math.max(
    MIN_TRANSITION_DURATION_MS,
    Math.min(MAX_TRANSITION_DURATION_MS, maxDurationMs, durationMs),
  );
  return clampedDurationMs === transition.durationMs
    ? transition
    : { ...transition, durationMs: clampedDurationMs };
}

function transitionSeamTargetIdsByClipId(
  timeline: Timeline,
): Map<string, string> {
  return new Map(
    [...transitionSeamTargetsByClipId(timeline)].map(([clipId, target]) => [
      clipId,
      target.toClip.id,
    ]),
  );
}

function transitionSeamTargetsByClipId(
  timeline: Timeline,
): Map<string, TransitionSeamTarget> {
  const frameRate = frameRateForTimeline(timeline);
  const seams = new Map<string, TransitionSeamTarget>();
  for (const track of timeline.tracks) {
    if (!isVisualTrack(track)) continue;
    const clips = sortClipsByStart(track.clips.filter(isVisualClip));
    for (let index = 0; index < clips.length - 1; index += 1) {
      const fromClip = clips[index];
      const toClip = clips[index + 1];
      if (!fromClip || !toClip) continue;
      if (!clipsTouchWithinFrame(fromClip, toClip, frameRate)) continue;
      seams.set(fromClip.id, {
        toClip,
        maxDurationMs: transitionEffectiveMaxDurationMs(fromClip, toClip),
      });
    }
  }
  return seams;
}

function transitionEffectiveMaxDurationMs(
  fromClip: VisualTimelineClip,
  toClip: VisualTimelineClip,
): number {
  const presetMaxDurationMs = fromClip.transitionToNext
    ? transitionPresetMaxDurationMs(fromClip.transitionToNext)
    : MAX_TRANSITION_DURATION_MS;
  return Math.max(
    0,
    Math.min(
      presetMaxDurationMs,
      MAX_TRANSITION_DURATION_MS,
      Math.floor(fromClip.durationMs / 2),
      Math.floor(toClip.durationMs / 2),
    ),
  );
}

function transitionPresetMaxDurationMs(transition: TimelineTransition): number {
  const kind = typeof transition === 'string' ? transition : transition.kind;
  return TRANSITION_PRESET_MAX_DURATION_MS[kind];
}

function clipsTouchWithinFrame(
  fromClip: Pick<TimelineClip, 'durationMs' | 'startMs'>,
  toClip: Pick<TimelineClip, 'startMs'>,
  fps: number,
): boolean {
  const fromEndFrame = msToFrame(fromClip.startMs + fromClip.durationMs, fps);
  const toStartFrame = msToFrame(toClip.startMs, fps);
  return Math.abs(toStartFrame - fromEndFrame) <= 1;
}

function visualClipsById(timeline: Timeline): Map<string, VisualTimelineClip> {
  const clips = new Map<string, VisualTimelineClip>();
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (isVisualClip(clip)) clips.set(clip.id, clip);
    }
  }
  return clips;
}

function setVisualTransition(
  clip: VisualTimelineClip,
  transition: TimelineTransition,
): VisualTimelineClip {
  return { ...clip, transitionToNext: transition };
}

function clearVisualTransition(clip: VisualTimelineClip): VisualTimelineClip {
  if (!clip.transitionToNext) return clip;
  return omitKey(clip, 'transitionToNext');
}

function transitionValuesEqual(
  left: TimelineTransition | undefined,
  right: TimelineTransition | undefined,
): boolean {
  return left === right;
}

function frameRateForTimeline(timeline: Timeline): number {
  const rate = timeline.frameRate;
  if (rate) return rate.num / rate.den;
  return timeline.fps;
}

function msToFrame(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, Math.round((ms / 1000) * fps));
}

function assertClipKindFitsTrack(
  track: TimelineTrack,
  clip: TimelineClip,
): void {
  const fits =
    (isVisualTrack(track) && isVisualClip(clip)) ||
    (track.kind === 'overlay' && isEffectClip(clip)) ||
    (isAudioTrack(track) && isAudioClip(clip)) ||
    (track.kind === 'caption' && isCaptionClip(clip));
  if (!fits) {
    throw new TimelineOpError(
      `Clip kind ${clip.kind} cannot be placed on ${track.kind} track`,
      'clip_kind_mismatch',
    );
  }
}

function assertCaptionClipFitsTrack(
  track: TimelineTrack,
  clip: CaptionTimelineClip,
): void {
  if (track.kind !== 'caption') {
    throw new TimelineOpError(
      `Caption clip cannot be placed on ${track.kind} track`,
      'clip_kind_mismatch',
    );
  }
  assertTimingStateValid(timingState(clip));
}

function isVisualTrack(track: TimelineTrack): boolean {
  return (
    track.kind === 'video' || track.kind === 'broll' || track.kind === 'overlay'
  );
}

function isPrimaryRippleTrack(track: TimelineTrack): boolean {
  return track.kind === 'video';
}

function findPrimaryRippleTrack(timeline: Timeline): TimelineTrack {
  const track = timeline.tracks.find(isPrimaryRippleTrack);
  if (!track) {
    throw new TimelineOpError('Primary video track not found', 'track_missing');
  }
  return track;
}

function isAudioTrack(
  track: TimelineTrack,
): track is Extract<
  TimelineTrack,
  { kind: 'audio-vo' | 'audio-music' | 'audio-sfx' }
> {
  return (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  );
}

function isAudioClip(clip: TimelineClip): clip is AudioTimelineClip {
  return clip.kind === 'audio';
}

function isVisualClip(
  clip: TimelineClip,
): clip is Extract<TimelineClip, { kind: 'video' | 'image' | 'overlay' }> {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function isCaptionClip(
  clip: TimelineClip,
): clip is Extract<TimelineClip, { kind: 'caption' }> {
  return clip.kind === 'caption';
}

function isEffectClip(
  clip: TimelineClip,
): clip is Extract<TimelineClip, { kind: 'effect' }> {
  return clip.kind === 'effect';
}

function timingState(clip: TimelineClip): ClipTimingState {
  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
  };
}

function applyTimingState<T extends TimelineClip>(
  clip: T,
  timing: ClipTimingState,
): T {
  const next = { ...clip, ...timing };
  if (next.kind !== 'image') return next;
  return {
    ...next,
    sourceDurationMs: Math.max(
      next.sourceDurationMs ?? 0,
      next.trimEndMs,
      next.trimStartMs + next.durationMs,
    ),
  };
}

function buildTimeRangeReplacement(
  track: TimelineTrack,
  startMs: number,
  endMsValue: number,
  magnetic: boolean,
): { before: TimelineClip[]; after: TimelineClip[] } {
  const durationMs = endMsValue - startMs;
  const before: TimelineClip[] = [];
  const after: TimelineClip[] = [];

  for (const clip of track.clips) {
    const clipEndMs = endMs(clip);
    const intersects = clip.startMs < endMsValue && clipEndMs > startMs;
    const shifts = magnetic && clip.startMs >= endMsValue;
    if (!intersects && !shifts) continue;

    before.push(clip);

    if (!intersects) {
      after.push({ ...clip, startMs: Math.max(0, clip.startMs - durationMs) });
      continue;
    }

    if (startMs <= clip.startMs && endMsValue >= clipEndMs) continue;

    if (clip.startMs < startMs && clipEndMs > endMsValue) {
      throw new TimelineOpError(
        'Removing a middle range requires explicit replacement clips',
        'clip_time_range_requires_split',
      );
    }

    if (clip.startMs < startMs) {
      const nextDurationMs = startMs - clip.startMs;
      after.push({
        ...clip,
        durationMs: nextDurationMs,
        trimEndMs: clip.trimStartMs + nextDurationMs,
      });
      continue;
    }

    const removedFromStartMs = Math.max(0, endMsValue - clip.startMs);
    const nextDurationMs = clipEndMs - endMsValue;
    after.push({
      ...clip,
      startMs: magnetic ? startMs : endMsValue,
      durationMs: nextDurationMs,
      trimStartMs: clip.trimStartMs + removedFromStartMs,
      trimEndMs: clip.trimStartMs + removedFromStartMs + nextDurationMs,
    });
  }

  return { before, after };
}

function replaceClips(
  clips: readonly TimelineClip[],
  before: readonly TimelineClip[],
  after: readonly TimelineClip[],
): TimelineClip[] {
  const removeIds = new Set(before.map((clip) => clip.id));
  const nextClips = [
    ...clips.filter((clip) => !removeIds.has(clip.id)),
    ...after,
  ];
  return nextClips.sort((left, right) => left.startMs - right.startMs);
}

function sortClipsByStart<T extends TimelineClip>(clips: readonly T[]): T[] {
  return clips
    .map((clip, index) => ({ clip, index }))
    .sort(
      (left, right) =>
        left.clip.startMs - right.clip.startMs || left.index - right.index,
    )
    .map((item) => item.clip);
}

function endMs(clip: TimelineClip): number {
  return clip.startMs + clip.durationMs;
}

function endTimingMs(timing: ClipTimingState): number {
  return timing.startMs + timing.durationMs;
}

function assertRangeValid(startMs: number, endMsValue: number): void {
  if (!Number.isFinite(startMs) || startMs < 0) {
    throw new TimelineOpError(
      'Range startMs must be ≥ 0',
      'clip_time_range_invalid',
    );
  }
  if (!Number.isFinite(endMsValue) || endMsValue <= startMs) {
    throw new TimelineOpError(
      'Range endMs must be greater than startMs',
      'clip_time_range_invalid',
    );
  }
}

function captionTextFromTokens(tokens: readonly { text: string }[]): string {
  return tokens
    .map((token) => token.text)
    .join(' ')
    .trim();
}

function withDuration(timeline: Timeline): Timeline {
  let durationMs = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clip.startMs + clip.durationMs;
      if (end > durationMs) durationMs = end;
    }
  }
  return { ...timeline, durationMs };
}

function assertTimingStateValid(timing: ClipTimingState): void {
  if (!Number.isFinite(timing.startMs) || timing.startMs < 0) {
    throw new TimelineOpError(
      'Clip startMs must be ≥ 0',
      'clip_timing_invalid',
    );
  }
  if (!Number.isFinite(timing.durationMs) || timing.durationMs <= 0) {
    throw new TimelineOpError(
      'Clip durationMs must be > 0',
      'clip_timing_invalid',
    );
  }
  if (
    !Number.isFinite(timing.trimStartMs) ||
    !Number.isFinite(timing.trimEndMs) ||
    timing.trimStartMs < 0 ||
    timing.trimEndMs <= timing.trimStartMs
  ) {
    throw new TimelineOpError(
      'Clip trim window must satisfy 0 ≤ trimStartMs < trimEndMs',
      'clip_timing_invalid',
    );
  }
}

function upsertKeyframe(
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeableProperty,
  key: Keyframe,
): KeyframeTrack {
  const existing = findKeyframeTrack(tracks, property);
  return normalizeKeyframeTrack({
    property,
    keys: existing
      ? existing.keys.some((item) => item.atMs === key.atMs)
        ? existing.keys.map((item) => (item.atMs === key.atMs ? key : item))
        : [...existing.keys, key]
      : [key],
  });
}

function removeKeyframe(
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeableProperty,
  atMs: number,
): KeyframeTrack | null {
  const existing = findKeyframeTrack(tracks, property);
  if (!existing) return null;
  const keys = existing.keys.filter((key) => key.atMs !== atMs);
  return keys.length > 0 ? { property, keys } : null;
}

function withKeyframeTrack<T extends TimelineClip>(
  clip: T,
  property: KeyframeableProperty,
  track: KeyframeTrack | null,
): T {
  const keyframes = [
    ...(clip.keyframes ?? []).filter((item) => item.property !== property),
    ...(track ? [normalizeKeyframeTrack(track)] : []),
  ];
  if (keyframes.length === 0) return omitKey(clip, 'keyframes') as T;
  return { ...clip, keyframes } as T;
}

function requireEffectStack(
  clip: VisualTimelineClip,
  effectId: string,
  parameter: ClipEffectParameter,
): ClipEffectStack {
  const stack = clip.effects;
  const effect = stack?.effects.find((candidate) => candidate.id === effectId);
  if (!stack || !effect) {
    throw new TimelineOpError(
      `Effect not found on clip: ${effectId}`,
      'effect_missing',
    );
  }
  if (!getClipEffectParameterDefinition(effect.kind, parameter)) {
    throw new TimelineOpError(
      `${parameter} is not valid for ${effect.kind}`,
      'effect_parameter_invalid',
    );
  }
  return stack;
}

function withEffectParameterTrack(
  clip: VisualTimelineClip,
  track: EffectParameterKeyframeTrack | null,
  effectId: string,
  parameter: ClipEffectParameter,
): VisualTimelineClip {
  if (track && (track.effectId !== effectId || track.parameter !== parameter)) {
    throw new TimelineOpError(
      'Effect keyframe track target must match the operation target',
      'effect_keyframe_target_mismatch',
    );
  }
  const stack = requireEffectStack(clip, effectId, parameter);
  const keyframes = [
    ...(stack.keyframes ?? []).filter(
      (candidate) =>
        candidate.effectId !== effectId || candidate.parameter !== parameter,
    ),
    ...(track ? [track] : []),
  ];
  return {
    ...clip,
    effects:
      keyframes.length > 0
        ? { ...stack, keyframes }
        : omitKey(stack, 'keyframes'),
  };
}

function assertEffectKeyframeValueValid(
  stack: ClipEffectStack,
  effectId: string,
  parameter: ClipEffectParameter,
  key: Keyframe,
): void {
  if (!Number.isFinite(key.value)) {
    throw new TimelineOpError(
      'Effect keyframe value must be finite',
      'effect_keyframe_value_invalid',
    );
  }
  const effect = stack.effects.find((candidate) => candidate.id === effectId)!;
  const definition = getClipEffectParameterDefinition(effect.kind, parameter)!;
  if (key.value < definition.min || key.value > definition.max) {
    throw new TimelineOpError(
      `${parameter} must be between ${definition.min} and ${definition.max}`,
      'effect_keyframe_value_invalid',
    );
  }
}

function assertKeyframeFitsClip(clip: TimelineClip, key: Keyframe): void {
  assertKeyframeLocalMsFitsClip(clip, key.atMs);
}

function assertKeyframeLocalMsFitsClip(clip: TimelineClip, atMs: number): void {
  if (!Number.isInteger(atMs) || atMs < 0 || atMs > clip.durationMs) {
    throw new TimelineOpError(
      'Keyframe atMs must be within the clip duration',
      'keyframe_timing_invalid',
    );
  }
}

function assertKeyframeTrackFitsClip(
  clip: TimelineClip,
  track: KeyframeTrack,
): void {
  assertKeyframeTrackValid(track);
  for (const key of track.keys) {
    assertKeyframeFitsClip(clip, key);
  }
}

function assertKeyframeTrackProperty(
  track: KeyframeTrack,
  property: KeyframeableProperty,
): void {
  if (track.property !== property) {
    throw new TimelineOpError(
      'Keyframe track property must match the operation property',
      'keyframe_property_mismatch',
    );
  }
}

function assertKeyframeTrackValid(track: KeyframeTrack): void {
  const error = keyframeTrackValidationError(track);
  if (error) {
    throw new TimelineOpError(error, 'keyframe_track_invalid');
  }
}

function assertKeyframeValueValid(
  property: KeyframeableProperty,
  value: number,
): void {
  const error = keyframeValueValidationError(property, value);
  if (error) {
    throw new TimelineOpError(error, 'keyframe_value_invalid');
  }
}

function flattenInverse(inverse: TimelineHistoryOperation): TimelineOp[] {
  return inverse.kind === 'timeline.batch' ? inverse.ops : [inverse];
}

function inverseForLinkState(
  before: readonly ClipLinkState[],
): TimelineHistoryOperation {
  // Restore each clip's exact prior membership. `clip.link` cannot express this
  // (it requires >=2 clips and re-groups them), so a per-clip restore is used —
  // this correctly handles clips that previously belonged to another group whose
  // remaining members were untouched by the link.
  return {
    kind: 'clip.setLinkGroup',
    assignments: before.map((item) => ({
      clipId: item.clipId,
      linkGroupId: item.linkGroupId,
    })),
  };
}

function clipLocationsForLinkGroup(
  timeline: Timeline,
  linkGroupId: string,
): Array<{ track: TimelineTrack; clip: TimelineClip }> {
  const locations = timeline.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.linkGroupId === linkGroupId)
      .map((clip) => ({ track, clip })),
  );
  if (locations.length === 0) {
    throw new TimelineOpError(
      `Link group not found: ${linkGroupId}`,
      'clip_link_missing',
    );
  }
  return locations;
}

function detectTimelineOpConflicts(
  timeline: Timeline,
  op: TimelineOp,
): RippleConflict[] {
  const syncLockConflicts = detectDirectSyncLockConflicts(timeline, op);
  if (syncLockConflicts.length > 0) return syncLockConflicts;
  if (isMagneticOp(op)) return [];

  const beforeOverlapKeys = new Set(
    detectTrackOverlapConflicts(timeline).map(conflictKey),
  );
  const beforeSyncKeys = new Set(
    findOutOfSyncGroups(timeline).map((report) => report.linkGroupId),
  );
  const next = applyTimelineOp(timeline, op).timeline;
  return [
    ...detectTrackOverlapConflicts(next).filter(
      (conflict) => !beforeOverlapKeys.has(conflictKey(conflict)),
    ),
    ...findOutOfSyncGroups(next)
      .filter((report) => !beforeSyncKeys.has(report.linkGroupId))
      .filter((report) =>
        isLinkGroupOnSyncLockedTrack(next, report.linkGroupId),
      )
      .map((report) => ({
        clipId: report.clipIds[0] ?? report.linkGroupId,
        reason: 'sync-lock' as const,
        detail: report.detail,
      })),
  ];
}

function detectDirectSyncLockConflicts(
  timeline: Timeline,
  op: TimelineOp,
): RippleConflict[] {
  switch (op.kind) {
    case 'clip.insert': {
      const track = findTrack(timeline, op.trackId);
      return track.syncLocked && !op.clip.linkGroupId
        ? [
            {
              clipId: op.clip.id,
              reason: 'sync-lock',
              detail: `Track ${track.id} is sync-locked`,
            },
          ]
        : [];
    }
    case 'clip.move': {
      const { track, clip } = requireClipLocation(timeline, op.clipId);
      const targetTrack = findTrack(timeline, op.to.trackId);
      return !clip.linkGroupId && (track.syncLocked || targetTrack.syncLocked)
        ? [
            {
              clipId: clip.id,
              reason: 'sync-lock',
              detail: `Track ${
                track.syncLocked ? track.id : targetTrack.id
              } is sync-locked`,
            },
          ]
        : [];
    }
    case 'clip.remove':
    case 'clip.trim':
    case 'clip.extend': {
      const { track, clip } = requireClipLocation(timeline, op.clipId);
      return track.syncLocked && !clip.linkGroupId
        ? [
            {
              clipId: clip.id,
              reason: 'sync-lock',
              detail: `Track ${track.id} is sync-locked`,
            },
          ]
        : [];
    }
    case 'clip.removeTimeRange': {
      const track = op.trackId
        ? findTrack(timeline, op.trackId)
        : findPrimaryRippleTrack(timeline);
      return track.syncLocked
        ? [
            {
              clipId: track.id,
              reason: 'sync-lock',
              detail: `Track ${track.id} is sync-locked`,
            },
          ]
        : [];
    }
    case 'clip.link':
    case 'clip.unlink':
    case 'clip.setLinkGroup':
    case 'clip.split':
    case 'clip.merge':
    case 'clip.setTransition':
    case 'clip.setAudio':
    case 'clip.setAudioTransition':
    case 'clip.setTransform':
    case 'clip.setFilters':
    case 'clip.setEffects':
    case 'clip.setParams':
    case 'clip.setPlayback':
    case 'keyframe.upsert':
    case 'keyframe.remove':
    case 'keyframe.setTrack':
    case 'effectKeyframe.upsert':
    case 'effectKeyframe.remove':
    case 'effectKeyframe.setTrack':
    case 'caption.splitAtTime':
    case 'caption.mergeSibling':
    case 'caption.regroup':
    case 'caption.setTokenText':
    case 'track.insert':
    case 'track.remove':
    case 'track.update':
    case 'marker.upsert':
    case 'marker.remove':
      return [];
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

function isLinkGroupOnSyncLockedTrack(
  timeline: Timeline,
  linkGroupId: string,
): boolean {
  return timeline.tracks.some(
    (track) =>
      track.syncLocked &&
      track.clips.some((clip) => clip.linkGroupId === linkGroupId),
  );
}

function detectTrackOverlapConflicts(timeline: Timeline): RippleConflict[] {
  return timeline.tracks.flatMap((track) => {
    const ordered = [...track.clips].sort(
      (left, right) => left.startMs - right.startMs,
    );
    const conflicts: RippleConflict[] = [];
    let previous: TimelineClip | undefined;
    for (const clip of ordered) {
      if (previous && clip.startMs < endMs(previous)) {
        conflicts.push({
          clipId: clip.id,
          reason: track.syncLocked ? 'sync-lock' : 'overlap',
          detail: `Clip overlaps ${previous.id} on track ${track.id}`,
        });
      }
      previous = clip;
    }
    return conflicts;
  });
}

function conflictKey(conflict: RippleConflict): string {
  return `${conflict.clipId}:${conflict.reason}:${conflict.detail ?? ''}`;
}

function isMagneticOp(op: TimelineOp): boolean {
  switch (op.kind) {
    case 'clip.insert':
    case 'clip.remove':
    case 'clip.removeTimeRange':
    case 'clip.move':
    case 'clip.trim':
    case 'clip.extend':
      return Boolean(op.magnetic);
    case 'clip.link':
    case 'clip.unlink':
    case 'clip.setLinkGroup':
    case 'clip.split':
    case 'clip.merge':
    case 'clip.setTransition':
    case 'clip.setAudio':
    case 'clip.setAudioTransition':
    case 'clip.setTransform':
    case 'clip.setFilters':
    case 'clip.setEffects':
    case 'clip.setParams':
    case 'clip.setPlayback':
    case 'keyframe.upsert':
    case 'keyframe.remove':
    case 'keyframe.setTrack':
    case 'effectKeyframe.upsert':
    case 'effectKeyframe.remove':
    case 'effectKeyframe.setTrack':
    case 'caption.splitAtTime':
    case 'caption.mergeSibling':
    case 'caption.regroup':
    case 'caption.setTokenText':
    case 'track.insert':
    case 'track.remove':
    case 'track.update':
    case 'marker.upsert':
    case 'marker.remove':
      return false;
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

function clearClipLinkGroup(clip: TimelineClip): TimelineClip {
  switch (clip.kind) {
    case 'video':
    case 'image':
    case 'audio':
    case 'caption':
    case 'overlay':
    case 'effect': {
      const { linkGroupId: _removed, ...rest } = clip;
      void _removed;
      return rest;
    }
    default: {
      const exhaustive: never = clip;
      return exhaustive;
    }
  }
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

function audioClipAudioPatchKeys(
  patch: AudioClipAudioPatch,
): AudioClipAudioPatchKey[] {
  return AUDIO_CLIP_AUDIO_PATCH_KEYS.filter((key) => key in patch);
}

function audioClipAudioPatchFromClip(
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

function applyAudioClipAudioPatch(
  clip: AudioTimelineClip,
  patch: AudioClipAudioPatch,
): AudioTimelineClip {
  let next = clip;
  if (patch.gainDb !== undefined) {
    next =
      patch.gainDb === null
        ? omitKey(next, 'gainDb')
        : { ...next, gainDb: patch.gainDb };
  }
  if (patch.muted !== undefined) {
    next =
      patch.muted === null
        ? omitKey(next, 'muted')
        : { ...next, muted: patch.muted };
  }
  if (patch.fadeInMs !== undefined) {
    next =
      patch.fadeInMs === null
        ? omitKey(next, 'fadeInMs')
        : { ...next, fadeInMs: patch.fadeInMs };
  }
  if (patch.fadeOutMs !== undefined) {
    next =
      patch.fadeOutMs === null
        ? omitKey(next, 'fadeOutMs')
        : { ...next, fadeOutMs: patch.fadeOutMs };
  }
  if (patch.fadeInCurve !== undefined) {
    next =
      patch.fadeInCurve === null
        ? omitKey(next, 'fadeInCurve')
        : { ...next, fadeInCurve: patch.fadeInCurve };
  }
  if (patch.fadeOutCurve !== undefined) {
    next =
      patch.fadeOutCurve === null
        ? omitKey(next, 'fadeOutCurve')
        : { ...next, fadeOutCurve: patch.fadeOutCurve };
  }
  return next;
}

const TRACK_UPDATE_PATCH_KEYS = [
  'name',
  'muted',
  'locked',
  'syncLocked',
  'order',
  'volumeDb',
  'duckUnderTrackId',
] as const;

type TrackUpdatePatchKey = (typeof TRACK_UPDATE_PATCH_KEYS)[number];

function trackUpdatePatchKeys(patch: TrackUpdatePatch): TrackUpdatePatchKey[] {
  return TRACK_UPDATE_PATCH_KEYS.filter((key) => key in patch);
}

function trackUpdatePatchFromTrack(
  track: TimelineTrack,
  keys: readonly TrackUpdatePatchKey[],
): TrackUpdatePatch {
  const patch: TrackUpdatePatch = {};
  for (const key of keys) {
    switch (key) {
      case 'name':
        patch.name = track.name;
        break;
      case 'muted':
        patch.muted = track.muted;
        break;
      case 'locked':
        patch.locked = track.locked;
        break;
      case 'syncLocked':
        patch.syncLocked = track.syncLocked ?? null;
        break;
      case 'order':
        patch.order = track.order;
        break;
      case 'volumeDb':
        patch.volumeDb = isAudioTrack(track) ? (track.volumeDb ?? null) : null;
        break;
      case 'duckUnderTrackId':
        patch.duckUnderTrackId = isAudioTrack(track)
          ? (track.duckUnderTrackId ?? null)
          : null;
        break;
      default: {
        const exhaustive: never = key;
        return exhaustive;
      }
    }
  }
  return patch;
}

function applyTrackUpdatePatch(
  track: TimelineTrack,
  patch: TrackUpdatePatch,
): TimelineTrack {
  let next = applyBaseTrackUpdatePatch(track, patch);
  if (patch.volumeDb === undefined && patch.duckUnderTrackId === undefined) {
    return next;
  }
  if (!isAudioTrack(next)) {
    throw new TimelineOpError(
      `Track is not audio: ${track.id}`,
      'track_kind_mismatch',
    );
  }
  if (patch.volumeDb !== undefined) {
    next =
      patch.volumeDb === null
        ? omitKey(next, 'volumeDb')
        : { ...next, volumeDb: patch.volumeDb };
  }
  if (patch.duckUnderTrackId !== undefined) {
    next =
      patch.duckUnderTrackId === null
        ? omitKey(next, 'duckUnderTrackId')
        : { ...next, duckUnderTrackId: patch.duckUnderTrackId };
  }
  return next;
}

function applyBaseTrackUpdatePatch(
  track: TimelineTrack,
  patch: TrackUpdatePatch,
): TimelineTrack {
  let next = track;
  if (patch.name !== undefined) {
    next = { ...next, name: patch.name };
  }
  if (patch.muted !== undefined) {
    next = { ...next, muted: patch.muted };
  }
  if (patch.locked !== undefined) {
    next = { ...next, locked: patch.locked };
  }
  if (patch.syncLocked !== undefined) {
    next =
      patch.syncLocked === null
        ? omitTrackSyncLocked(next)
        : { ...next, syncLocked: patch.syncLocked };
  }
  if (patch.order !== undefined) {
    next = { ...next, order: patch.order };
  }
  return next;
}

function omitTrackSyncLocked(track: TimelineTrack): TimelineTrack {
  const { syncLocked: _removed, ...rest } = track;
  void _removed;
  switch (rest.kind) {
    case 'video':
    case 'broll':
    case 'overlay':
    case 'audio-vo':
    case 'audio-music':
    case 'audio-sfx':
    case 'caption':
      return rest;
    default: {
      const exhaustive: never = rest;
      return exhaustive;
    }
  }
}

function omitKey<T extends object, K extends keyof T>(
  value: T,
  key: K,
): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  void _removed;
  return rest;
}
