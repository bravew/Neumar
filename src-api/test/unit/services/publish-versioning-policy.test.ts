import { describe, expect, it } from 'vitest';

import type { DestinationCapabilities } from '@/shared/services/publish/types';
import {
  VersioningPolicyError,
  resolveTargetPath,
} from '@/shared/services/publish/versioning';

const sha = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

const versioned: DestinationCapabilities = {
  supportsResumable: true,
  supportsVersioning: true,
  requiresReformat: false,
  acceptedMimePrefixes: ['video/'],
  approvalDefault: false,
};

describe('publish versioning policy', () => {
  it('resolves provider-native, content-addressable, timestamped, and overwrite paths', () => {
    expect(
      resolveTargetPath(
        'video.mp4',
        sha,
        { mode: 'provider-native' },
        versioned,
      ),
    ).toEqual({ path: 'video.mp4', mode: 'provider-native' });

    expect(
      resolveTargetPath(
        'video.mp4',
        sha,
        { mode: 'content-addressable' },
        versioned,
      ),
    ).toEqual({ path: 'video_abcdef12.mp4', mode: 'content-addressable' });

    expect(
      resolveTargetPath(
        'video.mp4',
        sha,
        {
          mode: 'timestamped-folder',
          timestampedFolder: { rootPath: '_versions', tsFormat: 'epoch' },
        },
        versioned,
        { now: new Date('2026-05-06T12:00:00.000Z') },
      ),
    ).toEqual({
      path: '_versions/1778068800000/video.mp4',
      mode: 'timestamped-folder',
    });

    expect(
      resolveTargetPath('video.mp4', sha, { mode: 'overwrite' }, versioned),
    ).toEqual({ path: 'video.mp4', mode: 'overwrite' });
  });

  it('rejects provider-native versioning when the destination cannot support it', () => {
    expect(() =>
      resolveTargetPath(
        'video.mp4',
        sha,
        { mode: 'provider-native' },
        { ...versioned, supportsVersioning: false },
      ),
    ).toThrow(VersioningPolicyError);

    expect(() =>
      resolveTargetPath(
        'video.mp4',
        sha,
        { mode: 'provider-native' },
        { ...versioned, versioningEnabled: false },
      ),
    ).toThrow(/Enable bucket versioning/);
  });
});
