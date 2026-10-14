import { afterEach, describe, expect, it } from 'vitest';

import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Regression coverage for the ceiling comparison in
 * `scripts/check-component-size.mjs`.
 *
 * The allowlist is a holding pen, so raising a `current` ceiling must fail
 * while lowering or removing an entry stays allowed. The base side is read
 * from a git ref (`BASE_REF`, default `origin/main`), so each case builds a
 * throwaway repository, commits the baseline allowlist, edits it, and runs
 * the checker against the committed revision.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../');
const CHECKER_SOURCE = path.join(
  REPO_ROOT,
  'scripts',
  'check-component-size.mjs',
);
const ALLOWLIST = 'scripts/component-size-allowlist.json';
const COMPONENT = 'src/components/Probe.tsx';

type Entry = { current: number; target: number };
type Allowlist = Record<string, Entry>;

const trees: string[] = [];

afterEach(async () => {
  await Promise.all(
    trees.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function runChecker(root: string, env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'check-component-size.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
}

async function makeRepo(allowlist: Allowlist) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'component-size-'));
  trees.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'src', 'components'), { recursive: true });
  await cp(
    CHECKER_SOURCE,
    path.join(root, 'scripts', 'check-component-size.mjs'),
  );
  await writeFile(
    path.join(root, COMPONENT),
    'export function Probe() {\n  return null;\n}\n',
  );
  await writeFile(
    path.join(root, ALLOWLIST),
    `${JSON.stringify(allowlist, null, 2)}\n`,
  );
  git(root, ['init', '--quiet']);
  git(root, [
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=t',
    'add',
    '.',
  ]);
  git(root, [
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=t',
    'commit',
    '--quiet',
    '-m',
    'baseline',
  ]);
  return { root, base: git(root, ['rev-parse', 'HEAD']) };
}

async function setAllowlist(root: string, allowlist: Allowlist) {
  await writeFile(
    path.join(root, ALLOWLIST),
    `${JSON.stringify(allowlist, null, 2)}\n`,
  );
}

const baseline: Allowlist = {
  [COMPONENT]: { current: 400, target: 350 },
};

describe('component size ceiling comparison', () => {
  it('fails when a ceiling is raised above the base branch', async () => {
    const { root, base } = await makeRepo(baseline);
    await setAllowlist(root, { [COMPONENT]: { current: 500, target: 350 } });

    const result = runChecker(root, { BASE_REF: base });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('allowlist ceiling raised');
    expect(result.stderr).toContain(
      `${COMPONENT}: ceiling raised from 400 to 500 against ${base}`,
    );
  });

  it('passes when a ceiling is lowered', async () => {
    const { root, base } = await makeRepo(baseline);
    await setAllowlist(root, { [COMPONENT]: { current: 380, target: 350 } });

    const result = runChecker(root, { BASE_REF: base });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`ceilings compared against ${base}`);
  });

  it('passes when an allowlist entry is removed', async () => {
    const { root, base } = await makeRepo(baseline);
    await setAllowlist(root, {});

    const result = runChecker(root, { BASE_REF: base });

    expect(result.status).toBe(0);
  });

  it('passes when the base ref does not exist', async () => {
    const { root } = await makeRepo(baseline);
    await setAllowlist(root, { [COMPONENT]: { current: 500, target: 350 } });

    const result = runChecker(root, { BASE_REF: 'refs/heads/absent' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no base allowlist to compare');
  });

  it('passes when the base ref has no allowlist file', async () => {
    const { root } = await makeRepo(baseline);
    await rm(path.join(root, ALLOWLIST));
    git(root, ['add', '-A']);
    git(root, [
      '-c',
      'user.email=t@example.com',
      '-c',
      'user.name=t',
      'commit',
      '--quiet',
      '-m',
      'drop allowlist',
    ]);
    const base = git(root, ['rev-parse', 'HEAD']);
    await setAllowlist(root, { [COMPONENT]: { current: 500, target: 350 } });

    const result = runChecker(root, { BASE_REF: base });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no base allowlist to compare');
  });
});
