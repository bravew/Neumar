/**
 * WhatsApp Business Cloud API channel adapter.
 *
 * WhatsApp Web/Baileys automation remains intentionally out of this runtime
 * path. This adapter only supports Meta's official Cloud API.
 */

import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import { registerChannel } from '../registry';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelConfig,
  ChannelHealth,
  ErrorHandler,
  InboundHandler,
  OutboundContent,
  SendResult,
} from '../types';
import {
  DEFAULT_WHATSAPP_GRAPH_VERSION,
  normalizeWhatsAppTarget,
  normalizeWhatsAppWebhook,
  parseWhatsAppCloudConfig,
  sendWhatsAppCloudMessage,
  uploadWhatsAppMedia,
  type WhatsAppCloudConfig,
} from './cloud';

const logger = createLogger('WhatsAppAdapter');

class WhatsAppAdapter implements ChannelAdapter {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 4096,
    supportsMarkdown: true,
    supportsThreads: false,
    supportsReactions: false,
    supportsImages: true,
    supportsButtons: true,
    supportsCommands: false,
    supportsEditMessage: false,
    supportsRichCards: true,
    runtimeClass: 'official',
  };

  private currentHealth: ChannelHealth = 'disabled';
  private connected = false;
  private messageHandler: InboundHandler | null = null;
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;
  private errorHandler: ErrorHandler | null = null;
  private cloudConfig: WhatsAppCloudConfig;

  constructor(config: ChannelConfig) {
    this.cloudConfig = parseWhatsAppCloudConfig(config);
  }

  async connect(): Promise<void> {
    try {
      const probe = await fetch(
        `https://graph.facebook.com/${this.cloudConfig.graphVersion ?? DEFAULT_WHATSAPP_GRAPH_VERSION}/${this.cloudConfig.phoneNumberId}`,
        {
          headers: { Authorization: `Bearer ${this.cloudConfig.accessToken}` },
        },
      );
      if (!probe.ok) {
        throw new Error(`WhatsApp Cloud probe failed: ${probe.status}`);
      }
      this.connected = true;
      this.setHealth('connected');
      logger.info('WhatsApp Cloud adapter connected');
    } catch (err) {
      this.connected = false;
      this.setHealth('degraded');
      this.errorHandler?.(
        err instanceof Error ? err : new Error(String(err)),
        'connect',
      );
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.setHealth('disabled');
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
    if (!this.connected) {
      return { messageId: '', success: false, error: 'Not connected' };
    }
    try {
      const to = normalizeWhatsAppTarget(chatId);
      let lastId = '';
      if (content.text) {
        lastId = await sendWhatsAppCloudMessage({
          config: this.cloudConfig,
          to,
          content,
        });
      }

      for (const file of content.files ?? []) {
        const mediaId = await uploadWhatsAppMedia({
          config: this.cloudConfig,
          filePath: file.filePath,
        });
        lastId = await sendWhatsAppCloudMessage({
          config: this.cloudConfig,
          to,
          content: mediaContentFor(file.filePath, mediaId),
        });
      }

      return { messageId: lastId, success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to send WhatsApp message to ${chatId}`, errorMsg);
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

  async handleWebhookEvent(payload: unknown): Promise<void> {
    if (!this.messageHandler) return;
    const messages = normalizeWhatsAppWebhook(payload, {
      graphVersion: this.cloudConfig.graphVersion,
    });
    for (const message of messages) {
      try {
        await this.messageHandler(message);
      } catch (err) {
        logger.error('Error handling WhatsApp webhook', err);
        this.errorHandler?.(
          err instanceof Error ? err : new Error(String(err)),
          'webhook_handler',
        );
      }
    }
  }

  webhookVerifyToken(): string {
    return this.cloudConfig.webhookVerifyToken;
  }

  appSecret(): string {
    return this.cloudConfig.appSecret;
  }

  private setHealth(health: ChannelHealth): void {
    if (this.currentHealth === health) return;
    this.currentHealth = health;
    this.presenceHandler?.(health);
  }
}

function mediaContentFor(filePath: string, mediaId: string): OutboundContent {
  const ext = path.extname(filePath).toLowerCase();
  const type = /\.(png|jpe?g|gif|webp)$/i.test(ext)
    ? 'image'
    : /\.(mp4|mov)$/i.test(ext)
      ? 'video'
      : /\.(ogg|opus|mp3|m4a|wav)$/i.test(ext)
        ? 'audio'
        : 'document';
  return {
    text: '',
    format: 'plain',
    // Private marker consumed by buildWhatsAppMessagePayload.
    [`__whatsapp_${type}_id`]: mediaId,
    __whatsapp_media_type: type,
    __whatsapp_media_id: mediaId,
  } as OutboundContent;
}

registerChannel(
  'whatsapp',
  (config) => {
    if (!config.enabled) return null;
    try {
      return new WhatsAppAdapter(config);
    } catch (err) {
      logger.warn(
        `WhatsApp Cloud adapter not created: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  },
  {
    capabilities: {
      maxMessageLength: 4096,
      supportsMarkdown: true,
      supportsThreads: false,
      supportsReactions: false,
      supportsImages: true,
      supportsButtons: true,
      supportsCommands: false,
      supportsEditMessage: false,
      supportsRichCards: true,
      runtimeClass: 'official',
    },
  },
);

export { WhatsAppAdapter };
