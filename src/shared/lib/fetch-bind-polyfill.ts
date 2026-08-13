// Workaround for @ag-ui/client@0.0.55 HttpAgent.
//
// HttpAgent's constructor does:
//   this.fetch = e.fetch ?? fetch
// then calls `this.fetch(this.url, init)` later. When called as a method on
// the HttpAgent instance, `this` becomes the HttpAgent, not Window. Chromium's
// native fetch throws `TypeError: Failed to execute 'fetch' on 'Window':
// Illegal invocation` whenever its `this` is not Window.
//
// Replacing `window.fetch` with an arrow-wrapped version makes the stored
// reference safe to invoke with any receiver (arrow functions ignore `this`),
// so HttpAgent's `this.fetch(...)` resolves to a function that internally
// forwards to the genuine `window.fetch(...)` with the correct binding.
//
// Remove this once @ag-ui/client ships a fix (constructor binds the fetch or
// run() uses a free function instead of a method call).

if (
  typeof window !== 'undefined' &&
  typeof window.fetch === 'function' &&
  !(window as { __neumaFetchBound?: boolean }).__neumaFetchBound
) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((...args: Parameters<typeof fetch>) =>
    nativeFetch(...args)) as typeof fetch;
  (window as { __neumaFetchBound?: boolean }).__neumaFetchBound = true;
}

export {};
