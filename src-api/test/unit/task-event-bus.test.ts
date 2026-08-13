import { describe, expect, it } from 'vitest';

import { taskEventBus } from '@/shared/services/task-event-bus';

describe('taskEventBus sequence replay', () => {
  it('replays only buffered messages after the requested sequence', () => {
    const taskId = `task-event-bus-${crypto.randomUUID()}`;
    taskEventBus.publish(taskId, { type: 'RUN_STARTED' });
    taskEventBus.publish(taskId, { type: 'TEXT_MESSAGE_CONTENT' });
    taskEventBus.publish(taskId, { type: 'TEXT_MESSAGE_CONTENT' });

    const seen: number[] = [];
    const unsubscribe = taskEventBus.subscribe(
      taskId,
      (message) => {
        const seq = (message as { seq?: number }).seq;
        if (seq !== undefined) seen.push(seq);
      },
      { afterSeq: 1 },
    );
    unsubscribe();

    expect(seen).toEqual([2]);
  });

  it('reports sequence bounds for buffered messages', () => {
    const taskId = `task-event-bus-${crypto.randomUUID()}`;
    taskEventBus.publish(taskId, { type: 'RUN_STARTED' });
    taskEventBus.publish(taskId, { type: 'TEXT_MESSAGE_CONTENT' });

    expect(taskEventBus.getSeqBounds(taskId)).toEqual({
      minSeq: 0,
      maxSeq: 1,
    });
  });

  it('returns the buffered event envelope for SSE ids', () => {
    const taskId = `task-event-bus-${crypto.randomUUID()}`;
    const event = taskEventBus.publishWithEnvelope(taskId, { type: 'text' });

    expect(event.id).toBe('0');
    expect(event.message).toMatchObject({ type: 'text', seq: 0 });
  });
});
