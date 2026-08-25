import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVideoEditTools } from '@/shared/mcp/video-edit-server';
import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

/**
 * P2-2 / P2-4 — ref resolution now lives in the MCP dispatcher, so every
 * clip-taking tool understands the shared vocabulary; and batch ops can mint
 * clip ids from symbolic keys.
 */
describe('video-edit dispatcher ref resolution', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-refs-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    await writeProject(fixture());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  function findTool(
    name: string,
    options: Parameters<typeof createVideoEditTools>[0] = {},
  ) {
    const found = createVideoEditTools({
      projectId: 'project-refs',
      ...options,
    }).find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Tool ${name} not found`);
    return found;
  }

  it('resolves clipIndex for a named edit tool, not just the ops batch', async () => {
    const result = await findTool('video_set_clip_speed').handler(
      { clipIds: ['clipIndex:1'], speed: 2, applyMode: 'propose' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.ops?.[0]).toMatchObject({ clipId: 'clip-b' });
  });

  it('resolves $selection from the live editor selection', async () => {
    const result = await findTool('video_set_clip_speed', {
      editorSelection: { selectedClipIds: ['clip-b'] },
    }).handler(
      { clipIds: ['$selection'], speed: 0.5, applyMode: 'propose' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.ops?.[0]).toMatchObject({ clipId: 'clip-b' });
  });

  it('resolves atSec inside a moves array', async () => {
    const result = await findTool('video_move_clips').handler(
      {
        moves: [{ clipId: 'atSec:4', toFrame: 0 }],
        applyMode: 'propose',
        linkPolicy: 'linked',
      },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(JSON.stringify(payload)).toContain('clip-b');
    expect(JSON.stringify(payload)).not.toContain('atSec:4');
  });

  it('reports an unresolvable ref with the ref and the tool name', async () => {
    const result = await findTool('video_set_clip_speed').handler(
      { clipIds: ['atSec:99'], speed: 2, applyMode: 'propose' },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('video_set_clip_speed');
    expect(result.content[0]?.text).toContain('atSec:99');
  });

  it('leaves literal ids untouched', async () => {
    const result = await findTool('video_set_clip_speed').handler(
      { clipIds: ['clip-a'], speed: 1.5, applyMode: 'propose' },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.ops?.[0]).toMatchObject({ clipId: 'clip-a' });
  });
});

describe('video_apply_timeline_ops symbolic keys', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-keys-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    await writeProject(fixture());
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  function batchTool() {
    const found = createVideoEditTools({ projectId: 'project-refs' }).find(
      (candidate) => candidate.name === 'video_apply_timeline_ops',
    );
    if (!found) throw new Error('batch tool not found');
    return found;
  }

  it('mints a clip id for a keyed insert and returns the key → id map', async () => {
    const result = await batchTool().handler(
      {
        ops: [
          {
            kind: 'clip.insert',
            key: 'outro',
            trackId: 'track-video',
            at: 6000,
            clip: {
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'a' },
              startMs: 6000,
              durationMs: 2000,
              trimStartMs: 0,
              trimEndMs: 2000,
            },
          },
        ],
        summary: 'add outro',
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const keys = JSON.parse(result.content.at(-1)?.text ?? '{}').symbolicKeys;
    expect(Object.keys(keys)).toEqual(['outro']);

    const project = await getProject('project-refs');
    const ids = project.timeline?.tracks[0]?.clips.map((clip) => clip.id) ?? [];
    expect(ids).toContain(keys.outro);
  });

  it('lets a later op in the same batch address the minted clip as $key:', async () => {
    const result = await batchTool().handler(
      {
        ops: [
          {
            kind: 'clip.insert',
            key: 'outro',
            trackId: 'track-video',
            at: 6000,
            clip: {
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'a' },
              startMs: 6000,
              durationMs: 2000,
              trimStartMs: 0,
              trimEndMs: 2000,
            },
          },
          {
            kind: 'clip.setPlayback',
            clipId: '$key:outro',
            before: null,
            after: { speed: 2, reverse: false },
          },
        ],
        summary: 'add and speed up outro',
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const keys = JSON.parse(result.content.at(-1)?.text ?? '{}').symbolicKeys;
    const project = await getProject('project-refs');
    const outro = project.timeline?.tracks[0]?.clips.find(
      (clip) => clip.id === keys.outro,
    );
    expect(outro).toBeDefined();
  });

  it('rejects a duplicate symbolic key', async () => {
    const insert = (key: string) => ({
      kind: 'clip.insert',
      key,
      trackId: 'track-video',
      at: 6000,
      clip: {
        kind: 'video',
        sourceRef: { kind: 'asset', assetId: 'a' },
        startMs: 6000,
        durationMs: 1000,
        trimStartMs: 0,
        trimEndMs: 1000,
      },
    });
    const result = await batchTool().handler(
      { ops: [insert('dup'), insert('dup')], summary: 'dup' },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Duplicate symbolic key');
  });

  it('rejects a key on an op that creates no clip', async () => {
    const result = await batchTool().handler(
      {
        ops: [{ kind: 'clip.remove', key: 'nope', clipId: 'clip-a' }],
        summary: 'bad key',
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('clip-creating ops');
  });

  it('rejects a $key: reference that was never minted', async () => {
    const result = await batchTool().handler(
      {
        ops: [
          {
            kind: 'clip.setPlayback',
            clipId: '$key:ghost',
            before: null,
            after: { speed: 2, reverse: false },
          },
        ],
        summary: 'ghost key',
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ghost');
  });

  it('still resolves clipIndex inside a batch', async () => {
    const result = await batchTool().handler(
      {
        ops: [{ kind: 'clip.remove', clipId: 'clipIndex:1' }],
        summary: 'drop the second clip',
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const project = await getProject('project-refs');
    expect(project.timeline?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([
      'clip-a',
    ]);
  });
});

function fixture(): VideoProject {
  const now = '2026-08-22T00:00:00.000Z';
  return {
    schemaVersion: 2,
    id: 'project-refs',
    name: 'Refs',
    template: 'product-reel',
    prompt: 'refs',
    assets: [
      {
        id: 'a',
        kind: 'video',
        source: 'user',
        path: 'videos/project-refs/assets/a.mp4',
        metadata: { durationMs: 9000, width: 1920, height: 1080 },
      },
    ],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 6000,
      fps: 30,
      tracks: [
        {
          id: 'track-video',
          kind: 'video',
          name: 'Video',
          muted: false,
          locked: false,
          order: 0,
          clips: [
            {
              id: 'clip-a',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'a' },
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
            },
            {
              id: 'clip-b',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'a' },
              startMs: 3000,
              durationMs: 3000,
              trimStartMs: 3000,
              trimEndMs: 6000,
            },
          ],
        },
      ],
    },
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  } as VideoProject;
}
