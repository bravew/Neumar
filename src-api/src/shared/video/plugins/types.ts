import type { NetworkPolicy } from '@/shared/network-policy/schema';
import type {
  Capability,
  CapabilityGrant,
  CapabilityDefinition,
  GenuiSurfaceDeclaration,
  PluginRuntimeConfig,
  TrustTier,
} from '@/shared/plugins/runtime';
import { registerCapabilities } from '@/shared/plugins/runtime';
import type { EngineTemplateRef } from '@/shared/video/engines/types';
import type { AspectRatio } from '@/shared/video/types';

import type { VideoPluginManifest } from './validate';

export const VIDEO_PLUGIN_API_VERSION = '1.0.0';

export const VIDEO_PLUGIN_ENGINE_IDS = ['html', 'remotion'] as const;
export type VideoPluginEngineId = (typeof VIDEO_PLUGIN_ENGINE_IDS)[number];

export const VIDEO_PLUGIN_ASPECT_RATIOS = [
  '16:9',
  '9:16',
  '1:1',
  '4:5',
] as const satisfies readonly AspectRatio[];

export const VIDEO_PLUGIN_FPS = [24, 30, 60] as const;
export type VideoPluginFps = (typeof VIDEO_PLUGIN_FPS)[number];

export const VIDEO_PLUGIN_ATOMS = [
  'research-search',
  'storyboard-draft',
  'broll-stock',
  'ai-image',
  'ai-clip',
  'music-select',
  'tts-narration',
  'timeline-assemble',
  'render-preview',
  'qa-check',
  'render-final',
  'geo-map',
  'geo-caption',
  'reference-analyze',
  'reference-vision',
  'source-transcribe',
  'source-analyze',
  'auto-cut-plan',
  'source-evidence',
] as const;

export type VideoPluginAtom = (typeof VIDEO_PLUGIN_ATOMS)[number];

export const VIDEO_PLUGIN_CAPABILITIES = [
  'prompt:inject',
  'assets:metadata',
  'research:web',
  'network:stock',
  'network:music',
  'network:map',
  'network:geocode',
  'network:weather',
  'media:generate',
  'media:vision',
  'media:transcribe',
  'video:analyze',
  'video:edit',
  'network:youtube',
] as const satisfies readonly Capability[];

export type VideoPluginCapability = (typeof VIDEO_PLUGIN_CAPABILITIES)[number];

export interface VideoPluginStage {
  id: string;
  atoms: VideoPluginAtom[];
  optional: boolean;
  repeat: boolean;
  until?: string;
  policy?: string;
  inputs?: Record<string, unknown>;
}

export interface VideoPluginTemplateRef {
  id: string;
  role: 'primary' | 'supporting' | 'example';
}

export interface VideoPlugin {
  id: string;
  name: string;
  title: string;
  version: string;
  description: string;
  rootDir: string;
  manifestPath: string;
  sourceScope: string;
  trustTier: TrustTier;
  manifestDigest: string;
  manifest: VideoPluginManifest;
  engine: {
    id: VideoPluginEngineId;
    templateRef?: EngineTemplateRef;
  };
  stages: VideoPluginStage[];
  capabilities: VideoPluginCapability[];
  impliedCapabilities: VideoPluginCapability[];
  networkPolicy: NetworkPolicy;
  genuiSurfaces: GenuiSurfaceDeclaration[];
  templates: VideoPluginTemplateRef[];
  config?: PluginRuntimeConfig;
  promptGuide: string;
  diagnostics: string[];
}

export interface VideoPluginSnapshotPayload {
  engine: VideoPlugin['engine'];
  stages: VideoPluginStage[];
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  templates: VideoPluginTemplateRef[];
  grants?: CapabilityGrant[];
  deniedCapabilities?: VideoPluginCapability[];
  restricted?: boolean;
  promptGuideIncluded?: boolean;
  allowedTools?: string[];
  enabledMcpServers?: string[];
  networkPolicy?: NetworkPolicy;
}

export const VIDEO_ATOM_CAPABILITY_REQUIREMENTS: Record<
  VideoPluginAtom,
  readonly VideoPluginCapability[]
> = {
  'research-search': ['research:web'],
  'storyboard-draft': ['prompt:inject'],
  'broll-stock': ['network:stock'],
  'ai-image': ['media:generate'],
  'ai-clip': ['media:generate'],
  'music-select': ['network:music'],
  'tts-narration': ['media:generate'],
  'timeline-assemble': ['prompt:inject'],
  'render-preview': ['prompt:inject'],
  'qa-check': ['prompt:inject'],
  'render-final': ['prompt:inject'],
  'geo-map': ['network:map'],
  'geo-caption': ['network:geocode'],
  'reference-analyze': ['video:analyze'],
  'reference-vision': ['media:vision'],
  'source-transcribe': ['media:transcribe'],
  'source-analyze': ['video:analyze'],
  'auto-cut-plan': ['prompt:inject', 'video:analyze'],
  'source-evidence': ['video:analyze'],
};

const VIDEO_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    id: 'assets:metadata',
    domain: 'video',
    title: 'Asset metadata',
    description: 'Read local capture-time/GPS metadata from imported media.',
    risk: 'low',
    defaultGrant: 'always',
  },
  {
    id: 'research:web',
    domain: 'video',
    title: 'Web research',
    description: 'Use WebSearch/WebFetch to build a research brief.',
    risk: 'medium',
    defaultGrant: 'trusted',
    toolNames: [
      'WebSearch',
      'WebFetch',
      'mcp__video-edit__video_fetch_source',
      'mcp__video-edit__video_record_research_brief',
    ],
  },
  {
    id: 'network:stock',
    domain: 'video',
    title: 'Stock b-roll',
    description: 'Search and download licensed stock b-roll.',
    risk: 'medium',
    defaultGrant: 'trusted',
    toolNames: [
      'mcp__video-edit__video_generate_broll',
      'mcp__broll__search',
      'mcp__broll__download',
    ],
  },
  {
    id: 'network:music',
    domain: 'video',
    title: 'Music providers',
    description: 'Search or generate music beds, including paid providers.',
    risk: 'medium',
    defaultGrant: 'trusted',
    toolNames: [
      'mcp__video-edit__video_generate_music',
      'mcp__video-edit__video_generate_audio',
      'mcp__video-edit__video_transform_audio',
    ],
  },
  {
    id: 'network:map',
    domain: 'video',
    title: 'Map tiles',
    description: 'Fetch licensed map tiles for route animations.',
    risk: 'medium',
    defaultGrant: 'trusted',
  },
  {
    id: 'network:geocode',
    domain: 'video',
    title: 'Geocoding',
    description: 'Reverse-geocode capture locations with caching.',
    risk: 'medium',
    defaultGrant: 'trusted',
  },
  {
    id: 'network:weather',
    domain: 'video',
    title: 'Weather enrichment',
    description: 'Fetch historical weather context for a shoot.',
    risk: 'medium',
    defaultGrant: 'reviewed',
  },
  {
    id: 'media:generate',
    domain: 'video',
    title: 'Media generation',
    description: 'Generate images, clips, voiceover, or narration.',
    risk: 'medium',
    defaultGrant: 'trusted',
    toolNames: [
      'mcp__media__media_generate_image',
      'mcp__media__media_generate_video',
      'mcp__video-edit__video_generate_audio',
      'mcp__video-edit__video_transform_audio',
      'mcp__video-edit__video_generate_voiceover',
    ],
  },
  {
    id: 'video:analyze',
    domain: 'video',
    title: 'Video analysis',
    description:
      'Analyze local video structure, timing, source footage, and cut evidence.',
    risk: 'medium',
    defaultGrant: 'trusted',
    toolNames: [
      'mcp__video__analyze_source',
      'mcp__video__suggest_cuts',
      'mcp__video__inspect_source_range',
      'mcp__video__run_bounded_qa',
      'mcp__video-edit__video_inspect_source_range',
    ],
  },
  {
    id: 'video:edit',
    domain: 'video',
    title: 'Timeline edits',
    description:
      'Apply source-editing decisions that mutate the project timeline.',
    risk: 'high',
    defaultGrant: 'reviewed',
    toolNames: ['mcp__video__apply_cut_plan'],
  },
  {
    id: 'media:transcribe',
    domain: 'video',
    title: 'Speech transcription',
    description:
      'Transcribe source audio for captions, packed transcripts, and word-safe cuts.',
    risk: 'medium',
    defaultGrant: 'trusted',
    toolNames: [
      'mcp__video__transcribe_source',
      'mcp__video__get_packed_transcript',
      'mcp__video-edit__video_get_packed_transcript',
    ],
  },
  {
    id: 'media:vision',
    domain: 'video',
    title: 'Vision model analysis',
    description: 'Send keyframes to a vision-capable model.',
    risk: 'high',
    defaultGrant: 'explicit',
  },
  {
    id: 'network:youtube',
    domain: 'video',
    title: 'YouTube acquisition',
    description: 'Download or analyze YouTube references after rights review.',
    risk: 'high',
    defaultGrant: 'explicit',
    toolNames: ['mcp__broll__youtube'],
  },
];

export function registerVideoPluginCapabilities(): void {
  registerCapabilities(VIDEO_CAPABILITY_DEFINITIONS);
}

export function requiredCapabilitiesForAtoms(
  atoms: readonly VideoPluginAtom[],
): VideoPluginCapability[] {
  const required = new Set<VideoPluginCapability>();
  for (const atom of atoms) {
    for (const capability of VIDEO_ATOM_CAPABILITY_REQUIREMENTS[atom]) {
      required.add(capability);
    }
  }
  return [...required].sort();
}
