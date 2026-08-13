import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ContentGraph } from '@neumar/video-ir';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import {
  readFrameHtml,
  writeFrameHtml,
} from '@/shared/video/content-graph/persistence';

// Phase 6 M3 — content-graph GET/PUT routes that back the frames strip + viewer.

let workDirRoot: string;
let originalWorkDir: string | undefined;
const projectId = 'cg-routes-test';

beforeAll(() => {
  workDirRoot = mkdtempSync(path.join(tmpdir(), 'cg-routes-'));
  originalWorkDir = process.env.NEUMA_VIDEO_WORKDIR;
  process.env.NEUMA_VIDEO_WORKDIR = workDirRoot;
});
afterAll(() => {
  rmSync(workDirRoot, { recursive: true, force: true });
  if (originalWorkDir === undefined) delete process.env.NEUMA_VIDEO_WORKDIR;
  else process.env.NEUMA_VIDEO_WORKDIR = originalWorkDir;
});

function graph(nodeIds: string[]): ContentGraph {
  return {
    schemaVersion: 1,
    intent: 'explainer',
    nodes: nodeIds.map((id) => ({ id, kind: 'text', text: `body ${id}` })),
    edges: nodeIds
      .slice(1)
      .map((id, i) => ({ from: nodeIds[i], to: id, kind: 'sequence' })),
  };
}

async function get(): Promise<{ graph: ContentGraph | null }> {
  const res = await videoRoutes.request(`/projects/${projectId}/content-graph`);
  expect(res.status).toBe(200);
  return res.json();
}

async function put(body: ContentGraph, expected = 200) {
  const res = await videoRoutes.request(
    `/projects/${projectId}/content-graph`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: body }),
    },
  );
  expect(res.status).toBe(expected);
  return res;
}

describe('content-graph routes', () => {
  it('returns null before any graph is written', async () => {
    const data = await get();
    expect(data.graph).toBeNull();
  });

  it('persists then reads back a graph', async () => {
    await put(graph(['a', 'b', 'c']));
    const data = await get();
    expect(data.graph?.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects an invalid graph with 400', async () => {
    const res = await videoRoutes.request(
      `/projects/${projectId}/content-graph`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: { schemaVersion: 1 } }),
      },
    );
    expect(res.status).toBe(400);
  });

  it('prunes frame overrides for nodes removed on save', async () => {
    await put(graph(['a', 'b', 'c']));
    await writeFrameHtml(projectId, 'c', '<p>c</p>');
    expect(await readFrameHtml(projectId, 'c')).not.toBeNull();

    // Drop node "c" — its orphaned override must be pruned.
    await put(graph(['a', 'b']));
    expect(await readFrameHtml(projectId, 'c')).toBeNull();
  });
});
