import { describe, expect, it } from 'vitest';

import type { ProbeResult } from '@/shared/services/ffmpeg';
import {
  buildAstatsArgs,
  buildBlackdetectArgs,
  buildCutBoundaryFindings,
  buildSilencedetectArgs,
  parseAstatsClippingOutput,
  parseBlackdetectOutput,
  parseSilencedetectOutput,
  runVideoQaReport,
} from '@/shared/video/qa';

describe('video render QA', () => {
  it('builds FFmpeg QA args with machine-readable metadata output', () => {
    expect(buildBlackdetectArgs('/out.mp4')).toEqual([
      '-nostats',
      '-i',
      '/out.mp4',
      '-map',
      '0:v:0',
      '-vf',
      'blackdetect=d=0.5:pic_th=0.95',
      '-an',
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ]);
    expect(buildAstatsArgs('/out.mp4')).toEqual([
      '-nostats',
      '-i',
      '/out.mp4',
      '-map',
      '0:a:0',
      '-vn',
      '-af',
      'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level',
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ]);
    expect(buildSilencedetectArgs('/out.mp4')).toContain(
      'silencedetect=noise=-50dB:duration=2',
    );
  });

  it('parses blackdetect ranges', () => {
    expect(
      parseBlackdetectOutput(
        '[blackdetect @ 0x1] black_start:3.92 black_end:4.44 black_duration:0.52',
      ),
    ).toEqual([{ startMs: 3920, endMs: 4440, durationMs: 520 }]);
  });

  it('parses astats clipping windows from ametadata timestamps', () => {
    expect(
      parseAstatsClippingOutput(
        [
          'frame:0 pts:0 pts_time:0',
          'lavfi.astats.Overall.Peak_level=-1.2',
          'frame:12 pts:48000 pts_time:1',
          'lavfi.astats.Overall.Peak_level=-0.04',
          'frame:24 pts:96000 pts_time:2',
          'lavfi.astats.Overall.Peak_level=-0.02',
          'frame:60 pts:240000 pts_time:5',
          'lavfi.astats.Overall.Peak_level=-0.2',
        ].join('\n'),
        10,
      ),
    ).toEqual([{ startMs: 1000, endMs: 3000, peakDbfs: -0.02 }]);
  });

  it('falls back to full-duration clipping when astats has no timestamps', () => {
    expect(
      parseAstatsClippingOutput(
        '[Parsed_astats_0 @ 0x1] Peak level dB: -0.06',
        12,
      ),
    ).toEqual([{ startMs: 0, endMs: 12000, peakDbfs: -0.06 }]);
  });

  it('parses silencedetect ranges and closes trailing silence', () => {
    expect(
      parseSilencedetectOutput(
        [
          '[silencedetect @ 0x1] silence_start: 2',
          '[silencedetect @ 0x1] silence_end: 4.25 | silence_duration: 2.25',
          '[silencedetect @ 0x1] silence_start: 8',
        ].join('\n'),
        10,
      ),
    ).toEqual([
      { startMs: 2000, endMs: 4250, durationMs: 2250 },
      { startMs: 8000, endMs: 10000, durationMs: 2000 },
    ]);
  });

  it('runs video-only QA without audio passes and preserves missing media', async () => {
    const calls: string[][] = [];
    const report = await runVideoQaReport(
      {
        root: '/work',
        outputPath: '/work/out.mp4',
        probe: probeFixture(false),
        missingMedia: [
          {
            sceneId: 'scene-1',
            sourceRef: { kind: 'asset', assetId: 'missing-asset' },
          },
        ],
      },
      {
        now: () => new Date('2026-05-25T12:00:00.000Z'),
        runFFmpeg: async (args) => {
          calls.push(args);
          return {
            exitCode: 0,
            stderr:
              '[blackdetect @ 0x1] black_start:0 black_end:0.75 black_duration:0.75',
          };
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(report).toEqual({
      generatedAt: '2026-05-25T12:00:00.000Z',
      blackFrames: [{ startMs: 0, endMs: 750, durationMs: 750 }],
      audioClipping: [],
      silentGaps: [],
      missingMedia: [
        {
          sceneId: 'scene-1',
          sourceRef: { kind: 'asset', assetId: 'missing-asset' },
        },
      ],
      cutBoundaries: [],
    });
  });

  it('includes transition degradations when renderer semantics change', async () => {
    const report = await runVideoQaReport(
      {
        root: '/work',
        outputPath: '/work/out.mp4',
        probe: probeFixture(false),
        transitionDegradations: [
          {
            seamIndex: 1,
            requestedKind: 'cube',
            fallbackKind: 'fade',
            renderer: 'ffmpeg',
            projectId: 'project-1',
          },
        ],
      },
      {
        now: () => new Date('2026-05-25T12:00:00.000Z'),
        runFFmpeg: async () => ({
          exitCode: 0,
          stderr: '',
        }),
      },
    );

    expect(report.transitionDegradations).toEqual([
      {
        seamIndex: 1,
        requestedKind: 'cube',
        fallbackKind: 'fade',
        renderer: 'ffmpeg',
        projectId: 'project-1',
      },
    ]);
  });

  it('summarizes cut-boundary windows and duration mismatches', async () => {
    const report = await runVideoQaReport(
      {
        root: '/work',
        outputPath: '/work/out.mp4',
        probe: probeFixture(true),
        cutBoundariesMs: [2000],
        expectedDurationMs: 11_000,
      },
      {
        now: () => new Date('2026-05-25T12:00:00.000Z'),
        runFFmpeg: async (args) => {
          const joined = args.join(' ');
          if (joined.includes('blackdetect')) {
            return {
              exitCode: 0,
              stderr:
                '[blackdetect @ 0x1] black_start:1.5 black_end:2.1 black_duration:0.6',
            };
          }
          if (joined.includes('astats')) {
            return {
              exitCode: 0,
              stderr: [
                'frame:12 pts:48000 pts_time:2',
                'lavfi.astats.Overall.Peak_level=-0.02',
              ].join('\n'),
            };
          }
          return {
            exitCode: 0,
            stderr:
              '[silencedetect @ 0x1] silence_start: 1.8\n[silencedetect @ 0x1] silence_end: 3.2',
          };
        },
      },
    );

    expect(report.cutBoundaries).toEqual([
      expect.objectContaining({
        timeMs: 2000,
        windowStartMs: 500,
        windowEndMs: 3500,
        issues: [
          expect.objectContaining({ kind: 'black-frame' }),
          expect.objectContaining({ kind: 'audio-clipping' }),
          expect.objectContaining({ kind: 'silent-gap' }),
        ],
      }),
    ]);
    expect(report.durationMismatch).toEqual({
      expectedMs: 11000,
      renderedMs: 10000,
      deltaMs: -1000,
      toleranceMs: 250,
    });
  });

  it('builds sorted unique cut-boundary findings', () => {
    expect(
      buildCutBoundaryFindings({
        boundariesMs: [4000, 4000, 1000],
        durationMs: 5000,
        windowMs: 500,
        blackFrames: [{ startMs: 3700, endMs: 4200, durationMs: 500 }],
      }),
    ).toEqual([
      { timeMs: 1000, windowStartMs: 500, windowEndMs: 1500, issues: [] },
      {
        timeMs: 4000,
        windowStartMs: 3500,
        windowEndMs: 4500,
        issues: [expect.objectContaining({ kind: 'black-frame' })],
      },
    ]);
  });
});

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
