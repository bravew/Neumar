import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AttachmentBuilder,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  GuildPremiumTier,
  MessageFlags,
  Partials,
  REST,
  Routes,
  type DMChannel,
  type Interaction,
  type Message,
  type MessageReaction,
  type NewsChannel,
  type PartialMessageReaction,
  type PublicThreadChannel,
  type PrivateThreadChannel,
  type TextChannel,
} from 'discord.js';

import { renderPresentationForChannel } from '../_shared/presentation/render';
import { BasePlugin } from '../base-plugin';
import type {
  BasePluginConfig,
  ChannelCapabilities,
  NormalizedMessage,
  NormalizedResponse,
  VoiceMessageInfo,
} from '../types';
import { commandToMessageText, registerDiscordCommands } from './commands';
import {
  renderDiscordInteractive,
  type DiscordInteractiveDefinition,
} from './components';
import { chunkDiscordMessage, toDiscordMarkdown } from './formatter';
import { toNormalizedMessage } from './message-adapter';

type DiscordSendChannel =
  | TextChannel
  | DMChannel
  | NewsChannel
  | PublicThreadChannel
  | PrivateThreadChannel;

interface DiscordFormState {
  trackedAt: number;
  definitions: Map<string, DiscordInteractiveDefinition>;
  values: Map<string, { value: string; display: string }>;
}

export class DiscordPlugin extends BasePlugin {
  readonly platform = 'discord';
  readonly capabilities: ChannelCapabilities = {
    supportsEditMessage: true,
    supportsThreads: true,
    supportsButtons: true,
    supportsSelects: true,
    supportsModals: true,
    supportsDatePicker: false,
    supportsReactions: true,
    supportsTyping: true,
    supportsUnfurlControl: true,
    supportsFileUpload: true,
    maxMessageLength: 2000,
    maxAttachmentBytes: 25 * 1024 * 1024,
    maxAttachmentsPerMessage: 10,
    supportsMarkdown: 'basic',
    runtimeClass: 'official',
  };

  private client: Client | null = null;
  private savedConfig: BasePluginConfig | null = null;
  private formStates = new Map<string, DiscordFormState>();

  private static readonly FORM_TTL_MS = 24 * 60 * 60 * 1000;

  protected async onStart(config: BasePluginConfig): Promise<void> {
    this.savedConfig = config;
    if (!config.token) {
      throw new Error('Discord bot token not configured');
    }

    const authUser = (await new REST({ version: '10' })
      .setToken(config.token)
      .get(Routes.user('@me'))) as { id?: string; username?: string };
    if (!authUser.id) {
      throw new Error('Discord auth probe did not return a bot user id');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
      ],
    });

    const handler = this.getMessageHandler();

    // Register READY listener before login to avoid race condition.
    // Also wire Events.Error so a login failure (e.g. bad token, disallowed
    // intents) rejects immediately instead of waiting for the 30 s timeout.
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord client READY timeout after 30s'));
      }, 30_000);

      this.client!.once(Events.ClientReady, () => {
        clearTimeout(timeout);
        this.logger.info(
          `Discord bot connected as ${this.client!.user?.tag ?? 'unknown'}`,
        );
        resolve();
      });

      this.client!.once(Events.Error, (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      if (!handler) return;

      // In guild channels, optionally require an @-mention of the bot.
      // DMs are always processed regardless of the setting.
      const isDM = !message.guildId;
      if (!isDM && config.mention_only) {
        const isBotMention = this.client?.user
          ? message.mentions.has(this.client.user.id)
          : false;
        if (!isBotMention) return;
      }

      // Check for voice message (Discord flag 1 << 13 = 8192)
      const isVoiceMessage = (message.flags.bitfield & (1 << 13)) !== 0;
      if (isVoiceMessage) {
        try {
          const voiceInfo = await this.downloadVoiceMessage(message);
          if (voiceInfo) {
            const normalized = toNormalizedMessage(
              message,
              this.client!.user!.id,
              this.configId,
            );
            normalized.voice = voiceInfo;
            // Clear attachments so the voice file isn't re-downloaded as
            // an "image" and echoed back to the user.
            normalized.attachments = undefined;
            await handler(normalized);
          }
        } catch (err) {
          this.logger.error('Error handling Discord voice message', { err });
        }
        return;
      }

      if (!message.content && !message.attachments.size) return;

      try {
        const normalized = toNormalizedMessage(
          message,
          this.client!.user!.id,
          this.configId,
        );
        await handler(normalized);
      } catch (err) {
        this.logger.error('Error handling Discord message', { err });
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      await this.handleInteraction(interaction, handler).catch((err) => {
        this.logger.error('Error handling Discord interaction', { err });
      });
    });

    this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
      await this.handleReaction('added', reaction, user, handler).catch(
        (err) => {
          this.logger.error('Error handling Discord reaction add', { err });
        },
      );
    });

    this.client.on(Events.MessageReactionRemove, async (reaction, user) => {
      await this.handleReaction('removed', reaction, user, handler).catch(
        (err) => {
          this.logger.error('Error handling Discord reaction remove', { err });
        },
      );
    });

    this.client.on(Events.Error, (err) => {
      if (this.savedConfig) {
        this.onError(err, this.savedConfig).catch(() => {});
      }
    });

    this.client.on(Events.ShardError, (err) => {
      if (this.savedConfig) this.onError(err, this.savedConfig).catch(() => {});
    });
    this.client.on(Events.ShardDisconnect, (event) => {
      const err = new Error(`Discord shard disconnected: ${event.code}`);
      if (this.savedConfig) this.onError(err, this.savedConfig).catch(() => {});
    });
    this.client.on(Events.ShardReconnecting, (id) => {
      this.logger.warn('Discord shard reconnecting', { shardId: id });
    });
    this.client.on(Events.ShardReady, (id) => {
      this.logger.info('Discord shard ready', { shardId: id });
    });

    await this.client.login(config.token);
    await readyPromise;

    await registerDiscordCommands({
      token: config.token,
      applicationId: authUser.id,
      guildId: process.env.DISCORD_DEV_GUILD_ID,
    }).catch((err) => {
      this.logger.warn('Discord slash command registration failed', { err });
    });
  }

  protected async onStop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
    this.savedConfig = null;
  }

  protected setupMessageHandler(
    _handler: (msg: NormalizedMessage) => Promise<void>,
  ): void {
    // Handler stored in base class; Discord uses Events.MessageCreate registered in onStart
  }

  private async handleInteraction(
    interaction: Interaction,
    handler: ((msg: NormalizedMessage) => Promise<void>) | null,
  ): Promise<void> {
    if (!handler) return;

    if (interaction.isChatInputCommand()) {
      const options = interaction.options.data.map((option) => ({
        name: option.name,
        value: option.value as unknown,
      }));
      const text = commandToMessageText(interaction.commandName, options);
      await interaction.reply({
        content: 'Queued.',
        flags: MessageFlags.Ephemeral,
      });
      await handler(this.normalizedFromInteraction(interaction, text, true));
      return;
    }

    if (interaction.isModalSubmit()) {
      const values: string[] = [];
      for (const row of interaction.components ?? []) {
        if (!('components' in row)) continue;
        for (const component of row.components ?? []) {
          const value = interaction.fields.getTextInputValue(
            component.customId,
          );
          if (value) values.push(value);
        }
      }
      await interaction.reply({
        content: 'Submitted.',
        flags: MessageFlags.Ephemeral,
      });
      await handler(
        this.normalizedFromInteraction(interaction, values.join('\n'), false),
      );
      return;
    }

    if (!interaction.isMessageComponent()) return;
    if (!interaction.customId.startsWith('neuma:')) return;

    if (interaction.customId.startsWith('neuma:modal:')) {
      const state = this.stateForCustomId(interaction.customId);
      const definition = state?.definitions.get(interaction.customId);
      if (definition?.modal && interaction.isButton()) {
        await interaction.showModal(definition.modal);
      } else {
        await interaction.reply({
          content: 'This form has expired.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isAnySelectMenu()) {
      const state = this.stateForCustomId(interaction.customId);
      const definition = state?.definitions.get(interaction.customId);
      const values = interaction.values;
      const display = values.join(', ');
      state?.values.set(interaction.customId, {
        value: values.join('\n'),
        display: definition?.label
          ? `${definition.label}: ${display}`
          : display,
      });
      await interaction.deferUpdate();
      return;
    }

    if (interaction.isButton()) {
      const state = this.stateForCustomId(interaction.customId);
      if (interaction.customId.startsWith('neuma:form:submit:')) {
        const submitted = Array.from(state?.values.values() ?? []);
        await interaction.update({
          content:
            submitted.length > 0
              ? `Submitted:\n${submitted.map((item) => item.display).join('\n')}`
              : 'Submitted.',
          components: [],
        });
        await handler(
          this.normalizedFromInteraction(
            interaction,
            submitted.map((item) => item.display).join('\n') || 'submitted',
            false,
          ),
        );
        return;
      }

      const definition = state?.definitions.get(interaction.customId);
      await interaction.deferUpdate();
      if (definition?.value) {
        await handler(
          this.normalizedFromInteraction(interaction, definition.value, false),
        );
      }
    }
  }

  private async handleReaction(
    action: 'added' | 'removed',
    reaction: MessageReaction | PartialMessageReaction,
    user: { id: string; bot?: boolean },
    handler: ((msg: NormalizedMessage) => Promise<void>) | null,
  ): Promise<void> {
    if (!handler || user.bot) return;
    const fullReaction = reaction.partial ? await reaction.fetch() : reaction;
    const message = fullReaction.message as Message;
    const emoji = fullReaction.emoji.name ?? String(fullReaction.emoji);
    await handler({
      platform: 'discord',
      configId: this.configId,
      messageId: message.id,
      conversationId: this.conversationIdForMessage(message),
      sessionKey: this.sessionKeyForMessage(message),
      userId: user.id,
      text: `reaction_${action}: ${emoji}`,
      isCommand: false,
      metadata: {
        kind: 'reaction',
        action,
        emoji,
        channelId: message.channelId,
        messageId: message.id,
      },
    });
  }

  private normalizedFromInteraction(
    interaction: Interaction,
    text: string,
    isCommand: boolean,
  ): NormalizedMessage {
    const commandName = isCommand ? text.slice(1).split(/\s+/)[0] : undefined;
    const commandArgs = isCommand
      ? text.slice(1).split(/\s+/).slice(1)
      : undefined;
    const channelId =
      interaction.channelId ?? interaction.channel?.id ?? 'unknown';
    const userId = interaction.user.id;
    const messageId =
      'message' in interaction ? (interaction.message?.id ?? null) : null;
    const member = interaction.member;
    const authorName =
      member &&
      'displayName' in member &&
      typeof member.displayName === 'string'
        ? member.displayName
        : interaction.user.username;
    return {
      platform: 'discord',
      configId: this.configId,
      messageId,
      conversationId: channelId,
      sessionKey: channelId,
      userId,
      text,
      isCommand,
      commandName,
      commandArgs,
      metadata: {
        guildId: interaction.guildId ?? null,
        channelId,
        authorName,
        interactionId: interaction.id,
      },
    };
  }

  private stateForCustomId(customId: string): DiscordFormState | undefined {
    this.pruneFormStates();
    const formId = customId.split(':').at(-1);
    if (!formId) return undefined;
    return this.formStates.get(formId);
  }

  private pruneFormStates(): void {
    const cutoff = Date.now() - DiscordPlugin.FORM_TTL_MS;
    for (const [formId, state] of this.formStates) {
      if (state.trackedAt < cutoff) this.formStates.delete(formId);
    }
  }

  async sendTypingAction(conversationId: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.resolveChannel(conversationId);
      await channel?.sendTyping();
    } catch {
      /* ignore */
    }
  }

  async sendMessage(
    conversationId: string,
    response: NormalizedResponse,
  ): Promise<{ messageId: string | null }> {
    if (!this.client) return { messageId: null };

    try {
      const channel = await this.resolveChannel(conversationId);
      if (!channel) return { messageId: null };

      const presentation = renderPresentationForChannel({
        platform: this.platform,
        capabilities: this.capabilities,
        response,
      });
      const formId = crypto.randomUUID().slice(0, 12);
      const rendered = renderDiscordInteractive({
        blocks: presentation.blocks,
        buttons: presentation.buttons,
        formId,
      });
      if (rendered.definitions.length > 0) {
        this.formStates.set(formId, {
          trackedAt: Date.now(),
          definitions: new Map(
            rendered.definitions.map((definition) => [
              definition.customId,
              definition,
            ]),
          ),
          values: new Map(),
        });
      }

      const text = toDiscordMarkdown(presentation.text);
      const chunks = chunkDiscordMessage(text);
      const suppressEmbeds = response.unfurl === false;
      let lastMsgId: string | null = null;
      for (const [index, chunk] of chunks.entries()) {
        const isLast = index === chunks.length - 1;
        const sent = await channel.send(
          suppressEmbeds || (isLast && rendered.components.length > 0)
            ? {
                content: chunk,
                ...(isLast && rendered.components.length > 0
                  ? { components: rendered.components }
                  : {}),
                ...(suppressEmbeds
                  ? { flags: MessageFlags.SuppressEmbeds }
                  : {}),
              }
            : chunk,
        );
        lastMsgId = sent.id;
      }
      return { messageId: lastMsgId };
    } catch (err) {
      this.logger.error('Discord sendMessage failed', { err, conversationId });
      return { messageId: null };
    }
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.resolveChannel(conversationId);
      if (!channel) return;
      const msg = await channel.messages.fetch(messageId);
      await msg.edit(text.slice(0, 2000));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('Unknown Message')) {
        this.logger.warn('Discord editMessage failed', { err: message });
      }
    }
  }

  async sendPhotoUrls(conversationId: string, urls: string[]): Promise<void> {
    if (!this.client || urls.length === 0) return;
    try {
      const channel = await this.resolveChannel(conversationId);
      if (!channel) return;
      // Discord auto-embeds image URLs sent as message content
      await channel.send({ content: urls.join('\n') });
    } catch (err) {
      this.logger.error('Discord sendPhotoUrls failed', {
        err,
        conversationId,
      });
    }
  }

  async sendFiles(conversationId: string, filePaths: string[]): Promise<void> {
    if (!this.client || filePaths.length === 0) return;
    try {
      const channel = await this.resolveChannel(conversationId);
      if (!channel) return;
      const uploadCap = this.uploadCapFor(channel);

      const attachments: AttachmentBuilder[] = [];
      for (const fp of filePaths) {
        let size: number;
        try {
          size = (await fs.stat(fp)).size;
        } catch {
          continue; // file doesn't exist
        }
        if (size > uploadCap) {
          this.logger.warn(
            `File too large for Discord upload (${(size / 1024 / 1024).toFixed(1)}MB): ${path.basename(fp)}`,
          );
          continue;
        }
        attachments.push(
          new AttachmentBuilder(fp, { name: path.basename(fp) }),
        );
      }

      if (attachments.length === 0) return;

      // Discord allows max 10 attachments per message
      for (let i = 0; i < attachments.length; i += 10) {
        const batch = attachments.slice(i, i + 10);
        await channel.send({ files: batch });
      }
    } catch (err) {
      this.logger.error('Discord sendFiles failed', { err, conversationId });
    }
  }

  async addReaction(channel: string, messageTs: string): Promise<void> {
    await this.addNamedReaction(channel, messageTs, 'loading');
  }

  async removeReaction(channel: string, messageTs: string): Promise<void> {
    if (!this.client) return;
    try {
      const discordChannel = await this.resolveChannel(channel);
      const message = await discordChannel?.messages.fetch(messageTs);
      await message?.reactions.cache
        .find((reaction) => reaction.me)
        ?.users.remove(this.client.user!.id);
    } catch (err) {
      this.logger.debug('Discord removeReaction failed', { err, channel });
    }
  }

  async addNamedReaction(
    channel: string,
    messageTs: string,
    emoji: string,
  ): Promise<void> {
    if (!this.client) return;
    try {
      const discordChannel = await this.resolveChannel(channel);
      const message = await discordChannel?.messages.fetch(messageTs);
      await message?.react(this.toDiscordEmoji(emoji));
    } catch (err) {
      this.logger.debug('Discord addNamedReaction failed', {
        err,
        channel,
        emoji,
      });
    }
  }

  private toDiscordEmoji(name: string): string {
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

  /**
   * Download a Discord voice message attachment to a local temp file.
   * Returns VoiceMessageInfo or null if the download fails.
   */
  private async downloadVoiceMessage(
    message: Message,
  ): Promise<VoiceMessageInfo | null> {
    const audioAttachment = message.attachments.first();
    if (!audioAttachment) {
      this.logger.warn('Voice message has no attachment');
      return null;
    }

    try {
      const tmpDir = path.join(os.tmpdir(), 'neuma-voice');
      await fs.mkdir(tmpDir, { recursive: true });

      const ext = path.extname(audioAttachment.name) || '.ogg';
      const filePath = path.join(
        tmpDir,
        `discord-voice-${crypto.randomUUID()}${ext}`,
      );

      const maxBytes = 25 * 1024 * 1024; // 25 MB
      const response = await fetch(audioAttachment.url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        this.logger.warn(
          `Failed to download voice attachment: ${response.status}`,
        );
        return null;
      }

      const contentLength = Number(
        response.headers.get('content-length') ?? '0',
      );
      if (contentLength > maxBytes) {
        this.logger.warn(
          `Voice attachment too large (${Math.round(contentLength / 1024 / 1024)}MB > 25MB)`,
        );
        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        this.logger.warn(
          `Voice attachment body too large (${Math.round(buffer.byteLength / 1024 / 1024)}MB > 25MB)`,
        );
        return null;
      }
      await fs.writeFile(filePath, buffer);

      this.logger.info(
        `Downloaded Discord voice message (${buffer.byteLength} bytes)`,
      );

      return {
        filePath,
        mimeType: audioAttachment.contentType ?? 'audio/ogg',
        // discord.js Attachment.duration is already in seconds
        durationSecs: audioAttachment.duration ?? undefined,
        sizeBytes: audioAttachment.size,
      };
    } catch (err) {
      this.logger.error('Failed to download Discord voice message', { err });
      return null;
    }
  }

  private conversationIdForMessage(message: Message): string {
    const channel = message.channel;
    if (message.guildId && 'isThread' in channel && channel.isThread()) {
      const parentId = channel.parentId ?? message.channelId;
      return channel.parent?.type === ChannelType.GuildForum
        ? `forum:${parentId}:${channel.id}`
        : channel.id;
    }
    return message.channelId;
  }

  private sessionKeyForMessage(message: Message): string {
    return this.conversationIdForMessage(message);
  }

  private uploadCapFor(channel: DiscordSendChannel): number {
    const tier =
      'guild' in channel && channel.guild
        ? channel.guild.premiumTier
        : GuildPremiumTier.None;
    const caps: Record<number, number> = {
      [GuildPremiumTier.None]: 25 * 1024 * 1024,
      [GuildPremiumTier.Tier1]: 25 * 1024 * 1024,
      [GuildPremiumTier.Tier2]: 50 * 1024 * 1024,
      [GuildPremiumTier.Tier3]: 100 * 1024 * 1024,
    };
    return caps[tier] ?? 25 * 1024 * 1024;
  }

  private async resolveChannel(
    target: string,
  ): Promise<DiscordSendChannel | null> {
    if (!this.client) return null;
    try {
      if (target.startsWith('dm:')) {
        const userId = target.slice(3);
        const user = await this.client.users.fetch(userId);
        return (await user.createDM()) as DMChannel;
      }
      const channelId = target.startsWith('forum:')
        ? target.split(':')[2]
        : target.includes(':')
          ? (target.split(':')[0] ?? '')
          : target;
      if (!channelId) return null;
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return null;
      if (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement ||
        channel.type === ChannelType.DM ||
        channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread
      ) {
        return channel as DiscordSendChannel;
      }
      return null;
    } catch {
      return null;
    }
  }
}
