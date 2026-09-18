import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { acquireReference } from '@/shared/video/reference/acquire';
import {
  defaultAnalysisRange,
  REFERENCE_ANALYSIS_MAX_MS,
  ReferenceAnalysisRangeError,
  setReferenceAnalysisRange,
} from '@/shared/video/reference/analysis-range';
import { startReferenceRun } from '@/shared/video/reference/run';
import { readReferenceEnvelope } from '@/shared/video/reference/store';
import { createProject } from '@/shared/video/store';
import type { ReferenceProbe } from '@/shared/video/types';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('defaultAnalysisRange', () => {
  it('keeps the full source when under the cap', () => {
    expect(defaultAnalysisRange(8000)).toEqual({ startMs: 0, endMs: 8000 });
  });

  it('clamps to the analysis cap when the source is longer', () => {
    expect(defaultAnalysisRange(REFERENCE_ANALYSIS_MAX_MS + 5000)).toEqual({
      startMs: 0,
      endMs: REFERENCE_ANALYSIS_MAX_MS,
    });
  });
});

describe('setReferenceAnalysisRange', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-reference-analysis-range-'),
    );
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('re-trims the analysis clip and clears prior artifacts', async () => {
    const project = await createProject({
      name: 'Range edit',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    const sourceMediaPath = reference.mediaPath;
    const sourceDurationMs = reference.durationMs;

    const { reference: updated } = await setReferenceAnalysisRange(
      project.id,
      reference.id,
      { startMs: 1000, endMs: 4000 },
    );

    expect(updated.analysisRange).toEqual({ startMs: 1000, endMs: 4000 });
    expect(updated.sourceMediaPath).toBe(sourceMediaPath);
    expect(updated.sourceDurationMs).toBe(sourceDurationMs);
    expect(updated.mediaPath).not.toBe(sourceMediaPath);
    expect(updated.mediaPath).toMatch(/analysis\.mp4$/);
    // The trimmed clip is close to 3s; re-encoding can shift this slightly.
    expect(updated.durationMs).toBeGreaterThan(2000);
    expect(updated.durationMs).toBeLessThan(4000);

    const probe = await readReferenceEnvelope<ReferenceProbe>(
      project.id,
      reference.id,
      'probe',
    );
    expect(probe?.data.width).toBeGreaterThan(0);
    // The stale-and-unrelated boundaries artifact from before the re-trim
    // must not survive — everything derived from the old clip is gone.
    const boundaries = await readReferenceEnvelope(
      project.id,
      reference.id,
      'boundaries',
    );
    expect(boundaries).toBeNull();
  });

  it('rejects a range that is not ordered', async () => {
    const project = await createProject({
      name: 'Range order',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    await expect(
      setReferenceAnalysisRange(project.id, reference.id, {
        startMs: 4000,
        endMs: 1000,
      }),
    ).rejects.toMatchObject({
      name: 'ReferenceAnalysisRangeError',
      code: 'invalid-range',
    });
  });

  it('rejects a range past the end of the source', async () => {
    const project = await createProject({
      name: 'Range bounds',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    await expect(
      setReferenceAnalysisRange(project.id, reference.id, {
        startMs: 0,
        endMs: reference.durationMs + 60_000,
      }),
    ).rejects.toBeInstanceOf(ReferenceAnalysisRangeError);
  });

  it('refuses to change the range while a run is active', async () => {
    const project = await createProject({
      name: 'Range busy',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    // A freshly started run is already `queued`, which blocks a range
    // change the same way `running`/`waiting` do — no need to let it
    // actually execute for this check.
    await startReferenceRun(project.id, reference.id);
    await expect(
      setReferenceAnalysisRange(project.id, reference.id, {
        startMs: 0,
        endMs: 2000,
      }),
    ).rejects.toMatchObject({
      name: 'ReferenceAnalysisRangeError',
      code: 'busy',
    });
  });
});
