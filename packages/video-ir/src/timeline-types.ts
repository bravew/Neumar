import type { FrameRate } from './timebase.js';
import type { TransitionTiming } from './transition-params.js';

export type TimelineSchemaId = 'neuma.video.timeline.v1';

export type TimelineTrackKind =
  | 'video'
  | 'broll'
  | 'audio-vo'
  | 'audio-music'
  | 'audio-sfx'
  | 'caption'
  | 'overlay';

export type TimelineClipKind =
  | 'video'
  | 'image'
  | 'audio'
  | 'caption'
  | 'overlay'
  | 'effect';

export type TimelineTransitionKind =
  | 'cut'
  | 'fade'
  | 'slide'
  | 'wipe'
  | 'iris'
  | 'dissolve'
  | 'soft-wipe'
  | 'pixelize'
  | 'polygon-iris'
  | 'cover'
  | 'reveal'
  | 'flip'
  | 'clock-wipe'
  | 'cube'
  | 'zoom-blur'
  | 'zoom-in-out';

export type TimelineTransitionDirection =
  | 'from-left'
  | 'from-right'
  | 'from-top'
  | 'from-bottom';

export interface TimelineTransitionSpec {
  kind: TimelineTransitionKind;
  durationMs?: number;
  direction?: TimelineTransitionDirection;
  timing?: TransitionTiming;
  seam?: TimelineTransitionSeam;
  params?: Record<string, unknown>;
  source?: TimelineTransitionSource;
}

export type TimelineTransition =
  | TimelineTransitionKind
  | TimelineTransitionSpec;

export interface TimelineTransitionSeam {
  timeMs?: number;
  sourceClipId?: string;
  targetClipId?: string;
  label?: string;
}

export type TimelineTransitionSource =
  | { kind: 'builtin'; id: string }
  | { kind: 'glsl'; source: string };

export type TimelineMarkerColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple';

export interface TimelineMarker {
  id: string;
  timeMs: number;
  label: string;
  color?: TimelineMarkerColor;
  isChapter?: boolean;
  comment?: string;
}

export type TimelineSourceRef =
  | { kind: 'asset'; assetId: string }
  | { kind: 'linked'; sourceId: string; externalId: string }
  | { kind: 'scene'; sceneId: string };

export type KeyframeInterpolation = 'hold' | 'linear' | 'smooth';

export interface Keyframe {
  atMs: number;
  value: number;
  interp?: KeyframeInterpolation;
}

export type KeyframeableProperty =
  | 'opacity'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'positionX'
  | 'positionY'
  | 'rotation'
  | 'cropTop'
  | 'cropRight'
  | 'cropBottom'
  | 'cropLeft'
  | 'volumeDb'
  | 'textOpacity'
  | 'textScale';

export interface KeyframeTrack {
  property: KeyframeableProperty;
  keys: Keyframe[];
}

export interface Timeline {
  schema: TimelineSchemaId;
  tracks: TimelineTrack[];
  durationMs: number;
  fps: number;
  frameRate?: FrameRate;
  markers?: TimelineMarker[];
  intro?: TimelineBookend;
  outro?: TimelineBookend;
  migration?: {
    from: 'storyboard';
    version: number;
  };
}

export interface TimelineBookend {
  kind: 'fade';
  durationMs: number;
}

export type TimelineTrack =
  | VisualTimelineTrack
  | AudioTimelineTrack
  | CaptionTimelineTrack;

interface BaseTimelineTrack {
  id: string;
  kind: TimelineTrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  syncLocked?: boolean;
  order: number;
  clips: TimelineClip[];
}

export interface VisualTimelineTrack extends BaseTimelineTrack {
  kind: 'video' | 'broll' | 'overlay';
  hidden?: boolean;
  // Effect clips (vivid overlays) are runtime-restricted to `overlay` tracks;
  // the ops layer and Zod schema enforce that, the TS union stays shared.
  clips: Array<VisualTimelineClip | EffectTimelineClip>;
}

export interface AudioTimelineTrack extends BaseTimelineTrack {
  kind: 'audio-vo' | 'audio-music' | 'audio-sfx';
  volumeDb?: number;
  duckUnderTrackId?: string;
  clips: AudioTimelineClip[];
}

export interface CaptionTimelineTrack extends BaseTimelineTrack {
  kind: 'caption';
  clips: CaptionTimelineClip[];
}

export type TimelineClip =
  | VisualTimelineClip
  | AudioTimelineClip
  | CaptionTimelineClip
  | EffectTimelineClip;

interface BaseTimelineClip {
  id: string;
  kind: TimelineClipKind;
  name?: string;
  sourceRef: TimelineSourceRef;
  sceneId?: string;
  linkGroupId?: string;
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  sourceDurationMs?: number;
  playback?: ClipPlayback;
  params?: Record<string, unknown>;
  keyframes?: KeyframeTrack[];
}

export interface VisualTimelineClip extends BaseTimelineClip {
  kind: 'video' | 'image' | 'overlay';
  transforms?: ClipTransform;
  transitionToNext?: TimelineTransition;
  audioSeamToNext?: 'follow' | 'cut';
  filters?: ClipFilters;
  muted?: boolean;
}

export type AudioFadeCurve = 'linear' | 'equal-power' | 'ease-in-out';

export interface AudioTransitionSpec {
  kind: 'cut' | 'crossfade';
  durationMs: number;
  curve?: AudioFadeCurve;
}

export interface AudioTimelineClip extends BaseTimelineClip {
  kind: 'audio';
  gainDb?: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
  audioTransitionToNext?: AudioTransitionSpec;
  transcriptText?: string;
}

export interface CaptionTimelineClip extends BaseTimelineClip {
  kind: 'caption';
  captionGroupId?: string;
  text: string;
  tokens?: CaptionToken[];
  style?: SubtitleStyle;
}

export interface EffectTimelineClip extends BaseTimelineClip {
  kind: 'effect';
  effectType: string;
  transforms?: ClipTransform;
}

export interface ClipTransform {
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  positionX?: number;
  positionY?: number;
  opacity?: number;
  rotation?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'blur-pad';
  background?: string;
  crop?: { top: number; right: number; bottom: number; left: number };
}

export interface ClipFilters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hueRotateDeg?: number;
  blurPx?: number;
  grayscale?: number;
  sepia?: number;
}

export interface SubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  position?: 'top' | 'middle' | 'bottom';
  animation?: 'none' | 'tiktok-word' | 'hormozi-bold' | 'classic' | 'karaoke';
}

export interface CaptionToken {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface ClipTimingState {
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
}

export type ClipInterpolationQuality = 'low' | 'medium' | 'high';

export interface ClipPlayback {
  speed: number;
  reverse: boolean;
  pitchCorrection?: boolean;
  smoothSlowMo?: boolean;
  interpolationQuality?: ClipInterpolationQuality;
}

export type ClipPlaybackTimingPolicy =
  | 'preserve-source-span'
  | 'preserve-timeline-duration';

export type TimelineHistorySource = 'user' | 'agent' | 'system';

export interface TimelineHistoryEntry {
  id: string;
  ts: string;
  op: TimelineHistoryOperation;
  inverse: TimelineHistoryOperation;
  source: TimelineHistorySource;
  summary?: string;
  undone?: boolean;
}

export type TimelineHistoryOperation = TimelineOp | TimelineOpBatch;

export interface TimelineOpBatch {
  kind: 'timeline.batch';
  ops: TimelineOp[];
}

export type TimelineOp =
  | ClipInsertOp
  | ClipRemoveOp
  | ClipRemoveTimeRangeOp
  | ClipLinkOp
  | ClipUnlinkOp
  | ClipSetLinkGroupOp
  | ClipMoveOp
  | ClipTrimOp
  | ClipExtendOp
  | ClipSplitOp
  | ClipMergeOp
  | ClipSetTransitionOp
  | ClipSetAudioOp
  | ClipSetAudioTransitionOp
  | ClipSetTransformOp
  | ClipSetFiltersOp
  | ClipSetParamsOp
  | ClipSetPlaybackOp
  | KeyframeUpsertOp
  | KeyframeRemoveOp
  | KeyframeSetTrackOp
  | CaptionSplitAtTimeOp
  | CaptionMergeSiblingOp
  | CaptionRegroupOp
  | CaptionSetTokenTextOp
  | TrackInsertOp
  | TrackRemoveOp
  | TrackUpdateOp
  | MarkerUpsertOp
  | MarkerRemoveOp;

export interface ClipInsertOp {
  kind: 'clip.insert';
  trackId: string;
  clip: TimelineClip;
  at: number;
  magnetic?: boolean;
}

export interface ClipRemoveOp {
  kind: 'clip.remove';
  clipId: string;
  snapshot?: TimelineClip;
  magnetic?: boolean;
}

export interface ClipRemoveTimeRangeOp {
  kind: 'clip.removeTimeRange';
  trackId?: string;
  startMs: number;
  endMs: number;
  magnetic?: boolean;
  before?: TimelineClip[];
  after?: TimelineClip[];
}

export interface ClipLinkState {
  clipId: string;
  linkGroupId?: string;
}

export interface ClipLinkOp {
  kind: 'clip.link';
  clipIds: string[];
  linkGroupId: string;
  before?: ClipLinkState[];
}

export interface ClipUnlinkOp {
  kind: 'clip.unlink';
  linkGroupId: string;
  before?: Array<{ clipId: string; linkGroupId: string }>;
}

/**
 * Restores each listed clip's link-group membership to an exact value
 * (omitting `linkGroupId` clears membership). Used as the invertible vehicle
 * for `clip.link`/`clip.unlink` undo, where per-clip restoration is required
 * and `clip.link`'s two-clip minimum cannot express a single-clip restore.
 */
export interface ClipSetLinkGroupOp {
  kind: 'clip.setLinkGroup';
  assignments: ClipLinkState[];
  before?: ClipLinkState[];
}

export interface ClipMoveOp {
  kind: 'clip.move';
  clipId: string;
  from: { trackId: string; startMs: number };
  to: { trackId: string; startMs: number };
  magnetic?: boolean;
}

export interface ClipTrimOp {
  kind: 'clip.trim';
  clipId: string;
  from: ClipTimingState;
  to: ClipTimingState;
  magnetic?: boolean;
}

export interface ClipExtendOp {
  kind: 'clip.extend';
  clipId: string;
  deltaMs: number;
  magnetic?: boolean;
}

export interface ClipSplitOp {
  kind: 'clip.split';
  clipId: string;
  at: number;
  before: TimelineClip;
  after: [TimelineClip, TimelineClip];
}

export interface ClipMergeOp {
  kind: 'clip.merge';
  removeClipIds: [string, string];
  clip: TimelineClip;
}

export interface ClipSetTransitionOp {
  kind: 'clip.setTransition';
  clipId: string;
  before: TimelineTransition | null;
  after: TimelineTransition | null;
}

export interface AudioClipAudioPatch {
  gainDb?: number | null;
  muted?: boolean | null;
  fadeInMs?: number | null;
  fadeOutMs?: number | null;
  fadeInCurve?: AudioFadeCurve | null;
  fadeOutCurve?: AudioFadeCurve | null;
}

export interface ClipSetAudioOp {
  kind: 'clip.setAudio';
  clipId: string;
  before: AudioClipAudioPatch;
  after: AudioClipAudioPatch;
}

export interface ClipSetAudioTransitionOp {
  kind: 'clip.setAudioTransition';
  clipId: string;
  before: AudioTransitionSpec | null;
  after: AudioTransitionSpec | null;
}

export interface ClipSetTransformOp {
  kind: 'clip.setTransform';
  clipId: string;
  before: ClipTransform | null;
  after: ClipTransform | null;
}

export interface ClipSetFiltersOp {
  kind: 'clip.setFilters';
  clipId: string;
  before: ClipFilters | null;
  after: ClipFilters | null;
}

/**
 * Replace a clip's `params` bag (full before/after snapshots, so the op is
 * self-inverting like clip.setTransform). Vivid-overlay clips reject payloads
 * that don't parse as VividOverlayParams — a bad merge must not brick the
 * clip's renderer.
 */
export interface ClipSetParamsOp {
  kind: 'clip.setParams';
  clipId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ClipSetPlaybackOp {
  kind: 'clip.setPlayback';
  clipId: string;
  before: ClipPlayback | null;
  after: ClipPlayback | null;
  timingPolicy?: ClipPlaybackTimingPolicy;
}

export interface KeyframeUpsertOp {
  kind: 'keyframe.upsert';
  clipId: string;
  property: KeyframeableProperty;
  key: Keyframe;
  before?: Keyframe | null;
}

export interface KeyframeRemoveOp {
  kind: 'keyframe.remove';
  clipId: string;
  property: KeyframeableProperty;
  atMs: number;
  snapshot: Keyframe;
}

export interface KeyframeSetTrackOp {
  kind: 'keyframe.setTrack';
  clipId: string;
  property: KeyframeableProperty;
  before: KeyframeTrack | null;
  after: KeyframeTrack | null;
}

export interface CaptionSplitAtTimeOp {
  kind: 'caption.splitAtTime';
  clipId: string;
  at: number;
  before: CaptionTimelineClip;
  after: [CaptionTimelineClip, CaptionTimelineClip];
}

export interface CaptionMergeSiblingOp {
  kind: 'caption.mergeSibling';
  removeClipIds: [string, string];
  clip: CaptionTimelineClip;
}

export interface CaptionRegroupOp {
  kind: 'caption.regroup';
  trackId: string;
  before: CaptionTimelineClip[];
  after: CaptionTimelineClip[];
}

export interface CaptionSetTokenTextOp {
  kind: 'caption.setTokenText';
  clipId: string;
  tokenId: string;
  before: string;
  after: string;
}

export interface TrackInsertOp {
  kind: 'track.insert';
  track: TimelineTrack;
  index: number;
}

export interface TrackRemoveOp {
  kind: 'track.remove';
  trackId: string;
  snapshot?: TimelineTrack;
  index?: number;
}

export interface TrackUpdatePatch {
  name?: string;
  muted?: boolean;
  locked?: boolean;
  syncLocked?: boolean | null;
  order?: number;
  volumeDb?: number | null;
  duckUnderTrackId?: string | null;
}

export interface TrackUpdateOp {
  kind: 'track.update';
  trackId: string;
  before: TrackUpdatePatch;
  after: TrackUpdatePatch;
}

export interface MarkerUpsertOp {
  kind: 'marker.upsert';
  marker: TimelineMarker;
  before?: TimelineMarker | null;
}

export interface MarkerRemoveOp {
  kind: 'marker.remove';
  markerId: string;
  snapshot?: TimelineMarker;
}
