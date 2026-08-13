/**
 * In-flight request tracker.
 *
 * Provides Hono middleware that increments/decrements an active-request count
 * and exposes `drainRequests()` for graceful shutdown. Set by the API entry
 * point so SIGTERM/SIGINT can wait for outstanding work to finish before
 * closing the database and other singletons.
 */

import type { MiddlewareHandler } from 'hono';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RequestTracker');

let active = 0;
let acceptingRequests = true;

export function getActiveRequestCount(): number {
  return active;
}

/** Stop accepting new requests. Existing in-flight requests still complete. */
export function stopAcceptingRequests(): void {
  acceptingRequests = false;
}

/** Re-open the gate (test/recovery use). */
export function resumeAcceptingRequests(): void {
  acceptingRequests = true;
}

export const requestTrackerMiddleware: MiddlewareHandler = async (c, next) => {
  if (!acceptingRequests) {
    return c.json({ success: false, error: 'shutting_down' }, 503);
  }
  active++;
  try {
    await next();
  } finally {
    active--;
  }
};

/**
 * Wait until all active requests have completed, or until `timeoutMs` elapses.
 * Returns true if drained cleanly, false on timeout.
 */
export async function drainRequests(timeoutMs = 5000): Promise<boolean> {
  if (active === 0) return true;
  const start = Date.now();
  logger.info(`Draining ${active} in-flight request(s)…`);

  while (active > 0) {
    if (Date.now() - start > timeoutMs) {
      logger.warn(
        `Drain timed out with ${active} request(s) still active (limit ${timeoutMs}ms)`,
      );
      return false;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  logger.info('Drain complete');
  return true;
}
