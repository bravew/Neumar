import { describe, expect, it } from 'vitest';

import { prepareTaskRun } from '@/core/agent/prepare-task-run';
import { RunContextError } from '@/core/agent/run-context';

import {
  createSession,
  createTask,
  deleteTask,
  getAgentRun,
} from '@/shared/db/operations';

describe('prepareTaskRun', () => {
  it('reserves a durable run before returning', async () => {
    const sessionId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    createSession({ id: sessionId, prompt: 'Prepare run' });
    createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 0,
      prompt: 'Prepare run',
    });
    const first = await prepareTaskRun({
      taskId,
      prompt: 'Prepare run',
      provider: 'claude',
      runContext: { clientRequestId: 'req-1' },
    });
    expect(first.reservation?.disposition).toBe('created');
    expect(first.agentRunId).toBeTruthy();
    expect(getAgentRun(first.agentRunId!).status).toBe('running');

    const replay = await prepareTaskRun({
      taskId,
      prompt: 'Prepare run',
      provider: 'claude',
      runContext: { clientRequestId: 'req-1' },
    });
    expect(replay.reservation?.disposition).toBe('existing');
    expect(replay.agentRunId).toBe(first.agentRunId);
    deleteTask(taskId);
  });

  it('rejects a missing task', async () => {
    await expect(
      prepareTaskRun({
        taskId: crypto.randomUUID(),
        prompt: 'missing',
        provider: 'claude',
      }),
    ).rejects.toBeInstanceOf(RunContextError);
  });
});
