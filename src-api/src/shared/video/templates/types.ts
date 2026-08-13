import type { ContentGraph } from '@neumar/video-ir';

import type {
  AspectRatio,
  MusicProviderId,
  ProviderId,
  Rect,
  ReframeOverride,
  SubtitleStyle,
  TemplateId,
  TimelineTransition,
  VideoTimelineBookend,
} from '../types';

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
      provider?: ProviderId;
      aspectRatio?: AspectRatio;
      size?: string;
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
      kind: 'tts-narration';
      text: string;
      voiceId?: string;
      provider?:
        | 'kokoro'
        | 'elevenlabs'
        | 'cartesia'
        | 'openai-tts'
        | 'gemini-tts'
        | 'hume-octave'
        | 'indextts';
    }
  | {
      kind: 'image-pan';
      assetKey: string;
      kenBurns?: { from: Rect; to: Rect };
    };

export interface VideoTemplateSceneSeed {
  durationMs: number;
  intent: string;
  assetPlan: VideoTemplateAssetPlan;
  caption?: { text: string; style?: SubtitleStyle };
  transition?: TimelineTransition;
  reframe?: ReframeOverride;
}

export interface VideoTemplateMusicSeed {
  prompt: string;
  durationMs: number;
  provider?: MusicProviderId;
  model?: string;
  tempoBpm?: number;
  mood?: string;
  seed?: number;
}

export interface VideoTemplateHtmlPayload {
  engine: 'html' | 'remotion';
  aspectRatio: AspectRatio;
  durationSec: number;
  contentGraph: ContentGraph;
  frameHtml: Record<string, string>;
  provenance?: {
    templateId?: string;
    sourceUrls?: string[];
    agentModel?: string;
  };
}

export interface VideoTemplate {
  id: string;
  displayName: string;
  category: VideoTemplateCategory;
  thumbnailUrl: string;
  durationSec: { typical: number; min: number; max: number };
  aspectRatios: AspectRatio[];
  renderer?: 'auto' | 'ffmpeg' | 'remotion' | 'webcodecs';
  compositionId?: string;
  hook: VideoTemplateHook;
  pace: VideoTemplatePace;
  pricingHint: { low: number; high: number };
  inputs: VideoTemplateInput[];
  storyboardSeed: {
    intent: string;
    scenes: VideoTemplateSceneSeed[];
    music?: VideoTemplateMusicSeed;
    intro?: VideoTimelineBookend;
    outro?: VideoTimelineBookend;
  };
  html?: VideoTemplateHtmlPayload;
  styleDefaults: {
    primaryColor?: string;
    fontFamily?: string;
    captionStyle?: SubtitleStyle;
  };
  providerHints: {
    aiClip?: ProviderId;
    aiImage?: ProviderId;
    tts?: ProviderId;
    lipsync?: ProviderId;
  };
  version: number;
  source: 'builtin' | 'community' | 'custom';
  authorHandle?: string;
  license: 'CC0' | 'CC-BY' | 'proprietary';
  projectTemplateId?: TemplateId;
}

export interface TemplateExpansionInput {
  templateId: string;
  inputs: Record<string, unknown>;
  name?: string;
}
