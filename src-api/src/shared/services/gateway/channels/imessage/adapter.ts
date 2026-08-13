/**
 * iMessage Channel Adapter (BlueBubbles bridge)
 *
 * Talks to a user-run BlueBubbles server on macOS. macOS only, opt-in.
 * The user must accept the consent dialog (sets `imessage.consent.acceptedAt`)
 * before connect() will succeed.
 *
 * Inbound flow: BlueBubbles posts webhook events to the user's gateway URL.
 * Wire those events to `handleWebhookEvent()` from the HTTP route layer.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { getSetting } from '@/shared/db/operations';
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
import { probeBlueBubbles } from './probe';
import { parseIMessageTarget, resolveIMessageChatGuid } from './targets';
import {
  normalizeBlueBubblesWebhook,
  type BlueBubblesMessageEvent,
} from './webhook';

const logger = createLogger('iMessageAdapter');
const CONSENT_KEY = 'imessage.consent.acceptedAt';

interface IMessageConfig extends ChannelConfig {
  /** BlueBubbles server URL, e.g. http://127.0.0.1:1234 */
  serverUrl: string;
  /** BlueBubbles password (sent as the `password` query param) */
  password: string;
  /** Optional HMAC secret for webhook verification. Defaults to password. */
  webhookSecret?: string;
}

class IMessageAdapter implements ChannelAdapter {
  readonly id = 'imessage';
  readonly name = 'iMessage';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 10000,
    supportsMarkdown: false,
    supportsThreads: false,
    supportsReactions: true,
    supportsImages: true,
    supportsButtons: false,
    supportsCommands: false,
    supportsEditMessage: false,
    supportsRichCards: false,
    runtimeClass: 'bridge',
  };

  private connected = false;
  private currentHealth: ChannelHealth = 'disabled';
  private messageHandler: InboundHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;

  constructor(private config: IMessageConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    if (process.platform !== 'darwin') {
      const err = new Error('iMessage requires macOS host');
      this.setHealth('disabled');
      this.errorHandler?.(err, 'unsupported_host');
      throw err;
    }

    const consent = getSetting(CONSENT_KEY);
    if (!consent) {
      const err = new Error(
        'iMessage adapter requires consent — set imessage.consent.acceptedAt first',
      );
      this.errorHandler?.(err, 'consent_missing');
      throw err;
    }

    const probe = await probeBlueBubbles({
      serverUrl: this.config.serverUrl,
      password: this.config.password,
    });
    if (!probe.ok) {
      const err = new Error(probe.error ?? 'BlueBubbles probe failed');
      this.setHealth('degraded');
      this.errorHandler?.(err, 'probe');
      throw err;
    }

    this.connected = true;
    this.setHealth('connected');
    logger.info('iMessage adapter connected', {
      host: probe.host,
      version: probe.version,
      accountState: probe.accountState,
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.setHealth('disabled');
    logger.info('iMessage adapter disconnected');
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
      const chatGuid = await this.resolveChatGuid(chatId);
      let lastMessageId = '';
      // Authenticate via the `password` header rather than the URL query param
      // so the secret stays out of BlueBubbles access logs and any HTTP proxy.
      if (content.text) {
        const res = await fetch(
          `${this.config.serverUrl}/api/v1/message/text`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              password: this.config.password,
            },
            body: JSON.stringify({
              chatGuid,
              message: content.text.slice(
                0,
                this.capabilities.maxMessageLength,
              ),
              method: 'apple-script',
            }),
          },
        );
        if (!res.ok) {
          return {
            messageId: '',
            success: false,
            error: `BlueBubbles send ${res.status}`,
          };
        }
        lastMessageId = await parseMessageGuid(res);
      }

      for (const file of content.files ?? []) {
        lastMessageId = await this.sendAttachment(chatGuid, file.filePath);
      }

      return {
        messageId: lastMessageId,
        success: true,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to send iMessage to ${chatId}`, errorMsg);
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
   * Called by the gateway HTTP route that receives BlueBubbles webhook posts.
   */
  async handleWebhookEvent(
    eventType: string,
    payload: BlueBubblesMessageEvent,
  ): Promise<void> {
    if (!this.messageHandler) return;
    const inbound = normalizeBlueBubblesWebhook(eventType, payload);
    if (!inbound) return;

    try {
      await this.messageHandler(inbound);
    } catch (err) {
      logger.error('Error handling iMessage webhook', err);
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

  webhookSecret(): string {
    return this.config.webhookSecret || this.config.password;
  }

  async sendReaction(params: {
    chatGuid: string;
    messageGuid: string;
    emoji: string;
    remove?: boolean;
  }): Promise<boolean> {
    if (!this.connected) return false;
    try {
      const res = await fetch(`${this.config.serverUrl}/api/v1/message/react`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          password: this.config.password,
        },
        body: JSON.stringify({
          chatGuid: params.chatGuid,
          selectedMessageGuid: params.messageGuid,
          reaction: normalizeTapback(params.emoji, params.remove),
          partIndex: 0,
        }),
      });
      if (res.ok) return true;
    } catch (err) {
      logger.warn('BlueBubbles tapback failed, downgrading to text', err);
    }
    await this.sendMessage(params.chatGuid, {
      text: `${params.remove ? 'Removed reaction' : 'Reacted'}: ${params.emoji}`,
    });
    return false;
  }

  private async resolveChatGuid(raw: string): Promise<string> {
    return resolveIMessageChatGuid({
      serverUrl: this.config.serverUrl,
      password: this.config.password,
      target: parseIMessageTarget(raw),
    });
  }

  private async sendAttachment(
    chatGuid: string,
    filePath: string,
  ): Promise<string> {
    const stat = await fs.stat(filePath);
    const maxBytes = 100 * 1024 * 1024;
    if (stat.size > maxBytes) {
      throw new Error(
        `BlueBubbles attachment exceeds 100MB: ${path.basename(filePath)}`,
      );
    }
    const form = new FormData();
    form.set('chatGuid', chatGuid);
    form.set('method', 'apple-script');
    form.set(
      'attachment',
      new Blob([await fs.readFile(filePath)]),
      path.basename(filePath),
    );
    const res = await fetch(
      `${this.config.serverUrl}/api/v1/message/attachment`,
      {
        method: 'POST',
        headers: { password: this.config.password },
        body: form,
      },
    );
    if (!res.ok) throw new Error(`BlueBubbles attachment send ${res.status}`);
    return parseMessageGuid(res);
  }
}

async function parseMessageGuid(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as {
    data?: { guid?: string; messageGuid?: string };
    guid?: string;
  } | null;
  return json?.data?.guid ?? json?.data?.messageGuid ?? json?.guid ?? '';
}

function normalizeTapback(emoji: string, remove?: boolean): string {
  const mapped: Record<string, string> = {
    heart: 'love',
    love: 'love',
    thumbs_up: 'like',
    thumbsup: 'like',
    '+1': 'like',
    like: 'like',
    thumbs_down: 'dislike',
    dislike: 'dislike',
    laugh: 'laugh',
    haha: 'laugh',
    emphasize: 'emphasize',
    exclaim: 'emphasize',
    question: 'question',
  };
  const normalized = mapped[emoji.trim().toLowerCase()] ?? emoji.trim();
  return remove ? `-${normalized}` : normalized;
}

registerChannel(
  'imessage',
  (config) => {
    const cfg = config as IMessageConfig;
    if (!cfg.serverUrl || !cfg.password) {
      logger.warn('iMessage adapter requires serverUrl + password');
      return null;
    }
    return new IMessageAdapter(cfg);
  },
  {
    capabilities: new IMessageAdapter({
      enabled: false,
      serverUrl: '',
      password: '',
    }).capabilities,
  },
);

export { IMessageAdapter, CONSENT_KEY };
