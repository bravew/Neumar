import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '@/shared/lib/fetch-bind-polyfill';

// Regression test for the @ag-ui/client@0.0.55 HttpAgent fetch-binding bug.
//
// HttpAgent does:
//   this.fetch = e.fetch ?? fetch    // stores a *reference* to global fetch
//   ...
//   this.fetch(this.url, this.requestInit(e))   // calls it as a method
//
// In Chromium the native `fetch` enforces `this === Window`, so calling it
// with any other receiver raises `TypeError: Failed to execute 'fetch' on
// 'Window': Illegal invocation` and the chat run aborts before the SSE
// stream opens.
//
// jsdom/happy-dom don't enforce that invariant, so this test does NOT try to
// reproduce the crash. Instead it asserts the invariant the polyfill provides:
// the stored `window.fetch` reference must be safe to call as a method on an
// arbitrary object and must forward to the natively-bound fetch.

describe('fetch-bind-polyfill', () => {
  it('marks the polyfill as applied on window', () => {
    expect((window as { __neumaFetchBound?: boolean }).__neumaFetchBound).toBe(
      true,
    );
  });

  it('survives being invoked as a method on a non-Window receiver', async () => {
    // Simulate the HttpAgent pattern: store window.fetch as an instance
    // property, then call it as `this.fetch(...)`. The wrapper installed by
    // the polyfill is an arrow function, so the receiver is irrelevant and
    // no TypeError is raised — that is the property we are guarding here.
    const obj: { fetch: typeof window.fetch } = { fetch: window.fetch };
    // Don't await: jsdom doesn't enforce CORS/network, but the call itself
    // is what we are exercising — it must not throw synchronously.
    expect(() => {
      // Network rejection is fine and ignored; we only care that the
      // method-call form does not raise `Illegal invocation` synchronously.
      obj.fetch('about:blank').catch(() => undefined);
    }).not.toThrow();
  });

  it('main.tsx imports the polyfill before any @ag-ui/@copilotkit code', () => {
    // Static guard: if anyone reorders main.tsx so the polyfill loads after
    // those libraries capture window.fetch, the bug returns silently in
    // Chromium without any unit-test failure. Catch that at the source.
    // Look at import statements only — comments may legitimately mention
    // the library names.
    const importLines = readFileSync(
      resolve(__dirname, '..', 'main.tsx'),
      'utf8',
    )
      .split('\n')
      .map((line, idx) => ({ line: line.trim(), idx }))
      .filter(({ line }) => line.startsWith('import '));

    const polyfillLine = importLines.find(({ line }) =>
      line.includes('fetch-bind-polyfill'),
    );
    expect(polyfillLine).toBeDefined();

    for (const lib of ['@ag-ui/', '@copilotkit/']) {
      const libLine = importLines.find(({ line }) => line.includes(lib));
      if (libLine) {
        expect(polyfillLine!.idx).toBeLessThan(libLine.idx);
      }
    }
  });
});
