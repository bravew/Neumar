import { describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Regression coverage for issue #197: `pnpm validate` does not run API lint,
 * API test-file typechecking, the shared video IR suite, or Rust checks, so
 * those gaps reached main. These tests pin the added jobs and exercise the
 * aggregate gate's decision logic the way GitHub runs it, including the single
 * accepted Rust skip.
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

describe('ci.yml extended checks', () => {
  it('adds the checks pnpm validate does not run', () => {
    expect(extractJobBlock('api-checks')).toContain(
      'pnpm --filter neumar-api lint',
    );
    expect(extractJobBlock('api-checks')).toContain(
      'pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit',
    );
    expect(extractJobBlock('video-ir')).toContain(
      'pnpm --filter @neumar/video-ir test',
    );
    expect(extractJobBlock('video-ir')).toContain(
      'pnpm --filter @neumar/video-ir validate',
    );
    expect(extractJobBlock('rust-checks')).toContain(
      'cargo fmt --manifest-path src-tauri/Cargo.toml --check',
    );
    expect(extractJobBlock('rust-checks')).toContain(
      'cargo check --manifest-path src-tauri/Cargo.toml --locked',
    );
  });

  it('scopes the Rust job to src-tauri changes with an explicit skip reason', () => {
    const block = extractJobBlock('rust-checks');
    expect(block).toContain(
      'git diff --quiet "$BASE_SHA"...HEAD -- src-tauri/',
    );
    expect(block).toContain(
      'No src-tauri/ changes in this PR; Rust checks skipped.',
    );
  });

  it('fetches full history so base-aware gates can resolve the PR base', () => {
    expect(extractJobBlock('quality')).toContain('fetch-depth: 0');
    expect(extractJobBlock('rust-checks')).toContain('fetch-depth: 0');
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
    for (const job of [
      'quality',
      'test',
      'api-checks',
      'video-ir',
      'rust-checks',
      'browser-e2e',
      'build',
    ]) {
      expect(block).toContain(job);
    }
    expect(block).toMatch(/^ {4}if: always\(\)$/m);
  });

  it('passes when every required job succeeded and Rust was skipped', () => {
    expect(runGate(passingResults).status).toBe(0);
  });

  it('fails when an extended check fails, is cancelled, or is skipped', () => {
    for (const key of ['API_CHECKS_RESULT', 'VIDEO_IR_RESULT'] as const) {
      expect(runGate({ ...passingResults, [key]: 'failure' }).status).not.toBe(
        0,
      );
      expect(
        runGate({ ...passingResults, [key]: 'cancelled' }).status,
      ).not.toBe(0);
      expect(runGate({ ...passingResults, [key]: 'skipped' }).status).not.toBe(
        0,
      );
    }
  });

  it('accepts a skipped Rust job but not a failed one', () => {
    expect(runGate({ ...passingResults, RUST_RESULT: 'skipped' }).status).toBe(
      0,
    );
    expect(
      runGate({ ...passingResults, RUST_RESULT: 'failure' }).status,
    ).not.toBe(0);
    expect(
      runGate({ ...passingResults, RUST_RESULT: 'cancelled' }).status,
    ).not.toBe(0);
  });
});
