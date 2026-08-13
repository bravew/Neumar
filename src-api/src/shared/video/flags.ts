import { getSetting, setSetting } from '@/shared/db/operations';

// Video Mode HTML-video feature flags. Per dev-doc/html-video/06-05/07.
// Slice K flip (2026-06-07): most html-video flags are on-by-default kill
// switches. Cost-bearing experimental flags stay opt-in until characterized.

export type VideoFeatureFlag =
  /** Master gate for the HTML engine and the things that depend on it. */
  | 'video.engine.html'
  /** Content-graph narrative IR + dual-block agent protocol (Phase 2). */
  | 'video.contentGraph'
  /** File-based template gallery + provenance + JSON-Schema forms (Phase 3). */
  | 'video.templateGallery'
  /** Link / repo → video ingestion (Phase 4). */
  | 'video.sourceIngestion'
  /** Host-wide plugin system surfaced in Video Mode. */
  | 'video.plugins'
  /** Visual frame caption index/search. Defaults off until cost is characterized. */
  | 'video.frameSearch'
  /** External MCP direct mutation apply mode. Defaults off; proposal-only is safer. */
  | 'video.agentApply'
  /** Timeline transition editing UI and agent seam tools. Kill-switch. */
  | 'video.timelineTransitions'
  /** WebCodecs preview renderer. Kill-switch: only explicit false disables. */
  | 'video.webcodecsPreview'
  /** Vivid overlay layer (HTML/GIF/Lottie/text-motion overlays). Kill-switch. */
  | 'video.vividOverlays';

const VIDEO_FEATURE_FLAG_DEFAULTS = {
  'video.engine.html': true,
  'video.contentGraph': true,
  'video.templateGallery': true,
  'video.sourceIngestion': true,
  'video.plugins': true,
  'video.frameSearch': false,
  'video.agentApply': false,
  'video.timelineTransitions': true,
  'video.webcodecsPreview': true,
  'video.vividOverlays': true,
} satisfies Record<VideoFeatureFlag, boolean>;

export function getVideoFeatureFlag(flag: VideoFeatureFlag): boolean {
  const setting = getSetting(flag);
  return VIDEO_FEATURE_FLAG_DEFAULTS[flag]
    ? setting !== 'false'
    : setting === 'true';
}

export function setVideoFeatureFlag(
  flag: VideoFeatureFlag,
  enabled: boolean,
): void {
  setSetting(flag, enabled ? 'true' : 'false');
}

/** Snapshot every video feature flag at once (for telemetry / debug surfaces). */
export function snapshotVideoFeatureFlags(): Record<VideoFeatureFlag, boolean> {
  return {
    'video.engine.html': getVideoFeatureFlag('video.engine.html'),
    'video.contentGraph': getVideoFeatureFlag('video.contentGraph'),
    'video.templateGallery': getVideoFeatureFlag('video.templateGallery'),
    'video.sourceIngestion': getVideoFeatureFlag('video.sourceIngestion'),
    'video.plugins': getVideoFeatureFlag('video.plugins'),
    'video.frameSearch': getVideoFeatureFlag('video.frameSearch'),
    'video.agentApply': getVideoFeatureFlag('video.agentApply'),
    'video.timelineTransitions': getVideoFeatureFlag(
      'video.timelineTransitions',
    ),
    'video.webcodecsPreview': getVideoFeatureFlag('video.webcodecsPreview'),
    'video.vividOverlays': getVideoFeatureFlag('video.vividOverlays'),
  };
}
