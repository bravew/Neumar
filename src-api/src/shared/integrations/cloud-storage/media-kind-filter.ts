import type { CloudFile } from './types';

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export const MEDIA_KIND_EXTENSIONS: Record<MediaKind, ReadonlySet<string>> = {
  image: new Set([
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'heic',
    'heif',
    'bmp',
    'tiff',
    'svg',
  ]),
  video: new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'flv', 'wmv']),
  audio: new Set(['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac']),
  document: new Set([
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'txt',
    'md',
    'csv',
    'rtf',
  ]),
};

const MIME_PREFIX: Record<Exclude<MediaKind, 'document'>, string> = {
  image: 'image/',
  video: 'video/',
  audio: 'audio/',
};

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Client-side filter used when a provider's search API rejects empty
 * `query` strings (Box, Dropbox, OneDrive) but the user is browsing by
 * media kind. Matches on file extension first, then mime-type prefix as
 * a fallback for files without a useful extension. Folders are kept so
 * the picker still lets the user drill in.
 */
export function filterByMediaKind(
  items: readonly CloudFile[],
  kind: MediaKind | undefined,
): CloudFile[] {
  if (!kind) return [...items];
  const exts = MEDIA_KIND_EXTENSIONS[kind];
  const prefix = kind === 'document' ? undefined : MIME_PREFIX[kind];
  return items.filter((item) => {
    if (item.isFolder) return true;
    if (exts.has(extOf(item.name))) return true;
    if (prefix && item.mimeType.startsWith(prefix)) return true;
    return false;
  });
}
