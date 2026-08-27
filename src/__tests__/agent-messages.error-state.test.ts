import { describe, expect, it } from 'vitest';

import type { Message } from '@/shared/db/types';
import { mapDbMessageToAgentMessage } from '@/shared/hooks/agent-messages';

describe('tool result error persistence', () => {
  it('restores isError from the SQLite message row', () => {
    expect(mapDbMessageToAgentMessage(message({ is_error: 1 })).isError).toBe(
      true,
    );
    expect(mapDbMessageToAgentMessage(message({ is_error: 0 })).isError).toBe(
      false,
    );
  });
});

function message(patch: Partial<Message>): Message {
  return {
    id: 1,
    task_id: 'task-1',
    type: 'tool_result',
    content: null,
    tool_name: null,
    tool_input: null,
    tool_output: '{"error":"failed"}',
    tool_use_id: 'tool-1',
    subtype: null,
    error_message: null,
    attachments: null,
    message_id: 'message-1',
    cost: null,
    usage_input: null,
    usage_output: null,
    usage_cache_read: null,
    usage_cache_creation: null,
    model: null,
    created_at: '2026-08-25T00:00:00.000Z',
    ...patch,
  };
}
