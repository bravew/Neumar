import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { renderPresentationForChannel } from '../_shared/presentation/render';
import { BasePlugin } from '../base-plugin';
import { generatePairingCode } from '../pairing-service';
import type {
  BasePluginConfig,
  ChannelCapabilities,
  NormalizedMessage,
  NormalizedResponse,
  VoiceMessageInfo,
} from '../types';
import { registerTelegramCommands } from './commands';
import {
  renderTelegramInteractive,
  type TelegramInteractiveDefinition,
} from './components';
import { chunkTelegramMessage, toPlainText, toTelegramHtml } from './formatter';
import { parseTelegramTarget, telegramSendOptions } from './targets';
import { claimTelegramToken, releaseTelegramToken } from './token-claim';

/** Minimal shape of a Grammy Context used by helper closures. */
interface TgContext {
  from?: { id: number };
  chat?: { id: number; type: string };
  message?: {
    message_id: number;
    text?: string;
    caption?: string;
    message_thread_id?: number;
    is_topic_message?: boolean;
  };
  callbackQuery?: {
    data?: string;
    message?: {
      message_id: number;
      message_thread_id?: number;
      chat?: { id: number | string; type: string };
    };
  };
  messageReaction?: {
    message_id: number;
    old_reaction?: Array<{ type?: string; emoji?: string }>;
    new_reaction?: Array<{ type?: string; emoji?: string }>;
  };
  api: { getFile(fileId: string): Promise<{ file_path?: string }> };
}

interface TelegramFormState {
  trackedAt: number;
  definitions: Map<string, TelegramInteractiveDefinition>;
  values: Map<string, { value: string; display: string }>;
}

export class TelegramPlugin extends BasePlugin {
  readonly platform = 'telegram';
  readonly capabilities: ChannelCapabilities = {
    supportsEditMessage: true,
    supportsThreads: true,
    supportsButtons: true,
    supportsSelects: true,
    supportsModals: false,
    supportsDatePicker: false,
    supportsReactions: true,
    supportsTyping: true,
    supportsUnfurlControl: true,
    supportsFileUpload: true,
    maxMessageLength: 4096,
    maxAttachmentBytes: 50 * 1024 * 1024,
    maxAttachmentsPerMessage: 10,
    supportsMarkdown: 'full',
    runtimeClass: 'official',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bot: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runner: any = null;
  private savedConfig: BasePluginConfig | null = null;
  private claimedToken: string | null = null;
  private botUserId: string | null = null;
  private formStates = new Map<string, TelegramFormState>();

  private static readonly FORM_TTL_MS = 24 * 60 * 60 * 1000;

  protected async onStart(config: BasePluginConfig): Promise<void> {
    this.savedConfig = config;
    if (!config.token) {
      throw new Error('Telegram bot token not configured');
    }
    const { Bot } = await import('grammy');
    const { run } = await import('@grammyjs/runner');
    const { autoRetry } = await import('@grammyjs/auto-retry');
    const { apiThrottler } = await import('@grammyjs/transformer-throttler');

    this.bot = new Bot(config.token);
    this.bot.api.config.use(apiThrottler());
    this.bot.api.config.use(autoRetry());

    const me = await this.bot.api.getMe();
    this.botUserId = me?.id !== undefined ? String(me.id) : null;

    const handler = this.getMessageHandler();
    const botToken = config.token!;

    const makeNormalized = (
      ctx: TgContext,
      overrides?: { text?: string; attachments?: string[] },
    ): NormalizedMessage => {
      const userId = String(ctx.from?.id ?? 'unknown');
      const chat = ctx.chat ?? ctx.callbackQuery?.message?.chat;
      const chatId = String(chat?.id ?? ctx.from?.id ?? 'unknown');
      const threadId =
        ctx.message?.message_thread_id ??
        ctx.callbackQuery?.message?.message_thread_id;
      const isGroup = chat?.type === 'group' || chat?.type === 'supergroup';
      const conversationId =
        threadId !== undefined ? `${chatId}:${threadId}` : chatId;
      const sessionKey = isGroup
        ? `${conversationId}:${userId}`
        : conversationId;
      const text: string = overrides?.text ?? ctx.message?.text ?? '';
      const isCmd = text.startsWith('/');
      let commandName: string | undefined;
      let commandArgs: string[] | undefined;
      if (isCmd) {
        const parts = text.slice(1).split(/\s+/);
        // Strip bot username suffix from command (e.g. /start@BotName)
        commandName = (parts[0] ?? '').split('@')[0]!.toLowerCase();
        commandArgs = parts.slice(1);
      }
      return {
        platform: 'telegram',
        configId: this.configId,
        messageId:
          ctx.message?.message_id !== undefined
            ? String(ctx.message.message_id)
            : ctx.callbackQuery?.message?.message_id !== undefined
              ? String(ctx.callbackQuery.message.message_id)
              : ctx.messageReaction?.message_id !== undefined
                ? String(ctx.messageReaction.message_id)
                : null,
        conversationId,
        sessionKey,
        userId,
        text,
        attachments: overrides?.attachments,
        isCommand: isCmd,
        commandName,
        commandArgs,
        metadata: {
          chatId,
          threadId,
          botUserId: this.botUserId,
        },
      };
    };

    /**
     * Resolve a Telegram file_id to a downloadable CDN URL via getFile().
     * Returns undefined if the file is too large for Bot API download.
     */
    const resolveFileUrl = async (
      ctx: TgContext,
      fileId: string,
    ): Promise<string | undefined> => {
      try {
        const file = await ctx.api.getFile(fileId);
        if (!file.file_path) {
          this.logger.warn('Telegram file too large for Bot API download');
          return undefined;
        }
        // Note: URL contains the bot token — only used for server-side fetch,
        // never logged or stored in user-visible outputs.
        return `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
      } catch (_err) {
        this.logger.warn('Failed to resolve Telegram file', {
          fileId: fileId.slice(0, 10) + '…',
        });
        return undefined;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('start', async (ctx: any) => {
      if (handler) {
        await handler(makeNormalized(ctx));
      } else {
        await ctx.reply(
          'Welcome! Use /pair <6-digit code> to link your account.',
        );
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('pair', async (ctx: any) => {
      if (handler) {
        await handler(makeNormalized(ctx));
      } else {
        // Fallback: generate code
        const code = generatePairingCode(
          this.configId,
          'telegram',
          String(ctx.from?.id || 'unknown'),
        );
        await ctx.reply(
          `Your pairing code is: ${code}\nThis code expires in 10 minutes.`,
        );
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('new', async (ctx: any) => {
      if (handler) await handler(makeNormalized(ctx));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('status', async (ctx: any) => {
      if (handler) await handler(makeNormalized(ctx));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('budget', async (ctx: any) => {
      if (handler) await handler(makeNormalized(ctx));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('stop', async (ctx: any) => {
      if (handler) await handler(makeNormalized(ctx));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.command('help', async (ctx: any) => {
      if (handler) await handler(makeNormalized(ctx));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('message:text', async (ctx: any) => {
      if (ctx.message?.text?.startsWith('/')) return; // already handled by command handlers
      if (handler) await handler(makeNormalized(ctx));
    });

    // Handle photo messages (with or without caption)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('message:photo', async (ctx: any) => {
      if (!handler) return;
      try {
        const photos = ctx.message?.photo as
          | Array<{ file_id: string }>
          | undefined;
        if (!photos || photos.length === 0) return;
        // Pick the largest resolution (last in the array)
        const largest = photos[photos.length - 1]!;
        const url = await resolveFileUrl(ctx, largest.file_id);
        const attachments = url ? [url] : [];
        const caption: string = ctx.message?.caption ?? '';
        await handler(makeNormalized(ctx, { text: caption, attachments }));
      } catch (err) {
        this.logger.error('Error handling Telegram photo', { err });
      }
    });

    // Handle document messages (PDF, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('message:document', async (ctx: any) => {
      if (!handler) return;
      try {
        const doc = ctx.message?.document as
          | { file_id: string; mime_type?: string }
          | undefined;
        if (!doc) return;
        const isImage = doc.mime_type?.startsWith('image/') ?? false;
        if (!isImage) {
          // Non-image documents: forward caption only (agent can't process arbitrary files yet)
          const caption: string = ctx.message?.caption ?? '';
          if (caption) await handler(makeNormalized(ctx, { text: caption }));
          return;
        }
        const url = await resolveFileUrl(ctx, doc.file_id);
        const attachments = url ? [url] : [];
        const caption: string = ctx.message?.caption ?? '';
        await handler(makeNormalized(ctx, { text: caption, attachments }));
      } catch (err) {
        this.logger.error('Error handling Telegram document', { err });
      }
    });

    // Handle voice messages and video notes (round videos)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('message:voice', async (ctx: any) => {
      if (!handler) return;
      try {
        const voice = ctx.message?.voice as
          | {
              file_id: string;
              duration?: number;
              file_size?: number;
              mime_type?: string;
            }
          | undefined;
        if (!voice) return;

        const voiceInfo = await this.downloadTelegramVoice(
          ctx,
          voice.file_id,
          '.ogg',
          voice.mime_type ?? 'audio/ogg',
          voice.duration,
          voice.file_size,
          botToken,
        );
        if (!voiceInfo) return;

        const caption: string = ctx.message?.caption ?? '';
        const normalized = makeNormalized(ctx, { text: caption });
        normalized.voice = voiceInfo;
        await handler(normalized);
      } catch (err) {
        this.logger.error('Error handling Telegram voice message', { err });
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('message:video_note', async (ctx: any) => {
      if (!handler) return;
      try {
        const videoNote = ctx.message?.video_note as
          | {
              file_id: string;
              duration?: number;
              file_size?: number;
            }
          | undefined;
        if (!videoNote) return;

        const voiceInfo = await this.downloadTelegramVoice(
          ctx,
          videoNote.file_id,
          '.mp4',
          'video/mp4',
          videoNote.duration,
          videoNote.file_size,
          botToken,
        );
        if (!voiceInfo) return;

        const normalized = makeNormalized(ctx);
        normalized.voice = voiceInfo;
        await handler(normalized);
      } catch (err) {
        this.logger.error('Error handling Telegram video note', { err });
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('callback_query:data', async (ctx: any) => {
      try {
        await this.dispatchCallback(ctx, handler, makeNormalized);
      } catch (err) {
        this.logger.error('Error handling Telegram callback query', { err });
      } finally {
        await ctx.answerCallbackQuery?.().catch(() => {});
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bot.on('message_reaction', async (ctx: any) => {
      if (!handler) return;
      try {
        const reaction = this.telegramReactionDelta(
          ctx.messageReaction ?? ctx.update?.message_reaction,
        );
        if (!reaction) return;
        await handler(
          makeNormalized(ctx, {
            text: `reaction_${reaction.action}: ${reaction.emoji}`,
          }),
        );
      } catch (err) {
        this.logger.error('Error handling Telegram message reaction', {
          err,
        });
      }
    });

    await registerTelegramCommands(this.bot).catch((err) => {
      this.logger.warn('Telegram command registration failed', { err });
    });

    if (!claimTelegramToken(config.token)) {
      this.logger.warn(
        'Telegram bot token is already claimed in this process; skipping duplicate long-poll start',
      );
      throw new Error('Telegram bot token already claimed');
    }
    this.claimedToken = config.token;

    this.runner = run(this.bot, {
      runner: {
        fetch: {
          allowed_updates: [
            'message',
            'edited_message',
            'callback_query',
            'message_reaction',
            'message_reaction_count',
            'my_chat_member',
            'chat_member',
          ],
        },
      },
    });
    // Catch async runner errors so a bad token / network blip doesn't bring down Node.js.
    this.runner.task().catch((err: unknown) => {
      this.logger.error('Telegram runner error', { err });
    });
    this.logger.info('Telegram bot started');
  }

  protected async onStop(): Promise<void> {
    if (this.runner) {
      await this.runner.stop();
      this.runner = null;
    }
    if (this.claimedToken) {
      releaseTelegramToken(this.claimedToken);
      this.claimedToken = null;
    }
    this.bot = null;
    this.savedConfig = null;
  }

  protected setupMessageHandler(
    _handler: (msg: NormalizedMessage) => Promise<void>,
  ): void {
    // Handler stored in base class; Telegram uses bot event listeners registered in onStart
  }

  private async dispatchCallback(
    ctx: TgContext & {
      editMessageText?: (
        text: string,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
    },
    handler: ((msg: NormalizedMessage) => Promise<void>) | null,
    makeNormalized: (
      ctx: TgContext,
      overrides?: { text?: string; attachments?: string[] },
    ) => NormalizedMessage,
  ): Promise<void> {
    if (!handler) return;
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith('neuma:')) return;

    const state = this.stateForCallback(data);
    if (data.startsWith('neuma:submit:')) {
      const submitted = Array.from(state?.values.values() ?? []);
      const text =
        submitted.map((item) => item.display).join('\n') || 'submitted';
      await ctx
        .editMessageText?.(
          submitted.length > 0
            ? `Submitted:\n${submitted.map((item) => item.display).join('\n')}`
            : 'Submitted.',
          { reply_markup: undefined },
        )
        .catch(() => {});
      await handler(makeNormalized(ctx, { text }));
      return;
    }

    const definition = state?.definitions.get(data);
    if (!definition) {
      await ctx
        .editMessageText?.('This form has expired.', {
          reply_markup: undefined,
        })
        .catch(() => {});
      return;
    }

    if (definition.kind === 'select') {
      const displayValue = definition.displayValue ?? definition.value;
      state?.values.set(data, {
        value: definition.value,
        display: `${definition.label}: ${displayValue}`,
      });
      if (!definition.submitOnClick) return;
    }

    await handler(makeNormalized(ctx, { text: definition.value }));
  }

  private stateForCallback(data: string): TelegramFormState | undefined {
    this.pruneFormStates();
    const formId = data.split(':').at(-1);
    if (!formId) return undefined;
    return this.formStates.get(formId);
  }

  private pruneFormStates(): void {
    const cutoff = Date.now() - TelegramPlugin.FORM_TTL_MS;
    for (const [formId, state] of this.formStates) {
      if (state.trackedAt < cutoff) this.formStates.delete(formId);
    }
  }

  private telegramReactionDelta(
    reaction?: TgContext['messageReaction'],
  ): { action: 'added' | 'removed'; emoji: string } | null {
    const oldReactions = reaction?.old_reaction ?? [];
    const newReactions = reaction?.new_reaction ?? [];
    const oldSet = new Set(oldReactions.map((item) => this.reactionKey(item)));
    const newSet = new Set(newReactions.map((item) => this.reactionKey(item)));

    const added = newReactions.find(
      (item) => !oldSet.has(this.reactionKey(item)),
    );
    if (added) return { action: 'added', emoji: this.reactionLabel(added) };

    const removed = oldReactions.find(
      (item) => !newSet.has(this.reactionKey(item)),
    );
    if (removed)
      return { action: 'removed', emoji: this.reactionLabel(removed) };

    return null;
  }

  private reactionKey(reaction: { type?: string; emoji?: string }): string {
    return `${reaction.type ?? 'emoji'}:${reaction.emoji ?? ''}`;
  }

  private reactionLabel(reaction: { type?: string; emoji?: string }): string {
    return reaction.emoji ?? reaction.type ?? 'reaction';
  }

  private telegramMessageOptions(
    chatId: string,
    response?: Pick<NormalizedResponse, 'unfurl'>,
  ): {
    target: ReturnType<typeof parseTelegramTarget>;
    options: Record<string, unknown>;
  } {
    const target = parseTelegramTarget(chatId);
    return {
      target,
      options: {
        ...telegramSendOptions(target),
        ...(response?.unfurl === false
          ? { link_preview_options: { is_disabled: true } }
          : {}),
      },
    };
  }

  async sendTypingAction(chatId: string): Promise<void> {
    if (!this.bot) return;
    const { target, options } = this.telegramMessageOptions(chatId);
    await this.bot.api
      .sendChatAction(target.chatId, 'typing', options)
      .catch(() => {});
  }

  async sendMessage(
    chatId: string,
    response: NormalizedResponse,
  ): Promise<{ messageId: string | null }> {
    if (!this.bot) return { messageId: null };

    const { target, options: baseOptions } = this.telegramMessageOptions(
      chatId,
      response,
    );
    const presentation = renderPresentationForChannel({
      platform: this.platform,
      capabilities: this.capabilities,
      response,
    });
    const formId = crypto.randomUUID().slice(0, 12);
    const rendered = renderTelegramInteractive({
      blocks: presentation.blocks,
      buttons: presentation.buttons,
      formId,
    });
    if (rendered.definitions.length > 0) {
      this.formStates.set(formId, {
        trackedAt: Date.now(),
        definitions: new Map(
          rendered.definitions.map((definition) => [
            definition.callbackData,
            definition,
          ]),
        ),
        values: new Map(),
      });
    }

    const messageText =
      presentation.text || (rendered.replyMarkup ? 'Choose an option:' : '');
    const html = toTelegramHtml(messageText);
    const chunks = chunkTelegramMessage(html);
    let lastMsgId: string | null = null;
    for (const [index, chunk] of chunks.entries()) {
      const isLast = index === chunks.length - 1;
      const options: Record<string, unknown> = {
        ...baseOptions,
        parse_mode: 'HTML',
        ...(isLast && rendered.replyMarkup
          ? { reply_markup: rendered.replyMarkup }
          : {}),
      };
      try {
        const sent = await this.bot.api.sendMessage(
          target.chatId,
          chunk,
          options,
        );
        lastMsgId = String(sent.message_id);
      } catch {
        // Fallback to plain text if HTML parse fails
        const sent = await this.bot.api.sendMessage(
          target.chatId,
          toPlainText(chunk),
          {
            ...baseOptions,
            ...(isLast && rendered.replyMarkup
              ? { reply_markup: rendered.replyMarkup }
              : {}),
          },
        );
        lastMsgId = String(sent.message_id);
      }
    }
    return { messageId: lastMsgId };
  }

  async editMessage(
    chatId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    if (!this.bot) return;
    const { target, options } = this.telegramMessageOptions(chatId);
    try {
      await this.bot.api.editMessageText(
        target.chatId,
        Number.parseInt(messageId, 10),
        toTelegramHtml(text),
        { ...options, parse_mode: 'HTML' },
      );
    } catch {
      try {
        await this.bot.api.editMessageText(
          target.chatId,
          Number.parseInt(messageId, 10),
          toPlainText(text),
          options,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('message is not modified')) {
          this.logger.warn('Telegram editMessage failed', { err: message });
          await this.sendMessage(chatId, { text }).catch(() => {});
        }
      }
    }
  }

  /**
   * Download a Telegram voice/video_note file to a local temp path.
   */
  private async downloadTelegramVoice(
    ctx: TgContext,
    fileId: string,
    ext: string,
    mimeType: string,
    duration?: number,
    fileSize?: number,
    botToken?: string,
  ): Promise<VoiceMessageInfo | null> {
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        this.logger.warn('Telegram voice file too large for Bot API download');
        return null;
      }

      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

      const tmpDir = path.join(os.tmpdir(), 'neuma-voice');
      await fs.mkdir(tmpDir, { recursive: true });
      const localPath = path.join(
        tmpDir,
        `tg-voice-${crypto.randomUUID()}${ext}`,
      );

      const res = await fetch(fileUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        this.logger.warn(`Telegram voice download failed: ${res.status}`);
        return null;
      }

      const MAX_VOICE_BYTES = 25 * 1024 * 1024;
      const contentLength = Number(res.headers.get('content-length') ?? '0');
      if (contentLength > MAX_VOICE_BYTES) {
        this.logger.warn(
          `Telegram voice file too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
        );
        return null;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_VOICE_BYTES) {
        this.logger.warn(
          `Telegram voice file too large after download (${Math.round(buffer.byteLength / 1024 / 1024)}MB)`,
        );
        return null;
      }
      await fs.writeFile(localPath, buffer);

      this.logger.info(
        `Downloaded Telegram voice message (${buffer.byteLength} bytes)`,
      );

      return {
        filePath: localPath,
        mimeType,
        durationSecs: duration,
        sizeBytes: fileSize ?? buffer.byteLength,
      };
    } catch (err) {
      this.logger.error('Failed to download Telegram voice', { err });
      return null;
    }
  }

  /** Telegram Bot API upload limit (50 MB) */
  private static readonly MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

  private static readonly IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
  ]);

  async sendPhotoUrls(chatId: string, urls: string[]): Promise<void> {
    if (!this.bot || urls.length === 0) return;
    const { target, options } = this.telegramMessageOptions(chatId);
    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10);
      try {
        if (batch.length === 1) {
          await this.bot.api.sendPhoto(target.chatId, batch[0]!, options);
        } else {
          await this.bot.api.sendMediaGroup(
            target.chatId,
            batch.map((url) => ({ type: 'photo', media: url })),
            options,
          );
        }
      } catch (err) {
        for (const url of batch) {
          try {
            await this.bot.api.sendPhoto(target.chatId, url, options);
          } catch (photoErr) {
            let hostname = url;
            try {
              hostname = new URL(url).hostname;
            } catch {
              /* use raw url */
            }
            this.logger.warn('Telegram sendPhoto by URL failed', {
              err: photoErr,
              batchErr: err,
              url: hostname,
            });
          }
        }
      }
    }
  }

  async sendFiles(chatId: string, filePaths: string[]): Promise<void> {
    if (!this.bot || filePaths.length === 0) return;
    const { InputFile } = await import('grammy');
    const { target, options } = this.telegramMessageOptions(chatId);
    for (const fp of filePaths) {
      let size: number;
      try {
        size = (await fs.stat(fp)).size;
      } catch {
        continue; // file doesn't exist
      }
      if (size > TelegramPlugin.MAX_UPLOAD_BYTES) {
        this.logger.warn(
          `File too large for Telegram upload (${(size / 1024 / 1024).toFixed(1)}MB > 50MB): ${path.basename(fp)}`,
        );
        continue;
      }
      try {
        const ext = path.extname(fp).toLowerCase();
        const inputFile = new InputFile(
          createReadStream(fp),
          path.basename(fp),
        );
        if (TelegramPlugin.IMAGE_EXTENSIONS.has(ext)) {
          await this.bot.api.sendPhoto(target.chatId, inputFile, options);
        } else {
          await this.bot.api.sendDocument(target.chatId, inputFile, options);
        }
      } catch (err) {
        this.logger.error('Telegram sendFiles failed', {
          err,
          file: path.basename(fp),
        });
      }
    }
  }

  async addReaction(channel: string, messageTs: string): Promise<void> {
    await this.addNamedReaction(channel, messageTs, 'loading');
  }

  async removeReaction(channel: string, messageTs: string): Promise<void> {
    if (!this.bot) return;
    const messageId = Number.parseInt(messageTs, 10);
    if (Number.isNaN(messageId)) return;
    try {
      const { target } = this.telegramMessageOptions(channel);
      await this.bot.api.setMessageReaction(target.chatId, messageId, []);
    } catch (err) {
      this.logger.debug('Telegram removeReaction failed', { err, channel });
    }
  }

  async addNamedReaction(
    channel: string,
    messageTs: string,
    emoji: string,
  ): Promise<void> {
    if (!this.bot) return;
    const messageId = Number.parseInt(messageTs, 10);
    if (Number.isNaN(messageId)) return;
    try {
      const { target } = this.telegramMessageOptions(channel);
      await this.bot.api.setMessageReaction(target.chatId, messageId, [
        { type: 'emoji', emoji: this.toTelegramEmoji(emoji) },
      ]);
    } catch (err) {
      this.logger.debug('Telegram addNamedReaction failed', {
        err,
        channel,
        emoji,
      });
    }
  }

  private toTelegramEmoji(name: string): string {
    const mapped: Record<string, string> = {
      loading: '⏳',
      hourglass_flowing_sand: '⏳',
      heart: '❤️',
      white_check_mark: '✅',
      thumbs_up: '👍',
      '+1': '👍',
    };
    return mapped[name] ?? name;
  }
}
