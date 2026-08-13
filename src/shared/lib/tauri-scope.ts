/**
 * Tauri runtime fs-scope helpers.
 *
 * Tauri v2's plugin-fs enforces a build-time scope allowlist defined in
 * `src-tauri/capabilities/default.json`. For user-selected paths outside
 * that allowlist (external drives, arbitrary locations), the scope can be
 * widened at runtime via `FsExt::fs_scope().allow_file|allow_directory`.
 * See https://v2.tauri.app/plugin/file-system/. The Rust side is exposed
 * as the `grant_file_read_access` command in `src-tauri/src/lib.rs`.
 */

function inTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Ask the Tauri backend to widen the plugin-fs scope for the given paths.
 * No-op in browser mode. Errors are logged in DEV and otherwise swallowed —
 * the caller should not rely on the grant succeeding (static scope may
 * already cover the path; a missing grant only costs a failed read).
 */
export async function grantFileReadAccess(paths: string[]): Promise<void> {
  if (!inTauri() || paths.length === 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('grant_file_read_access', { paths });
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[TauriScope] grant_file_read_access failed:', err);
  }
}
