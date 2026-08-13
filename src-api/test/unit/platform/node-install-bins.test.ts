import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMiseShimBinPaths,
  getMiseNodeBinPaths,
  getNodeVersionManagerBinPaths,
  getNvmNodeBinPaths,
} from '@/shared/utils/node-install-bins';

let tempHome: string | null = null;

function makeTempHome(): string {
  tempHome = mkdtempSync(join(tmpdir(), 'neuma-node-bins-'));
  return tempHome;
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (tempHome) {
    rmSync(tempHome, { force: true, recursive: true });
    tempHome = null;
  }
});

describe('node install bin discovery', () => {
  it('discovers mise-managed node bin directories', () => {
    const home = makeTempHome();
    const miseBin = join(
      home,
      '.local',
      'share',
      'mise',
      'installs',
      'node',
      '20.11.1',
      'bin',
    );
    mkdirSync(miseBin, { recursive: true });

    expect(getMiseNodeBinPaths(home)).toEqual([miseBin]);
  });

  it('discovers the mise shim directory', () => {
    const home = makeTempHome();
    const shimDir = join(home, '.local', 'share', 'mise', 'shims');
    mkdirSync(shimDir, { recursive: true });

    expect(getMiseShimBinPaths(home)).toEqual([shimDir]);
  });

  it('keeps nvm bins before mise bins', () => {
    const home = makeTempHome();
    const nvmBin = join(home, '.nvm', 'versions', 'node', 'v22.0.0', 'bin');
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
    mkdirSync(nvmBin, { recursive: true });
    mkdirSync(miseBin, { recursive: true });

    expect(getNvmNodeBinPaths(home)).toEqual([nvmBin]);
    expect(getNodeVersionManagerBinPaths(home)).toEqual([nvmBin, miseBin]);
  });

  it('adds mise shims and bins to the Codex sidecar extended PATH', async () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    const shimDir = join(home, '.local', 'share', 'mise', 'shims');
    const miseBin = join(
      home,
      '.local',
      'share',
      'mise',
      'installs',
      'node',
      '22.1.0',
      'bin',
    );
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(miseBin, { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    vi.resetModules();
    const { getExtendedPath } = await import('@/shared/utils/codex-binary');

    const pathDirs = getExtendedPath().split(delimiter);
    expect(pathDirs).toEqual(expect.arrayContaining([shimDir, miseBin]));
    expect(pathDirs.indexOf(shimDir)).toBeLessThan(pathDirs.indexOf(miseBin));
  });
});
