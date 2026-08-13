import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { TimelineOp } from '@neumar/video-ir';

import { logUsage } from '@/shared/services/usage-logger';

import {
  generateMusicWithProvider,
  type MusicProviderId,
} from './music-providers';
import {
  getProject,
  getVideoAssetsDir,
  getVideoProjectRoot,
  writeProject,
} from './store';
import { rebuildTimelineFromStoryboard } from './timeline';
import {
  applyProjectTimelineOps,
  buildReplaceAudioClipSourceOps,
} from './timeline-ops';
import { synthesizeTtsPreview, type TtsRequest } from './tts';
import type {
  MediaItem,
  TimelineClip,
  TimelineTrack,
  VideoProject,
  VideoTimeline,
} from './types';

export type GeneratedAudioKind = 'music' | 'sfx' | 'ambience' | 'voiceover';

export interface GenerateVideoAudioRequest {
  kind: GeneratedAudioKind;
  prompt: string;
  durationMs?: number;
  sceneId?: string;
  startMs?: number;
  trackId?: string;
  provider?: MusicProviderId | TtsRequest['provider'];
  model?: string;
  voiceId?: string;
  tempoBpm?: number;
  mood?: string;
  name?: string;
  replaceClipId?: string;
}

export type AudioTransformMode =
  | 'cleanup'
  | 'extend'
  | 'remix'
  | 'replace'
  | 'voiceover'
  | 'sfx';

export interface TransformVideoAudioRequest extends Omit<
  GenerateVideoAudioRequest,
  'kind' | 'replaceClipId' | 'sceneId' | 'startMs' | 'trackId'
> {
  sourceClipId: string;
  mode: AudioTransformMode;
  kind?: GeneratedAudioKind;
}

export interface GenerateVideoAudioResult {
  project: VideoProject;
  asset: MediaItem;
  clip: Extract<TimelineClip, { kind: 'audio' }>;
  trackId: string;
  costCents: number;
  entryId: string;
}

export async function generateVideoAudio(
  projectId: string,
  request: GenerateVideoAudioRequest,
): Promise<GenerateVideoAudioResult> {
  const generated =
    request.kind === 'voiceover'
      ? await generateVoiceoverAsset(projectId, request)
      : await generatePromptAudioAsset(projectId, request);
  const placed = placeGeneratedAudioClip(generated.project, {
    asset: generated.asset,
    costCents: generated.costCents,
    request,
  });
  await writeProject(placed.project);
  return placed;
}

export async function transformVideoAudio(
  projectId: string,
  request: TransformVideoAudioRequest,
): Promise<GenerateVideoAudioResult> {
  const project = await getProject(projectId);
  const source = findAudioClip(project, request.sourceClipId);
  return generateVideoAudio(projectId, {
    ...request,
    durationMs: request.durationMs ?? source.clip.durationMs,
    kind:
      request.kind ??
      generatedAudioKindForTransform(request.mode, source.track.kind),
    replaceClipId: source.clip.id,
    sceneId: source.clip.sceneId,
  });
}

async function generateVoiceoverAsset(
  projectId: string,
  request: GenerateVideoAudioRequest,
): Promise<{
  project: VideoProject;
  asset: MediaItem;
  costCents: number;
}> {
  const result = await synthesizeTtsPreview(projectId, {
    aspectDurationMs: request.durationMs,
    provider: voiceoverProvider(request.provider),
    text: request.prompt,
    voiceId: request.voiceId,
  });
  return {
    project: result.project,
    asset: result.asset,
    costCents: result.costCents,
  };
}

async function generatePromptAudioAsset(
  projectId: string,
  request: GenerateVideoAudioRequest,
): Promise<{
  project: VideoProject;
  asset: MediaItem;
  costCents: number;
}> {
  const project = await getProject(projectId);
  const projectRoot = getVideoProjectRoot(projectId);
  const outputDir = getVideoAssetsDir(projectId);
  const durationMs = resolvedAudioDurationMs(project, request);
  const generated = await generateMusicWithProvider({
    durationMs,
    model: request.model,
    mood: request.mood,
    outputDir,
    prompt: audioPrompt(request),
    provider: musicProvider(request.provider),
    tempoBpm: request.tempoBpm,
  });
  const stat = await fs.stat(generated.filePath);
  const asset: MediaItem = {
    id: randomUUID(),
    kind: 'audio',
    source: 'music',
    path: path.relative(projectRoot, generated.filePath),
    metadata: {
      channels: generated.channels,
      durationMs,
      fileSize: stat.size,
      sampleRate: generated.sampleRate,
    },
    provenance: {
      commercialUse: generated.commercialUse,
      cost: generated.costCents / 100,
      fallbackReason: generated.fallbackReason,
      license: generated.license,
      model: generated.model,
      prompt: request.prompt,
      provider: generated.provider,
      requestedModel: request.model,
      requestedProvider: musicProvider(request.provider),
    },
  };
  const next: VideoProject = {
    ...project,
    assets: [...project.assets, asset],
    budget: {
      ...(project.budget ?? { capUsd: 5, spentUsd: 0 }),
      spentUsd: (project.budget?.spentUsd ?? 0) + generated.costCents / 100,
    },
    updatedAt: new Date().toISOString(),
  };
  logUsage({
    callType: 'other',
    errorMessage: generated.fallbackReason,
    metadata: {
      caller: 'video-mode',
      media_kind: request.kind,
      project_id: projectId,
      requested_provider: musicProvider(request.provider) ?? generated.provider,
    },
    model: generated.model,
    provider: generated.provider,
    status: generated.fallbackReason ? 'error' : 'success',
    totalCostUsd: generated.costCents / 100,
    unitCount: Math.ceil(durationMs / 1000),
    unitType: 'audio_second',
  });
  return {
    project: next,
    asset,
    costCents: generated.costCents,
  };
}

function placeGeneratedAudioClip(
  project: VideoProject,
  input: {
    asset: MediaItem;
    costCents: number;
    request: GenerateVideoAudioRequest;
  },
): GenerateVideoAudioResult {
  const timelineProject = project.timeline
    ? project
    : rebuildTimelineFromStoryboard(project);
  const timeline = timelineProject.timeline;
  if (!timeline) throw new Error('Timeline required to place generated audio');
  if (input.request.replaceClipId) {
    return replaceGeneratedAudioClip(timelineProject, timeline, input);
  }
  const targetKind = trackKindForGeneratedAudio(input.request.kind);
  const track = findOrCreateAudioTrack(timeline, targetKind, input.request);
  const startMs =
    input.request.startMs ?? sceneStartMs(timeline, input.request.sceneId);
  const clip = generatedAudioClip(input.asset, input.request, startMs);
  const ops: TimelineOp[] = [
    ...(track.existing
      ? []
      : [
          {
            kind: 'track.insert',
            track: track.track,
            index: timeline.tracks.length,
          } satisfies TimelineOp,
        ]),
    {
      kind: 'clip.insert',
      trackId: track.track.id,
      clip,
      at: startMs,
    },
  ];
  const execution = applyProjectTimelineOps(timelineProject, {
    ops,
    source: 'agent',
    summary: `Generated ${input.request.kind} audio: ${clip.name ?? input.request.prompt}`,
  });
  const projectWithProvenance = {
    ...execution.project,
    assets: execution.project.assets.map((asset) =>
      asset.id === input.asset.id
        ? {
            ...asset,
            provenance: generatedAudioProvenance(asset, {
              clipId: clip.id,
              sceneId: input.request.sceneId,
              startMs,
              endMs: startMs + clip.durationMs,
            }),
          }
        : asset,
    ),
  };
  return {
    project: projectWithProvenance,
    asset:
      projectWithProvenance.assets.find(
        (asset) => asset.id === input.asset.id,
      ) ?? input.asset,
    clip,
    trackId: track.track.id,
    costCents: input.costCents,
    entryId: execution.entry.id,
  };
}

function replaceGeneratedAudioClip(
  project: VideoProject,
  timeline: VideoTimeline,
  input: {
    asset: MediaItem;
    costCents: number;
    request: GenerateVideoAudioRequest;
  },
): GenerateVideoAudioResult {
  const clipId = input.request.replaceClipId;
  if (!clipId) throw new Error('replaceClipId is required');
  const build = buildReplaceAudioClipSourceOps(timeline, {
    clipId,
    name: input.request.name ?? audioClipName(input.request),
    sourceDurationMs: input.asset.metadata.durationMs,
    sourceRef: { kind: 'asset', assetId: input.asset.id },
    transcriptText:
      input.request.kind === 'voiceover' ? input.request.prompt : undefined,
    trimStartMs: 0,
  });
  const execution = applyProjectTimelineOps(project, {
    ops: build.ops,
    source: 'agent',
    summary: `Transformed audio clip ${clipId}: ${input.request.prompt}`,
  });
  const replaced = findAudioClip(execution.project, clipId);
  const projectWithProvenance = projectWithGeneratedAudioProvenance(
    execution.project,
    input.asset,
    {
      clipId: replaced.clip.id,
      sceneId: replaced.clip.sceneId,
      startMs: replaced.clip.startMs,
      endMs: replaced.clip.startMs + replaced.clip.durationMs,
    },
  );
  return {
    project: projectWithProvenance,
    asset:
      projectWithProvenance.assets.find(
        (asset) => asset.id === input.asset.id,
      ) ?? input.asset,
    clip: replaced.clip,
    trackId: replaced.track.id,
    costCents: input.costCents,
    entryId: execution.entry.id,
  };
}

function generatedAudioProvenance(
  asset: MediaItem,
  generatedFor: {
    clipId: string;
    sceneId?: string;
    startMs: number;
    endMs: number;
  },
): NonNullable<MediaItem['provenance']> {
  return {
    ...(asset.provenance ?? { provider: 'unknown' }),
    generatedFor: {
      clipId: generatedFor.clipId,
      sceneId: generatedFor.sceneId,
      rangeMs: [generatedFor.startMs, generatedFor.endMs],
    },
  };
}

function projectWithGeneratedAudioProvenance(
  project: VideoProject,
  targetAsset: MediaItem,
  generatedFor: {
    clipId: string;
    sceneId?: string;
    startMs: number;
    endMs: number;
  },
): VideoProject {
  return {
    ...project,
    assets: project.assets.map((asset) =>
      asset.id === targetAsset.id
        ? {
            ...asset,
            provenance: generatedAudioProvenance(asset, generatedFor),
          }
        : asset,
    ),
  };
}

function findAudioClip(
  project: VideoProject,
  clipId: string,
): {
  track: Extract<
    TimelineTrack,
    { kind: 'audio-vo' | 'audio-music' | 'audio-sfx' }
  >;
  clip: Extract<TimelineClip, { kind: 'audio' }>;
} {
  const timeline =
    project.timeline ?? rebuildTimelineFromStoryboard(project).timeline;
  if (!timeline) throw new Error('Timeline required');
  for (const track of timeline.tracks) {
    if (
      track.kind !== 'audio-vo' &&
      track.kind !== 'audio-music' &&
      track.kind !== 'audio-sfx'
    ) {
      continue;
    }
    const clip = track.clips.find((item) => item.id === clipId);
    if (clip?.kind === 'audio') {
      return { track, clip };
    }
  }
  throw new Error(`Audio clip not found: ${clipId}`);
}

function generatedAudioClip(
  asset: MediaItem,
  request: GenerateVideoAudioRequest,
  startMs: number,
): Extract<TimelineClip, { kind: 'audio' }> {
  const sourceDurationMs = Math.max(1, asset.metadata.durationMs);
  const durationMs = Math.max(
    1,
    Math.min(request.durationMs ?? sourceDurationMs, sourceDurationMs),
  );
  return {
    id: `clip-audio-${randomUUID()}`,
    kind: 'audio',
    name: request.name ?? audioClipName(request),
    sourceRef: { kind: 'asset', assetId: asset.id },
    sceneId: request.sceneId,
    startMs,
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    sourceDurationMs,
    transcriptText: request.kind === 'voiceover' ? request.prompt : undefined,
    fadeInMs:
      request.kind === 'music' || request.kind === 'ambience' ? 30 : undefined,
    fadeOutMs:
      request.kind === 'music' || request.kind === 'ambience' ? 30 : undefined,
  };
}

function findOrCreateAudioTrack(
  timeline: VideoTimeline,
  kind: Extract<
    TimelineTrack['kind'],
    'audio-vo' | 'audio-music' | 'audio-sfx'
  >,
  request: GenerateVideoAudioRequest,
): { existing: boolean; track: Extract<TimelineTrack, { kind: typeof kind }> } {
  const explicit = request.trackId
    ? timeline.tracks.find((track) => track.id === request.trackId)
    : undefined;
  const existing =
    explicit ?? timeline.tracks.find((track) => track.kind === kind);
  if (existing) {
    if (existing.kind !== kind) {
      throw new Error(`Track ${existing.id} is not a ${kind} track`);
    }
    return {
      existing: true,
      track: existing as Extract<TimelineTrack, { kind: typeof kind }>,
    };
  }
  return {
    existing: false,
    track: {
      id: `track-${kind}-${randomUUID()}`,
      kind,
      name: audioTrackName(kind),
      muted: false,
      locked: false,
      order: nextTrackOrder(timeline),
      volumeDb: kind === 'audio-music' ? -10 : 0,
      clips: [],
    } as Extract<TimelineTrack, { kind: typeof kind }>,
  };
}

function trackKindForGeneratedAudio(
  kind: GeneratedAudioKind,
): Extract<TimelineTrack['kind'], 'audio-vo' | 'audio-music' | 'audio-sfx'> {
  if (kind === 'voiceover') return 'audio-vo';
  if (kind === 'music' || kind === 'ambience') return 'audio-music';
  return 'audio-sfx';
}

function generatedAudioKindForTransform(
  mode: AudioTransformMode,
  trackKind: Extract<
    TimelineTrack['kind'],
    'audio-vo' | 'audio-music' | 'audio-sfx'
  >,
): GeneratedAudioKind {
  if (mode === 'voiceover') return 'voiceover';
  if (mode === 'sfx') return 'sfx';
  if (trackKind === 'audio-vo') return 'voiceover';
  if (trackKind === 'audio-music') return 'music';
  return 'sfx';
}

function resolvedAudioDurationMs(
  project: VideoProject,
  request: GenerateVideoAudioRequest,
): number {
  if (request.durationMs && request.durationMs > 0) return request.durationMs;
  return (
    project.timeline?.durationMs ??
    project.storyboard?.totalDurationMs ??
    project.storyboard?.scenes.reduce(
      (total, scene) => total + scene.durationMs,
      0,
    ) ??
    5000
  );
}

function sceneStartMs(
  timeline: VideoTimeline,
  sceneId: string | undefined,
): number {
  if (!sceneId) return 0;
  for (const track of timeline.tracks) {
    const clip = track.clips.find((item) => item.sceneId === sceneId);
    if (clip) return clip.startMs;
  }
  return 0;
}

function nextTrackOrder(timeline: VideoTimeline): number {
  const maxOrder = Math.max(0, ...timeline.tracks.map((track) => track.order));
  return maxOrder + 10;
}

function audioTrackName(
  kind: Extract<
    TimelineTrack['kind'],
    'audio-vo' | 'audio-music' | 'audio-sfx'
  >,
): string {
  if (kind === 'audio-vo') return 'Voiceover';
  if (kind === 'audio-music') return 'Music';
  return 'SFX';
}

function audioClipName(request: GenerateVideoAudioRequest): string {
  const label =
    request.kind === 'sfx'
      ? 'SFX'
      : request.kind === 'ambience'
        ? 'Ambience'
        : request.kind === 'voiceover'
          ? 'Voiceover'
          : 'Music';
  return `${label}: ${request.prompt.slice(0, 80)}`;
}

function audioPrompt(request: GenerateVideoAudioRequest): string {
  if (request.kind === 'music') return request.prompt;
  return `${request.kind} audio: ${request.prompt}`;
}

function musicProvider(
  provider: GenerateVideoAudioRequest['provider'],
): MusicProviderId | undefined {
  return provider === 'elevenlabs-music' ||
    provider === 'stable-audio' ||
    provider === 'minimax-music'
    ? provider
    : undefined;
}

function voiceoverProvider(
  provider: GenerateVideoAudioRequest['provider'],
): TtsRequest['provider'] | undefined {
  return provider === 'kokoro' ||
    provider === 'elevenlabs' ||
    provider === 'cartesia' ||
    provider === 'openai-tts' ||
    provider === 'gemini-tts' ||
    provider === 'hume-octave' ||
    provider === 'indextts'
    ? provider
    : undefined;
}
