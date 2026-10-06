/**
 * One-shot process supervisor for a vendored skill script.
 *
 * `runStreamingCommand` only signals the direct child and keeps output without
 * a limit, so skill runs do not use it. This supervisor caps both streams,
 * kills the process group on abort or timeout, and waits until the group is
 * gone before resolving.
 */

import { spawn, type ChildProcess } from 'node:child_process';

import { FfmpegSkillError } from './errors';

export const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const DEFAULT_KILL_GRACE_MS = 2000;
export const DEFAULT_OPERATION_TIMEOUT_MS = 30 * 60 * 1000;

export interface SupervisedRunInput {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Whole-operation deadline. The child's own --timeout is a second limit. */
  timeoutMs?: number;
  /** Retained bytes per stream. Further bytes are discarded and fail the run. */
  maxOutputBytes?: number;
  /** SIGTERM to SIGKILL gap. */
  killGraceMs?: number;
  /** Called with normalized stderr progress lines. Never parsed as success. */
  onProgress?: (line: string) => void;
}

export interface SupervisedRunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface CapturedStream {
  push(chunk: Buffer): boolean;
  text(): string;
}

export function runSupervised(
  input: SupervisedRunInput,
): Promise<SupervisedRunResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  const killGraceMs = input.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  if (input.signal?.aborted) {
    return Promise.reject(
      new FfmpegSkillError(
        'aborted',
        'The operation was cancelled before it started.',
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = capture(maxOutputBytes);
    const stderr = capture(maxOutputBytes, input.onProgress);

    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let outputExceeded = false;
    let forceKill: NodeJS.Timeout | undefined;

    const stop = (reason: 'timeout' | 'aborted' | 'output_limit') => {
      if (reason === 'timeout') timedOut = true;
      if (reason === 'aborted') cancelled = true;
      if (reason === 'output_limit') outputExceeded = true;
      signalGroup(child, 'SIGTERM');
      forceKill ??= setTimeout(
        () => signalGroup(child, 'SIGKILL'),
        killGraceMs,
      );
      forceKill.unref?.();
    };

    const timeout = setTimeout(() => stop('timeout'), timeoutMs);
    timeout.unref?.();
    const onAbort = () => stop('aborted');
    input.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (error?: FfmpegSkillError, result?: SupervisedRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      input.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else if (result) resolve(result);
    };

    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(
        new FfmpegSkillError(
          code === 'ENOENT' ? 'missing_runtime' : 'failed',
          code === 'ENOENT'
            ? `Could not start ${input.command}. Check that the interpreter is installed.`
            : `${input.command} could not start: ${error.message}`,
        ),
      );
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.push(chunk)) stop('output_limit');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.push(chunk)) stop('output_limit');
    });

    child.on('close', (code, closeSignal) => {
      void waitForDescendants(child.pid).finally(() => {
        const result: SupervisedRunResult = {
          exitCode: code,
          signal: closeSignal,
          stdout: stdout.text(),
          stderr: stderr.text(),
          durationMs: Date.now() - started,
        };
        if (cancelled || input.signal?.aborted) {
          finish(
            new FfmpegSkillError(
              'aborted',
              'The operation was cancelled and its output was not published.',
              { stderr: tail(result.stderr) },
            ),
          );
          return;
        }
        if (timedOut) {
          finish(
            new FfmpegSkillError(
              'timeout',
              `The operation exceeded ${timeoutMs}ms and was stopped.`,
              { stderr: tail(result.stderr) },
            ),
          );
          return;
        }
        if (outputExceeded) {
          finish(
            new FfmpegSkillError(
              'output_limit',
              `The operation produced more than ${maxOutputBytes} bytes on one stream and was stopped.`,
            ),
          );
          return;
        }
        finish(undefined, result);
      });
    });
  });
}

function capture(
  limit: number,
  onLine?: (line: string) => void,
): CapturedStream {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let exceeded = false;
  let pending = '';
  return {
    push(chunk: Buffer): boolean {
      const remaining = limit - bytes;
      const accepted =
        remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0);
      if (accepted.byteLength > 0) {
        chunks.push(accepted);
        bytes += accepted.byteLength;
        if (onLine)
          pending = emitLines(pending, accepted.toString('utf8'), onLine);
      }
      if (accepted.byteLength < chunk.byteLength) exceeded = true;
      return exceeded;
    },
    text(): string {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

function emitLines(
  pending: string,
  chunk: string,
  onLine: (line: string) => void,
): string {
  const normalized = pending + chunk.replace(/\r(?!\n)/g, '\n');
  const lines = normalized.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) onLine(trimmed);
  }
  return rest;
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) {
    child.kill(signal);
    return;
  }
  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t'];
    if (signal === 'SIGKILL') args.push('/f');
    const killer = spawn('taskkill', args, {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already gone.
    }
  }
}

/**
 * Block until no process remains in the child's group.
 *
 * The direct child's close event can fire while a grandchild is still alive,
 * so publication waits for this. A missing pid, or a group that is already
 * gone, resolves immediately.
 */
export async function waitForDescendants(
  pid: number | undefined,
  pollMs = 50,
  deadlineMs = 5000,
): Promise<void> {
  if (!pid || process.platform === 'win32') return;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (!groupAlive(pid)) return;
    await delay(pollMs);
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function tail(text: string): string {
  return text.split(/\r?\n/).slice(-12).join('\n');
}
