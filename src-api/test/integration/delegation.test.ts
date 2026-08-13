import crypto from 'crypto';

import { describe, expect, it } from 'vitest';

import {
  createAgentProfile,
  createSession,
  createTask,
  getTask,
  updateAgentProfile,
} from '@/shared/db/operations';
import {
  DelegationService,
  resolveAgentConfig,
} from '@/shared/services/delegation';

function setupTaskWithProfile() {
  const sessionId = crypto.randomUUID();
  createSession({ id: sessionId, prompt: 'test' });

  const profileId = crypto.randomUUID();
  createAgentProfile({
    id: profileId,
    name: 'Test Delegator',
    runtime_id: 'claude',
  });

  const taskId = crypto.randomUUID();
  createTask({
    id: taskId,
    session_id: sessionId,
    task_index: 0,
    prompt: 'parent task',
  });

  return { sessionId, profileId, taskId };
}

describe('Delegation Service', () => {
  const service = new DelegationService();

  describe('delegate', () => {
    it('creates child task with parent-child link', () => {
      const { taskId, profileId } = setupTaskWithProfile();

      const childId = service.delegate(taskId, {
        prompt: 'child task',
        assigneeProfileId: profileId,
      });

      expect(childId).toBeTruthy();
      const childTask = getTask(childId);
      expect(childTask).not.toBeNull();
      expect(childTask!.parent_task_id).toBe(taskId);
    });

    it('rejects delegation to non-active profile', () => {
      const { taskId } = setupTaskWithProfile();
      const pausedId = crypto.randomUUID();
      createAgentProfile({
        id: pausedId,
        name: 'Paused',
        runtime_id: 'claude',
      });

      updateAgentProfile(pausedId, { status: 'paused' });

      expect(() =>
        service.delegate(taskId, {
          prompt: 'test',
          assigneeProfileId: pausedId,
        }),
      ).toThrow(/not active/);
    });
  });

  describe('getDelegationDepth', () => {
    it('returns 0 for tasks with no parent', () => {
      const { taskId } = setupTaskWithProfile();
      const depth = service.getDelegationDepth(taskId);
      expect(depth).toBe(0);
    });

    it('correctly counts parent chain', () => {
      const { taskId, profileId } = setupTaskWithProfile();

      const childId = service.delegate(taskId, {
        prompt: 'level 1',
        assigneeProfileId: profileId,
      });

      const depth = service.getDelegationDepth(childId);
      expect(depth).toBe(1);
    });
  });

  describe('Depth limit', () => {
    it('rejects delegation when depth exceeds max', () => {
      const sessionId = crypto.randomUUID();
      createSession({ id: sessionId, prompt: 'depth test' });

      const profileId = crypto.randomUUID();
      createAgentProfile({
        id: profileId,
        name: 'Shallow',
        runtime_id: 'claude',
        max_delegation_depth: 1,
      });

      const taskId = crypto.randomUUID();
      createTask({
        id: taskId,
        session_id: sessionId,
        task_index: 0,
        prompt: 'root',
      });

      // First delegation should work (depth 0 -> 1)
      const childId = service.delegate(taskId, {
        prompt: 'level 1',
        assigneeProfileId: profileId,
      });
      expect(childId).toBeTruthy();

      // Second delegation should fail (depth 1 >= max 1)
      expect(() =>
        service.delegate(childId, {
          prompt: 'level 2',
          assigneeProfileId: profileId,
        }),
      ).toThrow(/depth limit/i);
    });
  });
});

describe('Config Resolution', () => {
  it('task override > profile default > global setting', () => {
    const config = resolveAgentConfig(
      { provider: 'codex', model: 'gpt-4' },
      {
        id: '1',
        name: 'P',
        runtime_id: 'claude',
        role: null,
        description: null,
        avatar_color: null,
        default_model: 'claude-3',
        default_provider: 'claude',
        default_mcp_servers: null,
        default_skills: null,
        system_prompt: null,
        max_concurrent_tasks: 1,
        max_delegation_depth: 3,
        allowed_delegates: null,
        session_compaction_policy: 'auto',
        max_session_messages: 100,
        status: 'active',
        created_at: '',
        updated_at: '',
      },
      { defaultProvider: 'deepagents', defaultModel: 'default-model' },
    );
    expect(config.provider).toBe('codex'); // task override wins
    expect(config.model).toBe('gpt-4'); // task override wins
  });

  it('falls back to profile when task has no override', () => {
    const config = resolveAgentConfig(
      {},
      {
        id: '1',
        name: 'P',
        runtime_id: 'claude',
        role: null,
        description: null,
        avatar_color: null,
        default_model: 'claude-3',
        default_provider: 'claude',
        default_mcp_servers: null,
        default_skills: null,
        system_prompt: null,
        max_concurrent_tasks: 1,
        max_delegation_depth: 3,
        allowed_delegates: null,
        session_compaction_policy: 'auto',
        max_session_messages: 100,
        status: 'active',
        created_at: '',
        updated_at: '',
      },
    );
    expect(config.provider).toBe('claude');
    expect(config.model).toBe('claude-3');
  });

  it('handles null profile gracefully', () => {
    const config = resolveAgentConfig({}, null);
    expect(config.provider).toBe('claude'); // global default
  });
});
