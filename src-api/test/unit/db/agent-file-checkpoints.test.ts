import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  getAgentFileCheckpoint,
  listAgentFileCheckpoints,
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

  it('records every attempt of a retried turn in attempt order', () => {
    const messageRowId = insertUserMessage();
    const firstUuid = crypto.randomUUID();
    const retryUuid = crypto.randomUUID();
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
      userMessageId: retryUuid,
      sdkSessionId: 'sdk-retry',
      cwd: '/work/retry',
    });

    expect(listAgentFileCheckpoints(taskId)).toEqual([
      {
        taskId,
        messageRowId,
        userMessageId: firstUuid,
        sdkSessionId: 'sdk-first',
        cwd: '/work/first',
      },
      {
        taskId,
        messageRowId,
        userMessageId: retryUuid,
        sdkSessionId: 'sdk-retry',
        cwd: '/work/retry',
      },
    ]);
    expect(getAgentFileCheckpoint(taskId, firstUuid)).toMatchObject({
      sdkSessionId: 'sdk-first',
      cwd: '/work/first',
    });
    expect(getAgentFileCheckpoint(taskId, retryUuid)).toMatchObject({
      sdkSessionId: 'sdk-retry',
      cwd: '/work/retry',
    });
  });

  it('ignores a repeated record for the same SDK message', () => {
    const messageRowId = insertUserMessage();
    const userMessageId = crypto.randomUUID();
    for (const sdkSessionId of ['sdk-first', 'sdk-second']) {
      recordAgentFileCheckpoint({
        taskId,
        messageRowId,
        userMessageId,
        sdkSessionId,
        cwd: '/work',
      });
    }

    expect(listAgentFileCheckpoints(taskId)).toHaveLength(1);
    expect(getAgentFileCheckpoint(taskId, userMessageId)).toMatchObject({
      sdkSessionId: 'sdk-first',
    });
  });

  it('keeps attempts of different turns in row order', () => {
    const firstRowId = insertUserMessage();
    const secondRowId = insertUserMessage();
    recordAgentFileCheckpoint({
      taskId,
      messageRowId: secondRowId,
      userMessageId: crypto.randomUUID(),
      sdkSessionId: 'sdk-second',
      cwd: '/work',
    });
    recordAgentFileCheckpoint({
      taskId,
      messageRowId: firstRowId,
      userMessageId: crypto.randomUUID(),
      sdkSessionId: 'sdk-first',
      cwd: '/work',
    });

    expect(
      listAgentFileCheckpoints(taskId).map((row) => row.sdkSessionId),
    ).toEqual(['sdk-first', 'sdk-second']);
  });
});
