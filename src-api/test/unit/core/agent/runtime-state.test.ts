import { describe, expect, it } from 'vitest';

import {
  adaptRunFailure,
  advanceRunVerdict,
  parseAgentSessionBinding,
  parseRunVerdict,
  serializeRuntimeState,
  shouldRolloverNativeSession,
} from '@/core/agent/runtime-state';

describe('runtime state contracts', () => {
  it('round-trips a versioned session binding without losing identity fields', () => {
    const binding = parseAgentSessionBinding({
      schemaVersion: 1,
      conversationId: 'conversation-1',
      projectId: 'project-1',
      runtimeId: 'claude',
      modelId: 'claude-opus-5',
      workspaceRoot: '/workspace',
      handleKind: 'opaque-id',
      handle: 'secret-session-handle',
      lastMessageId: 'message-9',
      updatedAt: '2026-07-28T12:00:00.000Z',
    });

    expect(
      parseAgentSessionBinding(JSON.parse(serializeRuntimeState(binding))),
    ).toEqual(binding);
  });

  it('upgrades the prior task-keyed resume identity shape', () => {
    expect(
      parseAgentSessionBinding({
        taskId: 'task-1',
        providerId: 'codex',
        modelId: 'gpt-5.5',
        workspaceRoot: '/workspace',
        nativeSessionId: 'thread-1',
        createdAt: '2026-07-27T12:00:00.000Z',
        lastSeenAt: '2026-07-28T12:00:00.000Z',
      }),
    ).toEqual({
      schemaVersion: 1,
      conversationId: 'task-1',
      projectId: null,
      runtimeId: 'codex',
      modelId: 'gpt-5.5',
      workspaceRoot: '/workspace',
      handleKind: 'opaque-id',
      handle: 'thread-1',
      lastMessageId: null,
      updatedAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('round-trips a versioned run verdict', () => {
    const verdict = parseRunVerdict({
      schemaVersion: 1,
      process: 'failed',
      completeness: 'unfinished',
      delivery: 'blocked',
      retry: 'user_action',
      failureCause: 'Authentication required',
    });

    expect(parseRunVerdict(JSON.parse(serializeRuntimeState(verdict)))).toEqual(
      verdict,
    );
  });

  it('upgrades legacy run statuses without inventing completeness', () => {
    expect(parseRunVerdict({ status: 'completed' })).toEqual({
      schemaVersion: 1,
      process: 'succeeded',
      completeness: 'unknown',
      delivery: 'not_expected',
      retry: 'not_safe',
    });
  });

  it('keeps terminal process states monotonic', () => {
    const cancelled = parseRunVerdict({
      process: 'cancelled',
      completeness: 'unfinished',
      delivery: 'not_expected',
      retry: 'not_safe',
    });
    const lateFailure = parseRunVerdict({
      process: 'failed',
      completeness: 'unfinished',
      delivery: 'failed',
      retry: 'user_action',
    });
    expect(advanceRunVerdict(cancelled, lateFailure)).toEqual(cancelled);
  });

  it('cannot succeed with unfinished work or pending delivery', () => {
    const running = parseRunVerdict({
      process: 'running',
      completeness: 'unknown',
      delivery: 'pending',
      retry: 'not_safe',
    });
    const proposed = parseRunVerdict({
      process: 'succeeded',
      completeness: 'complete',
      delivery: 'pending',
      retry: 'not_safe',
    });
    expect(advanceRunVerdict(running, proposed)).toMatchObject({
      process: 'failed',
      failureCause: 'artifact_delivery_incomplete',
    });
  });

  it('rolls native sessions over before a known context limit', () => {
    expect(shouldRolloverNativeSession('claude-opus-5', 899_999)).toBe(false);
    expect(shouldRolloverNativeSession('claude-opus-5', 900_000)).toBe(true);
    expect(shouldRolloverNativeSession('unknown-model', 900_000)).toBe(false);
  });

  it('keeps the same base failure verdict across modes with mode actions', () => {
    const failures = (['task', 'design', 'video'] as const).map((mode) =>
      adaptRunFailure(mode, 'upstream_timeout', 'safe_once'),
    );

    expect(failures.map(({ verdict }) => verdict)).toEqual([
      failures[0]?.verdict,
      failures[0]?.verdict,
      failures[0]?.verdict,
    ]);
    expect(failures.map(({ recoveryAction }) => recoveryAction)).toEqual([
      'retry_run',
      'retry_generation',
      'retry_render',
    ]);
  });
});
