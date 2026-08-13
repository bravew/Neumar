import { beforeEach, describe, expect, it } from 'vitest';

import {
  __claimCronSlotForTests,
  __resetCronClaimsForTests,
  stopCron,
} from '@/shared/automation/cron-service';

describe('cron service slot claims', () => {
  beforeEach(() => {
    stopCron();
    __resetCronClaimsForTests();
  });

  it('claims each automation schedule slot once', () => {
    const slotAt = Date.parse('2026-05-29T12:00:00.000Z');

    expect(__claimCronSlotForTests('automation_1', slotAt)).toBe(true);
    expect(__claimCronSlotForTests('automation_1', slotAt)).toBe(false);
    expect(__claimCronSlotForTests('automation_1', slotAt + 60_000)).toBe(true);
    expect(__claimCronSlotForTests('automation_2', slotAt)).toBe(true);
  });
});
