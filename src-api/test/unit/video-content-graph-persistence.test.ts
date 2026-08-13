import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type ContentGraph } from '@neumar/video-ir';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  ContentGraphPersistenceError,
  pruneStaleFrameOverrides,
  readContentGraph,
  readFrameHtml,
  readSelectedTemplate,
  selectTemplate,
  writeContentGraph,
  writeFrameHtml,
} from '@/shared/video/content-graph/persistence';

let workDirRoot: string;
let originalWorkDir: string | undefined;

beforeAll(() => {
  workDirRoot = mkdtempSync(path.join(tmpdir(), 'cg-persist-'));
  originalWorkDir = process.env.NEUMA_VIDEO_WORKDIR;
  process.env.NEUMA_VIDEO_WORKDIR = workDirRoot;
});

afterAll(() => {
  rmSync(workDirRoot, { recursive: true, force: true });
  if (originalWorkDir === undefined) delete process.env.NEUMA_VIDEO_WORKDIR;
  else process.env.NEUMA_VIDEO_WORKDIR = originalWorkDir;
});

let projectId: string;
beforeEach(() => {
  // Slug-safe project ids per test so writes don't collide.
  projectId = `proj-${Math.floor(Math.random() * 1e9)}`;
});

afterEach(() => {
  // No cleanup needed — the workDirRoot afterAll handles it.
});

const graph = (
  nodes: ContentGraph['nodes'],
  edges: ContentGraph['edges'] = [],
): ContentGraph => ({
  schemaVersion: 1,
  intent: 'explainer',
  nodes,
  edges,
});

describe('persistence — content-graph', () => {
  it('writes + reads back the canonical content-graph', async () => {
    const g = graph(
      [
        { id: 'intro', kind: 'text', text: 'A', durationSec: 1 },
        { id: 'outro', kind: 'text', text: 'B', durationSec: 1 },
      ],
      [{ from: 'intro', to: 'outro', kind: 'dependency' }],
    );
    await writeContentGraph(projectId, g);
    expect(await readContentGraph(projectId)).toEqual(g);
  });

  it('readContentGraph returns null when no graph is persisted', async () => {
    expect(await readContentGraph(projectId)).toBeNull();
  });

  it('rejects an invalid content-graph at write time', async () => {
    const bad = {
      schemaVersion: 1,
      intent: 'explainer',
      nodes: [],
      edges: [],
    } as unknown as ContentGraph;
    // Empty nodes list isn't rejected by the schema (validate is the
    // structural check); a truly malformed graph is.
    const malformed = {
      schemaVersion: 999,
      nodes: [],
    } as unknown as ContentGraph;
    await expect(
      writeContentGraph(projectId, malformed),
    ).rejects.toBeInstanceOf(ContentGraphPersistenceError);
    // Empty-but-shape-valid does pass Zod.
    await writeContentGraph(projectId, bad);
    expect((await readContentGraph(projectId))?.nodes).toEqual([]);
  });

  it('rejects an unsafe project id', async () => {
    await expect(
      writeContentGraph('../escape', graph([])),
    ).rejects.toBeInstanceOf(ContentGraphPersistenceError);
  });
});

describe('persistence — selected template', () => {
  it('writes + reads the selected template id', async () => {
    await selectTemplate(projectId, 'frame-clean-title');
    expect(await readSelectedTemplate(projectId)).toBe('frame-clean-title');
  });

  it('returns null when no template has been selected', async () => {
    expect(await readSelectedTemplate(projectId)).toBeNull();
  });

  it('rejects unsafe template ids', async () => {
    await expect(selectTemplate(projectId, '../escape')).rejects.toBeInstanceOf(
      ContentGraphPersistenceError,
    );
  });
});

describe('persistence — frame overrides', () => {
  beforeEach(async () => {
    await writeContentGraph(
      projectId,
      graph([
        { id: 'intro', kind: 'text', text: 'A', durationSec: 1 },
        { id: 'outro', kind: 'text', text: 'B', durationSec: 1 },
      ]),
    );
  });

  it('writes + reads a per-frame HTML override', async () => {
    await writeFrameHtml(projectId, 'intro', '<html><body>X</body></html>');
    expect(await readFrameHtml(projectId, 'intro')).toBe(
      '<html><body>X</body></html>',
    );
  });

  it('returns null when no override exists for the nodeId', async () => {
    expect(await readFrameHtml(projectId, 'outro')).toBeNull();
  });

  it('rejects a nodeId not in the persisted graph', async () => {
    await expect(
      writeFrameHtml(projectId, 'phantom', '<html></html>'),
    ).rejects.toBeInstanceOf(ContentGraphPersistenceError);
  });

  it('rejects an unsafe nodeId regardless of the graph contents', async () => {
    await expect(
      writeFrameHtml(projectId, '../escape', '<html></html>'),
    ).rejects.toBeInstanceOf(ContentGraphPersistenceError);
  });

  it('prunes stale frame overrides whose nodeIds left the graph', async () => {
    await writeFrameHtml(projectId, 'intro', '<html>i</html>');
    await writeFrameHtml(projectId, 'outro', '<html>o</html>');
    const next = graph([
      { id: 'intro', kind: 'text', text: 'A', durationSec: 1 },
    ]);
    await writeContentGraph(projectId, next);
    const removed = await pruneStaleFrameOverrides(projectId, next);
    expect(removed).toEqual(['outro']);
    expect(await readFrameHtml(projectId, 'intro')).toContain('i');
    expect(await readFrameHtml(projectId, 'outro')).toBeNull();
  });
});
