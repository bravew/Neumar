import path from 'node:path';

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
]);

export function assertSupportedImageBuffer(
  buffer: Buffer,
  filename = 'image',
): void {
  if (isPng(buffer) || isJpeg(buffer) || isGif(buffer) || isWebp(buffer)) {
    return;
  }
  throw new Error(`Unsupported image file: ${filename}`);
}

export function assertSupportedImageUpload(file: File, buffer: Buffer): void {
  const ext = path.extname(file.name).toLowerCase();
  const hasImageMime = file.type.startsWith('image/');
  if (!hasImageMime || !IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported image file: ${file.name || 'upload'}`);
  }
  assertSupportedImageBuffer(buffer, file.name || 'upload');
}

export function imageExtensionFromName(filename: string, fallback = '.png') {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? ext : fallback;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function isGif(buffer: Buffer): boolean {
  if (buffer.length < 6) return false;
  const header = buffer.subarray(0, 6).toString('ascii');
  return header === 'GIF87a' || header === 'GIF89a';
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
