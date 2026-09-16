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
