import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase, getDatabase } from '@/shared/db';
import {
  getAgentResumeIdentity,
  resumeIdentityMismatch,
  upsertAgentResumeIdentity,
  type AgentResumeIdentity,
} from '@/shared/db/agent-resume-identity';

const baseIdentity: AgentResumeIdentity = {
  taskId: 'task-1',
  providerId: 'claude',
  runtimeId: 'claude',
  modelId: 'claude-sonnet-5',
  workspaceRoot: '/workspace/project',
  nativeSessionId: 'native-abc',
  handleKind: 'opaque-id',
  schemaVersion: 1,
  createdAt: '2026-07-06T00:00:00.000Z',
  lastSeenAt: '2026-07-06T00:00:00.000Z',
};

describe('agent resume identity storage', () => {
  afterEach(() => {
    getDatabase().exec('DELETE FROM agent_resume_identities');
    closeDatabase();
  });

  it('round-trips an identity per task', () => {
    upsertAgentResumeIdentity({
      taskId: 'task-1',
      providerId: 'claude',
      modelId: 'claude-sonnet-5',
      workspaceRoot: '/workspace/project',
      nativeSessionId: 'native-abc',
    });

    const stored = getAgentResumeIdentity('task-1');
    expect(stored).toMatchObject({
      taskId: 'task-1',
      providerId: 'claude',
      modelId: 'claude-sonnet-5',
      workspaceRoot: '/workspace/project',
      nativeSessionId: 'native-abc',
      runtimeId: 'claude',
      handleKind: 'opaque-id',
      schemaVersion: 1,
    });
    expect(Date.parse(stored?.createdAt ?? '')).not.toBeNaN();
    expect(getAgentResumeIdentity('missing-task')).toBeNull();
  });

  it('updates the identity in place when the session rolls over', () => {
    upsertAgentResumeIdentity({
      taskId: 'task-1',
      providerId: 'claude',
      nativeSessionId: 'native-abc',
    });
    upsertAgentResumeIdentity({
      taskId: 'task-1',
      providerId: 'codex',
      modelId: 'gpt-5',
      nativeSessionId: 'native-def',
    });

    const stored = getAgentResumeIdentity('task-1');
    expect(stored).toMatchObject({
      providerId: 'codex',
      modelId: 'gpt-5',
      nativeSessionId: 'native-def',
    });
    const count = getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM agent_resume_identities')
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('resumeIdentityMismatch', () => {
  it('accepts a fully matching request', () => {
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'claude',
        modelId: 'claude-sonnet-5',
        workspaceRoot: '/workspace/project',
        nativeSessionId: 'native-abc',
      }),
    ).toBeNull();
  });

  it('rejects a stale or foreign native session id first', () => {
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'claude',
        nativeSessionId: 'native-old',
      }),
    ).toBe('native_session_id');
  });

  it('rejects a provider switch', () => {
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'codex',
        nativeSessionId: 'native-abc',
      }),
    ).toBe('provider');
  });

  it('rejects a model switch only when both sides are known', () => {
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'claude',
        modelId: 'gpt-5',
        nativeSessionId: 'native-abc',
      }),
    ).toBe('model');
    // Inherit-from-env request must not invalidate a matching session.
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'claude',
        nativeSessionId: 'native-abc',
      }),
    ).toBeNull();
    const withoutModel = { ...baseIdentity, modelId: undefined };
    expect(
      resumeIdentityMismatch(withoutModel, {
        providerId: 'claude',
        modelId: 'claude-sonnet-5',
        nativeSessionId: 'native-abc',
      }),
    ).toBeNull();
  });

  it('rejects a workspace move only when both sides are known', () => {
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'claude',
        workspaceRoot: '/workspace/other',
        nativeSessionId: 'native-abc',
      }),
    ).toBe('workspace_root');
    expect(
      resumeIdentityMismatch(baseIdentity, {
        providerId: 'claude',
        nativeSessionId: 'native-abc',
      }),
    ).toBeNull();
  });
});
