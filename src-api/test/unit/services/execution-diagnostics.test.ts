import { describe, expect, it } from 'vitest';

import type { AgentRunEventRow, AgentRunRow } from '@/shared/db/operations';
import {
  buildExecutionDiagnostics,
  ExecutionDiagnosticsV1Schema,
} from '@/shared/observability/execution-diagnostics';
import type { TraceEvent } from '@/shared/observability/trace';

function run(partial: Partial<AgentRunRow> = {}): AgentRunRow {
  return {
    id: 'run-1',
    task_id: 'task-1',
    parent_run_id: null,
    provider: 'codex',
    status: 'completed',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:01.000Z',
    cost_usd: 0,
    tokens_in: 0,
    tokens_out: 0,
    model: 'gpt-5',
    error: null,
    completeness: 'complete',
    delivery: 'delivered',
    retry: 'not_safe',
    failure_cause: null,
    runtime_version: '1.0.0',
    attempt: 0,
    session_handle_kind: null,
    invalidation_reason: null,
    mode: 'task',
    owner_key: 'task-1',
    project_id: null,
    conversation_id: 'task-1',
    client_request_id: 'request-1',
    request_message_id: 'message-1',
    execution_id: 'execution-1',
    initial_run_id: 'run-1',
    source_run_id: null,
    run_index: 0,
    recovery_action: null,
    delivery_reconciliation_deadline: null,
    ...partial,
  };
}

function event(
  seq: number,
  eventType: string,
  value: Record<string, unknown> = {},
): AgentRunEventRow {
  return {
    run_id: 'run-1',
    seq,
    event_type: eventType,
    event_json: JSON.stringify({ type: eventType, seq, ...value }),
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function trace(partial: Partial<TraceEvent>): TraceEvent {
  return {
    id: crypto.randomUUID(),
    task_id: 'task-1',
    session_id: 'run-1',
    message_id: null,
    parent_event_id: null,
    kind: 'model_call',
    agent: 'codex',
    provider: 'codex',
    model: 'gpt-5',
    profile: null,
    tool: null,
    status: 'ok',
    started_at: 100,
    ended_at: 120,
    duration_ms: 20,
    input_tokens: null,
    output_tokens: null,
    cache_read: null,
    cache_creation: null,
    cost_usd: null,
    attrs_json: null,
    error_json: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('execution diagnostics', () => {
  it('distinguishes measured zeroes from unavailable provider metrics', () => {
    const diagnostics = buildExecutionDiagnostics(
      run(),
      [event(0, 'RUN_STARTED'), event(1, 'RUN_FINISHED')],
      [
        trace({
          input_tokens: 0,
          output_tokens: 0,
          cache_read: 0,
          cache_creation: null,
          cost_usd: 0,
        }),
      ],
    );

    expect(diagnostics.usage.cacheReadTokens).toMatchObject({
      state: 'available',
      value: 0,
      evidence: 'measured',
    });
    expect(diagnostics.usage.cacheCreationTokens).toMatchObject({
      state: 'upstream_unavailable',
    });
    expect(ExecutionDiagnosticsV1Schema.safeParse(diagnostics).success).toBe(
      true,
    );
  });

  it('marks partial journals and unmatched tools incomplete', () => {
    const diagnostics = buildExecutionDiagnostics(
      run(),
      [
        event(0, 'RUN_STARTED'),
        event(2, 'TOOL_CALL_START', {
          toolCallId: 'tool-1',
          toolCallName: 'Read',
          args: { path: '/private/project/secret.txt' },
        }),
      ],
      [],
    );

    expect(diagnostics.eventStreamCompleteness).toBe('partial');
    expect(diagnostics.tools.total).toMatchObject({
      state: 'available',
      value: 1,
      complete: false,
    });
    expect(diagnostics.tools.succeeded).toMatchObject({ value: 0 });
  });

  it('keeps an in-progress contiguous journal partial until terminal evidence', () => {
    const diagnostics = buildExecutionDiagnostics(
      run({ status: 'running', finished_at: null }),
      [event(0, 'RUN_STARTED')],
      [],
    );
    expect(diagnostics.eventStreamCompleteness).toBe('partial');
  });

  it('returns only allowlisted summaries and never raw payloads or trace attributes', () => {
    const secret = 'sk-super-secret';
    const diagnostics = buildExecutionDiagnostics(
      run({ error: `failed at /Users/me/private with ${secret}` }),
      [
        event(0, 'RUN_STARTED', { prompt: `open /etc/passwd ${secret}` }),
        event(1, 'TOOL_CALL_START', {
          toolCallId: 'tool-1',
          toolCallName: 'Shell',
          args: { env: { API_KEY: secret }, command: 'cat /etc/passwd' },
        }),
        event(2, 'TOOL_CALL_RESULT', {
          toolCallId: 'tool-1',
          content: secret,
        }),
        event(3, 'RUN_FINISHED'),
      ],
      [
        trace({
          attrs_json: JSON.stringify({ prompt: secret, path: '/etc/passwd' }),
        }),
      ],
    );
    const serialized = JSON.stringify(diagnostics);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('/etc/passwd');
    expect(serialized).not.toContain('API_KEY');
    expect(serialized).not.toContain('command');
  });

  it('counts completed and failed tools without exposing results', () => {
    const diagnostics = buildExecutionDiagnostics(
      run(),
      [
        event(0, 'RUN_STARTED'),
        event(1, 'TOOL_CALL_START', {
          toolCallId: 'a',
          toolCallName: 'Read',
        }),
        event(2, 'TOOL_CALL_RESULT', { toolCallId: 'a' }),
        event(3, 'TOOL_CALL_START', {
          toolCallId: 'b',
          toolCallName: 'Write',
        }),
        event(4, 'TOOL_CALL_RESULT', { toolCallId: 'b', isError: true }),
        event(5, 'RUN_FINISHED'),
      ],
      [],
    );

    expect(diagnostics.tools.succeeded).toMatchObject({
      value: 1,
      complete: true,
    });
    expect(diagnostics.tools.failed).toMatchObject({
      value: 1,
      complete: true,
    });
    expect(diagnostics.tools.byName).toMatchObject({
      value: { Read: 1, Write: 1 },
    });
  });

  it('marks a terminal stream with an orphan tool result incomplete', () => {
    const diagnostics = buildExecutionDiagnostics(
      run(),
      [
        event(0, 'RUN_STARTED'),
        event(1, 'TOOL_CALL_RESULT', { toolCallId: 'missing-start' }),
        event(2, 'RUN_FINISHED'),
      ],
      [],
    );

    expect(diagnostics.eventStreamCompleteness).toBe('complete');
    expect(diagnostics.tools.total).toMatchObject({
      value: 0,
      complete: false,
    });
  });

  it('counts unique safe artifact manifest entries across repeated writes', () => {
    const manifest = {
      schema: 'neuma.trace.safe-manifest.v1',
      manifestType: 'artifact_manifest',
      entries: [{ id: 'artifact:path:opaque', status: 'available' }],
    };
    const diagnostics = buildExecutionDiagnostics(
      run({ delivery: 'delivered' }),
      [event(0, 'RUN_STARTED'), event(1, 'RUN_FINISHED')],
      [
        trace({
          id: 'artifact-1',
          kind: 'artifact_write',
          attrs_json: JSON.stringify({ artifact_manifest: manifest }),
        }),
        trace({
          id: 'artifact-2',
          kind: 'artifact_write',
          attrs_json: JSON.stringify({ artifact_manifest: manifest }),
        }),
      ],
    );

    expect(diagnostics.artifactDelivery.producedFileCount).toMatchObject({
      state: 'available',
      value: 1,
    });
  });
});
