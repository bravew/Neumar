import { randomUUID } from 'crypto';
import { mkdir, symlink } from 'fs/promises';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

import {
  assertNoSymlink,
  getCloudCachePath,
} from '@/shared/integrations/cloud-storage/content';

describe('cloud storage cache paths', () => {
  it('derives paths under the workspace cloud cache root', () => {
    const path = getCloudCachePath(
      {
        provider: 'google_drive',
        connectionId: 'conn-1',
        providerItemId: 'drive:item',
        fingerprint: 'etag-1',
      },
      '/workspace',
    );

    expect(path).toBe(
      '/workspace/.neuma/cloud-cache/google_drive/conn-1/drive%3Aitem/etag-1',
    );
  });

  it('rejects traversal and path separators before resolving', () => {
    expect(() =>
      getCloudCachePath(
        {
          provider: 'google_drive',
          connectionId: 'conn-1',
          providerItemId: '../secret',
          fingerprint: 'etag-1',
        },
        '/workspace',
      ),
    ).toThrow(/Unsafe cloud cache path segment/);
  });

  it('rejects symlink targets', async () => {
    const root = join(
      process.env.TMPDIR ?? '/tmp',
      `cloud-cache-test-${randomUUID()}`,
    );
    await mkdir(root, { recursive: true });
    const linkPath = join(root, 'link');
    await symlink(root, linkPath);

    await expect(assertNoSymlink(linkPath)).rejects.toThrow(/symlink/);
  });
});
