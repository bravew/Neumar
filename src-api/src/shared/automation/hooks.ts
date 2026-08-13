/**
 * Automation Hooks System
 *
 * Internal event hooks for automation lifecycle events.
 * Handlers are called asynchronously and errors are isolated per handler.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AutomationHooks');

// ============================================================================
// Types
// ============================================================================

/** All supported automation lifecycle events */
export type AutomationEvent =
  | 'automation:created'
  | 'automation:updated'
  | 'automation:deleted'
  | 'automation:enabled'
  | 'automation:disabled'
  | 'automation:expired'
  | 'automation:budget_exhausted'
  | 'automation:max_runs_reached'
  | 'automation:consecutive_failures'
  | 'automation:global_budget_exhausted'
  | 'automation:overlap_skipped'
  | 'automation:missed_fire_recovered'
  | 'run:queued'
  | 'run:started'
  | 'run:completed'
  | 'run:failed'
  | 'run:cancelled'
  | 'run:condition_not_met'
  | 'run:delivery_suppressed'
  | 'engine:started'
  | 'engine:shutdown';

/** Payload passed to event handlers */
export interface AutomationEventPayload {
  event: AutomationEvent;
  automationId?: string;
  runId?: string;
  data?: unknown;
  timestamp: string;
}

/** Handler function for automation events */
export type AutomationHookHandler = (
  payload: AutomationEventPayload,
) => Promise<void> | void;

// ============================================================================
// Module-Level State
// ============================================================================

const handlers = new Map<AutomationEvent, Set<AutomationHookHandler>>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Register a handler for an automation event.
 */
export function on(
  event: AutomationEvent,
  handler: AutomationHookHandler,
): void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
  }
  handlers.get(event)!.add(handler);
}

/**
 * Remove a handler for an automation event.
 */
export function off(
  event: AutomationEvent,
  handler: AutomationHookHandler,
): void {
  const eventHandlers = handlers.get(event);
  if (eventHandlers) {
    eventHandlers.delete(handler);
  }
}

/**
 * Emit an automation event, calling all registered handlers.
 * Each handler is wrapped in try-catch to prevent one handler from breaking others.
 */
export async function emit(
  event: AutomationEvent,
  context?: { automationId?: string; runId?: string; data?: unknown },
): Promise<void> {
  const eventHandlers = handlers.get(event);
  if (!eventHandlers || eventHandlers.size === 0) return;

  const payload: AutomationEventPayload = {
    event,
    automationId: context?.automationId,
    runId: context?.runId,
    data: context?.data,
    timestamp: new Date().toISOString(),
  };

  const promises = Array.from(eventHandlers).map(async (handler) => {
    try {
      await handler(payload);
    } catch (err) {
      logger.error('Hook handler error:', {
        event,
        error: err,
      });
    }
  });

  await Promise.all(promises);
}
