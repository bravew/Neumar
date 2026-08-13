import type { ClipPlayback } from '@neumar/video-ir';

import type { VideoColorMetadata } from '@/shared/video/auto-color';
import type { VideoReframePlan } from '@/shared/video/reframe';
import type {
  AspectRatio,
  AssetPlan,
  LoudnessTargetLufs,
  TransitionDegradation,
  TimelineTransition,
} from '@/shared/video/types';

export type RenderWhere = 'local' | 'cloud';
export type RenderProviderKind = 'local' | 'fal' | 'modal' | 'replicate';
export type RenderTaskState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface RenderProviderCapabilities {
  ffmpeg: boolean;
  remotion?: boolean;
  seedance?: boolean;
  hedra?: boolean;
  veo?: boolean;
}

export interface RenderProviderConfig {
  id: string;
  provider: RenderProviderKind;
  label: string;
  enabled: boolean;
  baseUrl?: string;
  endpointId?: string;
  apiKey?: string;
  providerSettingId?: string;
  rendererImage?: string;
  rendererVersion?: string;
  defaultCostCentsPerRenderSec?: number;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type RenderProviderConfigView = Omit<RenderProviderConfig, 'apiKey'> & {
  hasApiKey: boolean;
};

export interface RenderSceneClipGraph {
  id: string;
  assetName: string;
  durationSec: number;
  sourceStartSec?: number;
  playback?: ClipPlayback;
  kind: 'image' | 'video';
  hasAudio?: boolean;
  color?: VideoColorMetadata;
  autoColorFilter?: string;
  reframe?: VideoReframePlan;
  imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
  transitionToNext?: TimelineTransition;
  audioSeamToNext?: 'follow' | 'cut';
}

export interface RenderOverlayClipGraph {
  id: string;
  assetName: string;
  kind: 'broll' | 'overlay';
  mediaKind: 'image' | 'video';
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  playback?: ClipPlayback;
  ptsShiftSec: number;
  color?: VideoColorMetadata;
  autoColorFilter?: string;
  imagePan?: Extract<AssetPlan, { kind: 'image-pan' }>;
}

export interface RenderAudioTrackGraph {
  assetName: string;
  role: 'music' | 'narration' | 'sfx';
  volume: number;
  timelineStartSec?: number;
  sourceStartSec?: number;
  durationSec?: number;
  playback?: ClipPlayback;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface RenderGraph {
  schema: 'neuma.video.render-graph.v1';
  scenes: RenderSceneClipGraph[];
  overlays?: RenderOverlayClipGraph[];
  audioTracks?: RenderAudioTrackGraph[];
  captionAssetName?: string;
  aspectRatio: AspectRatio;
  mode: 'speed' | 'reproducible';
  loudnessTargetLufs?: LoudnessTargetLufs;
  totalDurationSec: number;
  introMs?: number;
  outroMs?: number;
  renderer: {
    image: string;
    version: string;
  };
}

export interface RenderAssetManifestItem {
  name: string;
  localAbsPath: string;
  byteCount: number;
  sha256: string;
  remoteUrl?: string;
  ttlExpiresAt?: string;
  provenance: {
    role: 'scene' | 'overlay' | 'audio' | 'caption' | 'bundle';
    projectId: string;
    sourcePath: string;
  };
}

export interface RenderRemotionBundle {
  compositionId: string;
  bundleUrl?: string;
  bundleAssetName?: string;
  inputProps: Record<string, unknown>;
}

export type RenderRequest =
  | {
      kind: 'ffmpeg';
      projectId: string;
      graph: RenderGraph;
      assets: RenderAssetManifestItem[];
      outputName: string;
      transitions?: {
        degraded: TransitionDegradation[];
      };
      costCapUsd?: number;
    }
  | {
      kind: 'remotion';
      projectId: string;
      graph: RenderGraph;
      bundle: RenderRemotionBundle;
      assets: RenderAssetManifestItem[];
      outputName: string;
      transitions?: {
        degraded: TransitionDegradation[];
      };
      costCapUsd?: number;
    }
  | {
      kind: 'aiClip';
      projectId: string;
      provider: 'seedance' | 'veo' | 'wan';
      params: Record<string, unknown>;
      outputName: string;
      costCapUsd?: number;
    };

export interface RenderTaskCreated {
  providerId: string;
  provider: string;
  taskId: string;
  status: Extract<RenderTaskState, 'queued' | 'running'>;
  estimatedCostUsd?: number;
  estimatedTimeSec?: number;
}

export interface RenderTaskStatus {
  providerId: string;
  provider: string;
  taskId: string;
  status: RenderTaskState;
  progress?: number;
  resultUrl?: string;
  outputSha256?: string;
  totalCostUsd?: number;
  unitType?: string;
  unitCount?: number;
  error?: string;
}

export interface RenderProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: RenderProviderKind;
  readonly capabilities: RenderProviderCapabilities;

  uploadAsset(
    localAbsPath: string,
    asset: RenderAssetManifestItem,
    signal?: AbortSignal,
  ): Promise<{ remoteUrl: string; sha256: string; ttlExpiresAt?: string }>;
  createRenderTask(
    req: RenderRequest,
    signal?: AbortSignal,
  ): Promise<RenderTaskCreated>;
  getRenderTaskStatus(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<RenderTaskStatus>;
  cancelRenderTask(taskId: string, signal?: AbortSignal): Promise<void>;
  downloadResult(
    task: RenderTaskStatus,
    destAbsPath: string,
    signal?: AbortSignal,
  ): Promise<{ sha256: string; byteCount: number }>;
  estimateCost?(req: RenderRequest): Promise<{
    estimatedCostUsd?: number;
    estimatedTimeSec?: number;
  }>;
  testConnection?(
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; message: string }>;
}

export interface RenderWithProviderInput {
  providerId?: string;
  request: RenderRequest;
  outputPath: string;
  signal?: AbortSignal;
  onStatus?: (status: {
    status: 'queued' | 'running';
    progress?: number;
    message?: string;
    taskId?: string;
    provider?: string;
    where: 'cloud';
  }) => Promise<void>;
}
