/**
 * Telegram Channel Adapter
 *
 * Uses grammy + @grammyjs/runner for robust Telegram Bot API integration.
 * Patterns adopted from openclaw:
 *   - @grammyjs/runner for concurrent update processing (not bot.start())
 *   - Webhook cleanup before polling (deleteWebhook)
 *   - Recoverable network error detection + retry
 *   - Graceful stop (runner.stop → bot.stop, never crashes)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RunnerHandle } from '@grammyjs/runner';
import { run } from '@grammyjs/runner';
import { Bot } from 'grammy';

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
import { chunkTelegramMessage, toPlainText, toTelegramHtml } from './formatter';

const logger = createLogger('TelegramAdapter');

interface TelegramConfig extends ChannelConfig {
  botToken: string;
  transport: 'polling' | 'webhook';
  webhookUrl?: string;
}

/** Network errors that are transient and safe to retry through. */
const RECOVERABLE_RE =
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|abort/i;

function isRecoverableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RECOVERABLE_RE.test(msg);
}

class TelegramAdapter implements ChannelAdapter {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 4096,
    supportsMarkdown: true,
    supportsThreads: false,
    supportsReactions: true,
    supportsImages: true,
    supportsButtons: true,
    supportsCommands: true,
    supportsEditMessage: true,
    supportsRichCards: false,
    runtimeClass: 'official',
  };

  private bot: Bot | null = null;
  private runner: RunnerHandle | null = null;
  private connected = false;
  private currentHealth: ChannelHealth = 'disabled';
  private messageHandler: InboundHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;

  constructor(private config: TelegramConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    this.bot = new Bot(this.config.botToken);

    // Catch all middleware errors to prevent unhandled rejections
    this.bot.catch((err) => {
      const error =
        err.error instanceof Error ? err.error : new Error(String(err.error));
      // Suppress recoverable network errors (runner handles retry)
      if (isRecoverableNetworkError(error)) {
        logger.debug(`Telegram recoverable error: ${error.message}`);
        return;
      }
      logger.error('Telegram bot error', error.message);
      if (this.errorHandler) {
        this.errorHandler(error, 'bot_error');
      }
    });

    // Register message handlers on the bot before starting the runner
    this.registerHandlers();

    // Clean up any leftover webhook so polling works cleanly
    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
      logger.debug('Cleared any existing Telegram webhook');
    } catch (err) {
      // Non-fatal: if the token is valid, polling will still work
      logger.warn(
        `Failed to clear webhook: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Start polling via @grammyjs/runner (concurrent update processing)
    this.runner = run(this.bot, {
      runner: {
        fetch: { timeout: 30 },
        // Suppress grammy getUpdates stack traces; we log concise errors
        silent: true,
        // Keep retrying for up to 1 hour before the runner gives up
        maxRetryTime: 60 * 60 * 1000,
        retryInterval: 'exponential',
      },
    });

    logger.info('Telegram bot started (runner polling)');

    // Mark connected once the runner's source (getUpdates) succeeds for the first time.
    // runner.isRunning() turns true immediately, so we rely on the task() promise instead:
    // if the runner stops or throws, we know the connection never truly established.
    this.connected = true;
    this.setHealth('connected');

    // Monitor runner lifecycle in the background
    const taskPromise = this.runner.task();
    if (!taskPromise) return;
    taskPromise
      .then(() => {
        // Runner stopped gracefully (e.g. via disconnect)
        if (this.connected) {
          logger.warn('Telegram runner stopped unexpectedly');
          this.connected = false;
          this.setHealth('degraded');
          if (this.errorHandler) {
            this.errorHandler(
              new Error('Polling runner stopped'),
              'runner_stopped',
            );
          }
        }
      })
      .catch((err) => {
        if (!this.connected) return; // disconnect() already handled
        this.connected = false;
        this.setHealth('degraded');
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('Telegram runner error', error.message);
        if (this.errorHandler) {
          this.errorHandler(error, 'runner_error');
        }
      });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.setHealth('disabled');

    if (this.runner) {
      try {
        await this.runner.stop();
      } catch {
        // Runner may already be stopped
      }
      this.runner = null;
    }

    if (this.bot) {
      try {
        await this.bot.stop();
      } catch {
        // Bot may already be stopped by runner
      }
      this.bot = null;
    }

    logger.info('Telegram bot disconnected');
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
    if (!this.bot) {
      return { messageId: '', success: false, error: 'Bot not initialized' };
    }

    try {
      const options: Record<string, unknown> = {
        link_preview_options: { is_disabled: true },
      };

      if (content.buttons && content.buttons.length > 0) {
        options.reply_markup = {
          inline_keyboard: [
            content.buttons.map((btn) => ({
              text: btn.label,
              callback_data: `${btn.action}:${btn.payload ?? ''}`,
            })),
          ],
        };
      }

      if (content.replyToId) {
        options.reply_to_message_id = Number(content.replyToId);
      }

      // Convert markdown to HTML and chunk if exceeding 4096 chars
      const htmlText = toTelegramHtml(content.text);
      const chunks = chunkTelegramMessage(htmlText);
      let lastMessageId = '';

      for (const chunk of chunks) {
        const result = await this.sendWithHtmlFallback(
          chatId,
          chunk,
          content.text,
          options,
        );
        lastMessageId = String(result.message_id);
        // Only attach buttons/reply to the first chunk
        delete options.reply_markup;
        delete options.reply_to_message_id;
      }

      return { messageId: lastMessageId, success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to send Telegram message to ${chatId}`, errorMsg);
      return { messageId: '', success: false, error: errorMsg };
    }
  }

  /**
   * Send with HTML parse_mode, falling back to plain text if Telegram rejects the HTML.
   * Openclaw pattern: withTelegramHtmlParseFallback
   */
  private async sendWithHtmlFallback(
    chatId: string,
    htmlText: string,
    rawText: string,
    options: Record<string, unknown>,
  ) {
    try {
      return await this.bot!.api.sendMessage(chatId, htmlText, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Telegram returns 400 "can't parse entities" when HTML is malformed
      if (msg.includes("can't parse entities") || msg.includes('parse')) {
        logger.warn('HTML parse failed, falling back to plain text');
        return await this.bot!.api.sendMessage(
          chatId,
          toPlainText(rawText),
          options,
        );
      }
      throw err;
    }
  }

  async editMessage(
    chatId: string,
    messageId: string,
    content: OutboundContent,
  ): Promise<void> {
    if (!this.bot) return;

    try {
      const options: Record<string, unknown> = {
        link_preview_options: { is_disabled: true },
      };
      if (content.buttons && content.buttons.length > 0) {
        options.reply_markup = {
          inline_keyboard: [
            content.buttons.map((btn) => ({
              text: btn.label,
              callback_data: `${btn.action}:${btn.payload ?? ''}`,
            })),
          ],
        };
      }

      const htmlText = toTelegramHtml(content.text);

      try {
        await this.bot.api.editMessageText(
          chatId,
          Number(messageId),
          htmlText,
          { parse_mode: 'HTML', ...options },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("can't parse entities") || msg.includes('parse')) {
          logger.warn('HTML parse failed on edit, falling back to plain text');
          await this.bot.api.editMessageText(
            chatId,
            Number(messageId),
            toPlainText(content.text),
            options,
          );
        } else {
          throw err;
        }
      }
    } catch (err) {
      // "message is not modified" is expected during rapid streaming edits
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not modified')) {
        throw err;
      }
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendChatAction(chatId, 'typing');
    } catch {
      // Non-critical: typing indicator failures are silently ignored
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

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Extract file ID, MIME type, and filename from a Telegram media message.
   * Returns null if the message type is unrecognised.
   */
  private extractMediaInfo(
    message: Record<string, unknown>,
    event: string,
  ): { fileId: string; mimeType?: string; filename?: string } | null {
    if (event === 'message:photo') {
      const photos = message.photo as Array<{ file_id: string }> | undefined;
      if (!photos || photos.length === 0) return null;
      const largest = photos[photos.length - 1]!;
      return { fileId: largest.file_id, mimeType: 'image/jpeg' };
    }
    if (event === 'message:document') {
      const doc = message.document as
        | {
            file_id: string;
            mime_type?: string;
            file_name?: string;
          }
        | undefined;
      if (!doc) return null;
      return {
        fileId: doc.file_id,
        mimeType: doc.mime_type ?? 'application/octet-stream',
        filename: doc.file_name,
      };
    }
    if (event === 'message:audio') {
      const audio = message.audio as
        | {
            file_id: string;
            mime_type?: string;
            file_name?: string;
          }
        | undefined;
      if (!audio) return null;
      return {
        fileId: audio.file_id,
        mimeType: audio.mime_type ?? 'audio/mpeg',
        filename: audio.file_name,
      };
    }
    if (event === 'message:video') {
      const video = message.video as
        | {
            file_id: string;
            mime_type?: string;
            file_name?: string;
          }
        | undefined;
      if (!video) return null;
      return {
        fileId: video.file_id,
        mimeType: video.mime_type ?? 'video/mp4',
        filename: video.file_name,
      };
    }
    return null;
  }

  /**
   * Download a Telegram file to a local temp path.
   * Returns the local file path or null if the file couldn't be downloaded.
   */
  private async downloadTelegramFile(
    fileId: string,
    ext: string,
  ): Promise<string | null> {
    if (!this.bot) return null;

    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file.file_path) {
        logger.warn('Telegram file too large for Bot API download');
        return null;
      }

      // URL contains bot token — only used for immediate server-side fetch, never stored or logged.
      const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;

      const tmpDir = path.join(os.tmpdir(), 'neuma-voice');
      await fs.mkdir(tmpDir, { recursive: true });
      const localPath = path.join(
        tmpDir,
        `tg-voice-${crypto.randomUUID()}${ext}`,
      );

      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        logger.warn(`Telegram file download failed: ${res.status}`);
        return null;
      }

      const MAX_VOICE_BYTES = 25 * 1024 * 1024;
      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > MAX_VOICE_BYTES) {
        logger.warn(
          `Telegram file too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
        );
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_VOICE_BYTES) {
        logger.warn(
          `Telegram file too large after download (${Math.round(buffer.byteLength / 1024 / 1024)}MB)`,
        );
        return null;
      }
      await fs.writeFile(localPath, buffer);

      logger.info(
        `Downloaded Telegram file to ${localPath} (${buffer.byteLength} bytes)`,
      );
      return localPath;
    } catch (err) {
      logger.error(
        `Failed to download Telegram file: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private registerHandlers(): void {
    if (!this.bot) return;

    // Handle incoming text messages
    this.bot.on('message:text', async (ctx) => {
      if (!this.messageHandler) return;

      try {
        await this.messageHandler({
          channelId: 'telegram',
          chatId: String(ctx.chat.id),
          senderId: String(ctx.from.id),
          senderName:
            ctx.from.first_name +
            (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
          content: ctx.message.text,
          contentType: ctx.message.text.startsWith('/') ? 'command' : 'text',
          messageId: String(ctx.message.message_id),
          threadId: ctx.message.reply_to_message
            ? String(ctx.message.reply_to_message.message_id)
            : undefined,
          timestamp: new Date(ctx.message.date * 1000).toISOString(),
          raw: ctx.message,
        });
      } catch (err) {
        logger.error('Error handling Telegram message', err);
        if (this.errorHandler) {
          this.errorHandler(
            err instanceof Error ? err : new Error(String(err)),
            'message_handler',
          );
        }
      }
    });

    // Handle media messages (photo, document, audio, video)
    const mediaEvents = [
      'message:photo',
      'message:document',
      'message:audio',
      'message:video',
    ] as const;
    for (const event of mediaEvents) {
      this.bot.on(event, async (ctx) => {
        if (!this.messageHandler) return;

        try {
          const media = this.extractMediaInfo(
            ctx.message as unknown as Record<string, unknown>,
            event,
          );
          if (!media) return;

          const file = await ctx.api.getFile(media.fileId);
          if (!file.file_path) {
            logger.warn(
              `Telegram file too large for Bot API download (${event})`,
            );
            return;
          }

          // URL contains bot token — only used for server-side fetch, never stored in logs.
          const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
          const isImage = media.mimeType?.startsWith('image/') ?? false;

          await this.messageHandler({
            channelId: 'telegram',
            chatId: String(ctx.chat.id),
            senderId: String(ctx.from.id),
            senderName:
              ctx.from.first_name +
              (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
            content:
              ('caption' in ctx.message ? ctx.message.caption : null) ?? '',
            contentType: isImage ? 'image' : 'file',
            attachments: [
              {
                url: fileUrl,
                contentType: media.mimeType,
                filename:
                  media.filename ??
                  file.file_path.split('/').pop() ??
                  undefined,
              },
            ],
            messageId: String(ctx.message.message_id),
            threadId: ctx.message.reply_to_message
              ? String(ctx.message.reply_to_message.message_id)
              : undefined,
            timestamp: new Date(ctx.message.date * 1000).toISOString(),
            raw: ctx.message,
          });
        } catch (err) {
          logger.error(`Error handling Telegram ${event}`, err);
          if (this.errorHandler) {
            this.errorHandler(
              err instanceof Error ? err : new Error(String(err)),
              'message_handler',
            );
          }
        }
      });
    }

    // Handle voice messages and video notes (round videos)
    const voiceEvents = ['message:voice', 'message:video_note'] as const;
    for (const event of voiceEvents) {
      this.bot.on(event, async (ctx) => {
        if (!this.messageHandler) return;

        try {
          const isVoice = event === 'message:voice';
          const media = isVoice
            ? (
                ctx.message as {
                  voice?: {
                    file_id: string;
                    duration?: number;
                    file_size?: number;
                    mime_type?: string;
                  };
                }
              ).voice
            : (
                ctx.message as {
                  video_note?: {
                    file_id: string;
                    duration?: number;
                    file_size?: number;
                  };
                }
              ).video_note;

          if (!media) return;

          const mimeType = isVoice
            ? ((media as { mime_type?: string }).mime_type ?? 'audio/ogg')
            : 'video/mp4';
          const ext = isVoice ? '.ogg' : '.mp4';

          // Download the voice file to a local temp path
          const localPath = await this.downloadTelegramFile(media.file_id, ext);
          if (!localPath) {
            logger.warn(`Could not download Telegram ${event} file`);
            return;
          }

          const caption =
            'caption' in ctx.message
              ? (ctx.message.caption as string | undefined)
              : undefined;

          await this.messageHandler({
            channelId: 'telegram',
            chatId: String(ctx.chat.id),
            senderId: String(ctx.from.id),
            senderName:
              ctx.from.first_name +
              (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
            content: caption ?? '',
            contentType: 'voice',
            voice: {
              filePath: localPath,
              mimeType,
              durationSecs: media.duration,
              sizeBytes: media.file_size,
            },
            messageId: String(ctx.message.message_id),
            threadId: ctx.message.reply_to_message
              ? String(ctx.message.reply_to_message.message_id)
              : undefined,
            timestamp: new Date(ctx.message.date * 1000).toISOString(),
            raw: ctx.message,
          });
        } catch (err) {
          logger.error(`Error handling Telegram ${event}`, err);
          if (this.errorHandler) {
            this.errorHandler(
              err instanceof Error ? err : new Error(String(err)),
              'voice_message_handler',
            );
          }
        }
      });
    }

    // Handle callback queries (button presses)
    this.bot.on('callback_query:data', async (ctx) => {
      if (!this.messageHandler) return;

      try {
        await ctx.answerCallbackQuery();
        await this.messageHandler({
          channelId: 'telegram',
          chatId: String(ctx.chat?.id ?? ctx.from.id),
          senderId: String(ctx.from.id),
          senderName: ctx.from.first_name,
          content: ctx.callbackQuery.data,
          contentType: 'command',
          messageId: String(ctx.callbackQuery.id),
          timestamp: new Date().toISOString(),
          raw: ctx.callbackQuery,
        });
      } catch (err) {
        logger.error('Error handling Telegram callback', err);
      }
    });
  }
}

// Self-register
registerChannel(
  'telegram',
  (config) => {
    const tgConfig = config as TelegramConfig;
    if (!tgConfig.botToken) return null;
    return new TelegramAdapter(tgConfig);
  },
  {
    capabilities: new TelegramAdapter({
      enabled: false,
      botToken: '',
      transport: 'webhook',
    }).capabilities,
  },
);
