import { describe, expect, it } from 'vitest';

import {
  acquireTaskRewind,
  acquireTaskRun,
  isTaskRewinding,
  TaskFileAccessConflictError,
} from '@/shared/services/task-file-access';

describe('task file access', () => {
  it('blocks a rewind while a run holds the task', () => {
    const taskId = crypto.randomUUID();
    using _run = acquireTaskRun(taskId);
    expect(() => acquireTaskRewind(taskId)).toThrow(
      TaskFileAccessConflictError,
    );
  });

  it('blocks a run while a rewind holds the task', () => {
    const taskId = crypto.randomUUID();
    using _rewind = acquireTaskRewind(taskId);
    expect(isTaskRewinding(taskId)).toBe(true);
    expect(() => acquireTaskRun(taskId)).toThrow(TaskFileAccessConflictError);
  });

  it('keeps the task locked until the last nested run releases it', () => {
    const taskId = crypto.randomUUID();
    const outer = acquireTaskRun(taskId);
    const inner = acquireTaskRun(taskId);
    inner[Symbol.dispose]();
    expect(() => acquireTaskRewind(taskId)).toThrow(
      TaskFileAccessConflictError,
    );
    outer[Symbol.dispose]();
    acquireTaskRewind(taskId)[Symbol.dispose]();
  });

  it('releases the rewind lock on dispose', () => {
    const taskId = crypto.randomUUID();
    acquireTaskRewind(taskId)[Symbol.dispose]();
    expect(isTaskRewinding(taskId)).toBe(false);
    acquireTaskRun(taskId)[Symbol.dispose]();
  });

  it('does not lock tasks when the run has no task', () => {
    const taskId = crypto.randomUUID();
    acquireTaskRun(undefined)[Symbol.dispose]();
    using _rewind = acquireTaskRewind(taskId);
    expect(isTaskRewinding(taskId)).toBe(true);
  });

  it('keeps tasks independent', () => {
    const rewoundTaskId = crypto.randomUUID();
    const otherTaskId = crypto.randomUUID();
    using _rewind = acquireTaskRewind(rewoundTaskId);
    acquireTaskRun(otherTaskId)[Symbol.dispose]();
  });
});
