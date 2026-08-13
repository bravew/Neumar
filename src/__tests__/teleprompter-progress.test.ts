import { describe, expect, it } from 'vitest';

import { teleprompterProgress } from '@/app/pages/Teleprompter';

describe('teleprompterProgress', () => {
  it('maps elapsed time and words per minute into bounded progress', () => {
    expect(teleprompterProgress(150, 30_000, 150)).toBe(0.5);
    expect(teleprompterProgress(150, 120_000, 150)).toBe(1);
    expect(teleprompterProgress(0, 30_000, 150)).toBe(0);
  });
});
