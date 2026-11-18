import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EventType, type BaseEvent } from '@ag-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getMessagesByTaskId,
} from '@/shared/db/operations';
import { dbMessagesToFullAGUI } from '@/shared/services/ag-ui/history';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';

const TASK_ID = 'task-activity-persistence';

let tempHome = '';

function persister(runId: string) {
  return new AGUIEventPersister(
    TASK_ID,
    runId,
    tempHome,
    path.join(tempHome, 'session'),
  );
}

const snapshot = (
  messageId: string,
  content: unknown,
  extra: Record<string, unknown> = {},
) =>
  ({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId,
    activityType: 'status',
    content,
    ...extra,
  }) as unknown as BaseEvent;

const delta = (
  messageId: string,
  patch: unknown,
  extra: Record<string, unknown> = {},
) =>
  ({
    type: EventType.ACTIVITY_DELTA,
    messageId,
    activityType: 'status',
    patch,
    ...extra,
  }) as unknown as BaseEvent;

const activityRows = () =>
  getMessagesByTaskId(TASK_ID).filter((row) => row.type === 'activity');

const activityHistory = () =>
  dbMessagesToFullAGUI(getMessagesByTaskId(TASK_ID)).filter(
    (message) => message.role === 'activity',
  );

describe('activity persistence and history replay', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neumar-activity-persist-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
    createSession({ id: 'session-activity', prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: 'session-activity',
      task_index: 0,
      prompt: 'test',
      work_dir: tempHome,
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('folds a snapshot and its patches into one row and one history message', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { phase: 'planning', elapsedMs: 0 }));
    p.handleEvent(
      delta('status-1', [{ op: 'replace', path: '/elapsedMs', value: 4000 }]),
    );
    p.handleEvent(
      delta('status-1', [{ op: 'add', path: '/message', value: 'Reading' }]),
    );

    expect(activityRows()).toHaveLength(1);
    expect(activityHistory()).toEqual([
      {
        id: 'status-1',
        role: 'activity',
        activityType: 'status',
        content: { phase: 'planning', elapsedMs: 4000, message: 'Reading' },
      },
    ]);
  });

  it('replays the same snapshot without a duplicate row', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { phase: 'planning' }));
    p.handleEvent(snapshot('status-1', { phase: 'planning' }));
    p.handleEvent(snapshot('status-1', { phase: 'done' }));

    expect(activityRows()).toHaveLength(1);
    expect(activityHistory()[0]?.content).toEqual({ phase: 'done' });
  });

  it('leaves an existing activity alone for replace:false, without merging', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { phase: 'planning', a: 1 }));
    p.handleEvent(snapshot('status-1', { phase: 'done' }, { replace: false }));

    expect(activityHistory()[0]?.content).toEqual({ phase: 'planning', a: 1 });
  });

  it('patches an activity that an earlier run created', () => {
    persister('run-1').handleEvent(snapshot('status-1', { phase: 'planning' }));
    persister('run-2').handleEvent(
      delta('status-1', [{ op: 'replace', path: '/phase', value: 'done' }]),
    );

    expect(activityRows()).toHaveLength(1);
    expect(activityHistory()[0]?.content).toEqual({ phase: 'done' });
  });

  it('skips a delta for an activity that does not exist', () => {
    persister('run-1').handleEvent(
      delta('missing', [{ op: 'add', path: '/x', value: 1 }]),
    );

    expect(activityRows()).toEqual([]);
  });

  it('keeps stored content when a patch is malformed or fails to apply', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { phase: 'planning' }));
    p.handleEvent(delta('status-1', [{ op: 'remove', path: '/not-there' }]));
    p.handleEvent(delta('status-1', 'not-an-array'));
    p.handleEvent(delta('status-1', [{ op: 'explode', path: '/phase' }]));
    p.handleEvent(
      delta('status-1', [
        { op: 'replace', path: '/phase', value: 'done' },
        { op: 'remove', path: '/not-there' },
      ]),
    );
    p.handleEvent(
      delta('status-1', [{ op: 'add', path: '/__proto__/x', value: 1 }]),
    );

    expect(activityHistory()[0]?.content).toEqual({ phase: 'planning' });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  // The same table runs against the reducer in
  // src/__tests__/stores/thread-store.agui-coverage.test.ts; the two patch
  // appliers have no shared package, so identical cases keep them in step.
  it.each(['01', '1e0', '', '-1', ' 1', '+1', '1.0', '2'])(
    'rejects the non-canonical or out-of-range array key %j',
    (key) => {
      const p = persister('run-1');
      p.handleEvent(snapshot('status-1', { steps: ['a', 'b'] }));
      p.handleEvent(
        delta('status-1', [
          { op: 'replace', path: `/steps/${key}`, value: 'x' },
        ]),
      );

      expect(activityHistory()[0]?.content).toEqual({ steps: ['a', 'b'] });
    },
  );

  it('accepts a canonical array index, and "-" to append', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { steps: ['a', 'b'] }));
    p.handleEvent(
      delta('status-1', [{ op: 'replace', path: '/steps/1', value: 'c' }]),
    );
    p.handleEvent(
      delta('status-1', [{ op: 'add', path: '/steps/-', value: 'd' }]),
    );

    expect(activityHistory()[0]?.content).toEqual({ steps: ['a', 'c', 'd'] });
  });

  it('compares a `test` operation by value, not by key order', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { meta: { a: 1, b: 2 }, phase: 'one' }));
    p.handleEvent(
      delta('status-1', [
        { op: 'test', path: '/meta', value: { b: 2, a: 1 } },
        { op: 'replace', path: '/phase', value: 'two' },
      ]),
    );
    p.handleEvent(
      delta('status-1', [
        { op: 'test', path: '/meta', value: { a: 1, b: 3 } },
        { op: 'replace', path: '/phase', value: 'three' },
      ]),
    );

    expect(activityHistory()[0]?.content).toEqual({
      meta: { a: 1, b: 2 },
      phase: 'two',
    });
  });

  it('does not read inherited properties through a pointer', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-1', { phase: 'planning' }));
    // Object.prototype clones to `{}`, so an inherited read would be written.
    p.handleEvent(
      delta('status-1', [{ op: 'copy', from: '/__proto__', path: '/stolen' }]),
    );
    p.handleEvent(
      delta('status-1', [
        { op: 'copy', from: '/constructor', path: '/stolen' },
      ]),
    );
    p.handleEvent(
      delta('status-1', [{ op: 'test', path: '/toString', value: null }]),
    );

    expect(activityHistory()[0]?.content).toEqual({ phase: 'planning' });
  });

  it('drops an unsupported activity type and non-object content', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('odd', { x: 1 }, { activityType: 'secret-widget' }));
    p.handleEvent(snapshot('text', 'not an object'));
    p.handleEvent(snapshot('array', ['x']));

    expect(activityRows()).toEqual([]);
  });

  it('does not let an activity take over a conversation message id', () => {
    const p = persister('run-1');
    p.handleEvent({
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'shared',
      role: 'assistant',
    } as unknown as BaseEvent);
    p.handleEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: 'shared',
      delta: 'hello',
    } as unknown as BaseEvent);
    p.handleEvent({
      type: EventType.TEXT_MESSAGE_END,
      messageId: 'shared',
    } as unknown as BaseEvent);
    p.handleEvent(snapshot('shared', { phase: 'planning' }));

    expect(activityRows()).toEqual([]);
    expect(
      getMessagesByTaskId(TASK_ID).find((row) => row.message_id === 'shared')
        ?.content,
    ).toBe('hello');
  });

  it('records which sub-agent owns an activity and keeps parent progress apart', () => {
    const p = persister('run-1');
    p.handleEvent(snapshot('status-parent', { phase: 'planning' }));
    p.handleEvent(
      snapshot(
        'status-child',
        { phase: 'planning' },
        { subagentRunId: 'task-a' },
      ),
    );
    p.handleEvent(
      delta('status-child', [{ op: 'replace', path: '/phase', value: 'done' }]),
    );

    const history = activityHistory();
    expect(history.map((m) => m.id)).toEqual(['status-parent', 'status-child']);
    expect(history[0]).not.toHaveProperty('subagentRunId');
    expect(history[1]).toMatchObject({
      subagentRunId: 'task-a',
      content: { phase: 'done' },
    });
    expect(history[0]?.content).toEqual({ phase: 'planning' });
  });

  it('never replays a stored activity as assistant text', () => {
    persister('run-1').handleEvent(snapshot('status-1', { phase: 'planning' }));

    const history = dbMessagesToFullAGUI(getMessagesByTaskId(TASK_ID));
    expect(history.filter((m) => m.role === 'assistant')).toEqual([]);
  });
});
