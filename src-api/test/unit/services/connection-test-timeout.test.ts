import { describe, expect, it, vi } from 'vitest';

import {
  NODE_SETTIMEOUT_MAX,
  resolveConnectionTestTimeoutMs,
} from '@/shared/utils/connection-test-timeout';

describe('resolveConnectionTestTimeoutMs', () => {
  it.each([undefined, ''])('falls back for empty env value %s', (value) => {
    expect(resolveConnectionTestTimeoutMs(value, 12_000)).toBe(12_000);
  });

  it('honors a positive integer override', () => {
    expect(resolveConnectionTestTimeoutMs('5000', 12_000)).toBe(5000);
  });

  it.each(['abc', '0', '-1', '1.5', 'Infinity'])(
    'warns and falls back for invalid override %s',
    (value) => {
      const warn = vi.fn();
      expect(resolveConnectionTestTimeoutMs(value, 12_000, { warn })).toBe(
        12_000,
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('invalid timeout override'),
      );
    },
  );

  it('clamps values above the Node setTimeout maximum', () => {
    const warn = vi.fn();
    expect(
      resolveConnectionTestTimeoutMs('99999999999', 12_000, { warn }),
    ).toBe(NODE_SETTIMEOUT_MAX);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clamping'));
  });
});
