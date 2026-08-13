import { describe, expect, it } from 'vitest';

import {
  critiqueReducer,
  initialCritiqueState,
} from '@/components/design/critique/critique-reducer';
import type { PanelEvent } from '@/shared/types/design-mode';

const ROLES = ['designer', 'critic', 'brand', 'accessibility', 'copy'];
const SEQUENCE_COUNT = 1_000;
const EVENTS_PER_SEQUENCE = 200;
const P99_BUDGET_MICROS = 1_500;

describe('critiqueReducer performance', () => {
  it('keeps p99 dispatch time below the regression budget', () => {
    const durations: number[] = [];

    for (let sequence = 0; sequence < SEQUENCE_COUNT; sequence += 1) {
      let state = initialCritiqueState;
      for (const event of makeSequence(`jury_perf_${sequence}`)) {
        const startedAt = performance.now();
        state = critiqueReducer(state, event);
        durations.push((performance.now() - startedAt) * 1_000);
      }
      expect(state.phase).toBe('shipped');
    }

    durations.sort((left, right) => left - right);
    const p99 = durations[Math.floor(durations.length * 0.99)] ?? Infinity;
    expect(p99).toBeLessThan(P99_BUDGET_MICROS);
  });
});

function makeSequence(runId: string): PanelEvent[] {
  const events: PanelEvent[] = [
    {
      type: 'run_started',
      runId,
      protocolVersion: 'design-jury.v1',
      roles: ROLES,
      startedAt: '2026-05-15T00:00:00.000Z',
    },
  ];

  for (let index = 1; index < EVENTS_PER_SEQUENCE - 1; index += 1) {
    const round = 1 + (index % 4);
    const role = ROLES[index % ROLES.length]!;
    const branch = index % 5;
    if (branch === 0) {
      events.push({ type: 'panelist_open', runId, round, role });
    } else if (branch === 1) {
      events.push({
        type: 'panelist_dim',
        runId,
        round,
        role,
        rating: 5 + (index % 5),
      });
    } else if (branch === 2) {
      events.push({
        type: 'panelist_must_fix',
        runId,
        round,
        role,
        itemId: `${role}-${index}`,
        body: 'Tighten focus states.',
      });
    } else if (branch === 3) {
      events.push({ type: 'panelist_close', runId, round, role });
    } else {
      events.push({
        type: 'round_end',
        runId,
        round,
        aggregate: { avgScore: 7.5, mustFix: 1, quickWins: 2 },
      });
    }
  }

  events.push({ type: 'shipped', runId });
  return events;
}
