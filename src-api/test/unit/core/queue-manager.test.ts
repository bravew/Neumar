import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canAcceptTask,
  getGlobalStats,
  getQueueState,
  initialize,
  onTaskComplete,
  shutdown,
  tryExecuteOrQueue,
} from '@/core/queue-manager';

import {
  enqueueTask,
  getAgentProfile,
  getQueuedTasks,
  getQueueStats,
} from '@/shared/db/operations';

// Mock dependencies before importing the module under test
vi.mock('@/shared/db/operations', () => ({
  getAgentProfile: vi.fn(),
  enqueueTask: vi.fn(() => true),
  getQueuedTasks: vi.fn(() => []),
  getQueueStats: vi.fn(() => ({ queued: 0, pickedUp: 0, done: 0 })),
  pickupQueuedTask: vi.fn(() => true),
}));

vi.mock('@/shared/utils/errors', () => ({
  errorMessage: vi.fn((err: unknown) => String(err)),
}));

vi.mock('@/shared/services/task-event-bus', () => {
  const { EventEmitter } = require('node:events');
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  return { taskEventBus: bus };
});

vi.mock('@/shared/db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      run: vi.fn(() => ({ changes: 0 })),
    })),
  })),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetAgentProfile = vi.mocked(getAgentProfile);
const mockEnqueueTask = vi.mocked(enqueueTask);
const mockGetQueuedTasks = vi.mocked(getQueuedTasks);
const mockGetQueueStats = vi.mocked(getQueueStats);

describe('QueueManager', () => {
  beforeEach(() => {
    // Initialize fresh for each test — shut down first to clear in-memory state
    shutdown();
    vi.clearAllMocks();

    // Re-apply default mock implementations
    mockGetAgentProfile.mockReturnValue(null);
    mockEnqueueTask.mockReturnValue(true);
    mockGetQueuedTasks.mockReturnValue([]);
    mockGetQueueStats.mockReturnValue({ queued: 0, pickedUp: 0, done: 0 });

    initialize();
  });

  afterEach(() => {
    shutdown();
  });

  describe('canAcceptTask', () => {
    it('returns true when no tasks are running (default max=1)', () => {
      expect(canAcceptTask(null)).toBe(true);
    });

    it('respects max_concurrent_tasks from profile', () => {
      mockGetAgentProfile.mockReturnValue({
        id: 'profile-1',
        name: 'Test',
        role: null,
        description: null,
        avatar_color: null,
        avatar_icon: null,
        runtime_id: 'default',
        default_model: null,
        default_provider: null,
        default_mcp_servers: null,
        default_skills: null,
        system_prompt: null,
        soul: null,
        soul_version: 0,
        soul_origin: 'user',
        corrections_log: null,
        learnings: null,
        max_concurrent_tasks: 3,
        max_delegation_depth: 3,
        allowed_delegates: null,
        session_compaction_policy: 'auto',
        max_session_messages: 100,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      expect(canAcceptTask('profile-1')).toBe(true);

      // Start 3 tasks — should fill capacity
      tryExecuteOrQueue('task-1', 'profile-1');
      tryExecuteOrQueue('task-2', 'profile-1');
      tryExecuteOrQueue('task-3', 'profile-1');

      expect(canAcceptTask('profile-1')).toBe(false);
    });

    it('defaults to max=1 when profile has no max_concurrent_tasks', () => {
      mockGetAgentProfile.mockReturnValue(null);

      expect(canAcceptTask('unknown-profile')).toBe(true);

      tryExecuteOrQueue('task-1', 'unknown-profile');
      expect(canAcceptTask('unknown-profile')).toBe(false);
    });
  });

  describe('tryExecuteOrQueue', () => {
    it('returns "executing" when under capacity', () => {
      const result = tryExecuteOrQueue('task-1', null);
      expect(result.status).toBe('executing');
      expect(result.queuePosition).toBeUndefined();
    });

    it('returns "queued" when at capacity', () => {
      // Fill the default slot (max=1)
      tryExecuteOrQueue('task-1', null);

      mockGetQueueStats.mockReturnValue({ queued: 1, pickedUp: 0, done: 0 });
      const result = tryExecuteOrQueue('task-2', null);
      expect(result.status).toBe('queued');
      expect(result.queuePosition).toBe(1);
      expect(mockEnqueueTask).toHaveBeenCalledWith('task-2', '__default__', 0);
    });

    it('respects priority when enqueuing', () => {
      tryExecuteOrQueue('task-1', null);

      mockGetQueueStats.mockReturnValue({ queued: 1, pickedUp: 0, done: 0 });
      tryExecuteOrQueue('task-2', null, 10);
      expect(mockEnqueueTask).toHaveBeenCalledWith('task-2', '__default__', 10);
    });
  });

  describe('onTaskComplete', () => {
    it('frees up a slot after task completes', () => {
      tryExecuteOrQueue('task-1', null);
      expect(canAcceptTask(null)).toBe(false);

      onTaskComplete('task-1', null, true);
      expect(canAcceptTask(null)).toBe(true);
    });

    it('triggers dequeue when a slot frees up', () => {
      mockGetAgentProfile.mockReturnValue({
        id: 'profile-1',
        name: 'Test',
        role: null,
        description: null,
        avatar_color: null,
        avatar_icon: null,
        runtime_id: 'default',
        default_model: null,
        default_provider: null,
        default_mcp_servers: null,
        default_skills: null,
        system_prompt: null,
        soul: null,
        soul_version: 0,
        soul_origin: 'user',
        corrections_log: null,
        learnings: null,
        max_concurrent_tasks: 1,
        max_delegation_depth: 3,
        allowed_delegates: null,
        session_compaction_policy: 'auto',
        max_session_messages: 100,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Start a task
      tryExecuteOrQueue('task-1', 'profile-1');

      // Mock a queued task waiting
      mockGetQueuedTasks.mockReturnValue([
        {
          id: 'task-2',
          session_id: 'sess-2',
          task_index: 0,
          prompt: 'test prompt',
          status: 'running' as const,
          cost: null,
          duration: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          queue_status: 'queued' as const,
          queue_priority: 0,
          assignee_profile_id: 'profile-1',
        },
      ]);

      // Complete task-1 — should trigger dequeue of task-2
      onTaskComplete('task-1', 'profile-1', true);

      // task-2 should now be tracked as running
      const state = getQueueState('profile-1');
      expect(state.running).toBe(1);
      expect(state.runningTaskIds).toContain('task-2');
    });
  });

  describe('getQueueState', () => {
    it('returns empty state for fresh profile', () => {
      const state = getQueueState('fresh-profile');
      expect(state.running).toBe(0);
      expect(state.queued).toBe(0);
      expect(state.runningTaskIds).toEqual([]);
    });

    it('reflects running task count accurately', () => {
      mockGetAgentProfile.mockReturnValue({
        id: 'p1',
        name: 'Test',
        role: null,
        description: null,
        avatar_color: null,
        avatar_icon: null,
        runtime_id: 'default',
        default_model: null,
        default_provider: null,
        default_mcp_servers: null,
        default_skills: null,
        system_prompt: null,
        soul: null,
        soul_version: 0,
        soul_origin: 'user',
        corrections_log: null,
        learnings: null,
        max_concurrent_tasks: 5,
        max_delegation_depth: 3,
        allowed_delegates: null,
        session_compaction_policy: 'auto',
        max_session_messages: 100,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      tryExecuteOrQueue('t1', 'p1');
      tryExecuteOrQueue('t2', 'p1');

      const state = getQueueState('p1');
      expect(state.running).toBe(2);
      expect(state.maxConcurrent).toBe(5);
      expect(state.runningTaskIds).toContain('t1');
      expect(state.runningTaskIds).toContain('t2');
    });
  });

  describe('getGlobalStats', () => {
    it('aggregates across profiles', () => {
      mockGetAgentProfile.mockReturnValue(null);

      tryExecuteOrQueue('task-a', 'profile-a');
      tryExecuteOrQueue('task-b', 'profile-b');

      const stats = getGlobalStats();
      expect(stats.totalRunning).toBe(2);
    });
  });

  describe('isolation', () => {
    it('profile concurrency limits are independent', () => {
      mockGetAgentProfile.mockReturnValue(null); // defaults to max=1

      tryExecuteOrQueue('t1', 'profileA');
      tryExecuteOrQueue('t2', 'profileB');

      // Both profiles at capacity (max=1 each)
      expect(canAcceptTask('profileA')).toBe(false);
      expect(canAcceptTask('profileB')).toBe(false);

      // Completing profileA task doesn't affect profileB
      onTaskComplete('t1', 'profileA');
      expect(canAcceptTask('profileA')).toBe(true);
      expect(canAcceptTask('profileB')).toBe(false);
    });
  });
});
