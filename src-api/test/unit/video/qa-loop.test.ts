import { describe, expect, it, vi } from 'vitest';

import {
  runBoundedVideoQaLoop,
  summarizeQaReport,
} from '@/shared/video/qa-loop';
import type {
  RenderOutput,
  RenderStatus,
  VideoProject,
  VideoQaReport,
} from '@/shared/video/types';

describe('bounded video QA loop', () => {
  it('terminates at the hard cap even when QA never passes', async () => {
    const renderProject = vi.fn(async (_projectId: string, _opts?: unknown) =>
      renderStatusFixture(),
    );
    const getProject = vi.fn(async () =>
      projectFixture({
        qaReport: qaReportFixture({
          blackFrames: [{ startMs: 500, endMs: 900, durationMs: 400 }],
        }),
      }),
    );
    const attemptFix = vi.fn(async () => true);

    const result = await runBoundedVideoQaLoop(
      { projectId: 'project-1', maxIterations: 10 },
      { renderProject, getProject, attemptFix },
    );

    expect(result.passes).toBe(false);
    expect(result.maxIterations).toBe(3);
    expect(result.iterations).toHaveLength(3);
    expect(renderProject).toHaveBeenCalledTimes(3);
    expect(attemptFix).toHaveBeenCalledTimes(2);
    expect(result.residualIssues).toEqual([
      expect.objectContaining({ kind: 'black-frame' }),
    ]);
  });

  it('returns pass and sample windows for a clean report', async () => {
    const result = await runBoundedVideoQaLoop(
      { projectId: 'project-1', maxIterations: 3, aspectRatio: '16:9' },
      {
        renderProject: async () => renderStatusFixture(),
        getProject: async () =>
          projectFixture({
            qaReport: qaReportFixture({
              cutBoundaries: [
                {
                  timeMs: 2500,
                  windowStartMs: 1000,
                  windowEndMs: 4000,
                  issues: [],
                },
              ],
            }),
          }),
      },
    );

    expect(result.passes).toBe(true);
    expect(result.iterations).toEqual([
      {
        attempt: 1,
        outputPath: 'renders/out.mp4',
        passes: true,
        issueCount: 0,
        fixApplied: false,
      },
    ]);
    expect(result.sampleWindows.map((window) => window.label)).toEqual([
      'begin',
      'middle',
      'end',
      'cut-boundary',
    ]);
  });

  it('summarizes missing QA reports as errors', () => {
    expect(summarizeQaReport(undefined)).toEqual([
      expect.objectContaining({ kind: 'qa-report-missing', severity: 'error' }),
    ]);
  });

  it('summarizes legacy QA reports without cut-boundary fields', () => {
    const legacyReport = {
      generatedAt: '2026-07-01T00:00:00.000Z',
      blackFrames: [],
      audioClipping: [],
      silentGaps: [],
      missingMedia: [],
    } as VideoQaReport;

    expect(summarizeQaReport(legacyReport)).toEqual([]);
  });
});

function renderStatusFixture(): RenderStatus {
  return {
    status: 'done',
    outputPath: 'renders/out.mp4',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function projectFixture(output: Partial<RenderOutput>): VideoProject {
  return {
    id: 'project-1',
    name: 'QA project',
    template: 'explainer',
    assets: [],
    outputs: [
      {
        aspectRatio: '16:9',
        path: 'renders/out.mp4',
        durationSec: 5,
        fileSize: 1000,
        codec: 'h264',
        ...output,
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function qaReportFixture(
  overrides: Partial<VideoQaReport> = {},
): VideoQaReport {
  return {
    generatedAt: '2026-07-01T00:00:00.000Z',
    blackFrames: [],
    audioClipping: [],
    silentGaps: [],
    missingMedia: [],
    cutBoundaries: [],
    ...overrides,
  };
}
