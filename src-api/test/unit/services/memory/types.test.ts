import { describe, expect, it } from 'vitest';

import { daysSince, VISIBILITY_TYPES } from '@/shared/services/memory/types';

describe('daysSince', () => {
  it('returns 0 for a date created now', () => {
    expect(daysSince(new Date().toISOString())).toBe(0);
  });

  it('returns 1 for a date created 1.5 days ago', () => {
    const date = new Date(Date.now() - 1.5 * 86_400_000).toISOString();
    expect(daysSince(date)).toBe(1);
  });

  it('returns 30 for a date created exactly 30 days ago', () => {
    const date = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(daysSince(date)).toBe(30);
  });

  it('returns 365 for a date created ~1 year ago', () => {
    const date = new Date(Date.now() - 365 * 86_400_000).toISOString();
    expect(daysSince(date)).toBe(365);
  });

  it('handles ISO date strings without time component', () => {
    // Date.parse handles "2020-01-01" fine
    const days = daysSince('2020-01-01');
    expect(days).toBeGreaterThan(365);
  });
});

describe('VISIBILITY_TYPES', () => {
  it('contains private and team', () => {
    expect(VISIBILITY_TYPES).toEqual(['private', 'team']);
  });
});
