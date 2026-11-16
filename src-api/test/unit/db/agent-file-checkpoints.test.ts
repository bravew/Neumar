import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  getAgentFileCheckpoint,
  recordAgentFileCheckpoint,
} from '@/shared/db/agent-file-checkpoints';
import { createSession, createTask, deleteTask } from '@/shared/db/operations';

const sessionId = crypto.randomUUID();
const taskId = crypto.randomUUID();

function insertUserMessage(): number {
  const result = getDatabase()
    .prepare(
      `INSERT INTO messages (task_id, type, content, run_id, branch_id)
       VALUES (?, 'user', 'edit', 'run-1', 'main')`,
    )
    .run(taskId);
  return Number(result.lastInsertRowid);
}

describe('agent file checkpoints', () => {
  beforeEach(() => {
    createSession({ id: sessionId, prompt: 'Checkpoints' });
    createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 0,
      prompt: 'p',
    });
  });

  afterEach(() => {
    deleteTask(taskId);
    getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    closeDatabase();
  });

  it('keeps the first checkpoint when a retried turn records another', () => {
    const messageRowId = insertUserMessage();
    const firstUuid = crypto.randomUUID();
    recordAgentFileCheckpoint({
      taskId,
      messageRowId,
      userMessageId: firstUuid,
      sdkSessionId: 'sdk-first',
      cwd: '/work/first',
    });

    recordAgentFileCheckpoint({
      taskId,
      messageRowId,
      userMessageId: crypto.randomUUID(),
      sdkSessionId: 'sdk-retry',
      cwd: '/work/retry',
    });

    expect(getAgentFileCheckpoint(taskId, firstUuid)).toMatchObject({
      messageRowId,
      sdkSessionId: 'sdk-first',
      cwd: '/work/first',
    });
    expect(
      getDatabase()
        .prepare('SELECT COUNT(*) AS count FROM agent_file_checkpoints')
        .get(),
    ).toEqual({ count: 1 });
  });
});
