/**
 * Discord Channel Adapter
 *
 * Uses discord.js v14 for Discord Bot API integration.
 * Patterns adopted from openclaw + telegram adapter:
 *   - GatewayIntentBits for message/guild access
 *   - Auto-reconnect via discord.js built-in WebSocket management
 *   - Code-fence-aware message chunking (2000 char limit)
 *   - Button interactions via ActionRowBuilder + ButtonBuilder
 *   - File attachments for images/documents
 *   - Voice message support (receive + send via Discord voice message protocol)
 *   - Graceful shutdown via client.destroy()
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ActionRowBuilder,
  ActivityType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PresenceUpdateStatus,
  type DMChannel,
  type Message,
  type TextChannel,
} from 'discord.js';

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
  OutboundFile,
  SendResult,
} from '../types';
import { chunkDiscordMessage, toDiscordMarkdown } from './formatter';
import { downloadDiscordVoiceAttachment } from './voice';

const logger = createLogger('DiscordAdapter');

interface DiscordConfig extends ChannelConfig {
  botToken: string;
  applicationId?: string;
}

/** Map discord.js ButtonStyle names to our style types. */
const BUTTON_STYLE_MAP: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  danger: ButtonStyle.Danger,
  default: ButtonStyle.Secondary,
};

/** File extensions recognized as images for inline display. */
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
]);

class DiscordAdapter implements ChannelAdapter {
  readonly id = 'discord';
  readonly name = 'Discord';
  readonly capabilities: ChannelCapabilities = {
    maxMessageLength: 2000,
    supportsMarkdown: true,
    supportsThreads: true,
    supportsReactions: true,
    supportsImages: true,
    supportsButtons: true,
    supportsCommands: true,
    supportsEditMessage: true,
    supportsRichCards: false,
    runtimeClass: 'official',
  };

  private client: Client | null = null;
  private connected = false;
  private currentHealth: ChannelHealth = 'disabled';
  private messageHandler: InboundHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private presenceHandler: ((health: ChannelHealth) => void) | null = null;

  constructor(private config: DiscordConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
      ],
    });

    // Register READY listener BEFORE login to avoid race condition
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord client READY timeout after 30s'));
      }, 30_000);

      this.client!.once(Events.ClientReady, () => {
        clearTimeout(timeout);
        this.connected = true;
        this.setHealth('connected');
        // Set presence to online so users see the bot is active
        this.client!.user?.setPresence({
          status: PresenceUpdateStatus.Online,
          activities: [{ name: 'Ready', type: ActivityType.Custom }],
        });
        logger.info(
          `Discord bot connected as ${this.client!.user?.tag ?? 'unknown'}`,
        );
        resolve();
      });

      this.client!.once(Events.Error, (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Register message/error handlers before login
    this.registerEventHandlers();

    await this.client.login(this.config.botToken);
    await readyPromise;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.setHealth('disabled');

    if (this.client) {
      // Set presence to invisible before disconnecting so users see the bot go offline
      try {
        this.client.user?.setPresence({
          status: PresenceUpdateStatus.Invisible,
        });
      } catch {
        // Non-critical — client may already be partially destroyed
      }
      try {
        await this.client.destroy();
      } catch {
        // Client may already be destroyed
      }
      this.client = null;
    }

    logger.info('Discord bot disconnected');
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
      const channel = await this.resolveChannel(chatId);
      if (!channel) {
        return {
          messageId: '',
          success: false,
          error: `Channel ${chatId} not found or not text-based`,
        };
      }

      // Send file attachments first (as separate messages if needed)
      if (content.files && content.files.length > 0) {
        return this.sendWithFiles(channel, content);
      }

      const text = toDiscordMarkdown(content.text);
      const chunks = chunkDiscordMessage(text);
      let lastMessageId = '';

      for (let i = 0; i < chunks.length; i++) {
        const payload: Record<string, unknown> = { content: chunks[i] };

        // Attach buttons only to the first chunk
        if (i === 0 && content.buttons && content.buttons.length > 0) {
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            content.buttons.map((btn) =>
              new ButtonBuilder()
                .setCustomId(`${btn.action}:${btn.payload ?? ''}`)
                .setLabel(btn.label)
                .setStyle(
                  BUTTON_STYLE_MAP[btn.style ?? 'default'] ??
                    ButtonStyle.Secondary,
                ),
            ),
          );
          payload.components = [row];
        }

        // Reply to a specific message on the first chunk
        if (i === 0 && content.replyToId) {
          payload.reply = { messageId: content.replyToId };
        }

        const sent = await channel.send(
          payload as Parameters<TextChannel['send']>[0],
        );
        lastMessageId = sent.id;
      }

      return { messageId: lastMessageId, success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to send Discord message to ${chatId}`, errorMsg);
      return { messageId: '', success: false, error: errorMsg };
    }
  }

  async editMessage(
    chatId: string,
    messageId: string,
    content: OutboundContent,
  ): Promise<void> {
    if (!this.client) return;

    try {
      const channel = await this.resolveChannel(chatId);
      if (!channel) return;

      const message = await channel.messages.fetch(messageId);
      const text = toDiscordMarkdown(content.text);

      // If edited text exceeds limit, truncate with indicator
      const truncated =
        text.length > 2000 ? text.slice(0, 1990) + '\n…(truncated)' : text;

      const payload: Record<string, unknown> = { content: truncated };

      if (content.buttons && content.buttons.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          content.buttons.map((btn) =>
            new ButtonBuilder()
              .setCustomId(`${btn.action}:${btn.payload ?? ''}`)
              .setLabel(btn.label)
              .setStyle(
                BUTTON_STYLE_MAP[btn.style ?? 'default'] ??
                  ButtonStyle.Secondary,
              ),
          ),
        );
        payload.components = [row];
      }

      await message.edit(payload as Parameters<Message['edit']>[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "Unknown Message" means it was deleted — not an actionable error
      if (!msg.includes('Unknown Message')) {
        throw err;
      }
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.resolveChannel(chatId);
      if (channel) {
        await channel.sendTyping();
      }
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
  // Private — File Attachments
  // ---------------------------------------------------------------------------

  /**
   * Send a message with file attachments.
   * Images are sent inline with text caption; non-images as file attachments.
   * Discord allows up to 10 attachments per message.
   */
  private async sendWithFiles(
    channel: TextChannel | DMChannel,
    content: OutboundContent,
  ): Promise<SendResult> {
    const files = content.files ?? [];
    const attachments: AttachmentBuilder[] = [];

    for (const file of files) {
      const attachment = await this.buildAttachment(file);
      if (attachment) {
        attachments.push(attachment);
      }
    }

    if (attachments.length === 0) {
      // All files were invalid — fall back to text-only
      return this.sendMessage(channel.id, { ...content, files: undefined });
    }

    const text = content.text ? toDiscordMarkdown(content.text) : undefined;

    // Discord allows max 10 attachments per message; batch if needed
    const MAX_ATTACHMENTS_PER_MSG = 10;
    let lastMessageId = '';

    for (let i = 0; i < attachments.length; i += MAX_ATTACHMENTS_PER_MSG) {
      const batch = attachments.slice(i, i + MAX_ATTACHMENTS_PER_MSG);
      const isFirst = i === 0;

      const payload: Record<string, unknown> = { files: batch };

      // Only include text caption on the first message
      if (isFirst && text) {
        // Truncate to fit within 2000 chars
        payload.content =
          text.length > 2000 ? text.slice(0, 1990) + '\n…(truncated)' : text;
      }

      if (isFirst && content.replyToId) {
        payload.reply = { messageId: content.replyToId };
      }

      if (isFirst && content.buttons && content.buttons.length > 0) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          content.buttons.map((btn) =>
            new ButtonBuilder()
              .setCustomId(`${btn.action}:${btn.payload ?? ''}`)
              .setLabel(btn.label)
              .setStyle(
                BUTTON_STYLE_MAP[btn.style ?? 'default'] ??
                  ButtonStyle.Secondary,
              ),
          ),
        );
        payload.components = [row];
      }

      const sent = await channel.send(
        payload as Parameters<TextChannel['send']>[0],
      );
      lastMessageId = sent.id;
    }

    // If text was too long for a single caption, send remaining chunks
    if (text && text.length > 2000) {
      const remaining = text.slice(1990);
      const chunks = chunkDiscordMessage(remaining);
      for (const chunk of chunks) {
        const sent = await channel.send({ content: chunk });
        lastMessageId = sent.id;
      }
    }

    return { messageId: lastMessageId, success: true };
  }

  /**
   * Build a discord.js AttachmentBuilder from an OutboundFile.
   * Returns null if the file doesn't exist or can't be read.
   */
  private async buildAttachment(
    file: OutboundFile,
  ): Promise<AttachmentBuilder | null> {
    try {
      const stat = await fs.stat(file.filePath).catch(() => null);
      if (!stat) {
        logger.warn(`Attachment file not found: ${file.filePath}`);
        return null;
      }

      // Discord free tier: 25MB max per file
      const MAX_FILE_SIZE = 25 * 1024 * 1024;
      if (stat.size > MAX_FILE_SIZE) {
        logger.warn(
          `Attachment too large (${stat.size} bytes): ${file.filePath}`,
        );
        return null;
      }

      const fileName = file.name ?? path.basename(file.filePath);
      return new AttachmentBuilder(file.filePath, { name: fileName });
    } catch (err) {
      logger.warn(`Failed to build attachment for ${file.filePath}`, err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Channel Resolution
  // ---------------------------------------------------------------------------

  private async resolveChannel(
    chatId: string,
  ): Promise<TextChannel | DMChannel | null> {
    if (!this.client) return null;
    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel) return null;
      // Accept guild text channels, DM channels, and thread channels
      if (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.DM ||
        channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread ||
        channel.type === ChannelType.AnnouncementThread
      ) {
        return channel as TextChannel | DMChannel;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — Event Handlers
  // ---------------------------------------------------------------------------

  private registerEventHandlers(): void {
    if (!this.client) return;

    // Handle incoming messages (text, images, voice messages)
    this.client.on(Events.MessageCreate, async (message) => {
      // Ignore messages from bots (including self)
      if (message.author.bot) return;

      logger.debug(
        `MessageCreate from ${message.author.username} in ${message.channelId}: "${message.content.slice(0, 100)}" (handler=${!!this.messageHandler})`,
      );

      if (!this.messageHandler) return;

      // Check for voice message (flag 1 << 13 = 8192)
      const isVoiceMessage = (message.flags.bitfield & (1 << 13)) !== 0;
      if (isVoiceMessage) {
        await this.handleVoiceMessage(message);
        return;
      }

      // Without MessageContent privileged intent, guild messages arrive with empty content
      if (!message.content && !message.attachments.size && !message.guildId) {
        return;
      }
      if (!message.content && !message.attachments.size && message.guildId) {
        logger.warn(
          'Received guild message with empty content — enable Message Content Intent in Discord Developer Portal',
        );
        return;
      }

      try {
        const isCommand = message.content.startsWith('/');

        // Collect all attachments with structured metadata
        const allAttachments = [...message.attachments.values()];
        logger.debug(
          `Message has ${allAttachments.length} attachment(s): ${allAttachments.map((a) => `${a.name} (${a.contentType})`).join(', ') || 'none'}`,
        );

        let contentType: 'text' | 'command' | 'image' | 'file' = isCommand
          ? 'command'
          : 'text';
        const content = message.content;

        // Build structured attachment list for ALL attachment types
        const attachments = allAttachments.map((a) => ({
          url: a.url,
          contentType: a.contentType ?? undefined,
          filename: a.name ?? undefined,
        }));

        if (allAttachments.length > 0) {
          const hasImages = allAttachments.some((a) =>
            a.contentType?.startsWith('image/'),
          );
          contentType = hasImages ? 'image' : 'file';
        }

        await this.messageHandler({
          channelId: 'discord',
          chatId: String(message.channelId),
          senderId: message.author.id,
          senderName:
            message.member?.displayName ??
            message.author.displayName ??
            message.author.username,
          content,
          contentType,
          attachments: attachments.length > 0 ? attachments : undefined,
          messageId: message.id,
          threadId: message.reference?.messageId ?? undefined,
          timestamp: message.createdAt.toISOString(),
          raw: message,
        });
      } catch (err) {
        logger.error('Error handling Discord message', err);
        if (this.errorHandler) {
          this.errorHandler(
            err instanceof Error ? err : new Error(String(err)),
            'message_handler',
          );
        }
      }
    });

    // Handle button interactions
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton()) return;
      if (!this.messageHandler) return;

      try {
        // Acknowledge the interaction to prevent "interaction failed" in Discord
        await interaction.deferUpdate();

        await this.messageHandler({
          channelId: 'discord',
          chatId: String(interaction.channelId),
          senderId: interaction.user.id,
          senderName:
            interaction.member && 'displayName' in interaction.member
              ? (interaction.member.displayName as string)
              : (interaction.user.displayName ?? interaction.user.username),
          content: interaction.customId,
          contentType: 'command',
          messageId: interaction.id,
          timestamp: interaction.createdAt.toISOString(),
          raw: interaction,
        });
      } catch (err) {
        logger.error('Error handling Discord interaction', err);
        if (this.errorHandler) {
          this.errorHandler(
            err instanceof Error ? err : new Error(String(err)),
            'interaction_handler',
          );
        }
      }
    });

    // Monitor connection health
    this.client.on(Events.ShardError, (error) => {
      logger.error('Discord shard error', error.message);
      this.setHealth('degraded');
      if (this.errorHandler) {
        this.errorHandler(error, 'shard_error');
      }
    });

    this.client.on(Events.ShardDisconnect, (_event, shardId) => {
      logger.warn(`Discord shard ${shardId} disconnected`);
      this.setHealth('degraded');
      // discord.js auto-reconnects — don't set connected=false here
    });

    this.client.on(Events.ShardReconnecting, (shardId) => {
      logger.info(`Discord shard ${shardId} reconnecting...`);
    });

    this.client.on(Events.ShardResume, (shardId, replayedEvents) => {
      this.setHealth('connected');
      logger.info(
        `Discord shard ${shardId} resumed (${replayedEvents} events replayed)`,
      );
    });

    this.client.on(Events.Error, (error) => {
      logger.error('Discord client error', error.message);
      if (this.errorHandler) {
        this.errorHandler(error, 'client_error');
      }
    });

    this.client.on(Events.Warn, (warning) => {
      logger.warn(`Discord client warning: ${warning}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Private — Voice Message Handling
  // ---------------------------------------------------------------------------

  /**
   * Handle incoming voice messages from Discord.
   * Downloads the audio and forwards with `contentType: 'voice'` and
   * `VoiceMetadata` so the gateway's voice transcription middleware
   * can route it through the STT pipeline.
   */
  private async handleVoiceMessage(message: Message): Promise<void> {
    if (!this.messageHandler) return;

    try {
      const audioAttachment = message.attachments.first();
      if (!audioAttachment) {
        logger.warn('Voice message has no attachment');
        return;
      }

      // Download the voice message audio to a temp file
      const audioPath = await downloadDiscordVoiceAttachment(
        audioAttachment.url,
        audioAttachment.name,
      );

      await this.messageHandler({
        channelId: 'discord',
        chatId: String(message.channelId),
        senderId: message.author.id,
        senderName:
          message.member?.displayName ??
          message.author.displayName ??
          message.author.username,
        content: '',
        contentType: 'voice',
        voice: {
          filePath: audioPath,
          mimeType: audioAttachment.contentType ?? 'audio/ogg',
          // discord.js Attachment.duration is already in seconds
          durationSecs: audioAttachment.duration ?? undefined,
          sizeBytes: audioAttachment.size,
        },
        messageId: message.id,
        threadId: message.reference?.messageId ?? undefined,
        timestamp: message.createdAt.toISOString(),
        raw: message,
      });
    } catch (err) {
      logger.error('Error handling Discord voice message', err);
      if (this.errorHandler) {
        this.errorHandler(
          err instanceof Error ? err : new Error(String(err)),
          'voice_message_handler',
        );
      }
    }
  }
}

// Self-register
registerChannel(
  'discord',
  (config) => {
    const discordConfig = config as DiscordConfig;
    if (!discordConfig.botToken) return null;
    return new DiscordAdapter(discordConfig);
  },
  {
    capabilities: new DiscordAdapter({ enabled: false, botToken: '' })
      .capabilities,
  },
);

export { IMAGE_EXTENSIONS };
