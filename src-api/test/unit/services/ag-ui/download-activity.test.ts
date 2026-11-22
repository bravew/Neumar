import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EventType, type BaseEvent } from '@ag-ui/core';
import {
  downloadActivityId,
  MEDIA_DOWNLOAD_ACTIVITY,
  type DownloadActivity,
} from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentMessage } from '@/core/agent/types';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getMessagesByTaskId,
} from '@/shared/db/operations';
import { downloadActivityEvent } from '@/shared/services/ag-ui/download-activity';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { dbMessagesToFullAGUI } from '@/shared/services/ag-ui/history';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';

const TASK_ID = 'task-download-activity';

const asset = { assetId: '101', name: 'clip.mp4', mime: 'video/mp4', size: 42 };
const activity = (
  items: DownloadActivity['items'],
  taskId = TASK_ID,
): DownloadActivity => ({
  version: 1,
  taskId,
  runId: 'run-1',
  toolCallId: 'call-1',
  batchId: 'batch-1',
  items,
});
const waiting: DownloadActivity['items'] = [
  { itemId: 'a', sequence: 0, phase: 'waiting' },
  { itemId: 'b', sequence: 0, phase: 'waiting' },
];
const settled: DownloadActivity['items'] = [
  { itemId: 'a', sequence: 2, phase: 'saved', asset },
  { itemId: 'b', sequence: 1, phase: 'failed', reason: 'unavailable' },
];
const cardId = downloadActivityId(activity(waiting));

async function emit(
  messages: AgentMessage[],
  taskId: string,
): Promise<BaseEvent[]> {
  const emitter = new AGUIEmitter('thread-1', 'run-1', { taskId });
  const events: BaseEvent[] = [];
  for await (const event of emitter.transform(
    (async function* () {
      yield* messages;
    })(),
  )) {
    events.push(event);
  }
  return events;
}

const activityEvents = (events: BaseEvent[]) =>
  events.filter((e) => e.type === EventType.ACTIVITY_SNAPSHOT);

describe('media-download activity on the AG-UI stream', () => {
  it('emits a complete replacing snapshot keyed by run, call and batch', async () => {
    const events = activityEvents(
      await emit(
        [
          {
            type: 'media_download_activity',
            downloadActivity: activity(settled),
          },
        ],
        TASK_ID,
      ),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      messageId: cardId,
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      replace: true,
      content: activity(settled),
    });
    expect(downloadActivityEvent(activity(settled)).messageId).toBe(cardId);
  });

  it('drops an update for another task or another run', async () => {
    expect(
      activityEvents(
        await emit(
          [
            {
              type: 'media_download_activity',
              downloadActivity: activity(waiting, 'someone-else'),
            },
            {
              type: 'media_download_activity',
              downloadActivity: { ...activity(waiting), runId: 'run-2' },
            },
          ],
          TASK_ID,
        ),
      ),
    ).toHaveLength(0);
  });
});

describe('media-download activity persistence and history replay', () => {
  let home = '';
  const persister = () =>
    new AGUIEventPersister(TASK_ID, 'run-1', home, path.join(home, 'session'));
  const snapshot = (content: unknown, messageId = cardId) =>
    ({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId,
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      content,
    }) as unknown as BaseEvent;
  const rows = () =>
    getMessagesByTaskId(TASK_ID).filter((row) => row.type === 'activity');
  const replayed = () =>
    dbMessagesToFullAGUI(getMessagesByTaskId(TASK_ID)).filter(
      (m) => m.role === 'activity',
    );

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'neumar-download-activity-'));
    vi.stubEnv('HOME', home);
    closeDatabase();
    createSession({ id: 'session-download-activity', prompt: 'test' });
    createTask({
      id: TASK_ID,
      session_id: 'session-download-activity',
      task_index: 0,
      prompt: 'test',
      work_dir: home,
    });
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('stores one card and replays exactly what the live stream ended on', () => {
    const p = persister();
    p.handleEvent(snapshot(activity(waiting)));
    p.handleEvent(snapshot(activity(settled)));
    // Duplicate delivery changes nothing.
    p.handleEvent(snapshot(activity(settled)));

    expect(rows()).toHaveLength(1);
    expect(replayed()).toEqual([
      {
        id: cardId,
        role: 'activity',
        activityType: MEDIA_DOWNLOAD_ACTIVITY,
        content: activity(settled),
      },
    ]);
  });

  it('keeps a saved sibling when a stale snapshot or patch arrives late', () => {
    const p = persister();
    p.handleEvent(snapshot(activity(settled)));
    p.handleEvent(snapshot(activity(waiting)));
    p.handleEvent({
      type: EventType.ACTIVITY_DELTA,
      messageId: cardId,
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      patch: [
        { op: 'replace', path: '/items/0', value: waiting[0] },
        { op: 'replace', path: '/items/1', value: waiting[1] },
      ],
    } as unknown as BaseEvent);

    expect(replayed()[0]?.content).toEqual(activity(settled));
  });

  it('never stores a card for another task or under another id', () => {
    const p = persister();
    p.handleEvent(snapshot(activity(waiting, 'someone-else')));
    p.handleEvent(snapshot(activity(waiting), 'media-download:wrong'));

    expect(rows()).toHaveLength(0);
    expect(replayed()).toHaveLength(0);
  });

  it('replays nothing for a stored card that no longer parses', () => {
    persister().handleEvent(snapshot(activity(waiting)));
    // Simulate a row that predates or breaks the contract.
    getDatabase()
      .prepare(
        "UPDATE messages SET content = ? WHERE task_id = ? AND type = 'activity'",
      )
      .run(JSON.stringify({ taskId: TASK_ID, items: 'broken' }), TASK_ID);

    expect(replayed()).toHaveLength(0);
  });
});
