/**
 * Automation Engine
 *
 * Core automation engine with queue, state machine, and executor.
 * Uses module-level state pattern (not class-based), following pipeline.ts.
 *
 * SCALE NOTE — Session Reuse for Heartbeats:
 * ───────────────────────────────────────────
 * Currently each heartbeat tick creates a FRESH agent session (no history).
 * OpenClaw's heartbeat runs in the main session with full conversation context,
 * enabling the agent to remember prior checks and avoid redundant work.
 *
 * To enable session reuse (when needed):
 * 1. Store a persistent `sessionId` on each heartbeat Automation record
 * 2. On tick, call the Claude Agent SDK with `resume: sessionId` to load
 *    prior conversation history (sdk.d.ts supports this)
 * 3. After HEARTBEAT_OK, optionally prune the session transcript to control
 *    context growth (OpenClaw truncates back to pre-heartbeat size)
 * 4. Offer `isolatedSession: true` option (OpenClaw pattern) for cost savings
 *    (~100K tokens saved by starting fresh each tick)
 *
 * SCALE NOTE — Channel Isolation:
 * ────────────────────────────────
 * All channels (Discord, Telegram, Slack, Lark, desktop) share one engine
 * instance, one store, one queue (MAX_CONCURRENT_RUNS=3). This works because:
 * - Each automation has a UUID (no cross-channel ID collision)
 * - Delivery is routed via channelDelivery.platform + conversationId
 * - Fair scheduling reserves slots for non-heartbeat runs
 * - Overlap guard (default: skip) prevents per-automation stacking
 *
 * If multi-tenant isolation is needed later:
 * - Partition store by channel/user (separate SQLite tables or namespaces)
 * - Per-channel concurrency limits (not just global MAX_CONCURRENT_RUNS)
 * - Per-channel cost budgets (currently only global + per-automation)
 * - Channel-scoped automation listing in the API (filter by originChannel)
 */

import { randomBytes, randomUUID } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';

import { getChannelManager } from '@/shared/channels/channel-manager';
import {
  createMessage,
  getAgentProfile,
  getQueuedTasks,
  getTask,
  getTaskComments,
  messageExists,
  pickupQueuedTask,
} from '@/shared/db/operations';
import type { Task } from '@/shared/db/types';
import { getProviderManager } from '@/shared/provider/manager';
import {
  createSession,
  runAgent,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import { createLogger } from '@/shared/utils/logger';
import {
  isAnthropicNative,
  resolveApiCredentials,
} from '@/shared/utils/provider-resolution';

import { evaluateCondition } from './condition-evaluator';
import {
  AUTOMATION_RUN_TTL_MS,
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_AUTOMATIONS,
  MAX_CONCURRENT_RUNS,
  MAX_STORED_RUNS_PER_AUTOMATION,
  WEBHOOK_TOKEN_BYTES,
} from './constants';
import {
  addCron,
  computeNextRun,
  removeCron,
  startCron,
  updateCron,
} from './cron-service';
import { deliver } from './delivery';
import {
  addHeartbeat,
  removeHeartbeat,
  startHeartbeats,
} from './heartbeat-runner';
import { emit } from './hooks';
import {
  initLifecycle,
  persistNextRunTimes,
  recoverMissedFires,
  recordRunCost,
  shutdownAutomationEngine,
  startLifecycleManager,
} from './lifecycle';
import { flushStore, loadStore, saveStore } from './store';
import type {
  Automation,
  AutomationChannelDelivery,
  AutomationRun,
  AutomationRunStatus,
  AutomationStoreData,
  AutomationTrigger,
  CreateAutomationInput,
  UpdateAutomationInput,
} from './types';
import { handleWebhook } from './webhook-handler';

// ============================================================================
// Module-Level State
// ============================================================================

const logger = createLogger('Automation');

let store: AutomationStoreData = {
  version: 1,
  automations: [],
  runs: [],
  cronState: {},
};

const activeRuns = new Map<
  string,
  { run: AutomationRun; abortController: AbortController }
>();

const queue: Array<{
  runId: string;
  automationId: string;
  triggeredBy: string;
  payload?: unknown;
}> = [];

let started = false;

// ============================================================================
// Valid State Transitions
// ============================================================================

const VALID_TRANSITIONS: Record<AutomationRunStatus, AutomationRunStatus[]> = {
  queued: ['planning', 'executing', 'cancelled'],
  planning: [
    'awaiting_approval',
    'executing',
    'failed',
    'cancelled',
    'timed_out',
  ],
  awaiting_approval: ['executing', 'cancelled'],
  executing: ['completed', 'failed', 'cancelled', 'timed_out'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

/** Max chars of webhook payload appended to agent prompt */
const MAX_PAYLOAD_CHARS = 4000;

/** Terminal statuses that indicate a run has finished (success or failure). */
const TERMINAL_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Start the automation engine.
 * Loads persisted state, detects stale runs, and starts triggers.
 */
export async function start(): Promise<void> {
  if (started) return;

  store = await loadStore();
  detectStaleRuns();
  evictOldRuns();

  // Initialize lifecycle manager with engine callbacks
  initLifecycle({
    store,
    onDisable: async (id) => {
      await toggle(id, false);
    },
    onEnqueue: (automationId, triggeredBy) => {
      enqueue(automationId, triggeredBy);
    },
    onGetActiveRunIds: () => Array.from(activeRuns.keys()),
  });

  // Recover missed fires before starting triggers
  const enabledAutomations = store.automations.filter((a) => a.enabled);
  recoverMissedFires(enabledAutomations, (id, triggeredBy) =>
    enqueue(id, triggeredBy),
  );

  // Start cron timers for enabled cron automations
  const cronAutomations = store.automations.filter(
    (a) => a.enabled && a.trigger.type === 'cron',
  );
  startCron(
    cronAutomations,
    (id) => enqueue(id, 'cron'),
    (id) => store.automations.find((a) => a.id === id)?.consecutiveErrors ?? 0,
  );

  // Start heartbeat timers for enabled heartbeat automations
  const heartbeatAutomations = store.automations.filter(
    (a) => a.enabled && a.trigger.type === 'heartbeat',
  );
  startHeartbeats(heartbeatAutomations, (id) => handleHeartbeatTick(id));

  // Start lifecycle manager (expiry, budget, failure checks)
  startLifecycleManager();

  started = true;
  logger.info('Automation engine started', {
    automations: store.automations.length,
    runs: store.runs.length,
  });

  void emit('engine:started');
}

/**
 * Shut down the automation engine gracefully.
 * Persists nextRunAt for missed-fire detection, waits for in-progress runs,
 * then flushes store to disk.
 */
export async function shutdown(): Promise<void> {
  if (!started) return;

  void emit('engine:shutdown');

  // Persist nextRunAt for missed-fire detection on next startup
  // Covers BOTH cron and heartbeat automations
  persistNextRunTimes(store.automations, (automation) => {
    if (automation.trigger.type === 'cron') {
      const nextRun = computeNextRun(automation.trigger.schedule, 0);
      return nextRun ? new Date(nextRun).toISOString() : undefined;
    }
    if (automation.trigger.type === 'heartbeat') {
      // For heartbeats, next fire = now + interval
      const intervalMs = automation.trigger.heartbeat.intervalMs;
      return new Date(Date.now() + intervalMs).toISOString();
    }
    return undefined;
  });

  // Graceful shutdown with wait for in-progress runs
  await shutdownAutomationEngine(store, Array.from(activeRuns.keys()), () => {
    // Abort all remaining active runs
    for (const [runId, { abortController }] of activeRuns) {
      logger.info('Aborting active run on shutdown', { runId });
      abortController.abort();
    }
    activeRuns.clear();
  });

  queue.length = 0;
  started = false;
  logger.info('Automation engine shut down');
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Build a fully-typed AutomationTrigger from the validated input.
 * Generates webhook slug and token for webhook-type triggers.
 */
function buildTrigger(
  input: CreateAutomationInput['trigger'],
): AutomationTrigger {
  switch (input.type) {
    case 'webhook':
      return {
        type: 'webhook',
        webhook: {
          slug: randomBytes(16).toString('hex'),
          token: randomBytes(WEBHOOK_TOKEN_BYTES).toString('hex'),
          payloadTemplate: input.webhook?.payloadTemplate,
          maxBodyBytes: input.webhook?.maxBodyBytes,
        },
      };
    case 'cron':
      return { type: 'cron', schedule: input.schedule };
    case 'heartbeat':
      return { type: 'heartbeat', heartbeat: input.heartbeat };
    case 'manual':
      return { type: 'manual' };
  }
}

/**
 * Create a new automation.
 */
export async function create(
  input: CreateAutomationInput,
): Promise<Automation> {
  if (store.automations.length >= MAX_AUTOMATIONS) {
    throw new Error(`Maximum of ${MAX_AUTOMATIONS} automations reached`);
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const trigger = buildTrigger(input.trigger);

  const automation: Automation = {
    id,
    name: input.name,
    description: input.description,
    enabled: input.enabled ?? true,
    prompt: input.prompt,
    trigger,
    agent: input.agent,
    delivery: input.delivery,
    channelDelivery: input.channelDelivery,
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
    consecutiveErrors: 0,
    // Lifecycle
    expiresAt: input.expiresAt,
    maxRuns: input.maxRuns,
    runCount: 0,
    costBudget: input.costBudget,
    totalCost: 0,
    // Origin
    origin: input.origin ?? 'api',
    originSessionId: input.originSessionId,
    originChannel: input.originChannel,
    // Condition
    condition: input.condition,
    // Agent profile
    agentProfileId: input.agentProfileId,
    // Locale
    locale: input.locale ?? 'en-US',
    // Policies
    overlapPolicy: input.overlapPolicy ?? 'skip',
    missedFirePolicy: input.missedFirePolicy ?? 'fire_once',
    // Condition evaluator state
    consecutiveQuietRuns: 0,
    // Recursive guard
    createdByRunId: input.createdByRunId,
    // Connector-tier isolation: persist creator tier (Phase A/B). Defaults
    // to undefined for desktop-API callers; the schedule MCP tool wires it
    // explicitly from `channelContext.permissionTier`.
    creatorTier: input.creatorTier,
    creatorIdentityId: input.creatorIdentityId,
  };

  store.automations.push(automation);
  await flushStore(store);

  // Start triggers if enabled
  if (automation.enabled) {
    if (automation.trigger.type === 'cron') addCron(automation);
    if (automation.trigger.type === 'heartbeat') addHeartbeat(automation);
  }

  logger.info('Created automation', {
    id,
    name: input.name,
    trigger: trigger.type,
  });
  void emit('automation:created', { automationId: id });
  return automation;
}

/**
 * Merge a trigger patch with an existing trigger, preserving webhook credentials.
 */
function mergeTrigger(
  existing: AutomationTrigger,
  patch?: UpdateAutomationInput['trigger'],
): AutomationTrigger {
  if (!patch) return existing;

  // If updating to webhook type, preserve existing slug/token if available
  if (patch.type === 'webhook' && existing.type === 'webhook') {
    return {
      type: 'webhook',
      webhook: {
        ...existing.webhook,
        payloadTemplate:
          patch.webhook?.payloadTemplate ?? existing.webhook.payloadTemplate,
        maxBodyBytes:
          patch.webhook?.maxBodyBytes ?? existing.webhook.maxBodyBytes,
      },
    };
  }

  // For non-webhook patches, build a fresh trigger via explicit narrowing
  switch (patch.type) {
    case 'webhook':
      return {
        type: 'webhook',
        webhook: {
          slug: randomBytes(16).toString('hex'),
          token: randomBytes(WEBHOOK_TOKEN_BYTES).toString('hex'),
          payloadTemplate: patch.webhook?.payloadTemplate,
          maxBodyBytes: patch.webhook?.maxBodyBytes,
        },
      };
    case 'cron':
      return { type: 'cron', schedule: patch.schedule };
    case 'heartbeat':
      return { type: 'heartbeat', heartbeat: patch.heartbeat };
    case 'manual':
      return { type: 'manual' };
  }
}

/**
 * Update an existing automation.
 */
export async function update(
  id: string,
  patch: UpdateAutomationInput,
): Promise<Automation> {
  const index = store.automations.findIndex((a) => a.id === id);
  if (index === -1) throw new Error(`Automation not found: ${id}`);

  const existing = store.automations[index]!;
  const trigger = mergeTrigger(existing.trigger, patch.trigger);

  const updated: Automation = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    trigger,
  };

  store.automations[index] = updated;
  await flushStore(store);

  // Re-arm triggers if trigger changed
  updateCron(updated);
  removeHeartbeat(id);
  if (updated.enabled && updated.trigger.type === 'heartbeat') {
    addHeartbeat(updated);
  }

  logger.info('Updated automation', { id });
  void emit('automation:updated', { automationId: id });
  return updated;
}

/**
 * Remove an automation and its run history.
 */
export async function remove(id: string): Promise<void> {
  const index = store.automations.findIndex((a) => a.id === id);
  if (index === -1) throw new Error(`Automation not found: ${id}`);

  // Cancel any active runs for this automation
  for (const [runId, { run, abortController }] of activeRuns) {
    if (run.automationId === id) {
      abortController.abort();
      activeRuns.delete(runId);
    }
  }

  // Remove from queue
  for (let i = queue.length - 1; i >= 0; i--) {
    const item = queue[i];
    if (item && item.automationId === id) {
      queue.splice(i, 1);
    }
  }

  // Remove triggers
  removeCron(id);
  removeHeartbeat(id);

  // Remove automation and its runs
  store.automations.splice(index, 1);
  store.runs = store.runs.filter((r) => r.automationId !== id);
  delete store.cronState[id];
  await flushStore(store);

  logger.info('Removed automation', { id });
  void emit('automation:deleted', { automationId: id });
}

/**
 * Get an automation by ID.
 */
export function get(id: string): Automation | undefined {
  return store.automations.find((a) => a.id === id);
}

/**
 * List all automations.
 */
export function list(): Automation[] {
  return store.automations;
}

/**
 * Toggle an automation's enabled state.
 */
export async function toggle(
  id: string,
  enabled: boolean,
): Promise<Automation> {
  const index = store.automations.findIndex((a) => a.id === id);
  if (index === -1) throw new Error(`Automation not found: ${id}`);

  const automation = store.automations[index]!;
  automation.enabled = enabled;
  automation.updatedAt = new Date().toISOString();

  if (!enabled) {
    // Reset consecutive errors when disabling
    automation.consecutiveErrors = 0;
    removeCron(id);
    removeHeartbeat(id);
  } else {
    if (automation.trigger.type === 'cron') addCron(automation);
    if (automation.trigger.type === 'heartbeat') addHeartbeat(automation);
  }

  await flushStore(store);

  logger.info('Toggled automation', { id, enabled });
  void emit(enabled ? 'automation:enabled' : 'automation:disabled', {
    automationId: id,
  });
  return automation;
}

// ============================================================================
// Queue & Execution
// ============================================================================

/**
 * Enqueue a new run for an automation.
 */
export function enqueue(
  automationId: string,
  triggeredBy: string,
  payload?: unknown,
): AutomationRun | null {
  const automation = store.automations.find((a) => a.id === automationId);
  if (!automation) throw new Error(`Automation not found: ${automationId}`);
  if (!automation.enabled)
    throw new Error(`Automation is disabled: ${automationId}`);

  // Per-automation overlap guard (G11)
  const overlapPolicy = automation.overlapPolicy ?? 'skip';
  const hasActiveRun = isAutomationRunning(automationId);

  if (hasActiveRun) {
    switch (overlapPolicy) {
      case 'skip':
        logger.info('Overlap: skipping fire (previous run still active)', {
          automationId,
          triggeredBy,
        });
        void emit('automation:overlap_skipped', { automationId });
        return null;

      case 'cancel_previous':
        // Abort the in-progress run, then proceed
        for (const [runId, { run, abortController }] of activeRuns) {
          if (run.automationId === automationId) {
            logger.info('Overlap: cancelling previous run', {
              runId,
              automationId,
            });
            abortController.abort();
            activeRuns.delete(runId);
          }
        }
        break;

      case 'queue':
        // Allow queueing (default engine behavior)
        break;
    }
  }

  const run: AutomationRun = {
    id: randomUUID(),
    automationId,
    status: 'queued',
    triggeredBy,
    payload,
    queuedAt: new Date().toISOString(),
  };

  store.runs.push(run);
  queue.push({ runId: run.id, automationId, triggeredBy, payload });

  logger.info('Enqueued run', {
    runId: run.id,
    automationId,
    triggeredBy,
  });

  void emit('run:queued', { automationId, runId: run.id });

  // Kick off queue processing (non-blocking)
  void processQueue();

  return run;
}

/**
 * Check if an automation currently has an active or queued run.
 */
function isAutomationRunning(automationId: string): boolean {
  // Check active runs
  for (const [, { run }] of activeRuns) {
    if (run.automationId === automationId) return true;
  }
  // Check queue
  return queue.some((q) => q.automationId === automationId);
}

// ============================================================================
// Queue-Pickup Heartbeat
// ============================================================================

/**
 * Handle a heartbeat tick — standard mode enqueues the automation's prompt;
 * queue-pickup mode checks for queued tasks and picks one up.
 */
function handleHeartbeatTick(automationId: string): void {
  const automation = store.automations.find((a) => a.id === automationId);
  if (!automation || automation.trigger.type !== 'heartbeat') return;

  // Update nextRunAt for missed-fire detection on restart
  const intervalMs = automation.trigger.heartbeat.intervalMs;
  automation.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  saveStore(store);

  const heartbeat = automation.trigger.heartbeat;
  if (heartbeat.mode === 'queue_pickup' && heartbeat.queueProfileId) {
    const tasks = getQueuedTasks(heartbeat.queueProfileId, 1);
    if (tasks.length === 0) {
      logger.debug('Queue-pickup tick: no queued tasks', { automationId });
      return;
    }

    const task = tasks[0]!;
    const pickedUp = pickupQueuedTask(task.id, heartbeat.queueProfileId);
    if (!pickedUp) {
      logger.debug('Queue-pickup tick: task already picked up', {
        automationId,
        taskId: task.id,
      });
      return;
    }

    const contextMode = heartbeat.contextMode ?? 'thin';
    const prompt = assembleQueueContext(task, contextMode);
    enqueue(automationId, 'heartbeat', {
      source: 'queue_pickup',
      taskId: task.id,
      prompt,
    });
  } else {
    enqueue(automationId, 'heartbeat');
  }
}

/**
 * Assemble context for a queue-pickup run.
 * - Fat mode: full task context (prompt + parent + project + profile + comments)
 * - Thin mode: task ID + title only (agent fetches details via API)
 */
function assembleQueueContext(task: Task, mode: 'fat' | 'thin'): string {
  if (mode === 'thin') {
    return `Execute task ${task.id}: ${task.title || task.prompt}`;
  }

  const parts: string[] = [];
  parts.push(`Task: ${task.title || 'Untitled'}`);
  parts.push(`Prompt: ${task.prompt}`);

  if (task.parent_task_id) {
    const parent = getTask(task.parent_task_id);
    if (parent) {
      parts.push(`Parent task: ${parent.title || parent.prompt}`);
    }
  }

  if (task.assignee_profile_id) {
    const profile = getAgentProfile(task.assignee_profile_id);
    if (profile?.system_prompt) {
      parts.push(`Agent instructions: ${profile.system_prompt}`);
    }
  }

  const comments = getTaskComments(task.id);
  if (comments.length > 0) {
    const recent = comments.slice(0, 5);
    parts.push(
      `Recent comments:\n${recent.map((c) => `- ${c.content}`).join('\n')}`,
    );
  }

  return parts.join('\n\n');
}

/**
 * Cancel an active or queued run.
 */
export async function cancel(runId: string): Promise<void> {
  // Check active runs
  const active = activeRuns.get(runId);
  if (active) {
    active.abortController.abort();
    activeRuns.delete(runId);
    updateRunStatus(runId, 'cancelled');
    logger.info('Cancelled active run', { runId });
    void emit('run:cancelled', { runId });
    return;
  }

  // Check queued runs — remove from queue and update status
  const run = store.runs.find((r) => r.id === runId);
  if (run && run.status === 'queued') {
    updateRunStatus(runId, 'cancelled');
    // Remove from queue array by runId
    const queueIndex = queue.findIndex((q) => q.runId === runId);
    if (queueIndex !== -1) queue.splice(queueIndex, 1);
    logger.info('Cancelled queued run', { runId });
    void emit('run:cancelled', { runId });
    return;
  }

  throw new Error(`Run not found or not cancellable: ${runId}`);
}

/**
 * Get all runs for an automation.
 */
export function getRuns(automationId: string): AutomationRun[] {
  return store.runs
    .filter((r) => r.automationId === automationId)
    .sort(
      (a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime(),
    );
}

/**
 * Get a single run by ID.
 */
export function getRun(runId: string): AutomationRun | undefined {
  return store.runs.find((r) => r.id === runId);
}

/**
 * Delete completed/failed runs by IDs. Active runs are skipped.
 * Returns the number of runs actually deleted.
 */
export function deleteRuns(runIds: string[]): number {
  const idSet = new Set(runIds);
  const activeIds = new Set(Array.from(activeRuns.keys()));
  const before = store.runs.length;
  store.runs = store.runs.filter(
    (r) => !idSet.has(r.id) || activeIds.has(r.id),
  );
  return before - store.runs.length;
}

/**
 * Get all currently active runs.
 */
export function getActiveRuns(): AutomationRun[] {
  return Array.from(activeRuns.values()).map((a) => a.run);
}

/**
 * Get engine status summary.
 */
export function getStatus(): {
  started: boolean;
  activeRunCount: number;
  queuedCount: number;
  automationCount: number;
} {
  return {
    started,
    activeRunCount: activeRuns.size,
    queuedCount: queue.length,
    automationCount: store.automations.length,
  };
}

// ============================================================================
// State Machine
// ============================================================================

/**
 * Update a run's status with transition validation.
 */
function updateRunStatus(
  runId: string,
  newStatus: AutomationRunStatus,
  error?: string,
): void {
  const run = store.runs.find((r) => r.id === runId);
  if (!run) {
    logger.warn('Cannot update status — run not found', { runId });
    return;
  }

  const allowed = VALID_TRANSITIONS[run.status];
  if (!allowed.includes(newStatus)) {
    logger.warn('Invalid status transition', {
      runId,
      from: run.status,
      to: newStatus,
    });
    return;
  }

  run.status = newStatus;

  if (newStatus === 'executing' || newStatus === 'planning') {
    run.startedAt = run.startedAt ?? new Date().toISOString();
  }

  if (error) {
    run.error = error;
  }

  if (TERMINAL_STATUSES.has(newStatus)) {
    run.completedAt = run.completedAt ?? new Date().toISOString();
    if (run.startedAt) {
      run.durationMs =
        new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    }
  }

  // Persist after every status transition
  void saveStore(store);
}

// ============================================================================
// Queue Processor
// ============================================================================

/**
 * Process items in the run queue up to MAX_CONCURRENT_RUNS.
 * Launches runs concurrently (fire-and-forget) and uses activeRuns.size as the gate.
 */
/**
 * Max concurrent heartbeat runs. Reserves at least 1 slot for non-heartbeat
 * automations (cron, webhook, manual) so fast heartbeats don't starve them.
 */
const MAX_CONCURRENT_HEARTBEAT_RUNS = Math.max(1, MAX_CONCURRENT_RUNS - 1);

function processQueue(): void {
  while (activeRuns.size < MAX_CONCURRENT_RUNS && queue.length > 0) {
    // Fair scheduling: if heartbeat runs are at their limit, skip heartbeat
    // items and pick the next non-heartbeat item instead.
    const heartbeatRunCount = countActiveHeartbeatRuns();
    let itemIndex = 0;

    if (heartbeatRunCount >= MAX_CONCURRENT_HEARTBEAT_RUNS) {
      // Find the first non-heartbeat item in queue
      itemIndex = queue.findIndex((q) => q.triggeredBy !== 'heartbeat');
      if (itemIndex === -1) break; // Only heartbeat items left, wait
    }

    const item = queue.splice(itemIndex, 1)[0];
    if (!item) break;

    const run = store.runs.find((r) => r.id === item.runId);
    if (!run || run.status !== 'queued') {
      logger.warn('No matching queued run found', { runId: item.runId });
      continue;
    }

    // Fire-and-forget — executeRun calls processQueue again in its finally block
    void executeRun(item.automationId, run, item.payload);
  }
}

function countActiveHeartbeatRuns(): number {
  let count = 0;
  for (const [, { run }] of activeRuns) {
    if (run.triggeredBy === 'heartbeat') count++;
  }
  return count;
}

// ============================================================================
// Model Config Resolution
// ============================================================================

/**
 * Resolve model config from provider settings for agent calls.
 * Follows the pattern from pipeline.ts.
 */
function getModelConfig():
  | { apiKey?: string; baseUrl?: string; model?: string }
  | undefined {
  try {
    const config = getProviderManager().getConfig();
    const agentConfig = config.agent?.config;
    if (agentConfig && (agentConfig.apiKey || agentConfig.model)) {
      return agentConfig as {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
      };
    }
  } catch {
    // Provider manager not yet initialized — use defaults
  }
  return undefined;
}

/**
 * Resolve channel context from an automation's delivery config.
 * Returns undefined for desktop or missing delivery — the agent
 * only needs channel context for platform-specific MCP tools.
 */
function resolveChannelContext(
  cd: AutomationChannelDelivery | undefined,
  creatorTier: 'viewer' | 'operator' | 'admin' | undefined,
  creatorIdentityId: string | undefined,
):
  | {
      platform: string;
      conversationId: string;
      configId?: string;
      botToken?: string;
      permissionTier?: 'viewer' | 'operator' | 'admin';
      identityId?: string;
      automationOrigin?: boolean;
    }
  | undefined {
  // Default tier: 'admin' for legacy automations missing `creatorTier`.
  // This is safe AFTER Phase A because the schedule MCP gate prevents
  // non-admin identities from creating new schedules through chat — any
  // pre-existing rows without a `creatorTier` were created via the desktop
  // UI by the install owner. New automations created via the schedule MCP
  // (or future code paths) MUST persist `creatorTier` so this default is
  // never relied upon for fresh data.
  const tier: 'viewer' | 'operator' | 'admin' = creatorTier ?? 'admin';

  if (!cd || cd.platform === 'desktop') {
    return {
      platform: 'desktop',
      conversationId: cd?.conversationId ?? 'desktop',
      configId: cd?.configId,
      permissionTier: tier,
      identityId: creatorIdentityId,
      automationOrigin: true,
    };
  }
  const manager = getChannelManager();
  const plugin = cd.configId
    ? manager.getPlugin(cd.configId)
    : manager.getPluginByPlatform(cd.platform);
  const botToken = plugin?.getAuthToken?.() ?? undefined;
  return {
    platform: cd.platform,
    conversationId: cd.conversationId,
    configId: cd.configId,
    botToken,
    permissionTier: tier,
    identityId: creatorIdentityId,
    automationOrigin: true,
  };
}

const CONDITION_LLM_MODEL = 'claude-haiku-4-5-20251001';
const CONDITION_LLM_TIMEOUT_MS = 15_000;

/**
 * Lightweight LLM call for condition evaluation (Layer 3).
 * Uses the Anthropic SDK directly with Haiku for fast, cheap responses.
 * Falls back to "satisfied: true" if no API key is available.
 */
async function callConditionLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const creds = resolveApiCredentials();
  if (!creds.apiKey || !isAnthropicNative(creds.baseUrl)) {
    // No Anthropic credentials — fall back to permissive (deliver anyway)
    return JSON.stringify({
      satisfied: true,
      reason: 'No Anthropic API key for condition evaluation',
    });
  }

  const client = new Anthropic({
    apiKey: creds.apiKey,
    ...(creds.baseUrl ? { baseURL: creds.baseUrl } : {}),
  });

  const response = await client.messages.create(
    {
      model: CONDITION_LLM_MODEL,
      max_tokens: 150,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    },
    { signal: AbortSignal.timeout(CONDITION_LLM_TIMEOUT_MS) },
  );

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return text;
}

// ============================================================================
// Run Executor
// ============================================================================

/**
 * Execute a single automation run.
 * Connects to the agent system for actual AI execution.
 */
async function executeRun(
  automationId: string,
  run: AutomationRun,
  payload?: unknown,
): Promise<void> {
  const automation = store.automations.find((a) => a.id === automationId);
  if (!automation) {
    updateRunStatus(run.id, 'failed', 'Automation not found');
    return;
  }

  const abortController = new AbortController();
  const timeoutMs = automation.agent.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  activeRuns.set(run.id, { run, abortController });

  try {
    // Build the prompt, using queue-pickup prompt or appending trigger payload
    let prompt = automation.prompt;
    const queuePayload = payload as
      | { source?: string; taskId?: string; prompt?: string }
      | undefined;
    if (queuePayload?.source === 'queue_pickup' && queuePayload.prompt) {
      // Queue-pickup mode: use assembled context as the prompt
      prompt = queuePayload.prompt;
    } else if (payload) {
      const payloadStr = JSON.stringify(payload, null, 2);
      prompt += `\n\nTrigger payload:\n${payloadStr.length > MAX_PAYLOAD_CHARS ? payloadStr.slice(0, MAX_PAYLOAD_CHARS) + '\n[truncated]' : payloadStr}`;
    }

    // Heartbeat protocol: augment prompt with HEARTBEAT_OK suppression instructions.
    // This tells the agent to use a structured signal when there's nothing to report,
    // enabling language-agnostic suppress-empty detection in delivery.
    if (
      automation.trigger.type === 'heartbeat' &&
      automation.channelDelivery?.suppressEmpty
    ) {
      prompt +=
        '\n\n## Output Protocol' +
        '\n- If you have content to deliver (time, data, results, updates), just output it directly. Do NOT include @@HEARTBEAT_OK.' +
        '\n- ONLY if there is genuinely nothing to report and no action was taken, respond with exactly: @@HEARTBEAT_OK' +
        '\n- Never combine @@HEARTBEAT_OK with actual content. It means "nothing happened" — use it or don\'t.';
    }

    // Model routing for heartbeats: use cheaper model for frequent checks.
    // Frequent heartbeats (< 1 hour) default to Haiku to minimize cost.
    // Users can override via automation.agent.model.
    let modelConfig = getModelConfig();
    if (automation.trigger.type === 'heartbeat' && !automation.agent.model) {
      const intervalMs = automation.trigger.heartbeat.intervalMs;
      if (intervalMs < 60 * 60_000) {
        // Frequent heartbeat: default to cheapest model
        modelConfig = { ...modelConfig, model: 'claude-haiku-4-5-20251001' };
      }
    }

    // Build channelContext so the agent gets slack-search MCP tools and
    // ConnectorPolicy can gate based on the creator's tier (no privilege
    // escalation through scheduled runs).
    const channelContext = resolveChannelContext(
      automation.channelDelivery,
      automation.creatorTier,
      automation.creatorIdentityId,
    );

    if (automation.agent.usePlanning) {
      // Planning phase
      updateRunStatus(run.id, 'planning');

      const planSession = createSession('plan');
      // Wire abort signal to the session
      abortController.signal.addEventListener(
        'abort',
        () => planSession.abortController.abort(),
        { once: true },
      );

      let planId: string | undefined;

      for await (const msg of runPlanningPhase(
        prompt,
        planSession,
        automation.agent.workDir,
        modelConfig,
        undefined, // language
        undefined, // runtimeContext
        undefined, // agentProfileId
        undefined, // taskId
        undefined, // additionalUserDirs
        undefined, // thinkingConfig
        undefined, // pluginId
        undefined, // pluginInputs
        channelContext, // Phase A — propagate caller tier into planning
      )) {
        if (abortController.signal.aborted) throw new Error('Aborted');
        if (msg.type === 'plan' && msg.plan?.id) {
          planId = msg.plan.id;
        }
        if (msg.cost) run.cost = (run.cost ?? 0) + msg.cost;
      }

      if (!planId) throw new Error('Planning did not produce a plan');
      run.planId = planId;

      // If auto-approve is disabled, stop at awaiting_approval
      if (!automation.agent.autoApprove) {
        updateRunStatus(run.id, 'awaiting_approval');
        // Run will be resumed via API later
        return;
      }

      // Execution phase
      updateRunStatus(run.id, 'executing');

      const execSession = createSession('execute');
      abortController.signal.addEventListener(
        'abort',
        () => execSession.abortController.abort(),
        { once: true },
      );

      const execTextParts: string[] = [];
      for await (const msg of runExecutionPhase(
        planId,
        execSession,
        prompt,
        automation.agent.workDir,
        undefined, // taskId
        modelConfig,
        undefined, // sandboxConfig
        undefined, // skillsConfig
        undefined, // mcpConfig
        undefined, // language
        undefined, // runtimeContext
        undefined, // ptcEnabled
        undefined, // mentionedMcpServers
        undefined, // userWorkspaceDir
        undefined, // allowWorkspaceWrite
        undefined, // pinnedSkills
        undefined, // conversation
        undefined, // agentProfileId
        undefined, // additionalUserDirs
        undefined, // autoApprove
        undefined, // thinkingConfig
        undefined, // pluginId
        undefined, // pluginInputs
        channelContext, // Phase A — propagate caller tier into execution
      )) {
        if (abortController.signal.aborted) throw new Error('Aborted');
        if (msg.type === 'text' && msg.content) execTextParts.push(msg.content);
        if (msg.cost) run.cost = (run.cost ?? 0) + msg.cost;
      }
      // Capture accumulated text as run result
      if (execTextParts.length > 0) {
        run.result = execTextParts.join('');
      }
    } else {
      // Direct execution (no planning)
      updateRunStatus(run.id, 'executing');

      const session = createSession('execute');
      abortController.signal.addEventListener(
        'abort',
        () => session.abortController.abort(),
        { once: true },
      );

      const textParts: string[] = [];
      for await (const msg of runAgent(prompt, {
        session,
        workDir: automation.agent.workDir,
        modelConfig,
        channelContext,
      })) {
        if (abortController.signal.aborted) throw new Error('Aborted');
        if (msg.type === 'text' && msg.content) textParts.push(msg.content);
        if (msg.cost) run.cost = (run.cost ?? 0) + msg.cost;
      }
      // Capture accumulated text as run result
      if (textParts.length > 0) {
        run.result = textParts.join('');
      }
    }

    // State machine handles completedAt + durationMs via updateRunStatus
    updateRunStatus(run.id, 'completed');
    void emit('run:completed', {
      automationId,
      runId: run.id,
      data: {
        name: automation.name,
        status: 'completed',
        result: run.result?.slice(0, 500),
        durationMs: run.durationMs,
        cost: run.cost,
        origin: automation.origin,
      },
    });
  } catch (err) {
    const status: AutomationRunStatus = abortController.signal.aborted
      ? 'timed_out'
      : 'failed';
    const errorMsg = err instanceof Error ? err.message : String(err);
    // State machine handles completedAt + durationMs via updateRunStatus
    updateRunStatus(run.id, status, errorMsg);
    void emit('run:failed', {
      automationId,
      runId: run.id,
      data: {
        name: automation.name,
        error: errorMsg,
        origin: automation.origin,
      },
    });
  } finally {
    clearTimeout(timeoutId);
    activeRuns.delete(run.id);

    // Track cost and run count
    if (TERMINAL_STATUSES.has(run.status)) {
      recordRunCost(automation, run.cost ?? 0, store);
    }

    // Condition evaluation (check-and-notify pattern)
    let shouldDeliver = true;
    if (
      TERMINAL_STATUSES.has(run.status) &&
      run.status === 'completed' &&
      automation.condition &&
      run.result
    ) {
      try {
        const evalResult = await evaluateCondition(
          run.result,
          automation.condition,
          {
            lastResultHash: automation.lastResultHash,
            consecutiveQuietRuns: automation.consecutiveQuietRuns ?? 0,
          },
          callConditionLLM,
        );

        // Persist condition state — use the hash returned by evaluator
        if (evalResult.resultHash) {
          automation.lastResultHash = evalResult.resultHash;
        }

        if (!evalResult.satisfied) {
          automation.consecutiveQuietRuns =
            (automation.consecutiveQuietRuns ?? 0) + 1;
          shouldDeliver = false;
          logger.info('Condition not met, skipping delivery', {
            automationId,
            reason: evalResult.reason,
          });
          void emit('run:condition_not_met', {
            automationId,
            runId: run.id,
            data: { reason: evalResult.reason },
          });
        } else {
          automation.consecutiveQuietRuns = 0;
        }

        saveStore(store);
      } catch (err) {
        logger.error('Condition evaluation failed:', err);
        // On failure, deliver anyway
      }
    }

    // Deliver notification and inject into task conversation.
    // deliver() returns true if result was actually delivered (not suppressed).
    // Only inject into the task when delivery succeeded — suppressed results
    // (HEARTBEAT_OK, duplicates) should not clutter the conversation.
    if (TERMINAL_STATUSES.has(run.status) && shouldDeliver) {
      let delivered = false;
      try {
        delivered = await deliver(run, automation);
      } catch (err) {
        logger.error('Delivery failed:', err);
      }

      // Inject result into originating task's conversation (desktop UX).
      // Skip injection for channel-originated automations — they deliver
      // to the channel directly and should not clutter the desktop chat.
      if (
        delivered &&
        automation.originSessionId &&
        run.result &&
        automation.origin !== 'channel'
      ) {
        try {
          injectResultIntoTask(automation, run);
        } catch (err) {
          logger.warn('Failed to inject result into task:', err);
        }
      }
    }

    evictOldRuns();
    void processQueue();
  }
}

// ============================================================================
// Task Message Injection
// ============================================================================

/**
 * Inject an automation run result into the originating task's message history.
 *
 * This makes heartbeat/cron results visible in the desktop chat conversation
 * where the automation was created. Messages are persisted in SQLite and
 * survive app restarts.
 *
 * Uses message_id for idempotency — the same run won't be injected twice
 * (e.g., if the engine retries delivery after a crash).
 */
function injectResultIntoTask(
  automation: Automation,
  run: AutomationRun,
): void {
  if (!automation.originSessionId) return;

  // Check the task exists in the database
  const task = getTask(automation.originSessionId);
  if (!task) {
    logger.debug('Origin task not found, skipping message injection', {
      automationId: automation.id,
      originSessionId: automation.originSessionId,
    });
    return;
  }

  // Idempotency: use run.id as message_id to prevent duplicates
  const msgId = `automation-run-${run.id}`;
  if (messageExists(msgId)) return;

  const statusEmoji = run.status === 'completed' ? '\u2705' : '\u274C';
  const header = `${statusEmoji} **${automation.name}**`;
  const body = run.error
    ? `Error: ${run.error.slice(0, 500)}`
    : (run.result ?? '');
  const costStr = run.cost ? ` \u00B7 $${run.cost.toFixed(4)}` : '';
  const durationStr = run.durationMs
    ? ` \u00B7 ${Math.round(run.durationMs / 1000)}s`
    : '';
  const footer = `_run #${automation.runCount}${durationStr}${costStr}_`;

  const content = [header, body, footer].filter(Boolean).join('\n\n');

  createMessage({
    task_id: automation.originSessionId,
    type: 'text',
    content,
    message_id: msgId,
    run_id: run.id,
    subtype: 'automation_result',
    cost: run.cost ?? null,
  });

  logger.info('Injected automation result into task', {
    automationId: automation.id,
    taskId: automation.originSessionId,
    runId: run.id,
  });
}

// ============================================================================
// Webhook Support
// ============================================================================

/**
 * Handle an incoming webhook request by slug.
 * Delegates to the webhook handler with engine's lookup and enqueue functions.
 */
export async function handleWebhookRequest(
  slug: string,
  request: Request,
): Promise<Response> {
  const lookupBySlug = (s: string): Automation | undefined => {
    return store.automations.find(
      (a) =>
        a.trigger.type === 'webhook' &&
        a.trigger.webhook.slug === s &&
        a.enabled,
    );
  };

  return handleWebhook(
    slug,
    request,
    lookupBySlug,
    (id, triggeredBy, payload) => {
      enqueue(id, triggeredBy, payload);
    },
  );
}

// ============================================================================
// Housekeeping
// ============================================================================

/**
 * Evict old runs past TTL or over the per-automation cap.
 */
function evictOldRuns(): void {
  const now = Date.now();
  const cutoff = now - AUTOMATION_RUN_TTL_MS;

  // Remove runs older than TTL
  store.runs = store.runs.filter((r) => {
    const queuedTime = new Date(r.queuedAt).getTime();
    return queuedTime > cutoff;
  });

  // Cap runs per automation
  const runsByAutomation = new Map<string, AutomationRun[]>();
  for (const run of store.runs) {
    const existing = runsByAutomation.get(run.automationId) ?? [];
    existing.push(run);
    runsByAutomation.set(run.automationId, existing);
  }

  for (const [, runs] of runsByAutomation) {
    if (runs.length > MAX_STORED_RUNS_PER_AUTOMATION) {
      // Sort by queuedAt descending, keep only the newest
      runs.sort(
        (a, b) =>
          new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime(),
      );
      const toRemove = new Set(
        runs.slice(MAX_STORED_RUNS_PER_AUTOMATION).map((r) => r.id),
      );
      store.runs = store.runs.filter((r) => !toRemove.has(r.id));
    }
  }
}

/**
 * Detect and recover stale runs from a previous crash.
 * Runs stuck in 'planning' or 'executing' are marked as failed
 * via the state machine to ensure consistent transition handling.
 */
function detectStaleRuns(): void {
  let staleCount = 0;
  for (const run of store.runs) {
    if (run.status === 'planning' || run.status === 'executing') {
      updateRunStatus(run.id, 'failed', 'Recovered after restart');
      staleCount++;
    }
  }

  if (staleCount > 0) {
    logger.info('Recovered stale runs', { count: staleCount });
  }
}
