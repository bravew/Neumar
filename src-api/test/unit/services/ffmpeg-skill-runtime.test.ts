/**
 * Installed-runtime discovery tests for the managed FFmpeg skill.
 *
 * `resolvePython` shells out once per interpreter candidate and is exercised
 * here with a mocked `spawnSync` so the tests never depend on a real Python
 * on the test host. The three cases cover the failure modes the runner must
 * turn into an actionable `missing_runtime` result instead of a silent
 * success or a download.
 */
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FfmpegSkillError } from '@/shared/services/ffmpeg-skill/errors';
import {
  clearSkillRuntimeCache,
  resolvePython,
} from '@/shared/services/ffmpeg-skill/runtime';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn() };
});

const mockedSpawnSync = vi.mocked(spawnSync);

afterEach(() => {
  clearSkillRuntimeCache();
  mockedSpawnSync.mockReset();
});

type SpawnResult = ReturnType<typeof spawnSync>;

function result(
  overrides: Partial<{
    error: Error;
    status: number | null;
    stdout: string;
    stderr: string;
  }> = {},
): SpawnResult {
  return {
    pid: 0,
    output: [],
    stdout: null,
    stderr: null,
    status: null,
    signal: null,
    error: undefined,
    ...overrides,
  } as unknown as SpawnResult;
}

function missing(command: string): SpawnResult {
  return result({ error: new Error(`spawn ${command} ENOENT`), status: null });
}

function caught(call: () => unknown): FfmpegSkillError {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(FfmpegSkillError);
    return error as FfmpegSkillError;
  }
  throw new Error('expected call to throw');
}

describe('resolvePython', () => {
  it('reports missing_runtime and names the candidates when none resolve', () => {
    mockedSpawnSync.mockImplementation((command) =>
      missing(typeof command === 'string' ? command : String(command)),
    );

    const error = caught(() => resolvePython());

    expect(error.kind).toBe('missing_runtime');
    expect(error.message).toContain('python3');
    expect(error.message).toContain('python');
    expect(error.message).toContain('Nothing was downloaded');
  });

  it('rejects a Python 3.8 interpreter as too old', () => {
    mockedSpawnSync.mockImplementation(() =>
      result({
        status: 0,
        stdout: '3.8.10\n/opt/python/bin/python3\n',
        stderr: '',
      }),
    );

    const error = caught(() => resolvePython());

    expect(error.kind).toBe('missing_runtime');
    expect(error.message).toContain('3.8.10 is older than 3.9');
  });

  it('rejects the Windows Store alias text instead of treating it as Python', () => {
    mockedSpawnSync.mockImplementation(() =>
      result({
        status: 0,
        stdout: '',
        stderr:
          'Python was not found; run without arguments to install from the Microsoft Store.',
      }),
    );

    const error = caught(() => resolvePython());

    expect(error.kind).toBe('missing_runtime');
    expect(error.message).toContain('Windows Store alias');
  });

  it('accepts the first candidate that reports Python 3.9 or newer', () => {
    mockedSpawnSync.mockImplementation((command) => {
      if (command === 'python3') {
        return result({
          status: 0,
          stdout: '3.12.1\n/opt/homebrew/bin/python3\n',
          stderr: '',
        });
      }
      return missing(String(command));
    });

    const runtime = resolvePython();

    expect(runtime.command).toBe('python3');
    expect(runtime.version).toBe('3.12.1 (/opt/homebrew/bin/python3)');
  });
});
