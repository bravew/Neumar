import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message, Task } from '@/shared/db';
import {
  createMessage,
  deleteMessagesAfter,
  getMessagesByTaskId,
  getTask,
  updateTask,
} from '@/shared/db';
import { useAgent } from '@/shared/hooks/useAgent';

const dbMocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  createTask: vi.fn(),
  deleteMessagesAfter: vi.fn(),
  getMessagesByTaskId: vi.fn(),
  getTask: vi.fn(),
  updateMessageContent: vi.fn(),
  updateTask: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(() => ({
    allowedFolders: undefined,
    defaultProvider: 'default',
    language: 'en-US',
    maxConversationTurns: 20,
    mcpEnabled: false,
    planMode: 'off',
    providers: [],
    sandboxEnabled: false,
    skillsEnabled: false,
    workDir: '/tmp/neuma-test',
  })),
}));

vi.mock('@/shared/db', () => dbMocks);
vi.mock('@/shared/db/settings', () => settingsMocks);
vi.mock('@/shared/hooks/useRuntimeContext', () => ({
  useRuntimeContext: () => ({
    context: { locale: 'en-US', timezone: 'UTC' },
    refreshGeolocation: vi.fn(),
  }),
}));
vi.mock('@/shared/lib/notifications', () => ({
  notifyAgentEvent: vi.fn(),
}));

describe('useAgent retry de-duplication', () => {
  beforeEach(() => {
    vi.mocked(createMessage).mockResolvedValue(dbMessage({ id: 99 }));
    vi.mocked(deleteMessagesAfter).mockResolvedValue(2);
    vi.mocked(getMessagesByTaskId).mockResolvedValue([]);
    vi.mocked(getTask).mockResolvedValue(task());
    vi.mocked(updateTask).mockResolvedValue(task());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('retries the last user turn without appending or persisting a duplicate', async () => {
    const failedRows = [
      dbMessage({ id: 1, type: 'user', content: 'Build app' }),
      dbMessage({ id: 2, type: 'text', content: 'partial failed answer' }),
      dbMessage({ id: 3, type: 'error', error_message: 'Server error: 500' }),
    ];
    vi.mocked(getMessagesByTaskId).mockResolvedValue(failedRows);
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sseResponse(
        'data: {"type":"text","content":"retry ok"}\n\ndata: {"type":"done"}\n\n',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAgent());
    await act(async () => {
      await result.current.loadTask('task-1');
      await result.current.loadMessages('task-1');
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(3));

    await act(async () => {
      await result.current.continueConversation(
        'Build app',
        undefined,
        undefined,
        undefined,
        undefined,
        { retry: true },
      );
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      content: 'Build app',
      type: 'user',
    });
    expect(result.current.messages[1]).toEqual({
      content: 'retry ok',
      type: 'text',
    });
    expect(
      result.current.messages.some((message) => message.type === 'error'),
    ).toBe(false);
    expect(deleteMessagesAfter).toHaveBeenCalledWith('task-1', 1);
    expect(createMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Build app',
        task_id: 'task-1',
        type: 'user',
      }),
    );

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(JSON.stringify(body.conversation)).not.toContain(
      'partial failed answer',
    );
  });

  it('continues with new input by appending and persisting a user message', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sseResponse(
        'data: {"type":"text","content":"done"}\n\ndata: {"type":"done"}\n\n',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useAgent());
    await act(async () => {
      await result.current.loadTask('task-1');
      await result.current.loadMessages('task-1');
    });
    await waitFor(() => expect(result.current.taskId).toBe('task-1'));

    await act(async () => {
      await result.current.continueConversation('Add button');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      content: 'Add button',
      type: 'user',
    });
    expect(result.current.messages[1]).toEqual({
      content: 'done',
      type: 'text',
    });
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Add button',
        task_id: 'task-1',
        type: 'user',
      }),
    );
    expect(deleteMessagesAfter).not.toHaveBeenCalled();
  });
});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    session_id: '',
    task_index: 1,
    prompt: 'Build app',
    title: null,
    work_dir: '/tmp/neuma-test/task-1',
    additional_work_dirs: null,
    status: 'error',
    cost: null,
    duration: null,
    favorite: false,
    assignee_profile_id: null,
    created_at: '2026-05-25T00:00:00.000Z',
    updated_at: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

function dbMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    task_id: 'task-1',
    type: 'text',
    content: null,
    tool_name: null,
    tool_input: null,
    tool_output: null,
    tool_use_id: null,
    subtype: null,
    error_message: null,
    attachments: null,
    message_id: null,
    cost: null,
    usage_input: null,
    usage_output: null,
    usage_cache_read: null,
    usage_cache_creation: null,
    model: null,
    branch_id: 'main',
    parent_message_id: null,
    created_at: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

function sseResponse(data: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(data));
        controller.close();
      },
    }),
    {
      headers: { 'Content-Type': 'text/event-stream' },
      status: 200,
    },
  );
}
