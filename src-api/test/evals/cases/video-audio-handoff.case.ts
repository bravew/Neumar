import { buildEditorHandoffModel } from '@/shared/video/editor-handoff/build-model';
import { evaluateHandoffConformance } from '@/shared/video/editor-handoff/conformance';
import type { EditorHandoffClip } from '@/shared/video/editor-handoff/types';
import type { MediaItem, VideoProject } from '@/shared/video/types';

import type { EvalCase } from '../types';

// Checkpoint 7 gate — deterministic fixture coverage for audio edits that must
// survive editor handoff metadata without running paid providers or encoders.

const NOW = '2026-06-22T00:00:00.000Z';

const evalCase: EvalCase = {
  id: 'video-audio-handoff',
  name: 'Audio edits survive editor handoff metadata and conformance checks',
  tier: 'gate',
  touchfiles: [
    'packages/video-ir/src/timeline-types.ts',
    'packages/video-ir/src/timeline-ops.ts',
    'src-api/src/shared/video/editor-handoff/build-model.ts',
    'src-api/src/shared/video/editor-handoff/conformance.ts',
    'src-api/src/shared/video/audio-generation.ts',
    'src-api/src/shared/mcp/video-edit-server.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const model = buildEditorHandoffModel(audioProject(), NOW);
    const clips = new Map(
      model.tracks.flatMap((track) =>
        track.clips.map((clip) => [clip.id, clip] as const),
      ),
    );
    const musicTrack = model.tracks.find((track) => track.id === 'track-music');
    const voiceA = clips.get('clip-voice-a');
    const music = clips.get('clip-music-bed');
    const muted = clips.get('clip-muted-tail');
    const generatedSfx = clips.get('clip-generated-sfx');
    const replacement = clips.get('clip-replaced-vo');
    const conformance = evaluateHandoffConformance(model, ['edl'], NOW);

    const checks = {
      voiceoverOverMusic:
        musicTrack?.kind === 'audio-music' &&
        musicTrack.volumeDb === -12 &&
        musicTrack.duckUnderTrackId === 'track-voice',
      fadeBookends:
        music?.fadeInMs === 500 &&
        music.fadeOutMs === 700 &&
        music.fadeInCurve === 'equal-power' &&
        music.fadeOutCurve === 'ease-in-out',
      audioOnlyCrossfade:
        voiceA?.audioTransitionToNext?.kind === 'crossfade' &&
        voiceA.audioTransitionToNext.durationMs === 200 &&
        voiceA.audioTransitionToNext.curve === 'equal-power',
      mutedClip: muted?.muted === true && model.featureMap.hasAudioMute,
      generatedSfxPlacement:
        generatedSfx?.startMs === 2100 &&
        generatedSfx.durationMs === 450 &&
        generatedSfx.provenance?.generatedFor?.clipId === 'clip-generated-sfx',
      sourceReplacement:
        replacement?.mediaId === 'asset-voice-replacement' &&
        replacement.provenance?.variantOf === 'asset-voice-original' &&
        replacement.provenance?.generatedFor?.clipId === 'clip-replaced-vo',
      featureMap: hasExpectedAudioFeatures(model.featureMap),
      conformanceWarning: conformance.issues.some(
        (issue) =>
          issue.target === 'edl' &&
          issue.code === 'audio_edit_metadata_degraded',
      ),
    };
    const passed = Object.values(checks).every(Boolean);

    return {
      passed,
      score:
        Object.values(checks).filter(Boolean).length /
        Object.keys(checks).length,
      notes: passed ? 'audio handoff metadata complete' : failingNotes(checks),
      metrics: {
        checks,
        audioFeatureMap: {
          hasAudioGain: model.featureMap.hasAudioGain,
          hasAudioFades: model.featureMap.hasAudioFades,
          hasAudioMute: model.featureMap.hasAudioMute,
          hasAudioTrackVolume: model.featureMap.hasAudioTrackVolume,
          hasAudioTransitions: model.featureMap.hasAudioTransitions,
          hasAudioDucking: model.featureMap.hasAudioDucking,
          hasGeneratedAudio: model.featureMap.hasGeneratedAudio,
        },
        clipSummaries: clipSummaries([
          voiceA,
          music,
          muted,
          generatedSfx,
          replacement,
        ]),
      },
    };
  },
};

export default evalCase;

function audioProject(): VideoProject {
  const assets = [
    audioAsset('asset-voice-original', 'tts', 'voice-original.wav', {
      provider: 'kokoro',
      model: 'kokoro-v1',
      prompt: 'Original product narration',
      generatedFor: { clipId: 'clip-voice-a', sceneId: 'scene-1' },
      license: 'generated',
      commercialUse: true,
    }),
    audioAsset('asset-voice-replacement', 'tts', 'voice-replacement.wav', {
      provider: 'openai-tts',
      model: 'gpt-4o-mini-tts',
      prompt: 'Cleaner replacement narration',
      generatedFor: { clipId: 'clip-replaced-vo', sceneId: 'scene-1' },
      variantOf: 'asset-voice-original',
      acceptedOpId: 'hist-replace-voice',
      license: 'generated',
      commercialUse: true,
    }),
    audioAsset('asset-music-bed', 'music', 'music-bed.wav', {
      provider: 'stable-audio',
      model: 'stable-audio-core',
      prompt: 'Warm pulsing bed under voiceover',
      generatedFor: { clipId: 'clip-music-bed', rangeMs: [0, 5000] },
      license: 'generated',
      commercialUse: true,
    }),
    audioAsset('asset-sfx-hit', 'music', 'sfx-hit.wav', {
      provider: 'elevenlabs-music',
      model: 'elevenlabs-sfx',
      prompt: 'Soft UI confirmation hit',
      generatedFor: {
        clipId: 'clip-generated-sfx',
        sceneId: 'scene-1',
        rangeMs: [2100, 2550],
      },
      license: 'generated',
      commercialUse: true,
    }),
  ] satisfies MediaItem[];

  return {
    id: 'eval-audio-handoff',
    name: 'Audio handoff eval',
    template: 'custom',
    prompt: 'Exercise audio handoff metadata',
    assets,
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 5000,
      tracks: [
        {
          id: 'track-voice',
          kind: 'audio-vo',
          name: 'Voiceover',
          muted: false,
          locked: false,
          order: 0,
          clips: [
            {
              id: 'clip-voice-a',
              kind: 'audio',
              name: 'Opening VO',
              sourceRef: { kind: 'asset', assetId: 'asset-voice-original' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 1800,
              trimStartMs: 0,
              trimEndMs: 1800,
              sourceDurationMs: 3000,
              gainDb: 1,
              audioTransitionToNext: {
                kind: 'crossfade',
                durationMs: 200,
                curve: 'equal-power',
              },
              transcriptText: 'Welcome to the product.',
            },
            {
              id: 'clip-voice-b',
              kind: 'audio',
              name: 'VO continuation',
              sourceRef: { kind: 'asset', assetId: 'asset-voice-original' },
              sceneId: 'scene-1',
              startMs: 1600,
              durationMs: 1200,
              trimStartMs: 1800,
              trimEndMs: 3000,
              sourceDurationMs: 3000,
              transcriptText: 'It handles the next step.',
            },
            {
              id: 'clip-muted-tail',
              kind: 'audio',
              name: 'Muted stray take',
              sourceRef: { kind: 'asset', assetId: 'asset-voice-original' },
              sceneId: 'scene-1',
              startMs: 3000,
              durationMs: 400,
              trimStartMs: 0,
              trimEndMs: 400,
              sourceDurationMs: 3000,
              muted: true,
            },
            {
              id: 'clip-replaced-vo',
              kind: 'audio',
              name: 'Replacement VO',
              sourceRef: {
                kind: 'asset',
                assetId: 'asset-voice-replacement',
              },
              sceneId: 'scene-1',
              startMs: 3500,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
              sourceDurationMs: 1200,
              transcriptText: 'This is the replacement.',
            },
          ],
        },
        {
          id: 'track-music',
          kind: 'audio-music',
          name: 'Music',
          muted: false,
          locked: false,
          order: 1,
          volumeDb: -12,
          duckUnderTrackId: 'track-voice',
          clips: [
            {
              id: 'clip-music-bed',
              kind: 'audio',
              name: 'Generated music bed',
              sourceRef: { kind: 'asset', assetId: 'asset-music-bed' },
              startMs: 0,
              durationMs: 5000,
              trimStartMs: 0,
              trimEndMs: 5000,
              sourceDurationMs: 5000,
              gainDb: -6,
              fadeInMs: 500,
              fadeOutMs: 700,
              fadeInCurve: 'equal-power',
              fadeOutCurve: 'ease-in-out',
            },
          ],
        },
        {
          id: 'track-sfx',
          kind: 'audio-sfx',
          name: 'SFX',
          muted: false,
          locked: false,
          order: 2,
          clips: [
            {
              id: 'clip-generated-sfx',
              kind: 'audio',
              name: 'Generated confirmation hit',
              sourceRef: { kind: 'asset', assetId: 'asset-sfx-hit' },
              sceneId: 'scene-1',
              startMs: 2100,
              durationMs: 450,
              trimStartMs: 0,
              trimEndMs: 450,
              sourceDurationMs: 450,
              gainDb: -2,
            },
          ],
        },
      ],
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function audioAsset(
  id: string,
  source: Extract<MediaItem['source'], 'music' | 'tts'>,
  path: string,
  provenance: NonNullable<MediaItem['provenance']>,
): MediaItem {
  return {
    id,
    kind: 'audio',
    source,
    path,
    metadata: { durationMs: 5000, sampleRate: 48000, channels: 2 },
    provenance,
  };
}

function hasExpectedAudioFeatures(
  featureMap: ReturnType<typeof buildEditorHandoffModel>['featureMap'],
): boolean {
  return (
    featureMap.hasAudioGain &&
    featureMap.hasAudioFades &&
    featureMap.hasAudioMute &&
    featureMap.hasAudioTrackVolume &&
    featureMap.hasAudioTransitions &&
    featureMap.hasAudioDucking &&
    featureMap.hasGeneratedAudio
  );
}

function clipSummaries(clips: Array<EditorHandoffClip | undefined>): Array<{
  id: string;
  mediaId?: string;
  startMs: number;
  durationMs: number;
  hasProvenance: boolean;
}> {
  return clips
    .filter((clip): clip is EditorHandoffClip => Boolean(clip))
    .map((clip) => ({
      id: clip.id,
      mediaId: clip.mediaId,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      hasProvenance: Boolean(clip.provenance),
    }));
}

function failingNotes(checks: Record<string, boolean>): string {
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
    .join(', ');
}
