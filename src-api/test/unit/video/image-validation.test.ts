import { describe, expect, it } from 'vitest';

import { assertSupportedImageBuffer } from '@/shared/video/image-validation';

describe('image validation', () => {
  it('rejects renamed text files before storing reference images', () => {
    expect(() =>
      assertSupportedImageBuffer(Buffer.from('not an image'), 'fake.png'),
    ).toThrow(/unsupported image/i);
  });

  it('accepts a valid png signature', () => {
    expect(() =>
      assertSupportedImageBuffer(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image.png',
      ),
    ).not.toThrow();
  });
});
