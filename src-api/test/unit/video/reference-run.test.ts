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
  startReferenceRun,
  type ReferenceRunStepHandlers,
} from '@/shared/video/reference/run';
import { createProject } from '@/shared/video/store';

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
