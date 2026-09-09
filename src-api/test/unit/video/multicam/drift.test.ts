import { describe, expect, it } from 'vitest';

import {
  fingerprintMatches,
  multicamFingerprint,
} from '@/shared/video/multicam/fingerprint';
import {
  parseMulticamManifest,
  type MulticamManifest,
} from '@/shared/video/multicam/manifest';
import { fitDrift } from '@/shared/video/multicam/sync';

function manifest(overrides: Record<string, unknown> = {}): MulticamManifest {
  return parseMulticamManifest({
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [{ id: 'p-ana', name: 'Ana' }],
    cameras: [
      { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      {
        id: 'cam-ana',
        label: 'Ana',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'mic-ana',
      },
    ],
    ...overrides,
  });
}

describe('fitDrift', () => {
  it('returns nothing useful with no observations', () => {
    expect(fitDrift([])).toEqual({
      offsetMs: 0,
      driftPpm: 0,
      confidence: 0,
    });
  });

  it('recovers the intercept and slope of a drifting clock', () => {
    const fit = fitDrift([
      { atReferenceMs: 0, offsetMs: 0 },
      { atReferenceMs: 1_000_000, offsetMs: 50 },
      { atReferenceMs: 2_000_000, offsetMs: 100 },
    ]);

    expect(fit.offsetMs).toBeCloseTo(0, 6);
    expect(fit.driftPpm).toBeCloseTo(50, 6);
  });

  it('fits through noisy observations rather than trusting the last one', () => {
    const fit = fitDrift([
      { atReferenceMs: 0, offsetMs: 100 },
      { atReferenceMs: 1_000_000, offsetMs: 155 },
      { atReferenceMs: 2_000_000, offsetMs: 195 },
      { atReferenceMs: 3_000_000, offsetMs: 255 },
    ]);

    // A least-squares line, not the final sample: one bad measurement at the
    // end of a long recording must not redefine the whole clock. The exact fit
    // through these four points is 100.5ms + 50.5ppm.
    expect(fit.offsetMs).toBeCloseTo(100.5, 6);
    expect(fit.driftPpm).toBeCloseTo(50.5, 6);
  });

  it('handles a clock that runs fast', () => {
    const fit = fitDrift([
      { atReferenceMs: 0, offsetMs: 0 },
      { atReferenceMs: 1_000_000, offsetMs: -30 },
    ]);

    expect(fit.driftPpm).toBeCloseTo(-30, 6);
  });
});

describe('multicam fingerprint', () => {
  const sources = { 'asset-wide': 'sha-wide', 'asset-ana': 'sha-ana' };

  it('is stable across runs', () => {
    const first = multicamFingerprint({
      manifest: manifest(),
      sourceIdentities: sources,
    });
    const second = multicamFingerprint({
      manifest: manifest(),
      sourceIdentities: sources,
    });

    expect(first).toBe(second);
  });

  it('ignores camera ordering and source key ordering', () => {
    const reordered = parseMulticamManifest({
      schema: 'neuma.video.multicam-manifest.v1',
      id: 'group-1',
      label: 'Panel',
      referenceCameraId: 'cam-wide',
      participants: [{ id: 'p-ana', name: 'Ana' }],
      cameras: [
        {
          id: 'cam-ana',
          label: 'Ana',
          type: 'close',
          assetId: 'asset-ana',
          participantId: 'p-ana',
          isolatedAudioAssetId: 'mic-ana',
        },
        { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      ],
    });

    expect(
      multicamFingerprint({
        manifest: reordered,
        sourceIdentities: { 'asset-ana': 'sha-ana', 'asset-wide': 'sha-wide' },
      }),
    ).toBe(
      multicamFingerprint({ manifest: manifest(), sourceIdentities: sources }),
    );
  });

  it('does not change when only a label changes', () => {
    // Renaming a camera group must not invalidate an hour of analysis.
    expect(
      multicamFingerprint({
        manifest: manifest({ label: 'Renamed panel' }),
        sourceIdentities: sources,
      }),
    ).toBe(
      multicamFingerprint({ manifest: manifest(), sourceIdentities: sources }),
    );
  });

  it('changes when a source asset changes behind the same camera id', () => {
    expect(
      multicamFingerprint({
        manifest: manifest(),
        sourceIdentities: { ...sources, 'asset-ana': 'sha-ana-v2' },
      }),
    ).not.toBe(
      multicamFingerprint({ manifest: manifest(), sourceIdentities: sources }),
    );
  });

  it('changes when the policy changes', () => {
    expect(
      multicamFingerprint({
        manifest: manifest({ policy: { minShotMs: 3000 } }),
        sourceIdentities: sources,
      }),
    ).not.toBe(
      multicamFingerprint({ manifest: manifest(), sourceIdentities: sources }),
    );
  });

  it('changes when an upstream artifact changes', () => {
    expect(
      multicamFingerprint({
        manifest: manifest(),
        sourceIdentities: sources,
        parents: ['sync-v2'],
      }),
    ).not.toBe(
      multicamFingerprint({
        manifest: manifest(),
        sourceIdentities: sources,
        parents: ['sync-v1'],
      }),
    );
  });

  it('compares an artifact fingerprint against the expected one', () => {
    const expected = multicamFingerprint({
      manifest: manifest(),
      sourceIdentities: sources,
    });

    expect(fingerprintMatches(expected, expected)).toBe(true);
    expect(fingerprintMatches(undefined, expected)).toBe(false);
    expect(fingerprintMatches('stale', expected)).toBe(false);
  });
});
