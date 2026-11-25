import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AGGREGATE_CHECK,
  decideReviewVerdict,
  formatReviewEvidence,
  MAX_REWORK_CYCLES,
  REQUIRED_JOBS,
  RUST_JOB,
  verifyPrGate,
  type CheckRunInput,
} from '../../scripts/verify-pr-gate.mjs';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Regression coverage for issue #196 and #363: the quality and test jobs used to
 * run only on `release/*` heads, so ordinary PRs (and PRs into `epic/**`) showed
 * green check names without running anything. These tests pin the workflow text,
 * exercise the aggregate gate's decision logic the way GitHub runs it, and cover
 * the revision-bound verifier that rejects a green older head, a draft-only skip,
 * cancelled CI, and a pushed follow-up.
 */
const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
const workflow = readFileSync(workflowPath, 'utf-8');

const packageJson = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
) as { scripts: Record<string, string> };

function extractJobBlock(jobId: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start === -1)
    throw new Error(`job "${jobId}" not found in ${workflowPath}`);

  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {2}\S/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

function extractRunScript(jobId: string): string {
  const block = extractJobBlock(jobId);
  const lines = block.split('\n');
  const runIndex = lines.findIndex((line) => /^\s+run: \|$/.test(line));
  if (runIndex === -1) throw new Error(`job "${jobId}" has no "run: |" step`);

  const body: string[] = [];
  for (let i = runIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() !== '' && !/^\s{8,}/.test(line)) break;
    body.push(line);
  }
  return body
    .map((line) => line.replace(/^ {8}/, ''))
    .join('\n')
    .trim();
}

const GATE_SCRIPT = extractRunScript('ci-gate');

function runGate(env: Record<string, string>): {
  status: number;
  stdout: string;
} {
  try {
    const stdout = execFileSync('bash', ['-c', GATE_SCRIPT], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf-8',
    });
    return { status: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? '' };
  }
}

const passingResults = {
  IS_DRAFT_PR: 'false',
  RUN_E2E: 'false',
  QUALITY_RESULT: 'success',
  TEST_RESULT: 'success',
  API_CHECKS_RESULT: 'success',
  VIDEO_IR_RESULT: 'success',
  RUST_RESULT: 'skipped',
  BUILD_RESULT: 'success',
  BROWSER_E2E_RESULT: 'skipped',
};

describe('ci.yml triggers', () => {
  it('runs on pull requests and on pushes to main and epic branches', () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:/m);
    expect(workflow).toMatch(
      /^ {2}push:\n {4}branches: \[main, 'epic\/\*\*'\]$/m,
    );
  });

  it('does not restrict the quality or test jobs to release heads', () => {
    expect(workflow).not.toContain("startsWith(github.head_ref, 'release/')");
    expect(workflow).not.toContain("contains(github.head_ref, 'release-v')");
    const draftGate =
      "github.event_name != 'pull_request' || !github.event.pull_request.draft";
    // quality, test, api-checks, video-ir, rust-checks.
    expect(workflow.split(draftGate)).toHaveLength(6);
  });

  it('runs the warning baseline gate in the quality job', () => {
    expect(extractJobBlock('quality')).toContain(
      'run: pnpm check:warning-baseline',
    );
  });

  it('does not exempt dependency-bot actors', () => {
    expect(workflow).not.toContain("contains(github.actor, 'dependabot')");
    expect(workflow).not.toContain("contains(github.actor, 'renovate')");
  });

  it('pins every action reference to a full commit SHA', () => {
    const uses = workflow
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('uses:'));
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      expect(use).toMatch(/^uses: [^@\s]+@[0-9a-f]{40}( # .+)?$/);
    }
  });

  it('cancels only superseded pull request runs', () => {
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(workflow).toContain(
      "group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    );
  });
});

describe('quality job parity with pnpm validate', () => {
  // The 11 checks `ci.yml` skipped while `pnpm validate` ran them locally.
  const previouslyMissing = [
    'pnpm check:locale-parity',
    'pnpm check:critique-i18n',
    'pnpm --filter neumar-api format:check',
    'pnpm check:design-system-flags',
    'pnpm check:design-media-catalog',
    'pnpm check:uuid-routing',
    'pnpm check:ag-ui-version',
    'pnpm check:plugin-registry',
    'pnpm check:hyperframes-skill',
    'pnpm check:ffmpeg-skill',
    'pnpm check:hyperframes-upgrade',
  ];

  it('runs every check that pnpm validate runs', () => {
    const quality = extractJobBlock('quality');
    const validateCommands = packageJson.scripts.validate
      .split(' && ')
      .map((command) => command.trim())
      .filter(Boolean);

    expect(validateCommands.length).toBeGreaterThan(0);
    for (const command of validateCommands) {
      expect(quality, `quality job is missing: ${command}`).toContain(command);
    }
  });

  it('runs the 11 checks the workflow used to skip', () => {
    const quality = extractJobBlock('quality');
    for (const command of previouslyMissing) {
      expect(quality, `quality job is missing: ${command}`).toContain(command);
    }
  });
});

describe('CI Gate aggregate job', () => {
  it('depends on every required job and always evaluates', () => {
    const block = extractJobBlock('ci-gate');
    expect(block).toMatch(
      /^ {4}needs:\n {6}\[quality, test, api-checks, video-ir, rust-checks, browser-e2e, build\]$/m,
    );
    expect(block).toMatch(/^ {4}if: always\(\)$/m);
  });

  it('passes when every required job succeeded', () => {
    expect(runGate(passingResults).status).toBe(0);
  });

  it('passes a draft pull request, which GitHub cannot merge', () => {
    const result = runGate({
      ...passingResults,
      IS_DRAFT_PR: 'true',
      QUALITY_RESULT: 'skipped',
      TEST_RESULT: 'skipped',
      BUILD_RESULT: 'skipped',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Draft pull request');
  });

  it('fails when a required job fails or is cancelled', () => {
    for (const key of [
      'QUALITY_RESULT',
      'TEST_RESULT',
      'API_CHECKS_RESULT',
      'VIDEO_IR_RESULT',
      'BUILD_RESULT',
    ] as const) {
      expect(runGate({ ...passingResults, [key]: 'failure' }).status).not.toBe(
        0,
      );
      expect(
        runGate({ ...passingResults, [key]: 'cancelled' }).status,
      ).not.toBe(0);
    }
  });

  it('fails when a required job was skipped, which is not a pass', () => {
    for (const key of [
      'QUALITY_RESULT',
      'TEST_RESULT',
      'API_CHECKS_RESULT',
      'VIDEO_IR_RESULT',
      'BUILD_RESULT',
    ] as const) {
      const result = runGate({ ...passingResults, [key]: 'skipped' });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("expected 'success'");
    }
  });

  it('accepts the Rust skip that the job scopes to src-tauri changes', () => {
    expect(runGate(passingResults).status).toBe(0);
    for (const result of ['failure', 'cancelled'] as const) {
      const run = runGate({ ...passingResults, RUST_RESULT: result });
      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain('Rust Checks finished');
    }
  });

  it('requires browser E2E only when it was requested', () => {
    expect(
      runGate({
        ...passingResults,
        RUN_E2E: 'true',
        BROWSER_E2E_RESULT: 'failure',
      }).status,
    ).not.toBe(0);
    expect(
      runGate({
        ...passingResults,
        RUN_E2E: 'true',
        BROWSER_E2E_RESULT: 'success',
      }).status,
    ).toBe(0);
    expect(
      runGate({ ...passingResults, BROWSER_E2E_RESULT: 'failure' }).status,
    ).not.toBe(0);
  });
});

// ─── Revision-bound verifier (#363) ──────────────────────────────────────────

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const MERGE = 'd'.repeat(40);

function checkRun(
  name: string,
  overrides: Partial<CheckRunInput> = {},
): CheckRunInput {
  return {
    name,
    head_sha: HEAD,
    status: 'completed',
    conclusion: 'success',
    app: { id: 15368 },
    ...overrides,
  };
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    state: 'OPEN',
    isDraft: false,
    headRefOid: HEAD,
    baseRefOid: BASE,
    mergeCommit: { oid: MERGE },
    ...overrides,
  };
}

function successfulChecks(
  overrides: Partial<CheckRunInput> = {},
): CheckRunInput[] {
  return [
    ...REQUIRED_JOBS.map((job) => checkRun(job, overrides)),
    checkRun(RUST_JOB, overrides),
    checkRun(AGGREGATE_CHECK, overrides),
  ];
}

function verify(
  overrides: {
    pr?: Record<string, unknown>;
    checks?: CheckRunInput[];
    changedPaths?: string[];
    expectedHead?: string;
    rustRequired?: boolean;
  } = {},
) {
  return verifyPrGate({
    pr: pullRequest(overrides.pr),
    checks: overrides.checks ?? successfulChecks(),
    changedPaths: overrides.changedPaths ?? [],
    ...(overrides.expectedHead ? { expectedHead: overrides.expectedHead } : {}),
    ...(overrides.rustRequired === undefined
      ? {}
      : { rustRequired: overrides.rustRequired }),
  });
}

describe('verifyPrGate revision binding', () => {
  it('verifies a successful run on the exact current head', () => {
    const result = verify();
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('verified');
    expect(result.head).toBe(HEAD);
    expect(result.reasons).toEqual([]);
  });

  it('rejects a draft even when CI Gate exits 0', () => {
    const result = verify({ pr: { isDraft: true } });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain('draft');
  });

  it('rejects a green run produced on an older head', () => {
    const result = verify({ checks: successfulChecks({ head_sha: OLD_HEAD }) });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain('stale-head');
  });

  it('rejects a pushed follow-up after evidence was captured', () => {
    const result = verify({ expectedHead: OLD_HEAD });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain('head-moved');
  });

  it('rejects cancelled CI', () => {
    const result = verify({
      checks: successfulChecks({ conclusion: 'cancelled' }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain('cancelled');
  });

  it('rejects a missing required job', () => {
    const checks = successfulChecks().filter((check) => check.name !== 'Test');
    const result = verify({ checks });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-check', job: 'Test' }),
      ]),
    );
  });

  it('requires Rust Checks only when src-tauri/ changed', () => {
    const withoutRust = successfulChecks().filter(
      (check) => check.name !== RUST_JOB,
    );

    const unchanged = verify({
      checks: withoutRust,
      changedPaths: ['src/app.tsx'],
    });
    expect(unchanged.ok).toBe(true);
    expect(unchanged.rustRequired).toBe(false);

    const changed = verify({
      checks: withoutRust,
      changedPaths: ['src-tauri/Cargo.toml'],
    });
    expect(changed.ok).toBe(false);
    expect(changed.rustRequired).toBe(true);
    expect(changed.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-check', job: RUST_JOB }),
      ]),
    );
  });

  it('accepts a skipped Rust check when src-tauri/ did not change', () => {
    const checks = successfulChecks().map((check) =>
      check.name === RUST_JOB ? { ...check, conclusion: 'skipped' } : check,
    );
    expect(verify({ checks, changedPaths: ['docs/readme.md'] }).ok).toBe(true);
  });

  it('rejects an unknown Rust requirement instead of assuming it passed', () => {
    const result = verifyPrGate({
      pr: pullRequest(),
      checks: successfulChecks(),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((reason) => reason.code)).toContain(
      'rust-requirement-unknown',
    );
  });

  it('rejects a same-named check from a different app', () => {
    const checks = successfulChecks({ app: { id: 999 } });
    const result = verify({ checks });
    expect(result.ok).toBe(false);
    expect(
      result.reasons.some((reason) => reason.code === 'missing-check'),
    ).toBe(true);
  });

  // The REST check-run `id` is assigned at creation and only grows. A queued
  // rerun has no started_at or completed_at, so a timestamp sort would rank the
  // older success above it.
  it('lets a newer queued rerun with null timestamps block an older success', () => {
    const older = { ...checkRun('Test'), id: 100, completed_at: null };
    const queued = {
      ...checkRun('Test', { status: 'queued', conclusion: null }),
      id: 200,
      started_at: null,
      completed_at: null,
    };
    for (const checks of [
      [...successfulChecks(), older, queued],
      [...successfulChecks(), queued, older],
    ]) {
      const result = verify({ checks });
      expect(result.ok).toBe(false);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'not-completed', job: 'Test' }),
        ]),
      );
    }
  });

  it('orders by id before timestamps when an older id has a later timestamp', () => {
    const checks = [
      ...successfulChecks().filter((check) => check.name !== 'Test'),
      {
        ...checkRun('Test'),
        id: 100,
        completed_at: '2026-01-02T00:00:00Z',
      },
      {
        ...checkRun('Test', { conclusion: 'failure' }),
        id: 200,
        completed_at: '2026-01-01T00:00:00Z',
      },
    ];
    expect(verify({ checks }).reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'not-success', job: 'Test' }),
      ]),
    );
  });

  it('does not accept a check with no app identity', () => {
    const checks = successfulChecks().map((check) => {
      const { app: _app, ...withoutApp } = check;
      return withoutApp;
    });
    const result = verify({ checks });
    expect(result.ok).toBe(false);
    expect(
      result.reasons.filter((reason) => reason.code === 'missing-check'),
    ).not.toHaveLength(0);
  });

  it('does not let an app-less check stand in when other apps report the name', () => {
    const { app: _app, ...withoutApp } = checkRun('Test');
    const checks = [
      ...successfulChecks().filter((check) => check.name !== 'Test'),
      withoutApp,
      checkRun('Test', { app: { id: 999 } }),
    ];
    expect(verify({ checks }).reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing-check', job: 'Test' }),
      ]),
    );
  });

  it('uses the newest rerun instead of an older success', () => {
    const checks = [
      ...successfulChecks(),
      checkRun('Test', { status: 'in_progress', conclusion: null }),
    ];
    const result = verify({ checks });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'not-completed', job: 'Test' }),
      ]),
    );
  });
});

describe('decideReviewVerdict bounded rework', () => {
  it('hands a clean, CI-verified head to a human', () => {
    expect(decideReviewVerdict({ ciVerified: true })).toMatchObject({
      verdict: 'ready-for-human',
      halt: false,
    });
  });

  it('never approves a head whose CI is not verified', () => {
    expect(decideReviewVerdict({ ciVerified: false })).toMatchObject({
      verdict: 'request-changes',
    });
  });

  it('requests changes while blocking findings remain', () => {
    expect(
      decideReviewVerdict({ ciVerified: true, blockingFindings: 2 }),
    ).toMatchObject({ verdict: 'request-changes' });
  });

  it('halts at the rework limit and requires a human decision', () => {
    expect(
      decideReviewVerdict({
        ciVerified: true,
        reworkCycles: MAX_REWORK_CYCLES,
      }),
    ).toMatchObject({ verdict: 'needs-decision', halt: true });
  });

  it('still allows a final cycle below the limit', () => {
    expect(
      decideReviewVerdict({
        ciVerified: true,
        reworkCycles: MAX_REWORK_CYCLES - 1,
      }),
    ).toMatchObject({ verdict: 'ready-for-human' });
  });
});

describe('formatReviewEvidence', () => {
  it('stamps the exact head, base, and CI Gate evidence', () => {
    const evidence = formatReviewEvidence(verify());
    expect(evidence).toContain(`Head: \`${HEAD}\``);
    expect(evidence).toContain(`Base: \`${BASE}\``);
    expect(evidence).toContain(`Merge commit: \`${MERGE}\``);
    expect(evidence).toContain('CI Gate: `success`');
    expect(evidence).toContain('CI verified on exact head: `yes`');
  });

  it('records why a revision is not verified', () => {
    const evidence = formatReviewEvidence(
      verify({ checks: successfulChecks({ head_sha: OLD_HEAD }) }),
    );
    expect(evidence).toContain('CI verified on exact head: `no`');
    expect(evidence).toContain('not the current head');
  });

  it('lists every excluded path instead of silently passing an empty diff', () => {
    const changedPaths = ['README.md', 'pnpm-lock.yaml'];
    const evidence = formatReviewEvidence(verify(), {
      allExcluded: true,
      changedPaths,
    });
    expect(evidence).toContain('No reviewable code changes');
    for (const filePath of changedPaths) {
      expect(evidence).toContain(`\`${filePath}\``);
    }
  });
});

describe('verify-pr-gate CLI', () => {
  const cli = path.resolve(process.cwd(), 'scripts/verify-pr-gate.mjs');
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'verify-pr-gate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fixtures(
    pr: Record<string, unknown>,
    checks: CheckRunInput[],
    changedPaths: string[] = [],
  ) {
    const prFile = path.join(dir, 'pr.json');
    const checksFile = path.join(dir, 'checks.json');
    const changedFile = path.join(dir, 'changed-paths.txt');
    writeFileSync(prFile, JSON.stringify(pr));
    writeFileSync(
      checksFile,
      JSON.stringify({ total_count: checks.length, check_runs: checks }),
    );
    writeFileSync(changedFile, changedPaths.join('\n'));
    return { prFile, checksFile, changedFile };
  }

  function run(args: string[]): { status: number; stdout: string } {
    try {
      const stdout = execFileSync(process.execPath, [cli, ...args], {
        encoding: 'utf-8',
      });
      return { status: 0, stdout };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      return { status: failure.status ?? 1, stdout: failure.stdout ?? '' };
    }
  }

  it('emits revision evidence for a verified head', () => {
    const files = fixtures(pullRequest(), successfulChecks());
    const result = run([
      'evidence',
      '--pr',
      files.prFile,
      '--checks',
      files.checksFile,
      '--changed',
      files.changedFile,
      '--expected-head',
      HEAD,
      '--all-excluded',
      'false',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Head: \`${HEAD}\``);
    expect(result.stdout).toContain('CI verified on exact head: `yes`');
  });

  it('exits nonzero when verify sees a draft', () => {
    const files = fixtures(pullRequest({ isDraft: true }), successfulChecks());
    const result = run([
      'verify',
      '--pr',
      files.prFile,
      '--checks',
      files.checksFile,
      '--changed',
      files.changedFile,
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('"code": "draft"');
  });

  it('exits nonzero when verify sees a green older head', () => {
    const files = fixtures(
      pullRequest(),
      successfulChecks({ head_sha: OLD_HEAD }),
    );
    const result = run([
      'verify',
      '--pr',
      files.prFile,
      '--checks',
      files.checksFile,
      '--changed',
      files.changedFile,
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('"code": "stale-head"');
  });
});
