import {
  AUDIO_EXTS,
  FILE_MIME_MAP,
  IMAGE_EXTS,
  VIDEO_EXTS,
} from './ChatInput.types';

/**
 * Translate an `<input accept>` string into extensions for the native dialog.
 * Returns an empty list (no filter) when any token can't be mapped, so the
 * dialog never hides a file the HTML picker would have offered.
 */
export function acceptToExtensions(accept: string): string[] {
  const exts = new Set<string>();
  for (const raw of accept.split(',')) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (token.startsWith('.')) {
      exts.add(token.slice(1));
      continue;
    }
    const wildcard =
      token === 'image/*'
        ? IMAGE_EXTS
        : token === 'video/*'
          ? VIDEO_EXTS
          : token === 'audio/*'
            ? AUDIO_EXTS
            : null;
    const matches =
      wildcard ??
      Object.entries(FILE_MIME_MAP)
        .filter(([, mime]) => mime === token)
        .map(([ext]) => ext);
    if (matches.length === 0) return [];
    for (const ext of matches) exts.add(ext);
  }
  return [...exts];
}

/**
 * Open the OS file dialog and return absolute paths, so attachments are read
 * in place instead of uploaded. Resolves to an empty list when cancelled.
 */
export async function pickLocalFilePaths(
  accept: string,
  title: string,
): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const extensions = acceptToExtensions(accept);
  const selected = await open({
    multiple: true,
    directory: false,
    title,
    ...(extensions.length > 0
      ? { filters: [{ name: title, extensions }] }
      : {}),
  });
  if (!selected) return [];
  return (Array.isArray(selected) ? selected : [selected]).filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
}
