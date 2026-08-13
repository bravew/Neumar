import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

const DEFAULT_PROMPT_LIMIT_BYTES = 1_000_000;
const DEFAULT_STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;
const DEFAULT_STDERR_LIMIT_BYTES = 1 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TURNS = 100;

export interface HeadlessPromptArgs {
  promptFile: string;
  maxTurns: number;
}

export interface HeadlessPromptRunSpec {
  binaryPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  maxTurns: number;
  buildArgs: (input: HeadlessPromptArgs) => string[];
  timeoutMs?: number;
  maxPromptBytes?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  abortSignal?: AbortSignal;
}

export interface HeadlessPromptRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  currentBytes: number,
  limitBytes: number,
): { bytes: number; exceeded: boolean } {
  const remaining = limitBytes - currentBytes;
  if (remaining <= 0) return { bytes: currentBytes, exceeded: true };
  const accepted = chunk.subarray(0, remaining);
  chunks.push(accepted);
  return {
    bytes: currentBytes + accepted.byteLength,
    exceeded: accepted.byteLength < chunk.byteLength,
  };
}

function terminateProcessGroup(
  proc: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  if (process.platform === 'win32' && proc.pid) {
    const args = ['/pid', String(proc.pid), '/t'];
    if (signal === 'SIGKILL') args.push('/f');
    const killer = spawn('taskkill', args, {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  if (process.platform !== 'win32' && proc.pid) {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      // The group may already have exited; fall back to the child handle.
    }
  }
  proc.kill(signal);
}

export async function runHeadlessPrompt(
  spec: HeadlessPromptRunSpec,
): Promise<HeadlessPromptRunResult> {
  const promptBytes = Buffer.byteLength(spec.prompt, 'utf8');
  if (promptBytes > (spec.maxPromptBytes ?? DEFAULT_PROMPT_LIMIT_BYTES)) {
    throw new Error('Prompt exceeds the configured byte limit.');
  }
  if (
    !Number.isInteger(spec.maxTurns) ||
    spec.maxTurns < 1 ||
    spec.maxTurns > MAX_TURNS
  ) {
    throw new Error(`maxTurns must be an integer between 1 and ${MAX_TURNS}.`);
  }

  const cwd = await realpath(spec.cwd);
  const promptDir = await mkdtemp(join(cwd, '.neuma-prompt-'));
  const promptFile = join(promptDir, 'prompt.txt');
  if (!isWithin(cwd, promptFile)) {
    await rm(promptDir, { recursive: true, force: true });
    throw new Error('Prompt file escaped the workspace.');
  }

  await writeFile(promptFile, spec.prompt, { encoding: 'utf8', mode: 0o600 });

  try {
    const args = spec.buildArgs({ promptFile, maxTurns: spec.maxTurns });
    const proc = spawn(spec.binaryPath, args, {
      cwd,
      env: spec.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let cancelled = false;

    let forceKill: NodeJS.Timeout | undefined;
    const stop = () => {
      terminateProcessGroup(proc, 'SIGTERM');
      forceKill ??= setTimeout(
        () => terminateProcessGroup(proc, 'SIGKILL'),
        2_000,
      );
      forceKill.unref?.();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    if (spec.abortSignal?.aborted) onAbort();
    else spec.abortSignal?.addEventListener('abort', onAbort, { once: true });

    proc.stdout.on('data', (value: Buffer | string) => {
      const result = appendBounded(
        stdoutChunks,
        Buffer.isBuffer(value) ? value : Buffer.from(value),
        stdoutBytes,
        spec.maxStdoutBytes ?? DEFAULT_STDOUT_LIMIT_BYTES,
      );
      stdoutBytes = result.bytes;
      if (result.exceeded && !outputExceeded) {
        outputExceeded = true;
        stop();
      }
    });
    proc.stderr.on('data', (value: Buffer | string) => {
      const result = appendBounded(
        stderrChunks,
        Buffer.isBuffer(value) ? value : Buffer.from(value),
        stderrBytes,
        spec.maxStderrBytes ?? DEFAULT_STDERR_LIMIT_BYTES,
      );
      stderrBytes = result.bytes;
      if (result.exceeded && !outputExceeded) {
        outputExceeded = true;
        stop();
      }
    });

    const code = await new Promise<number | null>((resolve, reject) => {
      proc.once('error', reject);
      proc.once('close', resolve);
    });
    clearTimeout(timeout);
    if (forceKill) clearTimeout(forceKill);
    spec.abortSignal?.removeEventListener('abort', onAbort);

    if (outputExceeded) {
      throw new Error(
        'Headless runtime output exceeded the configured byte limit.',
      );
    }
    return {
      code,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      timedOut,
      cancelled,
    };
  } finally {
    await rm(promptDir, { recursive: true, force: true });
  }
}
