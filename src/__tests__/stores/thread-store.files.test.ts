import { EventType } from '@ag-ui/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { TaskFile } from '@/shared/stores/thread-store';
import { useThreadStore } from '@/shared/stores/thread-store';

const taskId = 'thread-store-files';

const imageFile: TaskFile = {
  id: 'file-1',
  taskId,
  name: 'image.png',
  path: '/tmp/session/output/image.png',
  kind: 'image',
  createdAt: '2026-05-17T00:00:00.000Z',
};

afterEach(() => {
  useThreadStore.setState({ threads: {} });
});

describe('thread-store file index', () => {
  it('upserts duplicate file ids without growing the index', () => {
    const store = useThreadStore.getState();
    store.upsertFile(taskId, imageFile);
    store.upsertFile(taskId, {
      ...imageFile,
      preview: 'updated',
    });

    const thread = useThreadStore.getState().threads[taskId];
    expect(thread.files).toHaveLength(1);
    expect(thread.files[0].preview).toBe('updated');
    expect(thread.filesIndexById).toEqual({ 'file-1': 0 });
  });

  it('applies STATE_SNAPSHOT and STATE_DELTA file patches', () => {
    const store = useThreadStore.getState();
    store.applyAGUIEvent(taskId, {
      type: EventType.STATE_SNAPSHOT,
      seq: 1,
      snapshot: { files: [imageFile] },
    });
    store.applyAGUIEvent(taskId, {
      type: EventType.STATE_DELTA,
      seq: 2,
      delta: [
        {
          op: 'add',
          path: '/files/-',
          value: {
            id: 'file-2',
            name: 'clip.mp4',
            path: '/tmp/session/output/clip.mp4',
            kind: 'video',
            createdAt: '2026-05-17T00:00:01.000Z',
          },
        },
      ],
    });

    expect(useThreadStore.getState().threads[taskId].files).toHaveLength(2);
  });

  it('hydrates messages without dropping an existing file index', () => {
    const store = useThreadStore.getState();
    store.setFiles(taskId, [imageFile]);
    store.hydrateFromDB(
      taskId,
      [{ id: 'msg-1', role: 'assistant', content: 'done' }],
      false,
    );

    expect(useThreadStore.getState().threads[taskId].files).toEqual([
      imageFile,
    ]);
  });
});
