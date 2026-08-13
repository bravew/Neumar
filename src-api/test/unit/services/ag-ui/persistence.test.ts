import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EventType } from '@ag-ui/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyRunFailure } from '@/core/agent/error-retry';
import { adaptRunFailure } from '@/core/agent/runtime-state';

import { closeDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getAgentRun,
  getAgentRunEventsAfter,
  getAgentRunsByTaskId,
  getFilesByTaskId,
  getTask,
} from '@/shared/db/operations';
import { buildExecutionDiagnostics } from '@/shared/observability/execution-diagnostics';
import { listTraceEvents } from '@/shared/observability/trace';
import {
  journalAGUIEvent,
  replayAGUIEvents,
} from '@/shared/services/ag-ui/journal';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';

let tempHome = '';

function createTaskFixture() {
  const workspaceRoot = path.join(tempHome, '_Neumar');
  const sessionCwd = path.join(workspaceRoot, 'sessions', 'session-current');
  const taskId = 'task-media-output-classification';
  const sessionId = 'session-media-output-classification';

  createSession({ id: sessionId, prompt: 'test' });
  createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: 'test',
    work_dir: workspaceRoot,
  });

  return { sessionCwd, taskId, workspaceRoot };
}

describe('AGUIEventPersister persistence', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neuma-agui-persist-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('ignores source media paths while keeping generated output paths', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const oldSource = path.join(
      workspaceRoot,
      'sessions',
      'session-old',
      'BLAZE_Trailer_v2.mp4',
    );
    const stagedSource = path.join(
      sessionCwd,
      'attachments',
      'BLAZE_Trailer_v2.mp4',
    );
    const outputPath = path.join(
      sessionCwd,
      'output',
      'BLAZE_Trailer_v2_1080p.mp4',
    );
    const persister = new AGUIEventPersister(
      taskId,
      'run-1',
      workspaceRoot,
      sessionCwd,
    );

    persister.handleEvent({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: 'tool-1',
      content: [
        oldSource,
        `**Media Info: ${stagedSource}**`,
        `Output: \`${outputPath}\``,
      ].join('\n'),
    } as never);

    expect(getFilesByTaskId(taskId).map((file) => file.path)).toEqual([
      outputPath,
    ]);
  });

  it('keeps explicitly saved files even when they are outside output directories', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const outputPath = path.join(sessionCwd, 'final.mp4');
    const persister = new AGUIEventPersister(
      taskId,
      'run-1',
      workspaceRoot,
      sessionCwd,
    );

    persister.handleEvent({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: 'tool-1',
      content: `Saved to: ${outputPath}`,
    } as never);

    expect(getFilesByTaskId(taskId).map((file) => file.path)).toEqual([
      outputPath,
    ]);
  });

  it('finalizes user-cancelled runs as cancelled', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const persister = new AGUIEventPersister(
      taskId,
      'run-cancelled',
      workspaceRoot,
      sessionCwd,
    );

    persister.handleEvent({ type: EventType.RUN_STARTED } as never);
    persister.handleEvent({
      type: EventType.RUN_ERROR,
      message: 'Run stopped by user',
      code: 'USER_CANCELLED',
    } as never);

    expect(getAgentRunsByTaskId(taskId)).toMatchObject([
      {
        id: 'run-cancelled',
        status: 'cancelled',
        error: 'Run stopped by user',
      },
    ]);
    expect(getTask(taskId)?.status).toBe('stopped');

    persister.handleEvent({
      type: EventType.RUN_ERROR,
      message: 'late child process failure',
      code: 'LATE_ERROR',
    } as never);
    expect(getAgentRunsByTaskId(taskId)[0]).toMatchObject({
      status: 'cancelled',
      failure_cause: 'cancelled',
    });
  });

  it('does not report success while declared plan work is unfinished', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const persister = new AGUIEventPersister(
      taskId,
      'run-unfinished',
      workspaceRoot,
      sessionCwd,
    );

    persister.handleEvent({ type: EventType.RUN_STARTED } as never);
    persister.handleEvent({
      type: EventType.CUSTOM,
      name: 'plan',
      value: { steps: [{ status: 'pending' }] },
    } as never);
    persister.handleEvent({ type: EventType.RUN_FINISHED } as never);

    expect(getAgentRunsByTaskId(taskId)[0]).toMatchObject({
      status: 'failed',
      completeness: 'unfinished',
      retry: 'user_action',
      failure_cause: 'unfinished_declared_work',
    });
  });

  it('records artifact delivery independently from process success', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const persister = new AGUIEventPersister(
      taskId,
      'run-delivery',
      workspaceRoot,
      sessionCwd,
    );
    const outputPath = path.join(sessionCwd, 'output', 'result.html');

    persister.handleEvent({ type: EventType.RUN_STARTED } as never);
    persister.handleEvent({
      type: EventType.TOOL_CALL_START,
      toolCallId: 'write-1',
      toolCallName: 'Write',
    } as never);
    persister.handleEvent({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: 'write-1',
      delta: JSON.stringify({ file_path: outputPath, content: '<h1>Hi</h1>' }),
    } as never);
    persister.handleEvent({
      type: EventType.TOOL_CALL_END,
      toolCallId: 'write-1',
    } as never);
    persister.handleEvent({ type: EventType.RUN_FINISHED } as never);

    expect(getAgentRunsByTaskId(taskId)[0]).toMatchObject({
      status: 'completed',
      completeness: 'complete',
      delivery: 'delivered',
    });
  });

  it('records classified failure metadata in run-error traces', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const persister = new AGUIEventPersister(
      taskId,
      'run-auth-error',
      workspaceRoot,
      sessionCwd,
    );

    persister.handleEvent({ type: EventType.RUN_STARTED } as never);
    persister.handleEvent({
      type: EventType.RUN_ERROR,
      message: 'Invalid API key',
      code: 'AUTH_FAILED',
    } as never);

    const modelTrace = listTraceEvents(taskId).find(
      (event) => event.kind === 'model_call',
    );
    expect(modelTrace?.status).toBe('error');
    expect(JSON.parse(modelTrace?.attrs_json ?? '{}')).toMatchObject({
      failureCause: 'auth',
      retryDisposition: 'hitl_required',
      recoveryAction: 'configure_auth',
    });
    expect(JSON.parse(modelTrace?.error_json ?? '{}')).toMatchObject({
      failure: { cause: 'auth', recoveryAction: { type: 'configure_auth' } },
    });
  });

  it('derives the same verdict from live and persisted failure events', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const message = 'network timeout';
    const classification = classifyRunFailure({ message });
    const live = adaptRunFailure('task', classification.cause, 'safe_once');
    const persister = new AGUIEventPersister(
      taskId,
      'run-replay-parity',
      workspaceRoot,
      sessionCwd,
    );

    persister.handleEvent({ type: EventType.RUN_STARTED } as never);
    persister.handleEvent({
      type: EventType.RUN_ERROR,
      message,
    } as never);

    const persisted = getAgentRunsByTaskId(taskId)[0];
    expect({
      process: persisted?.status,
      completeness: persisted?.completeness,
      delivery: persisted?.delivery,
      retry: persisted?.retry,
      failureCause: persisted?.failure_cause,
    }).toEqual({
      process: 'failed',
      completeness: live.verdict.completeness,
      delivery: live.verdict.delivery,
      retry: live.verdict.retry,
      failureCause: live.verdict.failureCause,
    });
  });

  it('derives identical diagnostics from live and replayed AG-UI evidence', () => {
    const { sessionCwd, taskId, workspaceRoot } = createTaskFixture();
    const runId = 'run-diagnostics-replay';
    const persister = new AGUIEventPersister(
      taskId,
      runId,
      workspaceRoot,
      sessionCwd,
    );
    const fixture = [
      { type: EventType.RUN_STARTED, seq: 0 },
      {
        type: EventType.TOOL_CALL_START,
        seq: 1,
        toolCallId: 'read-1',
        toolCallName: 'Read',
      },
      {
        type: EventType.TOOL_CALL_END,
        seq: 2,
        toolCallId: 'read-1',
      },
      {
        type: EventType.TOOL_CALL_RESULT,
        seq: 3,
        toolCallId: 'read-1',
        content: 'redacted fixture output',
      },
      { type: EventType.RUN_FINISHED, seq: 4 },
    ] as const;
    for (const event of fixture) {
      persister.handleEvent(event as never);
      journalAGUIEvent(runId, event as never);
    }

    const run = getAgentRun(runId)!;
    const traces = listTraceEvents(taskId).filter(
      (trace) => trace.session_id === runId,
    );
    const collectedAt = '2026-01-01T00:00:00.000Z';
    const live = buildExecutionDiagnostics(
      run,
      getAgentRunEventsAfter(runId, -1),
      traces,
      collectedAt,
    );
    const replayedRows = replayAGUIEvents(runId, -1).map((event, index) => ({
      run_id: runId,
      seq: (event as { seq: number }).seq,
      event_type: event.type,
      event_json: JSON.stringify(event),
      created_at: `2026-01-01T00:00:0${index}.000Z`,
    }));
    const replayed = buildExecutionDiagnostics(
      run,
      replayedRows,
      traces,
      collectedAt,
    );

    expect(replayed).toEqual(live);
    expect(replayed.artifactDelivery.verdict).toEqual(
      live.artifactDelivery.verdict,
    );
  });
});
