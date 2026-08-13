import { createLogger } from '@/shared/utils/logger';

import { HtmlEngineError } from './errors';

// Chromium acquisition for the HTML render engine.
//
// Mirrors the pattern already used by DesignMode for HTML→PDF
// (src-api/src/app/api/design.ts:3716) so the dependency surface
// (`playwright` + Chromium binary on disk) is one Neuma already runs at
// runtime. We do NOT depend on @hyperframes/engine; see
// dev-doc/html-video/06-05/SPIKE-REPORT.md for the rationale.

const logger = createLogger('VideoHtmlBrowser');

// Loose type aliases — the runtime is playwright, but importing the type at
// module top level would force tests/CI without playwright to bundle the
// types. Playwright is loaded lazily inside acquireBrowser().
type PlaywrightBrowser = {
  close(): Promise<void>;
  version?(): string;
  newContext(opts: unknown): Promise<unknown>;
};

export interface BrowserHandle {
  browser: PlaywrightBrowser;
  /** Major.minor of the Playwright runtime used for this handle. */
  version: string;
  /** Idempotent close — safe to call from a `finally` even after abort. */
  close(): Promise<void>;
}

export interface AcquireBrowserOptions {
  signal?: AbortSignal;
  /** Test-only seam: inject a fake `import('playwright')` module. */
  playwrightLoader?: () => Promise<unknown>;
}

interface PlaywrightModule {
  chromium: {
    launch(opts: {
      headless?: boolean;
      args?: string[];
    }): Promise<PlaywrightBrowser>;
  };
}

/**
 * Resolve a `playwright`-compatible module. Tries `playwright` directly,
 * falling back to `@playwright/test` (which re-exports `chromium`). The
 * fallback is what `src-api/src/app/api/design.ts` uses for HTML→PDF, so
 * the install-state surface stays consistent across the codebase.
 */
async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return (await import('playwright')) as unknown as PlaywrightModule;
  } catch {
    return (await import('@playwright/test')) as unknown as PlaywrightModule;
  }
}

/**
 * Acquire a headless Chromium browser, lazy-loading `playwright` so the
 * cost only hits the rendering code path (not the agent or UI bundles).
 *
 * Throws a typed `HtmlEngineError('browser-launch-failed', ...)` when:
 *   - The host has no `playwright` resolvable (with the remediation command).
 *   - The host has playwright but Chromium isn't installed.
 *   - The signal is already aborted at entry.
 */
export async function acquireBrowser(
  options: AcquireBrowserOptions = {},
): Promise<BrowserHandle> {
  if (options.signal?.aborted) {
    throw new HtmlEngineError(
      'browser-aborted',
      'Browser acquisition aborted before launch',
    );
  }

  let playwright: PlaywrightModule;
  try {
    const loaded = options.playwrightLoader
      ? await options.playwrightLoader()
      : await loadPlaywright();
    playwright = loaded as PlaywrightModule;
  } catch (err) {
    throw new HtmlEngineError(
      'browser-launch-failed',
      'Playwright is not installed. Run `pnpm exec playwright install chromium` and retry.',
      err,
    );
  }

  let browser: PlaywrightBrowser;
  try {
    // Keep the OS sandbox ON by default — the engine renders agent/template
    // HTML that may carry scripts, so the Chromium sandbox is real defense in
    // depth. `--no-sandbox` is only needed when running as root in a container
    // without user namespaces; gate it behind an explicit opt-in rather than
    // disabling protection everywhere (Playwright Docker guidance).
    const noSandbox = process.env.NEUMA_CHROMIUM_NO_SANDBOX === 'true';
    browser = await playwright.chromium.launch({
      headless: true,
      args: [
        ...(noSandbox ? ['--no-sandbox'] : []),
        '--disable-blink-features=AutomationControlled',
      ],
    });
  } catch (err) {
    throw new HtmlEngineError(
      'browser-launch-failed',
      'Failed to launch headless Chromium. Run `pnpm exec playwright install chromium` to ensure the browser binary is present.',
      err,
    );
  }

  const version =
    typeof browser.version === 'function' ? browser.version() : 'unknown';
  logger.info(`Acquired headless Chromium (${version})`);

  let closed = false;
  const handle: BrowserHandle = {
    browser,
    version,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await browser.close();
      } catch (err) {
        logger.warn(`browser close failed: ${(err as Error).message}`);
      }
    },
  };

  // Wire the signal so an abort during a later capture closes the browser
  // without the caller threading the AbortError manually. `{ once: true }`
  // prevents the listener from persisting on a long-lived signal scope
  // (an agent run signal can outlive many sequential renders).
  if (options.signal) {
    options.signal.addEventListener(
      'abort',
      () => {
        void handle.close();
      },
      { once: true },
    );
  }

  return handle;
}
