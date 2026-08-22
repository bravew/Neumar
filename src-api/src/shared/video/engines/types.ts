import type { FrameRate } from '@neumar/video-ir';

import type { AspectRatio } from '@/shared/video/types';

// Neuma-named port of html-video's EngineAdapter contract
// (`_sample/html-video/packages/core/src/types/index.ts`).
// See dev-doc/html-video/06-05/01-html-render-engine-and-adapter.md.

export type EngineId = 'remotion' | 'html' | 'hyperframes' | (string & {});

export type EngineRenderStage = 'preparing' | 'rendering' | 'muxing';

export type EngineParadigm =
  | 'html-css-gsap'
  | 'react-tsx'
  | 'ts-generator'
  | 'declarative-json';

export type EngineOutputFormat = 'mp4' | 'webm' | 'webm-alpha' | 'png-sequence';

export type EngineRenderTarget = 'local-chromium' | 'local-node' | 'lambda';

export type EngineAudioSupport = 'none' | 'single' | 'multi';

export type EngineSubtitleSupport = 'burn-in' | 'sidecar' | 'none';

export interface VideoEngineCapabilities {
  paradigms: EngineParadigm[];
  outputFormats: EngineOutputFormat[];
  maxResolution: { width: number; height: number };
  alpha: boolean;
  audio: EngineAudioSupport;
  subtitles: EngineSubtitleSupport;
  renderTarget: EngineRenderTarget[];
  fps: FrameRate[];
  /** Free-form SPDX or license hint for this engine itself. */
  licensing: string;
  /** Rough speed indicator, surfaced to UX for estimates. */
  renderSpeedHint?: 'realtime' | 'faster' | 'slower';
  bestFor?: string[];
  weaknesses?: string[];
}

export interface EngineValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface EngineValidationResult {
  ok: boolean;
  issues: EngineValidationIssue[];
}

export interface EngineTemplateRefBase {
  id: string;
  engineId: EngineId;
  /** Path to the engine-native template root (folder or file). */
  sourcePath: string;
  version?: string;
}

export interface EngineBridgeTemplateRef extends EngineTemplateRefBase {
  /** Default mode: render `sourcePath` as engine-native HTML/frame source. */
  mode?: 'bridge';
}

export interface EngineNativeTemplateRef extends EngineTemplateRefBase {
  /** Native engine template entry, e.g. a Remotion `registerRoot()` entry. */
  mode: 'native';
  /** Native mode only: Remotion `<Composition id>` to select after bundling. */
  nativeCompositionId: string;
}

export type EngineTemplateRef =
  | EngineBridgeTemplateRef
  | EngineNativeTemplateRef;

export interface EngineRenderConfig {
  format: EngineOutputFormat;
  resolution: { width: number; height: number };
  aspect?: AspectRatio;
  fps: FrameRate;
  /** Total duration; 'auto' lets the engine derive it from the source. */
  duration: number | 'auto';
  outputPath: string;
  alpha?: boolean;
  strictness?: 'best-effort' | 'strict' | 'strict-all';
  sourceFrameFormat?: 'auto' | 'jpg' | 'png';
  contentKind?: 'general' | 'ui-capture';
  reproducible?: boolean;
  vp9CpuUsed?: number;
  quality?: 'draft' | 'standard' | 'high';
  audio?: Array<{ path: string; volumeDb?: number }>;
}

export type EngineUnavailableReason =
  | 'not-found'
  | 'version-too-old'
  | 'browser-missing';

export type EngineAvailability =
  | {
      installed: true;
      version: string;
      browserVersion?: string;
    }
  | {
      installed: false;
      reason: EngineUnavailableReason;
      version?: string;
      requiredVersion?: string;
      detail?: string;
    };

export interface EngineRenderInput {
  template: EngineTemplateRef;
  variables?: Record<string, unknown>;
  config: EngineRenderConfig;
}

export interface EngineRenderContext {
  workDir: string;
  signal?: AbortSignal;
  onProgress?: (pct: number, stage: EngineRenderStage) => void;
  env?: Record<string, string>;
}

export interface EngineRenderDiagnostic {
  level: 'info' | 'warning' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export interface EngineRenderOutput {
  outputPath: string;
  meta: {
    durationSec: number;
    fileSizeBytes: number;
    actualResolution: { width: number; height: number };
    fps: number;
    renderedFrames: number;
    renderWallClockSec: number;
    engineVersion: string;
    /** Hash of the resolved input + flags, for reproducibility/audit. */
    inputHash?: string;
  };
  diagnostics: EngineRenderDiagnostic[];
}

export interface HtmlSceneOutput {
  htmlPath: string;
  referencedAssets: string[];
  posterPath?: string;
  durationSec: number;
  /**
   * Nonce used on the engine's `<script>` injection (Phase 1 M3 § 2).
   * Surfaced so the future live-preview iframe (Phase 6 M1) can validate
   * the script tag via CSP. Optional — older callers and non-html engines
   * may leave it undefined.
   */
  injectionNonce?: string;
}

/**
 * Neuma's pluggable video engine adapter. Mirrors the html-video
 * `EngineAdapter` contract so future syncs diff cleanly while staying in
 * Neuma vocabulary.
 *
 * Hard rule: no silent cross-engine fallback (Cross-Phase Principle 3).
 * A missing/failed engine surfaces a typed error; the caller chooses.
 */
export interface VideoEngineAdapter {
  id: EngineId;
  name: string;
  upstreamVersion: string;
  capabilities: VideoEngineCapabilities;
  validate(template: EngineTemplateRef): EngineValidationResult;
  render(
    input: EngineRenderInput,
    ctx: EngineRenderContext,
  ): Promise<EngineRenderOutput>;
  renderToHtml?(
    input: EngineRenderInput,
    ctx: EngineRenderContext,
  ): Promise<HtmlSceneOutput>;
  /** Probes runtime prerequisites without mutating the host. */
  probeAvailability(): Promise<EngineAvailability> | EngineAvailability;
}
