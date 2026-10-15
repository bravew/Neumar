import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression coverage for issue #196: the quality and test jobs used to run only
 * on `release/*` heads, so ordinary PRs (and PRs into `epic/**`) showed green
 * check names without running anything. These tests pin the workflow text and
 * exercise the aggregate gate's decision logic the way GitHub runs it.
 */
const workflowPath = path.resolve(process.cwd(), '.github/workflows/ci.yml');
const workflow = readFileSync(workflowPath, 'utf-8');

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
