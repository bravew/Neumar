import type { Page } from '@playwright/test';

/**
 * Wait for an SSE-powered element to appear after dispatching a task.
 * Useful for waiting on streaming agent responses.
 */
export async function waitForSSEElement(
  page: Page,
  selector: string,
  opts?: { timeout?: number },
) {
  await page.locator(selector).waitFor({
    state: 'visible',
    timeout: opts?.timeout ?? 15_000,
  });
}

/**
 * Wait for the API to be healthy before running tests.
 */
export async function waitForAPI(
  baseUrl = 'http://localhost:5126',
  opts?: { timeout?: number; interval?: number },
) {
  const timeout = opts?.timeout ?? 30_000;
  const interval = opts?.interval ?? 500;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`API at ${baseUrl} not healthy after ${timeout}ms`);
}
