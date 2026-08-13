import { createLogger } from '@/shared/utils/logger';

import type {
  BasePluginConfig,
  ChannelCapabilities,
  NormalizedMessage,
  NormalizedResponse,
  PluginLifecycleState,
} from './types';

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 300_000;
const JITTER_FACTOR = 0.3;
const MAX_CONSECUTIVE_CRASHES = 10;

export abstract class BasePlugin {
  /** UUID of the channel_config row this plugin instance serves */
  configId: string = '';

  private _cachedLogger: ReturnType<typeof createLogger> | null = null;
  protected get logger() {
    if (!this._cachedLogger) {
      const suffix = this.configId ? `:${this.configId.slice(0, 8)}` : '';
      this._cachedLogger = createLogger(`Plugin:${this.platform}${suffix}`);
    }
    return this._cachedLogger;
  }
  private _state: PluginLifecycleState = 'created';
  private _restartAttempts = 0;
  private _consecutiveCrashes = 0;
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _messageHandler: ((msg: NormalizedMessage) => Promise<void>) | null =
    null;

  abstract readonly platform: string;
  abstract readonly capabilities: ChannelCapabilities;

  protected abstract onStart(config: BasePluginConfig): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected abstract setupMessageHandler(
    handler: (msg: NormalizedMessage) => Promise<void>,
  ): void;
  abstract sendMessage(
    conversationId: string,
    response: NormalizedResponse,
  ): Promise<{ messageId: string | null }>;
  editMessage?(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<void>;
  /** Send file attachments (images, documents) to the channel. */
  sendFiles?(conversationId: string, filePaths: string[]): Promise<void>;
  /** Send remote image URLs directly as photos (e.g. Telegram sendPhoto supports URLs). */
  sendPhotoUrls?(conversationId: string, urls: string[]): Promise<void>;
  /** Send a platform-native "typing" indicator. Called repeatedly every few seconds while agent is processing. */
  sendTypingAction?(conversationId: string): Promise<void>;
  /** Add a "processing" emoji reaction to a user's message to acknowledge receipt. */
  addReaction?(channel: string, messageTs: string): Promise<void>;
  /** Remove the "processing" emoji reaction after the bot has replied. */
  removeReaction?(channel: string, messageTs: string): Promise<void>;
  /** Add a named emoji reaction to a specific message (for sentiment reactions). */
  addNamedReaction?(
    channel: string,
    messageTs: string,
    emoji: string,
  ): Promise<void>;
  /** Return an auth token for downloading private file URLs (e.g. Slack bot token). */
  getAuthToken?(): string | undefined;
  /** Platform-specific client for advanced features (progress blocks, reactions). */
  getClient?(): unknown;
  ping?(): Promise<boolean>;

  get state(): PluginLifecycleState {
    return this._state;
  }

  async start(config: BasePluginConfig): Promise<void> {
    if (this._state === 'running') return;
    this.configId = config.configId;
    this._cachedLogger = null; // rebuild with new configId
    this._state = 'initializing';
    try {
      await this.onStart(config);
      this._state = 'running';
      this._restartAttempts = 0;
      this._consecutiveCrashes = 0;
      this.logger.info('Plugin started');
    } catch (err) {
      this._state = 'stopped';
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'created') return;
    this._state = 'stopping';
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    try {
      await this.onStop();
    } finally {
      this._state = 'stopped';
      this.logger.info('Plugin stopped');
    }
  }

  async restart(config: BasePluginConfig): Promise<void> {
    this.logger.info('Restarting plugin', {
      attempt: this._restartAttempts + 1,
    });
    await this.stop();
    const delay = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, this._restartAttempts),
      MAX_BACKOFF_MS,
    );
    const jitter = delay * JITTER_FACTOR * (Math.random() - 0.5);
    this._restartAttempts++;
    await new Promise<void>((res) => setTimeout(res, delay + jitter));
    await this.start(config);
  }

  scheduleRestart(config: BasePluginConfig): void {
    if (this._restartTimer) return;
    if (this._consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES) {
      this.logger.error(
        `Plugin gave up after ${MAX_CONSECUTIVE_CRASHES} consecutive crashes`,
        {},
      );
      return;
    }
    const delay = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, this._restartAttempts),
      MAX_BACKOFF_MS,
    );
    this._restartTimer = setTimeout(async () => {
      this._restartTimer = null;
      this._consecutiveCrashes++;
      try {
        await this.restart(config);
      } catch (err) {
        this.logger.error('Restart failed', { err });
        this.scheduleRestart(config);
      }
    }, delay);
  }

  protected async onError(
    err: unknown,
    config: BasePluginConfig,
  ): Promise<void> {
    this.logger.error('Plugin error — scheduling restart', { err });
    this._state = 'stopped';
    this.scheduleRestart(config);
  }

  registerMessageHandler(
    handler: (msg: NormalizedMessage) => Promise<void>,
  ): void {
    this._messageHandler = handler;
    this.setupMessageHandler(handler);
  }

  protected getMessageHandler():
    | ((msg: NormalizedMessage) => Promise<void>)
    | null {
    return this._messageHandler;
  }

  getStatus() {
    return {
      platform: this.platform,
      configId: this.configId,
      state: this._state,
    };
  }
}
