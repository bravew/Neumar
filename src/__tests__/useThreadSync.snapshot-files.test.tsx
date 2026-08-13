import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskFile } from '@/shared/stores/thread-store';
import { useThreadStore } from '@/shared/stores/thread-store';

vi.mock('@/config', () => ({
  API_BASE_URL: 'http://localhost:5126',
}));

const taskId = 'thread-sync-files';

function sseResponse(event: unknown): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
        controller.close();
      },
    }),
    {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    },
  );
}

describe('useThreadSync MESSAGES_SNAPSHOT files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThreadStore.setState({ threads: {} });
  });

  afterEach(() => {
    useThreadStore.setState({ threads: {} });
    vi.restoreAllMocks();
  });

  it('hydrates files carried by a reconnect snapshot', async () => {
    const file: TaskFile = {
      id: 'file-1',
      taskId,
      name: 'render.png',
      path: '/tmp/session/output/render.png',
      kind: 'image',
      createdAt: '2026-05-24T00:00:00.000Z',
      runId: 'run-1',
      role: 'output',
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      sseResponse({
        type: 'MESSAGES_SNAPSHOT',
        seq: 4,
        messages: [
          { id: 'assistant-1', role: 'assistant', content: 'Rendered.' },
        ],
        files: [file],
      }),
    );

    const { useThreadSync } = await import('@/shared/hooks/useThreadSync');
    const { unmount } = renderHook(() => useThreadSync(taskId));

    await waitFor(() => {
      const thread = useThreadStore.getState().threads[taskId];
      expect(thread?.messages).toHaveLength(1);
      expect(thread?.files).toEqual([file]);
      expect(thread?.lastAppliedSeq).toBe(4);
    });

    unmount();
  });
});
