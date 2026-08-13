import { renderProject, type RenderProjectOptions } from './pipeline';
import { getProject } from './store';
import type {
  AspectRatio,
  RenderOutput,
  RenderStatus,
  VideoProject,
  VideoQaReport,
} from './types';

const MAX_QA_LOOP_ITERATIONS = 3;
const DEFAULT_QA_LOOP_ITERATIONS = 2;
const SAMPLE_WINDOW_MS = 1500;

export interface RunBoundedVideoQaLoopInput {
  projectId: string;
  maxIterations?: number;
  aspectRatio?: AspectRatio;
  renderer?: RenderProjectOptions['renderer'];
  captionMode?: RenderProjectOptions['captionMode'];
  mode?: RenderProjectOptions['mode'];
}

export interface VideoQaResidualIssue {
  kind:
    | 'qa-report-missing'
    | 'black-frame'
    | 'audio-clipping'
    | 'silent-gap'
    | 'missing-media'
    | 'cut-boundary'
    | 'duration-mismatch';
  severity: 'warning' | 'error';
  summary: string;
  startMs?: number;
  endMs?: number;
}

export interface VideoQaSampleWindow {
  id: string;
  label: 'begin' | 'middle' | 'end' | 'cut-boundary';
  startMs: number;
  endMs: number;
}

export interface VideoQaLoopIteration {
  attempt: number;
  outputPath?: string;
  passes: boolean;
  issueCount: number;
  fixApplied: boolean;
}

export interface BoundedVideoQaLoopResult {
  passes: boolean;
  iterations: VideoQaLoopIteration[];
  maxIterations: number;
  residualIssues: VideoQaResidualIssue[];
  sampleWindows: VideoQaSampleWindow[];
}

interface RunBoundedVideoQaLoopDeps {
  renderProject?: (
    projectId: string,
    opts?: RenderProjectOptions,
  ) => Promise<RenderStatus>;
  getProject?: (projectId: string) => Promise<VideoProject>;
  attemptFix?: (input: {
    project: VideoProject;
    report?: VideoQaReport;
    residualIssues: VideoQaResidualIssue[];
    attempt: number;
  }) => Promise<boolean>;
}

export async function runBoundedVideoQaLoop(
  input: RunBoundedVideoQaLoopInput,
  deps: RunBoundedVideoQaLoopDeps = {},
): Promise<BoundedVideoQaLoopResult> {
  const maxIterations = normalizeMaxIterations(input.maxIterations);
  const render = deps.renderProject ?? renderProject;
  const readProject = deps.getProject ?? getProject;
  const iterations: VideoQaLoopIteration[] = [];
  let residualIssues: VideoQaResidualIssue[] = [];
  let sampleWindows: VideoQaSampleWindow[] = [];

  for (let attempt = 1; attempt <= maxIterations; attempt++) {
    const status = await render(input.projectId, {
      aspectRatio: input.aspectRatio,
      renderer: input.renderer,
      captionMode: input.captionMode,
      mode: input.mode ?? 'speed',
    });
    const project = await readProject(input.projectId);
    const output = selectRenderOutput(project, status, input.aspectRatio);
    const report = output?.qaReport;
    residualIssues = summarizeQaReport(report);
    sampleWindows = buildQaSampleWindows(report, output);
    const passes = residualIssues.length === 0;
    let fixApplied = false;

    if (!passes && attempt < maxIterations && deps.attemptFix) {
      fixApplied = await deps.attemptFix({
        project,
        report,
        residualIssues,
        attempt,
      });
    }

    iterations.push({
      attempt,
      outputPath: status.outputPath,
      passes,
      issueCount: residualIssues.length,
      fixApplied,
    });

    if (passes || !fixApplied) break;
  }

  return {
    passes: residualIssues.length === 0,
    iterations,
    maxIterations,
    residualIssues,
    sampleWindows,
  };
}

export function summarizeQaReport(
  report: VideoQaReport | undefined,
): VideoQaResidualIssue[] {
  if (!report) {
    return [
      {
        kind: 'qa-report-missing',
        severity: 'error',
        summary: 'Render completed without a QA report.',
      },
    ];
  }
  return [
    ...report.blackFrames.map((range) => ({
      kind: 'black-frame' as const,
      severity: 'warning' as const,
      startMs: range.startMs,
      endMs: range.endMs,
      summary: `Black frames detected for ${range.durationMs}ms.`,
    })),
    ...report.audioClipping.map((range) => ({
      kind: 'audio-clipping' as const,
      severity: 'warning' as const,
      startMs: range.startMs,
      endMs: range.endMs,
      summary: `Audio clipping detected at ${range.peakDbfs} dBFS.`,
    })),
    ...report.silentGaps.map((range) => ({
      kind: 'silent-gap' as const,
      severity: 'warning' as const,
      startMs: range.startMs,
      endMs: range.endMs,
      summary: `Silent gap detected for ${range.durationMs}ms.`,
    })),
    ...report.missingMedia.map((missing) => ({
      kind: 'missing-media' as const,
      severity: 'error' as const,
      summary: `Missing media for ${missing.sourceRef.kind} source.`,
    })),
    ...(report.cutBoundaries ?? []).flatMap((boundary) =>
      boundary.issues.map((issue) => ({
        kind: 'cut-boundary' as const,
        severity: issue.severity,
        startMs: issue.startMs,
        endMs: issue.endMs,
        summary: `${issue.summary} Boundary at ${boundary.timeMs}ms.`,
      })),
    ),
    ...(report.durationMismatch
      ? [
          {
            kind: 'duration-mismatch' as const,
            severity: 'warning' as const,
            summary: `Rendered duration differs from project duration by ${report.durationMismatch.deltaMs}ms.`,
          },
        ]
      : []),
  ];
}

function buildQaSampleWindows(
  report: VideoQaReport | undefined,
  output: RenderOutput | undefined,
): VideoQaSampleWindow[] {
  const durationMs = Math.max(0, Math.round((output?.durationSec ?? 0) * 1000));
  const middleMs = Math.round(durationMs / 2);
  return uniqueWindows([
    windowAround('begin', 0, durationMs),
    windowAround('middle', middleMs, durationMs),
    windowAround('end', durationMs, durationMs),
    ...(report?.cutBoundaries ?? []).map((boundary) => ({
      id: `cut-boundary-${boundary.timeMs}`,
      label: 'cut-boundary' as const,
      startMs: boundary.windowStartMs,
      endMs: boundary.windowEndMs,
    })),
  ]);
}

function windowAround(
  label: VideoQaSampleWindow['label'],
  centerMs: number,
  durationMs: number,
): VideoQaSampleWindow {
  return {
    id: label,
    label,
    startMs: Math.max(0, centerMs - SAMPLE_WINDOW_MS),
    endMs: Math.min(durationMs, centerMs + SAMPLE_WINDOW_MS),
  };
}

function uniqueWindows(windows: VideoQaSampleWindow[]): VideoQaSampleWindow[] {
  const seen = new Set<string>();
  return windows.filter((window) => {
    const key = `${window.label}:${window.startMs}:${window.endMs}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return window.endMs >= window.startMs;
  });
}

function selectRenderOutput(
  project: VideoProject,
  status: RenderStatus,
  aspectRatio: AspectRatio | undefined,
): RenderOutput | undefined {
  const outputs = project.outputs ?? [];
  if (status.outputPath) {
    const byPath = outputs.find((output) => output.path === status.outputPath);
    if (byPath) return byPath;
  }
  const matchingAspect = aspectRatio
    ? outputs.filter((output) => output.aspectRatio === aspectRatio)
    : outputs;
  return matchingAspect.at(-1) ?? outputs.at(-1);
}

function normalizeMaxIterations(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_QA_LOOP_ITERATIONS;
  }
  return Math.max(1, Math.min(MAX_QA_LOOP_ITERATIONS, Math.floor(value)));
}
