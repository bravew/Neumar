import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { buildMediaHealthReport } from '@/shared/video/media-health';
import { getVideoProjectDir, writeProject } from '@/shared/video/store';
import type { MediaItem, VideoProject } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-media-health-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

// Managed asset paths are relative to the video workspace root, which is what
// `getVideoProjectDir` sits under.
function managedAssetPath(id: string): string {
  return path.relative(
    workDir,
    path.join(getVideoProjectDir('project-1'), 'assets', `${id}.mp4`),
  );
}

async function writeAssetFile(id: string): Promise<void> {
  const target = path.join(workDir, managedAssetPath(id));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'bytes');
}

describe('media health report', () => {
  it('reports a present managed asset as ready', async () => {
    const project = projectFixture([asset('asset-1')]);
    await writeProject(project);
    await writeAssetFile('asset-1');

    const report = await buildMediaHealthReport(project);

    expect(report.entries[0]).toMatchObject({
      assetId: 'asset-1',
      state: 'ready',
      origin: 'managed',
      onTimeline: false,
    });
    expect(report.entries[0]?.sizeBytes).toBeGreaterThan(0);
    expect(report.summary).toMatchObject({ total: 1, ready: 1, missing: 0 });
    expect(report.renderReady).toBe(true);
  });

  it('reports a managed asset with no file as missing', async () => {
    const project = projectFixture([asset('asset-1')]);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    expect(report.entries[0]).toMatchObject({ state: 'missing' });
    expect(report.entries[0]?.detail).toContain('project folder');
  });

  it('only blocks a render for assets the timeline actually uses', async () => {
    const project = projectFixture([asset('used'), asset('unused')], ['used']);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    expect(report.summary.missing).toBe(2);
    // An offline asset nothing references does not stop a render.
    expect(report.summary.blockingRender).toBe(1);
    expect(report.renderReady).toBe(false);
    expect(
      report.entries.find((entry) => entry.assetId === 'used')?.onTimeline,
    ).toBe(true);
  });

  it('trusts the stored materialization state over a filesystem probe', async () => {
    const project = projectFixture([
      { ...asset('referenced'), materializationState: 'referenced' },
      { ...asset('hydrating'), materializationState: 'hydrating' },
      { ...asset('failed'), materializationState: 'error' },
    ]);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    expect(report.entries.map((entry) => entry.state)).toEqual([
      'referenced',
      'hydrating',
      'error',
    ]);
    expect(report.summary.pending).toBe(2);
  });

  it('reports an external master that has moved as missing, in the user’s terms', async () => {
    const external = path.join(workDir, 'masters', 'a-roll.mp4');
    const project = projectFixture([
      { ...asset('external'), origin: 'external', path: external },
    ]);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    expect(report.entries[0]).toMatchObject({
      state: 'missing',
      origin: 'external',
    });
    expect(report.entries[0]?.detail).toContain('drive is not mounted');
  });

  it('reports an external path outside the trusted roots as unreachable', async () => {
    const project = projectFixture([
      {
        ...asset('external'),
        origin: 'external',
        // A real file in a location external media is never allowed to read.
        path: '/etc/passwd',
      },
    ]);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    // project.json is editable, so a path that was allowed when written may not
    // be allowed now. That is a health state, not a crash.
    expect(report.entries[0]?.state).toBe('unreachable');
    expect(report.summary.unreachable).toBe(1);
  });

  it('records whether metadata and dimensions have been probed', async () => {
    const project = projectFixture([
      {
        ...asset('probed'),
        metadata: { durationMs: 4000, width: 1920, height: 1080 },
      },
      { ...asset('unprobed'), metadata: { durationMs: 0 } },
    ]);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    expect(report.entries[0]).toMatchObject({
      hasMetadata: true,
      hasDimensions: true,
    });
    expect(report.entries[1]).toMatchObject({
      hasMetadata: false,
      hasDimensions: false,
    });
  });

  it('handles a project with no assets', async () => {
    const project = projectFixture([]);
    await writeProject(project);

    const report = await buildMediaHealthReport(project);

    expect(report.summary).toMatchObject({ total: 0, blockingRender: 0 });
    expect(report.renderReady).toBe(true);
  });
});

function asset(id: string): MediaItem {
  return {
    id,
    kind: 'video',
    source: 'user',
    path: managedAssetPath(id),
    metadata: { durationMs: 4000 },
  } as MediaItem;
}

function projectFixture(
  assets: MediaItem[],
  timelineAssetIds: string[] = [],
): VideoProject {
  return {
    id: 'project-1',
    name: 'Media health',
    template: 'custom',
    prompt: '',
    revision: 0,
    assets,
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 4000,
      fps: 30,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          order: 0,
          clips: timelineAssetIds.map((assetId, index) => ({
            id: `clip-${assetId}`,
            kind: 'video',
            sourceRef: { kind: 'asset', assetId },
            startMs: index * 1000,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
            sourceDurationMs: 1000,
          })),
        },
      ],
    },
    render: { status: 'idle' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
  } as VideoProject;
}
