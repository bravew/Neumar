import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLabeledGrid } from '@/shared/video/analysis/labeled-frames';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

describe('buildLabeledGrid', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'labeled-frames-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('paginates, places labels below the picture, and refuses overwrite', async () => {
    const destinationDir = path.join(workDir, 'grids');
    const result = await buildLabeledGrid({
      mediaPath: FIXTURE,
      workDir,
      destinationDir,
      filePrefix: 'page',
      samples: [
        { atMs: 0, wordLabel: 'one' },
        { atMs: 1000, wordLabel: 'two' },
        { atMs: 2000, wordLabel: 'three' },
      ],
      columns: 2,
      rows: 1,
      cellWidth: 160,
      labelHeight: 28,
    });

    expect(result.pages).toBe(2);
    expect(result.paths).toHaveLength(2);
    expect(result.sampledAtMs).toEqual([0, 1000, 2000]);
    const meta = await sharp(result.paths[0]!).metadata();
    expect(meta.width).toBe(320);
    expect(meta.height).toBeGreaterThan(28);

    await expect(
      buildLabeledGrid({
        mediaPath: FIXTURE,
        workDir,
        destinationDir,
        filePrefix: 'page',
        samples: [{ atMs: 0 }],
        columns: 2,
        rows: 1,
        cellWidth: 160,
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('removes the staging directory on a write failure', async () => {
    const destinationDir = path.join(workDir, 'grids');
    await fs.mkdir(destinationDir, { recursive: true });
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    await expect(
      buildLabeledGrid({
        mediaPath: FIXTURE,
        workDir,
        destinationDir,
        filePrefix: 'fail',
        samples: [{ atMs: 0 }],
        columns: 1,
        cellWidth: 160,
      }),
    ).rejects.toThrow('rename failed');
    const leftover = await fs.readdir(destinationDir);
    expect(leftover.some((name) => name.startsWith('.stage-'))).toBe(false);
    expect(existsSync(path.join(destinationDir, 'fail-p1.png'))).toBe(false);
  });
});
