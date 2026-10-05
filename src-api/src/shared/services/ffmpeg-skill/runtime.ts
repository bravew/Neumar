/**
 * Installed-runtime discovery for the FFmpeg skill.
 *
 * FFmpeg and ffprobe come from the existing detector, which already honors
 * NEUMA_FFMPEG_PATH, FFMPEG_PATH, the ffprobe overrides, and the GUI PATH.
 * Python is resolved here. Nothing is installed or downloaded.
 */

import { spawnSync } from 'node:child_process';
import { delimiter, dirname } from 'node:path';

import { detectBinaries } from '@/shared/services/ffmpeg';

import { FfmpegSkillError } from './errors';

const MIN_PYTHON = [3, 9] as const;

export interface PythonRuntime {
  command: string;
  prefixArgs: string[];
  version: string;
}

export interface SkillRuntime {
  python: PythonRuntime;
  ffmpegPath: string;
  ffprobePath: string;
  ffmpegVersion: string;
}

interface RuntimeCacheKey {
  ffmpegPath: string;
  ffprobePath: string;
  payloadVersion: string;
}

let cached: { key: RuntimeCacheKey; runtime: SkillRuntime } | null = null;

export function clearSkillRuntimeCache(): void {
  cached = null;
}

/**
 * Resolve the interpreters this operation needs.
 *
 * `needsFfmpeg` is true for every tool that shells out to ffmpeg/ffprobe.
 * Probe and cuts both do. A later capability check can pass false only for a
 * contract operation that never touches media.
 */
export function resolveSkillRuntime(
  payloadVersion: string,
  options: { needsFfmpeg?: boolean } = {},
): SkillRuntime {
  const needsFfmpeg = options.needsFfmpeg !== false;
  const binaries = detectBinaries();
  const key: RuntimeCacheKey = {
    ffmpegPath: binaries?.ffmpegPath ?? '',
    ffprobePath: binaries?.ffprobePath ?? '',
    payloadVersion,
  };
  if (
    cached &&
    cached.key.ffmpegPath === key.ffmpegPath &&
    cached.key.ffprobePath === key.ffprobePath &&
    cached.key.payloadVersion === key.payloadVersion
  ) {
    assertBinaries(cached.runtime, needsFfmpeg);
    return cached.runtime;
  }

  const python = resolvePython();
  if (!binaries) {
    throw missingRuntime(
      'FFmpeg is not installed. Install it with your platform package manager (brew install ffmpeg, apt install ffmpeg) or set NEUMA_FFMPEG_PATH to the ffmpeg binary. Nothing was downloaded.',
    );
  }
  const runtime: SkillRuntime = {
    python,
    ffmpegPath: binaries.ffmpegPath,
    ffprobePath: binaries.ffprobePath,
    ffmpegVersion: binaries.version,
  };
  assertBinaries(runtime, needsFfmpeg);
  cached = { key, runtime };
  return runtime;
}

function assertBinaries(runtime: SkillRuntime, needsFfmpeg: boolean): void {
  if (!needsFfmpeg) return;
  if (!runtime.ffmpegPath) {
    throw missingRuntime(
      'FFmpeg is not installed. Set NEUMA_FFMPEG_PATH or install ffmpeg locally. Nothing was downloaded.',
    );
  }
  if (!runtime.ffprobePath) {
    throw missingRuntime(
      'ffprobe was not found next to ffmpeg. Install ffprobe or set NEUMA_FFPROBE_PATH. Probe and measurement cannot run without it.',
    );
  }
}

function missingRuntime(message: string): FfmpegSkillError {
  return new FfmpegSkillError('missing_runtime', message);
}

/**
 * Find a real Python 3.9+ interpreter.
 *
 * Candidates are python3, python, and (on Windows) `py -3`. A Windows Store
 * alias answers `--version` by telling the user to install Python from the
 * Store; that is not an interpreter and is rejected.
 */
export function resolvePython(): PythonRuntime {
  const candidates = pythonCandidates();
  const failures: string[] = [];
  for (const candidate of candidates) {
    const found = probePython(candidate.command, candidate.prefixArgs);
    if (found.ok) return found.runtime;
    failures.push(`${candidate.label}: ${found.reason}`);
  }
  throw missingRuntime(
    `Python ${MIN_PYTHON[0]}.${MIN_PYTHON[1]} or newer was not found (${failures.join('; ')}). Install Python from python.org and retry. Nothing was downloaded.`,
  );
}

function pythonCandidates(): Array<{
  command: string;
  prefixArgs: string[];
  label: string;
}> {
  const candidates: Array<{
    command: string;
    prefixArgs: string[];
    label: string;
  }> = [
    { command: 'python3', prefixArgs: [], label: 'python3' },
    { command: 'python', prefixArgs: [], label: 'python' },
  ];
  if (process.platform === 'win32') {
    candidates.push({ command: 'py', prefixArgs: ['-3'], label: 'py -3' });
  }
  return candidates;
}

function probePython(
  command: string,
  prefixArgs: string[],
): { ok: true; runtime: PythonRuntime } | { ok: false; reason: string } {
  const result = spawnSync(
    command,
    [
      ...prefixArgs,
      '-c',
      'import sys; print("%d.%d.%d" % sys.version_info[:3]); print(sys.executable)',
    ],
    {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: interpreterEnv(),
      windowsHide: true,
    },
  );
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (isWindowsStoreAlias(`${stdout}\n${stderr}`)) {
    return {
      ok: false,
      reason: 'Windows Store alias, not an installed interpreter',
    };
  }
  if (result.status !== 0) {
    return { ok: false, reason: `exited ${result.status ?? 'unknown'}` };
  }
  const [versionLine, executableLine] = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(versionLine ?? '');
  if (!match) return { ok: false, reason: 'did not report a version' };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (
    major < MIN_PYTHON[0] ||
    (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1])
  ) {
    return {
      ok: false,
      reason: `${versionLine} is older than ${MIN_PYTHON[0]}.${MIN_PYTHON[1]}`,
    };
  }
  return {
    ok: true,
    runtime: {
      command,
      prefixArgs,
      version: `${versionLine} (${executableLine ?? command})`,
    },
  };
}

/**
 * Python lives on the system path, which a GUI launch or a test may have
 * replaced. Search the current PATH first, then the platform defaults.
 */
function interpreterEnv(): NodeJS.ProcessEnv {
  const fallback =
    process.platform === 'win32'
      ? ''
      : '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
  return {
    ...process.env,
    PATH: [process.env.PATH, fallback].filter(Boolean).join(delimiter),
  };
}

function isWindowsStoreAlias(output: string): boolean {
  return /windows\s*store|Microsoft Store|python\.exe\s+was\s+not\s+found/i.test(
    output,
  );
}

/** PATH plus the directories of the resolved binaries, and no provider tokens. */
export function skillProcessEnv(runtime: SkillRuntime): NodeJS.ProcessEnv {
  const bins = [
    dirname(runtime.ffmpegPath),
    dirname(runtime.ffprobePath),
  ].filter((dir) => dir && dir !== '.');
  const path = [...new Set([...bins, process.env.PATH ?? ''])]
    .filter(Boolean)
    .join(delimiter);
  const env: NodeJS.ProcessEnv = {
    PATH: path,
    FFMPEG_PATH: runtime.ffmpegPath,
    FFPROBE_PATH: runtime.ffprobePath,
    PYTHONDONTWRITEBYTECODE: '1',
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env;
}
