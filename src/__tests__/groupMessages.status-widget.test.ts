import { describe, expect, it } from 'vitest';

import { groupMessages } from '@/components/task/groupMessages';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';

/** What the store holds for a status activity: an object in `content`. */
const status = (
  content: Record<string, unknown>,
  extra: Partial<AGUIMessage> = {},
) =>
  ({
    id: 'planning-status-run-1',
    role: 'activity',
    activityType: 'status',
    content,
    ...extra,
  }) as unknown as AGUIMessage;

const user: AGUIMessage = { id: 'u1', role: 'user', content: 'Do it' };
const answer: AGUIMessage = { id: 'a1', role: 'assistant', content: 'Done.' };

describe('groupMessages — status activity widgets', () => {
  it('shows a live planning status as one widget item under the user message', () => {
    const items = groupMessages(
      [
        user,
        status({ phase: 'planning', message: 'Reasoning...', elapsedMs: 4000 }),
      ],
      null,
      false,
    );

    expect(items.map((i) => i.type)).toEqual(['message', 'status-widget']);
    expect(items[1]).toMatchObject({
      key: 'planning-status-run-1',
      status: { phase: 'planning', message: 'Reasoning...', elapsedMs: 4000 },
    });
  });

  it.each(['done', 'failed', 'cancelled'])(
    'drops a status that settled as %s',
    (phase) => {
      const items = groupMessages(
        [user, status({ phase }), answer],
        null,
        false,
      );

      expect(items.map((i) => i.type)).toEqual(['message', 'message']);
    },
  );

  it('keeps the answer peeled off when an activity trails the turn', () => {
    const items = groupMessages(
      [user, answer, status({ phase: 'done' })],
      null,
      false,
    );

    expect(items.map((i) => i.type)).toEqual(['message', 'message']);
    expect(items[1]).toMatchObject({ type: 'message', key: 'a1' });
  });

  it('never renders an activity payload as a message bubble', () => {
    const items = groupMessages(
      [user, status({ phase: 'planning' }), answer],
      null,
      false,
    );

    const bubbles = items.filter((i) => i.type === 'message');
    expect(bubbles.map((i) => i.key)).toEqual(['u1', 'a1']);
  });

  it('leaves a sub-agent status out of the main thread', () => {
    const items = groupMessages(
      [user, status({ phase: 'planning' }, { subagentRunId: 'task-a' })],
      null,
      false,
    );

    expect(items.map((i) => i.type)).toEqual(['message']);
  });

  it.each([
    [
      'an unsupported activity type',
      { activityType: 'timeline' },
      { phase: 'planning' },
    ],
    ['a payload with no phase', {}, { message: 'x' }],
    [
      'a non-object payload',
      {},
      'planning' as unknown as Record<string, unknown>,
    ],
  ])('ignores %s', (_name, extra, content) => {
    const items = groupMessages([user, status(content, extra)], null, false);

    expect(items.map((i) => i.type)).toEqual(['message']);
  });
});
