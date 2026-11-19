import { describe, expect, it } from 'vitest';

import { groupMessages } from '@/components/task/groupMessages';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';

const plan = (
  content: Record<string, unknown>,
  extra: Partial<AGUIMessage> = {},
) =>
  ({
    id: 'plan-plan-1',
    role: 'activity',
    activityType: 'plan',
    content,
    ...extra,
  }) as unknown as AGUIMessage;

const steps = [
  { id: 'step-1', description: 'Write it', status: 'completed' },
  { id: 'step-2', description: 'Test it', status: 'pending' },
];

const user: AGUIMessage = { id: 'u1', role: 'user', content: 'Do it' };

describe('groupMessages — plan activity widgets', () => {
  it.each(['awaiting_approval', 'running', 'done', 'failed', 'cancelled'])(
    'shows the plan checklist while it is %s',
    (phase) => {
      const items = groupMessages(
        [user, plan({ phase, goal: 'Ship it', steps })],
        null,
        false,
      );

      expect(items.map((i) => i.type)).toEqual(['message', 'plan-widget']);
      expect(items[1]).toMatchObject({
        key: 'plan-plan-1',
        plan: { phase, goal: 'Ship it', steps },
      });
    },
  );

  it('keeps the checklist out of the collapsed work list', () => {
    const items = groupMessages(
      [user, plan({ phase: 'running', goal: 'Ship it', steps })],
      null,
      false,
    );

    expect(items.filter((i) => i.type === 'activity')).toEqual([]);
  });

  it('leaves a sub-agent plan out of the main thread', () => {
    const items = groupMessages(
      [
        user,
        plan(
          { phase: 'running', goal: 'Ship it', steps },
          { subagentRunId: 'task-a' },
        ),
      ],
      null,
      false,
    );

    expect(items.map((i) => i.type)).toEqual(['message']);
  });

  it.each([
    ['no goal', { phase: 'running', steps }],
    ['no steps', { phase: 'running', goal: 'Ship it' }],
    [
      'a step with no status',
      { phase: 'running', goal: 'Ship it', steps: [{ description: 'x' }] },
    ],
  ])('ignores a payload with %s', (_name, content) => {
    const items = groupMessages([user, plan(content)], null, false);

    expect(items.map((i) => i.type)).toEqual(['message']);
  });
});
