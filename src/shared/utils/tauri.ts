/**
 * Tauri runtime detection.
 *
 * Tauri exposes `__TAURI_INTERNALS__` on the global window object in v2 and
 * the legacy `__TAURI__` namespace from v1. Either is enough to confirm
 * we're running inside the Tauri shell rather than a plain browser tab.
 *
 * Extracted so the heuristic stays consistent across files — previously
 * each consumer copied the same check and they drifted over time.
 */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}
