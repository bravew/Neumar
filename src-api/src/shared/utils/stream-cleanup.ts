/**
 * Safe Async Generator Wrapper
 *
 * Ensures cleanup code runs even if consumer stops early.
 * Prevents memory leaks from abandoned async generators.
 *
 * Problem:
 * - Async generators with finally blocks may not execute cleanup if consumer stops early
 * - for-await loop break/return doesn't guarantee finally execution
 * - Leads to leaked streams, buffers, and resources
 *
 * Solution:
 * - Wrap generator with guaranteed cleanup using try-finally at wrapper level
 * - Cleanup function called regardless of how iteration terminates
 * - Works with early termination, errors, or normal completion
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SafeAsyncGenerator');

export function safeAsyncGenerator<T>(
  generator: AsyncGenerator<T, void, unknown>,
  cleanup: () => void | Promise<void>,
): AsyncGenerator<T, void, unknown> {
  let cleanupCalled = false;

  const ensureCleanup = async () => {
    if (!cleanupCalled) {
      cleanupCalled = true;
      try {
        await cleanup();
      } catch (error) {
        logger.error('Cleanup error:', error);
      }
    }
  };

  return (async function* () {
    try {
      for await (const value of generator) {
        yield value;
      }
    } finally {
      // This WILL execute even if consumer breaks early
      await ensureCleanup();
    }
  })();
}
