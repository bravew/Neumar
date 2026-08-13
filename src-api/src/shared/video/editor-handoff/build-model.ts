import { rebuildTimelineFromStoryboard } from '@/shared/video/timeline';
import type {
  AudioTimelineClip,
  AudioTimelineTrack,
  CaptionTimelineClip,
  EffectTimelineClip,
  MediaItem,
  TimelineClip,
  TimelineSourceRef,
  TimelineTrack,
  TimelineTransition,
  VideoProject,
  VideoTimeline,
  VisualTimelineClip,
} from '@/shared/video/types';

import {
  EDITOR_HANDOFF_PACKAGE_VERSION,
  type EditorHandoffActionBatch,
  type EditorHandoffClip,
  type EditorHandoffClipHandles,
  type EditorHandoffDerivative,
  type EditorHandoffFeatureMap,
  type EditorHandoffMediaRef,
  type EditorHandoffModel,
  type EditorHandoffTrack,
} from './types';

const SOURCE_HANDLE_MS = 2_000;
const XML_SAFE_BUILTIN_TRANSITIONS = new Set(['cut', 'fade', 'dissolve']);
const SUPPORTED_BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
]);

export function buildEditorHandoffModel(
  project: VideoProject,
  generatedAt = new Date().toISOString(),
): EditorHandoffModel {
  const timeline = readTimeline(project);
  const mediaRefs = buildMediaRefs(project);
  const tracks = timeline.tracks
    .slice()
    .sort(compareTracks)
    .map((track) => buildTrack(track, mediaRefs));
  const derivatives = buildDerivatives(project);
  const actionBatches = buildActionBatches(project);
  const analysisArtifacts = project.analysisArtifacts ?? [];
  const featureMap = buildFeatureMap({
    tracks,
    mediaRefs,
    derivatives,
    analysisArtifactCount: analysisArtifacts.length,
    approvedActionBatchCount: actionBatches.length,
  });

  return {
    schema: 'neuma.video.editor-handoff.model.v1',
    packageVersion: EDITOR_HANDOFF_PACKAGE_VERSION,
    projectId: project.id,
    projectName: project.name,
    generatedAt,
    timelineSchema: timeline.schema,
    fps: timeline.fps,
    durationMs: timeline.durationMs,
    tracks,
    markers: timeline.markers ?? [],
    mediaRefs,
    derivatives,
    analysisArtifacts,
    actionBatches,
    featureMap,
  };
}

export function sourceHandlePolicy(): {
  requestedBeforeMs: number;
  requestedAfterMs: number;
} {
  return {
    requestedBeforeMs: SOURCE_HANDLE_MS,
    requestedAfterMs: SOURCE_HANDLE_MS,
  };
}

function readTimeline(project: VideoProject): VideoTimeline {
  return (
    project.timeline ??
    rebuildTimelineFromStoryboard(project).timeline ?? {
      schema: 'neuma.video.timeline.v1',
      tracks: [],
      durationMs: 0,
      fps: 30,
    }
  );
}

function buildTrack(
  track: TimelineTrack,
  mediaRefs: EditorHandoffMediaRef[],
): EditorHandoffTrack {
  return {
    id: track.id,
    kind: track.kind,
    name: track.name,
    muted: track.muted,
    locked: track.locked,
    order: track.order,
    volumeDb: isAudioTrack(track) ? track.volumeDb : undefined,
    duckUnderTrackId: isAudioTrack(track) ? track.duckUnderTrackId : undefined,
    clips: track.clips
      .slice()
      .sort(compareClips)
      .map((clip) => buildClip(track, clip, mediaRefs)),
  };
}

function buildClip(
  track: TimelineTrack,
  clip: TimelineClip,
  mediaRefs: EditorHandoffMediaRef[],
): EditorHandoffClip {
  const sourceDurationMs = clip.sourceDurationMs;
  const mediaId = mediaIdForSourceRef(clip.sourceRef);
  const mediaRef = mediaRefs.find((ref) => ref.id === mediaId);
  const audioTrack =
    isAudioClip(clip) && isAudioTrack(track) ? track : undefined;
  return {
    id: clip.id,
    trackId: track.id,
    kind: clip.kind,
    name: clip.name ?? clip.id,
    sourceRef: clip.sourceRef,
    mediaId,
    sceneId: clip.sceneId,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    endMs: clip.startMs + clip.durationMs,
    sourceStartMs: clip.trimStartMs,
    sourceEndMs: clip.trimEndMs,
    sourceDurationMs,
    handles: buildClipHandles(clip, mediaRef),
    transitionToNext: isVisualClip(clip) ? clip.transitionToNext : undefined,
    transforms: isVisualClip(clip) ? clip.transforms : undefined,
    filters: isVisualClip(clip) ? clip.filters : undefined,
    playback: clip.playback,
    keyframes: clip.keyframes,
    muted: clipMuted(clip),
    trackMuted: audioTrack?.muted,
    trackVolumeDb: audioTrack?.volumeDb,
    trackDuckUnderTrackId: audioTrack?.duckUnderTrackId,
    gainDb: isAudioClip(clip) ? clip.gainDb : undefined,
    fadeInMs: isAudioClip(clip) ? clip.fadeInMs : undefined,
    fadeOutMs: isAudioClip(clip) ? clip.fadeOutMs : undefined,
    fadeInCurve: isAudioClip(clip) ? clip.fadeInCurve : undefined,
    fadeOutCurve: isAudioClip(clip) ? clip.fadeOutCurve : undefined,
    audioTransitionToNext: isAudioClip(clip)
      ? clip.audioTransitionToNext
      : undefined,
    provenance: mediaRef?.provenance,
    text: isCaptionClip(clip) ? clip.text : undefined,
    effectType: isEffectClip(clip) ? clip.effectType : undefined,
    params: buildClipParams(clip),
  };
}

function buildClipParams(
  clip: TimelineClip,
): Record<string, unknown> | undefined {
  if (!isCaptionClip(clip) || !clip.style) return clip.params;
  return { ...(clip.params ?? {}), style: clip.style };
}

function buildClipHandles(
  clip: TimelineClip,
  mediaRef: EditorHandoffMediaRef | undefined,
): EditorHandoffClipHandles {
  const sourceDurationMs =
    clip.sourceDurationMs ?? mediaRef?.metadata?.durationMs ?? clip.trimEndMs;
  return {
    requestedBeforeMs: SOURCE_HANDLE_MS,
    requestedAfterMs: SOURCE_HANDLE_MS,
    availableBeforeMs: Math.max(
      0,
      Math.min(SOURCE_HANDLE_MS, clip.trimStartMs),
    ),
    availableAfterMs: Math.max(
      0,
      Math.min(SOURCE_HANDLE_MS, sourceDurationMs - clip.trimEndMs),
    ),
  };
}

function buildMediaRefs(project: VideoProject): EditorHandoffMediaRef[] {
  const refs = new Map<string, EditorHandoffMediaRef>();
  for (const asset of project.assets) {
    refs.set(asset.id, mediaRefFromAsset(asset));
  }
  const timeline = readTimeline(project);
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const id = mediaIdForSourceRef(clip.sourceRef);
      if (refs.has(id)) continue;
      refs.set(id, mediaRefFromSourceRef(clip.sourceRef));
    }
  }
  return Array.from(refs.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function mediaRefFromAsset(asset: MediaItem): EditorHandoffMediaRef {
  const isPlaceholder =
    asset.path.startsWith('catalog:') ||
    asset.materializationState === 'referenced' ||
    asset.materializationState === 'hydrating' ||
    asset.materializationState === 'error';
  return {
    id: asset.id,
    kind: asset.kind,
    source: asset.source,
    path: isPlaceholder ? undefined : asset.path,
    originalPathHint: asset.path,
    metadata: asset.metadata,
    collectionId: asset.collectionId,
    collectionLabel: asset.collectionLabel,
    provenance: asset.provenance,
    missing: isPlaceholder,
    relinkRequired: isPlaceholder,
    placeholderReason: isPlaceholder
      ? (asset.materializationState ?? 'catalog')
      : undefined,
  };
}

function mediaRefFromSourceRef(
  sourceRef: TimelineSourceRef,
): EditorHandoffMediaRef {
  if (sourceRef.kind === 'linked') {
    return {
      id: mediaIdForSourceRef(sourceRef),
      kind: 'linked',
      source: 'linked',
      originalPathHint: `${sourceRef.sourceId}:${sourceRef.externalId}`,
      sourceRef,
      missing: false,
      relinkRequired: true,
    };
  }
  return {
    id: mediaIdForSourceRef(sourceRef),
    kind: 'scene',
    source: 'scene',
    sourceRef,
    missing: sourceRef.kind === 'asset',
    relinkRequired: sourceRef.kind === 'asset',
    placeholderReason:
      sourceRef.kind === 'asset' ? 'asset not found in project' : undefined,
  };
}

function buildDerivatives(project: VideoProject): EditorHandoffDerivative[] {
  return project.assets
    .flatMap((asset) => {
      const derivatives: EditorHandoffDerivative[] = [];
      if (asset.proxy) {
        derivatives.push({
          id: `${asset.id}:proxy`,
          sourceMediaId: asset.id,
          kind: 'proxy',
          path: asset.proxy.path,
          missing: false,
        });
      }
      if (asset.waveformUrl) {
        derivatives.push({
          id: `${asset.id}:waveform`,
          sourceMediaId: asset.id,
          kind: 'waveform',
          path: asset.waveformUrl,
          missing: false,
        });
      }
      if (asset.filmstripUrl) {
        derivatives.push({
          id: `${asset.id}:filmstrip`,
          sourceMediaId: asset.id,
          kind: 'filmstrip',
          path: asset.filmstripUrl,
          missing: false,
        });
      }
      return derivatives;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildActionBatches(project: VideoProject): EditorHandoffActionBatch[] {
  return (project.history?.entries ?? [])
    .filter((entry) => !entry.undone)
    .map((entry) => ({
      recordId: `history:${entry.id}`,
      historyEntryId: entry.id,
      source: entry.source,
      summary: entry.summary,
      ts: entry.ts,
      operation: entry.op,
    }));
}

function buildFeatureMap(input: {
  tracks: EditorHandoffTrack[];
  mediaRefs: EditorHandoffMediaRef[];
  derivatives: EditorHandoffDerivative[];
  analysisArtifactCount: number;
  approvedActionBatchCount: number;
}): EditorHandoffFeatureMap {
  const clips = input.tracks.flatMap((track) => track.clips);
  const audioTracks = input.tracks.filter(isEditorHandoffAudioTrack);
  const audioClips = clips.filter((clip) => clip.kind === 'audio');
  const unsupportedTransitions = uniqueSorted(
    clips
      .map((clip) => transitionKind(clip.transitionToNext))
      .filter(
        (kind): kind is string =>
          typeof kind === 'string' && !XML_SAFE_BUILTIN_TRANSITIONS.has(kind),
      ),
  );
  return {
    hasCaptions: clips.some((clip) => clip.kind === 'caption'),
    hasCaptionStyle: clips.some(
      (clip) => clip.kind === 'caption' && Boolean(clip.params?.style),
    ),
    hasTransitions: clips.some((clip) => Boolean(clip.transitionToNext)),
    unsupportedTransitions,
    hasOverlays: input.tracks.some(
      (track) =>
        track.kind === 'overlay' ||
        track.kind === 'broll' ||
        track.clips.some((clip) => clip.kind === 'overlay'),
    ),
    hasUnsupportedEffects: clips.some(
      (clip) =>
        clip.kind === 'effect' || Boolean(clip.params?.unsupportedEffect),
    ),
    hasSpeedChanges: clips.some(
      (clip) =>
        (clip.playback?.speed ?? 1) !== 1 || hasNumericParam(clip, 'speed'),
    ),
    hasReversePlayback: clips.some(
      (clip) =>
        Boolean(clip.playback?.reverse) ||
        Boolean(clip.params?.reversePlayback),
    ),
    hasFreezeFrames: clips.some((clip) => Boolean(clip.params?.freezeFrame)),
    hasStabilization: clips.some((clip) => Boolean(clip.params?.stabilization)),
    hasMotionTracking: clips.some((clip) =>
      Boolean(clip.params?.motionTracking),
    ),
    hasUnsupportedBlendModes: clips.some((clip) => {
      const blendMode = clip.params?.blendMode;
      return (
        typeof blendMode === 'string' && !SUPPORTED_BLEND_MODES.has(blendMode)
      );
    }),
    hasColorGrades: clips.some(
      (clip) => Boolean(clip.params?.colorGrade) || Boolean(clip.filters),
    ),
    hasKeyframeCurves: clips.some((clip) => hasKeyframes(clip)),
    hasAudioGain: audioClips.some((clip) => isNonZeroFinite(clip.gainDb)),
    hasAudioFades: audioClips.some(
      (clip) =>
        isPositiveFinite(clip.fadeInMs) ||
        isPositiveFinite(clip.fadeOutMs) ||
        Boolean(clip.fadeInCurve) ||
        Boolean(clip.fadeOutCurve),
    ),
    hasAudioMute:
      audioTracks.some((track) => track.muted) ||
      audioClips.some((clip) => clip.muted === true),
    hasAudioTrackVolume: audioTracks.some((track) =>
      isNonZeroFinite(track.volumeDb),
    ),
    hasAudioTransitions: audioClips.some((clip) =>
      Boolean(clip.audioTransitionToNext),
    ),
    hasAudioDucking: audioTracks.some((track) =>
      Boolean(track.duckUnderTrackId),
    ),
    hasGeneratedAudio: audioClips.some((clip) =>
      isGeneratedAudioProvenance(clip.provenance),
    ),
    missingMediaIds: input.mediaRefs
      .filter((ref) => ref.missing)
      .map((ref) => ref.id)
      .sort(),
    derivativeMissingIds: input.derivatives
      .filter((derivative) => derivative.missing)
      .map((derivative) => derivative.id)
      .sort(),
    analysisArtifactCount: input.analysisArtifactCount,
    approvedActionBatchCount: input.approvedActionBatchCount,
  };
}

function mediaIdForSourceRef(sourceRef: TimelineSourceRef): string {
  if (sourceRef.kind === 'asset') return sourceRef.assetId;
  if (sourceRef.kind === 'linked') {
    return `linked:${sourceRef.sourceId}:${sourceRef.externalId}`;
  }
  return `scene:${sourceRef.sceneId}`;
}

function transitionKind(
  transition: TimelineTransition | undefined,
): string | undefined {
  return typeof transition === 'string' ? transition : transition?.kind;
}

function hasNumericParam(clip: EditorHandoffClip, key: string): boolean {
  const value = clip.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value !== 1;
}

function hasKeyframes(clip: EditorHandoffClip): boolean {
  if ((clip.keyframes?.length ?? 0) > 0) return true;
  const legacyKeyframes = clip.params?.keyframes;
  return Array.isArray(legacyKeyframes) && legacyKeyframes.length > 0;
}

function isNonZeroFinite(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

function isPositiveFinite(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isGeneratedAudioProvenance(
  provenance: EditorHandoffClip['provenance'],
): boolean {
  return Boolean(
    provenance &&
    (provenance.generatedFor ||
      provenance.prompt ||
      provenance.acceptedOpId ||
      provenance.variantOf),
  );
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function compareTracks(a: TimelineTrack, b: TimelineTrack): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

function compareClips(a: TimelineClip, b: TimelineClip): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

function isVisualClip(clip: TimelineClip): clip is VisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function isAudioClip(clip: TimelineClip): clip is AudioTimelineClip {
  return clip.kind === 'audio';
}

function isAudioTrack(track: TimelineTrack): track is AudioTimelineTrack {
  return (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  );
}

function isEditorHandoffAudioTrack(track: EditorHandoffTrack): boolean {
  return (
    track.kind === 'audio-vo' ||
    track.kind === 'audio-music' ||
    track.kind === 'audio-sfx'
  );
}

function clipMuted(clip: TimelineClip): boolean | undefined {
  if (isAudioClip(clip) || isVisualClip(clip)) return clip.muted;
  return undefined;
}

function isCaptionClip(clip: TimelineClip): clip is CaptionTimelineClip {
  return clip.kind === 'caption';
}

function isEffectClip(clip: TimelineClip): clip is EffectTimelineClip {
  return clip.kind === 'effect';
}
