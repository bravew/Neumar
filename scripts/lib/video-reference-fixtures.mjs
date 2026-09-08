import { createHash } from 'node:crypto';

export const VIDEO_REFERENCE_FIXTURE_VERSION = 1;

const CREATED_AT = '2026-09-08T00:00:00.000Z';
const FPS = 30;

export const VIDEO_REFERENCE_FIXTURES = [
  'parity',
  'long-render',
  'timeline-1000',
  'offline-media',
  'stale-revision',
  'timebase-range',
];

function baseProject(id, name, durationMs) {
  return {
    schemaVersion: 2,
    revision: 1,
    id,
    name,
    template: 'explainer',
    prompt: `Deterministic ${name} acceptance fixture`,
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs,
      fps: FPS,
      frameRate: { num: FPS, den: 1 },
      tracks: [],
    },
    render: { status: 'idle', updatedAt: CREATED_AT },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function baseTrack(id, kind, order) {
  return {
    id,
    kind,
    name: `Track ${order + 1}`,
    muted: false,
    locked: false,
    order,
    clips: [],
  };
}

function baseClip(id, kind, sourceRef, startMs, durationMs) {
  return {
    id,
    kind,
    sourceRef,
    startMs,
    durationMs,
    trimStartMs: 0,
    trimEndMs: durationMs,
    sourceDurationMs: durationMs,
  };
}

function parityFixture() {
  const project = baseProject('video-parity-v1', 'Video parity v1', 15_000);
  project.assets = [
    {
      id: 'parity-video',
      kind: 'video',
      source: 'user',
      path: 'fixtures/parity-video.mp4',
      metadata: {
        durationMs: 15_000,
        width: 1920,
        height: 1080,
        frameRate: 30,
      },
    },
    {
      id: 'parity-audio',
      kind: 'audio',
      source: 'user',
      path: 'fixtures/parity-audio.wav',
      metadata: { durationMs: 15_000 },
    },
  ];
  project.timeline.tracks = [
    {
      ...baseTrack('parity-video-track', 'video', 0),
      clips: [
        {
          ...baseClip(
            'parity-video-clip',
            'video',
            { kind: 'asset', assetId: 'parity-video' },
            0,
            10_000,
          ),
          transforms: {
            scale: 1.08,
            positionX: 0.04,
            positionY: -0.03,
            rotation: 1.5,
            crop: { top: 0.02, right: 0.03, bottom: 0.04, left: 0.05 },
          },
          playback: { speed: 1.25, reverse: false, pitchCorrection: true },
          transitionToNext: { kind: 'fade', durationMs: 500 },
          effects: {
            schema: 'neuma.video.clip-effects.v1',
            effects: [
              {
                id: '0199255e-88fa-7000-8000-000000000001',
                version: 1,
                kind: 'brightness',
                params: { amount: 0.1 },
              },
            ],
            keyframes: [
              {
                effectId: '0199255e-88fa-7000-8000-000000000001',
                parameter: 'amount',
                keys: [
                  { atMs: 0, value: 0 },
                  { atMs: 5_000, value: 0.1 },
                ],
              },
            ],
          },
        },
        {
          ...baseClip(
            'parity-video-tail',
            'video',
            { kind: 'asset', assetId: 'parity-video' },
            10_000,
            5_000,
          ),
          trimStartMs: 10_000,
          trimEndMs: 15_000,
        },
      ],
    },
    {
      ...baseTrack('parity-overlay-track', 'overlay', 1),
      clips: [
        {
          ...baseClip(
            'parity-html-overlay',
            'overlay',
            { kind: 'scene', sceneId: 'parity-overlay-scene' },
            2_000,
            8_000,
          ),
          params: { renderer: 'html', text: 'Video parity v1' },
          keyframes: [
            {
              property: 'opacity',
              keys: [
                { atMs: 0, value: 0 },
                { atMs: 500, value: 1 },
                { atMs: 7_500, value: 0 },
              ],
            },
          ],
        },
      ],
    },
    {
      ...baseTrack('parity-caption-track', 'caption', 2),
      clips: [
        {
          ...baseClip(
            'parity-caption',
            'caption',
            { kind: 'scene', sceneId: 'parity-caption-scene' },
            1_000,
            4_000,
          ),
          text: 'Deterministic caption fixture',
          style: { position: 'bottom', animation: 'karaoke' },
        },
      ],
    },
    {
      ...baseTrack('parity-audio-track', 'audio-music', 3),
      clips: [
        {
          ...baseClip(
            'parity-audio-clip',
            'audio',
            { kind: 'asset', assetId: 'parity-audio' },
            0,
            15_000,
          ),
          gainDb: -6,
          fadeInMs: 800,
          fadeOutMs: 1_200,
          fadeInCurve: 'equal-power',
          fadeOutCurve: 'ease-in-out',
        },
      ],
    },
  ];
  return project;
}

function longRenderFixture() {
  const project = baseProject(
    'video-long-render-v1',
    'Three minute mixed media',
    180_000,
  );
  project.assets = [
    {
      id: 'long-video',
      kind: 'video',
      source: 'user',
      path: 'fixtures/long-video.mp4',
      metadata: {
        durationMs: 30_000,
        width: 1920,
        height: 1080,
        frameRate: 30,
      },
    },
    {
      id: 'long-image',
      kind: 'image',
      source: 'user',
      path: 'fixtures/long-image.png',
      metadata: { width: 1920, height: 1080 },
    },
    {
      id: 'long-audio',
      kind: 'audio',
      source: 'user',
      path: 'fixtures/long-audio.wav',
      metadata: { durationMs: 180_000 },
    },
  ];
  const videoTrack = baseTrack('long-video-track', 'video', 0);
  for (let index = 0; index < 12; index += 1) {
    videoTrack.clips.push({
      ...baseClip(
        `long-video-${String(index).padStart(2, '0')}`,
        index % 3 === 2 ? 'image' : 'video',
        {
          kind: 'asset',
          assetId: index % 3 === 2 ? 'long-image' : 'long-video',
        },
        index * 15_000,
        15_000,
      ),
      transitionToNext:
        index === 11 ? undefined : { kind: 'fade', durationMs: 400 },
    });
  }
  project.timeline.tracks = [
    videoTrack,
    {
      ...baseTrack('long-audio-track', 'audio-music', 1),
      clips: [
        {
          ...baseClip(
            'long-audio-clip',
            'audio',
            { kind: 'asset', assetId: 'long-audio' },
            0,
            180_000,
          ),
          fadeInMs: 1_000,
          fadeOutMs: 2_000,
        },
      ],
    },
  ];
  return project;
}

function timelineFixture(clipCount = 1_000, trackCount = 12) {
  const project = baseProject(
    'video-timeline-1000-v1',
    'Twelve track timeline benchmark',
    600_000,
  );
  project.assets = [
    {
      id: 'benchmark-video',
      kind: 'video',
      source: 'user',
      path: 'fixtures/benchmark-video.mp4',
      metadata: {
        durationMs: 600_000,
        width: 1920,
        height: 1080,
        frameRate: 30,
      },
    },
  ];
  project.timeline.tracks = Array.from(
    { length: trackCount },
    (_, trackIndex) => {
      const track = baseTrack(
        `benchmark-track-${trackIndex}`,
        'video',
        trackIndex,
      );
      track.clips = Array.from(
        {
          length:
            Math.floor(clipCount / trackCount) +
            (trackIndex < clipCount % trackCount ? 1 : 0),
        },
        (_, clipIndex) => {
          const globalIndex = clipIndex * trackCount + trackIndex;
          const startMs = (globalIndex * 593) % 594_000;
          return {
            ...baseClip(
              `benchmark-clip-${String(globalIndex).padStart(4, '0')}`,
              'video',
              { kind: 'asset', assetId: 'benchmark-video' },
              startMs,
              6_000,
            ),
            params: {
              thumbnailKey: `thumb-${globalIndex % 37}`,
              waveformKey: `wave-${globalIndex % 29}`,
            },
          };
        },
      ).sort(
        (left, right) =>
          left.startMs - right.startMs || left.id.localeCompare(right.id),
      );
      return track;
    },
  );
  return project;
}

function offlineMediaFixture() {
  const project = baseProject(
    'video-offline-media-v1',
    'Offline external master',
    10_000,
  );
  project.assets = [
    {
      id: 'offline-master',
      kind: 'video',
      source: 'user',
      path: '/Volumes/Offline/interview.mov',
      origin: 'external',
      metadata: {
        durationMs: 10_000,
        width: 1920,
        height: 1080,
        frameRate: 30,
        contentHash: 'offline-master-v1',
      },
    },
  ];
  project.timeline.tracks = [
    {
      ...baseTrack('offline-video-track', 'video', 0),
      clips: [
        baseClip(
          'offline-master-clip',
          'video',
          { kind: 'asset', assetId: 'offline-master' },
          0,
          10_000,
        ),
      ],
    },
  ];
  return project;
}

function staleRevisionFixture() {
  const project = baseProject(
    'video-stale-revision-v1',
    'Two stale clients',
    10_000,
  );
  project.revision = 7;
  project.timeline.tracks = [baseTrack('stale-video-track', 'video', 0)];
  return {
    project,
    clients: [
      { id: 'tab-a', expectedProjectRevision: 7, edit: 'append marker A' },
      { id: 'tab-b', expectedProjectRevision: 7, edit: 'append marker B' },
    ],
    expected: {
      firstWriteRevision: 8,
      secondWriteStatus: 409,
      currentRevision: 8,
    },
  };
}

// A 29.97 project with an output range set, plus one clip of every kind that
// has to survive being cut at a range boundary: a transition, a caption, an
// effect stack, audio fades, and a playback-rate clip.
function timebaseRangeFixture() {
  const project = baseProject(
    'video-timebase-range-v1',
    'Video timebase and range v1',
    10_010,
  );
  // 30000/1001 exactly. The compatibility fps is the decimal older readers use.
  project.timeline.fps = 29.97;
  project.timeline.frameRate = { num: 30_000, den: 1001 };
  // Frames 60 through 180 exclusive: two seconds of a ten-second timeline,
  // starting and ending mid-clip so every boundary case is exercised.
  project.timeline.outputRange = { inFrame: 60, outFrameExclusive: 180 };
  project.assets = [
    {
      id: 'range-video-a',
      kind: 'video',
      source: 'user',
      path: 'fixtures/range-a.mp4',
      metadata: {
        durationMs: 6000,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
      },
    },
    {
      id: 'range-video-b',
      kind: 'video',
      source: 'user',
      path: 'fixtures/range-b.mp4',
      metadata: {
        durationMs: 6000,
        width: 1920,
        height: 1080,
        frameRate: 29.97,
      },
    },
    {
      id: 'range-audio',
      kind: 'audio',
      source: 'user',
      path: 'fixtures/range-audio.wav',
      metadata: { durationMs: 10_010 },
    },
  ];
  project.timeline.tracks = [
    {
      ...baseTrack('range-video-track', 'video', 0),
      clips: [
        {
          ...baseClip(
            'range-clip-a',
            'video',
            { kind: 'asset', assetId: 'range-video-a' },
            0,
            4004,
          ),
          // Entrance and transition both sit outside the range and must be
          // dropped rather than replayed against a hard cut.
          entranceMs: 250,
          transitionToNext: { kind: 'fade', durationMs: 500 },
          effects: {
            schema: 'neuma.video.clip-effects.v1',
            effects: [
              { id: 'range-grade', kind: 'exposure', params: { ev: 0.3 } },
            ],
          },
        },
        {
          ...baseClip(
            'range-clip-b',
            'video',
            { kind: 'asset', assetId: 'range-video-b' },
            4004,
            6006,
          ),
          playback: { speed: 1.5, reverse: false, pitchCorrection: true },
        },
      ],
    },
    {
      ...baseTrack('range-audio-track', 'audio-music', 20),
      clips: [
        {
          ...baseClip(
            'range-clip-audio',
            'audio',
            { kind: 'asset', assetId: 'range-audio' },
            0,
            10_010,
          ),
          fadeInMs: 500,
          fadeOutMs: 500,
        },
      ],
    },
    {
      ...baseTrack('range-caption-track', 'caption', 30),
      clips: [
        {
          ...baseClip(
            'range-caption-early',
            'caption',
            { kind: 'scene', sceneId: 'scene-1' },
            0,
            1000,
          ),
          text: 'Before the range',
        },
        {
          ...baseClip(
            'range-caption-straddle',
            'caption',
            { kind: 'scene', sceneId: 'scene-1' },
            1500,
            1500,
          ),
          text: 'Across the in point',
        },
      ],
    },
  ];
  return {
    kind: 'timebase-range',
    project,
    expected: {
      frameRate: { num: 30_000, den: 1001 },
      compatibilityFps: 29.97,
      outputRange: { inFrame: 60, outFrameExclusive: 180 },
      // 120 frames at 30000/1001.
      rangeDurationMs: 4004,
      // range-clip-a survives trimmed at both ends; range-clip-b survives its head.
      survivingSegmentIds: ['range-clip-a', 'range-clip-b'],
      // The early caption ends at 1000ms, before the range starts at 2002ms.
      survivingCaptionIds: ['range-caption-straddle'],
    },
  };
}

export function buildVideoReferenceFixture(name, options = {}) {
  switch (name) {
    case 'parity':
      return parityFixture();
    case 'long-render':
      return longRenderFixture();
    case 'timeline-1000':
      return timelineFixture(
        options.clipCount ?? 1_000,
        options.trackCount ?? 12,
      );
    case 'offline-media':
      return offlineMediaFixture();
    case 'stale-revision':
      return staleRevisionFixture();
    case 'timebase-range':
      return timebaseRangeFixture();
    default:
      throw new Error(`Unknown video reference fixture: ${name}`);
  }
}

export function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

export function fixtureDigest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }
  return value;
}
