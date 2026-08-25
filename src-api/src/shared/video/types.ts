import {
  compactResolvedTransitionParams,
  resolveTransitionParams,
  TRANSITION_EASINGS,
  type AudioFadeCurve as IrAudioFadeCurve,
  type AudioTransitionSpec as IrAudioTransitionSpec,
  type ClipPlayback,
  type ClipEffectStack,
  type FrameRate,
  type KeyframeTrack,
  type TimelineHistoryEntry,
  type TimelineOp,
  type TransitionParamDef,
  type TransitionParamValue,
  type TransitionTiming,
  type TransitionTimingDefs,
} from '@neumar/video-ir';

import type { RunVerdict } from '@/core/agent/runtime-state';

import type { VideoTaskStatus } from '@/shared/services/media-generation/types';
import type { ProjectSoundtrack } from '@/shared/video/soundtrack';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export type AudioFadeCurve = IrAudioFadeCurve;
export type AudioTransitionSpec = IrAudioTransitionSpec;
export const LOUDNESS_TARGET_LUFS = [-14, -16, -23] as const;
export type LoudnessTargetLufs = (typeof LOUDNESS_TARGET_LUFS)[number];
export type LoudnessTargetSetting = LoudnessTargetLufs | 'off';
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
    aspectRatio?: AspectRatio | string;
    source: 'timeline-preview';
  };
  /** Which inspector the user has open, so the agent can target it. */
  activePanel?: {
    kind: 'clip-inspector';
    clipId: string;
    tab?: string;
  };
}

export const ANALYSIS_ARTIFACT_KINDS = [
  'silence-ranges',
  'beat-markers',
  'highlight-ranges',
  'transcript-ranges',
  'packed-transcript',
  'source-range-evidence',
  'cut-candidates',
  'qa-report',
  'clip-timings',
  'custom',
] as const;

export type AnalysisArtifactKind = (typeof ANALYSIS_ARTIFACT_KINDS)[number];

export interface AnalysisArtifact {
  id: string;
  kind: AnalysisArtifactKind;
  sourceMediaId?: string;
  contentHash?: string;
  cachePath?: string;
  summary?: string;
  ranges?: AnalysisRange[];
  proposedActionBatch?: {
    id?: string;
    summary?: string;
    ops: TimelineOp[];
  };
  metadata?: Record<string, unknown>;
  generatedAt: string;
}

export interface AnalysisRange {
  id?: string;
  startMs: number;
  endMs: number;
  label?: string;
  confidence?: number;
}
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
  aspect: AspectRatio;
  videoCodec: 'h264-main' | 'h264-high' | 'h264-baseline';
  audioCodec: 'aac-lc';
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  container: 'mp4';
  faststart: boolean;
  maxDurationMs?: number;
}
export type ReframeAnchor =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-third';
export interface ReframeOverride {
  aspect: AspectRatio;
  anchor: ReframeAnchor;
  offsetPx?: number;
}
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay';
export type TemplateId =
  | 'product-reel'
  | 'explainer'
  | 'slideshow'
  | 'podcast'
  | 'ugc-ad'
  | 'custom';

export type ProviderId =
  | 'seedream-5-0'
  | 'seedream-5-0-lite'
  | 'seedream-4-5'
  | 'veo-3-1-generate'
  | 'veo-3-1-fast-generate'
  | 'seedance-2-0'
  | 'seedance-2-0-fast'
  | 'seedance-1-0-pro-fast'
  | 'kling-2-1'
  | 'kling-3'
  | 'wan-2-7'
  | 'pika-mcp'
  | 'mochi-v1'
  | 'kokoro'
  | 'elevenlabs'
  | 'cartesia'
  | 'openai-tts'
  | 'gemini-tts'
  | 'hume-octave'
  | 'indextts'
  | 'whisperx-local'
  | 'auto-subs-local'
  | 'pexels'
  | 'pixabay'
  | 'storyblocks'
  | 'elevenlabs-music'
  | 'stable-audio'
  | 'minimax-music';

export type TtsProvider = Extract<
  ProviderId,
  | 'kokoro'
  | 'elevenlabs'
  | 'cartesia'
  | 'openai-tts'
  | 'gemini-tts'
  | 'hume-octave'
  | 'indextts'
>;

export type LipsyncProvider =
  | 'auto'
  | 'hedra'
  | 'heygen'
  | 'veed-fabric'
  | 'synthesia'
  | 'omnihuman'
  | 'pika';

export interface VideoProject {
  /** Project document schema version; absent means v1 and is migrated on load. */
  schemaVersion?: 2;
  id: string;
  name: string;
  template: TemplateId;
  templateSnapshot?: VideoProjectTemplateSnapshot;
  prompt: string;
  script?: string;
  brandKit?: BrandKit;
  assets: MediaItem[];
  sources?: SourceMedia[];
  linkedSources?: LinkedSource[];
  sourceAnalyses?: SourceMediaAnalysis[];
  cutPlans?: SourceCutPlan[];
  analysisArtifacts?: AnalysisArtifact[];
  storyboard?: Storyboard;
  scenes?: Scene[];
  timeline?: VideoTimeline;
  history?: VideoTimelineHistory;
  agentJournal?: AgentJournalEntry[];
  renderPlan?: RenderPlan;
  render?: RenderStatus;
  budget?: { capUsd: number; spentUsd: number };
  outputs?: RenderOutput[];
  usageSummary?: VideoUsageSummary;
  settings?: VideoProjectSettings;
  /**
   * Soundtrack model (Phase 5). Optional and additive — projects created
   * before this field landed are unaffected. The mux wiring
   * (`pipeline.ts::collectSoundtrackAudioTracks`) folds music + narration into
   * the render's audio mix; the MiniMax provider adapters are still to come.
   */
  soundtrack?: ProjectSoundtrack;
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

export interface VideoProjectSettings {
  autoApproveStoryboard?: boolean;
  autoApproveUnderCents?: number;
  agentEdits?: 'proposal-only' | 'apply';
  captionsRenderer?: 'remotion' | 'ffmpeg-ass' | 'auto';
  renderCaptionMode?: CaptionRenderMode;
  defaultRenderMode?: 'speed' | 'reproducible';
  defaultAspectRatios?: AspectRatio[];
  renderWhere?: 'local' | 'cloud';
  cloudRenderProviderId?: string;
  cloudRenderConsents?: Record<
    string,
    { confirmed: boolean; confirmedAt: string }
  >;
  sourceTranscriptionProviderId?: string;
  sourceTranscriptionEgressConsents?: Record<
    string,
    { confirmed: boolean; confirmedAt: string }
  >;
  sourceTranscriptionCostApprovals?: Record<
    string,
    {
      token: string;
      approvedCents?: number;
      approvedAt?: string;
      approvedBy?: 'user' | 'system';
    }
  >;
  musicProviderId?: MusicProviderId;
  musicProviderModel?: string;
  youtubeRightsAck?: {
    accepted: boolean;
    acceptedAt: string;
    scope: 'project';
  };
  loudnessTargetLufs?: LoudnessTargetSetting;
  autoColorEnabled?: boolean;
  autoReframeEnabled?: boolean;
  mcpEnabled?: boolean;
}

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

export type TransitionKind =
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

export type TransitionDirection =
  | 'from-left'
  | 'from-right'
  | 'from-top'
  | 'from-bottom';

export type VideoRenderPath = 'remotion' | 'ffmpeg';
export type TransitionTier = 'tier-1' | 'tier-1.5' | 'tier-2';
export type TransitionPresetGroup = 'subtle' | 'motion' | 'wipe' | 'stylized';
export type TransitionPreviewSupport = 'native' | 'fallback' | 'none';
export type TransitionRecommendedUse =
  | 'general'
  | 'scene-change'
  | 'social'
  | 'slideshow';
export type VideoTransitionTiming = TransitionTiming;
export type VideoTransitionParamValue = TransitionParamValue;
export type VideoTransitionParamDef = TransitionParamDef;
export type VideoTransitionTimingDefs = TransitionTimingDefs;

export interface TransitionSpec {
  kind: TransitionKind;
  durationMs?: number;
  direction?: TransitionDirection;
  timing?: VideoTransitionTiming;
  params?: Record<string, unknown>;
}

export interface NormalizedTransitionSpec extends Omit<
  TransitionSpec,
  'params'
> {
  params?: Record<string, VideoTransitionParamValue>;
}

export type TimelineTransition = TransitionKind | TransitionSpec;

export interface TransitionCapability {
  kind: TransitionKind;
  tier: TransitionTier;
  native: VideoRenderPath[];
  fallbackFor: Partial<Record<VideoRenderPath, TransitionKind | null>>;
  directions: TransitionDirection[];
  labelKey: `transitions.${string}`;
  group: TransitionPresetGroup;
  descriptionKey: `transitions.${string}`;
  defaultDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  webglPreview: TransitionPreviewSupport;
  recommendedUse: TransitionRecommendedUse;
  paramDefs?: readonly VideoTransitionParamDef[];
  timingDefs?: VideoTransitionTimingDefs;
}

export interface TransitionDegradation {
  seamIndex: number;
  requestedKind: TransitionKind;
  fallbackKind: TransitionKind;
  renderer: VideoRenderPath;
  projectId?: string;
  unsupportedParams?: string[];
}

const ALL_DIRECTIONS: TransitionDirection[] = [
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
] as const satisfies readonly TransitionCapability[];

export const VIDEO_TRANSITION_KINDS = VIDEO_TRANSITION_REGISTRY.map(
  (entry) => entry.kind,
) as TransitionKind[];

export function isTransitionKind(value: unknown): value is TransitionKind {
  return (
    typeof value === 'string' &&
    VIDEO_TRANSITION_KINDS.includes(value as TransitionKind)
  );
}

export function transitionRegistryEntry(
  kind: TransitionKind,
): TransitionCapability {
  return VIDEO_TRANSITION_REGISTRY.find((entry) => entry.kind === kind)!;
}

export function normalizeTransition(
  transition: TimelineTransition | undefined,
): NormalizedTransitionSpec {
  if (!transition) return { kind: 'cut' };
  if (typeof transition === 'string') {
    return { kind: isTransitionKind(transition) ? transition : 'fade' };
  }
  const kind = isTransitionKind(transition.kind) ? transition.kind : 'fade';
  const entry = transitionRegistryEntry(kind);
  const direction =
    transition.direction && entry.directions.includes(transition.direction)
      ? transition.direction
      : undefined;
  const timing = normalizeTransitionTiming(entry, transition.timing);
  const durationMs =
    normalizeTransitionDurationMs(transition.durationMs) ?? timing?.durationMs;
  const params = normalizeTransitionParams(entry, transition.params);
  return {
    kind,
    ...(durationMs ? { durationMs } : {}),
    ...(direction ? { direction } : {}),
    ...(timing ? { timing } : {}),
    ...(params ? { params } : {}),
  };
}

export function transitionKind(
  transition: TimelineTransition | undefined,
): TransitionKind {
  return normalizeTransition(transition).kind;
}

function normalizeTransitionParams(
  entry: TransitionCapability,
  rawParams: Record<string, unknown> | undefined,
): Record<string, VideoTransitionParamValue> | undefined {
  if (!rawParams || !isRecord(rawParams)) return undefined;
  const resolved = resolveTransitionParams(entry, rawParams);
  return compactResolvedTransitionParams(entry, resolved.values);
}

function normalizeTransitionTiming(
  entry: TransitionCapability,
  rawTiming: VideoTransitionTiming | undefined,
): VideoTransitionTiming | undefined {
  if (!rawTiming || !isRecord(rawTiming)) return undefined;
  const timing: VideoTransitionTiming = {};
  const durationMs = normalizeTransitionDurationMs(rawTiming.durationMs);
  if (durationMs !== undefined) timing.durationMs = durationMs;

  if (isTransitionEasing(rawTiming.easing, entry.timingDefs)) {
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

function isTransitionEasing(
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

export type AudioSeamMode = 'follow' | 'cut';

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

export interface VideoTimeline {
  schema: 'neuma.video.timeline.v1';
  tracks: TimelineTrack[];
  durationMs: number;
  fps: number;
  frameRate?: FrameRate;
  markers?: TimelineMarker[];
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
  // the video-ir ops layer and Zod schema enforce that.
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
  entranceMs?: number;
  exitMs?: number;
}

export interface VisualTimelineClip extends BaseTimelineClip {
  kind: 'video' | 'image' | 'overlay';
  transforms?: ClipTransform;
  transitionToNext?: TimelineTransition;
  audioSeamToNext?: AudioSeamMode;
  filters?: ClipFilters;
  effects?: ClipEffectStack;
  muted?: boolean;
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
  style?: SubtitleStyle;
  /**
   * Per-word timings for animated styles (active-word / karaoke / typewriter).
   * `startMs`/`endMs` are timeline-absolute, so a renderer compares them
   * directly against the playhead. Present on STT-generated cues.
   */
  words?: SubtitleWord[];
  /**
   * Where this cue's text came from in the source media — lets the retime
   * reactor recompute the cue's timeline position after clips move or trim,
   * without re-transcribing. Present on STT-generated cues.
   */
  sourceAnchor?: CaptionTokenAnchor;
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

export interface ClipFilters {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hueRotateDeg?: number;
  blurPx?: number;
  grayscale?: number;
  sepia?: number;
}

export interface EditDecisionList {
  schema: 'neuma.video.edl.v1';
  projectId: string;
  fps: number;
  durationMs: number;
  segments: EdlSegment[];
  overlays: EdlOverlay[];
  audioTracks: EdlAudioTrack[];
  captions: EdlCaption[];
}

export interface EdlSegment {
  id: string;
  trackId: string;
  clipId: string;
  sourceRef: TimelineSourceRef;
  sceneId?: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceDurationMs?: number;
  durationMs: number;
  playback?: ClipPlayback;
  keyframes?: KeyframeTrack[];
  transforms?: ClipTransform;
  transitionToNext?: TimelineTransition;
  audioSeamToNext?: AudioSeamMode;
  filters?: ClipFilters;
  effects?: ClipEffectStack;
  muted?: boolean;
  entranceMs?: number;
  exitMs?: number;
}

export interface EdlOverlay extends EdlSegment {
  kind: 'broll' | 'overlay';
  /** FFmpeg/Remotion presentation-time shift needed to align overlay source. */
  ptsShiftMs?: number;
}

export interface EdlAudioTrack {
  id: string;
  kind: Extract<TimelineTrackKind, 'audio-vo' | 'audio-music' | 'audio-sfx'>;
  muted: boolean;
  volumeDb?: number;
  duckUnderTrackId?: string;
  clips: EdlAudioClip[];
}

export interface EdlAudioClip {
  id: string;
  clipId: string;
  sourceRef: TimelineSourceRef;
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
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
  audioTransitionToNext?: AudioTransitionSpec;
  transcriptText?: string;
}

export interface EdlCaption {
  id: string;
  clipId: string;
  sourceRef: TimelineSourceRef;
  sceneId?: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: SubtitleWord[];
  keyframes?: KeyframeTrack[];
  style?: SubtitleStyle;
  entranceMs?: number;
  exitMs?: number;
}

export interface RenderPlan {
  scenes: Array<{
    sceneId: string;
    assetPlan: AssetPlan;
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

export interface AgentJournalEntry {
  id: string;
  ts: string;
  tool: string;
  args: unknown;
  result: unknown;
  reasoning?: string;
  diff: ProjectDiffOperation[];
  inverseDiff?: ProjectDiffOperation[];
  undone?: boolean;
}

export type ProjectDiffOperation = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
};

export interface MediaItem {
  id: string;
  kind: 'image' | 'video' | 'audio';
  source:
    | 'user'
    | 'downloaded'
    | 'ai-image'
    | 'auto-cut'
    | 'ai-clip'
    | 'broll'
    | 'tts'
    | 'lipsync'
    | 'music'
    | 'remotion-overlay'
    | 'html-engine';
  // For reference-only attaches `path` carries the `catalog:<assetId>`
  // pseudo-scheme; the timeline and agent flows treat that as "no local
  // bytes yet" and route through `hydrateProjectAsset` on first read.
  path: string;
  /**
   * Where the bytes live.
   *
   * `'managed'` (the default when absent) means this app owns the file: `path`
   * is relative to the video workspace root and points inside the project.
   *
   * `'external'` means the user's own copy is the master and we only borrowed
   * read access — `path` is absolute and outside the project. Nothing derived
   * is written beside it, and deleting the asset never deletes the file.
   */
  origin?: 'managed' | 'external';
  // Lifecycle of the local bytes. Absent or `'ready'` means the file
  // exists on disk at `path`. `'referenced'` means the row is a
  // metadata-only placeholder. `'hydrating'` is set briefly by the
  // hydration endpoint while bytes are streaming. `'error'` is sticky
  // until a retry succeeds.
  materializationState?: 'referenced' | 'hydrating' | 'ready' | 'error';
  // Total bytes of the upstream blob — known up front from the catalog.
  // Surfaces in the tile badge and lets the rail show a meaningful
  // determinate ring before the materializer has emitted its first
  // progress event.
  bytesTotal?: number;
  metadata: MediaMetadata;
  proxy?: MediaProxy;
  filmstripUrl?: string;
  waveformUrl?: string;
  collectionId?: string;
  collectionLabel?: string;
  provenance?: MediaProvenance;
}

export interface MediaProxy {
  path: string;
  source?: 'video_project' | 'asset_catalog';
  url?: string;
  widthPx: number;
  heightPx: number;
  bitrateBps: number;
  createdAt: string;
}

export interface MediaMetadata {
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
  /**
   * sha256 of the asset's local bytes. Set when a file is copied/uploaded into
   * the project so the same file isn't attached twice — see the dedup path in
   * `store.ts`.
   */
  contentHash?: string;
  subtitles?: Subtitle[];
  providerTaskStatus?: VideoTaskStatus;
  /**
   * Original capture time (ISO 8601) when known — from the source's
   * `creation_time`/EXIF tag or the catalog asset's captured date. Drives
   * chronological ordering of a source-asset montage.
   */
  capturedAt?: string;
  /**
   * Capture location (decimal degrees) when known — from the container's
   * `location` tag or the catalog asset's GPS. Lets the agent cluster a
   * montage into location-based segments alongside capture time.
   */
  gps?: { lat: number; lng: number };
}

export interface MediaProvenance {
  provider: string;
  model?: string;
  requestedProvider?: string;
  requestedModel?: string;
  fallbackReason?: string;
  cost?: number;
  prompt?: string;
  refImageId?: string;
  refImageTailId?: string;
  references?: MediaProvenanceReference[];
  generatedFor?: {
    clipId?: string;
    sceneId?: string;
    rangeMs?: [number, number];
  };
  jobId?: string;
  acceptedOpId?: string;
  variantOf?: string;
  seed?: number;
  hitId?: string;
  license?: string;
  attribution?: string;
  attributionRequired?: boolean;
  commercialUse?: boolean;
  sourceUrl?: string;
  sourceDisplayName?: string;
  /**
   * ISO timestamp of when an external source URL was fetched (Phase 4 link →
   * video ingestion). Set together with `sourceUrl` so a derived MediaItem
   * is traceable to a specific server-side fetch.
   */
  sourceFetchedAt?: string;
  connectionId?: string;
  sourceId?: string;
  thumbnailUrl?: string;
  evalScores?: EvalScores;
  // Catalog asset id when this MediaItem was attached via the asset
  // catalog. Used by the rail/tile to look up live materialization
  // progress (the SSE feed is keyed on this id, not the project-side
  // MediaItem id).
  catalogAssetId?: string;
}

export interface MediaProvenanceReference {
  kind: 'asset' | 'frame' | 'url';
  id: string;
  atMs?: number;
}

export type LinkedSourceProvider =
  | 'local-fs'
  | 'google-drive'
  | 'box'
  | 'dropbox'
  | 'onedrive'
  | 'immich'
  | 's3';

export type LinkedSourceRole = 'context' | 'b-roll' | 'reference';
export type LinkedAssetKind = 'image' | 'video' | 'audio' | 'other';

export interface LinkedSource {
  id: string;
  provider: LinkedSourceProvider;
  connectionId?: string;
  rootPath: string;
  displayName: string;
  role: LinkedSourceRole;
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

export interface LinkedAsset {
  id: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  name: string;
  mime?: string;
  kind: LinkedAssetKind;
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

export interface LinkedFolderChild {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType?: string;
  size?: number;
  modifiedAt?: string;
  kind?: LinkedAssetKind;
  assetId?: string;
  thumbnailUrl?: string;
  favorite?: boolean;
  lastOpenedAt?: string;
}

export interface LinkedAssetSearchHit {
  asset: LinkedAsset;
  score: number;
  matchedOn: 'embedding' | 'filename' | 'metadata';
  thumbnailUrl: string;
  sourceDisplayName?: string;
  matchSnippet?: string;
}

export interface LinkedAssetSearchCapability {
  vector: boolean;
  fts: boolean;
  degraded: boolean;
  reason?: string;
}

export interface SourceMedia {
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

export interface SourceMediaAnalysis {
  id: string;
  sourceId: string;
  contentHash: string;
  durationMs: number;
  streams: MediaMetadata;
  scenes: DetectedScene[];
  speechRanges: SpeechRange[];
  transcript?: TranscriptData;
  diarization?: SpeakerTurn[];
  visualBeats: VisualBeat[];
  qualitySignals: QualitySignal[];
  duplicateCandidates: DuplicateTakeCandidate[];
  cutCandidates: CutCandidate[];
  artifactIds?: string[];
  generatedAt: string;
}

export interface SourceCutPlan {
  id: string;
  sourceId: string;
  status: 'draft' | 'approved' | 'applied' | 'rejected';
  keepRanges: Array<{
    startMs: number;
    endMs: number;
    sourceCandidateIds?: string[];
  }>;
  cutCandidates: CutCandidate[];
  timeMap: CutTimeMap;
  approvedAt?: string;
  appliedAt?: string;
}

export interface CutTimeMap {
  sourceId: string;
  keepRanges: Array<{
    sourceStartMs: number;
    sourceEndMs: number;
    outputStartMs: number;
    outputEndMs: number;
  }>;
}

export interface DetectedScene {
  id: string;
  startMs: number;
  endMs: number;
  confidence: number;
  method: 'pyscenedetect' | 'transnet-v2' | 'ffmpeg-scdet' | 'vlm';
}

export interface SpeechRange {
  startMs: number;
  endMs: number;
  source: 'vad' | 'asr' | 'manual';
}

export interface TranscriptData {
  engine: string;
  language?: string;
  words: SubtitleWord[];
  segments: Subtitle[];
}

export interface SpeakerTurn {
  speaker: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface VisualBeat {
  startMs: number;
  endMs: number;
  caption: string;
  tags: string[];
  source: 'vlm' | 'scene-detector' | 'manual';
}

export interface QualitySignal {
  startMs: number;
  endMs: number;
  kind:
    | 'shake'
    | 'blur'
    | 'black'
    | 'freeze'
    | 'low-light'
    | 'clipping'
    | 'silence';
  score: number;
  evidence?: string;
}

export interface DuplicateTakeCandidate {
  ids: string[];
  confidence: number;
  evidence: string[];
}

export interface CutCandidate {
  id: string;
  sourceId: string;
  startMs: number;
  endMs: number;
  reason:
    | 'silence'
    | 'filler'
    | 'dead-air'
    | 'shake'
    | 'blur'
    | 'black'
    | 'freeze'
    | 'duplicate-speech'
    | 'low-value'
    | 'off-topic';
  confidence: number;
  destructive: false;
  evidence: Array<{
    kind: 'vad' | 'asr' | 'scene' | 'quality' | 'vlm' | 'heuristic';
    summary: string;
    score?: number;
  }>;
  recommendation: 'cut' | 'speed-up' | 'stabilize' | 'review-only';
}

export interface BrandKit {
  logos?: string[];
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  watermarkPosition?: 'tl' | 'tr' | 'bl' | 'br' | 'none';
}

export interface Storyboard {
  status: 'draft' | 'approved' | 'edited';
  intent: string;
  totalDurationMs: number;
  costEstimateUsd: { low: number; high: number };
  scenes: StoryboardScene[];
  approvedAt?: string;
  approvedBy?: 'user' | 'auto';
  music?: MusicPlan;
  narration?: NarrationPlan;
}

export interface StoryboardScene {
  id: string;
  durationMs: number;
  intent: string;
  caption?: { text: string; style?: SubtitleStyle };
  overlayCaptions?: SceneOverlayCaption[];
  transition?: TimelineTransition;
  muteAudio?: boolean;
  reframe?: ReframeOverride;
  assetPlan: AssetPlan;
  /**
   * Phase 2 M2 — set by the content-graph lowering compiler for scenes
   * whose source is a per-frame HTML render. Carries the data the
   * materializer needs to call the HTML engine without consulting the
   * graph again. Non-HTML scenes leave this undefined and all downstream
   * code paths ignore it.
   */
  htmlFrameSeed?: HtmlFrameSeed;
}

export interface HtmlFrameSeed {
  nodeId: string;
  templateId: string;
  engine: string;
  variables?: Record<string, unknown>;
  renderOverride?: HtmlFrameRenderOverride;
}

export type HtmlFrameRenderOverride = HtmlFrameNativeRenderOverride;

export interface HtmlFrameNativeRenderOverride {
  mode: 'native';
  templateId: string;
  engine: string;
  variables?: Record<string, unknown>;
}

export type AssetPlan =
  | { kind: 'existing'; assetId: string; trimMs?: [number, number] }
  | {
      kind: 'ai-image';
      prompt: string;
      refImageIds?: string[];
      provider?: ProviderId;
      aspectRatio?: AspectRatio;
      size?: '2K' | '4K' | `${number}x${number}`;
      seed?: number;
    }
  | {
      kind: 'ai-clip';
      prompt: string;
      refImageId?: string;
      refImageTailId?: string;
      provider?: ProviderId;
      aspectRatio?: AspectRatio;
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
      kenBurns?: { from: Rect; to: Rect };
    }
  | {
      kind: 'tts-narration';
      text: string;
      voiceId?: string;
      provider?: TtsProvider;
    }
  | {
      kind: 'lipsync';
      text: string;
      voiceId?: string;
      voiceProvider?: TtsProvider;
      referenceImageAssetId: string;
      lipsyncProvider?: LipsyncProvider;
      aspectRatio?: AspectRatio;
      motionScale?: number;
      background?:
        | { kind: 'transparent' | 'color'; color?: string }
        | { kind: 'image'; assetId: string };
      egressConfirmed?: boolean;
    };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Music generation backends. Single source of truth for the union. */
export type MusicProviderId =
  | 'elevenlabs-music'
  | 'stable-audio'
  | 'minimax-music';

export interface MusicPlan {
  prompt: string;
  durationMs: number;
  provider?: MusicProviderId;
  model?: string;
  tempoBpm?: number;
  mood?: string;
  seed?: number;
  assetId?: string;
}

export type CaptionRenderMode = 'off' | 'burn-in' | 'sidecar';

export interface NarrationSegment {
  id: string;
  sceneId: string;
  text: string;
  voiceId?: string;
  provider?: Extract<
    ProviderId,
    | 'kokoro'
    | 'elevenlabs'
    | 'cartesia'
    | 'openai-tts'
    | 'gemini-tts'
    | 'hume-octave'
    | 'indextts'
  >;
}

export interface NarrationPlan {
  segments: NarrationSegment[];
  voiceId?: string;
  provider?: NarrationSegment['provider'];
  assetId?: string;
}

export interface Scene {
  id: string;
  durationMs: number;
  clips: Clip[];
  transition?: TimelineTransition;
  subtitles?: Subtitle[];
}

export interface Clip {
  id: string;
  mediaId: string;
  trim?: [number, number];
  transform?: Transform;
  blendMode?: BlendMode;
  volume?: number;
  fade?: { in?: number; out?: number };
}

export interface Transform {
  position?: { x: number; y: number };
  scale?: number;
  rotation?: number;
  opacity?: number;
}

export interface Subtitle {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  words?: SubtitleWord[];
  style?: SubtitleStyle;
  sourceAnchors?: CaptionTokenAnchor[];
  manuallyEdited?: boolean;
}

export interface SubtitleWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionTokenAnchor {
  sourceMediaId: string;
  sourceElementId: string;
  sourceStartMs: number;
  sourceEndMs: number;
}

export interface SubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  position?: 'top' | 'middle' | 'bottom';
  /** Normalized 0..1 center-x in canvas width. */
  positionX?: number;
  /** Normalized 0..1 top-y in canvas height. */
  positionY?: number;
  /** Fraction of canvas width the caption may occupy (0..1). */
  maxWidth?: number;
  animation?: 'none' | 'tiktok-word' | 'hormozi-bold' | 'classic' | 'karaoke';
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline';
  textAlign?: 'left' | 'center' | 'right';
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
}

export interface SceneOverlayCaption {
  id: string;
  text: string;
  style?: SubtitleStyle;
}

export interface RenderStatus {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  outputPath?: string;
  progress?: number;
  message?: string;
  where?: 'local' | 'cloud';
  provider?: string;
  taskId?: string;
  transitions?: {
    degraded: TransitionDegradation[];
  };
  cache?: {
    sceneHits: number;
    sceneMisses: number;
  };
  updatedAt: string;
}

export interface RenderOutput {
  aspectRatio: AspectRatio;
  path: string;
  posterPath?: string;
  loudnessTargetLufs?: LoudnessTargetLufs;
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
  /** Relative path to the `<output>.credits.json` AI-disclosure sidecar. */
  disclosurePath?: string;
  /** Relative path to the C2PA manifest sidecar, when signing succeeded. */
  c2paManifestPath?: string;
  /** C2PA signer mode used (`local-test` is an untrusted dev signer). */
  c2paSignerMode?: string;
  qaReport?: VideoQaReport;
}

export interface VideoQaReport {
  generatedAt: string;
  blackFrames: VideoQaBlackFrame[];
  audioClipping: VideoQaAudioClipping[];
  silentGaps: VideoQaSilentGap[];
  missingMedia: VideoQaMissingMedia[];
  cutBoundaries: VideoQaCutBoundary[];
  transitionDegradations?: TransitionDegradation[];
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
  sourceRef: TimelineSourceRef;
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
  aspectRatio: AspectRatio;
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
  verdict?: RunVerdict;
  recoveryAction?: 'retry_render';
  startedAt?: string;
  finishedAt?: string;
  costCents?: number;
  caller: 'in-app' | 'mcp' | 'agent';
}

export interface EvalScores {
  vbench?: Partial<Record<VbenchDimension, number>>;
  clipSceneFit?: number;
  wer?: number;
  sourceCutRecall?: number;
}

export type VbenchDimension =
  | 'motion_smoothness'
  | 'subject_consistency'
  | 'dynamic_degree'
  | 'imaging_quality'
  | 'temporal_flickering';

export interface VideoUsageSummary {
  projectId: string;
  totalCostCents: number;
  byCallType: Record<string, number>;
  byProvider: Record<string, number>;
}
