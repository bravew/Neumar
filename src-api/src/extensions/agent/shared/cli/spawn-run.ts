/**
 * Shared single-run process scaffold for CLI agent adapters.
 *
 * Centralizes the lifecycle every subprocess runtime needs so each adapter
 * only supplies argv + a stream parser:
 * - stdin prompt delivery with write-error tolerance,
 * - concurrent stderr drain (prevents the ~64 KB OS pipe deadlock),
 * - exit-code promise registered BEFORE draining (EventEmitter does not
 *   replay 'close'),
 * - wall-clock timeout and abort-signal kill wiring.
 */

import { spawn } from 'node:child_process';

export interface CliRunSpec {
  binaryPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** When set, written to stdin and stdin is closed; otherwise stdin is ignored. */
  stdinText?: string;
  /** Wall-clock kill budget. Default 300 s. */
  timeoutMs?: number;
  /** Abort signals that should SIGTERM the child (session + request). */
  abortSignals?: (AbortSignal | undefined)[];
  onSpawnError?: (err: Error) => void;
}

export type CliRunEvent =
  | { kind: 'stdout'; chunk: string }
  | { kind: 'exit'; code: number | null; stderr: string; timedOut: boolean };

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Spawn the CLI and yield raw stdout chunks, then exactly one `exit` event
 * with the exit code and accumulated stderr.
 */
export async function* runCliProcess(
  spec: CliRunSpec,
): AsyncGenerator<CliRunEvent> {
  const useStdin = spec.stdinText !== undefined;
  const proc = spawn(spec.binaryPath, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  if (useStdin && proc.stdin) {
    proc.stdin.on('error', (err) => {
      // Child exited before reading the prompt — surfaced via exit code.
      spec.onSpawnError?.(err);
    });
    proc.stdin.end(spec.stdinText);
  }

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGTERM');
  }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const abortHandlers: Array<{ signal: AbortSignal; handler: () => void }> = [];
  for (const signal of spec.abortSignals ?? []) {
    if (!signal) continue;
    const handler = () => proc.kill('SIGTERM');
    if (signal.aborted) {
      handler();
    } else {
      signal.addEventListener('abort', handler, { once: true });
      abortHandlers.push({ signal, handler });
    }
  }

  // Register exit-code promise BEFORE draining streams. Spawn failures
  // (ENOENT, EACCES) are folded into the stderr text so the exit mapping
  // surfaces the real cause instead of "completed without producing output".
  let spawnErrorText = '';
  const exitCodePromise = new Promise<number | null>((resolve) => {
    proc.on('close', (code) => resolve(code));
    proc.on('error', (err) => {
      spawnErrorText = `Failed to run ${spec.binaryPath}: ${err.message}`;
      spec.onSpawnError?.(err);
      resolve(null);
    });
  });

  const stderrStream = proc.stderr;
  const stdoutStream = proc.stdout;
  const stderrChunks: string[] = [];
  const stderrDone = (async () => {
    if (!stderrStream) return;
    for await (const chunk of stderrStream) {
      stderrChunks.push(String(chunk));
    }
  })().catch(() => {});

  try {
    if (stdoutStream) {
      for await (const chunk of stdoutStream) {
        yield { kind: 'stdout', chunk: String(chunk) };
      }
    }

    await stderrDone;
    const code = await exitCodePromise;
    const stderr = [spawnErrorText, stderrChunks.join('')]
      .filter(Boolean)
      .join('\n');
    yield { kind: 'exit', code, stderr, timedOut };
  } finally {
    clearTimeout(timeoutId);
    for (const { signal, handler } of abortHandlers) {
      signal.removeEventListener('abort', handler);
    }
    if (proc.exitCode === null && !proc.killed) proc.kill('SIGTERM');
  }
}
