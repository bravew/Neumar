import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  compareRevisions,
  historyDir,
  nameRevision,
  projectDigest,
  pruneRevisions,
  readRevisionIndex,
  readSnapshot,
  recordProjectRevision,
} from '@/shared/video/project-history';
import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

beforeEach(async () => {
  closeDatabase();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-history-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
});

afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('project revision history', () => {
  it('writes a content-addressed snapshot and indexes it', async () => {
    const project = projectFixture();

    const entry = await recordProjectRevision(project, {
      authorKind: 'user',
      reason: 'Trimmed the opener',
    });

    expect(entry.digest).toBe(projectDigest(project));
    expect(entry).toMatchObject({
      revision: 0,
      authorKind: 'user',
      reason: 'Trimmed the opener',
      counts: { tracks: 1, clips: 1, assets: 1 },
    });

    const index = await readRevisionIndex('project-1');
    expect(index.entries).toHaveLength(1);
    expect(await readSnapshot('project-1', entry.digest)).toEqual(project);
  });

  it('stores one file for two revisions of an identical document', async () => {
    const project = projectFixture();
    const first = await recordProjectRevision(project, { authorKind: 'user' });
    const second = await recordProjectRevision(project, {
      authorKind: 'agent',
    });

    expect(second.digest).toBe(first.digest);
    const index = await readRevisionIndex('project-1');
    // Two index entries, because they are two events with different authors.
    expect(index.entries).toHaveLength(2);
    const files = await fs.readdir(
      path.join(historyDir('project-1'), 'snapshots', first.digest.slice(0, 2)),
    );
    expect(files).toEqual([`${first.digest}.json`]);
  });

  it('records author kind and run id so the history sheet can group them', async () => {
    await recordProjectRevision(projectFixture(), {
      authorKind: 'agent',
      runId: 'run-42',
    });

    const [entry] = (await readRevisionIndex('project-1')).entries;
    expect(entry).toMatchObject({ authorKind: 'agent', runId: 'run-42' });
  });

  it('prunes the oldest automatic revisions past the retention limit', async () => {
    for (let index = 0; index < 6; index += 1) {
      await recordProjectRevision(
        { ...projectFixture(), revision: index },
        { authorKind: 'user', retention: 3 },
      );
    }

    const entries = (await readRevisionIndex('project-1')).entries;
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.revision)).toEqual([3, 4, 5]);
  });

  it('never prunes a named version', async () => {
    const keep = await recordProjectRevision(
      { ...projectFixture(), revision: 0 },
      { authorKind: 'user', name: 'Client cut', retention: 2 },
    );
    for (let index = 1; index < 6; index += 1) {
      await recordProjectRevision(
        { ...projectFixture(), revision: index },
        { authorKind: 'user', retention: 2 },
      );
    }

    const entries = (await readRevisionIndex('project-1')).entries;
    expect(entries.some((entry) => entry.digest === keep.digest)).toBe(true);
    // Named versions do not count toward the automatic limit.
    expect(entries.filter((entry) => !entry.name)).toHaveLength(2);
    await expect(readSnapshot('project-1', keep.digest)).resolves.toBeTruthy();
  });

  it('keeps a pruned digest on disk while another entry still references it', async () => {
    const shared = projectFixture();
    const named = await recordProjectRevision(shared, {
      authorKind: 'user',
      name: 'Approved',
    });
    await recordProjectRevision(shared, { authorKind: 'user' });
    for (let index = 1; index < 5; index += 1) {
      await recordProjectRevision(
        { ...projectFixture(), revision: index },
        { authorKind: 'user', retention: 2 },
      );
    }

    // The automatic copy was pruned from the index, but the named version still
    // points at the same bytes.
    await expect(readSnapshot('project-1', named.digest)).resolves.toBeTruthy();
  });

  it('names an existing revision', async () => {
    const entry = await recordProjectRevision(projectFixture(), {
      authorKind: 'user',
    });

    expect(
      await nameRevision('project-1', entry.digest, 'Rough cut'),
    ).toMatchObject({ name: 'Rough cut' });
    expect(await nameRevision('project-1', 'f'.repeat(64), 'Nope')).toBeNull();
  });

  it('summarizes what changed between two revisions', async () => {
    const before = projectFixture();
    const after: VideoProject = {
      ...before,
      revision: 1,
      timeline: {
        ...before.timeline!,
        durationMs: 8000,
        tracks: [
          {
            ...before.timeline!.tracks[0]!,
            clips: [
              ...before.timeline!.tracks[0]!.clips,
              {
                id: 'clip-2',
                kind: 'video',
                sourceRef: { kind: 'asset', assetId: 'asset-1' },
                startMs: 4000,
                durationMs: 4000,
                trimStartMs: 0,
                trimEndMs: 4000,
                sourceDurationMs: 4000,
              },
            ],
          } as (typeof before.timeline)['tracks'][number],
        ],
      },
    };
    const first = await recordProjectRevision(before, { authorKind: 'user' });
    const second = await recordProjectRevision(after, { authorKind: 'user' });

    const comparison = await compareRevisions(
      'project-1',
      first.digest,
      second.digest,
    );
    expect(comparison.clips).toEqual({ added: 1, removed: 0 });
    expect(comparison.durationDeltaMs).toBe(4000);
    expect(comparison.changedClipIds).toEqual(['clip-2']);
  });

  it('rejects a digest that is not a sha256', async () => {
    await expect(readSnapshot('project-1', '../escape')).rejects.toThrow(
      'Invalid project snapshot digest',
    );
  });

  it('starts a fresh index rather than failing on a corrupt one', async () => {
    await recordProjectRevision(projectFixture(), { authorKind: 'user' });
    await fs.writeFile(
      path.join(historyDir('project-1'), 'index.json'),
      'not json',
    );

    expect((await readRevisionIndex('project-1')).entries).toEqual([]);
  });

  it('does not prune when nothing exceeds retention', async () => {
    await recordProjectRevision(projectFixture(), { authorKind: 'user' });

    expect(await pruneRevisions('project-1', 10)).toEqual([]);
  });
});

describe('writeProject history integration', () => {
  it('snapshots each saved revision', async () => {
    await writeProject(projectFixture());
    const saved = await getProject('project-1');
    await writeProject(
      { ...saved, name: 'Renamed' },
      { authorKind: 'user', reason: 'Renamed the project' },
    );

    const entries = (await readRevisionIndex('project-1')).entries;
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.at(-1)).toMatchObject({
      authorKind: 'user',
      reason: 'Renamed the project',
    });
    const restored = await readSnapshot('project-1', entries.at(-1)!.digest);
    expect(restored.name).toBe('Renamed');
  });

  it('still saves the project when history cannot be written', async () => {
    await writeProject(projectFixture());
    // Take the history directory away and make its path a file, so creating it
    // fails.
    await fs.rm(historyDir('project-1'), { recursive: true, force: true });
    await fs.writeFile(historyDir('project-1'), 'blocked');

    const saved = await getProject('project-1');
    await expect(
      writeProject({ ...saved, name: 'Still saves' }),
    ).resolves.toBeUndefined();
    expect((await getProject('project-1')).name).toBe('Still saves');
  });

  it('skips the snapshot when a caller opts out', async () => {
    await writeProject(projectFixture(), { snapshot: false });

    expect((await readRevisionIndex('project-1')).entries).toEqual([]);
  });
});

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'History',
    template: 'custom',
    prompt: '',
    revision: 0,
    assets: [
      {
        id: 'asset-1',
        kind: 'video',
        source: 'user',
        path: 'assets/video.mp4',
        metadata: { durationMs: 4000 },
      },
    ],
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
          clips: [
            {
              id: 'clip-1',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-1' },
              startMs: 0,
              durationMs: 4000,
              trimStartMs: 0,
              trimEndMs: 4000,
              sourceDurationMs: 4000,
            },
          ],
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
