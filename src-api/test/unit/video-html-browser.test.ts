import { describe, expect, it, vi } from 'vitest';

import { acquireBrowser } from '@/shared/video/engines/html/browser';
import { HtmlEngineError } from '@/shared/video/engines/html/errors';

const fakeBrowser = () => ({
  close: vi.fn(async () => undefined),
  version: () => '1.60.0',
  newContext: vi.fn(async () => ({})),
});

describe('acquireBrowser', () => {
  it('returns a handle backed by a fake playwright module', async () => {
    const browser = fakeBrowser();
    const playwrightLoader = vi.fn(async () => ({
      chromium: { launch: vi.fn(async () => browser) },
    }));
    const handle = await acquireBrowser({ playwrightLoader });
    expect(handle.browser).toBe(browser);
    expect(handle.version).toBe('1.60.0');
    await handle.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
    await handle.close();
    expect(browser.close).toHaveBeenCalledTimes(1); // idempotent
  });

  it('throws HtmlEngineError("browser-launch-failed") when playwright cannot be loaded', async () => {
    const playwrightLoader = vi.fn(async () => {
      throw new Error("Cannot find module 'playwright'");
    });
    try {
      await acquireBrowser({ playwrightLoader });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HtmlEngineError);
      expect((err as HtmlEngineError).code).toBe('browser-launch-failed');
      expect((err as HtmlEngineError).message).toMatch(
        /playwright install chromium/,
      );
    }
  });

  it('throws HtmlEngineError("browser-launch-failed") when chromium.launch fails', async () => {
    const playwrightLoader = vi.fn(async () => ({
      chromium: {
        launch: vi.fn(async () => {
          throw new Error('browser exe missing');
        }),
      },
    }));
    try {
      await acquireBrowser({ playwrightLoader });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HtmlEngineError);
      expect((err as HtmlEngineError).code).toBe('browser-launch-failed');
    }
  });

  it('throws "browser-aborted" if the signal is already aborted at entry', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    try {
      await acquireBrowser({ signal: ctrl.signal });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as HtmlEngineError).code).toBe('browser-aborted');
    }
  });

  it('closes the browser when the signal aborts after acquire', async () => {
    const browser = fakeBrowser();
    const playwrightLoader = vi.fn(async () => ({
      chromium: { launch: vi.fn(async () => browser) },
    }));
    const ctrl = new AbortController();
    const handle = await acquireBrowser({
      signal: ctrl.signal,
      playwrightLoader,
    });
    ctrl.abort();
    // Allow the abort microtask to flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(browser.close).toHaveBeenCalled();
    await handle.close();
  });
});
