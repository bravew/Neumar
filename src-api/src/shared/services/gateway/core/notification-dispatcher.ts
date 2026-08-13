/**
 * Notification Dispatcher
 *
 * Delivers event notifications to subscribed channels.
 */

import { createLogger } from '@/shared/utils/logger';

import type { ChannelAdapter } from '../channels/types';
import * as db from '../shared/db/operations';
import { sendWithRetry } from './outbound-pipeline';

const logger = createLogger('NotifDispatcher');

export async function dispatchNotification(
  eventType: string,
  message: string,
  adapters: Map<string, ChannelAdapter>,
): Promise<void> {
  const subscriptions = db.getSubscriptions(eventType);

  for (const sub of subscriptions) {
    const adapter = adapters.get(sub.channel_id);
    if (!adapter?.isConnected()) {
      logger.debug(
        `Skipping notification to ${sub.channel_id} (not connected)`,
      );
      continue;
    }

    try {
      await sendWithRetry(adapter, sub.channel_chat_id, {
        text: message,
        format: 'markdown',
      });
    } catch (err) {
      logger.error(
        `Failed to dispatch notification to ${sub.channel_id}:${sub.channel_chat_id}`,
        err,
      );
    }
  }
}
