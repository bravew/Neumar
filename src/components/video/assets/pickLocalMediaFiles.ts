import { openNativeFileDialog } from '@/shared/assets/api';
import { grantFileReadAccess } from '@/shared/lib/tauri-scope';

/**
 * Picks media files and returns their real absolute paths, so the project can
 * reference the user's own copies instead of taking its own.
 *
 * Returns `null` when no picker yielded paths — the caller falls back to the
 * `<input type="file">` upload, which is the only route left when all we can
 * get is bytes.
 */
export async function pickLocalMediaFiles(): Promise<string[] | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({ directory: false, multiple: true });
    const paths = Array.isArray(result)
      ? result
      : typeof result === 'string'
        ? [result]
        : [];
    if (paths.length === 0) return [];
    // External drives sit outside Tauri's build-time fs scope.
    await grantFileReadAccess(paths);
    return paths;
  }

  // Web build: the API server runs on this machine, so it can raise the real
  // chooser. `supported: false` means the platform has no native dialog.
  const native = await openNativeFileDialog();
  return native.supported ? native.paths : null;
}
