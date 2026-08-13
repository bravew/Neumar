import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProject, writeProject } from '@/shared/video/store';
import {
  compileTimelineToEdl,
  migrateStoryboardToTimeline,
  rebuildTimelineFromStoryboard,
} from '@/shared/video/timeline';
import type { MediaItem, VideoProject } from '@/shared/video/types';

let workDir: string;

describe('video timeline migration and EDL compilation', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-timeline-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('migrates storyboard projects into a deterministic JSON-safe timeline', () => {
    const project = projectFixture();

    const migrated = migrateStoryboardToTimeline(project);

    expect(migrated).not.toBe(project);
    expect(migrated.timeline).toMatchObject({
      schema: 'neuma.video.timeline.v1',
      durationMs: 6000,
      fps: 24,
      migration: { from: 'storyboard', version: 1 },
    });
    expect(migrated.timeline?.tracks.map((track) => track.id)).toEqual([
      'track-video-main',
      'track-audio-vo',
      'track-audio-music',
      'track-caption-main',
    ]);
    expect(migrated.timeline?.tracks[0]?.clips).toEqual([
      expect.objectContaining({
        id: 'clip-scene-scene-1',
        kind: 'video',
        sourceRef: { kind: 'asset', assetId: 'asset-video' },
        startMs: 0,
        durationMs: 2500,
        trimStartMs: 1000,
        trimEndMs: 3500,
      }),
      expect.objectContaining({
        id: 'clip-scene-scene-2',
        kind: 'image',
        sourceRef: { kind: 'scene', sceneId: 'scene-2' },
        startMs: 2500,
        durationMs: 3500,
      }),
    ]);
    expect(JSON.parse(JSON.stringify(migrated.timeline))).toEqual(
      migrated.timeline,
    );
    expect(migrateStoryboardToTimeline(migrated)).toBe(migrated);
  });

  it('rebuilds the derived timeline after storyboard changes', () => {
    const migrated = migrateStoryboardToTimeline(projectFixture());
    const nextStoryboard = {
      ...migrated.storyboard!,
      totalDurationMs: 7000,
      scenes: migrated.storyboard!.scenes.map((scene) =>
        scene.id === 'scene-2' ? { ...scene, durationMs: 4500 } : scene,
      ),
    };

    const rebuilt = rebuildTimelineFromStoryboard({
      ...migrated,
      storyboard: nextStoryboard,
    });

    expect(rebuilt.timeline?.durationMs).toBe(7000);
    const scene2Clip = rebuilt.timeline?.tracks
      .find((track) => track.id === 'track-video-main')
      ?.clips.find((clip) => clip.id === 'clip-scene-scene-2');
    expect(scene2Clip).toMatchObject({
      startMs: 2500,
      durationMs: 4500,
    });
  });

  it('compiles a renderer-neutral EDL from timeline tracks in stable order', () => {
    const migrated = migrateStoryboardToTimeline(projectFixture());

    const edl = compileTimelineToEdl(migrated);

    expect(edl).toEqual({
      schema: 'neuma.video.edl.v1',
      projectId: 'project-1',
      fps: 24,
      durationMs: 6000,
      segments: [
        {
          id: 'edl-clip-scene-scene-1',
          trackId: 'track-video-main',
          clipId: 'clip-scene-scene-1',
          sourceRef: { kind: 'asset', assetId: 'asset-video' },
          sceneId: 'scene-1',
          timelineStartMs: 0,
          sourceStartMs: 1000,
          sourceDurationMs: 8000,
          durationMs: 2500,
          transitionToNext: { kind: 'fade' },
          muted: true,
        },
        {
          id: 'edl-clip-scene-scene-2',
          trackId: 'track-video-main',
          clipId: 'clip-scene-scene-2',
          sourceRef: { kind: 'scene', sceneId: 'scene-2' },
          sceneId: 'scene-2',
          timelineStartMs: 2500,
          sourceStartMs: 0,
          sourceDurationMs: 3500,
          durationMs: 3500,
        },
      ],
      overlays: [],
      audioTracks: [
        {
          id: 'track-audio-vo',
          kind: 'audio-vo',
          muted: false,
          volumeDb: 0,
          duckUnderTrackId: undefined,
          clips: [
            {
              id: 'edl-clip-narration-scene-1',
              clipId: 'clip-narration-scene-1',
              sourceRef: { kind: 'asset', assetId: 'asset-narration' },
              sceneId: 'scene-1',
              timelineStartMs: 0,
              sourceStartMs: 0,
              durationMs: 2500,
              gainDb: undefined,
              fadeInMs: 30,
              fadeOutMs: 500,
              transcriptText: 'Opening voiceover',
            },
            {
              id: 'edl-clip-narration-scene-2',
              clipId: 'clip-narration-scene-2',
              sourceRef: { kind: 'asset', assetId: 'asset-narration' },
              sceneId: 'scene-2',
              timelineStartMs: 2500,
              sourceStartMs: 2500,
              durationMs: 3500,
              gainDb: undefined,
              fadeInMs: 500,
              fadeOutMs: 30,
              transcriptText: 'Second voiceover',
            },
          ],
        },
        {
          id: 'track-audio-music',
          kind: 'audio-music',
          muted: false,
          volumeDb: -10,
          duckUnderTrackId: 'track-audio-vo',
          clips: [
            {
              id: 'edl-clip-music-main',
              clipId: 'clip-music-main',
              sourceRef: { kind: 'asset', assetId: 'asset-music' },
              sceneId: undefined,
              timelineStartMs: 0,
              sourceStartMs: 0,
              durationMs: 6000,
              gainDb: -10,
              fadeInMs: 30,
              fadeOutMs: 30,
              transcriptText: undefined,
            },
          ],
        },
      ],
      captions: [
        {
          id: 'edl-clip-caption-scene-1',
          clipId: 'clip-caption-scene-1',
          sourceRef: { kind: 'scene', sceneId: 'scene-1' },
          sceneId: 'scene-1',
          startMs: 0,
          endMs: 2500,
          text: 'Opening caption',
          style: { position: 'bottom' },
        },
        {
          id: 'edl-clip-caption-scene-2',
          clipId: 'clip-caption-scene-2',
          sourceRef: { kind: 'scene', sceneId: 'scene-2' },
          sceneId: 'scene-2',
          startMs: 2500,
          endMs: 6000,
          text: 'Second caption',
          style: undefined,
        },
      ],
    });
  });

  it('infers logo-safe transforms when compiling timeline EDL for vertical output', () => {
    const project: VideoProject = {
      ...projectFixture(),
      assets: [asset('asset-logo', 'image', 0, { width: 1024, height: 1024 })],
      timeline: {
        schema: 'neuma.video.timeline.v1',
        durationMs: 3000,
        fps: 30,
        tracks: [
          {
            id: 'track-video-main',
            kind: 'video',
            name: 'Video 1',
            muted: false,
            locked: false,
            order: 0,
            clips: [
              {
                id: 'clip-logo',
                kind: 'image',
                sourceRef: { kind: 'asset', assetId: 'asset-logo' },
                startMs: 0,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
                sourceDurationMs: 3000,
              },
            ],
          },
        ],
      },
    };

    const edl = compileTimelineToEdl(project, { aspectRatio: '9:16' });

    expect(edl.segments[0]).toMatchObject({
      clipId: 'clip-logo',
      transforms: { fit: 'contain', background: '#ffffff' },
    });
  });

  it('uses output aspect ratio when inferring default EDL transforms', () => {
    const project: VideoProject = {
      ...projectFixture(),
      assets: [
        asset('asset-wide-video', 'video', 3000, {
          width: 1920,
          height: 1080,
        }),
      ],
      outputs: [
        {
          aspectRatio: '9:16',
          path: '/workspace/out.mp4',
          durationSec: 3,
          fileSize: 0,
          codec: 'h264',
        },
      ],
      timeline: {
        schema: 'neuma.video.timeline.v1',
        durationMs: 3000,
        fps: 30,
        tracks: [
          {
            id: 'track-video-main',
            kind: 'video',
            name: 'Video 1',
            muted: false,
            locked: false,
            order: 0,
            clips: [
              {
                id: 'clip-wide-video',
                kind: 'video',
                sourceRef: { kind: 'asset', assetId: 'asset-wide-video' },
                startMs: 0,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
                sourceDurationMs: 3000,
              },
            ],
          },
        ],
      },
    };

    const edl = compileTimelineToEdl(project);

    expect(edl.segments[0]).toMatchObject({
      clipId: 'clip-wide-video',
      transforms: { fit: 'blur-pad' },
    });
  });

  it('enforces audio cut fades and overlay PTS shifts in the EDL', () => {
    const project: VideoProject = {
      ...projectFixture(),
      timeline: {
        schema: 'neuma.video.timeline.v1',
        durationMs: 6000,
        fps: 30,
        tracks: [
          {
            id: 'track-video-main',
            kind: 'video',
            name: 'Video 1',
            muted: false,
            locked: false,
            order: 0,
            clips: [
              {
                id: 'clip-scene-scene-1',
                kind: 'video',
                sourceRef: { kind: 'scene', sceneId: 'scene-1' },
                sceneId: 'scene-1',
                startMs: 0,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
                transitionToNext: 'fade',
                audioSeamToNext: 'cut',
              },
              {
                id: 'clip-scene-scene-2',
                kind: 'video',
                sourceRef: { kind: 'scene', sceneId: 'scene-2' },
                sceneId: 'scene-2',
                startMs: 3000,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
              },
            ],
          },
          {
            id: 'track-broll',
            kind: 'broll',
            name: 'B-roll',
            muted: false,
            locked: false,
            order: 5,
            clips: [
              {
                id: 'clip-overlay',
                kind: 'video',
                sourceRef: { kind: 'asset', assetId: 'asset-video' },
                sceneId: 'scene-1',
                startMs: 1500,
                durationMs: 1000,
                trimStartMs: 250,
                trimEndMs: 1250,
              },
            ],
          },
          {
            id: 'track-audio-vo',
            kind: 'audio-vo',
            name: 'Voiceover',
            muted: false,
            locked: false,
            order: 10,
            clips: [
              {
                id: 'clip-vo-1',
                kind: 'audio',
                sourceRef: { kind: 'scene', sceneId: 'scene-1' },
                sceneId: 'scene-1',
                startMs: 0,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
                fadeOutMs: 0,
              },
              {
                id: 'clip-vo-2',
                kind: 'audio',
                sourceRef: { kind: 'scene', sceneId: 'scene-2' },
                sceneId: 'scene-2',
                startMs: 3000,
                durationMs: 3000,
                trimStartMs: 0,
                trimEndMs: 3000,
                fadeInMs: 0,
              },
            ],
          },
        ],
      },
    };

    const edl = compileTimelineToEdl(project);

    expect(edl.overlays).toEqual([
      expect.objectContaining({
        id: 'edl-clip-overlay',
        kind: 'broll',
        timelineStartMs: 1500,
        sourceStartMs: 250,
        ptsShiftMs: 1250,
      }),
    ]);
    expect(edl.segments[0]).toMatchObject({
      transitionToNext: { kind: 'fade' },
      audioSeamToNext: 'cut',
    });
    expect(edl.audioTracks[0]?.clips).toEqual([
      expect.objectContaining({ clipId: 'clip-vo-1', fadeOutMs: 30 }),
      expect.objectContaining({ clipId: 'clip-vo-2', fadeInMs: 30 }),
    ]);
  });

  it('persists a migrated timeline on first project load', async () => {
    const project = projectFixture();
    await writeProject(project);

    const loaded = await getProject(project.id);
    const raw = JSON.parse(
      await fs.readFile(
        path.join(workDir, 'videos', project.id, 'project.json'),
        'utf8',
      ),
    ) as VideoProject;

    expect(loaded.timeline?.schema).toBe('neuma.video.timeline.v1');
    expect(loaded.schemaVersion).toBe(2);
    expect(raw.schemaVersion).toBe(2);
    expect(raw.timeline).toEqual(loaded.timeline);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Timeline migration',
    template: 'explainer',
    prompt: 'Make a launch explainer',
    assets: [
      asset('asset-video', 'video', 8000, { frameRate: 24 }),
      asset('asset-narration', 'audio', 6000),
      asset('asset-music', 'audio', 12000),
    ],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    storyboard: {
      status: 'approved',
      intent: 'Launch explainer',
      totalDurationMs: 6000,
      costEstimateUsd: { low: 0, high: 0 },
      music: {
        prompt: 'Warm synth bed',
        durationMs: 12000,
        provider: 'stable-audio',
        assetId: 'asset-music',
      },
      narration: {
        voiceId: 'voice-a',
        provider: 'kokoro',
        assetId: 'asset-narration',
        segments: [
          {
            id: 'narration-1',
            sceneId: 'scene-1',
            text: 'Opening voiceover',
            voiceId: 'voice-a',
            provider: 'kokoro',
          },
          {
            id: 'narration-2',
            sceneId: 'scene-2',
            text: 'Second voiceover',
            voiceId: 'voice-a',
            provider: 'kokoro',
          },
        ],
      },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 2500,
          intent: 'Opening product shot',
          caption: { text: 'Opening caption', style: { position: 'bottom' } },
          transition: 'fade',
          muteAudio: true,
          assetPlan: {
            kind: 'existing',
            assetId: 'asset-video',
            trimMs: [1000, 3500],
          },
        },
        {
          id: 'scene-2',
          durationMs: 3500,
          intent: 'Generated hero still',
          caption: { text: 'Second caption' },
          assetPlan: {
            kind: 'ai-image',
            prompt: 'A crisp product hero still',
            aspectRatio: '16:9',
          },
        },
      ],
    },
    render: { status: 'idle', updatedAt: '2026-05-20T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}

function asset(
  id: string,
  kind: MediaItem['kind'],
  durationMs: number,
  metadata: Partial<MediaItem['metadata']> = {},
): MediaItem {
  return {
    id,
    kind,
    source: 'user',
    path: `videos/project-1/assets/${id}`,
    metadata: { durationMs, ...metadata },
  };
}
