import { describe, expect, it } from 'vitest';

import { partitionAutomations } from '@/components/automation/partition-automations';

const items = [
  { id: 'cron', enabled: true, trigger: { type: 'cron' } },
  { id: 'watch', enabled: true, trigger: { type: 'webhook' } },
  { id: 'heart', enabled: true, trigger: { type: 'heartbeat' } },
  { id: 'manual', enabled: true, trigger: { type: 'manual' } },
  { id: 'paused-cron', enabled: false, trigger: { type: 'cron' } },
];

describe('partitionAutomations', () => {
  it('puts every automation in exactly one list', () => {
    const lists = partitionAutomations(items);
    const ids = [...lists.scheduled, ...lists.watching, ...lists.paused].map(
      (item) => item.id,
    );
    expect(ids.sort()).toEqual(items.map((item) => item.id).sort());
    expect(new Set(ids).size).toBe(items.length);
    expect(lists.scheduled.map((item) => item.id)).toEqual(['cron']);
    expect(lists.paused.map((item) => item.id)).toEqual(['paused-cron']);
    expect(lists.watching.map((item) => item.id).sort()).toEqual([
      'heart',
      'manual',
      'watch',
    ]);
  });
});
