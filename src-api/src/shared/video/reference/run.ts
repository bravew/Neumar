import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import { publishReferenceRunStatus } from '@/shared/video/job-events';
import { renderReferenceProgressMarkdown } from '@/shared/video/reference/progress-markdown';
import {
  atomicWriteJson,
  readReferenceEnvelope,
  referenceProgressPath,
  referenceRunPath,
  writeReferenceText,
} from '@/shared/video/reference/store';
import {
  getProject,
  getVideoProjectDir,
  updateProjectDocument,
} from '@/shared/video/store';
import type {
  PackedTranscriptPayload,
  ReferenceProbe,
  ReferenceRun,
  ReferenceRunFocus,
  ReferenceRunStep,
  ReferenceRunStepId,
  TranscriptData,
  VideoReference,
} from '@/shared/video/types';

import {
  buildEvidence,
  detectReferenceBoundaries,
  transcribeReference,
  writePackedTranscriptForReference,
} from './evidence';
import {
  extractReferenceFramework,
  FrameworkExtractError,
} from './framework-extract';
import { getReferenceReading } from './reading';

export const REFERENCE_RUN_STEP_IDS: readonly ReferenceRunStepId[] = [
  'fetch',
  'probe',
  'transcribe',
  'pack',
  'boundaries',
  'sample',
  'read',
  'extract',
];

const logger = createLogger('ReferenceRun');

const SYSTEM_STEPS = new Set<ReferenceRunStepId>([
  'fetch',
  'probe',
  'transcribe',
  'pack',
  'boundaries',
  'sample',
]);

const abortControllers = new Map<string, AbortController>();

export interface ReferenceRunStepHandlers {
  fetch?: (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>;
  probe?: (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>;
  transcribe?: (
    ctx: ReferenceRunStepContext,
  ) => Promise<ReferenceRunStepResult>;
  pack?: (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>;
  boundaries?: (
    ctx: ReferenceRunStepContext,
  ) => Promise<ReferenceRunStepResult>;
  sample?: (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>;
  read?: (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>;
  extract?: (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>;
}

export interface ReferenceRunStepContext {
  projectId: string;
  reference: VideoReference;
  run: ReferenceRun;
  signal: AbortSignal;
}

export interface ReferenceRunStepResult {
  artifactIds?: string[];
  note?: string;
  /** Not applicable at all — a disabled feature. The step is never retried. */
  skipped?: boolean;
  /**
   * Blocked on work this run cannot do itself. The run parks here instead of
   * closing as `done`, so a later resume picks the step up once the blocker is
   * gone. `note` must say what would unblock it.
   */
  waiting?: boolean;
}

export interface StartReferenceRunInput {
  focus?: { text?: string; ranges?: Array<{ startMs: number; endMs: number }> };
  handlers?: ReferenceRunStepHandlers;
}

export class ReferenceRunError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-found'
      | 'busy'
      | 'cancelled'
      | 'disabled'
      | 'step-failed' = 'step-failed',
  ) {
    super(message);
    this.name = 'ReferenceRunError';
  }
}

export async function readReferenceRun(
  projectId: string,
  referenceId: string,
): Promise<ReferenceRun | null> {
  try {
    const raw = await fs.readFile(
      referenceRunPath(projectId, referenceId),
      'utf8',
    );
    return JSON.parse(raw) as ReferenceRun;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeReferenceRun(
  projectId: string,
  run: ReferenceRun,
): Promise<ReferenceRun> {
  await atomicWriteJson(
    projectId,
    referenceRunPath(projectId, run.referenceId),
    run,
  );
  await writeReferenceText(
    projectId,
    referenceProgressPath(projectId, run.referenceId),
    renderReferenceProgressMarkdown(run),
  );
  publishReferenceRunStatus(run);
  return run;
}

export function requestReferenceRunCancel(runId: string): void {
  abortControllers.get(runId)?.abort();
}

export async function startReferenceRun(
  projectId: string,
  referenceId: string,
  input: StartReferenceRunInput = {},
): Promise<ReferenceRun> {
  if (!getVideoFeatureFlag('video.referenceAnalysis')) {
    throw new ReferenceRunError('Reference analysis is disabled.', 'disabled');
  }
  const reference = await requireReference(projectId, referenceId);
  const existing = await readReferenceRun(projectId, referenceId);
  if (
    existing &&
    (existing.status === 'queued' ||
      existing.status === 'running' ||
      existing.status === 'waiting')
  ) {
    throw new ReferenceRunError(
      existing.status === 'waiting'
        ? 'A reference analysis is parked waiting on input. Resume or unblock it instead of starting a new one.'
        : 'A reference analysis is already running.',
      'busy',
    );
  }
  const now = new Date().toISOString();
  const focus: ReferenceRunFocus | undefined = input.focus?.text
    ? {
        text: input.focus.text,
        ranges: input.focus.ranges,
        revision: (existing?.focus?.revision ?? 0) + 1,
      }
    : existing?.focus;
  const run: ReferenceRun = {
    id: `run-${randomUUID().slice(0, 8)}`,
    referenceId,
    status: 'queued',
    revision: 1,
    sequence: 0,
    steps: REFERENCE_RUN_STEP_IDS.map((id) => ({
      id,
      owner: SYSTEM_STEPS.has(id) ? 'system' : 'agent',
      status: 'queued',
      producedArtifactIds: [],
    })),
    ...(focus ? { focus } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await persistRun(projectId, reference, run);
  return run;
}

export async function attachReferenceRunJobId(
  projectId: string,
  referenceId: string,
  jobId: string,
): Promise<ReferenceRun> {
  const reference = await requireReference(projectId, referenceId);
  const run = await requireRun(projectId, referenceId);
  return persistRun(projectId, reference, {
    ...run,
    jobId,
    revision: run.revision + 1,
    sequence: run.sequence + 1,
    updatedAt: new Date().toISOString(),
  });
}

export async function cancelReferenceRun(
  projectId: string,
  referenceId: string,
): Promise<ReferenceRun> {
  const run = await requireRun(projectId, referenceId);
  requestReferenceRunCancel(run.id);
  const now = new Date().toISOString();
  const next: ReferenceRun = {
    ...run,
    status: 'cancelled',
    revision: run.revision + 1,
    sequence: run.sequence + 1,
    updatedAt: now,
    steps: run.steps.map((step) =>
      step.status === 'running' || step.status === 'queued'
        ? {
            ...step,
            status: 'cancelled' as const,
            endedAt: now,
            note: step.note ?? 'Cancelled by user. Finished artifacts remain.',
          }
        : step,
    ),
  };
  return persistRun(
    projectId,
    await requireReference(projectId, referenceId),
    next,
  );
}

export async function resetReferenceRunForResume(
  projectId: string,
  referenceId: string,
): Promise<ReferenceRun> {
  const run = await requireRun(projectId, referenceId);
  if (run.status === 'running') {
    throw new ReferenceRunError(
      'A reference analysis is already running.',
      'busy',
    );
  }
  const now = new Date().toISOString();
  const next: ReferenceRun = {
    ...run,
    status: 'queued',
    revision: run.revision + 1,
    sequence: run.sequence + 1,
    updatedAt: now,
    steps: run.steps.map((step) =>
      isComplete(step)
        ? step
        : {
            ...step,
            status: 'queued',
            error: undefined,
            startedAt: undefined,
            endedAt: undefined,
          },
    ),
  };
  return persistRun(
    projectId,
    await requireReference(projectId, referenceId),
    next,
  );
}

export async function resumeReferenceRun(
  projectId: string,
  referenceId: string,
  handlers?: ReferenceRunStepHandlers,
): Promise<ReferenceRun> {
  await resetReferenceRunForResume(projectId, referenceId);
  return executeReferenceRun(projectId, referenceId, handlers);
}

/**
 * Resume a run parked on a `waiting` step, if it is parked at all.
 *
 * Called right after the agent persists a reading artifact: that write is
 * exactly the input the parked step was waiting for, so the run advances
 * itself instead of leaving the user to guess that a second Analyze click is
 * what records the work they can already see in the chat.
 *
 * Never throws — the caller's own write already succeeded, and a continuation
 * failure must not be reported as a failed write.
 */
export async function continueWaitingReferenceRun(
  projectId: string,
  referenceId: string,
): Promise<ReferenceRun | null> {
  try {
    const run = await readReferenceRun(projectId, referenceId);
    if (!run || run.status !== 'waiting') return null;
    return await resumeReferenceRun(projectId, referenceId);
  } catch (error) {
    logger.warn('Reference run continuation failed', {
      projectId,
      referenceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function executeReferenceRun(
  projectId: string,
  referenceId: string,
  handlers: ReferenceRunStepHandlers = {},
): Promise<ReferenceRun> {
  const reference = await requireReference(projectId, referenceId);
  let run = await requireRun(projectId, referenceId);
  const controller = new AbortController();
  abortControllers.set(run.id, controller);
  try {
    run = await persistRun(projectId, reference, {
      ...run,
      status: 'running',
      revision: run.revision + 1,
      sequence: run.sequence + 1,
      updatedAt: new Date().toISOString(),
    });
    for (const stepId of REFERENCE_RUN_STEP_IDS) {
      if (controller.signal.aborted) {
        return cancelReferenceRun(projectId, referenceId);
      }
      const current = run.steps.find((step) => step.id === stepId);
      if (!current) {
        throw new ReferenceRunError(
          `Run is missing step "${stepId}".`,
          'step-failed',
        );
      }
      if (isComplete(current)) continue;
      run = await markStep(projectId, reference, run, stepId, {
        status: 'running',
        startedAt: new Date().toISOString(),
        error: undefined,
      });
      try {
        const result = await runStep(stepId, handlers, {
          projectId,
          reference,
          run,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return cancelReferenceRun(projectId, referenceId);
        }
        if (result.waiting) {
          // Park the whole run on the blocked step. Closing as `done` here is
          // what used to orphan the agent's later writes: the step was marked
          // skipped, `isComplete` treated that as final, and no resume could
          // ever pick it back up.
          run = await markStep(projectId, reference, run, stepId, {
            status: 'waiting',
            startedAt: undefined,
            endedAt: undefined,
            producedArtifactIds: result.artifactIds ?? [],
            note: result.note,
          });
          return persistRun(projectId, reference, {
            ...run,
            status: 'waiting',
            revision: run.revision + 1,
            sequence: run.sequence + 1,
            updatedAt: new Date().toISOString(),
          });
        }
        run = await markStep(projectId, reference, run, stepId, {
          status: result.skipped ? 'skipped' : 'done',
          endedAt: new Date().toISOString(),
          producedArtifactIds: result.artifactIds ?? [],
          note: result.note,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run = await persistRun(projectId, reference, {
          ...markLocalStep(run, stepId, {
            status: 'error',
            endedAt: new Date().toISOString(),
            error: { code: 'step-failed', message },
          }),
          status: 'error',
        });
        throw new ReferenceRunError(message, 'step-failed');
      }
    }
    return persistRun(projectId, reference, {
      ...run,
      status: 'done',
      revision: run.revision + 1,
      sequence: run.sequence + 1,
      updatedAt: new Date().toISOString(),
    });
  } finally {
    abortControllers.delete(run.id);
  }
}

function isComplete(step: ReferenceRunStep): boolean {
  return step.status === 'done' || step.status === 'skipped';
}

async function runStep(
  stepId: ReferenceRunStepId,
  handlers: ReferenceRunStepHandlers,
  ctx: ReferenceRunStepContext,
): Promise<ReferenceRunStepResult> {
  const override = handlers[stepId];
  if (override) return override(ctx);
  return defaultHandlers[stepId](ctx);
}

const defaultHandlers: Record<
  ReferenceRunStepId,
  (ctx: ReferenceRunStepContext) => Promise<ReferenceRunStepResult>
> = {
  async fetch(ctx) {
    const mediaPath = path.join(
      getVideoProjectDir(ctx.projectId),
      ctx.reference.mediaPath,
    );
    if (!existsSync(mediaPath)) {
      throw new Error('Reference media is missing.');
    }
    return {
      artifactIds: [ctx.reference.mediaPath],
      note: 'Archive already acquired. Fetch not repeated.',
    };
  },
  async probe(ctx) {
    const probe = await readReferenceEnvelope<ReferenceProbe>(
      ctx.projectId,
      ctx.reference.id,
      'probe',
    );
    if (!probe) throw new Error('Reference probe is missing.');
    return {
      artifactIds: ['probe'],
      note: 'Probe envelope reused.',
    };
  },
  async transcribe(ctx) {
    const existing = await readReferenceEnvelope<TranscriptData>(
      ctx.projectId,
      ctx.reference.id,
      'transcript',
    );
    if (existing) {
      return { artifactIds: ['transcript'], note: 'Transcript reused.' };
    }
    await transcribeReference(ctx.projectId, ctx.reference.id);
    return { artifactIds: ['transcript', 'packed-transcript'] };
  },
  async pack(ctx) {
    const packed = await readReferenceEnvelope<PackedTranscriptPayload>(
      ctx.projectId,
      ctx.reference.id,
      'packed-transcript',
    );
    if (packed) {
      return {
        artifactIds: ['packed-transcript'],
        note: 'Packed transcript reused.',
      };
    }
    const transcript = await readReferenceEnvelope<TranscriptData>(
      ctx.projectId,
      ctx.reference.id,
      'transcript',
    );
    if (!transcript) {
      return {
        skipped: true,
        note: 'Packed transcript skipped because transcription is unavailable.',
      };
    }
    await writePackedTranscriptForReference(
      ctx.projectId,
      ctx.reference,
      transcript.data,
    );
    return { artifactIds: ['packed-transcript'] };
  },
  async boundaries(ctx) {
    const existing = await readReferenceEnvelope(
      ctx.projectId,
      ctx.reference.id,
      'boundaries',
    );
    if (existing) {
      return { artifactIds: ['boundaries'], note: 'Boundaries reused.' };
    }
    await detectReferenceBoundaries(ctx.projectId, ctx.reference.id);
    return { artifactIds: ['boundaries'] };
  },
  async sample(ctx) {
    const existing = await readReferenceEnvelope(
      ctx.projectId,
      ctx.reference.id,
      'evidence',
    );
    if (existing) {
      return { artifactIds: ['evidence'], note: 'Coarse evidence reused.' };
    }
    const durationMs = ctx.reference.durationMs;
    const everyMs = 1000;
    const columns = 4;
    const result = await buildEvidence(ctx.projectId, ctx.reference.id, {
      everyMs,
      columns,
      maxCells: 48,
    });
    const endSec = (durationMs / 1000).toFixed(0);
    const pages = result.item.grid?.pages ?? 1;
    return {
      artifactIds: [result.item.id],
      note: `sampling 0–${endSec} s at 1 s into a ${columns}×${result.item.grid?.rows ?? 3} grid (page 1 of ${pages}, ${result.sampledAtMs.length}/48 cell cap)`,
    };
  },
  async read(ctx) {
    if (!getVideoFeatureFlag('video.referenceSemanticReading')) {
      return {
        skipped: true,
        note: 'Structured reading is off. Transcript and evidence remain available.',
      };
    }
    const reading = await getReferenceReading(ctx.projectId, ctx.reference.id);
    if (reading.analysis && reading.timeline && !reading.analysis.stale) {
      return {
        artifactIds: ['analysis', 'timeline'],
        note: 'Structured reading already on disk.',
      };
    }
    return {
      waiting: true,
      note: 'Waiting for the agent to write the analysis (video_reference_write_analysis) and timeline (video_reference_write_timeline).',
    };
  },
  async extract(ctx) {
    if (!getVideoFeatureFlag('video.referenceSemanticReading')) {
      return {
        skipped: true,
        note: 'Framework extraction is off until structured reading is enabled.',
      };
    }
    try {
      const framework = await extractReferenceFramework(
        ctx.projectId,
        ctx.reference.id,
      );
      return {
        artifactIds: [framework.id],
        note: `Extracted ${framework.sections.length} framework sections.`,
      };
    } catch (error) {
      if (
        error instanceof FrameworkExtractError &&
        (error.code === 'missing-reading' ||
          error.code === 'coverage' ||
          error.code === 'confidence' ||
          error.code === 'stale')
      ) {
        // Recoverable: more or better evidence unblocks extraction, so park the
        // step with the reason rather than declaring the run finished.
        return { waiting: true, note: error.message };
      }
      throw error;
    }
  },
};

async function persistRun(
  projectId: string,
  reference: VideoReference,
  run: ReferenceRun,
): Promise<ReferenceRun> {
  const written = await writeReferenceRun(projectId, run);
  await updateProjectDocument(projectId, (project) => ({
    ...project,
    videoReferences: (project.videoReferences ?? []).map((item) =>
      item.id === reference.id
        ? {
            ...item,
            runId: written.id,
            artifactIds: uniqueIds([
              ...item.artifactIds,
              ...written.steps.flatMap((step) => step.producedArtifactIds),
            ]),
          }
        : item,
    ),
  }));
  return written;
}

async function markStep(
  projectId: string,
  reference: VideoReference,
  run: ReferenceRun,
  stepId: ReferenceRunStepId,
  patch: Partial<ReferenceRunStep>,
): Promise<ReferenceRun> {
  return persistRun(projectId, reference, markLocalStep(run, stepId, patch));
}

function markLocalStep(
  run: ReferenceRun,
  stepId: ReferenceRunStepId,
  patch: Partial<ReferenceRunStep>,
): ReferenceRun {
  const now = new Date().toISOString();
  return {
    ...run,
    revision: run.revision + 1,
    sequence: run.sequence + 1,
    updatedAt: now,
    steps: run.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch } : step,
    ),
  };
}

async function requireReference(
  projectId: string,
  referenceId: string,
): Promise<VideoReference> {
  const reference = (await getProject(projectId)).videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!reference) {
    throw new ReferenceRunError('Reference not found.', 'not-found');
  }
  return reference;
}

async function requireRun(
  projectId: string,
  referenceId: string,
): Promise<ReferenceRun> {
  const run = await readReferenceRun(projectId, referenceId);
  if (!run)
    throw new ReferenceRunError('Reference run not found.', 'not-found');
  return run;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}
