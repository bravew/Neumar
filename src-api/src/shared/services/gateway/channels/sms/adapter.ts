/**
 * SMS Channel Adapter (placeholder)
 *
 * Twilio integration deferred. The adapter ships disabled and surfaces a
 * configuration banner via the channels admin API.
 */

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

const logger = createLogger('SmsAdapter');

export const SMS_SETUP_BANNER =
  'SMS adapter requires Twilio credentials and per-number compliance review.';

interface SmsConfig extends ChannelConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
}

class SmsAdapter implements ChannelAdapter {
  readonly id = 'sms';
  readonly name = 'SMS';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 1600,
    supportsMarkdown: false,
    supportsThreads: false,
    supportsReactions: false,
    supportsImages: true,
    supportsButtons: false,
    supportsCommands: false,
    supportsEditMessage: false,
    supportsRichCards: false,
    runtimeClass: 'experimental',
  };

  private currentHealth: ChannelHealth = 'disabled';
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;
  private errorHandler: ErrorHandler | null = null;

  constructor(private config: SmsConfig) {}

  async connect(): Promise<void> {
    if (
      !this.config.accountSid ||
      !this.config.authToken ||
      !this.config.fromNumber
    ) {
      const err = new Error(SMS_SETUP_BANNER);
      this.errorHandler?.(err, 'config_missing');
      throw err;
    }
    this.setHealth('quarantined');
    logger.warn('SMS adapter is a placeholder; sends will fail');
  }

  async disconnect(): Promise<void> {
    this.setHealth('disabled');
  }

  isConnected(): boolean {
    return false;
  }

  health(): ChannelHealth {
    return this.currentHealth;
  }

  async sendMessage(
    _chatId: string,
    _content: OutboundContent,
  ): Promise<SendResult> {
    return {
      messageId: '',
      success: false,
      error: 'SMS adapter not yet implemented',
    };
  }

  onMessage = (_handler: InboundHandler): void => {};

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
}

registerChannel(
  'sms',
  (config) => {
    if (!config.enabled) return null;
    return new SmsAdapter(config as SmsConfig);
  },
  {
    capabilities: new SmsAdapter({ enabled: false }).capabilities,
  },
);
