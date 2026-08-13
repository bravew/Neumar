import { EventType, type BaseEvent } from '@ag-ui/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const operations = vi.hoisted(() => ({
  appendAgentRunEvent: vi.fn(),
  getAgentRunEventsAfter: vi.fn(),
}));

vi.mock('@/shared/db/operations', () => operations);

import {
  journalAGUIEvent,
  replayAGUIEvents,
} from '@/shared/services/ag-ui/journal';

describe('AG-UI durable journal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the exact sequenced event', () => {
    const event = {
      type: EventType.RUN_STARTED,
      threadId: 'project-1',
      runId: 'run-1',
      seq: 0,
      timestamp: 12,
    } as BaseEvent;

    journalAGUIEvent('run-1', event);

    expect(operations.appendAgentRunEvent).toHaveBeenCalledWith({
      runId: 'run-1',
      seq: 0,
      eventType: EventType.RUN_STARTED,
      event,
    });
  });

  it('rejects an event without a durable sequence', () => {
    expect(() =>
      journalAGUIEvent('run-1', {
        type: EventType.RUN_FINISHED,
      } as BaseEvent),
    ).toThrow('non-negative integer seq');
  });

  it('replays the SQLite suffix in database order', () => {
    operations.getAgentRunEventsAfter.mockReturnValue([
      {
        event_json: JSON.stringify({
          type: EventType.TEXT_MESSAGE_CONTENT,
          seq: 3,
          delta: 'hi',
        }),
      },
      {
        event_json: JSON.stringify({ type: EventType.RUN_FINISHED, seq: 4 }),
      },
    ]);

    expect(replayAGUIEvents('run-1', 2)).toEqual([
      { type: EventType.TEXT_MESSAGE_CONTENT, seq: 3, delta: 'hi' },
      { type: EventType.RUN_FINISHED, seq: 4 },
    ]);
  });
});
