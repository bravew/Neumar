import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { acquireReference } from '@/shared/video/reference/acquire';
import {
  REFERENCE_RUN_STEP_IDS,
  cancelReferenceRun,
  executeReferenceRun,
  readReferenceRun,
  resumeReferenceRun,
  SAMPLE_CELL_CEILING,
  sampleStepEveryMs,
  startReferenceRun,
  type ReferenceRunStepHandlers,
} from '@/shared/video/reference/run';
import { readReferenceEnvelope } from '@/shared/video/reference/store';
import { createProject } from '@/shared/video/store';
import type { EvidenceItem } from '@/shared/video/types';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

const instantHandlers: ReferenceRunStepHandlers = {
  transcribe: async () => ({ artifactIds: ['transcript'], note: 'fake asr' }),
  pack: async () => ({ artifactIds: ['packed-transcript'] }),
  boundaries: async () => ({ artifactIds: ['boundaries'] }),
  sample: async () => ({
    artifactIds: ['evidence'],
    note: 'sampling 0–8 s at 1 s into a 4×2 grid (page 1 of 1, 8/48 cell cap)',
  }),
};

describe('reference analysis run', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-run-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('runs steps in order, skips completed work on resume, and keeps artifacts after cancel', async () => {
    const project = await createProject({
      name: 'Reference run',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });

    const started = await startReferenceRun(project.id, reference.id, {
      focus: { text: 'opening titles' },
    });
    expect(started.steps.map((step) => step.id)).toEqual([
      ...REFERENCE_RUN_STEP_IDS,
    ]);
    expect(started.focus?.text).toBe('opening titles');

    const done = await executeReferenceRun(
      project.id,
      reference.id,
      instantHandlers,
    );
    // The agent-owned `read` step parks the run instead of closing it as done:
    // the agent has not written the reading yet, and a `done` run could never
    // pick that work up afterwards.
    expect(done.status).toBe('waiting');
    expect(done.steps.map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'waiting',
      'queued',
    ]);
    expect(done.steps.find((step) => step.id === 'read')?.note).toContain(
      'video_reference_write_analysis',
    );
    expect(done.steps.find((step) => step.id === 'sample')?.note).toContain(
      'cell cap',
    );

    const calls: string[] = [];
    const tracking: ReferenceRunStepHandlers = {
      fetch: async () => {
        calls.push('fetch');
        return { artifactIds: ['media'] };
      },
      transcribe: async () => {
        calls.push('transcribe');
        return { artifactIds: ['transcript'] };
      },
    };
    await resumeReferenceRun(project.id, reference.id, {
      ...instantHandlers,
      ...tracking,
    });
    expect(calls).toEqual([]);

    // A parked run blocks a fresh start same as a running one does; cancel it
    // first, the way the UI's Cancel control would, before starting anew.
    await cancelReferenceRun(project.id, reference.id);
    const failing = await startReferenceRun(project.id, reference.id);
    await executeReferenceRun(project.id, reference.id, {
      transcribe: async () => {
        throw new Error('boom');
      },
    }).catch(() => undefined);
    const errored = await readReferenceRun(project.id, failing.referenceId);
    expect(errored?.status).toBe('error');
    expect(
      errored?.steps.find((step) => step.id === 'transcribe')?.error?.message,
    ).toBe('boom');
    const resumed = await resumeReferenceRun(project.id, reference.id, {
      ...instantHandlers,
      transcribe: async () => ({ artifactIds: ['transcript'], note: 'retry' }),
    });
    expect(resumed.status).toBe('waiting');
    expect(resumed.steps.find((step) => step.id === 'fetch')?.status).toBe(
      'done',
    );

    await cancelReferenceRun(project.id, reference.id);
    const cancellable = await startReferenceRun(project.id, reference.id);
    const running = executeReferenceRun(project.id, reference.id, {
      transcribe: async () => {
        await cancelReferenceRun(project.id, reference.id);
        return { artifactIds: ['transcript'] };
      },
    });
    const cancelled = await running;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.steps.some((step) => step.status === 'done')).toBe(true);
    expect(cancellable.id).toBeTruthy();
  });
  it('resumes a parked run once the agent-owned work exists', async () => {
    const project = await createProject({
      name: 'Parked run',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    await startReferenceRun(project.id, reference.id);
    const parked = await executeReferenceRun(
      project.id,
      reference.id,
      instantHandlers,
    );
    expect(parked.status).toBe('waiting');

    // Stand in for the agent's writes landing on disk between the two passes.
    const withReading: ReferenceRunStepHandlers = {
      ...instantHandlers,
      read: async () => ({
        artifactIds: ['analysis', 'timeline'],
        note: 'Structured reading already on disk.',
      }),
      extract: async () => ({
        artifactIds: ['framework-1'],
        note: 'Extracted 3 framework sections.',
      }),
    };
    const finished = await resumeReferenceRun(
      project.id,
      reference.id,
      withReading,
    );

    expect(finished.status).toBe('done');
    expect(finished.steps.find((step) => step.id === 'read')?.status).toBe(
      'done',
    );
    expect(finished.steps.find((step) => step.id === 'extract')?.status).toBe(
      'done',
    );
  });

  it('rejects starting a fresh run while one is parked waiting on input', async () => {
    const project = await createProject({
      name: 'Parked run guard',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    await startReferenceRun(project.id, reference.id);
    const parked = await executeReferenceRun(
      project.id,
      reference.id,
      instantHandlers,
    );
    expect(parked.status).toBe('waiting');

    // Starting fresh here used to silently replace the parked run (new id,
    // sequence reset to 0), discarding its progress instead of resuming it.
    await expect(startReferenceRun(project.id, reference.id)).rejects.toThrow(
      /parked waiting on input/,
    );

    const stillParked = await readReferenceRun(project.id, reference.id);
    expect(stillParked?.id).toBe(parked.id);
    expect(stillParked?.status).toBe('waiting');
  });

  it('parks again with the blocking reason when extraction is still blocked', async () => {
    const project = await createProject({
      name: 'Blocked extract',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    await startReferenceRun(project.id, reference.id);
    const parked = await executeReferenceRun(project.id, reference.id, {
      ...instantHandlers,
      read: async () => ({ artifactIds: ['analysis', 'timeline'] }),
      extract: async () => ({
        waiting: true,
        note: 'Reading coverage is too thin (74% gaps).',
      }),
    });

    expect(parked.status).toBe('waiting');
    const extract = parked.steps.find((step) => step.id === 'extract');
    expect(extract?.status).toBe('waiting');
    // The reason is what the panel offers the user an action against.
    expect(extract?.note).toContain('74% gaps');
  });
});

describe('sampleStepEveryMs', () => {
  it('keeps the 1s default for references short enough to fit at that step', () => {
    expect(sampleStepEveryMs(8000, 48)).toBe(1000);
    expect(sampleStepEveryMs(40000, 48)).toBe(1000);
  });

  it('widens the step so the full cell budget spans a longer reference', () => {
    // 112.6s at the old fixed 1s step covered only the first 47s (58% thin)
    // and got rejected by framework extraction; this is that exact case.
    expect(sampleStepEveryMs(112_600, 48)).toBe(2000);
  });

  it('never exceeds the thin-gap threshold, past which spacing stops helping', () => {
    // A 10-minute reference (the analysis cap) cannot be fully covered by 48
    // cells regardless of spacing — clamping to 2000ms still maximizes what
    // this budget can cover instead of spreading out into an all-thin grid.
    expect(sampleStepEveryMs(600_000, 48)).toBe(2000);
  });
});

describe('sample cell ceiling', () => {
  it('can hold a full sweep of the reference the step produces', () => {
    // The regression: the budget was one page (48 cells) while the step was
    // clamped to the thin-gap threshold, so any reference over
    // 48 * 2000ms = 96s was sampled only to 96s. The ceiling has to cover the
    // cells the chosen step actually needs.
    for (const durationMs of [186_642, 112_600, 300_000]) {
      const everyMs = sampleStepEveryMs(durationMs, 48);
      const cellsNeeded = Math.ceil(durationMs / everyMs) + 1;
      expect(SAMPLE_CELL_CEILING).toBeGreaterThanOrEqual(cellsNeeded);
    }
  });

  it('leaves the truncation honest past what it can cover', () => {
    // A 30-minute reference still exceeds the ceiling. That is allowed — what
    // must not happen is the evidence range claiming coverage it lacks, which
    // planEvidenceSampling now narrows.
    const durationMs = 1_800_000;
    const everyMs = sampleStepEveryMs(durationMs, 48);
    expect(Math.ceil(durationMs / everyMs) + 1).toBeGreaterThan(
      SAMPLE_CELL_CEILING,
    );
  });
});

describe('reference analysis run — sample step coverage', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-run-sample-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('covers most of a reference longer than the old fixed-step cutoff', async () => {
    // still-8s.mp4 looped past the 48s point the old fixed 1s step used to
    // stop at, so the real default 'sample' handler (not overridden here)
    // has to actually widen its step to pass this.
    const longFixture = path.join(workDir, 'long-source.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-stream_loop',
        '13',
        '-i',
        fileURLToPath(
          new URL(
            '../../fixtures/video/reference/still-8s.mp4',
            import.meta.url,
          ),
        ),
        '-c',
        'copy',
        longFixture,
      ],
      { stdio: 'ignore' },
    );

    const project = await createProject({
      name: 'Long reference sample coverage',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'workspace-path',
      studyAcknowledged: true,
      filePath: longFixture,
      allowLonger: true,
    });
    expect(reference.durationMs).toBeGreaterThan(90_000);

    await startReferenceRun(project.id, reference.id);
    await executeReferenceRun(project.id, reference.id, {
      transcribe: async () => ({ artifactIds: ['transcript'] }),
      pack: async () => ({ artifactIds: ['packed-transcript'] }),
      boundaries: async () => ({ artifactIds: ['boundaries'] }),
      read: async () => ({ waiting: true, note: 'stop before agent steps' }),
    });

    const evidence = await readReferenceEnvelope<EvidenceItem[]>(
      project.id,
      reference.id,
      'evidence',
    );
    const sampledAtMs = evidence?.data[0]?.sampledAtMs ?? [];
    const lastSample = sampledAtMs.at(-1) ?? 0;
    // The old fixed 1s step would have stopped at ~47s no matter how long
    // the reference was; this must reach much further into it.
    expect(lastSample).toBeGreaterThan(reference.durationMs * 0.7);
  });
});
