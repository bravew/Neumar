import { describe, expect, it } from 'vitest';

import {
  hasImageMagicBytes,
  imageExtFromContentType,
  validateImageResponse,
} from '@/shared/utils/image-validator';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const HTML_AUTH_WALL = Buffer.from(
  '<!DOCTYPE html><html><body>Sign in to continue</body></html>',
);

function res(contentType: string, status = 200): Response {
  return new Response(null, {
    status,
    headers: { 'Content-Type': contentType },
  });
}

describe('imageExtFromContentType', () => {
  it('maps known image types to extensions', () => {
    expect(imageExtFromContentType('image/png')).toBe('.png');
    expect(imageExtFromContentType('image/jpeg')).toBe('.jpg');
    expect(imageExtFromContentType('image/gif')).toBe('.gif');
    expect(imageExtFromContentType('image/webp')).toBe('.webp');
    expect(imageExtFromContentType('image/svg+xml')).toBe('.svg');
  });

  it('handles charset suffixes', () => {
    expect(imageExtFromContentType('image/png; charset=binary')).toBe('.png');
  });

  it('returns undefined for non-image types', () => {
    expect(imageExtFromContentType('text/html')).toBeUndefined();
    expect(imageExtFromContentType('application/json')).toBeUndefined();
    expect(imageExtFromContentType('')).toBeUndefined();
  });
});

describe('hasImageMagicBytes', () => {
  it('recognises PNG/JPEG/GIF/WebP magic bytes', () => {
    expect(hasImageMagicBytes(PNG_MAGIC)).toBe(true);
    expect(hasImageMagicBytes(JPEG_MAGIC)).toBe(true);
    expect(hasImageMagicBytes(GIF_MAGIC)).toBe(true);
    expect(hasImageMagicBytes(WEBP_MAGIC)).toBe(true);
  });

  it('rejects HTML disguised as image', () => {
    expect(hasImageMagicBytes(HTML_AUTH_WALL)).toBe(false);
  });

  it('rejects RIFF without WEBP marker', () => {
    const riffOnly = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x4f, 0x47, 0x47, 0x53,
    ]);
    expect(hasImageMagicBytes(riffOnly)).toBe(false);
  });

  it('rejects buffers shorter than 4 bytes', () => {
    expect(hasImageMagicBytes(Buffer.from([0x89]))).toBe(false);
  });
});

describe('validateImageResponse', () => {
  it('passes a valid PNG response', () => {
    const r = validateImageResponse(res('image/png'), PNG_MAGIC);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.ext).toBe('.png');
  });

  it('rejects HTML returned with text/html content-type', () => {
    const r = validateImageResponse(res('text/html'), HTML_AUTH_WALL);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/Non-image content-type/);
  });

  it('rejects HTML disguised with image/png content-type', () => {
    const r = validateImageResponse(res('image/png'), HTML_AUTH_WALL);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/lacks image magic bytes/);
  });

  it('passes SVG without checking magic bytes', () => {
    const r = validateImageResponse(
      res('image/svg+xml'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.ext).toBe('.svg');
  });

  it('rejects empty content-type', () => {
    const r = validateImageResponse(res(''), PNG_MAGIC);
    expect(r.valid).toBe(false);
  });
});
