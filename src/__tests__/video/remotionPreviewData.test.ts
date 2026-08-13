import { describe, expect, it } from 'vitest';

import {
  buildRemotionPreviewData,
  buildRemotionPreviewDataSignature,
  compileProjectToEdl,
} from '@/components/video/preview/remotionPreviewData';
import type { VideoProject } from '@/shared/types/video';

describe('remotion preview data', () => {
  it('compiles timeline tracks into deterministic EDL data', () => {
    const edl = compileProjectToEdl(projectFixture());

    expect(edl).toMatchObject({
      schema: 'neuma.video.edl.v1',
      projectId: 'project-1',
      fps: 24,
      durationMs: 6000,
      segments: [
        {
          id: 'edl-clip-video',
          trackId: 'track-video-main',
          timelineStartMs: 0,
          sourceDurationMs: 6000,
          durationMs: 3000,
          transitionToNext: 'wipe',
          filters: { brightness: 1.2, sepia: 0.4 },
          transforms: { fit: 'contain' },
        },
      ],
      overlays: [
        {
          id: 'edl-clip-overlay',
          kind: 'overlay',
          timelineStartMs: 1500,
          durationMs: 2500,
        },
      ],
    });
    expect(edl.audioTracks[0]?.clips[0]).toMatchObject({
      id: 'edl-clip-music',
      timelineStartMs: 0,
      durationMs: 6000,
    });
    expect(edl.captions[0]).toMatchObject({
      id: 'edl-clip-caption',
      startMs: 1000,
      endMs: 4000,
      text: 'A caption',
    });
  });

  it('builds Player-safe dimensions, frame ranges, and asset stream URLs', () => {
    const data = buildRemotionPreviewData(projectFixture(), '9:16');

    expect(data).toMatchObject({
      compositionWidth: 720,
      compositionHeight: 1280,
      fps: 24,
      durationInFrames: 144,
    });
    expect(data.visualClips.map((clip) => clip.id)).toEqual([
      'edl-clip-video',
      'edl-clip-overlay',
    ]);
    expect(data.visualClips[0]).toMatchObject({
      fromFrame: 0,
      sourceStartFrame: 24,
      sourceEndFrame: 96,
      sourceDurationFrames: 144,
      durationInFrames: 72,
      mediaKind: 'video',
      trackId: 'track-video-main',
      trackKind: 'video',
      transitionToNext: 'wipe',
      filters: { brightness: 1.2, sepia: 0.4 },
      transform: { fit: 'contain' },
    });
    expect(data.visualClips[0]?.src).toContain(
      '/video/projects/project-1/assets/asset-video/stream',
    );
    expect(data.visualClips[1]).toMatchObject({
      fromFrame: 36,
      durationInFrames: 60,
      mediaKind: 'image',
    });
    expect(data.audioClips[0]).toMatchObject({
      fromFrame: 0,
      sourceStartFrame: 12,
      sourceEndFrame: 156,
      durationInFrames: 144,
      volume: expect.closeTo(0.501, 3),
    });
    expect(data.captions[0]).toMatchObject({
      fromFrame: 24,
      durationInFrames: 72,
      position: 'bottom',
    });
  });

  it('expands visual source ranges for playback speed', () => {
    const project = projectFixture();
    const clip = project.timeline?.tracks
      .find((track) => track.id === 'track-video-main')
      ?.clips.find((item) => item.id === 'clip-video');
    if (!clip) {
      throw new Error('Expected fixture video clip.');
    }
    clip.durationMs = 2000;
    clip.playback = { speed: 2, reverse: false };

    const data = buildRemotionPreviewData(project, '16:9');
    const video = data.visualClips.find((item) => item.id === 'edl-clip-video');

    expect(video).toMatchObject({
      durationInFrames: 48,
      playback: { speed: 2, reverse: false },
      sourceEndFrame: 120,
      sourceStartFrame: 24,
    });
  });

  it('resolves a scene-sourced visual clip to its existing asset stream', () => {
    const project = projectFixture();
    const videoTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    if (!project.timeline || !videoTrack || videoTrack.kind !== 'video') {
      throw new Error('Expected project fixture video track.');
    }
    // Clip references the scene, not the asset directly; the scene's plan
    // points at a concrete existing asset (asset-video).
    videoTrack.clips[0]!.sourceRef = { kind: 'scene', sceneId: 'scene-1' };

    const data = buildRemotionPreviewData(project, '16:9');
    const clip = data.visualClips.find((item) => item.id === 'edl-clip-video');

    expect(clip?.mediaKind).toBe('video');
    expect(clip?.src).toContain(
      '/video/projects/project-1/assets/asset-video/',
    );
  });

  it('carries image-pan kenBurns into the visual clip for preview animation', () => {
    const project = projectFixture();
    const scene = project.storyboard?.scenes[0];
    const videoTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    if (
      !project.timeline ||
      !scene ||
      !videoTrack ||
      videoTrack.kind !== 'video'
    ) {
      throw new Error('Expected project fixture scene + video track.');
    }
    scene.assetPlan = {
      kind: 'image-pan',
      assetId: 'asset-image',
      kenBurns: {
        from: { x: 0, y: 0, width: 1, height: 1 },
        to: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      },
    };
    videoTrack.clips[0]!.sourceRef = { kind: 'scene', sceneId: scene.id };

    const data = buildRemotionPreviewData(project, '16:9');
    const clip = data.visualClips.find((item) => item.id === 'edl-clip-video');

    expect(clip?.mediaKind).toBe('image');
    expect(clip?.imagePan?.from).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(clip?.imagePan?.to.width).toBe(0.8);
  });

  it('serializes timeline bookend fade durations as preview frames', () => {
    const project = projectFixture();
    if (!project.timeline) {
      throw new Error('Expected project fixture timeline.');
    }
    project.timeline = {
      ...project.timeline,
      intro: { kind: 'fade', durationMs: 500 },
      outro: { kind: 'fade', durationMs: 1000 },
    };

    const data = buildRemotionPreviewData(project, '16:9');

    expect(data.durationInFrames).toBe(144);
    expect(data.introFrames).toBe(12);
    expect(data.outroFrames).toBe(24);
  });

  it('orders visual preview layers by timeline track order', () => {
    const project = projectFixture();
    const overlayTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-overlay',
    );
    const videoTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    if (!project.timeline || !overlayTrack || !videoTrack) {
      throw new Error('Expected project fixture timeline tracks.');
    }
    if (videoTrack.kind !== 'video') {
      throw new Error('Expected video fixture track.');
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

    const data = buildRemotionPreviewData(project, '16:9');

    expect(data.visualClips.map((clip) => clip.id)).toEqual([
      'edl-clip-video',
      'edl-clip-overlay',
      'edl-clip-video-top',
    ]);
  });

  it('adds scene audio fade envelopes for visual transition seams', () => {
    const project = projectFixture();
    const videoTrack = project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    if (!project.timeline || !videoTrack || videoTrack.kind !== 'video') {
      throw new Error('Expected project fixture video track.');
    }
    const baseClip = videoTrack.clips[0]!;
    if (baseClip.kind === 'effect') {
      throw new Error('Expected a visual clip fixture.');
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
            ...baseClip,
            transitionToNext: 'fade',
          },
          {
            ...baseClip,
            id: 'clip-video-2',
            sceneId: 'scene-2',
            startMs: 3000,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
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
        order: 10,
        clips: [
          {
            id: 'clip-vo-1',
            kind: 'audio',
            sourceRef: { kind: 'asset', assetId: 'asset-music' },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
          },
          {
            id: 'clip-vo-2',
            kind: 'audio',
            sourceRef: { kind: 'asset', assetId: 'asset-music' },
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

    const data = buildRemotionPreviewData(project, '16:9');

    expect(data.audioClips).toEqual(
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

  it('keeps the preview data signature stable across render polling noise', () => {
    const project = projectFixture();
    const polledProject: VideoProject = {
      ...structuredClone(project),
      updatedAt: '2026-05-25T12:00:02.000Z',
      render: {
        status: 'running',
        progress: 47,
        message: 'Rendering...',
        updatedAt: '2026-05-25T12:00:02.000Z',
      },
    };

    expect(buildRemotionPreviewDataSignature(project, '16:9')).toBe(
      buildRemotionPreviewDataSignature(polledProject, '16:9'),
    );
  });

  it('does not reset preview data for timeline-only label edits', () => {
    const project = projectFixture();
    const renamedProject = structuredClone(project);
    if (!renamedProject.timeline) {
      throw new Error('Expected project fixture timeline.');
    }
    renamedProject.timeline.tracks[0] = {
      ...renamedProject.timeline.tracks[0]!,
      name: 'Main camera',
    };

    expect(buildRemotionPreviewDataSignature(project, '16:9')).toBe(
      buildRemotionPreviewDataSignature(renamedProject, '16:9'),
    );
  });

  it('changes the preview data signature when clip timing changes', () => {
    const project = projectFixture();
    const movedProject = structuredClone(project);
    const clip = movedProject.timeline?.tracks[0]?.clips[0];
    if (!clip) {
      throw new Error('Expected project fixture clip.');
    }
    clip.startMs = 250;

    expect(buildRemotionPreviewDataSignature(project, '16:9')).not.toBe(
      buildRemotionPreviewDataSignature(movedProject, '16:9'),
    );
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Preview',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'asset-video',
        kind: 'video',
        source: 'user',
        path: 'videos/project-1/assets/video.mp4',
        metadata: { durationMs: 6000, frameRate: 24 },
      },
      {
        id: 'asset-image',
        kind: 'image',
        source: 'user',
        path: 'videos/project-1/assets/image.png',
        metadata: { durationMs: 0 },
      },
      {
        id: 'asset-music',
        kind: 'audio',
        source: 'user',
        path: 'videos/project-1/assets/music.wav',
        metadata: { durationMs: 7000 },
      },
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
        },
      ],
    },
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 6000,
      fps: 24,
      tracks: [
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
              trimStartMs: 500,
              trimEndMs: 6500,
              sourceDurationMs: 7000,
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
              startMs: 1000,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
              text: 'A caption',
              style: { position: 'bottom' },
            },
          ],
        },
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
              id: 'clip-video',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 1000,
              trimEndMs: 4000,
              sourceDurationMs: 6000,
              transitionToNext: 'wipe',
              filters: { brightness: 1.2, sepia: 0.4 },
              transforms: { fit: 'contain' },
            },
          ],
        },
        {
          id: 'track-overlay',
          kind: 'overlay',
          name: 'Overlay',
          muted: false,
          locked: false,
          hidden: false,
          order: 10,
          clips: [
            {
              id: 'clip-overlay',
              kind: 'image',
              sourceRef: { kind: 'asset', assetId: 'asset-image' },
              startMs: 1500,
              durationMs: 2500,
              trimStartMs: 0,
              trimEndMs: 2500,
              sourceDurationMs: 0,
            },
          ],
        },
      ],
    },
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}
