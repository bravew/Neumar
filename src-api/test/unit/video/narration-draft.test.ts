import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ContentGraph } from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVideoEditTools } from '@/shared/mcp/video-edit-server';
import { writeContentGraph } from '@/shared/video/content-graph/persistence';
import {
  applyNarrationDraft,
  getNarrationFrames,
} from '@/shared/video/narration-draft';
import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

// Phase 5 M3 — narration drafter. The agent (LLM) writes the lines; this layer
// reads the content-graph to expose frames and persists lines keyed by node id.

const projectId = 'narr-1';

function graph(): ContentGraph {
  return {
    schemaVersion: 1,
    intent: 'explainer',
    synopsis: 'A two-frame explainer.',
    nodes: [
      { id: 'intro', kind: 'text', text: 'Welcome to the demo.' },
      { id: 'point', kind: 'text', text: 'Here is the key point.' },
    ],
    edges: [{ from: 'intro', to: 'point', kind: 'sequence' }],
  };
}

function projectFixture(): VideoProject {
  return {
    id: projectId,
    name: 'Narration test',
    template: 'explainer',
    prompt: '',
    assets: [],
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
  } as VideoProject;
}

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'narr-draft-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  await writeProject(projectFixture());
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('narration-draft core', () => {
  it('lists frames in topo order with node copy', async () => {
    await writeContentGraph(projectId, graph());
    const { frames, synopsis } = await getNarrationFrames(projectId);
    expect(synopsis).toBe('A two-frame explainer.');
    expect(frames).toEqual([
      { id: 'intro', order: 0, text: 'Welcome to the demo.' },
      { id: 'point', order: 1, text: 'Here is the key point.' },
    ]);
  });

  it('throws no-content-graph when none is persisted', async () => {
    await expect(getNarrationFrames(projectId)).rejects.toMatchObject({
      code: 'no-content-graph',
    });
  });

  it('persists linesByFrame onto the project soundtrack', async () => {
    await writeContentGraph(projectId, graph());
    const result = await applyNarrationDraft(projectId, {
      linesByFrame: { intro: 'Hi there.', point: 'The point is X.' },
    });
    expect(result.updated.sort()).toEqual(['intro', 'point']);

    const project = await getProject(projectId);
    expect(project.soundtrack?.narrationByFrame).toEqual({
      intro: 'Hi there.',
      point: 'The point is X.',
    });
  });

  it('merges a single-frame draft without dropping existing lines', async () => {
    await writeContentGraph(projectId, graph());
    await applyNarrationDraft(projectId, { linesByFrame: { intro: 'one' } });
    await applyNarrationDraft(projectId, { frameId: 'point', line: 'two' });

    const project = await getProject(projectId);
    expect(project.soundtrack?.narrationByFrame).toEqual({
      intro: 'one',
      point: 'two',
    });
  });

  it('allows an empty string to skip narration on a frame', async () => {
    await writeContentGraph(projectId, graph());
    const result = await applyNarrationDraft(projectId, {
      linesByFrame: { intro: '' },
    });
    expect(result.narrationByFrame.intro).toBe('');
  });

  it('merges linesByFrame with a frameId+line pair (no silent drop)', async () => {
    await writeContentGraph(projectId, graph());
    const result = await applyNarrationDraft(projectId, {
      linesByFrame: { intro: 'one' },
      frameId: 'point',
      line: 'two',
    });
    expect(result.updated.sort()).toEqual(['intro', 'point']);
    const project = await getProject(projectId);
    expect(project.soundtrack?.narrationByFrame).toEqual({
      intro: 'one',
      point: 'two',
    });
  });

  it('rejects a frameId without a line', async () => {
    await writeContentGraph(projectId, graph());
    await expect(
      applyNarrationDraft(projectId, { frameId: 'intro' }),
    ).rejects.toMatchObject({ code: 'no-lines' });
  });

  it('rejects keys that are not content-graph node ids', async () => {
    await writeContentGraph(projectId, graph());
    await expect(
      applyNarrationDraft(projectId, { linesByFrame: { ghost: 'x' } }),
    ).rejects.toMatchObject({ code: 'unknown-node-id' });
  });

  it('preserves other soundtrack fields when writing narration', async () => {
    await writeContentGraph(projectId, graph());
    const base = await getProject(projectId);
    await writeProject({
      ...base,
      soundtrack: { musicAssetId: 'm', musicVolumeDb: -12 },
    });
    await applyNarrationDraft(projectId, { linesByFrame: { intro: 'hi' } });

    const project = await getProject(projectId);
    expect(project.soundtrack).toMatchObject({
      musicAssetId: 'm',
      musicVolumeDb: -12,
      narrationByFrame: { intro: 'hi' },
    });
  });
});

describe('video_draft_narration MCP tool', () => {
  function tool() {
    const found = createVideoEditTools({ projectId }).find(
      (t) => t.name === 'video_draft_narration',
    );
    if (!found) throw new Error('video_draft_narration not registered');
    return found;
  }

  it('returns the frames + an instruction when called with no lines', async () => {
    await writeContentGraph(projectId, graph());
    const result = await tool().handler({}, {});
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.frames).toHaveLength(2);
    expect(payload.instruction).toContain('ONE short spoken sentence');
    expect(result.isError).toBeUndefined();
    // Discovery must not mutate.
    const project = await getProject(projectId);
    expect(project.soundtrack?.narrationByFrame).toBeUndefined();
  });

  it('persists lines and reports them back', async () => {
    await writeContentGraph(projectId, graph());
    const result = await tool().handler(
      { linesByFrame: { intro: 'Hello.', point: 'Done.' } },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload.narrationByFrame).toEqual({
      intro: 'Hello.',
      point: 'Done.',
    });
  });

  it('surfaces the typed error code to the agent', async () => {
    await writeContentGraph(projectId, graph());
    const result = await tool().handler({ linesByFrame: { nope: 'x' } }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('unknown-node-id');
  });
});
