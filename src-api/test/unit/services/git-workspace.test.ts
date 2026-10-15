/**
 * Regression coverage for #226. App-owned repositories and task worktrees must
 * resolve through getAppDir(), so NEUMAR_APP_DATA_DIR moves them and tests or
 * packaging never write into the developer's real home directory.
 *
 * The clone URL is redirected to a local bare repository with git's
 * `url.*.insteadOf` so the test exercises the real `git clone` and
 * `git worktree add` paths without reaching github.com.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createTaskWorktree,
  ensureBaseRepo,
} from '@/shared/services/git-workspace';

function git(args: string[], cwd?: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** Create a bare repository on `main` with one commit, ready to clone. */
function seedBareRepo(bareRepo: string, scratch: string): void {
  mkdirSync(join(bareRepo, '..'), { recursive: true });
  git(['init', '--quiet', '--bare', '--initial-branch=main', bareRepo]);

  const seed = join(scratch, 'seed');
  mkdirSync(seed, { recursive: true });
  git(['init', '--quiet', '--initial-branch=main', seed]);
  writeFileSync(join(seed, 'README.md'), 'hello\n');
  git(['add', 'README.md'], seed);
  git(
    [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      'commit',
      '--quiet',
      '-m',
      'init',
    ],
    seed,
  );
  git(['remote', 'add', 'origin', bareRepo], seed);
  git(['push', '--quiet', 'origin', 'main'], seed);
}

describe('git-workspace honours NEUMAR_APP_DATA_DIR (#226)', () => {
  let dataDir: string;
  let scratch: string;
  let mirrorRoot: string;
  /** A stand-in for the developer's real home; nothing may land here. */
  let fakeHome: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  const originalHome = process.env.HOME;
  const originalOverride = process.env.NEUMAR_APP_DATA_DIR;
  const originalGitConfig = {
    count: process.env.GIT_CONFIG_COUNT,
    key: process.env.GIT_CONFIG_KEY_0,
    value: process.env.GIT_CONFIG_VALUE_0,
  };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'neumar-226-data-'));
    scratch = mkdtempSync(join(tmpdir(), 'neumar-226-scratch-'));
    fakeHome = mkdtempSync(join(tmpdir(), 'neumar-226-home-'));
    mirrorRoot = join(scratch, 'mirror');
    process.env.HOME = fakeHome;
    process.env.NEUMAR_APP_DATA_DIR = dataDir;
    // The spy both fixes the value and records that the home directory was
    // consulted, so a regression back to homedir() is visible.
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    // Redirect https://github.com/... to the local bare repo.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = `url.file://${mirrorRoot}/.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/';
  });

  afterEach(() => {
    homedirSpy.mockRestore();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalOverride === undefined) delete process.env.NEUMAR_APP_DATA_DIR;
    else process.env.NEUMAR_APP_DATA_DIR = originalOverride;

    if (originalGitConfig.count === undefined)
      delete process.env.GIT_CONFIG_COUNT;
    else process.env.GIT_CONFIG_COUNT = originalGitConfig.count;
    if (originalGitConfig.key === undefined)
      delete process.env.GIT_CONFIG_KEY_0;
    else process.env.GIT_CONFIG_KEY_0 = originalGitConfig.key;
    if (originalGitConfig.value === undefined) {
      delete process.env.GIT_CONFIG_VALUE_0;
    } else {
      process.env.GIT_CONFIG_VALUE_0 = originalGitConfig.value;
    }

    rmSync(dataDir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('clones the base repo under the override, not the home directory', async () => {
    seedBareRepo(join(mirrorRoot, 'acme', 'demo.git'), scratch);

    const baseRepoPath = await ensureBaseRepo('acme', 'demo');

    expect(baseRepoPath).toBe(join(dataDir, 'repos', 'acme', 'demo'));
    expect(existsSync(join(baseRepoPath, '.git'))).toBe(true);
    expect(readdirSync(fakeHome)).toEqual([]);
  });

  it('creates the task worktree under the override, not the home directory', async () => {
    const bareRepo = join(mirrorRoot, 'acme', 'demo.git');
    seedBareRepo(bareRepo, scratch);

    const baseRepoPath = join(dataDir, 'repos', 'acme', 'demo');
    mkdirSync(join(baseRepoPath, '..'), { recursive: true });
    git(['clone', '--quiet', bareRepo, baseRepoPath]);

    const worktreePath = await createTaskWorktree(
      baseRepoPath,
      'issue-226-work',
      'main',
      'ISSUE-226',
    );

    expect(worktreePath).toBe(join(dataDir, 'sessions', 'issue-226', 'demo'));
    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
    expect(readdirSync(fakeHome)).toEqual([]);
  });
});
