import { EventType, type BaseEvent } from '@ag-ui/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  journal: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@/shared/services/ag-ui/journal', () => ({
  journalAGUIEvent: mocks.journal,
}));
vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: { publish: mocks.publish },
}));
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), debug: vi.fn() }),
}));

import { runDetachedPipeline } from '@/shared/services/ag-ui/transport';

describe('runDetachedPipeline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('journals before publishing and applying side effects', async () => {
    const calls: string[] = [];
    mocks.journal.mockImplementation(() => calls.push('journal'));
    mocks.publish.mockImplementation(() => calls.push('publish'));
    const persister = {
      handleEvent: vi.fn(() => calls.push('persist')),
    };
    async function* events() {
      yield {
        type: EventType.RUN_FINISHED,
        seq: 0,
      } as BaseEvent;
    }

    await runDetachedPipeline(
      events(),
      'design:project-1:run-1',
      persister as never,
      undefined,
      { threadId: 'project-1', runId: 'run-1' },
    );

    expect(calls).toEqual(['journal', 'publish', 'persist']);
  });

  it('journals one sequenced terminal error when the source throws', async () => {
    async function* events(): AsyncGenerator<BaseEvent> {
      yield { type: EventType.RUN_STARTED, seq: 0 } as BaseEvent;
      throw new Error('boom');
    }
    const persister = { handleEvent: vi.fn() };

    await runDetachedPipeline(
      events(),
      'video:project-1:run-1',
      persister as never,
      undefined,
      { threadId: 'project-1', runId: 'run-1' },
    );

    expect(mocks.journal).toHaveBeenLastCalledWith(
      'run-1',
      expect.objectContaining({
        type: EventType.RUN_ERROR,
        seq: 1,
        message: 'boom',
      }),
    );
  });
});
