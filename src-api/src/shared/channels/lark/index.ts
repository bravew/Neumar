import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseInteractiveMarkdown } from '../_shared/interactive';
import { renderPresentationForChannel } from '../_shared/presentation/render';
import { BasePlugin } from '../base-plugin';
import type {
  BasePluginConfig,
  ChannelCapabilities,
  NormalizedMessage,
  NormalizedResponse,
} from '../types';
import { renderLarkCard } from './cards';
import {
  mapLarkStartupError,
  parseLarkTokenConfig,
  probeLarkStartup,
  type LarkTokenConfig,
} from './diagnostics';
import {
  normalizeLarkCardAction,
  normalizeLarkMessageEvent,
  normalizeLarkReactionEvent,
  type LarkMessageResource,
} from './message-adapter';
import { parseLarkSendTarget } from './targets';

export class LarkPlugin extends BasePlugin {
  readonly platform = 'lark';
  readonly capabilities: ChannelCapabilities = {
    supportsEditMessage: true,
    supportsThreads: true,
    supportsButtons: true,
    supportsSelects: true,
    supportsModals: true,
    supportsDatePicker: true,
    supportsReactions: true,
    supportsTyping: false,
    supportsUnfurlControl: false,
    supportsFileUpload: true,
    maxMessageLength: 30000,
    maxAttachmentBytes: 30 * 1024 * 1024,
    maxAttachmentsPerMessage: 10,
    supportsMarkdown: 'basic',
    runtimeClass: 'official',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private wsClient: any = null;
  private processedEvents = new Map<string, number>();

  protected async onStart(config: BasePluginConfig): Promise<void> {
    if (!config.token) {
      throw new Error('Lark appId/appSecret not configured');
    }

    let tokenConfig: LarkTokenConfig;
    try {
      tokenConfig = parseLarkTokenConfig(config.token);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    const lark = await import('@larksuiteoapi/node-sdk');
    const domain =
      tokenConfig.domain === 'feishu' ? lark.Domain.Feishu : lark.Domain.Lark;
    const clientOptions = {
      appId: tokenConfig.appId,
      appSecret: tokenConfig.appSecret,
      domain,
      loggerLevel: lark.LoggerLevel.warn,
    };

    this.client = new lark.Client(clientOptions);
    this.wsClient = new lark.WSClient(clientOptions);

    try {
      await probeLarkStartup({
        client: this.client,
        appId: tokenConfig.appId,
        appSecret: tokenConfig.appSecret,
      });
    } catch (err) {
      throw mapLarkStartupError(err);
    }

    const handler = this.getMessageHandler();
    const dispatcher = new lark.EventDispatcher({
      verificationToken: tokenConfig.verificationToken,
      encryptKey: tokenConfig.encryptKey,
      loggerLevel: lark.LoggerLevel.warn,
    }).register({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'im.message.receive_v1': async (data: any) => {
        await this.handleMessageReceive(data, handler);
        return { code: 0 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'im.message.reaction.created_v1': async (data: any) => {
        await this.handleReactionEvent('added', data, handler);
        return { code: 0 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'im.message.reaction.deleted_v1': async (data: any) => {
        await this.handleReactionEvent('removed', data, handler);
        return { code: 0 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'card.action.trigger': async (data: any) => {
        await this.handleCardAction(data, handler);
        return { toast: { type: 'info', content: 'Submitted' } };
      },
    });

    try {
      await this.wsClient.start({ eventDispatcher: dispatcher });
    } catch (err) {
      const mapped = mapLarkStartupError(err);
      if (config) await this.onError(mapped, config).catch(() => {});
      throw mapped;
    }

    this.logger.info(`Lark plugin started with ${tokenConfig.domain} domain`);
  }

  protected async onStop(): Promise<void> {
    try {
      this.wsClient?.close?.({ force: true });
    } catch {
      /* already closed */
    }
    this.wsClient = null;
    this.client = null;
    this.processedEvents.clear();
  }

  protected setupMessageHandler(
    _handler: (msg: NormalizedMessage) => Promise<void>,
  ): void {
    // Handler stored in base class; Lark uses WSClient event dispatcher registered in onStart
  }

  private async handleMessageReceive(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    handler: ((msg: NormalizedMessage) => Promise<void>) | null,
  ): Promise<void> {
    if (!handler || !this.shouldProcessEvent(data?.header?.event_id)) return;

    const normalized = normalizeLarkMessageEvent(data, this.configId);
    if (!normalized) return;
    normalized.attachments = await this.resolveLarkResources(normalized);
    await handler(normalized);
  }

  private async handleReactionEvent(
    action: 'added' | 'removed',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    handler: ((msg: NormalizedMessage) => Promise<void>) | null,
  ): Promise<void> {
    if (!handler || !this.shouldProcessEvent(data?.header?.event_id)) return;
    const event = data?.event ?? data;
    const conversationId = await this.conversationIdForMessage(
      event?.message_id,
    );
    const normalized = normalizeLarkReactionEvent({
      event,
      action,
      configId: this.configId,
      conversationId,
    });
    if (normalized) await handler(normalized);
  }

  private async handleCardAction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    handler: ((msg: NormalizedMessage) => Promise<void>) | null,
  ): Promise<void> {
    if (!handler) return;
    const normalized = normalizeLarkCardAction(data, this.configId);
    if (normalized) await handler(normalized);
  }

  private shouldProcessEvent(eventId?: string): boolean {
    if (!eventId) return true;
    if (this.processedEvents.has(eventId)) return false;
    this.processedEvents.set(eventId, Date.now());
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [key, value] of this.processedEvents) {
      if (value < cutoff) this.processedEvents.delete(key);
    }
    return true;
  }

  async sendMessage(
    chatId: string,
    response: NormalizedResponse,
  ): Promise<{ messageId: string | null }> {
    if (!this.client) return { messageId: null };
    try {
      const target = parseLarkSendTarget(chatId);
      const presentation = renderPresentationForChannel({
        platform: this.platform,
        capabilities: this.capabilities,
        response,
      });
      const formId = crypto.randomUUID().slice(0, 12);
      const rendered = renderLarkCard({
        text: presentation.text,
        blocks: presentation.blocks,
        buttons: presentation.buttons,
        formId,
      });

      const result = await this.client.im.v1.message.create({
        params: { receive_id_type: target.receiveIdType },
        data: {
          receive_id: target.receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(rendered.card),
        },
      });
      return { messageId: result?.data?.message_id ?? null };
    } catch (err) {
      this.logger.error('Lark sendMessage failed', { err });
      return { messageId: null };
    }
  }

  async editMessage(
    _chatId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const interactive = parseInteractiveMarkdown(text);
      const rendered = renderLarkCard({
        text: interactive.cleanText || text,
        blocks: interactive.blocks,
        formId: crypto.randomUUID().slice(0, 12),
      });
      await this.client.im.v1.message.patch({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify(rendered.card),
          msg_type: 'interactive',
        },
      });
    } catch (err) {
      this.logger.warn('Lark editMessage failed', { err });
    }
  }

  async sendFiles(chatId: string, filePaths: string[]): Promise<void> {
    if (!this.client || filePaths.length === 0) return;
    const target = parseLarkSendTarget(chatId);
    for (const fp of filePaths.slice(
      0,
      this.capabilities.maxAttachmentsPerMessage,
    )) {
      let size = 0;
      try {
        size = (await fs.stat(fp)).size;
      } catch {
        continue;
      }
      if (size > this.capabilities.maxAttachmentBytes) {
        this.logger.warn(
          `File too large for Lark upload (${(size / 1024 / 1024).toFixed(1)}MB): ${path.basename(fp)}`,
        );
        continue;
      }

      try {
        if (isImagePath(fp)) {
          const uploaded = await this.client.im.v1.image.create({
            data: {
              image_type: 'message',
              image: createReadStream(fp),
            },
          });
          if (!uploaded?.image_key) continue;
          await this.sendRawLarkMessage(target, 'image', {
            image_key: uploaded.image_key,
          });
        } else {
          const uploaded = await this.client.im.v1.file.create({
            data: {
              file_type: larkFileType(fp),
              file_name: path.basename(fp),
              file: createReadStream(fp),
            },
          });
          if (!uploaded?.file_key) continue;
          await this.sendRawLarkMessage(target, 'file', {
            file_key: uploaded.file_key,
          });
        }
      } catch (err) {
        this.logger.error('Lark sendFiles failed', {
          err,
          file: path.basename(fp),
        });
      }
    }
  }

  async addReaction(_channel: string, messageTs: string): Promise<void> {
    await this.addNamedReaction('', messageTs, 'loading');
  }

  async removeReaction(_channel: string, messageTs: string): Promise<void> {
    if (!this.client) return;
    try {
      const list = await this.client.im.v1.messageReaction.list({
        path: { message_id: messageTs },
        params: { reaction_type: this.toLarkEmojiType('loading') },
      });
      const reactionId = list?.data?.items?.find(
        (item: {
          operator?: { operator_type?: string };
          reaction_id?: string;
        }) => item.operator?.operator_type === 'app',
      )?.reaction_id;
      if (reactionId) {
        await this.client.im.v1.messageReaction.delete({
          path: { message_id: messageTs, reaction_id: reactionId },
        });
      }
    } catch (err) {
      this.logger.debug('Lark removeReaction failed', { err, messageTs });
    }
  }

  async addNamedReaction(
    _channel: string,
    messageTs: string,
    emoji: string,
  ): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.im.v1.messageReaction.create({
        path: { message_id: messageTs },
        data: {
          reaction_type: { emoji_type: this.toLarkEmojiType(emoji) },
        },
      });
    } catch (err) {
      this.logger.debug('Lark addNamedReaction failed', {
        err,
        messageTs,
        emoji,
      });
    }
  }

  private async sendRawLarkMessage(
    target: ReturnType<typeof parseLarkSendTarget>,
    msgType: 'image' | 'file',
    content: Record<string, unknown>,
  ): Promise<void> {
    await this.client.im.v1.message.create({
      params: { receive_id_type: target.receiveIdType },
      data: {
        receive_id: target.receiveId,
        msg_type: msgType,
        content: JSON.stringify(content),
      },
    });
  }

  private async conversationIdForMessage(
    messageId?: string,
  ): Promise<string | undefined> {
    if (!messageId || !this.client) return undefined;
    try {
      const result = await this.client.im.v1.message.get({
        path: { message_id: messageId },
      });
      return (
        result?.data?.thread_id ??
        result?.data?.root_id ??
        result?.data?.chat_id ??
        messageId
      );
    } catch {
      return messageId;
    }
  }

  private async resolveLarkResources(
    msg: NormalizedMessage,
  ): Promise<string[] | undefined> {
    const resources = msg.metadata?.larkResources as
      | LarkMessageResource[]
      | undefined;
    if (!this.client || !resources?.length || !msg.messageId) {
      return msg.attachments;
    }

    const out: string[] = [];
    const dir = path.join(os.tmpdir(), 'neuma-lark');
    await fs.mkdir(dir, { recursive: true });
    for (const resource of resources) {
      try {
        const ext = resourceExtension(resource);
        const filePath = path.join(dir, `lark-${crypto.randomUUID()}${ext}`);
        const result = await this.client.im.v1.messageResource.get({
          path: {
            message_id: msg.messageId,
            file_key: resource.fileKey,
          },
          params: { type: resource.type },
        });
        await result.writeFile(filePath);
        out.push(filePath);
      } catch (err) {
        this.logger.warn('Lark resource download failed', {
          err,
          type: resource.type,
        });
      }
    }
    return out.length > 0 ? out : msg.attachments;
  }

  private toLarkEmojiType(name: string): string {
    const mapped: Record<string, string> = {
      loading: 'Hourglass',
      hourglass_flowing_sand: 'Hourglass',
      heart: 'Heart',
      white_check_mark: 'CheckMark',
      thumbs_up: 'Thumbsup',
      '+1': 'Thumbsup',
    };
    return mapped[name] ?? name;
  }
}

function isImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|ico)$/i.test(filePath);
}

function larkFileType(
  filePath: string,
): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.doc' || ext === '.docx') return 'doc';
  if (ext === '.xls' || ext === '.xlsx') return 'xls';
  if (ext === '.ppt' || ext === '.pptx') return 'ppt';
  if (ext === '.mp4') return 'mp4';
  if (ext === '.opus' || ext === '.ogg') return 'opus';
  return 'stream';
}

function resourceExtension(resource: LarkMessageResource): string {
  if (resource.fileName) return path.extname(resource.fileName) || '.bin';
  if (resource.type === 'image') return '.png';
  if (resource.type === 'audio') return '.opus';
  if (resource.type === 'media') return '.mp4';
  return '.bin';
}
