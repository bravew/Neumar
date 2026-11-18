import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { closeDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getMessagesByTaskId,
} from '@/shared/db/operations';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { dbMessagesToFullAGUI } from '@/shared/services/ag-ui/history';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
import { runDetachedPipeline } from '@/shared/services/ag-ui/transport';

// The real emitter, persister, SQLite rows and history projection run here.
// Only the in-process event bus is stubbed, since no SSE client is attached.
vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: { publish: vi.fn() },
}));

const TASK_ID = 'task-activity-replay';
const OTHER_TASK_ID = 'task-activity-replay-other';

let tempHome = '';

const heartbeat = (elapsedMs: number): AgentMessage => ({
  type: 'planning_status',
  content: `Planning ${elapsedMs}`,
  elapsedMs,
});

/** Runs one AG-UI run through the same pipeline the route uses. */
async function runOnce(
  taskId: string,
  runId: string,
  messages: AgentMessage[],
): Promise<void> {
  const emitter = new AGUIEmitter(taskId, runId);
  const persister = new AGUIEventPersister(
    taskId,
    runId,
    tempHome,
    path.join(tempHome, 'session'),
  );
  async function* source() {
    yield* messages;
  }
  await runDetachedPipeline(
    emitter.transform(source()),
    taskId,
    persister,
    undefined,
    { threadId: taskId, runId },
  );
}

/** What a reload or task switch reads back: the projected history. */
const history = (taskId: string) =>
  dbMessagesToFullAGUI(getMessagesByTaskId(taskId));

const statusWidgets = (taskId: string) =>
  history(taskId).filter(
    (message) =>
      message.role === 'activity' && message.activityType === 'status',
  );

describe('activity widgets through the real pipeline and history', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neumar-activity-replay-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
    createSession({ id: 'session-replay', prompt: 'test' });
    for (const [id, index] of [
      [TASK_ID, 0],
      [OTHER_TASK_ID, 1],
    ] as const) {
      createTask({
        id,
        session_id: 'session-replay',
        task_index: index,
        prompt: 'test',
        work_dir: tempHome,
      });
    }
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('leaves one settled widget in the stored history after a successful run', async () => {
    await runOnce(TASK_ID, 'run-ok', [
      heartbeat(1000),
      heartbeat(2000),
      { type: 'text', content: 'All done' },
    ]);

    const widgets = statusWidgets(TASK_ID);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({
      id: 'planning-status-run-ok',
      content: { phase: 'done', message: 'Planning 2000', elapsedMs: 2000 },
    });
    expect(
      history(TASK_ID)
        .filter((message) => message.role === 'assistant')
        .map((message) => message.content),
    ).toContain('All done');
  });

  it('restores the same single widget on every read of the stored history', async () => {
    await runOnce(TASK_ID, 'run-replay', [
      heartbeat(1000),
      { type: 'text', content: 'All done' },
    ]);

    // A reload or a reconnect reads history again; it must not multiply or
    // change the widget. Re-running the same run id is not a replay path: the
    // durable journal rejects different content at an existing sequence.
    const first = statusWidgets(TASK_ID);
    const second = statusWidgets(TASK_ID);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(first[0]?.content).toMatchObject({ phase: 'done' });
  });

  it('settles the widget as failed after a run error, and keeps it single', async () => {
    await runOnce(TASK_ID, 'run-fail', [
      heartbeat(1000),
      { type: 'error', message: 'boom' },
    ]);

    const widgets = statusWidgets(TASK_ID);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]?.content).toMatchObject({ phase: 'failed' });
  });

  it('reads the same widget back after switching to another task and returning', async () => {
    await runOnce(TASK_ID, 'run-switch', [
      heartbeat(1000),
      { type: 'text', content: 'Done' },
    ]);
    const before = statusWidgets(TASK_ID);

    await runOnce(OTHER_TASK_ID, 'run-other', [
      heartbeat(500),
      { type: 'text', content: 'Other' },
    ]);
    const after = statusWidgets(TASK_ID);

    expect(after).toEqual(before);
    expect(statusWidgets(OTHER_TASK_ID)).toHaveLength(1);
  });

  it('keeps widgets from different runs in the same task distinct', async () => {
    await runOnce(TASK_ID, 'run-a', [
      heartbeat(1000),
      { type: 'text', content: 'First' },
    ]);
    await runOnce(TASK_ID, 'run-b', [
      heartbeat(3000),
      { type: 'text', content: 'Second' },
    ]);

    expect(statusWidgets(TASK_ID).map((widget) => widget.id)).toEqual([
      'planning-status-run-a',
      'planning-status-run-b',
    ]);
  });
});
