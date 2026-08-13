import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPosterFrameArgs,
  generatePosterFrame,
  parseBlackFramePercent,
  posterCandidateTimesMs,
} from '@/shared/video/poster';

let workDir: string;

describe('video poster frames', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-poster-'));
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('chooses a 10 percent default poster time with 25 and 50 percent retries', () => {
    expect(posterCandidateTimesMs(10)).toEqual([1000, 2500, 5000]);
    expect(posterCandidateTimesMs(10, 9_950)).toEqual([9900, 2500, 5000]);
  });

  it('builds the FFmpeg poster extraction args', () => {
    expect(buildPosterFrameArgs('/in.mp4', '/out.jpg', 1250)).toEqual([
      '-ss',
      '1.25',
      '-i',
      '/in.mp4',
      '-frames:v',
      '1',
      '-vf',
      'scale=1280:-2:flags=lanczos',
      '-q:v',
      '4',
      '/out.jpg',
    ]);
  });

  it('parses blackframe percentages from FFmpeg stderr', () => {
    expect(parseBlackFramePercent('frame:1 pblack:98 pts:0')).toBe(98);
    expect(parseBlackFramePercent('no blackframe output')).toBeNull();
  });

  it('retries black poster frames before accepting a candidate', async () => {
    const outputPath = path.join(workDir, 'out.mp4');
    const extractCalls: number[] = [];
    const blackResults = [true, true, false];

    const result = await generatePosterFrame(
      {
        root: workDir,
        outputPath,
        durationSec: 10,
      },
      {
        extractFrame: async ({ atMs }) => {
          extractCalls.push(atMs);
        },
        isBlackFrame: async () => blackResults.shift() ?? false,
      },
    );

    expect(extractCalls).toEqual([1000, 2500, 5000]);
    expect(result).toEqual({
      posterPath: 'out.poster.jpg',
      posterAtMs: 5000,
      blackRetries: 2,
    });
  });
});
