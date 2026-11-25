import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Pins the safety properties of the daily preview (#366): no secrets, no release
 * or tag writes, one write-capable job, pinned actions, and the updater isolation
 * in `scripts/build.sh`. The build.sh cases run the real functions in a temp copy
 * of the project, so they check behavior rather than text.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(path.resolve(root, file), 'utf8');

const preview = read('.github/workflows/daily-preview.yml');

function jobBlock(workflow: string, jobId: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start === -1) throw new Error(`job "${jobId}" not found`);
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}

/** The workflow without comment lines, so prose never trips a text check. */
const previewCode = preview
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('daily-preview.yml', () => {
  it('runs on a daily schedule and on manual dispatch only', () => {
    const on = previewCode.split('\njobs:')[0];
    expect(on).toMatch(/schedule:\s*\n\s*- cron: '0 20 \* \* \*'/);
    expect(on).toContain('workflow_dispatch:');
    expect(on).not.toMatch(/^\s{2}(push|pull_request|release):/m);
  });

  it('never queues behind or cancels itself mid-run', () => {
    expect(previewCode).toMatch(
      /concurrency:\s*\n\s+group: daily-preview\s*\n\s+cancel-in-progress: false/,
    );
  });

  it('references no secrets at all', () => {
    expect(previewCode).not.toMatch(/secrets\./);
    expect(previewCode).not.toMatch(/secrets:\s/);
    expect(previewCode).not.toMatch(/inherit/);
  });

  it('does not tag, release, publish, or touch the stable updater feed', () => {
    for (const forbidden of [
      /git tag/,
      /git push[^\n]*--tags/,
      /gh release/,
      /softprops/,
      /\br2\b/i,
      /cloudflare/i,
      /cdn\.neumar\.app/,
      /latest\.json/,
      /--force/,
      /--sign\b/,
      /TAURI_SIGNING/,
      /APPLE_/,
    ]) {
      expect(previewCode).not.toMatch(forbidden);
    }
  });

  it('starts with no permissions and grants each job only what it needs', () => {
    expect(previewCode).toMatch(/^permissions: \{\}$/m);
    for (const job of ['plan', 'build', 'verify', 'record']) {
      expect(jobBlock(previewCode, job)).toMatch(/\n {4}permissions:\n/);
    }
  });

  it('gives write access to exactly one job, which runs no build output', () => {
    const writers = ['plan', 'build', 'verify', 'record'].filter((job) =>
      /contents: write/.test(jobBlock(previewCode, job)),
    );
    expect(writers).toEqual(['record']);
    const record = jobBlock(previewCode, 'record');
    expect(record).not.toContain('download-artifact');
    expect(record).not.toContain('./scripts/build.sh');
  });

  it('advances the pointer only after build and verify succeed', () => {
    const record = jobBlock(previewCode, 'record');
    expect(record).toMatch(/needs: \[plan, build, verify\]/);
    expect(record).not.toMatch(/\bif:/);
    expect(record).toContain('--verified true');
    expect(record).not.toMatch(/push[^\n]*(-f\b|--force)/);
  });

  it('builds on the supported target with a timeout and a frozen lockfile', () => {
    const build = jobBlock(previewCode, 'build');
    expect(build).toContain('runs-on: macos-latest');
    expect(build).toMatch(/timeout-minutes: \d+/);
    expect(build).toContain('pnpm install --frozen-lockfile');
    expect(build).toMatch(/NEUMAR_PREVIEW_BUILD: 'true'/);
    expect(build).toContain('./scripts/build.sh mac-arm');
    expect(build).toContain('scripts/measure-bundle-size.mjs');
    expect(build).toContain('write-sums');
    expect(build).toContain('write-manifest');
    expect(previewCode).toMatch(/TARGET_TRIPLE: aarch64-apple-darwin/);
  });

  it('verifies a fresh download in a separate job before anything is recorded', () => {
    const verify = jobBlock(previewCode, 'verify');
    expect(verify).toMatch(/needs: \[plan, build\]/);
    expect(verify).toContain('actions/download-artifact@');
    expect(verify).toContain('verify-artifact');
    expect(verify).toContain('scripts/daily-preview-smoke.sh');
    expect(verify).toMatch(/timeout-minutes: \d+/);
  });

  it('ends at the plan job when main has not moved or CI is not green', () => {
    const build = jobBlock(previewCode, 'build');
    expect(build).toMatch(/needs: plan/);
    expect(build).toContain("needs.plan.outputs.action == 'build'");
  });

  it('gives each build a unique artifact name and bounded retention', () => {
    expect(previewCode).toMatch(
      /name: daily-preview-\$\{\{ needs\.plan\.outputs\.artifact_name \}\}/,
    );
    expect(previewCode).toMatch(/RETENTION_DAYS: '14'/);
    expect(previewCode).toMatch(
      /retention-days: \$\{\{ env\.RETENTION_DAYS \}\}/,
    );
  });

  it('pins every action to a full commit SHA', () => {
    const uses = [...previewCode.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });

  it('keeps expressions out of run scripts', () => {
    const runBlocks = previewCode.split(/\n\s+run: /).slice(1);
    for (const block of runBlocks) {
      const script = block.split(/\n\s+- name:|\n {2}\w[\w-]*:\n/)[0];
      expect(script).not.toMatch(/\$\{\{/);
    }
  });

  it('does not push the build credential-bearing checkout beyond plan and record', () => {
    for (const job of ['build', 'verify']) {
      expect(jobBlock(previewCode, job)).toContain(
        'persist-credentials: false',
      );
    }
  });
});

describe('other workflows', () => {
  it('build.yml, which holds signing and R2 wiring, gains no schedule', () => {
    const build = read('.github/workflows/build.yml');
    expect(build).not.toMatch(/^\s*schedule:/m);
  });

  it('ci.yml cancels only superseded pull request runs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(ci).not.toMatch(/cancel-in-progress: true/);
  });

  it('ci.yml gives every non-PR run its own group so a pending run is never replaced', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(
      /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.sha \}\}/,
    );
  });
});

describe('scripts/build.sh preview mode', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'build-sh-preview-'));
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'src-tauri'));
    copyFileSync(
      path.resolve(root, 'branding.json'),
      path.join(dir, 'branding.json'),
    );
    copyFileSync(
      path.resolve(root, 'src-tauri/tauri.conf.json'),
      path.join(dir, 'src-tauri/tauri.conf.json'),
    );
    // Drop the trailing `main "$@"` so the functions can be sourced and run alone.
    const script = read('scripts/build.sh').replace(/\nmain "\$@"\s*$/, '\n');
    writeFileSync(path.join(dir, 'scripts/build.sh'), script, { mode: 0o755 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function updaterConfig(previewMode: boolean) {
    const result = spawnSync(
      'bash',
      ['-c', 'source scripts/build.sh; update_tauri_config'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          ...(previewMode ? { NEUMAR_PREVIEW_BUILD: 'true' } : {}),
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(
      readFileSync(path.join(dir, 'src-tauri/tauri.conf.json'), 'utf8'),
    ).plugins.updater as { endpoints: string[]; pubkey: string };
  }

  it('clears the updater endpoints so the app cannot poll the stable feed', () => {
    const original = JSON.parse(read('src-tauri/tauri.conf.json')).plugins
      .updater;
    const updater = updaterConfig(true);
    expect(updater.endpoints).toEqual([]);
    // The plugin requires a pubkey to deserialize its config, so it is kept.
    expect(updater.pubkey).toBe(original.pubkey);
  });

  it('leaves the normal build pointing at the release feed', () => {
    expect(updaterConfig(false).endpoints).toEqual([
      expect.stringMatching(/latest\.json$/),
    ]);
  });

  it('refuses to combine a preview with signing', () => {
    // The sourced copy has no `main` call, so run the unmodified script here.
    writeFileSync(
      path.join(dir, 'scripts/build-full.sh'),
      read('scripts/build.sh'),
      { mode: 0o755 },
    );
    const result = spawnSync(
      'bash',
      ['scripts/build-full.sh', 'mac-arm', '--sign'],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: process.env.HOME ?? '',
          NEUMAR_PREVIEW_BUILD: 'true',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      'cannot be combined with --sign',
    );
  });
});
