import { EventType } from '@ag-ui/core';
import {
  downloadActivityId,
  MEDIA_DOWNLOAD_ACTIVITY,
  type DownloadActivity,
} from '@neumar/video-ir';
import { afterEach, describe, expect, it } from 'vitest';

import type { Artifact } from '@/components/artifacts/types';
import { groupMessages } from '@/components/task/groupMessages';
import { appendOutputArtifactsItem } from '@/components/task/outputArtifactItems';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import { useThreadStore } from '@/shared/stores/thread-store';

const TASK = 'task-1';
const asset = { assetId: '101', name: 'clip.mp4', mime: 'video/mp4', size: 42 };
const activity = (items: DownloadActivity['items']): DownloadActivity => ({
  version: 1,
  taskId: TASK,
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

let seq = 0;
const apply = (content: unknown, messageId = cardId) =>
  useThreadStore.getState().applyAGUIEvent(TASK, {
    type: EventType.ACTIVITY_SNAPSHOT,
    seq: ++seq,
    messageId,
    activityType: MEDIA_DOWNLOAD_ACTIVITY,
    content,
  } as never);
const messages = () => useThreadStore.getState().threads[TASK]?.messages ?? [];

afterEach(() => {
  useThreadStore.setState({ threads: {} });
  seq = 0;
});

describe('media-download activity in the thread store', () => {
  it('keeps one card per batch and advances it item by item', () => {
    apply(activity(waiting));
    apply(activity(settled));
    apply(activity(settled));

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({
      id: cardId,
      role: 'activity',
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      content: activity(settled),
    });
  });

  it('keeps finished files when a stale snapshot arrives later', () => {
    apply(activity(settled));
    apply(activity(waiting));
    useThreadStore.getState().applyAGUIEvent(TASK, {
      type: EventType.ACTIVITY_DELTA,
      seq: ++seq,
      messageId: cardId,
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      patch: [{ op: 'replace', path: '/items/0', value: waiting[0] }],
    } as never);

    expect(messages()[0]?.content).toEqual(activity(settled));
  });

  it('does not let a same-length mirror rewind a finished download', () => {
    apply(activity(settled));
    const stale = {
      id: cardId,
      role: 'activity' as const,
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      content: activity(waiting),
    };

    useThreadStore.getState().setMessages(TASK, [stale] as never, true);

    expect(messages()).toHaveLength(1);
    expect(messages()[0]?.content).toEqual(activity(settled));
  });

  it('ignores a card for another task or under another id', () => {
    apply({ ...activity(waiting), taskId: 'someone-else' });
    apply(activity(waiting), 'media-download:wrong');

    expect(messages()).toHaveLength(0);
  });

  it('drops a foreign card from a reconnect snapshot', () => {
    useThreadStore.getState().applyAGUIEvent(TASK, {
      type: EventType.MESSAGES_SNAPSHOT,
      seq: ++seq,
      messages: [
        {
          id: cardId,
          role: 'activity',
          activityType: MEDIA_DOWNLOAD_ACTIVITY,
          content: activity(settled),
        },
        {
          id: 'media-download:other',
          role: 'activity',
          activityType: MEDIA_DOWNLOAD_ACTIVITY,
          content: { ...activity(settled), taskId: 'someone-else' },
        },
      ],
    } as never);

    expect(messages().map((m) => m.id)).toEqual([cardId]);
  });
});

describe('media-download card in the task thread', () => {
  const call = (name: string) => ({
    id: 'call-1',
    type: 'function' as const,
    function: { name, arguments: '{}' },
  });
  const thread = (toolName: string): AGUIMessage[] => [
    { id: 'u1', role: 'user', content: 'Download these' },
    { id: 'a1', role: 'assistant', toolCalls: [call(toolName)] },
    {
      id: cardId,
      role: 'activity',
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      content: activity(settled) as unknown as string,
    },
  ];

  it.each(['download_media', 'mcp__neumar__download_media'])(
    'renders one card and hides the raw %s tool call',
    (name) => {
      const items = groupMessages(thread(name), null, false);

      expect(items.map((i) => i.type)).toEqual(['message', 'download-widget']);
      expect(items[1]).toMatchObject({ key: cardId });
    },
  );

  it('still groups other tool calls and ignores a card that does not parse', () => {
    const items = groupMessages(
      [
        ...thread('Bash').slice(0, 2),
        {
          id: 'bad',
          role: 'activity',
          activityType: MEDIA_DOWNLOAD_ACTIVITY,
          content: { items: 'nope' } as unknown as string,
        },
      ],
      null,
      false,
    );

    expect(items.map((i) => i.type)).toEqual(['message', 'activity']);
  });

  it('does not preview a saved download a second time as a deliverable', () => {
    const items = groupMessages(thread('download_media'), null, false);
    const video = (id: string): Artifact => ({
      id,
      name: `${id}.mp4`,
      path: `/out/${id}.mp4`,
      type: 'video',
      isOutput: true,
    });

    const withOutputs = appendOutputArtifactsItem(items, [
      video('101'),
      video('202'),
    ]);
    const outputs = withOutputs.find((i) => i.type === 'output-artifacts');

    expect(outputs).toMatchObject({
      artifacts: [{ id: '202' }],
    });
  });
});
