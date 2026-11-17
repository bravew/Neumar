import { describe, expect, it } from 'vitest';

import type { TaskPlan } from '@/core/agent/types';

import {
  decisionInterruptId,
  parseDecisionInterruptId,
  parseDecisionResponse,
  planInterrupt,
} from '@/shared/services/ag-ui/interrupts';

const plan: TaskPlan = {
  id: 'plan-1',
  goal: 'Ship the change',
  steps: [
    { id: 's1', description: 'Write it', status: 'pending' },
    { id: 's2', description: 'Test it', status: 'pending' },
  ],
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AG-UI decision interrupts', () => {
  it('round-trips a decision id through the owning record', () => {
    for (const kind of ['plan', 'question', 'permission'] as const) {
      const id = decisionInterruptId(kind, 'record-1');
      expect(parseDecisionInterruptId(id)).toEqual({
        kind,
        sourceId: 'record-1',
      });
    }
  });

  it('rejects malformed or unknown decision ids', () => {
    expect(parseDecisionInterruptId('')).toBeNull();
    expect(parseDecisionInterruptId('plan')).toBeNull();
    expect(parseDecisionInterruptId('plan:')).toBeNull();
    expect(parseDecisionInterruptId('other:record-1')).toBeNull();
  });

  it('builds a plan interrupt whose id names the stored plan', () => {
    const interrupt = planInterrupt('task-1', plan);
    expect(interrupt).toMatchObject({
      id: 'plan:plan-1',
      reason: 'plan_approval',
      message: 'Ship the change',
      metadata: {
        decision: {
          kind: 'plan',
          taskId: 'task-1',
          plan: {
            id: 'plan-1',
            goal: 'Ship the change',
            steps: [
              { id: 's1', description: 'Write it', status: 'pending' },
              { id: 's2', description: 'Test it', status: 'pending' },
            ],
          },
        },
      },
    });
    expect(interrupt.responseSchema).toMatchObject({
      type: 'object',
      properties: { approved: { type: 'boolean' } },
      required: ['approved'],
      additionalProperties: false,
    });
  });

  it('validates a plan answer strictly', () => {
    expect(parseDecisionResponse('plan', { approved: true })).toEqual({
      ok: true,
      response: { approved: true },
    });
    expect(parseDecisionResponse('plan', { approved: 'yes' }).ok).toBe(false);
    expect(parseDecisionResponse('plan', { approved: true, extra: 1 }).ok).toBe(
      false,
    );
  });

  it('validates question and permission answers', () => {
    expect(
      parseDecisionResponse('question', { answer: 'Use option A' }),
    ).toEqual({ ok: true, response: { answer: 'Use option A' } });
    expect(parseDecisionResponse('question', { answer: '  ' }).ok).toBe(false);
    expect(
      parseDecisionResponse('permission', {
        approved: false,
        alwaysAllow: true,
      }),
    ).toEqual({
      ok: true,
      response: { approved: false, alwaysAllow: true },
    });
    expect(parseDecisionResponse('permission', {}).ok).toBe(false);
  });
});
