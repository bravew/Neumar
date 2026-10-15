import { afterEach, describe, expect, it } from 'vitest';

import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Regression coverage for `scripts/check-warning-baseline.mjs`.
 *
 * The gate is only useful if it fails on growth and passes on parity, so every
 * case copies the gate and a fixture into a temporary tree and asserts the exit
 * code and the message. The fixtures live in
 * `scripts/fixtures/warning-baseline/`: `clean` carries one warning and one
 * suppression comment, `failing` adds one of each.
 */
const SCRIPTS_DIR = path.resolve(__dirname, '../../../scripts');
const GATE_SOURCE = path.join(SCRIPTS_DIR, 'check-warning-baseline.mjs');
const FIXTURE_ROOT = path.join(SCRIPTS_DIR, 'fixtures', 'warning-baseline');
const OXLINT_BIN = path.join(
  SCRIPTS_DIR,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'oxlint.cmd' : 'oxlint',
);
const OXLINT_CONFIG = path.join(SCRIPTS_DIR, '..', '.oxlintrc.json');
const RULE = 'react-hooks(exhaustive-deps)';

type Baseline = {
  warnings: Record<string, Record<string, number>>;
  suppressions: Record<string, Record<string, number>>;
  exceptions?: Record<string, string>[];
};

const trees: string[] = [];

afterEach(async () => {
  await Promise.all(
    trees.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeBaseline(root: string, baseline: Partial<Baseline>) {
  await writeFile(
    path.join(root, 'scripts', 'lint-warning-baseline.json'),
    `${JSON.stringify(
      {
        version: 1,
        warnings: {},
        suppressions: {},
        exceptions: [],
        ...baseline,
      },
      null,
      2,
    )}\n`,
  );
}

function runGate(
  root: string,
  args: string[] = [],
  env: Record<string, string> = {},
) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'check-warning-baseline.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BASE_REF: '',
        GITHUB_BASE_REF: '',
        OXLINT_BIN,
        OXLINT_CONFIG,
        ...env,
      },
    },
  );
}

function git(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function commitBase(root: string) {
  git(root, ['init', '--quiet']);
  git(root, ['add', '.']);
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
  git(root, ['update-ref', 'refs/remotes/origin/epic/188-merge-gate', 'HEAD']);
}

async function makeTree(fixture: 'clean' | 'failing') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'warning-baseline-'));
  trees.push(root);
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'src', 'components'), { recursive: true });
  await cp(
    GATE_SOURCE,
    path.join(root, 'scripts', 'check-warning-baseline.mjs'),
  );
  await cp(
    path.join(FIXTURE_ROOT, `${fixture}.test.tsx`),
    path.join(root, 'src', 'components', 'Fixture.tsx'),
  );
  return root;
}

const cleanBaseline: Partial<Baseline> = {
  warnings: { 'src/components/Fixture.tsx': { [RULE]: 1 } },
  suppressions: { 'src/components/Fixture.tsx': { [RULE]: 1 } },
};

function exception(overrides: Record<string, string> = {}) {
  return {
    kind: 'warning',
    file: 'src/components/Fixture.tsx',
    rule: RULE,
    owner: '@bravew',
    reason: 'Fixture proves the exception path.',
    expires: '2999-01-01',
    regressionTest: 'scripts/check-warning-baseline.mjs',
    ...overrides,
  };
}

describe('warning baseline gate', () => {
  it('rejects regenerated warning counts against the epic PR base', async () => {
    const root = await makeTree('clean');
    await writeBaseline(root, cleanBaseline);
    await commitBase(root);
    await cp(
      path.join(FIXTURE_ROOT, 'failing.test.tsx'),
      path.join(root, 'src/components/Fixture.tsx'),
    );
    await writeBaseline(root, {
      warnings: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
    });
    const result = runGate(root, [], {
      GITHUB_BASE_REF: 'epic/188-merge-gate',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('baseline warning');
  });

  it('fails when an explicitly selected PR base is unavailable', async () => {
    const root = await makeTree('clean');
    await writeBaseline(root, cleanBaseline);
    const result = runGate(root, [], { BASE_REF: 'origin/absent' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot resolve base ref');
  });

  it('passes when the resolved base predates the baseline file', async () => {
    const root = await makeTree('clean');
    await commitBase(root);
    await writeBaseline(root, cleanBaseline);
    const result = runGate(root, [], {
      GITHUB_BASE_REF: 'epic/188-merge-gate',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Cannot resolve base ref');
  });

  it.each([
    ['an explicit PR base', { GITHUB_BASE_REF: 'epic/188-merge-gate' }],
    ['the optional origin/main default', {}],
  ])(
    'reports a malformed baseline on %s as a parse failure',
    async (_, env) => {
      const root = await makeTree('clean');
      await writeFile(
        path.join(root, 'scripts', 'lint-warning-baseline.json'),
        '{ not json',
      );
      await commitBase(root);
      git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      await writeBaseline(root, cleanBaseline);
      const result = runGate(root, [], env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('is not valid JSON');
      expect(result.stderr).not.toContain('Cannot resolve base ref');
    },
  );

  it('rejects a broader suppression even when its per-rule count is unchanged', async () => {
    const root = await makeTree('clean');
    await writeBaseline(root, cleanBaseline);
    await commitBase(root);
    const file = path.join(root, 'src/components/Fixture.tsx');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace(
        'eslint-disable-next-line',
        'eslint-disable',
      ),
    );
    const result = runGate(root, [], {
      BASE_REF: 'origin/epic/188-merge-gate',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('new suppression');
  });

  it('does not record warning growth with --update', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, cleanBaseline);
    const before = await readFile(
      path.join(root, 'scripts/lint-warning-baseline.json'),
      'utf8',
    );
    const result = runGate(root, ['--update']);
    expect(result.status).toBe(1);
    expect(
      await readFile(
        path.join(root, 'scripts/lint-warning-baseline.json'),
        'utf8',
      ),
    ).toBe(before);
  });

  it('passes a warning removal and records the lower counts', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, {
      warnings: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
    });
    await commitBase(root);
    await cp(
      path.join(FIXTURE_ROOT, 'clean.test.tsx'),
      path.join(root, 'src/components/Fixture.tsx'),
    );
    const result = runGate(root, ['--update'], {
      BASE_REF: 'origin/epic/188-merge-gate',
    });
    expect(result.status).toBe(0);
    const written = JSON.parse(
      await readFile(
        path.join(root, 'scripts/lint-warning-baseline.json'),
        'utf8',
      ),
    ) as Baseline;
    expect(written.warnings).toEqual(cleanBaseline.warnings);
    expect(
      runGate(root, [], { BASE_REF: 'origin/epic/188-merge-gate' }).status,
    ).toBe(0);
  });
  it('passes when warnings and suppressions match the baseline', async () => {
    const root = await makeTree('clean');
    await writeBaseline(root, cleanBaseline);

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Warning baseline gate passed (1 warnings');
    expect(result.stdout).not.toContain('Baseline can be lowered');
  });

  it('fails on a new warning in a changed file', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, cleanBaseline);

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Warning baseline gate FAILED');
    expect(result.stderr).toContain(
      'src/components/Fixture.tsx: react-hooks(exhaustive-deps) grew from 1 to 2',
    );
  });

  it('fails on a new suppression comment', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, {
      warnings: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      suppressions: cleanBaseline.suppressions,
    });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'suppression for react-hooks(exhaustive-deps) grew from 1 to 2',
    );
  });

  it('allows growth covered by a reviewed exception', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, {
      ...cleanBaseline,
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      exceptions: [exception()],
    });

    const result = runGate(root);

    expect(result.status).toBe(0);
  });

  it('fails an exception whose regression test is missing', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, {
      ...cleanBaseline,
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      exceptions: [
        exception({ regressionTest: 'scripts/does-not-exist.test.mjs' }),
      ],
    });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'regression test scripts/does-not-exist.test.mjs does not exist',
    );
  });

  it('fails an exception with no owner', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, {
      ...cleanBaseline,
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      exceptions: [exception({ owner: '' })],
    });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exceptions[0]: missing owner');
  });

  it('fails an expired exception', async () => {
    const root = await makeTree('failing');
    await writeBaseline(root, {
      ...cleanBaseline,
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
      exceptions: [exception({ expires: '2020-01-01' })],
    });

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('expired on 2020-01-01');
  });

  it('reports a reduction so the baseline can be lowered', async () => {
    const root = await makeTree('clean');
    await writeBaseline(root, {
      warnings: { 'src/components/Fixture.tsx': { [RULE]: 3 } },
      suppressions: { 'src/components/Fixture.tsx': { [RULE]: 2 } },
    });

    const result = runGate(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Baseline can be lowered');
    expect(result.stdout).toContain('check-warning-baseline.mjs --update');
  });

  it('fails when the baseline file is missing', async () => {
    const root = await makeTree('clean');

    const result = runGate(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lint-warning-baseline.json is missing');
  });

  it('records the current counts with --update', async () => {
    const root = await makeTree('clean');

    const result = runGate(root, ['--update']);

    expect(result.status).toBe(0);
    const written = JSON.parse(
      await readFile(
        path.join(root, 'scripts', 'lint-warning-baseline.json'),
        'utf8',
      ),
    ) as Baseline;
    expect(written.warnings).toEqual({
      'src/components/Fixture.tsx': { [RULE]: 1 },
    });
    expect(written.suppressions).toEqual({
      'src/components/Fixture.tsx': { [RULE]: 1 },
    });
    expect(written.exceptions).toEqual([]);
  });
});
