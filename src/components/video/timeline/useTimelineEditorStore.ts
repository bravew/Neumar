import {
  type AudioClipFadeEdge,
  type AudioFadeCurve,
  type AudioVolumeKeyframeMode,
  applyTimelineOps,
  buildSetAudioClipFadeOps,
  buildSetAudioClipGainOps,
  buildSetAudioClipMuteOps,
  buildSetAudioVolumeKeyframesOps,
  buildCutClipOps,
  buildDeleteClipsOps,
  buildDuplicateClipsOps,
  buildFlipClipOps,
  buildMoveClipOps,
  buildReverseClipOps,
  buildRotateClipOps,
  buildSetClipSpeedOps,
  buildSetClipTransformOps,
  buildTrimClipOps,
  durationMsToFrames,
  frameToMs,
  type Keyframe,
  msToFrame,
  transitionParamValueEquals,
  type EditBuildResult,
  type FrameRateLike,
} from '@neumar/video-ir';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import {
  isVisualTimelineTrack,
  videoTransitionKind,
  type VideoAudioSeamMode,
  type VideoAudioTimelineClip,
  type VideoClipTransform,
  type VideoClipFilters,
  type VideoTimeline,
  type VideoTimelineClip,
  type VideoTimelineMarker,
  type VideoTimelineTrack,
  type VideoTimelineTransition,
  type VideoTransitionKind,
  type VideoTransitionParamValue,
  type VideoTransitionSpec,
  type VideoTransitionTiming,
  type VideoCaptionTimelineTrack,
  type VideoVisualTimelineClip,
  type VideoVisualTimelineTrack,
  normalizeVideoTransition,
  videoTransitionRegistryEntry,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import { normalizeVideoClipFilters } from '../clipFilters';
import {
  pasteTimelineClipboardPayload,
  type TimelineClipboardPayload,
} from './timelineClipboard';
import {
  deriveTimelineTransitionSeams,
  TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS,
  type TimelineTransitionSeam,
} from './timelineTransitions';

export type TimelineTrimEdge = 'start' | 'end';

const MIN_CLIP_DURATION_MS = 100;
// Still images have no real source duration — the renderer just holds the
// frame for the requested span. Cap arbitrary stretching at 1 hour so a
// run-away drag can't blow up the timeline math.
const MAX_STILL_IMAGE_DURATION_MS = 60 * 60 * 1000;
const MIN_BOOKEND_FADE_MS = 33;
const MAX_BOOKEND_FADE_MS = 3000;
const MAX_USER_HISTORY_ENTRIES = 200;

export type TimelineLayerMoveDirection = 'up' | 'down';
type TimelineBookendPosition = 'intro' | 'outro';
export type TimelineClipSelectionMode = 'replace' | 'toggle' | 'range';
export type TimelineTransitionMutation = Pick<
  VideoTransitionSpec,
  'kind' | 'durationMs' | 'direction' | 'params' | 'timing'
>;

export interface TimelineEditWarning {
  kind: 'sync-lock-conflict';
  action: 'move' | 'trim';
  clipIds: string[];
  trackIds: string[];
  linkGroupId?: string;
}

interface TimelineEditorSnapshot {
  timeline: VideoTimeline;
  selectedClipId: string | null;
  selectedClipIds: string[];
  lastSelectedClipId: string | null;
  selectedMarkerId: string | null;
  selectedSeamId: string | null;
}

interface TimelineEditorHistoryEntry {
  id: string;
  createdAt: string;
  before: TimelineEditorSnapshot;
  after: TimelineEditorSnapshot;
}

interface TimelineEditorState {
  projectId: string | null;
  timeline: VideoTimeline | null;
  selectedClipId: string | null;
  selectedClipIds: Set<string>;
  lastSelectedClipId: string | null;
  selectedMarkerId: string | null;
  selectedSeamId: string | null;
  lastEditWarning: TimelineEditWarning | null;
  userHistory: TimelineEditorHistoryEntry[];
  userHistoryIndex: number;
  revision: number;
  persistedRevision: number;
  setProjectTimeline: (projectId: string, timeline: VideoTimeline) => void;
  updateTrack: (
    trackId: string,
    update: Partial<
      Pick<
        VideoTimeline['tracks'][number],
        'muted' | 'locked' | 'name' | 'syncLocked'
      >
    > & { hidden?: boolean },
  ) => void;
  addVideoTrack: () => string | null;
  addTrack: (kind: VideoTimelineTrack['kind']) => string | null;
  removeTrack: (trackId: string) => void;
  insertCaptionAtPlayhead: (playheadMs: number, text?: string) => string | null;
  moveTrackLayer: (
    trackId: string,
    direction: TimelineLayerMoveDirection,
  ) => void;
  splitSelectedClipAtPlayhead: (playheadMs: number) => void;
  deleteSelectedClip: (options?: { ripple?: boolean }) => void;
  duplicateSelectedClips: () => void;
  insertClip: (trackId: string, clip: VideoTimelineClip) => void;
  removeClipsForAssets: (assetIds: Iterable<string>) => void;
  updateClip: (clipId: string, patch: Partial<VideoTimelineClip>) => void;
  trimClip: (
    clipId: string,
    edge: TimelineTrimEdge,
    deltaMs: number,
    baselineClip?: VideoTimelineClip,
  ) => void;
  moveClip: (
    clipId: string,
    deltaMs: number,
    baselineClip?: VideoTimelineClip,
    targetTrackId?: string,
  ) => void;
  resyncLinkGroup: (linkGroupId: string) => void;
  unlinkLinkGroup: (linkGroupId: string) => void;
  clearEditWarning: () => void;
  updateTimelineBookend: (
    position: TimelineBookendPosition,
    durationMs: number | null,
  ) => void;
  selectSeam: (seamId: string | null) => void;
  setTransitionOnSeam: (
    seamId: string,
    transition: TimelineTransitionMutation,
  ) => void;
  removeTransitionFromSeam: (seamId: string) => void;
  updateSelectedVisualClipTransition: (transition: VideoTransitionKind) => void;
  updateSelectedVisualClipAudioSeam: (mode: VideoAudioSeamMode) => void;
  updateSelectedVisualClipFilters: (patch: Partial<VideoClipFilters>) => void;
  resetSelectedVisualClipFilters: () => void;
  setSelectedClipSpeed: (speed: number) => void;
  setSelectedClipReverse: (reverse: boolean) => void;
  setAudioClipGain: (clipId: string, gainDb: number | null) => void;
  setAudioClipMute: (clipId: string, muted: boolean) => void;
  setAudioClipFade: (
    clipId: string,
    edge: AudioClipFadeEdge,
    durationMs: number,
    curve?: AudioFadeCurve,
  ) => void;
  setAudioVolumeKeyframes: (
    clipId: string,
    keys: Keyframe[],
    mode?: AudioVolumeKeyframeMode,
  ) => void;
  setSelectedAudioClipGain: (gainDb: number | null) => void;
  setSelectedAudioClipMute: (muted: boolean) => void;
  setSelectedAudioClipFade: (
    edge: AudioClipFadeEdge,
    durationMs: number,
    curve?: AudioFadeCurve,
  ) => void;
  rotateSelectedVisualClips: (
    degrees: number,
    options?: { relative?: boolean },
  ) => void;
  flipSelectedVisualClips: (axis: 'horizontal' | 'vertical') => void;
  setSelectedVisualClipTransform: (
    transform: VideoClipTransform,
    options?: { merge?: boolean },
  ) => void;
  pasteClipboardPayload: (
    payload: TimelineClipboardPayload,
    startMs: number,
  ) => boolean;
  addMarker: (timeMs: number, label: string) => string | null;
  updateMarker: (
    markerId: string,
    patch: Partial<Omit<VideoTimelineMarker, 'id'>>,
  ) => void;
  deleteMarker: (markerId: string) => void;
  markPersisted: (projectId: string, revision: number) => void;
  selectClip: (
    clipId: string | null,
    options?: { mode?: TimelineClipSelectionMode },
  ) => void;
  selectClips: (clipIds: Iterable<string>) => void;
  selectAllClips: () => void;
  clearSelection: () => void;
  selectMarker: (markerId: string | null) => void;
  undoUserEdit: () => void;
  redoUserEdit: () => void;
}

export const useTimelineEditorStore = create<TimelineEditorState>(
  (set, get) => ({
    projectId: null,
    timeline: null,
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    lastSelectedClipId: null,
    selectedMarkerId: null,
    selectedSeamId: null,
    lastEditWarning: null,
    userHistory: [],
    userHistoryIndex: 0,
    revision: 0,
    persistedRevision: 0,
    setProjectTimeline: (projectId, timeline) => {
      const state = get();
      if (
        state.projectId === projectId &&
        state.timeline &&
        state.revision > state.persistedRevision
      ) {
        return;
      }
      const preserveHistory =
        state.projectId === projectId &&
        !!state.timeline &&
        timelinesEqual(state.timeline, timeline);
      if (preserveHistory) return;
      const selection = sanitizeClipSelection(
        state.selectedClipIds,
        timeline.tracks,
      );
      const selectedClipId = resolveSelectedClipId(
        selection,
        state.lastSelectedClipId,
      );
      const selectedMarkerId = timeline.markers?.some(
        (marker) => marker.id === state.selectedMarkerId,
      )
        ? state.selectedMarkerId
        : null;
      const selectedSeamId = sanitizeSelectedSeamId(
        state.selectedSeamId,
        timeline,
      );
      set({
        projectId,
        timeline,
        selectedClipId,
        selectedClipIds: selection,
        lastSelectedClipId: selectedClipId,
        selectedMarkerId,
        selectedSeamId,
        lastEditWarning: null,
        userHistory: preserveHistory ? state.userHistory : [],
        userHistoryIndex: preserveHistory ? state.userHistoryIndex : 0,
        revision: preserveHistory ? state.revision : 0,
        persistedRevision: preserveHistory ? state.persistedRevision : 0,
      });
    },
    updateTrack: (trackId, update) =>
      set((state) => {
        if (!state.timeline) return state;
        let changed = false;
        const tracks = state.timeline.tracks.map((track) => {
          if (track.id !== trackId) return track;
          changed = true;
          return { ...track, ...update };
        });
        if (!changed) return state;
        return withUserHistory(state, {
          timeline: {
            ...state.timeline,
            tracks,
            durationMs: getTimelineDurationMs(tracks),
          },
        });
      }),
    removeTrack: (trackId) =>
      set((state) => {
        if (!state.timeline) return state;
        const tracks = state.timeline.tracks.filter(
          (track) => track.id !== trackId,
        );
        if (tracks.length === state.timeline.tracks.length) return state;
        return withUserHistory(state, {
          timeline: { ...state.timeline, tracks },
          selectedClipId: null,
          selectedClipIds: new Set<string>(),
          lastSelectedClipId: null,
          selectedSeamId: null,
        });
      }),
    insertCaptionAtPlayhead: (playheadMs, text) => {
      let clipId: string | null = null;
      set((state) => {
        if (!state.timeline) return state;
        let timeline = state.timeline;
        const existingCaptionTrack = timeline.tracks.find(
          (track): track is VideoCaptionTimelineTrack =>
            track.kind === 'caption',
        );
        const captionTrack: VideoCaptionTimelineTrack =
          existingCaptionTrack ??
          (buildTrackByKind(
            timeline.tracks,
            'caption',
          ) as VideoCaptionTimelineTrack);
        if (!existingCaptionTrack) {
          timeline = {
            ...timeline,
            tracks: [...timeline.tracks, captionTrack],
          };
        }
        const newClip: VideoTimelineClip = {
          id: `clip-caption-${randomUUID()}`,
          kind: 'caption',
          sourceRef: { kind: 'scene', sceneId: '' },
          startMs: Math.max(0, Math.round(playheadMs)),
          durationMs: 3000,
          trimStartMs: 0,
          trimEndMs: 0,
          text: text ?? 'Caption',
        };
        clipId = newClip.id;
        const tracks = timeline.tracks.map((track) =>
          track.id === captionTrack.id
            ? ({
                ...track,
                clips: [...track.clips, newClip],
              } as VideoTimelineTrack)
            : track,
        );
        return withUserHistory(state, {
          timeline: { ...timeline, tracks },
        });
      });
      return clipId;
    },
    addVideoTrack: () => get().addTrack('video'),
    addTrack: (kind) => {
      let trackId: string | null = null;
      set((state) => {
        if (!state.timeline) return state;
        const nextTrack = buildTrackByKind(state.timeline.tracks, kind);
        trackId = nextTrack.id;
        const tracks = [...state.timeline.tracks, nextTrack];
        return withUserHistory(state, {
          timeline: { ...state.timeline, tracks },
          selectedClipId: null,
          selectedClipIds: new Set<string>(),
          lastSelectedClipId: null,
          selectedMarkerId: null,
          selectedSeamId: null,
        });
      });
      return trackId;
    },
    moveTrackLayer: (trackId, direction) =>
      set((state) => {
        if (!state.timeline) return state;
        const orderedVisualTracks = state.timeline.tracks
          .filter(isVisualTimelineTrack)
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        const currentIndex = orderedVisualTracks.findIndex(
          (track) => track.id === trackId,
        );
        if (currentIndex < 0) return state;
        const targetIndex =
          direction === 'up' ? currentIndex + 1 : currentIndex - 1;
        const targetTrack = orderedVisualTracks[targetIndex];
        if (!targetTrack) return state;
        const reorderedTracks = [...orderedVisualTracks];
        reorderedTracks[currentIndex] = targetTrack;
        reorderedTracks[targetIndex] = orderedVisualTracks[currentIndex]!;
        const orderByTrackId = new Map(
          reorderedTracks.map((track, index) => [track.id, index * 10]),
        );
        return withUserHistory(state, {
          timeline: {
            ...state.timeline,
            tracks: state.timeline.tracks.map((track) =>
              orderByTrackId.has(track.id)
                ? ({
                    ...track,
                    order: orderByTrackId.get(track.id)!,
                  } as VideoTimelineTrack)
                : track,
            ),
          },
        });
      }),
    splitSelectedClipAtPlayhead: (playheadMs) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        let timeline = normalizeStillImageTimelineBounds(state.timeline);
        const selectedClipIds = selectedPrimaryClipIdsForLinkedEdits(
          timeline,
          state.selectedClipIds,
        );
        if (selectedClipIds.length === 0) return state;
        const createdClipIds: string[] = [];
        const atFrame = msToFrame(playheadMs, frameRateForTimeline(timeline));

        for (const clipId of selectedClipIds) {
          try {
            const result = buildCutClipOps(
              timeline,
              { clipId, atFrame },
              { idFactory: timelineClipId },
            );
            if (result.ops.length === 0) continue;
            timeline = applyTimelineOps(timeline, result.ops).timeline;
            createdClipIds.push(...result.metadata.createdClipIds);
          } catch {
            // Other selected clips may still be valid split targets.
          }
        }

        if (createdClipIds.length === 0) return state;
        const rightClipIds = createdClipIdsAtOrAfter(timeline, createdClipIds, {
          atMs: frameToMs(atFrame, frameRateForTimeline(timeline)),
        });
        const selection = sanitizeClipSelection(
          rightClipIds.length > 0 ? rightClipIds : createdClipIds,
          timeline.tracks,
        );
        const selectedClipId = resolveSelectedClipId(selection, null);
        return withUserHistory(state, {
          timeline,
          selectedClipId,
          selectedClipIds: selection,
          lastSelectedClipId: selectedClipId,
          selectedMarkerId: null,
          selectedSeamId: null,
        });
      }),
    deleteSelectedClip: (options) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedPrimaryClipIdsForLinkedEdits(
          timeline,
          state.selectedClipIds,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildDeleteClipsOps(timeline, {
            clipIds,
            ripple: options?.ripple ?? false,
          }),
          { selection: 'clear' },
        );
      }),
    duplicateSelectedClips: () =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedEditableClipIds(
          timeline,
          state.selectedClipIds,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildDuplicateClipsOps(
            timeline,
            { clipIds },
            { idFactory: timelineClipId },
          ),
          { selection: 'created' },
        );
      }),
    insertClip: (trackId, clip) =>
      set((state) => {
        if (!state.timeline) return state;
        let changed = false;
        const tracks = state.timeline.tracks.map((track) => {
          if (track.id !== trackId || track.locked) return track;
          changed = true;
          return {
            ...track,
            clips: [...track.clips, clip],
          } as VideoTimelineTrack;
        });
        if (!changed) return state;
        return withUserHistory(state, {
          timeline: {
            ...state.timeline,
            tracks,
            durationMs: getTimelineDurationMs(tracks),
          },
          selectedClipId: clip.id,
          selectedClipIds: new Set([clip.id]),
          lastSelectedClipId: clip.id,
          selectedMarkerId: null,
          selectedSeamId: null,
        });
      }),
    removeClipsForAssets: (assetIds) =>
      set((state) => {
        if (!state.timeline) return state;
        const ids = new Set(assetIds);
        if (ids.size === 0) return state;
        let changed = false;
        const tracks = state.timeline.tracks.map((track) => {
          const clips = track.clips.filter((clip) => {
            const remove =
              clip.sourceRef.kind === 'asset' &&
              ids.has(clip.sourceRef.assetId);
            if (remove) changed = true;
            return !remove;
          }) as VideoTimelineClip[];
          return clips.length === track.clips.length
            ? track
            : ({ ...track, clips } as VideoTimelineTrack);
        });
        if (!changed) return state;
        const selectedClipIds = sanitizeClipSelection(
          state.selectedClipIds,
          tracks,
        );
        const selectedClipId = resolveSelectedClipId(
          selectedClipIds,
          state.lastSelectedClipId,
        );
        return withUserHistory(state, {
          timeline: {
            ...state.timeline,
            tracks,
            durationMs: getTimelineDurationMs(tracks),
          },
          selectedClipId,
          selectedClipIds,
          lastSelectedClipId: selectedClipId,
          selectedSeamId: null,
        });
      }),
    updateClip: (clipId, patch) =>
      set((state) => {
        if (!state.timeline) return state;
        let changed = false;
        const tracks = state.timeline.tracks.map((track) => {
          let trackChanged = false;
          const clips = track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            trackChanged = true;
            changed = true;
            return { ...clip, ...patch } as VideoTimelineClip;
          }) as VideoTimelineClip[];
          return trackChanged
            ? ({ ...track, clips } as VideoTimelineTrack)
            : track;
        });
        if (!changed) return state;
        return withUserHistory(state, {
          timeline: { ...state.timeline, tracks },
        });
      }),
    trimClip: (clipId, edge, deltaMs, baselineClip) =>
      set((state) => {
        if (!state.timeline) return state;
        const sourceTimeline = timelineWithClipBaseline(
          normalizeStillImageTimelineBounds(state.timeline),
          baselineClip,
        );
        const location = findClipLocation(sourceTimeline.tracks, clipId);
        if (!location) return state;
        const warning = editBlockedWarning(sourceTimeline.tracks, location);
        if (warning) {
          return syncLockWarningState(state, {
            ...warning,
            action: 'trim',
          });
        }
        const deltaFrames = clampTrimDeltaFrames(
          sourceTimeline,
          location.clip,
          edge,
          deltaMs,
        );
        if (deltaFrames === 0) return state;
        return applyEditBuildResult(
          state,
          sourceTimeline,
          buildTrimClipOps(sourceTimeline, {
            clipId,
            edge: edge === 'start' ? 'left' : 'right',
            deltaFrames,
          }),
          { selection: 'preserve' },
        );
      }),
    moveClip: (clipId, deltaMs, baselineClip, targetTrackId) =>
      set((state) => {
        if (!state.timeline) return state;
        const sourceTimeline = timelineWithClipBaseline(
          normalizeStillImageTimelineBounds(state.timeline),
          baselineClip,
        );
        const location = findClipLocation(sourceTimeline.tracks, clipId);
        if (!location) return state;
        const warning = editBlockedWarning(sourceTimeline.tracks, location);
        if (warning) {
          return syncLockWarningState(state, {
            ...warning,
            action: 'move',
          });
        }
        const moveIds =
          !targetTrackId &&
          state.selectedClipIds.has(clipId) &&
          state.selectedClipIds.size > 1
            ? selectedPrimaryClipIdsForLinkedEdits(
                sourceTimeline,
                state.selectedClipIds,
              )
            : [clipId];
        const rate = frameRateForTimeline(sourceTimeline);
        const builds: EditBuildResult[] = [];
        for (const moveId of moveIds) {
          const moveLocation = findClipLocation(sourceTimeline.tracks, moveId);
          if (!moveLocation) continue;
          const toMs = Math.max(
            0,
            moveLocation.clip.startMs + Math.round(deltaMs),
          );
          builds.push(
            buildMoveClipOps(sourceTimeline, {
              clipId: moveId,
              toFrame: msToFrame(toMs, rate),
              toTrackId: moveId === clipId ? targetTrackId : undefined,
            }),
          );
        }
        return applyEditBuildResult(
          state,
          sourceTimeline,
          mergeStoreEditBuildResults(builds),
          { selection: 'preserve' },
        );
      }),
    resyncLinkGroup: (linkGroupId) =>
      set((state) => {
        if (!state.timeline) return state;
        const groupLocations = findLinkGroupLocations(
          state.timeline.tracks,
          linkGroupId,
        );
        const reference = groupLocations[0]?.clip;
        if (!reference || groupLocations.length < 2) return state;
        let changed = false;
        const nextByClipId = new Map<string, VideoTimelineClip>();
        for (const { clip, track } of groupLocations) {
          if (track.locked) continue;
          const nextClip = {
            ...clip,
            startMs: reference.startMs,
            durationMs: reference.durationMs,
            trimStartMs: reference.trimStartMs,
            trimEndMs: reference.trimEndMs,
          } as VideoTimelineClip;
          if (clipsEqual(nextClip, clip)) continue;
          changed = true;
          nextByClipId.set(clip.id, nextClip);
        }
        if (!changed) return { lastEditWarning: null };
        const tracks = replaceTimelineClips(
          state.timeline.tracks,
          nextByClipId,
        );
        return withUserHistory(state, {
          timeline: {
            ...state.timeline,
            tracks,
            durationMs: getTimelineDurationMs(tracks),
          },
        });
      }),
    unlinkLinkGroup: (linkGroupId) =>
      set((state) => {
        if (!state.timeline) return state;
        const nextByClipId = new Map<string, VideoTimelineClip>();
        for (const { clip, track } of findLinkGroupLocations(
          state.timeline.tracks,
          linkGroupId,
        )) {
          if (track.locked) continue;
          nextByClipId.set(clip.id, withoutClipLinkGroup(clip));
        }
        if (nextByClipId.size === 0) return { lastEditWarning: null };
        const tracks = replaceTimelineClips(
          state.timeline.tracks,
          nextByClipId,
        );
        return withUserHistory(state, {
          timeline: { ...state.timeline, tracks },
          selectedClipIds: sanitizeClipSelection(state.selectedClipIds, tracks),
        });
      }),
    clearEditWarning: () => set({ lastEditWarning: null }),
    updateTimelineBookend: (position, durationMs) =>
      set((state) => {
        if (!state.timeline) return state;
        const nextBookend =
          durationMs == null
            ? undefined
            : ({
                kind: 'fade',
                durationMs: clamp(
                  Math.round(durationMs),
                  MIN_BOOKEND_FADE_MS,
                  MAX_BOOKEND_FADE_MS,
                ),
              } satisfies NonNullable<VideoTimeline[typeof position]>);
        const currentDurationMs = state.timeline[position]?.durationMs;
        if (
          (durationMs == null && !state.timeline[position]) ||
          currentDurationMs === nextBookend?.durationMs
        ) {
          return state;
        }
        const timeline: VideoTimeline = {
          ...state.timeline,
          [position]: nextBookend,
        };
        if (!nextBookend) delete timeline[position];
        return withUserHistory(state, {
          timeline,
        });
      }),
    selectSeam: (seamId) =>
      set((state) => {
        if (!seamId || !state.timeline) {
          return {
            selectedClipId: null,
            selectedClipIds: new Set<string>(),
            lastSelectedClipId: null,
            selectedMarkerId: null,
            selectedSeamId: null,
          };
        }
        const seam = findTimelineTransitionSeam(state.timeline, seamId);
        if (!seam) return state;
        return {
          selectedClipId: null,
          selectedClipIds: new Set<string>(),
          lastSelectedClipId: null,
          selectedMarkerId: null,
          selectedSeamId: seam.seamId,
        };
      }),
    setTransitionOnSeam: (seamId, transition) =>
      set((state) => updateTransitionOnSeam(state, seamId, transition)),
    removeTransitionFromSeam: (seamId) =>
      set((state) => updateTransitionOnSeam(state, seamId, null)),
    updateSelectedVisualClipTransition: (transition) =>
      set((state) =>
        updateSelectedVisualClip(state, (clip) => {
          const nextTransition = transition === 'cut' ? undefined : transition;
          if (videoTransitionKind(clip.transitionToNext) === transition) {
            return clip;
          }
          return { ...clip, transitionToNext: nextTransition };
        }),
      ),
    updateSelectedVisualClipAudioSeam: (mode) =>
      set((state) =>
        updateSelectedVisualClip(state, (clip) => {
          if (mode === 'follow') {
            if (!clip.audioSeamToNext) return clip;
            const nextClip = { ...clip };
            delete nextClip.audioSeamToNext;
            return nextClip;
          }
          if (clip.audioSeamToNext === mode) return clip;
          return { ...clip, audioSeamToNext: mode };
        }),
      ),
    updateSelectedVisualClipFilters: (patch) =>
      set((state) =>
        updateSelectedVisualClip(state, (clip) => {
          const nextFilters = normalizeVideoClipFilters({
            ...(clip.filters ?? {}),
            ...patch,
          });
          if (filtersEqual(clip.filters, nextFilters)) return clip;
          return { ...clip, filters: nextFilters };
        }),
      ),
    resetSelectedVisualClipFilters: () =>
      set((state) =>
        updateSelectedVisualClip(state, (clip) => {
          if (!clip.filters) return clip;
          return { ...clip, filters: undefined };
        }),
      ),
    setSelectedClipSpeed: (speed) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedEditableClipIds(
          timeline,
          state.selectedClipIds,
          isPlaybackEditableClip,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildSetClipSpeedOps(timeline, {
            clipIds,
            speed,
            timingPolicy: 'preserve-source-span',
          }),
          { selection: 'preserve' },
        );
      }),
    setSelectedClipReverse: (reverse) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedEditableClipIds(
          timeline,
          state.selectedClipIds,
          isPlaybackEditableClip,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildReverseClipOps(timeline, { clipIds, reverse }),
          { selection: 'preserve' },
        );
      }),
    setAudioClipGain: (clipId, gainDb) =>
      set((state) =>
        updateAudioClips(
          state,
          [clipId],
          (timeline, clipIds) =>
            buildSetAudioClipGainOps(timeline, { clipIds, gainDb }),
          { requireSelection: false },
        ),
      ),
    setAudioClipMute: (clipId, muted) =>
      set((state) =>
        updateAudioClips(
          state,
          [clipId],
          (timeline, clipIds) =>
            buildSetAudioClipMuteOps(timeline, { clipIds, muted }),
          { requireSelection: false },
        ),
      ),
    setAudioClipFade: (clipId, edge, durationMs, curve) =>
      set((state) =>
        updateAudioClips(
          state,
          [clipId],
          (timeline, clipIds) =>
            buildSetAudioClipFadeOps(timeline, {
              clipIds,
              edge,
              durationMs,
              curve,
            }),
          { requireSelection: false },
        ),
      ),
    setAudioVolumeKeyframes: (clipId, keys, mode) =>
      set((state) => {
        if (!state.timeline) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        return buildAndApplyEditResult(
          state,
          timeline,
          () =>
            buildSetAudioVolumeKeyframesOps(timeline, {
              clipId,
              keys,
              mode,
            }),
          { selection: 'preserve' },
        );
      }),
    setSelectedAudioClipGain: (gainDb) =>
      set((state) =>
        updateAudioClips(
          state,
          null,
          (timeline, clipIds) =>
            buildSetAudioClipGainOps(timeline, { clipIds, gainDb }),
          { requireSelection: true },
        ),
      ),
    setSelectedAudioClipMute: (muted) =>
      set((state) =>
        updateAudioClips(
          state,
          null,
          (timeline, clipIds) =>
            buildSetAudioClipMuteOps(timeline, { clipIds, muted }),
          { requireSelection: true },
        ),
      ),
    setSelectedAudioClipFade: (edge, durationMs, curve) =>
      set((state) =>
        updateAudioClips(
          state,
          null,
          (timeline, clipIds) =>
            buildSetAudioClipFadeOps(timeline, {
              clipIds,
              edge,
              durationMs,
              curve,
            }),
          { requireSelection: true },
        ),
      ),
    rotateSelectedVisualClips: (degrees, options) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedEditableClipIds(
          timeline,
          state.selectedClipIds,
          isVisualTimelineClip,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildRotateClipOps(timeline, {
            clipIds,
            degrees,
            relative: options?.relative ?? false,
          }),
          { selection: 'preserve' },
        );
      }),
    flipSelectedVisualClips: (axis) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedEditableClipIds(
          timeline,
          state.selectedClipIds,
          isVisualTimelineClip,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildFlipClipOps(timeline, {
            clipIds,
            horizontal: axis === 'horizontal',
            vertical: axis === 'vertical',
          }),
          { selection: 'preserve' },
        );
      }),
    setSelectedVisualClipTransform: (transform, options) =>
      set((state) => {
        if (!state.timeline || state.selectedClipIds.size === 0) return state;
        const timeline = normalizeStillImageTimelineBounds(state.timeline);
        const clipIds = selectedEditableClipIds(
          timeline,
          state.selectedClipIds,
          isVisualTimelineClip,
        );
        if (clipIds.length === 0) return state;
        return applyEditBuildResult(
          state,
          timeline,
          buildSetClipTransformOps(timeline, {
            clipIds,
            transform,
            merge: options?.merge ?? true,
          }),
          { selection: 'preserve' },
        );
      }),
    pasteClipboardPayload: (payload, startMs) => {
      let pasted = false;
      set((state) => {
        if (!state.timeline) return state;
        const result = pasteTimelineClipboardPayload({
          timeline: state.timeline,
          payload,
          startMs,
        });
        if (!result) return state;
        pasted = true;
        const selectedClipIds = new Set(result.insertedClipIds);
        const selectedClipId = resolveSelectedClipId(selectedClipIds, null);
        return withUserHistory(state, {
          timeline: result.timeline,
          selectedClipId,
          selectedClipIds,
          lastSelectedClipId: selectedClipId,
          selectedMarkerId: null,
          selectedSeamId: null,
        });
      });
      return pasted;
    },
    addMarker: (timeMs, label) => {
      let markerId: string | null = null;
      set((state) => {
        if (!state.timeline) return state;
        markerId = `marker-${randomUUID()}`;
        const marker: VideoTimelineMarker = {
          id: markerId,
          timeMs: Math.max(0, Math.round(timeMs)),
          label,
          color: 'blue',
        };
        const markers = [...(state.timeline.markers ?? []), marker].sort(
          compareTimelineMarkers,
        );
        return withUserHistory(state, {
          timeline: { ...state.timeline, markers },
          selectedClipId: null,
          selectedClipIds: new Set<string>(),
          lastSelectedClipId: null,
          selectedMarkerId: marker.id,
          selectedSeamId: null,
        });
      });
      return markerId;
    },
    updateMarker: (markerId, patch) =>
      set((state) => {
        if (!state.timeline?.markers?.length) return state;
        let changed = false;
        const markers = state.timeline.markers
          .map((marker) => {
            if (marker.id !== markerId) return marker;
            const nextMarker = normalizeTimelineMarker({
              ...marker,
              ...patch,
              id: marker.id,
            });
            if (timelineMarkersEqual(marker, nextMarker)) return marker;
            changed = true;
            return nextMarker;
          })
          .sort(compareTimelineMarkers);
        if (!changed) return state;
        return withUserHistory(state, {
          timeline: { ...state.timeline, markers },
          selectedMarkerId: markerId,
          selectedSeamId: null,
        });
      }),
    deleteMarker: (markerId) =>
      set((state) => {
        if (!state.timeline?.markers?.length) return state;
        const markers = state.timeline.markers.filter(
          (marker) => marker.id !== markerId,
        );
        if (markers.length === state.timeline.markers.length) return state;
        const timeline: VideoTimeline = { ...state.timeline, markers };
        if (markers.length === 0) delete timeline.markers;
        return withUserHistory(state, {
          timeline,
          selectedMarkerId:
            state.selectedMarkerId === markerId ? null : state.selectedMarkerId,
          selectedSeamId: null,
        });
      }),
    markPersisted: (projectId, revision) =>
      set((state) =>
        state.projectId === projectId
          ? { persistedRevision: Math.max(state.persistedRevision, revision) }
          : state,
      ),
    selectClip: (clipId, options) =>
      set((state) => applyClipSelection(state, clipId, options?.mode)),
    selectClips: (clipIds) =>
      set((state) => {
        if (!state.timeline) return state;
        const selectedClipIds = sanitizeClipSelection(
          new Set(clipIds),
          state.timeline.tracks,
        );
        const selectedClipId = resolveSelectedClipId(
          selectedClipIds,
          state.lastSelectedClipId,
        );
        return {
          selectedClipId,
          selectedClipIds,
          lastSelectedClipId: selectedClipId,
          selectedMarkerId: null,
          selectedSeamId: null,
        };
      }),
    selectAllClips: () =>
      set((state) => {
        if (!state.timeline) return state;
        const selectedClipIds = new Set<string>();
        for (const track of state.timeline.tracks) {
          if (track.locked) continue;
          for (const clip of track.clips) selectedClipIds.add(clip.id);
        }
        const selectedClipId = resolveSelectedClipId(
          selectedClipIds,
          state.lastSelectedClipId,
        );
        return {
          selectedClipId,
          selectedClipIds,
          lastSelectedClipId: selectedClipId,
          selectedMarkerId: null,
          selectedSeamId: null,
        };
      }),
    clearSelection: () =>
      set({
        selectedClipId: null,
        selectedClipIds: new Set<string>(),
        lastSelectedClipId: null,
        selectedMarkerId: null,
        selectedSeamId: null,
      }),
    selectMarker: (markerId) =>
      set({
        selectedClipId: null,
        selectedClipIds: new Set<string>(),
        lastSelectedClipId: null,
        selectedMarkerId: markerId,
        selectedSeamId: null,
      }),
    undoUserEdit: () =>
      set((state) => {
        if (state.userHistoryIndex <= 0) return state;
        const entry = state.userHistory[state.userHistoryIndex - 1];
        if (!entry) return state;
        return {
          ...snapshotToState(entry.before),
          userHistoryIndex: state.userHistoryIndex - 1,
          revision: state.revision + 1,
        };
      }),
    redoUserEdit: () =>
      set((state) => {
        const entry = state.userHistory[state.userHistoryIndex];
        if (!entry) return state;
        return {
          ...snapshotToState(entry.after),
          userHistoryIndex: state.userHistoryIndex + 1,
          revision: state.revision + 1,
        };
      }),
  }),
);

export function useTimelineEditorBindings() {
  return useTimelineEditorStore(
    useShallow((state) => ({
      projectId: state.projectId,
      timeline: state.timeline,
      selectedClipIds: state.selectedClipIds,
      selectedMarkerId: state.selectedMarkerId,
      selectedSeamId: state.selectedSeamId,
      lastEditWarning: state.lastEditWarning,
      latestUserEditCreatedAt:
        state.userHistory[state.userHistory.length - 1]?.createdAt ?? null,
      setProjectTimeline: state.setProjectTimeline,
      selectClip: state.selectClip,
      selectClips: state.selectClips,
      selectAllClips: state.selectAllClips,
      clearSelection: state.clearSelection,
      updateTrack: state.updateTrack,
      selectSeam: state.selectSeam,
      setTransitionOnSeam: state.setTransitionOnSeam,
      removeTransitionFromSeam: state.removeTransitionFromSeam,
      addVideoTrack: state.addVideoTrack,
      addTrack: state.addTrack,
      removeTrack: state.removeTrack,
      insertCaptionAtPlayhead: state.insertCaptionAtPlayhead,
      moveTrackLayer: state.moveTrackLayer,
      splitSelectedClipAtPlayhead: state.splitSelectedClipAtPlayhead,
      deleteSelectedClip: state.deleteSelectedClip,
      duplicateSelectedClips: state.duplicateSelectedClips,
      trimClip: state.trimClip,
      moveClip: state.moveClip,
      resyncLinkGroup: state.resyncLinkGroup,
      unlinkLinkGroup: state.unlinkLinkGroup,
      clearEditWarning: state.clearEditWarning,
      insertClip: state.insertClip,
      updateClip: state.updateClip,
      addMarker: state.addMarker,
      updateMarker: state.updateMarker,
      deleteMarker: state.deleteMarker,
      setSelectedClipSpeed: state.setSelectedClipSpeed,
      setSelectedClipReverse: state.setSelectedClipReverse,
      setAudioClipFade: state.setAudioClipFade,
      setAudioClipGain: state.setAudioClipGain,
      setAudioClipMute: state.setAudioClipMute,
      setAudioVolumeKeyframes: state.setAudioVolumeKeyframes,
      setSelectedAudioClipFade: state.setSelectedAudioClipFade,
      setSelectedAudioClipGain: state.setSelectedAudioClipGain,
      setSelectedAudioClipMute: state.setSelectedAudioClipMute,
      rotateSelectedVisualClips: state.rotateSelectedVisualClips,
      flipSelectedVisualClips: state.flipSelectedVisualClips,
      setSelectedVisualClipTransform: state.setSelectedVisualClipTransform,
      selectMarker: state.selectMarker,
      undoUserEdit: state.undoUserEdit,
      redoUserEdit: state.redoUserEdit,
      userRedoCreatedAt:
        state.userHistory[state.userHistoryIndex]?.createdAt ?? null,
      userUndoCreatedAt:
        state.userHistory[state.userHistoryIndex - 1]?.createdAt ?? null,
    })),
  );
}

function withUserHistory(
  state: TimelineEditorState,
  update: Partial<TimelineEditorState> & { timeline: VideoTimeline },
): Partial<TimelineEditorState> {
  const selectedClipId =
    update.selectedClipId === undefined
      ? state.selectedClipId
      : update.selectedClipId;
  const selectedClipIds = update.selectedClipIds ?? state.selectedClipIds;
  const lastSelectedClipId =
    update.lastSelectedClipId === undefined
      ? state.lastSelectedClipId
      : update.lastSelectedClipId;
  const selectedMarkerId =
    update.selectedMarkerId === undefined
      ? state.selectedMarkerId
      : update.selectedMarkerId;
  const selectedSeamId = sanitizeSelectedSeamId(
    update.selectedSeamId === undefined
      ? state.selectedSeamId
      : update.selectedSeamId,
    update.timeline,
  );
  const before = stateToSnapshot(state);
  const after = valuesToSnapshot({
    timeline: update.timeline,
    selectedClipId,
    selectedClipIds,
    lastSelectedClipId,
    selectedMarkerId,
    selectedSeamId,
  });
  const userHistory = [
    ...state.userHistory.slice(0, state.userHistoryIndex),
    {
      id: `edit-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      before,
      after,
    },
  ];
  while (userHistory.length > MAX_USER_HISTORY_ENTRIES) {
    userHistory.shift();
  }
  return {
    ...update,
    selectedClipId,
    selectedClipIds,
    lastSelectedClipId,
    selectedMarkerId,
    selectedSeamId,
    lastEditWarning: null,
    userHistory,
    userHistoryIndex: userHistory.length,
    revision: state.revision + 1,
  };
}

function applyEditBuildResult(
  state: TimelineEditorState,
  baseTimeline: VideoTimeline,
  result: EditBuildResult,
  options: { selection: 'preserve' | 'clear' | 'created' },
): Partial<TimelineEditorState> | TimelineEditorState {
  if (result.ops.length === 0) return state;
  let timeline: VideoTimeline;
  try {
    timeline = applyTimelineOps(baseTimeline, result.ops).timeline;
  } catch {
    return state;
  }
  if (state.timeline && timelinesEqual(state.timeline, timeline)) return state;
  if (options.selection === 'clear') {
    return withUserHistory(state, {
      timeline,
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      selectedSeamId: null,
    });
  }
  if (options.selection === 'created') {
    const selectedClipIds = sanitizeClipSelection(
      result.metadata.createdClipIds,
      timeline.tracks,
    );
    const selectedClipId = resolveSelectedClipId(selectedClipIds, null);
    return withUserHistory(state, {
      timeline,
      selectedClipId,
      selectedClipIds,
      lastSelectedClipId: selectedClipId,
      selectedMarkerId: null,
      selectedSeamId: null,
    });
  }
  return withUserHistory(state, {
    timeline,
    selectedClipIds: sanitizeClipSelection(
      state.selectedClipIds,
      timeline.tracks,
    ),
  });
}

function updateTransitionOnSeam(
  state: TimelineEditorState,
  seamId: string,
  mutation: TimelineTransitionMutation | null,
): Partial<TimelineEditorState> | TimelineEditorState {
  if (!state.timeline) return state;
  const seam = findTimelineTransitionSeam(state.timeline, seamId);
  if (!seam?.canAcceptTransition) return state;
  const nextTransition = mutation
    ? transitionMutationToTimelineTransition(
        mutation,
        seam.neighborMaxDurationMs,
      )
    : undefined;
  let changed = false;
  const tracks = state.timeline.tracks.map((track) => {
    if (track.id !== seam.trackId || !isVisualTimelineTrack(track)) {
      return track;
    }
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== seam.fromClipId) return clip;
      // Effect clips (vivid overlays) never participate in transition seams.
      if (clip.kind === 'effect') return clip;
      if (timelineTransitionsEqual(clip.transitionToNext, nextTransition)) {
        return clip;
      }
      changed = true;
      trackChanged = true;
      if (!nextTransition) {
        const nextClip = { ...clip };
        delete nextClip.transitionToNext;
        return nextClip;
      }
      return { ...clip, transitionToNext: nextTransition };
    }) as VideoTimelineClip[];
    return trackChanged ? ({ ...track, clips } as VideoTimelineTrack) : track;
  });

  const selectionUpdate = {
    selectedClipId: null,
    selectedClipIds: new Set<string>(),
    lastSelectedClipId: null,
    selectedMarkerId: null,
    selectedSeamId: seam.seamId,
  };
  if (!changed) {
    if (
      state.selectedSeamId === seam.seamId &&
      state.selectedClipIds.size === 0 &&
      !state.selectedClipId &&
      !state.selectedMarkerId
    ) {
      return state;
    }
    return selectionUpdate;
  }
  return withUserHistory(state, {
    timeline: { ...state.timeline, tracks },
    ...selectionUpdate,
  });
}

function transitionMutationToTimelineTransition(
  mutation: TimelineTransitionMutation,
  seamMaxDurationMs: number,
): VideoTimelineTransition | undefined {
  if (mutation.kind === 'cut') return undefined;
  const entry = videoTransitionRegistryEntry(mutation.kind);
  const maxDurationMs = Math.min(
    entry.maxDurationMs,
    TRANSITION_SEAM_GLOBAL_MAX_DURATION_MS,
    seamMaxDurationMs,
  );
  const durationMs = clamp(
    Math.round(mutation.durationMs ?? entry.defaultDurationMs),
    entry.minDurationMs,
    maxDurationMs,
  );
  const direction =
    mutation.direction && entry.directions.includes(mutation.direction)
      ? mutation.direction
      : undefined;
  const normalizedExtras = normalizeVideoTransition({
    kind: mutation.kind,
    params: mutation.params,
    timing: mutation.timing,
  });
  return {
    kind: mutation.kind,
    durationMs,
    ...(direction ? { direction } : {}),
    ...(normalizedExtras.params ? { params: normalizedExtras.params } : {}),
    ...(normalizedExtras.timing ? { timing: normalizedExtras.timing } : {}),
  };
}

function timelineTransitionsEqual(
  left: VideoTimelineTransition | undefined,
  right: VideoTimelineTransition | undefined,
): boolean {
  const normalizedLeft = normalizeVideoTransition(left);
  const normalizedRight = normalizeVideoTransition(right);
  return (
    normalizedLeft.kind === normalizedRight.kind &&
    normalizedLeft.durationMs === normalizedRight.durationMs &&
    normalizedLeft.direction === normalizedRight.direction &&
    transitionParamRecordsEqual(
      normalizedLeft.params,
      normalizedRight.params,
    ) &&
    transitionTimingsEqual(normalizedLeft.timing, normalizedRight.timing)
  );
}

function transitionParamRecordsEqual(
  left: Record<string, VideoTransitionParamValue> | undefined,
  right: Record<string, VideoTransitionParamValue> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, leftValue]) => {
    const rightValue = right?.[key];
    return (
      rightValue !== undefined &&
      transitionParamValueEquals(leftValue, rightValue)
    );
  });
}

function transitionTimingsEqual(
  left: VideoTransitionTiming | undefined,
  right: VideoTransitionTiming | undefined,
): boolean {
  return (
    left?.durationMs === right?.durationMs &&
    left?.easing === right?.easing &&
    left?.holdPct === right?.holdPct
  );
}

function buildAndApplyEditResult(
  state: TimelineEditorState,
  baseTimeline: VideoTimeline,
  build: () => EditBuildResult,
  options: { selection: 'preserve' | 'clear' | 'created' },
): Partial<TimelineEditorState> | TimelineEditorState {
  let result: EditBuildResult;
  try {
    result = build();
  } catch {
    return state;
  }
  return applyEditBuildResult(state, baseTimeline, result, options);
}

function updateAudioClips(
  state: TimelineEditorState,
  explicitClipIds: readonly string[] | null,
  build: (timeline: VideoTimeline, clipIds: string[]) => EditBuildResult,
  options: { requireSelection: boolean },
): Partial<TimelineEditorState> | TimelineEditorState {
  if (!state.timeline) return state;
  if (options.requireSelection && state.selectedClipIds.size === 0) {
    return state;
  }
  const timeline = normalizeStillImageTimelineBounds(state.timeline);
  const clipIds = explicitClipIds
    ? [...explicitClipIds]
    : selectedEditableClipIds(timeline, state.selectedClipIds, isAudioClip);
  if (clipIds.length === 0) return state;
  return buildAndApplyEditResult(
    state,
    timeline,
    () => build(timeline, clipIds),
    { selection: 'preserve' },
  );
}

function mergeStoreEditBuildResults(
  results: readonly EditBuildResult[],
): EditBuildResult {
  return {
    ops: results.flatMap((result) => result.ops),
    conflicts: results.flatMap((result) => result.conflicts),
    metadata: {
      affectedTrackIds: [
        ...new Set(
          results.flatMap((result) => result.metadata.affectedTrackIds),
        ),
      ],
      changedClipIds: [
        ...new Set(results.flatMap((result) => result.metadata.changedClipIds)),
      ],
      createdClipIds: [
        ...new Set(results.flatMap((result) => result.metadata.createdClipIds)),
      ],
      removedClipIds: [
        ...new Set(results.flatMap((result) => result.metadata.removedClipIds)),
      ],
      shiftedClipIds: [
        ...new Set(results.flatMap((result) => result.metadata.shiftedClipIds)),
      ],
      inspectClipIds: [
        ...new Set(results.flatMap((result) => result.metadata.inspectClipIds)),
      ],
    },
  };
}

function frameRateForTimeline(timeline: VideoTimeline): FrameRateLike {
  return timeline.frameRate ?? timeline.fps;
}

function timelineClipId(): string {
  return `clip-${randomUUID()}`;
}

function selectedEditableClipIds(
  timeline: VideoTimeline,
  selectedClipIds: Set<string>,
  predicate: (clip: VideoTimelineClip) => boolean = () => true,
): string[] {
  const clipIds: string[] = [];
  for (const track of timeline.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (selectedClipIds.has(clip.id) && predicate(clip))
        clipIds.push(clip.id);
    }
  }
  return clipIds;
}

function selectedPrimaryClipIdsForLinkedEdits(
  timeline: VideoTimeline,
  selectedClipIds: Set<string>,
): string[] {
  const clipIds: string[] = [];
  const seenLinkGroupIds = new Set<string>();
  for (const track of timeline.tracks) {
    if (track.locked || track.syncLocked) continue;
    for (const clip of track.clips) {
      if (!selectedClipIds.has(clip.id)) continue;
      if (!clip.linkGroupId) {
        clipIds.push(clip.id);
        continue;
      }
      if (seenLinkGroupIds.has(clip.linkGroupId)) continue;
      const groupLocations = findLinkGroupLocations(
        timeline.tracks,
        clip.linkGroupId,
      );
      if (
        groupLocations.some(
          (item) => item.track.locked || item.track.syncLocked,
        )
      ) {
        continue;
      }
      seenLinkGroupIds.add(clip.linkGroupId);
      clipIds.push(clip.id);
    }
  }
  return clipIds;
}

function createdClipIdsAtOrAfter(
  timeline: VideoTimeline,
  clipIds: string[],
  options: { atMs: number },
): string[] {
  const result: string[] = [];
  const selected = new Set(clipIds);
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (selected.has(clip.id) && clip.startMs >= options.atMs) {
        result.push(clip.id);
      }
    }
  }
  return result;
}

function timelineWithClipBaseline(
  timeline: VideoTimeline,
  baselineClip?: VideoTimelineClip,
): VideoTimeline {
  if (!baselineClip) return timeline;
  let changed = false;
  const tracks = timeline.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (clip.id !== baselineClip.id) return clip;
      changed = true;
      trackChanged = true;
      return normalizeStillImageClipBounds(baselineClip);
    }) as VideoTimelineClip[];
    return trackChanged ? ({ ...track, clips } as VideoTimelineTrack) : track;
  });
  return changed
    ? { ...timeline, tracks, durationMs: getTimelineDurationMs(tracks) }
    : timeline;
}

function normalizeStillImageTimelineBounds(
  timeline: VideoTimeline,
): VideoTimeline {
  let changed = false;
  const tracks = timeline.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      const nextClip = normalizeStillImageClipBounds(clip);
      if (nextClip === clip) return clip;
      changed = true;
      trackChanged = true;
      return nextClip;
    }) as VideoTimelineClip[];
    return trackChanged ? ({ ...track, clips } as VideoTimelineTrack) : track;
  });
  return changed
    ? { ...timeline, tracks, durationMs: getTimelineDurationMs(tracks) }
    : timeline;
}

function editBlockedWarning(
  tracks: VideoTimelineTrack[],
  location: TimelineClipLocation,
): Omit<TimelineEditWarning, 'kind' | 'action'> | null {
  const locations = location.clip.linkGroupId
    ? findLinkGroupLocations(tracks, location.clip.linkGroupId)
    : [location];
  const blocked = locations.filter(
    (item) => item.track.locked || item.track.syncLocked,
  );
  if (blocked.length === 0) return null;
  return {
    clipIds: locations.map((item) => item.clip.id),
    trackIds: blocked.map((item) => item.track.id),
    linkGroupId: location.clip.linkGroupId,
  };
}

function clampTrimDeltaFrames(
  timeline: VideoTimeline,
  clip: VideoTimelineClip,
  edge: TimelineTrimEdge,
  deltaMs: number,
): number {
  const roundedDeltaMs = Math.round(deltaMs);
  if (roundedDeltaMs === 0) return 0;
  const rate = frameRateForTimeline(timeline);
  const frameDelta = durationMsToFrames(Math.abs(roundedDeltaMs), rate);
  if (frameDelta === 0) return 0;
  const signedDelta =
    edge === 'start'
      ? Math.sign(roundedDeltaMs) * frameDelta
      : -Math.sign(roundedDeltaMs) * frameDelta;
  const startFrame = msToFrame(clip.startMs, rate);
  const durationFrames = durationMsToFrames(clip.durationMs, rate);
  const minDurationFrames = Math.max(
    1,
    durationMsToFrames(MIN_CLIP_DURATION_MS, rate, 'ceil'),
  );
  if (signedDelta > 0) {
    return Math.min(
      signedDelta,
      Math.max(0, durationFrames - minDurationFrames),
    );
  }

  const trimStartFrame = msToFrame(clip.trimStartMs, rate);
  const trimEndFrame = msToFrame(clip.trimEndMs, rate);
  const sourceDurationFrame = msToFrame(
    clip.kind === 'image'
      ? MAX_STILL_IMAGE_DURATION_MS
      : (clip.sourceDurationMs ?? clip.trimEndMs),
    rate,
  );
  const playback = clip.playback;
  const maxExtendFrames =
    edge === 'start'
      ? Math.min(
          startFrame,
          playback?.reverse === true
            ? Math.max(0, sourceDurationFrame - trimEndFrame)
            : trimStartFrame,
        )
      : playback?.reverse === true
        ? trimStartFrame
        : Math.max(0, sourceDurationFrame - trimEndFrame);
  return -Math.min(Math.abs(signedDelta), Math.max(0, maxExtendFrames));
}

function isPlaybackEditableClip(clip: VideoTimelineClip): boolean {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio'
  );
}

function isAudioClip(clip: VideoTimelineClip): clip is VideoAudioTimelineClip {
  return clip.kind === 'audio';
}

function stateToSnapshot(state: TimelineEditorState): TimelineEditorSnapshot {
  if (!state.timeline) {
    throw new Error('Cannot snapshot an empty timeline editor state.');
  }
  return valuesToSnapshot({
    timeline: state.timeline,
    selectedClipId: state.selectedClipId,
    selectedClipIds: state.selectedClipIds,
    lastSelectedClipId: state.lastSelectedClipId,
    selectedMarkerId: state.selectedMarkerId,
    selectedSeamId: state.selectedSeamId,
  });
}

function valuesToSnapshot({
  timeline,
  selectedClipId,
  selectedClipIds,
  lastSelectedClipId,
  selectedMarkerId,
  selectedSeamId,
}: {
  timeline: VideoTimeline;
  selectedClipId: string | null;
  selectedClipIds: Set<string>;
  lastSelectedClipId: string | null;
  selectedMarkerId: string | null;
  selectedSeamId: string | null;
}): TimelineEditorSnapshot {
  return {
    timeline: cloneTimeline(timeline),
    selectedClipId,
    selectedClipIds: [...selectedClipIds],
    lastSelectedClipId,
    selectedMarkerId,
    selectedSeamId,
  };
}

function snapshotToState(
  snapshot: TimelineEditorSnapshot,
): Partial<TimelineEditorState> {
  return {
    timeline: cloneTimeline(snapshot.timeline),
    selectedClipId: snapshot.selectedClipId,
    selectedClipIds: new Set(snapshot.selectedClipIds),
    lastSelectedClipId: snapshot.lastSelectedClipId,
    selectedMarkerId: snapshot.selectedMarkerId,
    selectedSeamId: snapshot.selectedSeamId,
    lastEditWarning: null,
  };
}

function cloneTimeline(timeline: VideoTimeline): VideoTimeline {
  return structuredClone(timeline);
}

function timelinesEqual(a: VideoTimeline, b: VideoTimeline): boolean {
  return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null) return false;
  if (typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);
  for (const key of keys) {
    if (!deepEqual(aRecord[key], bRecord[key])) return false;
  }
  return true;
}

function applyClipSelection(
  state: TimelineEditorState,
  clipId: string | null,
  mode: TimelineClipSelectionMode = 'replace',
): Partial<TimelineEditorState> | TimelineEditorState {
  if (!clipId || !state.timeline) {
    return {
      selectedClipId: null,
      selectedClipIds: new Set<string>(),
      lastSelectedClipId: null,
      selectedMarkerId: null,
      selectedSeamId: null,
    };
  }
  if (!timelineHasClip(state.timeline.tracks, clipId)) return state;

  if (mode === 'toggle') {
    const selectedClipIds = new Set(state.selectedClipIds);
    if (selectedClipIds.has(clipId)) {
      selectedClipIds.delete(clipId);
    } else {
      selectedClipIds.add(clipId);
    }
    const selectedClipId = resolveSelectedClipId(selectedClipIds, clipId);
    return {
      selectedClipId,
      selectedClipIds,
      lastSelectedClipId: selectedClipId,
      selectedMarkerId: null,
      selectedSeamId: null,
    };
  }

  if (mode === 'range') {
    const selectedClipIds = new Set(state.selectedClipIds);
    for (const id of getClipRangeIds(
      state.timeline.tracks,
      state.lastSelectedClipId,
      clipId,
    )) {
      selectedClipIds.add(id);
    }
    return {
      selectedClipId: clipId,
      selectedClipIds,
      lastSelectedClipId: clipId,
      selectedMarkerId: null,
      selectedSeamId: null,
    };
  }

  return {
    selectedClipId: clipId,
    selectedClipIds: new Set([clipId]),
    lastSelectedClipId: clipId,
    selectedMarkerId: null,
    selectedSeamId: null,
  };
}

function sanitizeClipSelection(
  clipIds: Iterable<string>,
  tracks: VideoTimelineTrack[],
): Set<string> {
  const availableClipIds = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) availableClipIds.add(clip.id);
  }
  const selection = new Set<string>();
  for (const clipId of clipIds) {
    if (availableClipIds.has(clipId)) selection.add(clipId);
  }
  return selection;
}

function sanitizeSelectedSeamId(
  seamId: string | null,
  timeline: VideoTimeline,
): string | null {
  if (!seamId) return null;
  return findTimelineTransitionSeam(timeline, seamId)?.seamId ?? null;
}

function findTimelineTransitionSeam(
  timeline: VideoTimeline,
  seamId: string,
): TimelineTransitionSeam | null {
  return (
    deriveTimelineTransitionSeams(timeline.tracks, timeline.fps).find(
      (seam) => seam.seamId === seamId,
    ) ?? null
  );
}

function resolveSelectedClipId(
  selectedClipIds: Set<string>,
  preferredClipId: string | null,
): string | null {
  if (preferredClipId && selectedClipIds.has(preferredClipId)) {
    return preferredClipId;
  }
  return selectedClipIds.values().next().value ?? null;
}

function timelineHasClip(
  tracks: VideoTimelineTrack[],
  clipId: string,
): boolean {
  return tracks.some((track) => track.clips.some((clip) => clip.id === clipId));
}

interface TimelineClipLocation {
  track: VideoTimelineTrack;
  clip: VideoTimelineClip;
  clipIndex: number;
}

function findClipLocation(
  tracks: VideoTimelineTrack[],
  clipId: string,
): TimelineClipLocation | null {
  for (const track of tracks) {
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex < 0) continue;
    return { track, clip: track.clips[clipIndex]!, clipIndex };
  }
  return null;
}

function findLinkGroupLocations(
  tracks: VideoTimelineTrack[],
  linkGroupId: string,
): TimelineClipLocation[] {
  const locations: TimelineClipLocation[] = [];
  for (const track of tracks) {
    track.clips.forEach((clip, clipIndex) => {
      if (clip.linkGroupId === linkGroupId) {
        locations.push({ track, clip, clipIndex });
      }
    });
  }
  return locations.sort(
    (a, b) =>
      a.clip.startMs - b.clip.startMs ||
      a.track.id.localeCompare(b.track.id) ||
      a.clip.id.localeCompare(b.clip.id),
  );
}

function replaceTimelineClips(
  tracks: VideoTimelineTrack[],
  nextByClipId: Map<string, VideoTimelineClip>,
): VideoTimelineTrack[] {
  return tracks.map((track) => {
    let changed = false;
    const clips = track.clips.map((clip) => {
      const nextClip = nextByClipId.get(clip.id);
      if (!nextClip) return clip;
      changed = true;
      return nextClip;
    }) as VideoTimelineClip[];
    return changed ? ({ ...track, clips } as VideoTimelineTrack) : track;
  });
}

function syncLockWarningState(
  _state: TimelineEditorState,
  warning: Omit<TimelineEditWarning, 'kind'>,
): Partial<TimelineEditorState> {
  return {
    lastEditWarning: {
      kind: 'sync-lock-conflict',
      ...warning,
      clipIds: [...new Set(warning.clipIds)],
      trackIds: [...new Set(warning.trackIds)],
    },
  };
}

function getClipRangeIds(
  tracks: VideoTimelineTrack[],
  anchorClipId: string | null,
  clipId: string,
): string[] {
  if (!anchorClipId) return [clipId];
  for (const track of tracks) {
    const sortedClips = [...track.clips].sort(compareTimelineClipOrder);
    const anchorIndex = sortedClips.findIndex(
      (clip) => clip.id === anchorClipId,
    );
    const clipIndex = sortedClips.findIndex((clip) => clip.id === clipId);
    if (anchorIndex < 0 || clipIndex < 0) continue;
    const start = Math.min(anchorIndex, clipIndex);
    const end = Math.max(anchorIndex, clipIndex);
    return sortedClips.slice(start, end + 1).map((clip) => clip.id);
  }
  return [clipId];
}

function compareTimelineClipOrder(
  a: VideoTimelineClip,
  b: VideoTimelineClip,
): number {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

function updateSelectedVisualClip(
  state: TimelineEditorState,
  update: (clip: VideoVisualTimelineClip) => VideoVisualTimelineClip,
): Partial<TimelineEditorState> | TimelineEditorState {
  if (!state.timeline || state.selectedClipIds.size === 0) return state;
  let changed = false;
  const tracks = state.timeline.tracks.map((track) => {
    if (track.locked) return track;
    let trackChanged = false;
    const clips = track.clips.map((clip) => {
      if (!state.selectedClipIds.has(clip.id) || !isVisualTimelineClip(clip)) {
        return clip;
      }
      const nextClip = update(clip);
      if (nextClip === clip) return clip;
      changed = true;
      trackChanged = true;
      return nextClip;
    }) as VideoTimelineClip[];
    return trackChanged ? ({ ...track, clips } as VideoTimelineTrack) : track;
  });
  if (!changed) return state;
  return withUserHistory(state, {
    timeline: { ...state.timeline, tracks },
  });
}

const TRACK_KIND_LABELS: Record<VideoTimelineTrack['kind'], string> = {
  video: 'Video',
  broll: 'B-roll',
  overlay: 'Overlay',
  'audio-vo': 'Narration',
  'audio-music': 'Music',
  'audio-sfx': 'SFX',
  caption: 'Captions',
};

function buildTrackByKind(
  tracks: VideoTimelineTrack[],
  kind: VideoTimelineTrack['kind'],
): VideoTimelineTrack {
  const sameKindCount = tracks.filter((track) => track.kind === kind).length;
  // Order within the same lane family (visual / audio / caption) so adding a
  // new audio track does not push a video track to the bottom of the stack.
  const lanePeers = tracks.filter(
    (track) =>
      isVisualTimelineTrack(track) ===
      (kind === 'video' || kind === 'broll' || kind === 'overlay'),
  );
  const maxOrder = lanePeers.reduce(
    (max, track) => Math.max(max, track.order),
    -10,
  );
  const id = `track-${kind}-${randomUUID()}`;
  const name = `${TRACK_KIND_LABELS[kind]} ${sameKindCount + 1}`;
  const order = maxOrder + 10;
  const common = {
    id,
    name,
    muted: false,
    locked: false,
    order,
    clips: [],
  } as const;
  if (kind === 'video' || kind === 'broll' || kind === 'overlay') {
    return {
      ...common,
      kind,
      hidden: false,
      clips: [],
    } as VideoVisualTimelineTrack;
  }
  if (kind === 'audio-vo' || kind === 'audio-music' || kind === 'audio-sfx') {
    return {
      ...common,
      kind,
      clips: [],
    } as VideoTimelineTrack;
  }
  return {
    ...common,
    kind: 'caption',
    clips: [],
  } as VideoTimelineTrack;
}

function isVisualTimelineClip(
  clip: VideoTimelineClip,
): clip is VideoVisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function withoutClipLinkGroup(clip: VideoTimelineClip): VideoTimelineClip {
  const { linkGroupId: _removedLinkGroupId, ...nextClip } = clip;
  return nextClip as VideoTimelineClip;
}

function normalizeStillImageClipBounds(
  clip: VideoTimelineClip,
): VideoTimelineClip {
  if (clip.kind !== 'image') return clip;
  const virtualSourceEndMs = Math.max(
    clip.trimEndMs,
    clip.trimStartMs + clip.durationMs,
    clip.sourceDurationMs ?? 0,
  );
  if (
    clip.trimEndMs >= clip.trimStartMs + clip.durationMs &&
    (clip.sourceDurationMs ?? virtualSourceEndMs) >= virtualSourceEndMs
  ) {
    return clip;
  }
  return {
    ...clip,
    trimEndMs: virtualSourceEndMs,
    sourceDurationMs: virtualSourceEndMs,
  };
}

function getTimelineDurationMs(tracks: VideoTimelineTrack[]): number {
  return tracks.reduce(
    (maxEndMs, track) =>
      Math.max(
        maxEndMs,
        ...track.clips.map((clip) => clip.startMs + clip.durationMs),
      ),
    0,
  );
}

function normalizeTimelineMarker(
  marker: VideoTimelineMarker,
): VideoTimelineMarker {
  return {
    ...marker,
    timeMs: Math.max(0, Math.round(marker.timeMs)),
    label: marker.label.trim(),
    comment: marker.comment?.trim() || undefined,
  };
}

function compareTimelineMarkers(
  a: VideoTimelineMarker,
  b: VideoTimelineMarker,
): number {
  return a.timeMs - b.timeMs || a.id.localeCompare(b.id);
}

function timelineMarkersEqual(
  a: VideoTimelineMarker,
  b: VideoTimelineMarker,
): boolean {
  return (
    a.timeMs === b.timeMs &&
    a.label === b.label &&
    a.color === b.color &&
    a.isChapter === b.isChapter &&
    a.comment === b.comment
  );
}

function clipsEqual(a: VideoTimelineClip, b: VideoTimelineClip): boolean {
  return (
    a.startMs === b.startMs &&
    a.durationMs === b.durationMs &&
    a.trimStartMs === b.trimStartMs &&
    a.trimEndMs === b.trimEndMs
  );
}

function filtersEqual(
  a: VideoClipFilters | undefined,
  b: VideoClipFilters | undefined,
): boolean {
  return (
    (a?.brightness ?? 1) === (b?.brightness ?? 1) &&
    (a?.contrast ?? 1) === (b?.contrast ?? 1) &&
    (a?.saturation ?? 1) === (b?.saturation ?? 1) &&
    (a?.hueRotateDeg ?? 0) === (b?.hueRotateDeg ?? 0) &&
    (a?.blurPx ?? 0) === (b?.blurPx ?? 0) &&
    (a?.grayscale ?? 0) === (b?.grayscale ?? 0) &&
    (a?.sepia ?? 0) === (b?.sepia ?? 0)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
