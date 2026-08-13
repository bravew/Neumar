import { mkdtemp, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveBridgePath,
  selectMapping,
  type ImmichBridgeAsset,
  type PathMapping,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'lan-bridge-'));
});

afterEach(async () => {
  await import('fs/promises').then(({ rm }) =>
    rm(tempDir, { recursive: true, force: true }),
  );
});

describe('resolveBridgePath', () => {
  it('selects the longest verified mapping and resolves a local file', async () => {
    const nested = path.join(tempDir, 'albums');
    await import('fs/promises').then(({ mkdir }) =>
      mkdir(nested, { recursive: true }),
    );
    await writeFile(path.join(nested, 'image.jpg'), 'hello');

    const mappings = [
      mapping('/usr/src/app/external/', tempDir, 'wide'),
      mapping('/usr/src/app/external/photos/', nested, 'narrow'),
    ];

    const selected = selectMapping(
      asset('/usr/src/app/external/photos/image.jpg', 5),
      mappings,
    );
    expect(selected?.id).toBe('narrow');

    const resolution = await resolveBridgePath({
      asset: asset('/usr/src/app/external/photos/image.jpg', 5),
      mappings,
    });

    expect(resolution).toMatchObject({
      kind: 'local',
      mappingId: 'narrow',
      sizeBytes: 5,
    });
  });

  it('rejects traversal before path resolution', async () => {
    const resolution = await resolveBridgePath({
      asset: asset('/usr/src/app/external/photos/../secret.txt', 5),
      mappings: [mapping('/usr/src/app/external/photos/', tempDir)],
    });

    expect(resolution).toMatchObject({
      kind: 'remote',
      reason: 'path_traversal',
    });
  });

  it('falls back on missing files and size mismatches', async () => {
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello');

    const sizeMismatch = await resolveBridgePath({
      asset: asset('/usr/src/app/external/photos/image.jpg', 999),
      mappings: [mapping('/usr/src/app/external/photos/', tempDir)],
    });
    expect(sizeMismatch).toMatchObject({
      kind: 'remote',
      reason: 'size_mismatch',
    });

    const missing = await resolveBridgePath({
      asset: asset('/usr/src/app/external/photos/missing.jpg', 5),
      mappings: [mapping('/usr/src/app/external/photos/', tempDir)],
    });
    expect(missing).toMatchObject({
      kind: 'remote',
      reason: 'missing_file',
    });
  });

  it('rejects symlink targets', async () => {
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello');
    await symlink(
      path.join(tempDir, 'image.jpg'),
      path.join(tempDir, 'link.jpg'),
    );

    const resolution = await resolveBridgePath({
      asset: asset('/usr/src/app/external/photos/link.jpg', 5),
      mappings: [mapping('/usr/src/app/external/photos/', tempDir)],
    });

    expect(resolution).toMatchObject({
      kind: 'remote',
      reason: 'symlink_rejected',
    });
  });

  it('ignores disabled or unverified mappings', async () => {
    const resolution = await resolveBridgePath({
      asset: asset('/usr/src/app/external/photos/image.jpg', 5),
      mappings: [
        {
          ...mapping('/usr/src/app/external/photos/', tempDir),
          disabled: true,
        },
        {
          ...mapping('/usr/src/app/external/photos/', tempDir),
          verified: false,
        },
      ],
    });

    expect(resolution).toMatchObject({
      kind: 'remote',
      reason: 'no_verified_mapping',
    });
  });
});

function mapping(
  immichPathPrefix: string,
  localMountPath: string,
  id = 'mapping-1',
): PathMapping {
  return {
    id,
    connectionId: 'conn-1',
    immichPathPrefix,
    localMountPath,
    disabled: false,
    verified: true,
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
  };
}

function asset(originalPath: string, fileSizeBytes: number): ImmichBridgeAsset {
  return {
    id: 'asset-1',
    originalPath,
    fileSizeBytes,
    checksum: 'sha1:abc',
  };
}
