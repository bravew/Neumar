import { beforeEach, describe, expect, it } from 'vitest';

import type { Settings } from '@/shared/db/settings';
import {
  nextUsageActivityOpen,
  recordUsageActivityOpen,
  resetUsageActivityOpenClock,
  USAGE_ACTIVITY_DEDUPE_MS,
} from '@/shared/layout/usage-activity';

describe('Usage & activity open counter', () => {
  beforeEach(() => {
    resetUsageActivityOpenClock();
  });

  it('counts one open and ignores a second call inside the dedupe window', () => {
    expect(nextUsageActivityOpen(0, 1_000, 0)).toEqual({
      opens: 1,
      lastRecordedAt: 1_000,
    });
    expect(
      nextUsageActivityOpen(1, 1_000 + USAGE_ACTIVITY_DEDUPE_MS - 1, 1_000),
    ).toEqual({
      opens: 1,
      lastRecordedAt: 1_000,
    });
  });

  it('counts another open after the dedupe window', () => {
    expect(
      nextUsageActivityOpen(1, 1_000 + USAGE_ACTIVITY_DEDUPE_MS, 1_000),
    ).toEqual({
      opens: 2,
      lastRecordedAt: 2_000,
    });
  });

  it('writes the incremented count locally and does not write a duplicate', () => {
    let stored: Settings['ui'] = { simpleShell: false, usageActivityOpens: 0 };
    const read = () => ({ ui: stored });
    const write = (next: { ui: Settings['ui'] }) => {
      stored = next.ui;
    };

    expect(recordUsageActivityOpen(5_000, read, write)).toBe(1);
    expect(stored.usageActivityOpens).toBe(1);
    expect(recordUsageActivityOpen(5_100, read, write)).toBe(1);
    expect(stored.usageActivityOpens).toBe(1);
    expect(
      recordUsageActivityOpen(5_000 + USAGE_ACTIVITY_DEDUPE_MS, read, write),
    ).toBe(2);
    expect(stored.usageActivityOpens).toBe(2);
    expect(stored.simpleShell).toBe(false);
  });
});
