/**
 * Automation Engine Unit Tests
 *
 * Tests the core automation state machine: create, list, get, update,
 * remove, toggle, enqueue with overlap policies, cancel, and status.
 *
 * Best practices:
 * - Test state transitions, not implementation details
 * - Mock only module boundaries (store, DB, sub-services)
 * - Each test starts with a clean engine (shutdown + start)
 * - Arrange-Act-Assert pattern
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mock all external dependencies ----

vi.mock('@/shared/automation/store', () => ({
  loadStore: vi.fn().mockResolvedValue({
    version: 1,
    automations: [],
    runs: [],
    cronState: {},
  }),
  saveStore: vi.fn(),
  flushStore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/automation/cron-service', () => ({
  addCron: vi.fn(),
  removeCron: vi.fn(),
  updateCron: vi.fn(),
  startCron: vi.fn(),
  computeNextRun: vi.fn(),
}));

vi.mock('@/shared/automation/heartbeat-runner', () => ({
  addHeartbeat: vi.fn(),
  removeHeartbeat: vi.fn(),
  startHeartbeats: vi.fn(),
}));

vi.mock('@/shared/automation/delivery', () => ({
  deliver: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/automation/condition-evaluator', () => ({
  evaluateCondition: vi.fn().mockResolvedValue({ satisfied: true }),
}));

vi.mock('@/shared/automation/hooks', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/automation/lifecycle', () => ({
  initLifecycle: vi.fn(),
  startLifecycleManager: vi.fn(),
  shutdownAutomationEngine: vi.fn().mockResolvedValue(undefined),
  persistNextRunTimes: vi.fn(),
  recoverMissedFires: vi.fn(),
  recordRunCost: vi.fn(),
}));

vi.mock('@/shared/automation/webhook-handler', () => ({
  handleWebhook: vi.fn(),
}));

vi.mock('@/shared/services/agent', () => ({
  createSession: vi.fn().mockReturnValue('session-1'),
  runAgent: vi.fn().mockReturnValue(
    (async function* () {
      yield { type: 'text', content: 'Done' };
    })(),
  ),
  runPlanningPhase: vi.fn(),
  runExecutionPhase: vi.fn(),
}));

vi.mock('@/shared/provider/manager', () => ({
  getProviderManager: vi.fn().mockReturnValue({
    getConfig: () => ({ agent: { type: 'claude' } }),
  }),
}));

vi.mock('@/shared/utils/provider-resolution', () => ({
  resolveApiCredentials: vi.fn().mockReturnValue({
    apiKey: 'sk-test',
    baseUrl: undefined,
  }),
  isAnthropicNative: vi.fn().mockReturnValue(true),
}));

vi.mock('@/shared/db/operations', () => ({
  createMessage: vi.fn(),
  getAgentProfile: vi.fn(),
  getQueuedTasks: vi.fn().mockReturnValue([]),
  getTask: vi.fn(),
  getTaskComments: vi.fn().mockReturnValue([]),
  messageExists: vi.fn().mockReturnValue(false),
  pickupQueuedTask: vi.fn().mockReturnValue(true),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Minimal input for creating an automation
function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Automation',
    prompt: 'Do something useful',
    trigger: { type: 'manual' as const },
    agent: {
      usePlanning: false,
      autoApprove: true,
    },
    ...overrides,
  };
}

describe('Automation Engine', () => {
  // Use a fresh module import for each test to reset module-level state
  let engine: typeof import('@/shared/automation/engine');

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    engine = await import('@/shared/automation/engine');
    await engine.start();
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  // ---- create ----

  describe('create', () => {
    it('creates an automation and returns it with an ID', async () => {
      const auto = await engine.create(makeInput());

      expect(auto).toBeDefined();
      expect(auto.id).toBeDefined();
      expect(auto.name).toBe('Test Automation');
      expect(auto.enabled).toBe(true);
      expect(auto.runCount).toBe(0);
      expect(auto.totalCost).toBe(0);
    });

    it('sets enabled to false when specified', async () => {
      const auto = await engine.create(makeInput({ enabled: false }));
      expect(auto.enabled).toBe(false);
    });

    it('defaults overlapPolicy to skip', async () => {
      const auto = await engine.create(makeInput());
      expect(auto.overlapPolicy).toBe('skip');
    });
  });

  // ---- list / get ----

  describe('list and get', () => {
    it('list returns all created automations', async () => {
      const before = engine.list().length;
      await engine.create(makeInput({ name: 'A' }));
      await engine.create(makeInput({ name: 'B' }));

      expect(engine.list().length).toBe(before + 2);
    });

    it('get returns automation by ID', async () => {
      const created = await engine.create(makeInput());
      const found = engine.get(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('get returns undefined for unknown ID', async () => {
      expect(engine.get('nonexistent')).toBeUndefined();
    });
  });

  // ---- update ----

  describe('update', () => {
    it('updates fields and preserves ID', async () => {
      const auto = await engine.create(makeInput());

      const updated = await engine.update(auto.id, { name: 'Updated' });
      expect(updated.id).toBe(auto.id);
      expect(updated.name).toBe('Updated');
      expect(updated.createdAt).toBe(auto.createdAt);
    });

    it('throws for non-existent automation', async () => {
      await expect(engine.update('bad-id', { name: 'X' })).rejects.toThrow(
        'not found',
      );
    });
  });

  // ---- remove ----

  describe('remove', () => {
    it('removes automation from list', async () => {
      const before = engine.list().length;
      const auto = await engine.create(makeInput());
      expect(engine.list().length).toBe(before + 1);

      await engine.remove(auto.id);
      expect(engine.list().length).toBe(before);
    });

    it('throws for non-existent automation', async () => {
      await expect(engine.remove('bad-id')).rejects.toThrow('not found');
    });
  });

  // ---- toggle ----

  describe('toggle', () => {
    it('disables an enabled automation', async () => {
      const auto = await engine.create(makeInput());

      const toggled = await engine.toggle(auto.id, false);
      expect(toggled.enabled).toBe(false);
    });

    it('enables a disabled automation', async () => {
      const auto = await engine.create(makeInput({ enabled: false }));

      const toggled = await engine.toggle(auto.id, true);
      expect(toggled.enabled).toBe(true);
    });

    it('throws for non-existent automation', async () => {
      await expect(engine.toggle('bad-id', true)).rejects.toThrow('not found');
    });
  });

  // ---- enqueue ----

  describe('enqueue', () => {
    it('creates a run for a manual trigger', async () => {
      const auto = await engine.create(makeInput());

      const run = engine.enqueue(auto.id, 'manual');
      expect(run).toBeDefined();
      expect(run!.automationId).toBe(auto.id);
      // Run may be 'queued' or immediately 'executing' depending on
      // MAX_CONCURRENT_RUNS capacity — both are valid outcomes
      expect(['queued', 'executing']).toContain(run!.status);
      expect(run!.triggeredBy).toBe('manual');
    });

    it('throws when automation is disabled', async () => {
      const auto = await engine.create(makeInput({ enabled: false }));

      expect(() => engine.enqueue(auto.id, 'manual')).toThrow('disabled');
    });

    it('throws when automation does not exist', async () => {
      expect(() => engine.enqueue('bad-id', 'manual')).toThrow('not found');
    });

    it('skip policy returns null when automation is already running', async () => {
      const auto = await engine.create(makeInput({ overlapPolicy: 'skip' }));

      // First enqueue succeeds
      engine.enqueue(auto.id, 'manual');

      // Second should be skipped (overlap policy = skip)
      const result = engine.enqueue(auto.id, 'manual');
      expect(result).toBeNull();
    });

    it('queue policy allows multiple enqueues', async () => {
      const auto = await engine.create(makeInput({ overlapPolicy: 'queue' }));

      const run1 = engine.enqueue(auto.id, 'manual');
      const run2 = engine.enqueue(auto.id, 'manual');

      expect(run1).not.toBeNull();
      expect(run2).not.toBeNull();
      expect(run1!.id).not.toBe(run2!.id);
    });
  });

  // ---- getRuns / getRun / getActiveRuns ----

  describe('run queries', () => {
    it('getRuns returns runs for an automation', async () => {
      const auto = await engine.create(makeInput());
      engine.enqueue(auto.id, 'manual');

      const runs = engine.getRuns(auto.id);
      expect(runs.length).toBeGreaterThanOrEqual(1);
    });

    it('getRun returns a specific run', async () => {
      const auto = await engine.create(makeInput());
      const run = engine.enqueue(auto.id, 'manual')!;

      const found = engine.getRun(run.id);
      expect(found?.id).toBe(run.id);
    });

    it('getRun returns undefined for unknown ID', async () => {
      expect(engine.getRun('nonexistent')).toBeUndefined();
    });
  });

  // ---- getStatus ----

  describe('getStatus', () => {
    it('reports engine state', async () => {
      await engine.create(makeInput());

      const status = engine.getStatus();
      expect(status.started).toBe(true);
      expect(status.automationCount).toBeGreaterThanOrEqual(1);
      expect(typeof status.activeRunCount).toBe('number');
      expect(typeof status.queuedCount).toBe('number');
    });
  });

  // ---- lifecycle ----

  describe('lifecycle', () => {
    it('start is idempotent', async () => {
      // Already started in beforeEach — calling again should be no-op
      await engine.start();
      expect(engine.getStatus().started).toBe(true);
    });

    it('shutdown clears state', async () => {
      await engine.create(makeInput());
      await engine.shutdown();

      expect(engine.getStatus().started).toBe(false);
    });
  });
});
