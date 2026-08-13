import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  verifyBridgeMapping,
  type ImmichBridgeAsset,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'lan-bridge-verifier-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('verifyBridgeMapping', () => {
  it('hashes a resolved local asset before marking the mapping verified', async () => {
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello');

    const result = await verifyBridgeMapping({
      asset: asset('/usr/src/app/external/photos/image.jpg', 5, sha1('hello')),
      mapping: mapping('/usr/src/app/external/photos/', tempDir),
    });

    expect(result).toMatchObject({
      verified: true,
      verificationHash: sha1('hello'),
      resolution: { kind: 'local', sizeBytes: 5 },
    });
  });

  it('rejects checksum mismatches', async () => {
    await writeFile(path.join(tempDir, 'image.jpg'), 'hello');

    const result = await verifyBridgeMapping({
      asset: asset('/usr/src/app/external/photos/image.jpg', 5, sha1('wrong')),
      mapping: mapping('/usr/src/app/external/photos/', tempDir),
    });

    expect(result).toMatchObject({
      verified: false,
      reason: 'checksum_mismatch',
      resolution: { kind: 'local' },
    });
  });

  it('returns resolver failures without reading bytes', async () => {
    const result = await verifyBridgeMapping({
      asset: asset('/usr/src/app/external/photos/missing.jpg', 5, sha1('x')),
      mapping: mapping('/usr/src/app/external/photos/', tempDir),
    });

    expect(result).toMatchObject({
      verified: false,
      reason: 'missing_file',
      resolution: { kind: 'remote', reason: 'missing_file' },
    });
  });
});

function mapping(immichPathPrefix: string, localMountPath: string) {
  return {
    id: 'mapping-1',
    connectionId: 'conn-1',
    immichPathPrefix,
    localMountPath,
  };
}

function asset(
  originalPath: string,
  fileSizeBytes: number,
  checksum: string,
): ImmichBridgeAsset {
  return {
    id: 'asset-1',
    originalPath,
    fileSizeBytes,
    checksum,
  };
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
