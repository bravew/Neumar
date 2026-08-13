import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveBinaryPath } from '@/extensions/agent/shared/cli';

let tempHome: string | null = null;

function makeTempHome(): string {
  tempHome = mkdtempSync(join(tmpdir(), 'neuma-shared-cli-'));
  return tempHome;
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempHome) {
    rmSync(tempHome, { force: true, recursive: true });
    tempHome = null;
  }
});

describe('shared CLI command resolver', () => {
  it('resolves binaries installed under mise shims', () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    const shimDir = join(home, '.local', 'share', 'mise', 'shims');
    const binaryName = `neuma-mise-shim-cli-${process.pid}`;
    const binaryPath = join(shimDir, binaryName);
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');
    chmodSync(binaryPath, 0o755);
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    expect(resolveBinaryPath(binaryName)).toBe(binaryPath);
  });

  it('resolves binaries installed under mise node bins', () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    const miseBin = join(
      home,
      '.local',
      'share',
      'mise',
      'installs',
      'node',
      '22.0.0',
      'bin',
    );
    const binaryName = `neuma-mise-cli-${process.pid}`;
    const binaryPath = join(miseBin, binaryName);
    mkdirSync(miseBin, { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');
    chmodSync(binaryPath, 0o755);
    vi.stubEnv('HOME', home);

    expect(resolveBinaryPath(binaryName)).toBe(binaryPath);
  });
});
