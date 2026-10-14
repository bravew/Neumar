/**
 * Containment on resolved paths (findings: files.ts:92).
 *
 * The old check compared a normalized path against a root with a bare
 * `startsWith`, which accepts a sibling that shares a prefix (`/tmp-other` for
 * `/tmp`) and never resolved the path it was judging, so a symlink inside a
 * root passed as long as its literal spelling sat under the root.
 *
 * Two halves are pinned separately:
 *
 *  - `isPathInsideRoot` runs against a real temporary tree, so the sibling,
 *    symlink, and not-yet-created write target are measured facts.
 *  - the `/files/*` routes are driven over HTTP to prove the helper is what the
 *    routes actually consult, including the write case where the file does not
 *    exist yet and only its parent can be resolved.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

let tempRoot: string;
let home: string;
let appDir: string;
let workspace: string;

const mockGetSetting = vi.fn();

vi.mock('@/config/constants', () => ({
  APP_DIR_NAME: 'neumar-test',
  getAllSkillsDirs: vi.fn().mockReturnValue([]),
  getBundledSkillsDir: vi.fn().mockReturnValue('/tmp/bundled-skills'),
  getClaudeSkillsDir: vi.fn().mockReturnValue('/tmp/.claude/skills'),
  getAppDir: () => appDir,
  getHomeDir: () => home,
}));

vi.mock('@/shared/db/operations', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/paths', () => ({
  expandPath: (p: string) => p,
}));

const { isPathInsideAnyRoot, isPathInsideRoot } =
  await import('@/shared/utils/path-validator');
const { filesRoutes } = await import('@/app/api/files');

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'neumar-containment-'));
  home = path.join(tempRoot, 'home');
  appDir = path.join(tempRoot, 'appdata');
  workspace = path.join(tempRoot, 'workspace');
  await mkdir(home, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  mockGetSetting.mockReturnValue(workspace);
});

afterEach(async () => {
  mockGetSetting.mockReset();
  await rm(tempRoot, { recursive: true, force: true });
});

async function post(route: string, body: unknown): Promise<Response> {
  return filesRoutes.request(jsonReq(route, body));
}

describe('isPathInsideRoot', () => {
  it('accepts the root itself and a descendant', async () => {
    const child = path.join(workspace, 'nested', 'file.txt');
    await mkdir(path.dirname(child), { recursive: true });
    await writeFile(child, 'x');

    expect(isPathInsideRoot(workspace, workspace)).toBe(true);
    expect(isPathInsideRoot(workspace, child)).toBe(true);
  });

  it('rejects a sibling that shares a string prefix with the root', async () => {
    const sibling = path.join(tempRoot, 'workspace-other', 'file.txt');
    await mkdir(path.dirname(sibling), { recursive: true });
    await writeFile(sibling, 'x');

    // `startsWith(root)` accepts this: ".../workspace-other" begins with
    // ".../workspace". The separator check is what rejects it.
    expect(sibling.startsWith(workspace)).toBe(true);
    expect(isPathInsideRoot(workspace, sibling)).toBe(false);
  });

  it('rejects a symlink inside the root that points outside it', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspace, 'escape'));

    // The literal path is inside the root; the file it names is not.
    expect(
      isPathInsideRoot(workspace, path.join(workspace, 'escape', 'secret.txt')),
    ).toBe(false);
  });

  it('rejects a write target under a symlinked parent that escapes the root', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(workspace, 'escape'));

    // The file does not exist yet, so only the parent can be resolved.
    expect(
      isPathInsideRoot(
        workspace,
        path.join(workspace, 'escape', 'created.txt'),
      ),
    ).toBe(false);
  });

  it('accepts a not-yet-created file under a real directory inside the root', () => {
    expect(
      isPathInsideRoot(workspace, path.join(workspace, 'output', 'new.txt')),
    ).toBe(true);
  });

  it('rejects a path whose nearest existing ancestor cannot be resolved', async () => {
    // A dangling symlink: the link exists but `realpath` fails on it.
    await symlink(
      path.join(tempRoot, 'gone'),
      path.join(workspace, 'dangling'),
    );

    expect(
      isPathInsideRoot(workspace, path.join(workspace, 'dangling', 'f.txt')),
    ).toBe(false);
  });

  it('is false for a path outside every root', () => {
    expect(isPathInsideRoot(workspace, '/etc/hosts')).toBe(false);
  });
});

describe('isPathInsideAnyRoot', () => {
  it('accepts a path inside any one of the roots', async () => {
    const second = path.join(tempRoot, 'b');
    await mkdir(second, { recursive: true });
    await writeFile(path.join(second, 'f.txt'), 'x');

    expect(
      isPathInsideAnyRoot([workspace, second], path.join(second, 'f.txt')),
    ).toBe(true);
    expect(isPathInsideAnyRoot([workspace, second], '/etc/hosts')).toBe(false);
  });
});

describe('/files routes containment', () => {
  it('reads a file under the configured workspace', async () => {
    const target = path.join(workspace, 'note.txt');
    await writeFile(target, 'hello');

    const response = await post('/read', { path: target });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      content: 'hello',
    });
  });

  it('refuses a sibling directory that shares a prefix with the workspace', async () => {
    const sibling = path.join(tempRoot, 'workspace-other');
    await mkdir(sibling, { recursive: true });
    await writeFile(path.join(sibling, 'note.txt'), 'secret');

    const response = await post('/read', {
      path: path.join(sibling, 'note.txt'),
    });
    // Untrusted: the sibling only shares the workspace's string prefix.
    expect(response.status).toBe(403);
  });

  it('refuses a read through a symlink that leaves the workspace', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(workspace, 'escape'));

    const response = await post('/read', {
      path: path.join(workspace, 'escape', 'secret.txt'),
    });
    expect(response.status).toBe(403);
  });

  it('refuses a write whose new file sits under a symlinked parent that leaves the workspace', async () => {
    const outside = path.join(tempRoot, 'outside');
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(workspace, 'escape'));

    // The file does not exist yet, so only the symlinked parent is resolvable.
    const response = await post('/open', {
      path: path.join(workspace, 'escape', 'created.txt'),
      createIfMissing: true,
    });
    expect(response.status).toBe(403);
  });
});
