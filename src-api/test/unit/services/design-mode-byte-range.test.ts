import { describe, expect, it } from 'vitest';

import { parseByteRange } from '@/shared/services/design-mode/byte-range';

describe('parseByteRange', () => {
  it('parses bounded, open-ended, and suffix byte ranges', () => {
    expect(parseByteRange('bytes=0-99', 1000)).toEqual({
      start: 0,
      end: 99,
    });
    expect(parseByteRange('bytes=500-', 1000)).toEqual({
      start: 500,
      end: 999,
    });
    expect(parseByteRange('bytes=-200', 1000)).toEqual({
      start: 800,
      end: 999,
    });
    expect(parseByteRange('bytes=-1200', 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it('rejects unsatisfiable ranges and ignores malformed headers', () => {
    expect(parseByteRange('bytes=1200-1300', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=500-100', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-99,200-299', 1000)).toBeNull();
    expect(parseByteRange('items=0-99', 1000)).toBeNull();
    expect(parseByteRange(null, 1000)).toBeNull();
  });
});
