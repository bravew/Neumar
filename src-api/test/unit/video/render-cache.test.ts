import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMemoryBudgetSupervisor } from '@/shared/services/memory-budget';
import {
  getRenderCacheEntry,
  pruneRenderCache,
  recordRenderCacheEntry,
  renderCacheClipPath,
  renderCacheFramePath,
  renderCacheScenePath,
  renderClipCacheKey,
  renderTimelineFrameCacheKey,
  renderSceneCacheKey,
} from '@/shared/video/render-cache';

let workDir: string;

describe('video render cache', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-render-cache-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    getMemoryBudgetSupervisor().resetForTests();
  });

  afterEach(async () => {
    getMemoryBudgetSupervisor().resetForTests();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('generates deterministic keys and changes when scene inputs change', async () => {
    const sourcePath = path.join(workDir, 'source.mp4');
    await fs.writeFile(sourcePath, 'source');
    const input = {
      inputPath: sourcePath,
      durationSec: 4,
      sourceStartSec: 1,
      kind: 'video' as const,
      hasAudio: true,
      transitionToNext: { kind: 'fade' as const, durationMs: 500 },
      aspectRatio: '16:9' as const,
      mode: 'speed' as const,
      root: workDir,
    };

    const key = await renderSceneCacheKey(input);

    await expect(renderSceneCacheKey({ ...input })).resolves.toBe(key);
    await expect(
      renderSceneCacheKey({ ...input, durationSec: 5 }),
    ).resolves.not.toBe(key);
    await expect(
      renderSceneCacheKey({
        ...input,
        aspectRatio: '9:16',
        reframe: { aspect: '9:16', anchor: 'left' },
      }),
    ).resolves.not.toBe(key);
  });

  it('generates clip-level keys and scoped cache paths', async () => {
    const sourcePath = path.join(workDir, 'source.mp4');
    await fs.writeFile(sourcePath, 'source');
    const input = {
      clipId: 'clip-1',
      inputPath: sourcePath,
      inPointMs: 1000,
      outPointMs: 4000,
      durationSec: 3,
      sourceStartSec: 1,
      kind: 'video' as const,
      aspectRatio: '16:9' as const,
      mode: 'speed' as const,
      effectsHash: 'effects-a',
      root: workDir,
    };

    const key = await renderClipCacheKey(input);

    await expect(renderClipCacheKey({ ...input })).resolves.toBe(key);
    await expect(
      renderClipCacheKey({ ...input, outPointMs: 4500 }),
    ).resolves.not.toBe(key);
    await expect(
      renderClipCacheKey({ ...input, effectsHash: 'effects-b' }),
    ).resolves.not.toBe(key);
    expect(renderCacheClipPath(workDir, 'project-1', 'clip-1', key)).toContain(
      path.join('.cache', 'videos', 'project-1', 'scenes', 'clips', 'clip-1'),
    );
    await expect(
      renderClipCacheKey({ ...input, outPointMs: 1000 }),
    ).rejects.toThrow('out point');
    expect(() =>
      renderCacheClipPath(workDir, 'project-1', '../clip', key),
    ).toThrow('Invalid clip id');
  });

  it('generates frame-level keys and scoped cache paths', () => {
    const key = renderTimelineFrameCacheKey({
      timelineHash:
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      atMs: 1200,
      aspectRatio: '16:9',
      maxEdgePx: 512,
    });

    expect(
      renderTimelineFrameCacheKey({
        timelineHash:
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        atMs: 1200,
        aspectRatio: '16:9',
        maxEdgePx: 512,
      }),
    ).toBe(key);
    expect(
      renderTimelineFrameCacheKey({
        timelineHash:
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        atMs: 1500,
        aspectRatio: '16:9',
        maxEdgePx: 512,
      }),
    ).not.toBe(key);
    expect(renderCacheFramePath(workDir, 'project-1', key)).toContain(
      path.join('.cache', 'videos', 'project-1', 'scenes', 'frames'),
    );
    expect(() => renderCacheFramePath(workDir, 'project-1', '../bad')).toThrow(
      'Invalid render cache hash',
    );
  });

  it('records cache hits and updates access time', async () => {
    const hash =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const outputPath = renderCacheScenePath(workDir, 'project-1', hash);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, 'cached scene');

    await recordRenderCacheEntry({
      root: workDir,
      projectId: 'project-1',
      hash,
      absolutePath: outputPath,
      now: '2026-05-25T00:00:00.000Z',
    });
    const hit = await getRenderCacheEntry({
      root: workDir,
      projectId: 'project-1',
      hash,
      now: '2026-05-25T00:01:00.000Z',
    });

    expect(hit).toMatchObject({
      hash,
      absolutePath: outputPath,
      accessedAt: '2026-05-25T00:01:00.000Z',
    });
  });

  it('prunes least-recently-accessed entries first', async () => {
    const oldHash =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const newHash =
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const oldPath = renderCacheScenePath(workDir, 'project-1', oldHash);
    const newPath = renderCacheScenePath(workDir, 'project-1', newHash);
    await fs.mkdir(path.dirname(oldPath), { recursive: true });
    await fs.writeFile(oldPath, 'x'.repeat(100));
    await fs.writeFile(newPath, 'y'.repeat(100));
    await recordRenderCacheEntry({
      root: workDir,
      projectId: 'project-1',
      hash: oldHash,
      absolutePath: oldPath,
      now: '2026-05-25T00:00:00.000Z',
      maxBytes: 1_000,
    });
    await recordRenderCacheEntry({
      root: workDir,
      projectId: 'project-1',
      hash: newHash,
      absolutePath: newPath,
      now: '2026-05-25T00:01:00.000Z',
      maxBytes: 1_000,
    });

    const index = await pruneRenderCache({
      root: workDir,
      projectId: 'project-1',
      maxBytes: 150,
    });

    expect(index.entries.map((entry) => entry.hash)).toEqual([newHash]);
    expect(getMemoryBudgetSupervisor().getStatus()).toMatchObject({
      evictionCount: 1,
      lastEvictionAt: expect.any(String),
    });
    await expect(fs.stat(oldPath)).rejects.toThrow();
    await expect(fs.stat(newPath)).resolves.toBeTruthy();
  });
});
