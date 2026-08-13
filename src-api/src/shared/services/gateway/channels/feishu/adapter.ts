/**
 * Feishu (Lark) Channel Adapter
 *
 * Uses @larksuiteoapi/node-sdk WSClient long-connection (preferred for desktop)
 * with EventDispatcher to receive im.message.receive_v1 events.
 *
 * Channel id: 'feishu' (kept on the wire and in DB to match registry/routing).
 */

import * as Lark from '@larksuiteoapi/node-sdk';

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

const logger = createLogger('FeishuAdapter');

interface FeishuConfig extends ChannelConfig {
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  /** 'feishu' (default) or 'lark' for international tenants */
  domain?: 'feishu' | 'lark';
}

interface ImMessageReceiveData {
  sender: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: string;
    message_type: string;
    content: string;
    create_time: string;
  };
}

class FeishuAdapter implements ChannelAdapter {
  readonly id = 'feishu';
  readonly name = 'Feishu';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 5000,
    supportsMarkdown: false,
    supportsThreads: true,
    supportsReactions: false,
    supportsImages: true,
    supportsButtons: false,
    supportsCommands: true,
    supportsEditMessage: false,
    supportsRichCards: true,
    runtimeClass: 'official',
  };

  private client: Lark.Client | null = null;
  private wsClient: Lark.WSClient | null = null;
  private connected = false;
  private currentHealth: ChannelHealth = 'disabled';
  private messageHandler: InboundHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;

  constructor(private config: FeishuConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const domain =
      this.config.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;

    this.client = new Lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain,
    });

    const dispatcher = new Lark.EventDispatcher({
      encryptKey: this.config.encryptKey,
      verificationToken: this.config.verificationToken,
      loggerLevel: Lark.LoggerLevel.warn,
    }).register({
      'im.message.receive_v1': async (data) => {
        await this.handleInbound(data as ImMessageReceiveData);
        return { code: 0 };
      },
    });

    this.wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain,
      loggerLevel: Lark.LoggerLevel.warn,
    });

    try {
      // start() returns a promise that resolves once the WS handshake completes
      await this.wsClient.start({ eventDispatcher: dispatcher });
      this.connected = true;
      this.setHealth('connected');
      logger.info('Feishu WSClient connected');
    } catch (err) {
      this.setHealth('degraded');
      this.errorHandler?.(
        err instanceof Error ? err : new Error(String(err)),
        'ws_start',
      );
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.setHealth('disabled');
    try {
      this.wsClient?.close({ force: true });
    } catch {
      // already closed
    }
    this.wsClient = null;
    this.client = null;
    logger.info('Feishu WSClient disconnected');
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
    if (!this.client) {
      return { messageId: '', success: false, error: 'Client not initialized' };
    }
    try {
      // Feishu text messages have a practical 5k char limit; chunk if larger.
      const text = content.text ?? '';
      const chunks =
        text.length > this.capabilities.maxMessageLength
          ? chunkText(text, this.capabilities.maxMessageLength)
          : [text];

      let lastMessageId = '';
      for (const chunk of chunks) {
        const res = await this.client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: chunk }),
          },
        });
        const id =
          (res as { data?: { message_id?: string } } | undefined)?.data
            ?.message_id ?? '';
        if (id) lastMessageId = id;
      }
      return { messageId: lastMessageId, success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to send Feishu message to ${chatId}`, errorMsg);
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

  private setHealth(health: ChannelHealth): void {
    if (this.currentHealth === health) return;
    this.currentHealth = health;
    this.presenceHandler?.(health);
  }

  private async handleInbound(data: ImMessageReceiveData): Promise<void> {
    if (!this.messageHandler) return;
    const message = data.message;
    const sender = data.sender;

    let plain = '';
    let contentType: InboundMessage['contentType'] = 'text';
    if (message.message_type === 'text') {
      try {
        const parsed = JSON.parse(message.content) as { text?: string };
        plain = parsed.text ?? '';
      } catch {
        plain = message.content;
      }
    } else if (message.message_type === 'image') {
      contentType = 'image';
    } else if (message.message_type === 'file') {
      contentType = 'file';
    } else {
      // Other types (post, audio, sticker, interactive) — pass raw content
      plain = message.content;
    }

    const senderId =
      sender.sender_id?.open_id ??
      sender.sender_id?.union_id ??
      sender.sender_id?.user_id ??
      'unknown';

    const inbound: InboundMessage = {
      channelId: 'feishu',
      chatId: message.chat_id,
      senderId,
      senderName: senderId,
      content: plain,
      contentType,
      messageId: message.message_id,
      threadId: message.thread_id ?? message.root_id,
      timestamp: new Date(Number(message.create_time)).toISOString(),
      raw: data,
    };

    try {
      await this.messageHandler(inbound);
    } catch (err) {
      logger.error('Error handling Feishu message', err);
      this.errorHandler?.(
        err instanceof Error ? err : new Error(String(err)),
        'message_handler',
      );
    }
  }
}

function chunkText(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    out.push(text.slice(i, i + max));
  }
  return out;
}

registerChannel(
  'feishu',
  (config) => {
    const cfg = config as FeishuConfig;
    if (!cfg.appId || !cfg.appSecret) {
      logger.warn('Feishu adapter requires appId + appSecret');
      return null;
    }
    if (!cfg.encryptKey || !cfg.verificationToken) {
      logger.warn(
        'Feishu adapter requires encryptKey + verificationToken (refusing to start)',
      );
      return null;
    }
    return new FeishuAdapter(cfg);
  },
  {
    capabilities: new FeishuAdapter({
      enabled: false,
      appId: '',
      appSecret: '',
      encryptKey: '',
      verificationToken: '',
    }).capabilities,
  },
);
