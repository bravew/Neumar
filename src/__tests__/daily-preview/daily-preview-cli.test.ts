import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Runs the real `scripts/daily-preview.mjs` with a fake `gh` on PATH, so exit
 * codes, GITHUB_OUTPUT contents, and the fail-closed paths are exercised the way
 * the workflow runs them. The fake `gh` never touches the network.
 */
const CLI = path.resolve(process.cwd(), 'scripts/daily-preview.mjs');
const CANDIDATE = 'a'.repeat(40);
const LAST_GOOD = 'b'.repeat(40);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'daily-preview-cli-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const gh = path.join(bin, 'gh');
  writeFileSync(
    gh,
    [
      '#!/bin/bash',
      'echo called >> "$FAKE_GH_CALLS"',
      'if [ "$FAKE_GH_MODE" = "fail" ]; then echo "HTTP 502" >&2; exit 1; fi',
      'cat "$FAKE_GH_PAYLOAD"',
      '',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gateRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'CI Gate',
    app: { id: 15368 },
    head_sha: CANDIDATE,
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-11-24T10:00:00Z',
    ...overrides,
  };
}

function runCli(
  args: string[],
  options: { gh?: 'ok' | 'fail'; payload?: unknown } = {},
) {
  const payloadFile = path.join(dir, 'payload.json');
  writeFileSync(
    payloadFile,
    JSON.stringify(
      options.payload ?? { total_count: 1, check_runs: [gateRun()] },
    ),
  );
  const outputFile = path.join(dir, 'github-output');
  const summaryFile = path.join(dir, 'github-summary');
  const callsFile = path.join(dir, 'gh-calls');
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      FAKE_GH_MODE: options.gh ?? 'ok',
      FAKE_GH_PAYLOAD: payloadFile,
      FAKE_GH_CALLS: callsFile,
    },
  });
  const outputs: Record<string, string> = {};
  if (existsSync(outputFile)) {
    for (const line of readFileSync(outputFile, 'utf8').split('\n')) {
      const index = line.indexOf('=');
      if (index > 0) outputs[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return {
    status: result.status,
    stderr: result.stderr,
    outputs,
    ghCalls: existsSync(callsFile)
      ? readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).length
      : 0,
  };
}

function writePointer(sha: string, file = 'last-good.json') {
  const target = path.join(dir, file);
  writeFileSync(
    target,
    JSON.stringify({
      schema: 1,
      sha,
      advancedAt: '2026-11-23T20:30:00Z',
      runUrl: 'https://example.test/run/0',
      artifact: '2026-11-23-bbbbbbb',
    }),
  );
  return target;
}

const planArgs = (pointer: string) => [
  'plan',
  '--repo',
  'bravew/Neumar',
  '--candidate',
  CANDIDATE,
  '--date',
  '2026-11-24',
  '--pointer',
  pointer,
];

describe('daily-preview plan', () => {
  it('builds new verified commits and names the artifact by date and SHA', () => {
    const result = runCli(planArgs(writePointer(LAST_GOOD)));
    expect(result.status).toBe(0);
    expect(result.outputs).toMatchObject({
      action: 'build',
      candidate_sha: CANDIDATE,
      last_good_sha: LAST_GOOD,
      range: `${LAST_GOOD}..${CANDIDATE}`,
      artifact_name: '2026-11-24-aaaaaaa',
    });
  });

  it('builds the first run from an explicit "none" pointer', () => {
    const result = runCli(planArgs('none'));
    expect(result.status).toBe(0);
    expect(result.outputs.action).toBe('build');
    expect(result.outputs.last_good_sha).toBe('none');
    expect(result.outputs.range).toBe(`initial..${CANDIDATE}`);
  });

  it('reports no-change without calling GitHub at all', () => {
    const result = runCli(planArgs(writePointer(CANDIDATE)), { gh: 'fail' });
    expect(result.status).toBe(0);
    expect(result.outputs.action).toBe('no-change');
    expect(result.ghCalls).toBe(0);
  });

  it.each([
    ['failed', { conclusion: 'failure' }, 'ci-failed'],
    ['cancelled', { conclusion: 'cancelled' }, 'ci-failed'],
    ['in progress', { status: 'in_progress', conclusion: null }, 'ci-pending'],
  ])('aborts and exits non-zero when the gate is %s', (_n, run, reason) => {
    const result = runCli(planArgs(writePointer(LAST_GOOD)), {
      payload: { total_count: 1, check_runs: [gateRun(run)] },
    });
    expect(result.status).toBe(1);
    expect(result.outputs.action).toBe('abort');
    expect(result.outputs.reason).toContain(reason);
  });

  it('aborts when the gate is missing on the frozen SHA', () => {
    const result = runCli(planArgs(writePointer(LAST_GOOD)), {
      payload: { total_count: 0, check_runs: [] },
    });
    expect(result.status).toBe(1);
    expect(result.outputs.reason).toContain('ci-missing');
  });

  it('aborts as unknown when GitHub cannot be read', () => {
    const result = runCli(planArgs(writePointer(LAST_GOOD)), { gh: 'fail' });
    expect(result.status).toBe(1);
    expect(result.outputs.action).toBe('abort');
    expect(result.outputs.reason).toContain('ci-unknown');
  });

  it('fails closed on a corrupt pointer and emits no decision', () => {
    const corrupt = path.join(dir, 'corrupt.json');
    writeFileSync(corrupt, '{"schema": 1, "sha": "nope"');
    const result = runCli(planArgs(corrupt));
    expect(result.status).toBe(1);
    expect(result.outputs.action).toBeUndefined();
  });

  it('fails closed when the pointer file cannot be read', () => {
    const result = runCli(planArgs(path.join(dir, 'does-not-exist.json')));
    expect(result.status).toBe(1);
    expect(result.outputs.action).toBeUndefined();
  });

  it('rejects a candidate that is not a full SHA', () => {
    const args = planArgs('none');
    args[args.indexOf(CANDIDATE)] = 'main';
    const result = runCli(args);
    expect(result.status).toBe(1);
    expect(result.outputs.action).toBeUndefined();
  });
});

describe('daily-preview artifact verification', () => {
  function stage() {
    const stageDir = path.join(dir, 'stage');
    mkdirSync(stageDir);
    writeFileSync(
      path.join(stageDir, 'neumar-preview_2026-11-24-aaaaaaa_aarch64.dmg'),
      'dmg-bytes',
    );
    const bundle = path.join(dir, 'bundle-size-report.json');
    writeFileSync(bundle, JSON.stringify({ triple: 'aarch64-apple-darwin' }));
    const manifest = runCli([
      'write-manifest',
      '--dir',
      stageDir,
      '--candidate',
      CANDIDATE,
      '--last-good',
      LAST_GOOD,
      '--range',
      `${LAST_GOOD}..${CANDIDATE}`,
      '--triple',
      'aarch64-apple-darwin',
      '--artifact-name',
      '2026-11-24-aaaaaaa',
      '--run-url',
      'https://example.test/run/1',
      '--retention-days',
      '14',
      '--bundle-size',
      bundle,
    ]);
    expect(manifest.status).toBe(0);
    expect(runCli(['write-sums', '--dir', stageDir]).status).toBe(0);
    return stageDir;
  }

  const verify = (stageDir: string, candidate = CANDIDATE) =>
    runCli(['verify-artifact', '--dir', stageDir, '--candidate', candidate]);

  it('accepts an intact artifact and reports the DMG name', () => {
    const result = verify(stage());
    expect(result.status).toBe(0);
    expect(result.outputs.dmg).toBe(
      'neumar-preview_2026-11-24-aaaaaaa_aarch64.dmg',
    );
  });

  it('records commit range, target, updater state, retention and bundle size', () => {
    const stageDir = stage();
    const manifest = JSON.parse(
      readFileSync(path.join(stageDir, 'preview-manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      candidateSha: CANDIDATE,
      lastGoodSha: LAST_GOOD,
      range: `${LAST_GOOD}..${CANDIDATE}`,
      target: 'aarch64-apple-darwin',
      updater: 'disabled',
      retentionDays: 14,
      runUrl: 'https://example.test/run/1',
      bundleSize: { triple: 'aarch64-apple-darwin' },
    });
  });

  it('rejects a corrupted DMG', () => {
    const stageDir = stage();
    writeFileSync(
      path.join(stageDir, 'neumar-preview_2026-11-24-aaaaaaa_aarch64.dmg'),
      'tampered',
    );
    const result = verify(stageDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('checksum mismatch');
  });

  it('rejects a missing DMG', () => {
    const stageDir = stage();
    rmSync(
      path.join(stageDir, 'neumar-preview_2026-11-24-aaaaaaa_aarch64.dmg'),
    );
    const result = verify(stageDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing file');
  });

  it('rejects a missing SHA256SUMS', () => {
    const stageDir = stage();
    rmSync(path.join(stageDir, 'SHA256SUMS'));
    const result = verify(stageDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing SHA256SUMS');
  });

  it('rejects an extra file that SHA256SUMS does not list', () => {
    const stageDir = stage();
    writeFileSync(path.join(stageDir, 'injected.sh'), 'echo hi');
    const result = verify(stageDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unlisted file: injected.sh');
  });

  it('rejects an artifact built for a different commit', () => {
    const result = verify(stage(), 'c'.repeat(40));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not match the planned candidate');
  });

  it('rejects a manifest that does not record the updater as disabled', () => {
    const stageDir = stage();
    const manifestPath = path.join(stageDir, 'preview-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.updater = 'enabled';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    // Re-sign the listing so only the updater claim is wrong.
    expect(runCli(['write-sums', '--dir', stageDir]).status).toBe(0);
    const result = verify(stageDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('updater as disabled');
  });
});

describe('daily-preview next-pointer', () => {
  const args = (overrides: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      current: writePointer(LAST_GOOD),
      expected: LAST_GOOD,
      candidate: CANDIDATE,
      verified: 'true',
      'run-url': 'https://example.test/run/1',
      artifact: '2026-11-24-aaaaaaa',
      out: path.join(dir, 'next.json'),
      ...overrides,
    };
    return [
      'next-pointer',
      ...Object.entries(values).flatMap(([k, v]) => [`--${k}`, v]),
    ];
  };

  it('writes the advanced pointer for a verified build', () => {
    const result = runCli(args());
    expect(result.status).toBe(0);
    const next = JSON.parse(readFileSync(path.join(dir, 'next.json'), 'utf8'));
    expect(next).toMatchObject({ schema: 1, sha: CANDIDATE });
  });

  it('keeps the old pointer when the build was not verified', () => {
    const result = runCli(args({ verified: 'false' }));
    expect(result.status).toBe(1);
    expect(existsSync(path.join(dir, 'next.json'))).toBe(false);
  });

  it('keeps the old pointer when it moved since the plan', () => {
    const result = runCli(args({ expected: 'c'.repeat(40) }));
    expect(result.status).toBe(1);
    expect(existsSync(path.join(dir, 'next.json'))).toBe(false);
  });
});
