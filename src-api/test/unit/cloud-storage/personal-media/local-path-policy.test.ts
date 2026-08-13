import { mkdir, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolvePersonalMediaMappedPath,
  validatePersonalMediaLocalPathPolicy,
} from '@/shared/integrations/cloud-storage/personal-media/local-path-policy';

let tempDir: string;

beforeEach(async () => {
  tempDir = await import('fs/promises').then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), 'local-path-policy-')),
  );
});

afterEach(async () => {
  await import('fs/promises').then(({ rm }) =>
    rm(tempDir, { recursive: true, force: true }),
  );
});

describe('validatePersonalMediaLocalPathPolicy', () => {
  it('normalizes valid absolute Immich prefixes and mount paths', async () => {
    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: '\\usr\\src\\app\\external\\photos',
        localMountPath: tempDir,
      }),
    ).resolves.toEqual({
      valid: true,
      normalizedImmichPathPrefix: '/usr/src/app/external/photos/',
      normalizedLocalMountPath: path.resolve(tempDir),
    });
  });

  it('rejects relative prefixes and traversal', async () => {
    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: 'usr/src/app/external',
        localMountPath: tempDir,
      }),
    ).resolves.toEqual({
      valid: false,
      reason: 'immich_path_prefix_must_be_absolute',
    });

    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: '/usr/src/app/../secret',
        localMountPath: tempDir,
      }),
    ).resolves.toEqual({ valid: false, reason: 'path_traversal' });
  });

  it('rejects relative, missing, file, and symlink mount paths', async () => {
    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: '/usr/src/app/external',
        localMountPath: 'relative/photos',
      }),
    ).resolves.toEqual({
      valid: false,
      reason: 'local_mount_path_must_be_absolute',
    });

    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: '/usr/src/app/external',
        localMountPath: path.join(tempDir, 'missing'),
      }),
    ).resolves.toEqual({ valid: false, reason: 'local_mount_unavailable' });

    const filePath = path.join(tempDir, 'file.txt');
    await writeFile(filePath, 'not a directory');
    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: '/usr/src/app/external',
        localMountPath: filePath,
      }),
    ).resolves.toEqual({ valid: false, reason: 'local_mount_not_directory' });

    const target = path.join(tempDir, 'target');
    const link = path.join(tempDir, 'link');
    await mkdir(target);
    await symlink(target, link);
    await expect(
      validatePersonalMediaLocalPathPolicy({
        immichPathPrefix: '/usr/src/app/external',
        localMountPath: link,
      }),
    ).resolves.toEqual({
      valid: false,
      reason: 'local_mount_symlink_rejected',
    });
  });
});

describe('resolvePersonalMediaMappedPath', () => {
  it('maps asset paths under the configured mount root', () => {
    expect(
      resolvePersonalMediaMappedPath({
        originalPath: '/usr/src/app/external/photos/image.jpg',
        immichPathPrefix: '/usr/src/app/external/photos',
        localMountPath: tempDir,
      }),
    ).toEqual({
      valid: true,
      normalizedImmichPathPrefix: '/usr/src/app/external/photos/',
      normalizedLocalMountPath: path.resolve(tempDir),
      absolutePath: path.join(tempDir, 'image.jpg'),
    });
  });

  it('rejects prefix mismatches and traversal before resolution', () => {
    expect(
      resolvePersonalMediaMappedPath({
        originalPath: '/usr/src/app/upload/image.jpg',
        immichPathPrefix: '/usr/src/app/external/photos',
        localMountPath: tempDir,
      }),
    ).toEqual({ valid: false, reason: 'prefix_mismatch' });

    expect(
      resolvePersonalMediaMappedPath({
        originalPath: '/usr/src/app/external/photos/../secret.txt',
        immichPathPrefix: '/usr/src/app/external/photos',
        localMountPath: tempDir,
      }),
    ).toEqual({ valid: false, reason: 'path_traversal' });
  });
});
