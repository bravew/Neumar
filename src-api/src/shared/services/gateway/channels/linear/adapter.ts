/**
 * Linear Channel Adapter
 *
 * Wraps the existing Linear pipeline so issue comments flow through the
 * gateway like any other channel.
 *
 * chatId format: `linear:<teamKey>/<issueId>` (teamKey is informational; the
 * issueId is what addIssueComment requires).
 */

import {
  addIssueComment,
  getLinearClientAsync,
} from '@/shared/services/linear';
import { createLogger } from '@/shared/utils/logger';

import { registerChannel } from '../registry';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelConfig,
  ChannelHealth,
  ErrorHandler,
  InboundHandler,
  InboundMessage,
  OutboundContent,
  SendResult,
} from '../types';

const logger = createLogger('LinearAdapter');

interface LinearWebhookCommentPayload {
  type: 'Comment';
  action: 'create' | 'update' | 'remove';
  data: {
    id: string;
    body: string;
    issueId: string;
    user?: { id?: string; name?: string };
    createdAt?: string;
  };
  url?: string;
}

interface LinearTeamLookup {
  issueId: string;
  teamKey: string;
}

class LinearAdapter implements ChannelAdapter {
  readonly id = 'linear';
  readonly name = 'Linear';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 65536,
    supportsMarkdown: true,
    supportsThreads: true,
    supportsReactions: false,
    supportsImages: false,
    supportsButtons: false,
    supportsCommands: true,
    supportsEditMessage: false,
    supportsRichCards: false,
    runtimeClass: 'official',
  };

  private connected = false;
  private currentHealth: ChannelHealth = 'disabled';
  private messageHandler: InboundHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      // Validates that an API key is configured.
      await getLinearClientAsync();
      this.connected = true;
      this.setHealth('connected');
      logger.info('Linear adapter connected');
    } catch (err) {
      this.setHealth('degraded');
      this.errorHandler?.(
        err instanceof Error ? err : new Error(String(err)),
        'auth',
      );
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.setHealth('disabled');
    logger.info('Linear adapter disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  health(): ChannelHealth {
    return this.currentHealth;
  }

  async sendMessage(
    chatId: string,
    content: OutboundContent,
  ): Promise<SendResult> {
    const parsed = parseChatId(chatId);
    if (!parsed) {
      return {
        messageId: '',
        success: false,
        error: `Invalid Linear chatId: ${chatId}`,
      };
    }
    try {
      await addIssueComment(parsed.issueId, content.text);
      return { messageId: parsed.issueId, success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to add Linear comment to ${chatId}`, errorMsg);
      return { messageId: '', success: false, error: errorMsg };
    }
  }

  onMessage = (handler: InboundHandler): void => {
    this.messageHandler = handler;
  };

  onError = (handler: ErrorHandler): void => {
    this.errorHandler = handler;
  };

  onPresenceChange = (handler: (health: ChannelHealth) => void): void => {
    this.presenceHandler = handler;
  };

  /**
   * Called by the Linear webhook route when a Comment event arrives.
   * teamKey is looked up by the caller (typically from the webhook URL
   * or the issue payload).
   */
  async handleCommentWebhook(
    payload: LinearWebhookCommentPayload,
    teamKey: string,
  ): Promise<void> {
    if (!this.messageHandler) return;
    if (payload.type !== 'Comment' || payload.action !== 'create') return;

    const inbound: InboundMessage = {
      channelId: 'linear',
      chatId: `linear:${teamKey}/${payload.data.issueId}`,
      senderId: payload.data.user?.id ?? 'linear-user',
      senderName: payload.data.user?.name ?? 'Linear user',
      content: payload.data.body,
      contentType: 'text',
      messageId: payload.data.id,
      timestamp: payload.data.createdAt ?? new Date().toISOString(),
      raw: payload,
    };

    try {
      await this.messageHandler(inbound);
    } catch (err) {
      logger.error('Error handling Linear comment webhook', err);
      this.errorHandler?.(
        err instanceof Error ? err : new Error(String(err)),
        'webhook_handler',
      );
    }
  }

  private setHealth(health: ChannelHealth): void {
    if (this.currentHealth === health) return;
    this.currentHealth = health;
    this.presenceHandler?.(health);
  }
}

function parseChatId(chatId: string): LinearTeamLookup | null {
  // linear:<teamKey>/<issueId>
  const match = /^linear:([^/]+)\/(.+)$/.exec(chatId);
  if (!match) return null;
  const [, teamKey, issueId] = match;
  return { teamKey: teamKey!, issueId: issueId! };
}

registerChannel(
  'linear',
  (config: ChannelConfig) => {
    if (!config.enabled) return null;
    return new LinearAdapter();
  },
  {
    capabilities: new LinearAdapter().capabilities,
  },
);

export { LinearAdapter };
