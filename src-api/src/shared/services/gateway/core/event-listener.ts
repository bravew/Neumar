/**
 * Event Listener
 *
 * Subscribes to taskEventBus for task lifecycle events and
 * dispatches notifications to subscribed channels.
 */

import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

import type { ChannelAdapter } from '../channels/types';
import { dispatchNotification } from './notification-dispatcher';

const logger = createLogger('GatewayEventListener');

/**
 * Strip markdown control characters and platform mentions from user content
 * so it renders as plain text inside notification messages.
 */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_~`[\]()>#+\-!|\\]/g, '')
    .replace(/@(everyone|here|channel)\b/gi, '$1')
    .trim();
}

let unsubscribers: (() => void)[] = [];
let channelAdapters: Map<string, ChannelAdapter> | null = null;

export function startEventListeners(
  adapters: Map<string, ChannelAdapter>,
): void {
  logger.info('Starting gateway event listeners');
  channelAdapters = adapters;
  logger.debug('Event listeners ready');
}

/**
 * Watch a gateway-initiated task for completion/error events.
 * Subscribes to the taskEventBus and dispatches notifications
 * to subscribed channels when the task finishes.
 */
export function watchTask(taskId: string, taskTitle: string): void {
  if (!channelAdapters) {
    logger.warn(`Cannot watch task ${taskId}: gateway not started`);
    return;
  }

  const adapters = channelAdapters;
  const safeTitle = sanitizeTitle(taskTitle);
  let settled = false;

  const unsub = taskEventBus.subscribe(taskId, (message) => {
    if (settled) return;
    const msg = message as { type?: string; error?: string };

    if (msg.type === 'done') {
      settled = true;
      dispatchNotification(
        'task_complete',
        `Task completed: **${safeTitle}** (${taskId})`,
        adapters,
      ).catch((err) =>
        logger.error(`Failed to dispatch task_complete for ${taskId}`, err),
      );
      cleanup();
    } else if (msg.type === 'error') {
      settled = true;
      dispatchNotification(
        'task_error',
        `Task error: ${taskId}\n${msg.error ?? 'Unknown error'}`,
        adapters,
      ).catch((err) =>
        logger.error(`Failed to dispatch task_error for ${taskId}`, err),
      );
      cleanup();
    }
  });

  unsubscribers.push(unsub);

  function cleanup() {
    unsub();
    const idx = unsubscribers.indexOf(unsub);
    if (idx !== -1) unsubscribers.splice(idx, 1);
  }

  logger.debug(`Watching task ${taskId} for lifecycle events`);
}

export function stopEventListeners(): void {
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];
  channelAdapters = null;
  logger.info('Stopped gateway event listeners');
}
