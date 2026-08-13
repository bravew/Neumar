/**
 * Validate that a fetched response actually contains image data.
 *
 * Remote URLs (e.g. LinkedIn CDN, expired BytePlus links, Linear ticket
 * attachments behind auth) often return 200 OK with HTML error/auth pages
 * instead of actual image bytes. Without validation the HTML gets uploaded
 * to Slack as `image-xxx.png` and renders as "Binary".
 *
 * Two layers of defence:
 *   1. Content-type starts with `image/`.
 *   2. Buffer leading bytes match a known image signature (magic bytes).
 *
 * SVG is text-based XML — content-type check is enough; magic bytes don't
 * apply.
 */

interface MagicSignature {
  bytes: number[];
  type: 'png' | 'jpeg' | 'gif' | 'webp';
}

/** Known image magic byte signatures. */
const IMAGE_SIGNATURES: MagicSignature[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], type: 'png' }, // \x89PNG
  { bytes: [0xff, 0xd8, 0xff], type: 'jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], type: 'gif' }, // GIF8
  // WebP requires both RIFF (0..3) AND WEBP (8..11) — checked separately.
  { bytes: [0x52, 0x49, 0x46, 0x46], type: 'webp' },
];

const IMAGE_CONTENT_TYPE_RE = /^image\//;

/**
 * Map a content-type to a file extension. Returns `undefined` when the
 * content-type isn't an image type at all.
 */
export function imageExtFromContentType(
  contentType: string,
): string | undefined {
  const mime = contentType.split(';')[0]?.trim() ?? '';
  if (!IMAGE_CONTENT_TYPE_RE.test(mime)) return undefined;
  return (
    (
      {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
      } as Record<string, string>
    )[mime] ?? '.png'
  );
}

/**
 * Whether the buffer's leading bytes match a known image format.
 */
export function hasImageMagicBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 4) return false;
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.type === 'webp') {
      if (buffer.byteLength < 12) continue;
      if (
        sig.bytes.every((b, i) => buffer[i] === b) &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      ) {
        return true;
      }
    } else if (sig.bytes.every((b, i) => buffer[i] === b)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a fetch Response + downloaded Buffer as an image.
 *   • `{ valid: true, ext }`  → ready to upload, with the right extension
 *   • `{ valid: false, reason }` → log + skip
 */
export function validateImageResponse(
  res: Response,
  buffer: Buffer,
): { valid: true; ext: string } | { valid: false; reason: string } {
  const contentType = res.headers.get('content-type') ?? '';
  const ext = imageExtFromContentType(contentType);
  if (!ext) {
    return {
      valid: false,
      reason: `Non-image content-type: ${contentType || '(empty)'}`,
    };
  }

  // SVG is text-based XML — skip the magic-byte check.
  const mime = contentType.split(';')[0]?.trim() ?? '';
  if (mime === 'image/svg+xml') {
    return { valid: true, ext };
  }

  if (!hasImageMagicBytes(buffer)) {
    return {
      valid: false,
      reason: `Buffer lacks image magic bytes (content-type was ${contentType})`,
    };
  }

  return { valid: true, ext };
}
