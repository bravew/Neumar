import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Per-file isolated HOME — avoids racing other DB-touching tests on the
// shared global-setup tmpdir (migration runner UNIQUE-constraint conflicts).
process.env.HOME = mkdtempSync(join(tmpdir(), 'neumar-ar-'));

import {
  AgentRunConflictError,
  appendAgentRunEvent,
  createAgentRun,
  finishAgentRun,
  getAgentRunEventsAfter,
  getAgentRunsByTaskId,
  reconcileOrphanedAgentRuns,
  reserveAgentRun,
  updateAgentRunAttempt,
} from '@/shared/db/operations';

describe('agent_runs ops', () => {
  const taskId = `task-${crypto.randomUUID()}`;
  let runIds: string[] = [];

  beforeEach(() => {
    runIds = [];
  });

  afterEach(() => {
    // Best-effort teardown — leaves rows for cross-test debugging if needed.
  });

  it('inserts a root run and finalizes it', () => {
    const id = crypto.randomUUID();
    runIds.push(id);
    createAgentRun({
      id,
      taskId,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    });

    const before = getAgentRunsByTaskId(taskId).find((r) => r.id === id);
    expect(before?.status).toBe('running');
    expect(before?.provider).toBe('claude');
    expect(before?.parent_run_id).toBeNull();

    finishAgentRun({
      id,
      status: 'completed',
      costUsd: 0.42,
      tokensIn: 1234,
      tokensOut: 567,
    });

    const after = getAgentRunsByTaskId(taskId).find((r) => r.id === id);
    expect(after?.status).toBe('completed');
    expect(after?.cost_usd).toBeCloseTo(0.42);
    expect(after?.tokens_in).toBe(1234);
    expect(after?.tokens_out).toBe(567);
    expect(after?.finished_at).not.toBeNull();
  });

  it('links subagent rows to their parent', () => {
    const parentId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    runIds.push(parentId, childId);
    createAgentRun({ id: parentId, taskId, provider: 'claude' });
    createAgentRun({
      id: childId,
      taskId: `${taskId}-sub`,
      parentRunId: parentId,
      provider: 'codex',
    });

    const child = getAgentRunsByTaskId(`${taskId}-sub`).find(
      (r) => r.id === childId,
    );
    expect(child?.parent_run_id).toBe(parentId);
    expect(child?.provider).toBe('codex');
    expect(child?.execution_id).toBe(parentId);
    expect(child?.initial_run_id).toBe(parentId);
    expect(child?.run_index).toBeNull();
  });

  it('createAgentRun is idempotent on duplicate id (INSERT OR IGNORE)', () => {
    const id = crypto.randomUUID();
    runIds.push(id);
    createAgentRun({ id, taskId, provider: 'claude' });
    // Second insert with the same id should not throw nor double-write.
    createAgentRun({ id, taskId, provider: 'codex' });
    const rows = getAgentRunsByTaskId(taskId).filter((r) => r.id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe('claude'); // first write wins
  });

  it('reserves a request once and reuses it only for the same message seed', () => {
    const ownerKey = `task-${crypto.randomUUID()}`;
    const input = {
      runId: crypto.randomUUID(),
      mode: 'task' as const,
      ownerKey,
      projectId: null,
      conversationId: ownerKey,
      clientRequestId: crypto.randomUUID(),
      requestMessageId: crypto.randomUUID(),
      messageContent: 'Inspect the repository\r\n',
      provider: 'claude',
    };

    expect(reserveAgentRun(input)).toMatchObject({
      disposition: 'created',
      run: { id: input.runId, run_index: 0 },
    });
    expect(
      reserveAgentRun({ ...input, runId: crypto.randomUUID() }),
    ).toMatchObject({
      disposition: 'existing',
      run: { id: input.runId },
    });
    expect(
      reserveAgentRun({
        ...input,
        runId: crypto.randomUUID(),
        requestMessageId: crypto.randomUUID(),
      }),
    ).toMatchObject({
      disposition: 'existing',
      run: { id: input.runId },
    });
    expect(() =>
      reserveAgentRun({
        ...input,
        runId: crypto.randomUUID(),
        messageContent: 'Different request',
      }),
    ).toThrow(AgentRunConflictError);
  });

  it('allocates recovery lineage separately from subagent parentage', () => {
    const ownerKey = `task-${crypto.randomUUID()}`;
    const initialRunId = crypto.randomUUID();
    const initial = reserveAgentRun({
      runId: initialRunId,
      mode: 'task',
      ownerKey,
      projectId: null,
      conversationId: ownerKey,
      clientRequestId: crypto.randomUUID(),
      requestMessageId: crypto.randomUUID(),
      messageContent: 'First attempt',
      provider: 'claude',
    });
    expect(initial.disposition).toBe('created');
    finishAgentRun({ id: initialRunId, status: 'failed' });

    const recoveryRunId = crypto.randomUUID();
    const recovery = reserveAgentRun({
      runId: recoveryRunId,
      mode: 'task',
      ownerKey,
      projectId: null,
      conversationId: ownerKey,
      clientRequestId: crypto.randomUUID(),
      requestMessageId: crypto.randomUUID(),
      messageContent: 'Try again',
      provider: 'claude',
      recovery: {
        executionId: initialRunId,
        sourceRunId: initialRunId,
        action: 'retry',
      },
    });

    expect(recovery).toMatchObject({
      disposition: 'created',
      run: {
        id: recoveryRunId,
        execution_id: initialRunId,
        initial_run_id: initialRunId,
        source_run_id: initialRunId,
        run_index: 1,
        recovery_action: 'retry',
        parent_run_id: null,
      },
    });
  });

  it('stores canonical verdict fields and keeps terminal status monotonic', () => {
    const id = crypto.randomUUID();
    createAgentRun({ id, taskId, provider: 'claude', attempt: 0 });
    finishAgentRun({
      id,
      status: 'cancelled',
      completeness: 'unfinished',
      delivery: 'not_expected',
      retry: 'not_safe',
      failureCause: 'cancelled',
    });
    finishAgentRun({
      id,
      status: 'failed',
      completeness: 'unfinished',
      delivery: 'failed',
      retry: 'user_action',
      failureCause: 'late_error',
    });

    expect(
      getAgentRunsByTaskId(taskId).find((row) => row.id === id),
    ).toMatchObject({
      status: 'cancelled',
      completeness: 'unfinished',
      delivery: 'not_expected',
      retry: 'not_safe',
      failure_cause: 'cancelled',
    });
  });

  it('journals an exact event once and rejects a mismatched duplicate', () => {
    const ownerKey = `design-${crypto.randomUUID()}`;
    const runId = crypto.randomUUID();
    reserveAgentRun({
      runId,
      mode: 'design',
      ownerKey,
      projectId: ownerKey,
      conversationId: null,
      clientRequestId: crypto.randomUUID(),
      requestMessageId: crypto.randomUUID(),
      messageContent: 'Create a poster',
      provider: 'claude',
    });
    const event = { type: 'RUN_STARTED', runId, seq: 0 };

    appendAgentRunEvent({
      runId,
      seq: 0,
      eventType: event.type,
      event,
    });
    appendAgentRunEvent({
      runId,
      seq: 0,
      eventType: event.type,
      event,
    });

    expect(getAgentRunEventsAfter(runId, -1)).toMatchObject([
      { run_id: runId, seq: 0, event_type: 'RUN_STARTED' },
    ]);
    expect(() =>
      appendAgentRunEvent({
        runId,
        seq: 0,
        eventType: 'RUN_ERROR',
        event: { type: 'RUN_ERROR', runId, seq: 0 },
      }),
    ).toThrow(AgentRunConflictError);
  });

  it('records a retry attempt only while the run is active', () => {
    const id = crypto.randomUUID();
    createAgentRun({ id, taskId, provider: 'claude' });
    updateAgentRunAttempt(id, 1);
    expect(
      getAgentRunsByTaskId(taskId).find((row) => row.id === id)?.attempt,
    ).toBe(1);
    finishAgentRun({ id, status: 'failed' });
    updateAgentRunAttempt(id, 2);
    expect(
      getAgentRunsByTaskId(taskId).find((row) => row.id === id)?.attempt,
    ).toBe(1);
  });

  it('reconciles orphaned running rows as failures after restart', () => {
    const id = crypto.randomUUID();
    createAgentRun({ id, taskId, provider: 'codex' });
    expect(reconcileOrphanedAgentRuns()).toBeGreaterThan(0);
    expect(
      getAgentRunsByTaskId(taskId).find((row) => row.id === id),
    ).toMatchObject({
      status: 'failed',
      completeness: 'unfinished',
      retry: 'user_action',
      failure_cause: 'process_restarted',
    });
  });
});
