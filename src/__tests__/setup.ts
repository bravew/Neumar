import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';

// Side-effect import: registers vi.mock() stubs for all @tauri-apps/* packages
import './mocks/tauri';

// ---------- MockEventSource for SSE/dispatch tests ----------

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0; // CONNECTING
  close = vi.fn();

  constructor(public url: string) {
    // Simulate connection opening
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    });
  }

  /** Test helper: simulate an incoming SSE message */
  simulateMessage(data: unknown) {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(data) }),
    );
  }

  /** Test helper: simulate an error event */
  simulateError() {
    this.readyState = 2; // CLOSED
    this.onerror?.();
  }
}

vi.stubGlobal('EventSource', MockEventSource);

// ---------- ResizeObserver (jsdom doesn't implement it) ----------

class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  ResizeObserverPolyfill;

// ---------- IntersectionObserver (jsdom doesn't implement it) ----------
// Used by lazy previews (e.g. DesignSystemLivePreview's viewport gating).

class IntersectionObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
  IntersectionObserverPolyfill;

// ---------- Pointer Capture API (jsdom doesn't implement it) ----------
// Radix UI primitives (Select, Tooltip, etc.) call these on pointer events.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as { scrollIntoView: () => void }).scrollIntoView =
      () => {};
  }
}

// ---------- matchMedia (jsdom doesn't implement it) ----------

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// ---------- Cleanup ----------

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (vi.isFakeTimers()) vi.useRealTimers();
});
