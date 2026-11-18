import { describe, expect, it } from 'vitest';

import type { TaskPlan } from '@/core/agent/types';

import {
  decisionInterruptId,
  parseDecisionInterruptId,
  parseDecisionResponse,
  permissionInterrupt,
  planInterrupt,
  questionInterrupt,
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

describe('permission and question interrupts', () => {
  const prompt = {
    id: 'req-7',
    tool: 'Bash',
    command: '{"command":"ls"}',
    description: 'Execute Bash',
    risk_level: 'medium' as const,
    suppress_always_allow_rule: true,
  };

  it('names the adapter request and carries the prompt the user was shown', () => {
    const interrupt = permissionInterrupt({
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt,
      expiresAt: 1_700_000_000_000,
    });

    expect(interrupt.id).toBe('permission:req-7');
    expect(parseDecisionInterruptId(interrupt.id)).toEqual({
      kind: 'permission',
      sourceId: 'req-7',
    });
    expect(interrupt.reason).toBe('tool_permission');
    expect(interrupt.message).toBe('Execute Bash');
    expect(interrupt.metadata).toEqual({
      decision: {
        kind: 'permission',
        taskId: 'task-1',
        permission: prompt,
        expiresAt: 1_700_000_000_000,
      },
    });
    expect(interrupt.responseSchema).toMatchObject({
      properties: { approved: { type: 'boolean' } },
      required: ['approved'],
    });
  });

  it('omits an expiry the adapter never enforces', () => {
    const interrupt = permissionInterrupt({
      taskId: 'task-1',
      sessionId: 'session-1',
      prompt,
      expiresAt: null,
    });
    expect(interrupt.metadata?.decision).not.toHaveProperty('expiresAt');
  });

  it('builds a question interrupt from the stored question', () => {
    const interrupt = questionInterrupt({
      id: 'q-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      toolUseId: 'tool-1',
      questions: [{ question: 'Which database?', options: [] }],
      status: 'pending',
      answer: null,
      askedAt: '2026-01-01T00:00:00Z',
      answeredAt: null,
      expiresAt: '2026-01-01T01:00:00Z',
    });

    expect(interrupt.id).toBe('question:q-1');
    expect(interrupt.reason).toBe('agent_question');
    expect(interrupt.message).toBe('Which database?');
    expect(interrupt.metadata).toMatchObject({
      decision: {
        kind: 'question',
        taskId: 'task-1',
        expiresAt: '2026-01-01T01:00:00Z',
      },
    });
  });

  it('falls back to a generic message for an unreadable question', () => {
    const interrupt = questionInterrupt({
      id: 'q-2',
      sessionId: 'session-1',
      taskId: null,
      toolUseId: null,
      questions: ['not an object'],
      status: 'pending',
      answer: null,
      askedAt: '2026-01-01T00:00:00Z',
      answeredAt: null,
      expiresAt: null,
    });
    expect(interrupt.message).toBe('The agent has a question');
    expect(interrupt.metadata?.decision).not.toHaveProperty('expiresAt');
  });
});
