/**
 * Bi-directional MIME ↔ extension lookup table for media files.
 *
 * Single source of truth for adapter MIME tables and any code that needs to
 * choose a file extension from a MIME (or vice versa). Covers the formats the
 * video editor's pipeline (ffmpeg + Html5Video/Html5Audio) actually handles.
 *
 * If you find yourself adding a per-adapter mime lookup, import from here
 * instead — gaps in any one table (e.g. webm/svg/gif missing from Box,
 * Dropbox, Immich, or the linked-sources copier) are why the editor used to
 * silently lose format hints on those paths.
 */

const EXT_TO_MIME: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
  // Documents and text
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

const MIME_TO_EXT: Record<string, string> = {
  // Video — prefer the canonical extension when multiple map back.
  'video/mp4': 'mp4',
  'video/x-m4v': 'm4v',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/x-ms-wmv': 'wmv',
  'video/x-flv': 'flv',
  'video/3gpp': '3gp',
  'video/ogg': 'ogv',
  // Audio
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/x-ms-wma': 'wma',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  // Images
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/svg': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  // Documents and text
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
};

function normalizeExt(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '');
}

function normalizeMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}

/** Look up a MIME type from a file extension. Accepts ".mp4" or "mp4". */
export function mimeFromExtension(ext: string): string | undefined {
  if (!ext) return undefined;
  return EXT_TO_MIME[normalizeExt(ext)];
}

/** Look up a file extension from a MIME. Returns ".webm", "" if unknown. */
export function extensionFromMime(mime: string | undefined | null): string {
  if (!mime) return '';
  const ext = MIME_TO_EXT[normalizeMime(mime)];
  return ext ? `.${ext}` : '';
}

/** True if the MIME or extension identifies a video format we render with ffmpeg. */
export function isVideoMime(mime: string | undefined): boolean {
  return Boolean(mime && normalizeMime(mime).startsWith('video/'));
}

/** True if the MIME or extension identifies an image format. */
export function isImageMime(mime: string | undefined): boolean {
  return Boolean(mime && normalizeMime(mime).startsWith('image/'));
}

/** True if the MIME or extension identifies an audio format. */
export function isAudioMime(mime: string | undefined): boolean {
  return Boolean(mime && normalizeMime(mime).startsWith('audio/'));
}
