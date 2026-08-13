import { describe, expect, it } from 'vitest';

import {
  critiqueReducer,
  initialCritiqueState,
  reduceCritiqueEvents,
} from '@/components/design/critique/critique-reducer';
import type { PanelEvent } from '@/shared/types/design-mode';

const started: PanelEvent = {
  type: 'run_started',
  runId: 'jury_live1234',
  protocolVersion: 'design-jury.v1',
  roles: ['designer', 'critic'],
  startedAt: '2026-05-12T00:00:00.000Z',
};

describe('critiqueReducer', () => {
  it('boots a new run and ignores stale events by reference', () => {
    const running = critiqueReducer(initialCritiqueState, started);
    const next = critiqueReducer(running, {
      type: 'panelist_open',
      runId: 'jury_old1234',
      round: 1,
      role: 'designer',
    });

    expect(running.phase).toBe('running');
    expect(next).toBe(running);
  });

  it('stores out-of-order panelist events in their own round', () => {
    const state = reduceCritiqueEvents([
      started,
      {
        type: 'panelist_dim',
        runId: started.runId,
        round: 2,
        role: 'critic',
        rating: 6,
      },
      {
        type: 'panelist_dim',
        runId: started.runId,
        round: 1,
        role: 'designer',
        rating: 8,
      },
    ]);

    expect(state.rounds[1]?.panelists.designer.rating).toBe(8);
    expect(state.rounds[2]?.panelists.critic.rating).toBe(6);
  });

  it('keeps terminal phases sticky but accepts parser warnings', () => {
    const shipped = reduceCritiqueEvents([
      started,
      { type: 'shipped', runId: started.runId },
    ]);
    const ignored = critiqueReducer(shipped, {
      type: 'panelist_open',
      runId: started.runId,
      round: 1,
      role: 'designer',
    });
    const warned = critiqueReducer(ignored, {
      type: 'parser_warning',
      runId: started.runId,
      round: null,
      warning: 'Trailing text ignored.',
    });

    expect(ignored).toBe(shipped);
    expect(warned.phase).toBe('shipped');
    expect(warned.parserWarnings).toEqual(['Trailing text ignored.']);
  });

  it('reboots state on a new run_started event', () => {
    const first = reduceCritiqueEvents([
      started,
      {
        type: 'panelist_must_fix',
        runId: started.runId,
        round: 1,
        role: 'designer',
        itemId: 'designer-1',
        body: 'Fix focus state.',
      },
    ]);
    const second = critiqueReducer(first, {
      ...started,
      runId: 'jury_next1234',
    });

    expect(Object.keys(second.rounds)).toHaveLength(0);
    expect(second.runId).toBe('jury_next1234');
  });
});
