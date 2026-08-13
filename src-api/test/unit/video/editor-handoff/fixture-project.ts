import fs from 'node:fs/promises';
import path from 'node:path';

import type { TimelineOp } from '@neumar/video-ir';

import type { VideoProject } from '@/shared/video/types';

const PROJECT_ID = 'handoff-fixture';
const CREATED_AT = '2026-06-14T00:00:00.000Z';

export async function createEditorHandoffFixtureProject(
  workDir: string,
): Promise<VideoProject> {
  const assetDir = path.join(workDir, 'videos', PROJECT_ID, 'assets');
  await fs.mkdir(assetDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(assetDir, 'intro & alpha.mp4'), 'video-alpha'),
    fs.writeFile(path.join(assetDir, 'beta.mov'), 'video-beta'),
    fs.writeFile(path.join(assetDir, 'bed.wav'), 'audio-bed'),
    fs.writeFile(path.join(assetDir, 'overlay.png'), 'overlay'),
    fs.writeFile(path.join(assetDir, 'alpha-proxy.mp4'), 'proxy'),
  ]);

  const approvedOps: TimelineOp[] = [
    {
      kind: 'clip.removeTimeRange',
      trackId: 'track-video-main',
      range: { startMs: 1200, endMs: 1800 },
      replacements: [],
      removedClips: [],
      magnetic: true,
    },
  ];

  return {
    schemaVersion: 2,
    id: PROJECT_ID,
    name: 'Editor handoff & "XML" <fixture>',
    template: 'explainer',
    prompt: 'Fixture project',
    assets: [
      {
        id: 'asset-video-alpha',
        kind: 'video',
        source: 'user',
        path: `videos/${PROJECT_ID}/assets/intro & alpha.mp4`,
        metadata: {
          durationMs: 12_000,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: 'h264',
          fileSize: 11,
          audioTrackCount: 1,
        },
        collectionId: 'scene:intro',
        collectionLabel: 'Intro variants',
        provenance: {
          provider: 'seedream-5-0',
          model: 'seedream-5-0',
          jobId: 'job-alpha',
          generatedFor: { sceneId: 'scene-1', rangeMs: [0, 4000] },
          references: [{ kind: 'asset', id: 'asset-overlay' }],
          acceptedOpId: 'hist-approved-silence',
          variantOf: 'scene:intro',
        },
        proxy: {
          path: `videos/${PROJECT_ID}/assets/alpha-proxy.mp4`,
          widthPx: 960,
          heightPx: 540,
          bitrateBps: 1_000_000,
          createdAt: CREATED_AT,
        },
        waveformUrl: `videos/${PROJECT_ID}/assets/alpha.waveform.json`,
      },
      {
        id: 'asset-video-beta',
        kind: 'video',
        source: 'user',
        path: `videos/${PROJECT_ID}/assets/beta.mov`,
        metadata: {
          durationMs: 10_000,
          width: 1920,
          height: 1080,
          frameRate: 30,
          codec: 'prores',
          fileSize: 10,
        },
      },
      {
        id: 'asset-audio-bed',
        kind: 'audio',
        source: 'music',
        path: `videos/${PROJECT_ID}/assets/bed.wav`,
        metadata: {
          durationMs: 16_000,
          sampleRate: 48_000,
          channels: 2,
          fileSize: 9,
        },
        provenance: {
          provider: 'stable-audio',
          model: 'stable-audio-core',
          prompt: 'Low pulse underscore for product reveal',
          generatedFor: { sceneId: 'scene-1', rangeMs: [0, 8_000] },
          acceptedOpId: 'hist-approved-silence',
          license: 'generated',
          commercialUse: true,
        },
      },
      {
        id: 'asset-overlay',
        kind: 'image',
        source: 'user',
        path: `videos/${PROJECT_ID}/assets/overlay.png`,
        metadata: { durationMs: 8_000, width: 1280, height: 720, fileSize: 7 },
        filmstripUrl: `videos/${PROJECT_ID}/assets/overlay-filmstrip.json`,
      },
      {
        id: 'asset-missing',
        kind: 'video',
        source: 'downloaded',
        path: 'catalog:missing-source',
        materializationState: 'referenced',
        metadata: { durationMs: 4_000 },
      },
    ],
    analysisArtifacts: [
      {
        id: 'analysis-beats',
        kind: 'beat-markers',
        sourceMediaId: 'asset-audio-bed',
        summary: 'Detected beats',
        ranges: [{ id: 'beat-1', startMs: 500, endMs: 500, confidence: 0.91 }],
        generatedAt: CREATED_AT,
      },
      {
        id: 'analysis-silence',
        kind: 'silence-ranges',
        sourceMediaId: 'asset-video-alpha',
        summary: 'Silence removal plan',
        ranges: [
          { id: 'silence-1', startMs: 1200, endMs: 1800, confidence: 0.88 },
        ],
        proposedActionBatch: {
          id: 'batch-silence',
          summary: 'Remove silence',
          ops: approvedOps,
        },
        generatedAt: CREATED_AT,
      },
      {
        id: 'analysis-highlight',
        kind: 'highlight-ranges',
        sourceMediaId: 'asset-video-beta',
        summary: 'Highlight range',
        ranges: [
          {
            id: 'highlight-1',
            startMs: 5200,
            endMs: 7300,
            label: 'Product reveal',
            confidence: 0.82,
          },
        ],
        generatedAt: CREATED_AT,
      },
    ],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 8_000,
      markers: [
        {
          id: 'marker-xml',
          timeMs: 0,
          label: 'Intro & launch <beat>',
          color: 'blue',
        },
      ],
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
              id: 'clip-alpha',
              kind: 'video',
              name: 'Intro & <Alpha>',
              sourceRef: { kind: 'asset', assetId: 'asset-video-alpha' },
              startMs: 0,
              durationMs: 4_000,
              trimStartMs: 2_000,
              trimEndMs: 6_000,
              sourceDurationMs: 12_000,
              transitionToNext: { kind: 'fade', durationMs: 500 },
            },
            {
              id: 'clip-beta',
              kind: 'video',
              name: 'Beta "quoted"',
              sourceRef: { kind: 'asset', assetId: 'asset-video-beta' },
              startMs: 4_000,
              durationMs: 4_000,
              trimStartMs: 2_000,
              trimEndMs: 6_000,
              sourceDurationMs: 10_000,
              keyframes: [
                {
                  property: 'scale',
                  keys: [
                    { atMs: 0, value: 1, interp: 'linear' },
                    { atMs: 4_000, value: 1.08, interp: 'smooth' },
                  ],
                },
              ],
              params: {
                speed: 1.25,
                stabilization: true,
                colorGrade: 'warm',
              },
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
          order: 5,
          clips: [
            {
              id: 'clip-overlay',
              kind: 'overlay',
              name: 'Lower third overlay',
              sourceRef: { kind: 'asset', assetId: 'asset-overlay' },
              startMs: 1_000,
              durationMs: 3_000,
              trimStartMs: 0,
              trimEndMs: 3_000,
              sourceDurationMs: 8_000,
              params: {
                unsupportedEffect: 'neon-glow',
                blendMode: 'hard-light',
                motionTracking: true,
              },
            },
            {
              id: 'clip-missing',
              kind: 'video',
              name: 'Missing relink source',
              sourceRef: { kind: 'asset', assetId: 'asset-missing' },
              startMs: 5_000,
              durationMs: 2_000,
              trimStartMs: 0,
              trimEndMs: 2_000,
              sourceDurationMs: 4_000,
            },
          ],
        },
        {
          id: 'track-audio-music',
          kind: 'audio-music',
          name: 'Audio bed',
          muted: false,
          locked: false,
          order: 10,
          volumeDb: -12,
          duckUnderTrackId: 'track-audio-vo',
          clips: [
            {
              id: 'clip-audio-bed',
              kind: 'audio',
              name: 'Audio bed',
              sourceRef: { kind: 'asset', assetId: 'asset-audio-bed' },
              startMs: 0,
              durationMs: 8_000,
              trimStartMs: 0,
              trimEndMs: 8_000,
              sourceDurationMs: 16_000,
              gainDb: -6,
              fadeInMs: 250,
              fadeOutMs: 500,
              fadeInCurve: 'equal-power',
              fadeOutCurve: 'ease-in-out',
              muted: true,
              audioTransitionToNext: {
                kind: 'crossfade',
                durationMs: 300,
                curve: 'equal-power',
              },
            },
          ],
        },
        {
          id: 'track-caption',
          kind: 'caption',
          name: 'Captions',
          muted: false,
          locked: false,
          order: 20,
          clips: [
            {
              id: 'caption-one',
              kind: 'caption',
              name: 'Caption & one',
              sourceRef: { kind: 'scene', sceneId: 'scene-1' },
              startMs: 500,
              durationMs: 1500,
              trimStartMs: 0,
              trimEndMs: 1500,
              text: 'Caption & <one> "quoted"',
              style: { fontFamily: 'Inter', fontSize: 42, color: '#ffffff' },
            },
          ],
        },
      ],
    },
    history: {
      head: 1,
      entries: [
        {
          id: 'hist-approved-silence',
          ts: CREATED_AT,
          op: { kind: 'timeline.batch', ops: approvedOps },
          inverse: { kind: 'timeline.batch', ops: [] },
          source: 'agent',
          summary: 'Approved silence removal',
        },
      ],
    },
    render: { status: 'idle', updatedAt: CREATED_AT },
    outputs: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}
