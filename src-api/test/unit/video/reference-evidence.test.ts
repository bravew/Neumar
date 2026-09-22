import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { acquireReference } from '@/shared/video/reference/acquire';
import {
  buildEvidence,
  loadPackedTranscriptForReference,
  planEvidenceSampling,
  writePackedTranscriptForReference,
} from '@/shared/video/reference/evidence';
import { createProject } from '@/shared/video/store';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('buildEvidence', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-evidence-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('returns ordered sampledAtMs and cache-hits an identical rebuild', async () => {
    const project = await createProject({
      name: 'Evidence cache',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });

    const first = await buildEvidence(project.id, reference.id, {
      everyMs: 2000,
      columns: 2,
      cellWidth: 160,
      maxCells: 8,
    });
    expect(first.cacheHit).toBe(false);
    expect(first.sampledAtMs).toEqual(
      [...first.sampledAtMs].sort((left, right) => left - right),
    );
    expect(first.sampledAtMs.length).toBeGreaterThan(0);
    expect(first.item.sampledAtMs).toEqual(first.sampledAtMs);

    const second = await buildEvidence(project.id, reference.id, {
      everyMs: 2000,
      columns: 2,
      cellWidth: 160,
      maxCells: 8,
    });
    expect(second.cacheHit).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(second.sampledAtMs).toEqual(first.sampledAtMs);
  });

  it('writes and reloads a packed transcript envelope for a reference', async () => {
    const project = await createProject({
      name: 'Packed transcript',
      template: 'explainer',
    });
    const { reference } = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
    });
    const packed = await writePackedTranscriptForReference(
      project.id,
      reference,
      {
        engine: 'test',
        words: [
          { text: 'hello', startMs: 0, endMs: 400 },
          { text: 'world', startMs: 450, endMs: 900 },
        ],
        segments: [
          { id: 'seg-1', text: 'hello world', startMs: 0, endMs: 900 },
        ],
      },
    );
    expect(packed.phrases.length).toBeGreaterThan(0);
    const loaded = await loadPackedTranscriptForReference(
      project.id,
      reference.id,
    );
    expect(loaded).toEqual(packed);
  });
});

describe('planEvidenceSampling', () => {
  const CEILING = 240;

  it('covers a full reference when the ceiling can hold the cells', () => {
    // The reported case: 186.6s at the 2s step needs 94 cells. One 48-cell
    // page cannot hold that; the ceiling spread across pages can.
    const plan = planEvidenceSampling({
      range: { startMs: 0, endMs: 186_642 },
      everyMs: 2000,
      maxCells: CEILING,
    });

    expect(plan.truncated).toBe(false);
    expect(plan.range).toEqual({ startMs: 0, endMs: 186_642 });
    expect(plan.sampledAtMs.length).toBeGreaterThan(48);
    expect(plan.sampledAtMs.at(-1)).toBe(186_142);
  });

  it('narrows the range to real coverage when the ceiling truncates', () => {
    // This is the bug: 48 cells at 2s reach 94s of a 186.6s reference, but the
    // range used to keep claiming 186_642 — so the reading, the timeline and
    // the thin-gap check all believed the back half had been looked at.
    const plan = planEvidenceSampling({
      range: { startMs: 0, endMs: 186_642 },
      everyMs: 2000,
      maxCells: 48,
    });

    expect(plan.truncated).toBe(true);
    expect(plan.sampledAtMs).toHaveLength(48);
    expect(plan.sampledAtMs.at(-1)).toBe(94_000);
    expect(plan.range).toEqual({ startMs: 0, endMs: 94_000 });
  });

  it('does not call a complete sweep truncated', () => {
    // Sampling stops at endMs - 500 by design, which must not read as a gap.
    const plan = planEvidenceSampling({
      range: { startMs: 0, endMs: 8000 },
      everyMs: 1000,
      maxCells: CEILING,
    });

    expect(plan.truncated).toBe(false);
    expect(plan.range).toEqual({ startMs: 0, endMs: 8000 });
    expect(plan.sampledAtMs.at(-1)).toBe(7500);
  });

  it('keeps a non-zero start when sampling a phrase window', () => {
    const plan = planEvidenceSampling({
      range: { startMs: 30_000, endMs: 40_000 },
      everyMs: 1000,
      maxCells: CEILING,
    });

    expect(plan.truncated).toBe(false);
    expect(plan.sampledAtMs[0]).toBe(30_000);
    expect(plan.range).toEqual({ startMs: 30_000, endMs: 40_000 });
  });
});
