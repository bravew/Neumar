import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BridgeStreamError,
  openBridgeStream,
} from '@/shared/integrations/cloud-storage/personal-media/lan-bridge';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'lan-bridge-stream-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('openBridgeStream', () => {
  it('returns a web stream for local resolutions', async () => {
    const filePath = path.join(tempDir, 'image.jpg');
    await writeFile(filePath, 'hello');

    const stream = openBridgeStream({
      kind: 'local',
      absolutePath: filePath,
      sizeBytes: 5,
      mappingId: 'mapping-1',
    });

    const text = await new Response(stream).text();
    expect(text).toBe('hello');
  });

  it('requires remote fallback for remote resolutions', () => {
    expect(() =>
      openBridgeStream({ kind: 'remote', reason: 'missing_file' }),
    ).toThrow(BridgeStreamError);
  });
});
