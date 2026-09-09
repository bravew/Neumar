import { describe, expect, it } from 'vitest';

import {
  manifestReadiness,
  parseMulticamManifest,
  referenceCamera,
  safeParseMulticamManifest,
  type MulticamManifest,
} from '@/shared/video/multicam/manifest';

function manifestInput(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [
      { id: 'p-ana', name: 'Ana' },
      { id: 'p-ben', name: 'Ben' },
    ],
    cameras: [
      {
        id: 'cam-wide',
        label: 'Wide',
        type: 'wide',
        assetId: 'asset-wide',
      },
      {
        id: 'cam-ana',
        label: 'Ana close',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'asset-ana-mic',
        offsetMs: 120,
      },
      {
        id: 'cam-ben',
        label: 'Ben close',
        type: 'close',
        assetId: 'asset-ben',
        participantId: 'p-ben',
        isolatedAudioAssetId: 'asset-ben-mic',
      },
    ],
    ...overrides,
  };
}

describe('multicam manifest', () => {
  it('parses a complete manifest and fills in policy defaults', () => {
    const manifest = parseMulticamManifest(manifestInput());

    expect(manifest.syncMode).toBe('manual');
    expect(manifest.policy).toMatchObject({
      minShotMs: 1200,
      maxShotMs: 12_000,
      overlapPolicy: 'wide',
      forbidJumpCuts: true,
    });
  });

  it('carries no frame rate of its own', () => {
    const manifest = parseMulticamManifest(manifestInput()) as Record<
      string,
      unknown
    >;

    // A camera group inherits the project timebase. A per-manifest fps is
    // exactly how sync artifacts and the timeline come to disagree.
    expect(manifest).not.toHaveProperty('fps');
    expect(manifest).not.toHaveProperty('frameRate');
  });

  it('reports issues with a path rather than an accumulated string list', () => {
    const result = safeParseMulticamManifest(
      manifestInput({ referenceCameraId: 'cam-missing' }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['referenceCameraId']);
    expect(result.error.issues[0]?.message).toContain('cam-missing');
  });

  it('rejects a close camera with no participant', () => {
    const result = safeParseMulticamManifest(
      manifestInput({
        cameras: [
          { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'a' },
          { id: 'cam-x', label: 'Close', type: 'close', assetId: 'b' },
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([
      'cameras',
      1,
      'participantId',
    ]);
  });

  it('rejects a camera naming a participant that is not in the manifest', () => {
    const result = safeParseMulticamManifest(
      manifestInput({
        cameras: [
          { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'a' },
          {
            id: 'cam-z',
            label: 'Zoe',
            type: 'close',
            assetId: 'b',
            participantId: 'p-zoe',
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('p-zoe');
  });

  it('rejects duplicate camera ids', () => {
    const result = safeParseMulticamManifest(
      manifestInput({
        cameras: [
          { id: 'cam-wide', label: 'A', type: 'wide', assetId: 'a' },
          { id: 'cam-wide', label: 'B', type: 'wide', assetId: 'b' },
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('Duplicate camera id');
  });

  it('requires at least two cameras', () => {
    const result = safeParseMulticamManifest(
      manifestInput({
        cameras: [{ id: 'cam-wide', label: 'A', type: 'wide', assetId: 'a' }],
      }),
    );

    expect(result.success).toBe(false);
  });

  it('rejects a policy whose maximum shot is not longer than its minimum', () => {
    const result = safeParseMulticamManifest(
      manifestInput({ policy: { minShotMs: 5000, maxShotMs: 5000 } }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['policy', 'maxShotMs']);
  });

  it('rejects unknown fields instead of quietly carrying them', () => {
    expect(
      safeParseMulticamManifest(manifestInput({ fps: 29.97 })).success,
    ).toBe(false);
  });

  it('resolves the reference camera', () => {
    const manifest = parseMulticamManifest(manifestInput());

    expect(referenceCamera(manifest).id).toBe('cam-wide');
  });
});

describe('manifest readiness', () => {
  it('accepts a complete automatic group', () => {
    const readiness = manifestReadiness(parseMulticamManifest(manifestInput()));

    expect(readiness).toEqual({ automaticReady: true, blockers: [] });
  });

  it('treats a manual-only group as a readiness blocker, not a schema error', () => {
    const manifest = parseMulticamManifest(
      manifestInput({
        cameras: [
          { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'a' },
          {
            id: 'cam-ana',
            label: 'Ana',
            type: 'close',
            assetId: 'b',
            participantId: 'p-ana',
          },
        ],
      }),
    ) satisfies MulticamManifest;

    const readiness = manifestReadiness(manifest);
    expect(readiness.automaticReady).toBe(false);
    expect(readiness.blockers.join(' ')).toContain('isolated microphone');
  });

  it('names a missing wide fallback', () => {
    const readiness = manifestReadiness(
      parseMulticamManifest(
        manifestInput({
          referenceCameraId: 'cam-ana',
          cameras: [
            {
              id: 'cam-ana',
              label: 'Ana',
              type: 'close',
              assetId: 'a',
              participantId: 'p-ana',
              isolatedAudioAssetId: 'a-mic',
            },
            {
              id: 'cam-ben',
              label: 'Ben',
              type: 'close',
              assetId: 'b',
              participantId: 'p-ben',
              isolatedAudioAssetId: 'b-mic',
            },
          ],
        }),
      ),
    );

    expect(readiness.automaticReady).toBe(false);
    expect(readiness.blockers.join(' ')).toContain('wide camera');
  });
});
