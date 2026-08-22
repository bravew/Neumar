import {
  compactResolvedTransitionParams,
  resolveTransitionParams,
  TRANSITION_EASINGS,
  type TransitionParamDef,
  type TransitionParamValue,
  type TransitionTiming,
  type TransitionTimingDefs,
  AudioFadeCurve,
  AudioTransitionSpec,
  ClipPlayback,
  ClipEffectStack,
  FrameRate,
  KeyframeTrack,
  TimelineHistoryEntry,
  TimelineOp,
} from '@neumar/video-ir';

export type VideoTemplateId =
  | 'product-reel'
  | 'explainer'
  | 'slideshow'
  | 'podcast'
  | 'ugc-ad'
  | 'custom';

export type VideoAudioFadeCurve = AudioFadeCurve;
export type VideoAudioTransitionSpec = AudioTransitionSpec;

export interface VideoProject {
  /** Project document schema version; absent means v1 and is migrated on load. */
  schemaVersion?: 2;
  id: string;
  name: string;
  template: VideoTemplateId;
  templateSnapshot?: VideoProjectTemplateSnapshot;
  prompt: string;
  script?: string;
  brandKit?: VideoBrandKit;
  assets: VideoMediaItem[];
  sources?: VideoSourceMedia[];
  linkedSources?: VideoLinkedSource[];
  sourceAnalyses?: VideoSourceAnalysis[];
  cutPlans?: VideoCutPlan[];
  analysisArtifacts?: VideoAnalysisArtifact[];
  storyboard?: VideoStoryboard;
  scenes?: VideoScene[];
  timeline?: VideoTimeline;
  history?: VideoTimelineHistory;
  agentJournal?: VideoAgentJournalEntry[];
  renderPlan?: VideoRenderPlan;
  settings?: VideoProjectSettings;
  render?: {
    status: string;
    outputPath?: string;
    progress?: number;
    message?: string;
    where?: 'local' | 'cloud';
    provider?: string;
    taskId?: string;
    transitions?: {
      degraded: VideoTransitionDegradation[];
    };
    cache?: {
      sceneHits: number;
      sceneMisses: number;
    };
    updatedAt?: string;
  };
  budget?: { capUsd: number; spentUsd: number };
  outputs?: VideoRenderOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface VideoTimelineHistory {
  head: number;
  entries: TimelineHistoryEntry[];
}

export interface VideoProjectTemplateSnapshot {
  id: string;
  displayName: string;
  version: number;
  source: 'builtin' | 'community' | 'custom';
  storyboardSeed: unknown;
}

export interface VideoProjectListItem {
  id: string;
  name: string;
  template: VideoTemplateId;
  updatedAt: string;
  renderStatus: string;
  hasOutput: boolean;
  posterPath?: string;
  qaWarningCount?: number;
}

export interface VideoBrandKit {
  logos?: string[];
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  watermarkPosition?: 'tl' | 'tr' | 'bl' | 'br' | 'none';
}

export interface VideoProjectSettings {
  autoApproveStoryboard?: boolean;
  autoApproveUnderCents?: number;
  agentEdits?: 'proposal-only' | 'apply';
  captionsRenderer?: 'remotion' | 'ffmpeg-ass' | 'auto';
  renderCaptionMode?: VideoCaptionRenderMode;
  defaultRenderMode?: 'speed' | 'reproducible';
  defaultAspectRatios?: VideoAspectRatio[];
  renderWhere?: 'local' | 'cloud';
  cloudRenderProviderId?: string;
  cloudRenderConsents?: Record<
    string,
    { confirmed: boolean; confirmedAt: string }
  >;
  musicProviderId?: 'elevenlabs-music' | 'stable-audio';
  musicProviderModel?: string;
  loudnessTargetLufs?: VideoLoudnessTargetSetting;
  autoColorEnabled?: boolean;
  autoReframeEnabled?: boolean;
  mcpEnabled?: boolean;
}

export interface VideoTranscriptSelectionContext {
  sceneId?: string;
  clipId?: string;
  sourceId?: string;
  startMs: number;
  endMs: number;
  text: string;
  source?: 'word' | 'proportional';
  degraded?: boolean;
  wordStartIndex?: number;
  wordEndIndex?: number;
}

export interface VideoEditorSelectionContext {
  playheadMs?: number;
  selectedClipIds?: string[];
  previewFrame?: {
    atMs: number;
    sceneId?: string;
    clipId?: string;
    aspectRatio?: VideoAspectRatio;
    source: 'timeline-preview';
  };
  /** Which inspector the user has open, so the agent can target it. */
  activePanel?: {
    kind: 'clip-inspector';
    clipId: string;
    tab?: string;
  };
}

export type VideoAnalysisArtifactKind =
  | 'silence-ranges'
  | 'beat-markers'
  | 'highlight-ranges'
  | 'transcript-ranges'
  | 'clip-timings'
  | 'custom';

export interface VideoAnalysisArtifact {
  id: string;
  kind: VideoAnalysisArtifactKind;
  sourceMediaId?: string;
  contentHash?: string;
  summary?: string;
  ranges?: VideoAnalysisRange[];
  proposedActionBatch?: {
    id?: string;
    summary?: string;
    ops: TimelineOp[];
  };
  metadata?: Record<string, unknown>;
  generatedAt: string;
}

export interface VideoAnalysisRange {
  id?: string;
  startMs: number;
  endMs: number;
  label?: string;
  confidence?: number;
}

export type VideoTimelineTrackKind =
  | 'video'
  | 'broll'
  | 'audio-vo'
  | 'audio-music'
  | 'audio-sfx'
  | 'caption'
  | 'overlay';

export type VideoTimelineClipKind =
  | 'video'
  | 'image'
  | 'audio'
  | 'caption'
  | 'overlay'
  | 'effect';

export type VideoTransitionKind =
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

export type VideoTransitionDirection =
  | 'from-left'
  | 'from-right'
  | 'from-top'
  | 'from-bottom';

export type VideoRenderPath = 'remotion' | 'ffmpeg';
export type VideoTransitionTier = 'tier-1' | 'tier-1.5' | 'tier-2';
export type VideoTransitionPresetGroup =
  | 'subtle'
  | 'motion'
  | 'wipe'
  | 'stylized';
export type VideoTransitionPreviewSupport = 'native' | 'fallback' | 'none';
export type VideoTransitionRecommendedUse =
  | 'general'
  | 'scene-change'
  | 'social'
  | 'slideshow';
export type VideoTransitionTiming = TransitionTiming;
export type VideoTransitionParamValue = TransitionParamValue;
export type VideoTransitionParamDef = TransitionParamDef;
export type VideoTransitionTimingDefs = TransitionTimingDefs;

export interface VideoTransitionSpec {
  kind: VideoTransitionKind;
  durationMs?: number;
  direction?: VideoTransitionDirection;
  timing?: VideoTransitionTiming;
  params?: Record<string, unknown>;
}

export interface NormalizedVideoTransitionSpec extends Omit<
  VideoTransitionSpec,
  'params'
> {
  params?: Record<string, VideoTransitionParamValue>;
}

export type VideoTimelineTransition = VideoTransitionKind | VideoTransitionSpec;

export interface VideoTransitionCapability {
  kind: VideoTransitionKind;
  tier: VideoTransitionTier;
  native: VideoRenderPath[];
  fallbackFor: Partial<Record<VideoRenderPath, VideoTransitionKind | null>>;
  directions: VideoTransitionDirection[];
  labelKey: `transitions.${string}`;
  group: VideoTransitionPresetGroup;
  descriptionKey: `transitions.${string}`;
  defaultDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  webglPreview: VideoTransitionPreviewSupport;
  recommendedUse: VideoTransitionRecommendedUse;
  paramDefs?: readonly VideoTransitionParamDef[];
  timingDefs?: VideoTransitionTimingDefs;
}

export interface VideoTransitionDegradation {
  seamIndex: number;
  requestedKind: VideoTransitionKind;
  fallbackKind: VideoTransitionKind;
  renderer: VideoRenderPath;
  projectId?: string;
  unsupportedParams?: string[];
}

const ALL_DIRECTIONS: VideoTransitionDirection[] = [
  'from-left',
  'from-right',
  'from-top',
  'from-bottom',
];

const CLOCK_WIPE_PARAM_DEFS = [
  {
    key: 'startAngle',
    type: 'number',
    valueKind: 'float',
    defaultValue: 90,
    min: 0,
    max: 360,
    step: 1,
    unit: 'deg',
    labelKey: 'transitions.clockWipeStartAngle',
  },
  {
    key: 'sectors',
    type: 'number',
    valueKind: 'int',
    defaultValue: 1,
    min: 1,
    max: 24,
    step: 1,
    labelKey: 'transitions.clockWipeSectors',
  },
  {
    key: 'feather',
    type: 'number',
    valueKind: 'float',
    defaultValue: 0.015,
    min: 0,
    max: 0.25,
    step: 0.005,
    unit: 'pct',
    labelKey: 'transitions.clockWipeFeather',
  },
  {
    key: 'center',
    type: 'vec2',
    defaultValue: [0.5, 0.5],
    min: 0,
    max: 1,
    labelKey: 'transitions.clockWipeCenter',
  },
  {
    key: 'edgeColor',
    type: 'color',
    defaultValue: [1, 1, 1, 1],
    labelKey: 'transitions.clockWipeEdgeColor',
  },
  {
    key: 'sweep',
    type: 'enum',
    defaultValue: 'clockwise',
    options: ['clockwise', 'counterclockwise'],
    labelKey: 'transitions.clockWipeSweep',
  },
] as const satisfies readonly VideoTransitionParamDef[];

const CLOCK_WIPE_TIMING_DEFS = {
  easingOptions: TRANSITION_EASINGS,
  defaultEasing: 'ease-in-out',
  allowHoldPct: true,
} as const satisfies VideoTransitionTimingDefs;

const SOFT_WIPE_PARAM_DEFS = [
  {
    key: 'angle',
    type: 'number',
    valueKind: 'float',
    defaultValue: 0,
    min: 0,
    max: 360,
    step: 1,
    unit: 'deg',
    labelKey: 'transitions.softWipeAngle',
  },
  {
    key: 'softness',
    type: 'number',
    valueKind: 'float',
    defaultValue: 0.08,
    min: 0,
    max: 0.5,
    step: 0.01,
    unit: 'pct',
    labelKey: 'transitions.softWipeSoftness',
  },
  {
    key: 'reverse',
    type: 'boolean',
    defaultValue: false,
    labelKey: 'transitions.softWipeReverse',
  },
] as const satisfies readonly VideoTransitionParamDef[];

const PIXELIZE_PARAM_DEFS = [
  {
    key: 'squaresMin',
    type: 'vec2',
    defaultValue: [20, 20],
    min: 2,
    max: 80,
    labelKey: 'transitions.pixelizeSquares',
  },
  {
    key: 'steps',
    type: 'number',
    valueKind: 'int',
    defaultValue: 50,
    min: 0,
    max: 100,
    step: 1,
    labelKey: 'transitions.pixelizeSteps',
  },
] as const satisfies readonly VideoTransitionParamDef[];

const POLYGON_IRIS_PARAM_DEFS = [
  {
    key: 'sides',
    type: 'number',
    valueKind: 'int',
    defaultValue: 6,
    min: 3,
    max: 12,
    step: 1,
    labelKey: 'transitions.polygonIrisSides',
  },
  {
    key: 'rotation',
    type: 'number',
    valueKind: 'float',
    defaultValue: 0,
    min: 0,
    max: 360,
    step: 1,
    unit: 'deg',
    labelKey: 'transitions.polygonIrisRotation',
  },
  {
    key: 'center',
    type: 'vec2',
    defaultValue: [0.5, 0.5],
    min: 0,
    max: 1,
    labelKey: 'transitions.polygonIrisCenter',
  },
  {
    key: 'feather',
    type: 'number',
    valueKind: 'float',
    defaultValue: 0.015,
    min: 0,
    max: 0.25,
    step: 0.005,
    unit: 'pct',
    labelKey: 'transitions.polygonIrisFeather',
  },
] as const satisfies readonly VideoTransitionParamDef[];

export const VIDEO_TRANSITION_REGISTRY = [
  {
    kind: 'cut',
    tier: 'tier-1',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: [],
    labelKey: 'transitions.cut',
    group: 'subtle',
    descriptionKey: 'transitions.cutDescription',
    defaultDurationMs: 33,
    minDurationMs: 33,
    maxDurationMs: 33,
    webglPreview: 'none',
    recommendedUse: 'general',
  },
  {
    kind: 'fade',
    tier: 'tier-1',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: [],
    labelKey: 'transitions.fade',
    group: 'subtle',
    descriptionKey: 'transitions.fadeDescription',
    defaultDurationMs: 500,
    minDurationMs: 33,
    maxDurationMs: 3000,
    webglPreview: 'native',
    recommendedUse: 'scene-change',
  },
  {
    kind: 'slide',
    tier: 'tier-1',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: ALL_DIRECTIONS,
    labelKey: 'transitions.slide',
    group: 'motion',
    descriptionKey: 'transitions.slideDescription',
    defaultDurationMs: 500,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'slideshow',
  },
  {
    kind: 'wipe',
    tier: 'tier-1',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: ALL_DIRECTIONS,
    labelKey: 'transitions.wipe',
    group: 'wipe',
    descriptionKey: 'transitions.wipeDescription',
    defaultDurationMs: 500,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'slideshow',
  },
  {
    kind: 'iris',
    tier: 'tier-1.5',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: [],
    labelKey: 'transitions.iris',
    group: 'wipe',
    descriptionKey: 'transitions.irisDescription',
    defaultDurationMs: 600,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'slideshow',
  },
  {
    kind: 'dissolve',
    tier: 'tier-1.5',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: [],
    labelKey: 'transitions.dissolve',
    group: 'subtle',
    descriptionKey: 'transitions.dissolveDescription',
    defaultDurationMs: 700,
    minDurationMs: 33,
    maxDurationMs: 3000,
    webglPreview: 'native',
    recommendedUse: 'scene-change',
  },
  {
    kind: 'soft-wipe',
    tier: 'tier-1.5',
    native: ['remotion'],
    fallbackFor: { ffmpeg: 'wipe' },
    directions: [],
    labelKey: 'transitions.softWipe',
    group: 'wipe',
    descriptionKey: 'transitions.softWipeDescription',
    defaultDurationMs: 600,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'slideshow',
    paramDefs: SOFT_WIPE_PARAM_DEFS,
  },
  {
    kind: 'pixelize',
    tier: 'tier-1.5',
    native: ['ffmpeg'],
    fallbackFor: { remotion: 'dissolve' },
    directions: [],
    labelKey: 'transitions.pixelize',
    group: 'stylized',
    descriptionKey: 'transitions.pixelizeDescription',
    defaultDurationMs: 700,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'social',
    paramDefs: PIXELIZE_PARAM_DEFS,
  },
  {
    kind: 'polygon-iris',
    tier: 'tier-1.5',
    native: ['remotion'],
    fallbackFor: { ffmpeg: 'iris' },
    directions: [],
    labelKey: 'transitions.polygonIris',
    group: 'wipe',
    descriptionKey: 'transitions.polygonIrisDescription',
    defaultDurationMs: 650,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'slideshow',
    paramDefs: POLYGON_IRIS_PARAM_DEFS,
  },
  {
    kind: 'cover',
    tier: 'tier-1.5',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: ALL_DIRECTIONS,
    labelKey: 'transitions.cover',
    group: 'motion',
    descriptionKey: 'transitions.coverDescription',
    defaultDurationMs: 500,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'social',
  },
  {
    kind: 'reveal',
    tier: 'tier-1.5',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: ALL_DIRECTIONS,
    labelKey: 'transitions.reveal',
    group: 'motion',
    descriptionKey: 'transitions.revealDescription',
    defaultDurationMs: 500,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'social',
  },
  {
    kind: 'flip',
    tier: 'tier-2',
    native: ['remotion'],
    fallbackFor: { ffmpeg: 'fade' },
    directions: ALL_DIRECTIONS,
    labelKey: 'transitions.flip',
    group: 'stylized',
    descriptionKey: 'transitions.flipDescription',
    defaultDurationMs: 600,
    minDurationMs: 33,
    maxDurationMs: 1500,
    webglPreview: 'native',
    recommendedUse: 'social',
  },
  {
    kind: 'clock-wipe',
    tier: 'tier-2',
    native: ['remotion', 'ffmpeg'],
    fallbackFor: {},
    directions: [],
    labelKey: 'transitions.clockWipe',
    group: 'wipe',
    descriptionKey: 'transitions.clockWipeDescription',
    defaultDurationMs: 700,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'slideshow',
    paramDefs: CLOCK_WIPE_PARAM_DEFS,
    timingDefs: CLOCK_WIPE_TIMING_DEFS,
  },
  {
    kind: 'cube',
    tier: 'tier-2',
    native: ['remotion'],
    fallbackFor: { ffmpeg: 'fade' },
    directions: ALL_DIRECTIONS,
    labelKey: 'transitions.cube',
    group: 'stylized',
    descriptionKey: 'transitions.cubeDescription',
    defaultDurationMs: 600,
    minDurationMs: 33,
    maxDurationMs: 1500,
    webglPreview: 'native',
    recommendedUse: 'social',
  },
  {
    kind: 'zoom-blur',
    tier: 'tier-2',
    native: ['remotion'],
    fallbackFor: { ffmpeg: 'fade' },
    directions: [],
    labelKey: 'transitions.zoomBlur',
    group: 'motion',
    descriptionKey: 'transitions.zoomBlurDescription',
    defaultDurationMs: 450,
    minDurationMs: 33,
    maxDurationMs: 1500,
    webglPreview: 'native',
    recommendedUse: 'social',
  },
  {
    kind: 'zoom-in-out',
    tier: 'tier-2',
    native: ['remotion'],
    fallbackFor: { ffmpeg: 'iris' },
    directions: [],
    labelKey: 'transitions.zoomInOut',
    group: 'motion',
    descriptionKey: 'transitions.zoomInOutDescription',
    defaultDurationMs: 600,
    minDurationMs: 33,
    maxDurationMs: 2000,
    webglPreview: 'native',
    recommendedUse: 'social',
  },
] as const satisfies readonly VideoTransitionCapability[];

export const VIDEO_TRANSITION_KINDS = VIDEO_TRANSITION_REGISTRY.map(
  (entry) => entry.kind,
) as VideoTransitionKind[];

export function isVideoTransitionKind(
  value: unknown,
): value is VideoTransitionKind {
  return (
    typeof value === 'string' &&
    VIDEO_TRANSITION_KINDS.includes(value as VideoTransitionKind)
  );
}

export function videoTransitionRegistryEntry(
  kind: VideoTransitionKind,
): VideoTransitionCapability {
  return VIDEO_TRANSITION_REGISTRY.find((entry) => entry.kind === kind)!;
}

export function normalizeVideoTransition(
  transition: VideoTimelineTransition | undefined,
): NormalizedVideoTransitionSpec {
  if (!transition) return { kind: 'cut' };
  if (typeof transition === 'string') {
    return { kind: isVideoTransitionKind(transition) ? transition : 'fade' };
  }
  const kind = isVideoTransitionKind(transition.kind)
    ? transition.kind
    : 'fade';
  const entry = videoTransitionRegistryEntry(kind);
  const direction =
    transition.direction && entry.directions.includes(transition.direction)
      ? transition.direction
      : undefined;
  const timing = normalizeVideoTransitionTiming(entry, transition.timing);
  const durationMs =
    normalizeTransitionDurationMs(transition.durationMs) ?? timing?.durationMs;
  const params = normalizeVideoTransitionParams(entry, transition.params);
  return {
    kind,
    ...(durationMs ? { durationMs } : {}),
    ...(direction ? { direction } : {}),
    ...(timing ? { timing } : {}),
    ...(params ? { params } : {}),
  };
}

export function videoTransitionKind(
  transition: VideoTimelineTransition | undefined,
): VideoTransitionKind {
  return normalizeVideoTransition(transition).kind;
}

function normalizeVideoTransitionParams(
  entry: VideoTransitionCapability,
  rawParams: Record<string, unknown> | undefined,
): Record<string, VideoTransitionParamValue> | undefined {
  if (!rawParams || !isRecord(rawParams)) return undefined;
  const resolved = resolveTransitionParams(entry, rawParams);
  return compactResolvedTransitionParams(entry, resolved.values);
}

function normalizeVideoTransitionTiming(
  entry: VideoTransitionCapability,
  rawTiming: VideoTransitionTiming | undefined,
): VideoTransitionTiming | undefined {
  if (!rawTiming || !isRecord(rawTiming)) return undefined;
  const timing: VideoTransitionTiming = {};
  const durationMs = normalizeTransitionDurationMs(rawTiming.durationMs);
  if (durationMs !== undefined) timing.durationMs = durationMs;

  if (isVideoTransitionEasing(rawTiming.easing, entry.timingDefs)) {
    timing.easing = rawTiming.easing;
  }

  if (entry.timingDefs?.allowHoldPct === true) {
    const holdPct = normalizeTransitionHoldPct(rawTiming.holdPct);
    if (holdPct !== undefined) timing.holdPct = holdPct;
  }

  return Object.keys(timing).length > 0 ? timing : undefined;
}

function normalizeTransitionDurationMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(33, Math.min(3000, Math.round(value)))
    : undefined;
}

function normalizeTransitionHoldPct(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : undefined;
}

function isVideoTransitionEasing(
  value: unknown,
  timingDefs: VideoTransitionTimingDefs | undefined,
): value is NonNullable<VideoTransitionTiming['easing']> {
  if (typeof value !== 'string') return false;
  const options = timingDefs?.easingOptions ?? TRANSITION_EASINGS;
  return options.includes(
    value as NonNullable<VideoTransitionTiming['easing']>,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type VideoAudioSeamMode = 'follow' | 'cut';

export type VideoTimelineMarkerColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple';

export interface VideoTimelineMarker {
  id: string;
  timeMs: number;
  label: string;
  color?: VideoTimelineMarkerColor;
  isChapter?: boolean;
  comment?: string;
}

export type VideoTimelineSourceRef =
  | { kind: 'asset'; assetId: string }
  | { kind: 'linked'; sourceId: string; externalId: string }
  | { kind: 'scene'; sceneId: string };

export interface VideoTimeline {
  schema: 'neuma.video.timeline.v1';
  tracks: VideoTimelineTrack[];
  durationMs: number;
  fps: number;
  frameRate?: FrameRate;
  markers?: VideoTimelineMarker[];
  intro?: VideoTimelineBookend;
  outro?: VideoTimelineBookend;
  migration?: {
    from: 'storyboard';
    version: number;
  };
}

export interface VideoTimelineBookend {
  kind: 'fade';
  durationMs: number;
}

export type VideoTimelineTrack =
  | VideoVisualTimelineTrack
  | VideoAudioTimelineTrack
  | VideoCaptionTimelineTrack;

interface VideoBaseTimelineTrack {
  id: string;
  kind: VideoTimelineTrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  syncLocked?: boolean;
  order: number;
  clips: VideoTimelineClip[];
}

export interface VideoVisualTimelineTrack extends VideoBaseTimelineTrack {
  kind: 'video' | 'broll' | 'overlay';
  hidden?: boolean;
  // Effect clips (vivid overlays) are runtime-restricted to `overlay` tracks;
  // the video-ir ops layer and Zod schema enforce that.
  clips: Array<VideoVisualTimelineClip | VideoEffectTimelineClip>;
}

/**
 * Single source of truth for visual track classification on the frontend.
 * Callers (timeline editor, preview composer, track header layer controls,
 * project timeline grouping) import this guard instead of re-deriving the
 * predicate, so they stay in sync from one edit here.
 *
 * When adding a new visual kind, three locations must be updated manually —
 * the union is not introspectable at runtime: (1) `VideoVisualTimelineTrack['kind']`,
 * (2) this guard's return expression, and (3) the backend copy in
 * `src-api/src/shared/video/remotion-render-input.ts`, which runs in a
 * separate workspace (the path alias does not cross the boundary).
 */
export function isVisualTimelineTrack(
  track: VideoTimelineTrack,
): track is VideoVisualTimelineTrack {
  return (
    track.kind === 'video' || track.kind === 'broll' || track.kind === 'overlay'
  );
}

/**
 * Visual-clip guard for narrowing visual-track clip arrays, which also carry
 * `effect` clips (vivid overlays) on overlay tracks. Transition seams, media
 * lookups, and transform gizmos that only make sense for media clips filter
 * through this instead of assuming `track.clips` is visual-only.
 */
export function isVisualTimelineClip(
  clip: VideoTimelineClip,
): clip is VideoVisualTimelineClip {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

export interface VideoAudioTimelineTrack extends VideoBaseTimelineTrack {
  kind: 'audio-vo' | 'audio-music' | 'audio-sfx';
  volumeDb?: number;
  duckUnderTrackId?: string;
  clips: VideoAudioTimelineClip[];
}

export interface VideoCaptionTimelineTrack extends VideoBaseTimelineTrack {
  kind: 'caption';
  clips: VideoCaptionTimelineClip[];
}

export type VideoTimelineClip =
  | VideoVisualTimelineClip
  | VideoAudioTimelineClip
  | VideoCaptionTimelineClip
  | VideoEffectTimelineClip;

interface VideoBaseTimelineClip {
  id: string;
  kind: VideoTimelineClipKind;
  name?: string;
  sourceRef: VideoTimelineSourceRef;
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
  /** Optional per-clip entrance fade-in length in ms. Applied by the
   * Remotion preview/render (opacity ramp). FFmpeg export honors it on
   * overlay tracks via a `fade=in` filter; scene base tracks ignore it
   * for now. Default 0 = hard cut on entry. */
  entranceMs?: number;
  /** Optional per-clip exit fade-out length in ms. Same applicability. */
  exitMs?: number;
}

export interface VideoVisualTimelineClip extends VideoBaseTimelineClip {
  kind: 'video' | 'image' | 'overlay';
  transforms?: VideoClipTransform;
  transitionToNext?: VideoTimelineTransition;
  audioSeamToNext?: VideoAudioSeamMode;
  filters?: VideoClipFilters;
  effects?: ClipEffectStack;
  muted?: boolean;
}

export interface VideoAudioTimelineClip extends VideoBaseTimelineClip {
  kind: 'audio';
  gainDb?: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  fadeInCurve?: VideoAudioFadeCurve;
  fadeOutCurve?: VideoAudioFadeCurve;
  audioTransitionToNext?: VideoAudioTransitionSpec;
  transcriptText?: string;
}

export interface VideoCaptionTimelineClip extends VideoBaseTimelineClip {
  kind: 'caption';
  captionGroupId?: string;
  text: string;
  style?: VideoSubtitleStyle;
  /** Per-word timings (timeline-absolute) for animated caption styles. */
  words?: VideoSubtitleWord[];
}

export interface VideoEffectTimelineClip extends VideoBaseTimelineClip {
  kind: 'effect';
  effectType: string;
  transforms?: VideoClipTransform;
}

export interface VideoClipTransform {
  /** Uniform scale fallback. When `scaleX` / `scaleY` are set they take
   * precedence; otherwise both axes derive from `scale`. Keeping the field
   * keeps single-axis edits trivial and preserves backwards-compatibility
   * with stored projects. */
  scale?: number;
  /** Independent X-axis scale. Defaults to `scale ?? 1` when absent. */
  scaleX?: number;
  /** Independent Y-axis scale. Defaults to `scale ?? 1` when absent. */
  scaleY?: number;
  positionX?: number;
  positionY?: number;
  opacity?: number;
  rotation?: number;
  /**
   * How the media fills the canvas. `cover` crops to fill, `contain` letterboxes
   * (black bars), `fill` stretches (distorts), `blur-pad` shows the whole media
   * centered over a blurred, zoomed copy of itself filling the canvas.
   */
  fit?: 'cover' | 'contain' | 'fill' | 'blur-pad';
  /** Canvas background behind contain-fit media, usually for logos. */
  background?: string;
  crop?: { top: number; right: number; bottom: number; left: number };
}

export interface VideoClipFilters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hueRotateDeg?: number;
  blurPx?: number;
  grayscale?: number;
  sepia?: number;
}

export interface VideoEditDecisionList {
  schema: 'neuma.video.edl.v1';
  projectId: string;
  fps: number;
  durationMs: number;
  segments: VideoEdlSegment[];
  overlays: VideoEdlOverlay[];
  audioTracks: VideoEdlAudioTrack[];
  captions: VideoEdlCaption[];
}

export interface VideoEdlSegment {
  id: string;
  trackId: string;
  clipId: string;
  sourceRef: VideoTimelineSourceRef;
  sceneId?: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceDurationMs?: number;
  durationMs: number;
  playback?: ClipPlayback;
  transforms?: VideoClipTransform;
  transitionToNext?: VideoTimelineTransition;
  audioSeamToNext?: VideoAudioSeamMode;
  filters?: VideoClipFilters;
  effects?: ClipEffectStack;
  muted?: boolean;
}

export interface VideoEdlOverlay extends VideoEdlSegment {
  kind: 'broll' | 'overlay';
  /** FFmpeg/Remotion presentation-time shift needed to align overlay source. */
  ptsShiftMs?: number;
}

export interface VideoEdlAudioTrack {
  id: string;
  kind: Extract<
    VideoTimelineTrackKind,
    'audio-vo' | 'audio-music' | 'audio-sfx'
  >;
  muted: boolean;
  volumeDb?: number;
  duckUnderTrackId?: string;
  clips: VideoEdlAudioClip[];
}

export interface VideoEdlAudioClip {
  id: string;
  clipId: string;
  sourceRef: VideoTimelineSourceRef;
  sceneId?: string;
  timelineStartMs: number;
  sourceStartMs: number;
  durationMs: number;
  playback?: ClipPlayback;
  keyframes?: KeyframeTrack[];
  gainDb?: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  fadeInCurve?: VideoAudioFadeCurve;
  fadeOutCurve?: VideoAudioFadeCurve;
  audioTransitionToNext?: VideoAudioTransitionSpec;
  transcriptText?: string;
}

export interface VideoEdlCaption {
  id: string;
  clipId: string;
  sourceRef: VideoTimelineSourceRef;
  sceneId?: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: VideoSubtitleWord[];
  style?: VideoSubtitleStyle;
  entranceMs?: number;
  exitMs?: number;
}

export interface VideoRenderPlan {
  scenes: Array<{
    sceneId: string;
    assetPlan: VideoAssetPlan;
    modelId: string;
    model: string;
    estimatedCostUsd: number;
    estimatedDurationSec: number;
    cached: boolean;
  }>;
  totalCostUsd: number;
  totalEtaSec: number;
  warnings: string[];
}

export interface VideoAgentJournalEntry {
  id: string;
  ts: string;
  tool: string;
  args: unknown;
  result: unknown;
  reasoning?: string;
  diff: VideoProjectDiffOperation[];
  inverseDiff?: VideoProjectDiffOperation[];
  undone?: boolean;
}

export type VideoProjectDiffOperation = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
};

export interface VideoAgentToolCallInput {
  name: string;
  args: Record<string, unknown>;
  reasoning?: string;
}

export interface VideoAgentToolExecution {
  project: VideoProject;
  entry: VideoAgentJournalEntry;
}

export type VideoEditorHandoffTarget =
  | 'neuma-package'
  | 'final-cut-pro'
  | 'premiere-pro'
  | 'resolve'
  | 'otio'
  | 'edl'
  | 'capcut-fallback';

export type VideoEditorHandoffMediaMode = 'copy' | 'link';

export interface VideoEditorHandoffConformanceSummary {
  issueCount: number;
  warningCount: number;
  errorCount: number;
  unsupportedFeatureCount: number;
  targets: Array<{
    target: VideoEditorHandoffTarget;
    support: 'supported' | 'generated-unverified' | 'fallback-only';
    issueCount: number;
    warningCount: number;
    errorCount: number;
  }>;
}

export interface VideoEditorHandoffJobStatus {
  job: VideoJob;
  packagePath?: string;
  packageDir?: string;
  conformance?: VideoEditorHandoffConformanceSummary;
}

export interface VideoMediaItem {
  id: string;
  kind: 'image' | 'video' | 'audio';
  source: string;
  // For reference-only attaches `path` carries the `catalog:<assetId>`
  // pseudo-scheme — see `REFERENCED_ASSET_PATH_PREFIX` on the API side.
  // Thumbnail/preview/timeline code paths watch for it to swap to the
  // catalog stream URL until hydration has copied real bytes in.
  path: string;
  materializationState?: 'referenced' | 'hydrating' | 'ready' | 'error';
  bytesTotal?: number;
  proxy?: VideoMediaProxy;
  filmstripUrl?: string;
  waveformUrl?: string;
  collectionId?: string;
  collectionLabel?: string;
  metadata: {
    durationMs: number;
    width?: number;
    height?: number;
    frameRate?: number;
    codec?: string;
    pixelFormat?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
    colorSpace?: string;
    sampleRate?: number;
    channels?: number;
    fileSize?: number;
    audioTrackCount?: number;
    /** sha256 of the local bytes; set on import so the same file isn't added twice. */
    contentHash?: string;
  };
  // Mirrors the API-side `MediaProvenance` shape — the inspector and
  // hover preview use this to surface the upstream provider (Immich /
  // Drive / Box / …) and an "Open in source" link when one is recorded.
  provenance?: {
    provider: string;
    sourceUrl?: string;
    sourceDisplayName?: string;
    connectionId?: string;
    sourceId?: string;
    thumbnailUrl?: string;
    references?: Array<{
      kind: 'asset' | 'frame' | 'url';
      id: string;
      atMs?: number;
    }>;
    generatedFor?: {
      clipId?: string;
      sceneId?: string;
      rangeMs?: [number, number];
    };
    jobId?: string;
    acceptedOpId?: string;
    variantOf?: string;
    attribution?: string;
    license?: string;
    attributionRequired?: boolean;
    // Catalog asset id when this MediaItem traces back to the asset
    // catalog. The rail/tile uses it to correlate the project-side asset
    // with live materialization progress (the SSE feed is keyed on the
    // catalog id, not the project-side MediaItem id).
    catalogAssetId?: string;
    [key: string]: unknown;
  };
}

export interface VideoMediaProxy {
  path: string;
  source?: 'video_project' | 'asset_catalog';
  url?: string;
  widthPx: number;
  heightPx: number;
  bitrateBps: number;
  createdAt: string;
}

export type VideoLinkedSourceProvider =
  | 'local-fs'
  | 'google-drive'
  | 'box'
  | 'dropbox'
  | 'onedrive'
  | 'immich'
  | 's3';

export type VideoLinkedSourceRole = 'context' | 'b-roll' | 'reference';
export type VideoLinkedAssetKind = 'image' | 'video' | 'audio' | 'other';

export interface VideoLinkedSource {
  id: string;
  provider: VideoLinkedSourceProvider;
  connectionId?: string;
  rootPath: string;
  displayName: string;
  role: VideoLinkedSourceRole;
  filters?: {
    types?: Array<'image' | 'video' | 'audio'>;
    extensions?: string[];
    maxDepth?: number;
    minDurationMs?: number;
    maxDurationMs?: number;
  };
  index: {
    state: 'unindexed' | 'crawling' | 'partial' | 'fresh' | 'stale' | 'error';
    fileCount?: number;
    lastSyncedAt?: string;
    cursor?: string;
    error?: string;
  };
  favorite?: boolean;
  lastOpenedAt?: string;
  budget?: {
    maxFiles?: number;
    maxBytes?: number;
    ttlSec?: number;
    captionUsd?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface VideoLinkedAsset {
  id: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  name: string;
  mime?: string;
  kind: VideoLinkedAssetKind;
  sizeBytes?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  thumbnailCachePath?: string;
  description?: string;
  captionProvider?: string;
  captionModel?: string;
  embeddingModel?: string;
  embeddingDim?: number;
  embeddedAt?: string;
  modifiedAt?: string;
  favorite?: boolean;
  lastOpenedAt?: string;
  indexedAt: string;
}

export interface VideoLinkedFolderChild {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType?: string;
  size?: number;
  modifiedAt?: string;
  kind?: VideoLinkedAssetKind;
  assetId?: string;
  thumbnailUrl?: string;
  favorite?: boolean;
  lastOpenedAt?: string;
}

export interface VideoLinkedAssetSearchHit {
  asset: VideoLinkedAsset;
  score: number;
  matchedOn: 'embedding' | 'filename' | 'metadata';
  thumbnailUrl: string;
  sourceDisplayName?: string;
  matchSnippet?: string;
}

export interface VideoLinkedAssetSearchCapability {
  vector: boolean;
  fts: boolean;
  degraded: boolean;
  reason?: string;
}

export interface VideoStoryboard {
  status: 'draft' | 'edited' | 'approved';
  intent: string;
  totalDurationMs: number;
  costEstimateUsd: { low: number; high: number };
  scenes: VideoStoryboardScene[];
  approvedAt?: string;
  approvedBy?: 'user' | 'auto';
  music?: VideoMusicPlan;
  narration?: VideoNarrationPlan;
}

export interface VideoStoryboardScene {
  id: string;
  durationMs: number;
  intent: string;
  caption?: { text: string; style?: VideoSubtitleStyle };
  /**
   * Additional caption overlays stacked on top of the scene. Unlike
   * `caption`, these never drive TTS / narration — they are purely
   * visual (title cards, lower-thirds, watermarks). Order is render order
   * (later items paint on top).
   */
  overlayCaptions?: VideoSceneOverlayCaption[];
  transition?: VideoTimelineTransition;
  muteAudio?: boolean;
  reframe?: VideoReframeOverride;
  assetPlan: VideoAssetPlan;
  htmlFrameSeed?: VideoHtmlFrameSeed;
}

export interface VideoHtmlFrameSeed {
  nodeId: string;
  templateId: string;
  engine: string;
  variables?: Record<string, unknown>;
  renderOverride?: VideoHtmlFrameRenderOverride;
}

export type VideoHtmlFrameRenderOverride = VideoHtmlFrameNativeRenderOverride;

export interface VideoHtmlFrameNativeRenderOverride {
  mode: 'native';
  templateId: string;
  engine: string;
  variables?: Record<string, unknown>;
}

export type VideoAssetPlan =
  | { kind: 'existing'; assetId: string; trimMs?: [number, number] }
  | {
      kind: 'ai-image';
      prompt: string;
      refImageIds?: string[];
      provider?: string;
      aspectRatio?: VideoAspectRatio;
      size?: string;
      seed?: number;
    }
  | {
      kind: 'ai-clip';
      prompt: string;
      refImageId?: string;
      refImageTailId?: string;
      provider?: string;
      aspectRatio?: VideoAspectRatio;
      durationMs?: number;
      seed?: number;
    }
  | {
      kind: 'broll-search';
      query: string;
      provider?: 'pexels' | 'pixabay' | 'storyblocks' | 'linked';
      pinnedHitId?: string;
      sourceIds?: string[];
    }
  | {
      kind: 'image-pan';
      assetId: string;
      kenBurns?: {
        from: VideoRect;
        to: VideoRect;
      };
    }
  | {
      kind: 'tts-narration';
      text: string;
      voiceId?: string;
      provider?: string;
    }
  | {
      kind: 'lipsync';
      text: string;
      voiceId?: string;
      voiceProvider?: string;
      referenceImageAssetId: string;
      lipsyncProvider?:
        | 'auto'
        | 'hedra'
        | 'heygen'
        | 'veed-fabric'
        | 'synthesia'
        | 'omnihuman'
        | 'pika';
      aspectRatio?: VideoAspectRatio;
      motionScale?: number;
      background?:
        | { kind: 'transparent' | 'color'; color?: string }
        | { kind: 'image'; assetId: string };
      egressConfirmed?: boolean;
    };

export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export const VIDEO_LOUDNESS_TARGET_LUFS = [-14, -16, -23] as const;
export type VideoLoudnessTargetLufs =
  (typeof VIDEO_LOUDNESS_TARGET_LUFS)[number];
export type VideoLoudnessTargetSetting = VideoLoudnessTargetLufs | 'off';
export type VideoExportDestination =
  | 'download-mp4'
  | 'youtube'
  | 'tiktok'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'lark';
export interface VideoExportPreset {
  id: VideoExportDestination;
  aspect: VideoAspectRatio;
  videoCodec: 'h264-main' | 'h264-high' | 'h264-baseline';
  audioCodec: 'aac-lc';
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  container: 'mp4';
  faststart: boolean;
  maxDurationMs?: number;
}
export type VideoReframeAnchor =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-third';
export interface VideoReframeOverride {
  aspect: VideoAspectRatio;
  anchor: VideoReframeAnchor;
  offsetPx?: number;
}

export interface VideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoMusicPlan {
  prompt: string;
  durationMs: number;
  provider?: 'elevenlabs-music' | 'stable-audio';
  model?: string;
  tempoBpm?: number;
  mood?: string;
  seed?: number;
  assetId?: string;
}

export type VideoCaptionRenderMode = 'off' | 'burn-in' | 'sidecar';

export interface VideoNarrationSegment {
  id: string;
  sceneId: string;
  text: string;
  voiceId?: string;
  provider?: string;
}

export interface VideoNarrationPlan {
  segments: VideoNarrationSegment[];
  voiceId?: string;
  provider?: string;
  assetId?: string;
}

export interface VideoSubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  /**
   * Semantic vertical position. Used as a fallback when `positionX`/
   * `positionY` are not present so legacy captions still render.
   */
  position?: 'top' | 'middle' | 'bottom';
  /**
   * Normalized x position of the caption's *center* in 0..1 of canvas
   * width. When absent, the caption is horizontally centered.
   */
  positionX?: number;
  /**
   * Normalized y position of the caption's *top* in 0..1 of canvas
   * height. When absent, falls back to `position` (top → 0.08,
   * middle → 0.46, bottom → 0.82).
   */
  positionY?: number;
  /**
   * Fraction of canvas width the caption box may occupy (0..1).
   * Default 0.8. Persisted in canvas-relative units so the layout
   * survives aspect-ratio / resolution changes.
   */
  maxWidth?: number;
  animation?: 'none' | 'tiktok-word' | 'hormozi-bold' | 'classic' | 'karaoke';
  /** Bold / italic / underline flags rendered by the on-canvas overlay and
   * Remotion preview. The ASS/FFmpeg burn-in pipeline ignores them for now;
   * the export captions sidecar will pick them up when the renderer wires it
   * in. Tracked as a non-breaking style upgrade. */
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  textAlign?: 'left' | 'center' | 'right';
  /** Text stroke / outline color (any CSS color). */
  strokeColor?: string;
  /** Text stroke width in canvas-relative px (treat 1080 as reference height). */
  strokeWidth?: number;
  /** Drop-shadow color (any CSS color). Renders as CSS text-shadow in
   * preview and Remotion; ASS subtitle export honors offset only (no blur). */
  shadowColor?: string;
  /** Shadow X offset, canvas-relative px (1080 reference). */
  shadowOffsetX?: number;
  /** Shadow Y offset, canvas-relative px (1080 reference). */
  shadowOffsetY?: number;
  /** Shadow blur radius, canvas-relative px (1080 reference). */
  shadowBlur?: number;
}

/**
 * A caption overlay on a scene. The primary `scene.caption` is the spoken
 * one (drives TTS); `scene.overlayCaptions` is the stacked extras
 * (titles, lower-thirds, watermarks) that share the same overlay model
 * but never drive narration.
 */
export interface VideoSceneOverlayCaption {
  id: string;
  text: string;
  style?: VideoSubtitleStyle;
}

export interface VideoSubtitle {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  words?: Array<{ text: string; startMs: number; endMs: number }>;
  style?: VideoSubtitleStyle;
  sourceAnchors?: Array<{
    sourceMediaId: string;
    sourceElementId: string;
    sourceStartMs: number;
    sourceEndMs: number;
  }>;
  manuallyEdited?: boolean;
}

export interface VideoScene {
  id: string;
  durationMs: number;
  clips: Array<{ id: string; mediaId: string }>;
  transition?: VideoTimelineTransition;
}

export interface VideoRenderOutput {
  aspectRatio: VideoAspectRatio;
  path: string;
  posterPath?: string;
  loudnessTargetLufs?: VideoLoudnessTargetLufs;
  loudnessLufs?: number;
  peakDbfs?: number;
  colorManagement?: {
    inputTransfer?: string;
    outputColorSpace: 'bt709';
    toneMapped: boolean;
  };
  durationSec: number;
  fileSize: number;
  codec: string;
  captionSidecarPath?: string;
  qaReport?: VideoQaReport;
}

export interface VideoQaReport {
  generatedAt: string;
  blackFrames: VideoQaBlackFrame[];
  audioClipping: VideoQaAudioClipping[];
  silentGaps: VideoQaSilentGap[];
  missingMedia: VideoQaMissingMedia[];
  cutBoundaries?: VideoQaCutBoundary[];
  durationMismatch?: VideoQaDurationMismatch;
}

export interface VideoQaBlackFrame {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface VideoQaAudioClipping {
  startMs: number;
  endMs: number;
  peakDbfs: number;
}

export interface VideoQaSilentGap {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface VideoQaMissingMedia {
  sceneId?: string;
  trackId?: string;
  clipId?: string;
  sourceRef: VideoTimelineSourceRef;
}

export interface VideoQaCutBoundary {
  timeMs: number;
  windowStartMs: number;
  windowEndMs: number;
  issues: VideoQaCutBoundaryIssue[];
}

export interface VideoQaCutBoundaryIssue {
  kind: 'black-frame' | 'audio-clipping' | 'silent-gap';
  severity: 'warning';
  startMs: number;
  endMs: number;
  summary: string;
}

export interface VideoQaDurationMismatch {
  expectedMs: number;
  renderedMs: number;
  deltaMs: number;
  toleranceMs: number;
}

export interface VideoShareResult {
  destination: VideoExportDestination;
  status: 'ready' | 'sent';
  aspectRatio: VideoAspectRatio;
  outputPath: string;
  fileName: string;
  fileSize: number;
  mime: string;
  channel?: {
    configId: string;
    platform: Extract<
      VideoExportDestination,
      'slack' | 'discord' | 'telegram' | 'lark'
    >;
    conversationId: string;
    messageId?: string | null;
  };
}

export interface VideoJob {
  id: string;
  projectId: string;
  kind:
    | 'source-download'
    | 'source-analyze'
    | 'linked-source.sync'
    | 'clip-gen'
    | 'tts'
    | 'transcribe'
    | 'render'
    | 'editor-handoff'
    | 'reframe'
    | 'broll'
    | 'music'
    | 'eval';
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  verdict?: {
    schemaVersion: 1;
    process: 'running' | 'succeeded' | 'failed' | 'cancelled';
    completeness: 'complete' | 'unfinished' | 'unknown';
    delivery: 'not_expected' | 'pending' | 'delivered' | 'blocked' | 'failed';
    retry: 'not_safe' | 'safe_once' | 'user_action';
    failureCause?: string;
  };
  recoveryAction?: 'retry_render';
  startedAt?: string;
  finishedAt?: string;
  costCents?: number;
  caller: 'in-app' | 'mcp' | 'agent';
}

export interface VideoSourceMedia {
  id: string;
  mediaItemId: string;
  origin: 'upload' | 'workspace-path' | 'yt-dlp' | 'capture';
  contentHash: string;
  sourceUrl?: string;
  rights?: { userConfirmed: boolean; notes?: string };
  analysisStatus: 'idle' | 'queued' | 'running' | 'done' | 'error';
  analysisId?: string;
  createdAt: string;
}

export interface VideoSourceAnalysis {
  id: string;
  sourceId: string;
  durationMs: number;
  scenes: Array<{ id: string; startMs: number; endMs: number }>;
  speechRanges: Array<{ startMs: number; endMs: number; source: string }>;
  transcript?: VideoSourceTranscript;
  cutCandidates: VideoCutCandidate[];
}

export interface VideoSourceTranscript {
  engine: string;
  words: VideoSubtitleWord[];
  segments?: Array<{ startMs: number; endMs: number; text: string }>;
}

export interface VideoSubtitleWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speaker?: string;
}

export interface VideoCutCandidate {
  id: string;
  sourceId: string;
  startMs: number;
  endMs: number;
  reason: string;
  confidence: number;
  recommendation: 'cut' | 'speed-up' | 'stabilize' | 'review-only';
}

export interface VideoCutPlan {
  id: string;
  sourceId: string;
  status: 'draft' | 'approved' | 'applied' | 'rejected';
  keepRanges: Array<{ startMs: number; endMs: number }>;
  cutCandidates: VideoCutCandidate[];
}

export interface VideoProviderView {
  capability: {
    id: string;
    label: string;
    kinds: string[];
    status: string;
    requiresApiKey: boolean;
    defaultCostPerSecCents?: number;
    license: string;
    probeRequired: boolean;
  };
  config: {
    id: string;
    providerId: string;
    enabled: boolean;
    providerSettingId?: string;
    defaultCostCentsPerSec?: number;
    settings: Record<string, unknown>;
  };
}

export interface VideoRenderProviderView {
  id: string;
  provider: 'local' | 'fal' | 'modal' | 'replicate';
  label: string;
  enabled: boolean;
  baseUrl?: string;
  endpointId?: string;
  providerSettingId?: string;
  rendererImage?: string;
  rendererVersion?: string;
  defaultCostCentsPerRenderSec?: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
}

export type VideoTemplateCategory =
  | 'shorts'
  | 'explainer'
  | 'ad'
  | 'tutorial'
  | 'product'
  | 'podcast'
  | 'testimonial'
  | 'recap'
  | 'announcement'
  | 'other'
  | 'custom';

export type VideoTemplateHook =
  | 'punch-in'
  | 'question'
  | 'reveal'
  | 'pattern-interrupt'
  | 'cold-open';

export type VideoTemplatePace = 'slow' | 'medium' | 'fast' | 'extreme';

export interface VideoTemplateInput {
  key: string;
  kind: 'text' | 'longText' | 'number' | 'enum' | 'asset' | 'color';
  label: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  assetKind?: 'image' | 'video' | 'audio';
}

export type VideoTemplateAssetPlan =
  | { kind: 'existing'; assetKey: string; trimMs?: [number, number] }
  | {
      kind: 'ai-image';
      prompt: string;
      provider?: string;
      aspectRatio?: VideoAspectRatio;
      size?: string;
    }
  | {
      kind: 'ai-clip';
      prompt: string;
      provider?: string;
      aspectRatio?: VideoAspectRatio;
      durationMs?: number;
    }
  | {
      kind: 'broll-search';
      query: string;
      provider?: 'pexels' | 'pixabay' | 'storyblocks';
      pinnedHitId?: string;
    }
  | {
      kind: 'tts-narration';
      text: string;
      voiceId?: string;
      provider?: string;
    }
  | {
      kind: 'image-pan';
      assetKey: string;
      kenBurns?: {
        from: VideoRect;
        to: VideoRect;
      };
    };

export interface VideoTemplate {
  id: string;
  displayName: string;
  category: VideoTemplateCategory;
  thumbnailUrl: string;
  durationSec: { typical: number; min: number; max: number };
  aspectRatios: VideoAspectRatio[];
  renderer?: 'auto' | 'ffmpeg' | 'remotion' | 'webcodecs';
  compositionId?: string;
  hook: VideoTemplateHook;
  pace: VideoTemplatePace;
  pricingHint: { low: number; high: number };
  inputs: VideoTemplateInput[];
  storyboardSeed: {
    intent: string;
    scenes: Array<{
      durationMs: number;
      intent: string;
      assetPlan: VideoTemplateAssetPlan;
      caption?: { text: string; style?: VideoSubtitleStyle };
      transition?: VideoTimelineTransition;
    }>;
    music?: VideoMusicPlan;
    intro?: VideoTimelineBookend;
    outro?: VideoTimelineBookend;
  };
  styleDefaults: {
    primaryColor?: string;
    fontFamily?: string;
    captionStyle?: VideoSubtitleStyle;
  };
  providerHints: Record<string, string | undefined>;
  version: number;
  source: 'builtin' | 'community' | 'custom';
  authorHandle?: string;
  license: 'CC0' | 'CC-BY' | 'proprietary';
  projectTemplateId?: VideoTemplateId;
}
