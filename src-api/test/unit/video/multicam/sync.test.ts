import { describe, expect, it } from 'vitest';

import {
  parseMulticamManifest,
  type MulticamManifest,
} from '@/shared/video/multicam/manifest';
import {
  buildSyncMap,
  cameraSync,
  referenceMsToCameraMs,
} from '@/shared/video/multicam/sync';

const RATE_2997 = { num: 30_000, den: 1001 };

function manifest(overrides: Record<string, unknown> = {}): MulticamManifest {
  return parseMulticamManifest({
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [
      { id: 'p-ana', name: 'Ana' },
      { id: 'p-ben', name: 'Ben' },
    ],
    cameras: [
      { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      {
        id: 'cam-ana',
        label: 'Ana',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'mic-ana',
        offsetMs: 400,
      },
      {
        id: 'cam-ben',
        label: 'Ben',
        type: 'close',
        assetId: 'asset-ben',
        participantId: 'p-ben',
        isolatedAudioAssetId: 'mic-ben',
        offsetMs: -200,
      },
    ],
    ...overrides,
  });
}

describe('buildSyncMap', () => {
  it('places the reference camera at zero', () => {
    const map = buildSyncMap({
      manifest: manifest(),
      frameRate: 30,
      sourceFingerprint: 'fp',
    });

    expect(cameraSync(map, 'cam-wide')).toMatchObject({
      offsetMs: 0,
      offsetFrames: 0,
      driftPpm: 0,
      method: 'reference',
    });
  });

  it('uses manual offsets when no observations are supplied', () => {
    const map = buildSyncMap({
      manifest: manifest(),
      frameRate: 30,
      sourceFingerprint: 'fp',
    });

    expect(cameraSync(map, 'cam-ana')).toMatchObject({
      offsetMs: 400,
      offsetFrames: 12,
      method: 'manual',
    });
  });

  it('rounds a negative offset toward the right frame', () => {
    const map = buildSyncMap({
      manifest: manifest(),
      frameRate: 30,
      sourceFingerprint: 'fp',
    });

    // -200ms at 30fps is -6 frames, not +6.
    expect(cameraSync(map, 'cam-ben')?.offsetFrames).toBe(-6);
  });

  it('rounds offsets on the project timebase, including NTSC', () => {
    const map = buildSyncMap({
      manifest: manifest(),
      frameRate: RATE_2997,
      sourceFingerprint: 'fp',
    });

    // 400ms at 30000/1001 is 11.988 frames, which rounds to 12.
    expect(cameraSync(map, 'cam-ana')?.offsetFrames).toBe(12);
    expect(map.frameRate).toEqual(RATE_2997);
  });

  it('prefers observations over the manual offset and records the method', () => {
    const map = buildSyncMap({
      manifest: manifest({ syncMode: 'timecode' }),
      frameRate: 30,
      sourceFingerprint: 'fp',
      observations: {
        'cam-ana': [{ atReferenceMs: 0, offsetMs: 1000 }],
      },
    });

    expect(cameraSync(map, 'cam-ana')).toMatchObject({
      offsetMs: 1000,
      method: 'timecode',
    });
  });

  it('carries the source fingerprint so a stale map is detectable', () => {
    const map = buildSyncMap({
      manifest: manifest(),
      frameRate: 30,
      sourceFingerprint: 'fingerprint-abc',
    });

    expect(map.sourceFingerprint).toBe('fingerprint-abc');
  });
});

describe('drift fitting', () => {
  it('recovers a clock that falls behind over an hour', () => {
    // Starts 100ms behind and loses another 200ms across 3,600,000ms.
    const map = buildSyncMap({
      manifest: manifest({ syncMode: 'timecode' }),
      frameRate: 30,
      sourceFingerprint: 'fp',
      observations: {
        'cam-ana': [
          { atReferenceMs: 0, offsetMs: 100 },
          { atReferenceMs: 1_800_000, offsetMs: 200 },
          { atReferenceMs: 3_600_000, offsetMs: 300 },
        ],
      },
    });

    const sync = cameraSync(map, 'cam-ana')!;
    expect(sync.offsetMs).toBeCloseTo(100, 6);
    // 200ms over 3,600,000ms is 55.6 parts per million.
    expect(sync.driftPpm).toBeCloseTo(55.56, 1);
  });

  it('reports no drift from a single observation', () => {
    const map = buildSyncMap({
      manifest: manifest({ syncMode: 'timecode' }),
      frameRate: 30,
      sourceFingerprint: 'fp',
      observations: { 'cam-ana': [{ atReferenceMs: 500, offsetMs: 250 }] },
    });

    // One observation can only ever be a fixed offset; claiming a slope from it
    // would be inventing data.
    expect(cameraSync(map, 'cam-ana')).toMatchObject({
      offsetMs: 250,
      driftPpm: 0,
    });
  });

  it('treats repeated observations at one instant as a fixed offset', () => {
    const map = buildSyncMap({
      manifest: manifest({ syncMode: 'timecode' }),
      frameRate: 30,
      sourceFingerprint: 'fp',
      observations: {
        'cam-ana': [
          { atReferenceMs: 1000, offsetMs: 100 },
          { atReferenceMs: 1000, offsetMs: 120 },
        ],
      },
    });

    expect(cameraSync(map, 'cam-ana')).toMatchObject({
      offsetMs: 110,
      driftPpm: 0,
    });
  });

  it('averages observation confidence', () => {
    const map = buildSyncMap({
      manifest: manifest({ syncMode: 'audio-correlation' }),
      frameRate: 30,
      sourceFingerprint: 'fp',
      observations: {
        'cam-ana': [
          { atReferenceMs: 0, offsetMs: 100, confidence: 0.9 },
          { atReferenceMs: 1000, offsetMs: 100, confidence: 0.5 },
        ],
      },
    });

    expect(cameraSync(map, 'cam-ana')?.confidence).toBeCloseTo(0.7, 6);
  });
});

describe('referenceMsToCameraMs', () => {
  it('applies offset and drift together', () => {
    const projected = referenceMsToCameraMs(
      { offsetMs: 100, driftPpm: 55.56 },
      3_600_000,
    );

    expect(projected).toBeCloseTo(3_600_300, 0);
  });

  it('is the offset alone when there is no drift', () => {
    expect(referenceMsToCameraMs({ offsetMs: -250, driftPpm: 0 }, 5000)).toBe(
      4750,
    );
  });
});
