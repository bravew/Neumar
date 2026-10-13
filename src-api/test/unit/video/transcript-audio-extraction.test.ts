import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ffmpeg = vi.hoisted(() => vi.fn());
vi.mock('@/shared/services/ffmpeg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/services/ffmpeg')>()),
  runFFmpeg: ffmpeg,
}));
import { extractSourceAudioPcm } from '@/shared/video/analysis/transcript';
import type { MediaItem } from '@/shared/video/types';

let tempDir: string;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcript-pcm-'));
  ffmpeg.mockReset();
  ffmpeg.mockImplementation(async (args: string[]) => {
    await fs.writeFile(args.at(-1)!, Buffer.from([0, 0]));
    return { exitCode: 0, stderr: '' };
  });
});
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

it('carries the external asset trust policy into FFmpeg extraction', async () => {
  const mediaPath = path.join(tempDir, 'video.mp4');
  await fs.writeFile(mediaPath, 'fixture');
  const workspaceRoot = path.join(tempDir, 'project');
  const asset = {
    id: 'asset',
    kind: 'video',
    origin: 'external',
    path: mediaPath,
    metadata: { durationMs: 1000, audioTrackCount: 1 },
  } as MediaItem;
  await extractSourceAudioPcm({
    asset,
    workspaceRoot,
    cacheDir: path.join(tempDir, 'cache'),
    durationMs: 1000,
  });
  expect(ffmpeg).toHaveBeenCalledWith(
    expect.arrayContaining([await fs.realpath(mediaPath)]),
    expect.objectContaining({ allowExternalMedia: true }),
  );
});
