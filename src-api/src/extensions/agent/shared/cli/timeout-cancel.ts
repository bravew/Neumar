/**
 * Timeout and Cancellation Utilities for CLI Processes
 */

import type { ChildProcess } from 'child_process';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CLI');

/**
 * Wrap a promise with a timeout. Rejects with a descriptive error on timeout.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms${label ? ` (${label})` : ''}`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Create a cancellable wrapper around a child process.
 * Optionally wires an AbortController to kill the process.
 */
export function createCancellableProcess(
  proc: ChildProcess,
  abortController?: AbortController,
): { promise: Promise<number | null>; cancel: () => void } {
  let killed = false;

  const cancel = () => {
    if (killed || proc.exitCode !== null) return;
    killed = true;
    logger.info(`Killing process ${proc.pid}`);
    // Try SIGTERM first, SIGKILL after 5s
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (proc.exitCode === null) {
        logger.warn(
          `Process ${proc.pid} did not exit after SIGTERM, sending SIGKILL`,
        );
        proc.kill('SIGKILL');
      }
    }, 5000);
  };

  // Wire abort signal
  if (abortController) {
    if (abortController.signal.aborted) {
      cancel();
    } else {
      abortController.signal.addEventListener('abort', cancel, {
        once: true,
      });
    }
  }

  const promise = new Promise<number | null>((resolve, reject) => {
    proc.on('exit', (code) => {
      resolve(code);
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });

  return { promise, cancel };
}
