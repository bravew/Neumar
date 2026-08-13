import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import { createSession, createTask, deleteTask } from '@/shared/db/operations';
import {
  getProviderConversationState,
  upsertProviderConversationState,
} from '@/shared/db/provider-conversation-state';

const identity = {
  taskId: 'task-k3',
  providerId: 'moonshot-global',
  modelId: 'kimi-k3',
  workspaceRoot: '/workspace',
};

describe('provider conversation state', () => {
  beforeEach(() => {
    createSession({ id: 'session-k3', prompt: 'K3 state' });
    createTask({
      id: identity.taskId,
      session_id: 'session-k3',
      task_index: 0,
      prompt: 'K3 state',
    });
  });

  afterEach(() => {
    deleteTask(identity.taskId);
    getDatabase()
      .prepare('DELETE FROM sessions WHERE id = ?')
      .run('session-k3');
    closeDatabase();
  });

  it('round-trips the exact reasoning and tool envelope', () => {
    const messages = [
      { role: 'user' as const, content: 'Inspect the repo' },
      {
        role: 'assistant' as const,
        content: null,
        reasoning_content: 'I should read the file',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: { name: 'read_file', arguments: '{"path":"a"}' },
          },
        ],
      },
    ];
    upsertProviderConversationState(identity, messages);
    expect(getProviderConversationState(identity)?.messages).toEqual(messages);
  });

  it('invalidates state when the model identity changes', () => {
    upsertProviderConversationState(identity, [
      { role: 'user', content: 'hello' },
    ]);
    expect(
      getProviderConversationState({ ...identity, modelId: 'kimi-k3-next' }),
    ).toBeNull();
    expect(getProviderConversationState(identity)).toBeNull();
  });

  it('deletes state with its task', () => {
    upsertProviderConversationState(identity, [
      { role: 'user', content: 'hello' },
    ]);
    expect(deleteTask(identity.taskId)).toBe(true);
    expect(getProviderConversationState(identity)).toBeNull();
  });
});
