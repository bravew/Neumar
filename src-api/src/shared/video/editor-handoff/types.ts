import type {
  ClipPlayback,
  KeyframeTrack,
  TimelineHistoryOperation,
} from '@neumar/video-ir';

import type {
  AnalysisArtifact,
  AudioFadeCurve,
  AudioTransitionSpec,
  ClipFilters,
  ClipTransform,
  MediaItem,
  MediaMetadata,
  MediaProvenance,
  TimelineClipKind,
  TimelineMarker,
  TimelineSourceRef,
  TimelineTrackKind,
  TimelineTransition,
} from '@/shared/video/types';

export const EDITOR_HANDOFF_PACKAGE_VERSION = 1;

export const EDITOR_HANDOFF_TARGETS = [
  'neuma-package',
  'final-cut-pro',
  'premiere-pro',
  'resolve',
  'otio',
  'edl',
  'capcut-fallback',
] as const;

export type EditorHandoffTarget = (typeof EDITOR_HANDOFF_TARGETS)[number];

export type EditorHandoffMediaMode = 'copy' | 'link';

export interface EditorHandoffOptions {
  jobId: string;
  targets?: EditorHandoffTarget[];
  mediaMode?: EditorHandoffMediaMode;
  includeReference?: boolean;
  outputRoot?: string;
  workspaceRoot?: string;
}

export type EditorHandoffProgressPhase =
  | 'prepare_model'
  | 'conformance'
  | 'render_reference'
  | 'collect_media'
  | 'write_analysis'
  | 'write_action_log'
  | 'write_sidecars'
  | 'write_interchange'
  | 'zip'
  | 'complete';

export interface EditorHandoffModel {
  schema: 'neuma.video.editor-handoff.model.v1';
  packageVersion: number;
  projectId: string;
  projectName: string;
  generatedAt: string;
  timelineSchema: 'neuma.video.timeline.v1';
  fps: number;
  durationMs: number;
  tracks: EditorHandoffTrack[];
  markers: TimelineMarker[];
  mediaRefs: EditorHandoffMediaRef[];
  derivatives: EditorHandoffDerivative[];
  analysisArtifacts: AnalysisArtifact[];
  actionBatches: EditorHandoffActionBatch[];
  featureMap: EditorHandoffFeatureMap;
}

export interface EditorHandoffTrack {
  id: string;
  kind: TimelineTrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  order: number;
  volumeDb?: number;
  duckUnderTrackId?: string;
  clips: EditorHandoffClip[];
}

export interface EditorHandoffClip {
  id: string;
  trackId: string;
  kind: TimelineClipKind;
  name: string;
  sourceRef: TimelineSourceRef;
  mediaId?: string;
  sceneId?: string;
  startMs: number;
  durationMs: number;
  endMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceDurationMs?: number;
  handles: EditorHandoffClipHandles;
  transitionToNext?: TimelineTransition;
  transforms?: ClipTransform;
  filters?: ClipFilters;
  playback?: ClipPlayback;
  keyframes?: KeyframeTrack[];
  muted?: boolean;
  trackMuted?: boolean;
  trackVolumeDb?: number;
  trackDuckUnderTrackId?: string;
  gainDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
  audioTransitionToNext?: AudioTransitionSpec;
  provenance?: MediaProvenance;
  text?: string;
  effectType?: string;
  params?: Record<string, unknown>;
}

export interface EditorHandoffClipHandles {
  requestedBeforeMs: number;
  requestedAfterMs: number;
  availableBeforeMs: number;
  availableAfterMs: number;
}

export interface EditorHandoffMediaRef {
  id: string;
  kind: MediaItem['kind'] | 'linked' | 'scene';
  source: MediaItem['source'] | 'linked' | 'scene';
  path?: string;
  originalPathHint?: string;
  copiedPath?: string;
  checksumSha256?: string;
  sizeBytes?: number;
  metadata?: MediaMetadata;
  collectionId?: string;
  collectionLabel?: string;
  provenance?: MediaProvenance;
  sourceRef?: TimelineSourceRef;
  missing: boolean;
  relinkRequired: boolean;
  placeholderReason?: string;
}

export interface EditorHandoffDerivative {
  id: string;
  sourceMediaId: string;
  kind:
    | 'proxy'
    | 'waveform'
    | 'filmstrip'
    | 'transcript'
    | 'beat'
    | 'silence'
    | 'highlight'
    | 'source-window';
  path?: string;
  missing: boolean;
}

export interface EditorHandoffActionBatch {
  recordId: string;
  historyEntryId: string;
  source: 'user' | 'agent' | 'system';
  summary?: string;
  ts: string;
  operation: TimelineHistoryOperation;
}

export interface EditorHandoffFeatureMap {
  hasCaptions: boolean;
  hasCaptionStyle: boolean;
  hasTransitions: boolean;
  unsupportedTransitions: string[];
  hasOverlays: boolean;
  hasUnsupportedEffects: boolean;
  hasSpeedChanges: boolean;
  hasReversePlayback: boolean;
  hasFreezeFrames: boolean;
  hasStabilization: boolean;
  hasMotionTracking: boolean;
  hasUnsupportedBlendModes: boolean;
  hasColorGrades: boolean;
  hasKeyframeCurves: boolean;
  hasAudioGain: boolean;
  hasAudioFades: boolean;
  hasAudioMute: boolean;
  hasAudioTrackVolume: boolean;
  hasAudioTransitions: boolean;
  hasAudioDucking: boolean;
  hasGeneratedAudio: boolean;
  missingMediaIds: string[];
  derivativeMissingIds: string[];
  analysisArtifactCount: number;
  approvedActionBatchCount: number;
}

export type ConformanceIssueCode =
  | 'target_unverified'
  | 'flattened_effect'
  | 'unsupported_transition'
  | 'caption_style_degraded'
  | 'media_relink_required'
  | 'missing_media'
  | 'speed_change_degraded'
  | 'overlay_flattened'
  | 'capcut_fallback_only'
  | 'unsupported_speed_ramp'
  | 'reverse_playback_degraded'
  | 'freeze_frame_flattened'
  | 'stabilization_flattened'
  | 'motion_tracking_not_transferable'
  | 'unsupported_blend_mode'
  | 'color_grade_degraded'
  | 'keyframe_curve_degraded'
  | 'audio_edit_metadata_degraded'
  | 'derivative_missing'
  | 'analysis_artifact_missing';

export type ConformanceSeverity = 'info' | 'warning' | 'error';

export interface ConformanceIssue {
  id: string;
  code: ConformanceIssueCode;
  severity: ConformanceSeverity;
  message: string;
  target?: EditorHandoffTarget;
  trackId?: string;
  clipId?: string;
  mediaId?: string;
}

export interface TargetConformanceSummary {
  target: EditorHandoffTarget;
  support: 'supported' | 'generated-unverified' | 'fallback-only';
  issueCount: number;
  warningCount: number;
  errorCount: number;
}

export interface ConformanceSummary {
  issueCount: number;
  warningCount: number;
  errorCount: number;
  unsupportedFeatureCount: number;
  targets: TargetConformanceSummary[];
}

export interface ConformanceReport {
  generatedAt: string;
  targets: EditorHandoffTarget[];
  issues: ConformanceIssue[];
  summary: ConformanceSummary;
}

export interface EditorHandoffManifest {
  schema: 'neuma.video.editor-handoff.manifest.v1';
  packageVersion: number;
  generatedAt: string;
  projectId: string;
  projectName: string;
  timeline: {
    schema: 'neuma.video.timeline.v1';
    fps: number;
    durationMs: number;
  };
  targets: EditorHandoffTarget[];
  mediaMode: EditorHandoffMediaMode;
  sourceHandlePolicy: {
    requestedBeforeMs: number;
    requestedAfterMs: number;
  };
  mediaRefs: Array<{
    id: string;
    kind: EditorHandoffMediaRef['kind'];
    path?: string;
    copiedPath?: string;
    originalPathHint?: string;
    checksumSha256?: string;
    sizeBytes?: number;
    collectionId?: string;
    collectionLabel?: string;
    provenance?: MediaProvenance;
    missing: boolean;
    relinkRequired: boolean;
  }>;
  generatedSidecars: string[];
  derivativeManifestPath: string;
  analysisManifestPath: string;
  actionLogPath: string;
  referencePath?: string;
  checksums: Record<string, string>;
  conformance: ConformanceSummary;
}

export interface EditorHandoffPackageResult {
  jobId: string;
  projectId: string;
  packageDir: string;
  packagePath: string;
  manifestPath: string;
  conformance: ConformanceReport;
  targets: EditorHandoffTarget[];
}
