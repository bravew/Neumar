import { describe, expect, it } from 'vitest';

import { hasClaudeSdkStalled } from '@/extensions/agent/claude/stall-policy';

describe('Claude SDK stall policy', () => {
  it('allows long complete-message generation but eventually aborts a hung SDK', () => {
    expect(hasClaudeSdkStalled(120_000)).toBe(false);
    expect(hasClaudeSdkStalled(599_999)).toBe(false);
    expect(hasClaudeSdkStalled(600_000)).toBe(true);
  });
});
