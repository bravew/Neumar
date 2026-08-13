import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getConfiguredExecutablePath,
  getExtendedPath,
  resolveConfiguredBinary,
  resolveOnPath,
} from '@/shared/agent-runtimes/resolve';
import { getSetting } from '@/shared/db/operations';

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(),
}));

describe('agent runtime binary resolution', () => {
  let tempHome: string | null = null;

  function makeTempHome(): string {
    tempHome = mkdtempSync(join(tmpdir(), 'neuma-runtime-resolve-'));
    return tempHome;
  }

  beforeEach(() => {
    vi.mocked(getSetting).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempHome) {
      rmSync(tempHome, { force: true, recursive: true });
      tempHome = null;
    }
  });

  it('reads a configured executable path by runtime id', () => {
    vi.mocked(getSetting).mockReturnValue(
      JSON.stringify([
        {
          id: 'codex',
          type: 'codex',
          config: { executablePath: process.execPath },
        },
      ]),
    );

    expect(getConfiguredExecutablePath('codex')).toBe(process.execPath);
  });

  it('ignores empty or invalid configured executable paths', () => {
    vi.mocked(getSetting).mockReturnValue(
      JSON.stringify([
        {
          id: 'codex',
          config: { executablePath: ' \0 ' },
        },
      ]),
    );

    expect(getConfiguredExecutablePath('codex')).toBeNull();
  });

  it('resolves existing configured executable paths as configured source', () => {
    vi.mocked(getSetting).mockReturnValue(
      JSON.stringify([
        {
          id: 'codex',
          config: { executablePath: process.execPath },
        },
      ]),
    );

    expect(resolveConfiguredBinary('codex')).toEqual({
      path: process.execPath,
      source: 'configured',
    });
  });

  it('does not resolve missing configured executable paths', () => {
    vi.mocked(getSetting).mockReturnValue(
      JSON.stringify([
        {
          id: 'codex',
          config: { executablePath: '/definitely/missing/codex' },
        },
      ]),
    );

    expect(resolveConfiguredBinary('codex')).toBeNull();
  });

  it('adds mise node bins to the extended runtime PATH', () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    const nvmBin = join(home, '.nvm', 'versions', 'node', 'v22.0.0', 'bin');
    const miseShim = join(home, '.local', 'share', 'mise', 'shims');
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
    mkdirSync(miseShim, { recursive: true });
    mkdirSync(miseBin, { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    const pathDirs = getExtendedPath().split(delimiter);

    expect(pathDirs).toEqual(
      expect.arrayContaining([nvmBin, miseShim, miseBin]),
    );
    expect(pathDirs.indexOf(miseShim)).toBeLessThan(pathDirs.indexOf(nvmBin));
    expect(pathDirs.indexOf(nvmBin)).toBeLessThan(pathDirs.indexOf(miseBin));
  });

  it('adds common package-manager bins to the extended runtime PATH', () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    const pathDirs = getExtendedPath().split(delimiter);

    expect(pathDirs).toEqual(
      expect.arrayContaining([
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt/local/bin',
        '/home/linuxbrew/.linuxbrew/bin',
        `${home}/.cargo/bin`,
        `${home}/.bun/bin`,
      ]),
    );
  });

  it('adds Windows fnm node-version install roots without relying on host OS', () => {
    const appData = 'C:\\Users\\Ada\\AppData\\Roaming';
    const localAppData = 'C:\\Users\\Ada\\AppData\\Local';
    const fnmDir = 'D:\\fnm';
    const existing = new Set([
      `${localAppData}\\fnm_multishells`,
      `${appData}\\fnm\\node-versions`,
      `${appData}\\fnm\\node-versions\\v22.1.0\\installation`,
      `${localAppData}\\fnm\\node-versions`,
      `${localAppData}\\fnm\\node-versions\\v20.11.1`,
      `${fnmDir}\\node-versions`,
      `${fnmDir}\\node-versions\\v21.7.0\\installation`,
    ]);
    const children = new Map([
      [`${localAppData}\\fnm_multishells`, ['12345']],
      [`${appData}\\fnm\\node-versions`, ['v22.1.0']],
      [`${localAppData}\\fnm\\node-versions`, ['v20.11.1']],
      [`${fnmDir}\\node-versions`, ['v21.7.0']],
    ]);

    const pathDirs = getExtendedPath({
      platform: 'win32',
      env: {
        PATH: 'C:\\Windows\\System32',
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        FNM_DIR: fnmDir,
        USERPROFILE: 'C:\\Users\\Ada',
      },
      pathExists: (path) => existing.has(path),
      readDir: (path) => children.get(path) ?? [],
    }).split(';');

    expect(pathDirs).toEqual(
      expect.arrayContaining([
        `${localAppData}\\fnm_multishells\\12345`,
        `${appData}\\fnm\\node-versions\\v22.1.0\\installation`,
        `${localAppData}\\fnm\\node-versions\\v20.11.1`,
        `${fnmDir}\\node-versions\\v21.7.0\\installation`,
      ]),
    );
  });

  it('resolves binaries from mise shims', () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    const shimDir = join(home, '.local', 'share', 'mise', 'shims');
    const binaryName = `neuma-mise-shim-${process.pid}`;
    const binaryPath = join(shimDir, binaryName);
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');
    chmodSync(binaryPath, 0o755);
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    expect(resolveOnPath(binaryName)).toEqual({
      path: binaryPath,
      source: 'path',
    });
  });

  it('resolves binaries from mise node bins', () => {
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
    const binaryName = `neuma-mise-bin-${process.pid}`;
    const binaryPath = join(miseBin, binaryName);
    mkdirSync(miseBin, { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');
    chmodSync(binaryPath, 0o755);
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    expect(resolveOnPath(binaryName)).toEqual({
      path: binaryPath,
      source: 'path',
    });
  });

  it('resolves npm-installed OpenCode through the shared extended PATH', () => {
    if (process.platform === 'win32') return;

    const home = makeTempHome();
    const npmGlobalBin = join(home, '.npm-global', 'bin');
    const binaryPath = join(npmGlobalBin, 'opencode');
    mkdirSync(npmGlobalBin, { recursive: true });
    writeFileSync(binaryPath, '#!/bin/sh\n');
    chmodSync(binaryPath, 0o755);
    vi.stubEnv('HOME', home);
    vi.stubEnv('PATH', '/usr/bin');

    expect(resolveOnPath('opencode')).toEqual({
      path: binaryPath,
      source: 'path',
    });
  });

  it('resolves Windows PATHEXT binaries through injected path discovery', () => {
    const root = 'C:\\Users\\Ada\\AppData\\Roaming\\npm';
    const binaryPath = `${root}\\codex.CMD`;
    const existing = new Set([binaryPath]);

    expect(
      resolveOnPath('codex', {
        platform: 'win32',
        env: {
          PATH: root,
          PATHEXT: '.EXE;.CMD',
        },
        pathExists: (path) => existing.has(path),
        readDir: () => [],
      }),
    ).toEqual({
      path: binaryPath,
      source: 'path',
    });
  });
});
