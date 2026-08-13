/**
 * Abortable sleep utility.
 *
 * Resolves after `ms` milliseconds, or rejects with an Error if
 * the provided AbortSignal fires before the timer completes.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      },
      { once: true },
    );
  });
}
