import { describe, expect, it } from 'vitest';

import type { Message } from '@/shared/db/types';
import {
  dbMessagesToAGUI,
  toAgentSeedMessages,
} from '@/shared/lib/message-tree';

const sessionLimitMessage =
  "You've hit your session limit · resets 7pm (Asia/Shanghai)";

function message(id: number, patch: Partial<Message>): Message {
  return {
    id,
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
    message_id: `message-${id}`,
    cost: null,
    usage_input: null,
    usage_output: null,
    usage_cache_read: null,
    usage_cache_creation: null,
    model: null,
    created_at: '2026-10-05T10:00:00Z',
    ...patch,
  };
}

describe('message-tree persisted run errors', () => {
  it('restores an error row as a separate assistant error with its actual error message and subtype', () => {
    expect(
      dbMessagesToAGUI([
        message(1, { content: 'Partial answer' }),
        message(2, {
          type: 'error',
          content: 'Generic failure summary',
          error_message: sessionLimitMessage,
          subtype: 'rate_limit_error',
        }),
      ]),
    ).toEqual([
      { id: 'message-1', role: 'assistant', content: 'Partial answer' },
      {
        id: 'message-2',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
        subtype: 'rate_limit_error',
      },
    ]);
  });

  it('uses error content and the database id when dedicated error text and message id are absent', () => {
    expect(
      dbMessagesToAGUI([
        message(3, {
          type: 'error',
          content: sessionLimitMessage,
          message_id: null,
        }),
      ]),
    ).toEqual([
      {
        id: '3',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
        subtype: undefined,
      },
    ]);
  });

  it('keeps later prose separate from an error while still merging consecutive ordinary text blocks', () => {
    expect(
      dbMessagesToAGUI([
        message(1, { type: 'error', error_message: sessionLimitMessage }),
        message(2, { content: 'The retry ' }),
        message(3, { content: 'succeeded' }),
      ]),
    ).toEqual([
      {
        id: 'message-1',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
        subtype: undefined,
      },
      { id: 'message-2', role: 'assistant', content: 'The retry succeeded' },
    ]);
  });

  it('keeps subsequent tool calls off the persisted error message', () => {
    const messages = dbMessagesToAGUI([
      message(1, { type: 'error', error_message: sessionLimitMessage }),
      message(2, {
        type: 'tool_use',
        tool_use_id: 'write-1',
        tool_name: 'Write',
        tool_input: '{"file_path":"video.txt"}',
      }),
      message(3, {
        type: 'tool_result',
        tool_use_id: 'write-1',
        tool_output: 'File written',
      }),
    ]);

    expect(messages).toEqual([
      {
        id: 'message-1',
        role: 'assistant',
        content: sessionLimitMessage,
        isError: true,
        subtype: undefined,
      },
      {
        id: 'assistant_2',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'write-1',
            type: 'function',
            function: {
              name: 'Write',
              arguments: '{"file_path":"video.txt"}',
            },
          },
        ],
      },
      {
        id: 'write-1',
        role: 'tool',
        content: 'File written',
        toolCallId: 'write-1',
      },
    ]);
  });

  it('excludes persisted errors from the agent seed while preserving user and successful assistant prose', () => {
    const displayMessages = dbMessagesToAGUI([
      message(1, { type: 'user', content: 'Create a video' }),
      message(2, { type: 'error', error_message: sessionLimitMessage }),
      message(3, { content: '  The video is ready  ' }),
      message(4, {
        type: 'tool_use',
        tool_use_id: 'write-1',
        tool_name: 'Write',
      }),
      message(5, {
        type: 'tool_result',
        tool_use_id: 'write-1',
        tool_output: 'File written',
      }),
      message(6, { content: '  ' }),
    ]);

    expect(displayMessages.some((entry) => entry.isError)).toBe(true);
    expect(toAgentSeedMessages(displayMessages)).toEqual([
      { id: 'message-1', role: 'user', content: 'Create a video' },
      {
        id: 'message-3',
        role: 'assistant',
        content: '  The video is ready  ',
      },
    ]);
  });
});
