import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/services/ffmpeg', async () => {
  const path = await import('node:path');
  return {
    runFFmpeg: vi.fn(),
    validatePath: vi.fn((filePath: string, root: string) =>
      path.isAbsolute(filePath) ? filePath : path.join(root, filePath),
    ),
  };
});

import { runFFmpeg } from '@/shared/services/ffmpeg';
import type { ProbeResult } from '@/shared/services/ffmpeg';
import {
  buildLoudnessMeasurementArgs,
  buildLoudnessNormalizeArgs,
  buildLoudnormFilter,
  normalizeRenderedAudio,
  parseLoudnormJson,
} from '@/shared/video/audio-normalize';

const mockedRunFFmpeg = vi.mocked(runFFmpeg);

let workDir: string;

describe('video loudness normalization', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-loudness-'));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('builds single-pass and measured loudnorm filters', () => {
    expect(buildLoudnormFilter(-14)).toBe('loudnorm=I=-14:TP=-1.5:LRA=11');
    expect(
      buildLoudnormFilter(
        -16,
        {
          inputI: -25.41,
          inputTruePeak: -3.72,
          inputLra: 6.2,
          inputThreshold: -36.18,
          targetOffset: -0.38,
        },
        { printJson: true },
      ),
    ).toBe(
      [
        'loudnorm=I=-16:TP=-1.5:LRA=11',
        'measured_I=-25.41',
        'measured_TP=-3.72',
        'measured_LRA=6.2',
        'measured_thresh=-36.18',
        'offset=-0.38',
        'linear=true',
        'print_format=json',
      ].join(':'),
    );
  });

  it('builds measurement and stream-copy normalization args', () => {
    expect(buildLoudnessMeasurementArgs('/in.mp4', -14)).toEqual([
      '-nostats',
      '-i',
      '/in.mp4',
      '-map',
      '0:a:0',
      '-vn',
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ]);
    expect(
      buildLoudnessNormalizeArgs('/in.mp4', '/out.mp4', -14, {
        inputI: -24,
        inputTruePeak: -4,
        inputLra: 7,
        inputThreshold: -35,
        targetOffset: 0.5,
      }),
    ).toEqual([
      '-i',
      '/in.mp4',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-map_metadata',
      '0',
      '-map_chapters',
      '0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-af',
      'loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-24:measured_TP=-4:measured_LRA=7:measured_thresh=-35:offset=0.5:linear=true',
      '-movflags',
      '+faststart',
      '/out.mp4',
    ]);
  });

  it('parses FFmpeg loudnorm JSON from stderr', () => {
    expect(parseLoudnormJson(loudnormJson(-28.42, -6.31))).toEqual(
      expect.objectContaining({
        inputI: -28.42,
        inputTruePeak: -6.31,
        targetOffset: 0.12,
      }),
    );
    expect(parseLoudnormJson('no json')).toBeNull();
  });

  it('normalizes rendered audio with two loudness measurements', async () => {
    const outputPath = path.join(workDir, 'render.mp4');
    await fs.writeFile(outputPath, 'original');
    let measurementCount = 0;
    mockedRunFFmpeg.mockImplementation(async (args) => {
      if (args.includes('null')) {
        measurementCount += 1;
        return {
          exitCode: 0,
          stderr:
            measurementCount === 1
              ? loudnormJson(-30, -7)
              : loudnormJson(-14.2, -1.1),
        };
      }
      await fs.writeFile(String(args.at(-1)), 'normalized');
      return { exitCode: 0, stderr: '' };
    });

    const result = await normalizeRenderedAudio({
      root: workDir,
      outputPath,
      probe: probeFixture(true),
      targetLufs: -14,
    });

    expect(await fs.readFile(outputPath, 'utf8')).toBe('normalized');
    expect(result).toEqual({
      loudnessTargetLufs: -14,
      loudnessLufs: -14.2,
      peakDbfs: -1.1,
    });
    expect(mockedRunFFmpeg).toHaveBeenCalledTimes(3);
    expect(mockedRunFFmpeg.mock.calls[1]![0]).toEqual(
      expect.arrayContaining([
        '-af',
        expect.stringContaining('measured_I=-30'),
      ]),
    );
  });

  it('skips outputs without audio streams', async () => {
    const result = await normalizeRenderedAudio({
      root: workDir,
      outputPath: path.join(workDir, 'silent.mp4'),
      probe: probeFixture(false),
      targetLufs: -14,
    });

    expect(result).toBeUndefined();
    expect(mockedRunFFmpeg).not.toHaveBeenCalled();
  });
});

function loudnormJson(inputI: number, inputTp: number): string {
  return `noise before
{
  "input_i" : "${inputI}",
  "input_tp" : "${inputTp}",
  "input_lra" : "5.60",
  "input_thresh" : "-39.80",
  "output_i" : "-14.02",
  "output_tp" : "-1.45",
  "output_lra" : "4.80",
  "output_thresh" : "-24.90",
  "target_offset" : "0.12"
}
noise after`;
}

function probeFixture(hasAudio: boolean): ProbeResult {
  return {
    filePath: '',
    duration: 10,
    size: 1_000_000,
    bitRate: 1_000_000,
    formatName: 'mov,mp4',
    streams: [
      { index: 0, codecType: 'video', codecName: 'h264' },
      ...(hasAudio
        ? [{ index: 1, codecType: 'audio' as const, codecName: 'aac' }]
        : []),
    ],
    videoStreamCount: 1,
    audioStreamCount: hasAudio ? 1 : 0,
    subtitleStreamCount: 0,
    raw: {},
  };
}
