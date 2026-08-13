import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveImportedOverlayItem } from '@/shared/video/overlays/imported-items';
import { buildRemotionRenderInput } from '@/shared/video/remotion-render-input';
import type { MediaItem, VideoProject } from '@/shared/video/types';

let workDir: string;

function lottieBase64(name = 'local-clock'): string {
  return Buffer.from(
    JSON.stringify({
      v: '5.7.4',
      fr: 30,
      ip: 0,
      op: 30,
      w: 128,
      h: 128,
      nm: name,
      ddd: 0,
      assets: [],
      layers: [],
    }),
  ).toString('base64');
}

describe('remotion render input', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-remotion-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('builds a renderer input contract from EDL timing and workspace assets', async () => {
    const project = projectFixture();
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, {
      aspectRatio: '9:16',
      root: workDir,
    });

    expect(input).toMatchObject({
      schema: 'neuma.video.remotion-input.v1',
      projectId: 'project-1',
      aspectRatio: '9:16',
      compositionWidth: 720,
      compositionHeight: 1280,
      durationInFrames: 144,
      fps: 24,
    });
    expect(input.visualClips).toHaveLength(2);
    expect(input.visualClips[0]).toMatchObject({
      id: 'edl-clip-video-main',
      assetId: 'asset-video',
      fromFrame: 0,
      sourceStartFrame: 24,
      sourceEndFrame: 96,
      sourceDurationFrames: 144,
      durationInFrames: 72,
      layer: 0,
      trackId: 'track-video-main',
      mediaKind: 'video',
      trackKind: 'video',
      muted: true,
      transitionToNext: { kind: 'wipe' },
      filters: { contrast: 1.3, grayscale: 0.2 },
      transforms: { fit: 'contain' },
      keyframes: [
        {
          property: 'opacity',
          keys: [
            { atMs: 0, value: 0, interp: 'linear' },
            { atMs: 500, value: 1 },
          ],
        },
      ],
    });
    expect(input.visualClips[0]?.sourcePath).toBe(
      path.join(workDir, 'videos/project-1/assets/video.mp4'),
    );
    expect(input.visualClips[0]?.src).toBe(
      pathToFileURL(path.join(workDir, 'videos/project-1/assets/video.mp4'))
        .href,
    );
    expect(input.visualClips[1]).toMatchObject({
      id: 'edl-clip-overlay',
      assetId: 'asset-overlay',
      fromFrame: 36,
      sourceStartFrame: 12,
      sourceEndFrame: 60,
      durationInFrames: 48,
      layer: 1,
      mediaKind: 'video',
      trackKind: 'broll',
    });
    expect(input.audioClips).toEqual([
      expect.objectContaining({
        id: 'edl-clip-music',
        assetId: 'asset-music',
        fromFrame: 0,
        sourceStartFrame: 6,
        sourceEndFrame: 150,
        durationInFrames: 144,
        role: 'music',
        volume: expect.closeTo(0.501, 3),
        trackVolumeDb: -6,
        keyframes: [
          {
            property: 'volumeDb',
            keys: [
              { atMs: 0, value: -12, interp: 'linear' },
              { atMs: 1000, value: 0 },
            ],
          },
        ],
        fadeInFrames: 1,
        fadeOutFrames: 1,
      }),
    ]);
    expect(input.captions).toEqual([
      expect.objectContaining({
        id: 'edl-clip-caption',
        fromFrame: 24,
        durationInFrames: 72,
        text: 'A caption',
        position: 'middle',
        keyframes: [
          {
            property: 'textOpacity',
            keys: [
              { atMs: 0, value: 0, interp: 'linear' },
              { atMs: 250, value: 1 },
            ],
          },
        ],
      }),
    ]);
  });

  it('serializes timeline bookend fade durations for Remotion render', async () => {
    const project = projectFixture();
    if (!project.timeline) {
      throw new Error('Expected project fixture timeline.');
    }
    project.timeline = {
      ...project.timeline,
      intro: { kind: 'fade', durationMs: 500 },
      outro: { kind: 'fade', durationMs: 1000 },
    };
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, { root: workDir });

    expect(input.durationInFrames).toBe(144);
    expect(input.introFrames).toBe(12);
    expect(input.outroFrames).toBe(24);
  });

  it('can omit captions for sidecar-only renders', async () => {
    const project = projectFixture();
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, {
      includeCaptions: false,
      root: workDir,
    });

    expect(input.captions).toEqual([]);
  });

  it('embeds gif overlay asset bytes for headless render input', async () => {
    const project = projectFixture();
    project.assets.push(asset('asset-gif', 'image', 'assets/sticker.gif', 800));
    project.timeline?.tracks.push({
      id: 'track-overlay',
      kind: 'overlay',
      name: 'Overlay',
      muted: false,
      locked: false,
      hidden: false,
      order: 40,
      clips: [
        {
          id: 'clip-gif-overlay',
          kind: 'effect',
          effectType: 'vivid-overlay',
          sourceRef: {
            kind: 'asset',
            assetId: 'vivid-overlay-preset:sticker.gif',
          },
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
          params: {
            presetId: 'sticker.gif',
            backend: 'gif',
            sourceAssetId: 'asset-gif',
            controls: {},
            loop: 'loop',
          },
        },
      ],
    });
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, { root: workDir });

    expect(input.vividOverlays).toHaveLength(1);
    expect(input.vividOverlays?.[0]?.sourceAsset).toEqual({
      base64: Buffer.from('asset-gif\n').toString('base64'),
      mimeType: 'image/gif',
    });
  });

  it('embeds imported Lottie overlay asset bytes for headless render input', async () => {
    const project = projectFixture();
    const imported = await saveImportedOverlayItem({
      name: 'Loading sand clock',
      fileName: 'Loading sand clock.json',
      mimeType: 'application/json',
      dataBase64: lottieBase64('Loading sand clock'),
    });
    project.timeline?.tracks.push({
      id: 'track-overlay-imported-lottie',
      kind: 'overlay',
      name: 'Overlay',
      muted: false,
      locked: false,
      hidden: false,
      order: 40,
      clips: [
        {
          id: 'clip-imported-lottie-overlay',
          kind: 'effect',
          effectType: 'vivid-overlay',
          sourceRef: {
            kind: 'asset',
            assetId: `vivid-overlay-preset:imported.lottie:${imported.id}`,
          },
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
          params: {
            presetId: 'imported.lottie',
            backend: 'lottie',
            sourceAssetId: imported.id,
            controls: {},
            loop: 'loop',
          },
        },
      ],
    });
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, { root: workDir });

    expect(input.vividOverlays).toHaveLength(1);
    expect(input.vividOverlays?.[0]?.sourceAsset).toEqual({
      base64: lottieBase64('Loading sand clock'),
      mimeType: 'application/json',
    });
  });

  it('expands visual source ranges for playback speed', async () => {
    const project = projectFixture();
    const clip = project.timeline?.tracks
      .find((track) => track.id === 'track-video-main')
      ?.clips.find((item) => item.id === 'clip-video-main');
    if (!clip) {
      throw new Error('Expected fixture video clip.');
    }
    clip.durationMs = 2000;
    clip.playback = { speed: 2, reverse: false };
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, { root: workDir });
    const video = input.visualClips.find(
      (item) => item.id === 'edl-clip-video-main',
    );

    expect(video).toMatchObject({
      durationInFrames: 48,
      playback: { speed: 2, reverse: false },
      sourceEndFrame: 120,
      sourceStartFrame: 24,
    });
  });

  it('orders render visual layers by timeline track order', async () => {
    const project = projectFixture();
    const videoTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    if (!project.timeline || !videoTrack || videoTrack.kind !== 'video') {
      throw new Error('Expected project fixture video track.');
    }
    project.timeline.tracks = [
      ...project.timeline.tracks,
      {
        ...videoTrack,
        id: 'track-video-top',
        name: 'Video 2',
        order: 20,
        clips: [
          {
            ...videoTrack.clips[0]!,
            id: 'clip-video-top',
            startMs: 500,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
          },
        ],
      },
    ];
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, { root: workDir });

    expect(input.visualClips.map((clip) => clip.id)).toEqual([
      'edl-clip-video-main',
      'edl-clip-overlay',
      'edl-clip-video-top',
    ]);
  });

  it('serializes scene audio seam fade envelopes for Remotion render', async () => {
    const project = projectFixture();
    project.assets.push(
      asset('asset-voice', 'audio', 'assets/voice.wav', 6000),
    );
    const videoTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    if (!project.timeline || !videoTrack || videoTrack.kind !== 'video') {
      throw new Error('Expected project fixture video track.');
    }
    project.storyboard?.scenes.push({
      id: 'scene-2',
      durationMs: 3000,
      intent: 'Second',
      assetPlan: { kind: 'existing', assetId: 'asset-video' },
    });
    project.timeline.tracks = [
      {
        ...videoTrack,
        clips: [
          {
            ...videoTrack.clips[0]!,
            transitionToNext: 'fade',
          },
          {
            ...videoTrack.clips[0]!,
            id: 'clip-video-second',
            sceneId: 'scene-2',
            startMs: 3000,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
            muted: undefined,
            transitionToNext: undefined,
            filters: undefined,
          },
        ],
      },
      {
        id: 'track-audio-vo',
        kind: 'audio-vo',
        name: 'Voiceover',
        muted: false,
        locked: false,
        order: 5,
        clips: [
          {
            id: 'clip-vo-1',
            kind: 'audio',
            sourceRef: { kind: 'asset', assetId: 'asset-voice' },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
          },
          {
            id: 'clip-vo-2',
            kind: 'audio',
            sourceRef: { kind: 'asset', assetId: 'asset-voice' },
            sceneId: 'scene-2',
            startMs: 3000,
            durationMs: 3000,
            trimStartMs: 3000,
            trimEndMs: 6000,
          },
        ],
      },
      ...project.timeline.tracks.filter(
        (track) => track.id !== 'track-video-main',
      ),
    ];
    await createAssetFiles(project);

    const input = await buildRemotionRenderInput(project, { root: workDir });

    expect(input.audioClips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'edl-clip-vo-1',
          fadeOutFrames: 12,
        }),
        expect.objectContaining({
          id: 'edl-clip-vo-2',
          fadeInFrames: 12,
        }),
      ]),
    );
  });
});

async function createAssetFiles(project: VideoProject): Promise<void> {
  await Promise.all(
    project.assets.map(async (asset) => {
      const filePath = path.join(workDir, asset.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${asset.id}\n`);
    }),
  );
}

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Remotion input',
    template: 'explainer',
    prompt: '',
    assets: [
      asset('asset-video', 'video', 'assets/video.mp4', 6000),
      asset('asset-overlay', 'video', 'assets/overlay.mp4', 4000),
      asset('asset-music', 'audio', 'assets/music.wav', 7000),
    ],
    storyboard: {
      status: 'approved',
      intent: 'Preview',
      totalDurationMs: 6000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 3000,
          intent: 'Opening',
          assetPlan: { kind: 'existing', assetId: 'asset-video' },
          muteAudio: true,
        },
      ],
    },
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 6000,
      fps: 24,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          hidden: false,
          order: 0,
          clips: [
            {
              id: 'clip-video-main',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 1000,
              trimEndMs: 4000,
              sourceDurationMs: 6000,
              transitionToNext: 'wipe',
              filters: { contrast: 1.3, grayscale: 0.2 },
              transforms: { fit: 'contain' },
              keyframes: [
                {
                  property: 'opacity',
                  keys: [
                    { atMs: 0, value: 0, interp: 'linear' },
                    { atMs: 500, value: 1 },
                  ],
                },
              ],
              muted: true,
            },
          ],
        },
        {
          id: 'track-broll',
          kind: 'broll',
          name: 'B-roll',
          muted: false,
          locked: false,
          hidden: false,
          order: 10,
          clips: [
            {
              id: 'clip-overlay',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-overlay' },
              sceneId: 'scene-1',
              startMs: 1500,
              durationMs: 2000,
              trimStartMs: 500,
              trimEndMs: 2500,
              sourceDurationMs: 4000,
            },
          ],
        },
        {
          id: 'track-audio-music',
          kind: 'audio-music',
          name: 'Music',
          muted: false,
          locked: false,
          order: 20,
          volumeDb: -6,
          clips: [
            {
              id: 'clip-music',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'asset-music' },
              startMs: 0,
              durationMs: 6000,
              trimStartMs: 250,
              trimEndMs: 6250,
              sourceDurationMs: 7000,
              keyframes: [
                {
                  property: 'volumeDb',
                  keys: [
                    { atMs: 0, value: -12, interp: 'linear' },
                    { atMs: 1000, value: 0 },
                  ],
                },
              ],
              fadeInMs: 30,
              fadeOutMs: 30,
            },
          ],
        },
        {
          id: 'track-caption-main',
          kind: 'caption',
          name: 'Captions',
          muted: false,
          locked: false,
          order: 30,
          clips: [
            {
              id: 'clip-caption',
              kind: 'caption',
              sourceRef: { kind: 'scene', sceneId: 'scene-1' },
              sceneId: 'scene-1',
              startMs: 1000,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
              text: 'A caption',
              keyframes: [
                {
                  property: 'textOpacity',
                  keys: [
                    { atMs: 0, value: 0, interp: 'linear' },
                    { atMs: 250, value: 1 },
                  ],
                },
              ],
              style: { position: 'middle' },
            },
          ],
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
  filePath: string,
  durationMs: number,
): MediaItem {
  return {
    id,
    kind,
    source: 'user',
    path: `videos/project-1/${filePath}`,
    metadata: { durationMs },
  };
}
