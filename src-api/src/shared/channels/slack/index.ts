import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { App } from '@slack/bolt';

import { getDatabase } from '@/shared/db';
import {
  deleteSlackTeam,
  deleteSlackUserLink,
} from '@/shared/db/operations-slack-home';
import { validateImageResponse } from '@/shared/utils/image-validator';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import { downloadWithRedirects } from '../_shared/media';
import { renderPresentationForChannel } from '../_shared/presentation/render';
import { BasePlugin } from '../base-plugin';
import type {
  BasePluginConfig,
  ChannelCapabilities,
  NormalizedMessage,
  NormalizedResponse,
} from '../types';
import { buildResponseBlocks } from './blocks';
import {
  MARKDOWN_BLOCK_LIMIT,
  markdownToMrkdwn,
  truncateForSlack,
} from './formatter';
import { publishHomeView, registerHomeHandlers } from './home';
import {
  buildInteractiveActionsBlocks,
  FORM_ACTION_PREFIX,
  FORM_SUBMIT_ACTION_ID,
} from './interactive-parser';
import { downloadSlackVoice } from './media';
import { toNormalizedMessage } from './message-adapter';

/** Submit action_id emitted by pre-form-namespace messages still in Slack history. */
const LEGACY_SUBMIT_ACTION_ID = 'neuma:submit:send';

/**
 * Block Kit element types that carry persistent selection state and can
 * therefore appear inside a batched Submit form. Must stay aligned with
 * the non-button filter in `rewriteFormIfMultiInput` (parser).
 */
const STATEFUL_BLOCK_TYPES = new Set([
  'static_select',
  'multi_static_select',
  'radio_buttons',
  'checkboxes',
  'datepicker',
  'timepicker',
  'datetimepicker',
]);

export class SlackPlugin extends BasePlugin {
  readonly platform = 'slack';
  readonly capabilities: ChannelCapabilities = {
    supportsEditMessage: true,
    supportsThreads: true,
    supportsButtons: true,
    supportsSelects: true,
    supportsModals: true,
    supportsDatePicker: true,
    supportsReactions: true,
    supportsTyping: true,
    supportsUnfurlControl: true,
    supportsFileUpload: true,
    maxMessageLength: MARKDOWN_BLOCK_LIMIT,
    maxAttachmentBytes: 50 * 1024 * 1024,
    maxAttachmentsPerMessage: 10,
    supportsMarkdown: 'full',
    runtimeClass: 'official',
  };

  private app: App | null = null;
  private botToken: string | null = null;
  private botUserId: string | null = null;

  /**
   * Tracks threads where the bot has participated (replied or was @mentioned).
   * Messages in these threads are handled without requiring @mention.
   * Key: "channel:thread_ts", Value: { trackedAt, userIds }
   */
  private botThreads = new Map<
    string,
    { trackedAt: number; userIds: Set<string> }
  >();

  /** Bot threads expire after 24h to prevent unbounded memory growth. */
  private static readonly THREAD_TTL_MS = 24 * 60 * 60 * 1000;

  /** When 3+ unique humans are in a thread, require @mention to avoid interrupting. */
  private static readonly MULTI_USER_THRESHOLD = 3;

  /** Slack file upload cap — matches Telegram limit */
  private static readonly MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

  private getBotToken(): string {
    if (!this.botToken) throw new Error('Bot token not available');
    return this.botToken;
  }

  /** Register a thread as bot-participated. Track unique human users for multi-user detection. */
  private trackBotThread(
    channel: string,
    threadTs: string,
    userId?: string,
  ): void {
    const key = `${channel}:${threadTs}`;
    let entry = this.botThreads.get(key);
    if (!entry) {
      entry = { trackedAt: Date.now(), userIds: new Set() };
      this.botThreads.set(key, entry);
    } else {
      // Refresh TTL on activity so active threads don't expire mid-conversation
      entry.trackedAt = Date.now();
    }
    if (userId) entry.userIds.add(userId);
    // Lazy prune when map grows large
    if (this.botThreads.size > 200) this.pruneExpiredThreads();
  }

  private pruneExpiredThreads(): void {
    const now = Date.now();
    for (const [key, entry] of this.botThreads) {
      if (now - entry.trackedAt > SlackPlugin.THREAD_TTL_MS) {
        this.botThreads.delete(key);
      }
    }
  }

  private isBotThread(channel: string, threadTs: string): boolean {
    const key = `${channel}:${threadTs}`;
    const entry = this.botThreads.get(key);
    if (!entry) return false;
    if (Date.now() - entry.trackedAt > SlackPlugin.THREAD_TTL_MS) {
      this.botThreads.delete(key);
      return false;
    }
    return true;
  }

  /** Returns true when too many humans are talking — bot should stay silent unless @mentioned. */
  private isMultiUserThread(channel: string, threadTs: string): boolean {
    const key = `${channel}:${threadTs}`;
    const entry = this.botThreads.get(key);
    return (entry?.userIds.size ?? 0) >= SlackPlugin.MULTI_USER_THRESHOLD;
  }

  /**
   * Restore bot thread participation from the database on startup.
   * Queries channel_sessions + channel_messages for threads where the bot
   * has previously posted (direction='outbound'), then re-populates the
   * in-memory botThreads map so the bot continues responding in those
   * threads without requiring @mention.
   */
  private restoreBotThreads(configId: string): void {
    try {
      const db = getDatabase();
      const rows = db
        .prepare(
          `SELECT DISTINCT s.session_key
           FROM channel_sessions s
           JOIN channel_messages cm ON s.id = cm.session_id
           WHERE s.platform = 'slack'
             AND s.config_id = ?
             AND s.session_key LIKE '%:%'
             AND cm.direction = 'outbound'
             AND s.last_activity_at > datetime('now', '-1 day')`,
        )
        .all(configId) as Array<{ session_key: string }>;

      for (const row of rows) {
        const [channel, threadTs] = row.session_key.split(':') as [
          string,
          string,
        ];
        if (channel && threadTs) {
          // userIds are not restored from DB — isMultiUserThread() will
          // return false for restored threads until users post again,
          // at which point the set self-heals.
          this.botThreads.set(`${channel}:${threadTs}`, {
            trackedAt: Date.now(),
            userIds: new Set(),
          });
        }
      }

      if (rows.length > 0) {
        this.logger.info(`Restored ${rows.length} bot thread(s) from database`);
      }
    } catch (err) {
      // Non-fatal — bot will just require @mention in old threads
      this.logger.warn('Failed to restore bot threads from DB', { err });
    }
  }

  protected async onStart(config: BasePluginConfig): Promise<void> {
    let botToken: string;
    let appToken: string;
    try {
      const parsed = JSON.parse(config.token!) as {
        botToken: string;
        appToken: string;
      };
      botToken = parsed.botToken;
      appToken = parsed.appToken;
    } catch {
      throw new Error(
        'Slack token must be JSON: {"botToken": "xoxb-...", "appToken": "xapp-..."}',
      );
    }

    this.botToken = botToken;

    // Validate token before creating the Bolt App — App.start() fires an
    // async auth.test internally that can throw an unhandled rejection and
    // crash the process if the token is invalid.
    const { WebClient } = await import('@slack/web-api');
    const probe = new WebClient(botToken);
    const authResult = await probe.auth.test();
    if (!authResult.ok) {
      throw new Error(
        `Slack auth.test failed: ${authResult.error ?? 'unknown'}`,
      );
    }
    this.botUserId = authResult.user_id as string;
    this.logger.info(`Slack auth verified: bot=${this.botUserId}`);

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    // Catch async Bolt errors so they don't become unhandled rejections
    this.app.error(async (error) => {
      this.logger.error('Slack Bolt error:', error);
    });

    // DMs — read handler at dispatch time to avoid stale closure issues
    this.app.event('message', async ({ event, body }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgEvent = event as any;
      // Capture action_token from the event envelope — required by
      // assistant.search.context for bot-token searches.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actionToken: string | undefined = (body as any).event?.action_token;
      this.logger.debug(
        `Slack message event: subtype=${msgEvent.subtype ?? 'none'}, channel_type=${msgEvent.channel_type}, thread_ts=${msgEvent.thread_ts ?? 'none'}, bot_id=${msgEvent.bot_id ?? 'none'}`,
      );
      // Allow file_share subtype through for attachment handling
      if (msgEvent.subtype && msgEvent.subtype !== 'file_share') return;
      if (msgEvent.bot_id) return;

      // ── Thread-aware routing ──────────────────────────────────────────
      // 1:1 DMs (`im`): respond to every message — fully opt-in, one speaker.
      // Everything else (channels, private channels, group DMs `mpim`):
      // require @mention at root; respond in bot-participated threads where
      // fewer than 3 humans are talking. Treating mpim as a DM turned out to
      // be too chatty in multi-person group DMs.
      if (msgEvent.channel_type !== 'im') {
        const threadTs: string | undefined = msgEvent.thread_ts;
        // Root-level channel messages: skip (require @mention via app_mention)
        if (!threadTs) return;
        // Thread reply: check if this is a bot-participated thread
        const channel: string = msgEvent.channel ?? '';
        if (!this.isBotThread(channel, threadTs)) return;
        // Track this user for multi-user detection
        this.trackBotThread(channel, threadTs, msgEvent.user);
        // If 3+ humans are talking, stay silent (let app_mention handle if they want the bot)
        if (this.isMultiUserThread(channel, threadTs)) return;
        // Skip if message @mentions the bot — let app_mention handler take it
        // to avoid double-processing
        if (
          this.botUserId &&
          typeof msgEvent.text === 'string' &&
          msgEvent.text.includes(`<@${this.botUserId}>`)
        ) {
          return;
        }
      }

      const handler = this.getMessageHandler();
      if (!handler) return;

      // Voice message detection — Slack audio clips
      const files = msgEvent.files as
        | Array<{
            subtype?: string;
            url_private_download?: string;
            mimetype?: string;
            name?: string;
            duration_ms?: number;
            size?: number;
          }>
        | undefined;

      const voiceFile = files?.find((f) => f.subtype === 'slack_audio');
      if (voiceFile?.url_private_download) {
        try {
          const voiceInfo = await downloadSlackVoice(
            voiceFile,
            this.getBotToken(),
          );
          if (voiceInfo) {
            const normalized = toNormalizedMessage(
              msgEvent,
              false,
              this.configId,
            );
            if (actionToken && normalized.metadata) {
              normalized.metadata.actionToken = actionToken;
            }
            normalized.voice = voiceInfo;
            // Remove the voice file URL from attachments so it doesn't get
            // re-downloaded as an "image" and echoed back to the user.
            if (normalized.attachments) {
              normalized.attachments = normalized.attachments.filter(
                (url) => url !== voiceFile.url_private_download,
              );
              if (normalized.attachments.length === 0) {
                normalized.attachments = undefined;
              }
            }
            await handler(normalized);
            return;
          }
        } catch (err) {
          this.logger.error('Error handling Slack voice message', { err });
        }
      }

      // Also check event.attachments — forwarded/shared messages have empty
      // text and no files, but carry original content in attachments[].
      const hasSlackAttachments =
        Array.isArray(msgEvent.attachments) && msgEvent.attachments.length > 0;
      if (
        !msgEvent.text &&
        (!files || files.length === 0) &&
        !hasSlackAttachments
      ) {
        this.logger.warn(
          'Slack message dropped: empty text, no files, no attachments',
        );
        return;
      }
      const normalized = toNormalizedMessage(msgEvent, false, this.configId);
      if (actionToken && normalized.metadata) {
        normalized.metadata.actionToken = actionToken;
      }

      // Download Slack-hosted files to local temp paths.
      // Node.js fetch (undici) strips Authorization on cross-origin redirects
      // per WHATWG Fetch spec — Slack's file URLs redirect cross-origin.
      // Fix: redirect:'manual' + re-attach auth on every hop.
      // See: https://github.com/slackapi/bolt-js/issues/2069
      if (
        normalized.attachments &&
        normalized.attachments.length > 0 &&
        this.botToken
      ) {
        const localPaths = await this.downloadSlackFiles(
          normalized.attachments,
          files as Array<{ id: string; name?: string }> | undefined,
        );
        this.logger.debug(
          `Slack attachment download: ${localPaths.length}/${normalized.attachments.length} succeeded`,
        );
        if (localPaths.length > 0) {
          normalized.attachments = localPaths;
        }
      }

      await handler(normalized);
    });

    // @mentions in channels — strip the leading <@BOTID> tag before routing.
    // Also register the thread as bot-participated so future replies in the
    // same thread are handled without requiring @mention.
    this.app.event('app_mention', async ({ event, body }) => {
      const handler = this.getMessageHandler();
      if (!handler) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mentionEvent = event as any;
      const normalized = toNormalizedMessage(
        mentionEvent as Parameters<typeof toNormalizedMessage>[0],
        /* isMention */ true,
        this.configId,
      );
      const mentionActionToken: string | undefined = (
        body as Record<string, Record<string, string | undefined>>
      ).event?.action_token;
      if (mentionActionToken && normalized.metadata) {
        normalized.metadata.actionToken = mentionActionToken;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mentionFiles = mentionEvent.files as
        | Array<{ id: string; name?: string }>
        | undefined;
      if (
        normalized.attachments &&
        normalized.attachments.length > 0 &&
        this.botToken
      ) {
        const localPaths = await this.downloadSlackFiles(
          normalized.attachments,
          mentionFiles,
        );
        this.logger.debug(
          `app_mention attachment download: ${localPaths.length}/${normalized.attachments.length} succeeded`,
        );
        if (localPaths.length > 0) {
          normalized.attachments = localPaths;
        }
      }

      // Track this thread so subsequent replies don't need @mention
      const mentionChannel: string = mentionEvent.channel ?? '';
      const mentionThreadTs: string | undefined =
        mentionEvent.thread_ts ?? mentionEvent.ts;
      if (mentionChannel && mentionThreadTs) {
        this.trackBotThread(mentionChannel, mentionThreadTs, mentionEvent.user);
      }

      await handler(normalized);
    });

    // ── Assistant thread events ─────────────────────────────────────────────
    // Required for the "is typing..." shimmer and assistant.threads.setStatus
    // to work. Slack only sends these events when "Agents & AI Apps" is enabled
    // and the bot subscribes to assistant_thread_started / assistant_thread_context_changed.
    this.app.event('assistant_thread_started', async ({ event, client }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const thread = (event as any).assistant_thread as
        | {
            channel_id: string;
            thread_ts: string;
            context?: Record<string, unknown>;
          }
        | undefined;
      if (!thread) return;
      this.logger.debug('assistant_thread_started', {
        channel: thread.channel_id,
        thread_ts: thread.thread_ts,
      });

      // Set suggested prompts so the empty assistant container isn't blank.
      try {
        await client.assistant.threads.setSuggestedPrompts({
          channel_id: thread.channel_id,
          thread_ts: thread.thread_ts,
          title: 'How can I help you?',
          prompts: [
            { title: 'Help me with a task', message: 'Help me with a task' },
            {
              title: 'Summarize a document',
              message: 'Summarize a document for me',
            },
          ],
        });
      } catch (err) {
        this.logger.debug('setSuggestedPrompts failed', { err });
      }
    });

    // Context changes (user navigates channels while assistant panel is open)
    this.app.event('assistant_thread_context_changed', async ({ event }) => {
      this.logger.debug('assistant_thread_context_changed', { event });
    });

    // App Home opened — only the `home` tab matters now. The Home view
    // itself handles connect / pair / manage, so we no longer DM the user
    // on Messages / History tab opens (that was a pre-Phase-1 nudge whose
    // paired-user check was also broken — `getChannelUsers('slack')` was
    // calling a `configId`-keyed function with the platform string, so it
    // always failed to find the user and always re-DM'd).
    this.app.event('app_home_opened', async ({ event, client, body }) => {
      const tab = (event as { tab?: string }).tab;
      if (tab !== 'home') return;
      this.logger.info(
        `app_home_opened: user=${event.user} team=${
          (body as { team_id?: string }).team_id ?? 'unknown'
        }`,
      );
      const slackTeamId =
        (body as { team_id?: string }).team_id ??
        (event as { view?: { team_id?: string } }).view?.team_id ??
        '';
      if (!slackTeamId) {
        this.logger.warn(
          'app_home_opened (home): could not resolve slack_team_id',
          { body, event },
        );
        return;
      }
      await publishHomeView(
        { client },
        {
          slackTeamId,
          slackUserId: event.user,
          configId: this.configId,
        },
      );
    });

    // ── Channel membership events ────────────────────────────────────────
    // Detect when the bot is added to or removed from a channel.
    // Private channels cannot be self-joined (conversations.join only works
    // for public channels) — the bot must be explicitly invited by a member
    // or admin. Log membership changes for debugging.
    //
    // Requires bot event subscriptions: member_joined_channel, member_left_channel
    // Requires scopes: channels:read (public), groups:read (private)
    this.app.event('member_joined_channel', async ({ event }) => {
      if (event.user !== this.botUserId) return;
      const channelType = event.channel_type === 'G' ? 'private' : 'public';
      this.logger.info(`Bot added to ${channelType} channel: ${event.channel}`);
    });

    this.app.event('member_left_channel', async ({ event }) => {
      if (event.user !== this.botUserId) return;
      this.logger.info(`Bot removed from channel: ${event.channel}`);
    });

    // Lifecycle: app_uninstalled and tokens_revoked may arrive in either
    // order — treat both as idempotent best-effort cleanup. We never throw
    // on missing rows because Slack will retry the event, and a "row not
    // found" log line during a known uninstall is just noise.
    //
    // Per https://api.slack.com/events/tokens_revoked the inner event has
    // `tokens.{oauth, bot}` arrays of revoked user IDs. For our App Home
    // model we only care about user-bound link rows.
    this.app.event('app_uninstalled', async ({ body }) => {
      const teamId = (body as { team_id?: string }).team_id;
      if (!teamId) return;
      try {
        const removed = deleteSlackTeam(teamId);
        this.logger.info(
          `app_uninstalled: cleaned ${removed} Slack-bound row(s) for team ${teamId}`,
        );
      } catch (err) {
        this.logger.warn('app_uninstalled cleanup failed', { err });
      }
    });

    this.app.event('tokens_revoked', async ({ event, body }) => {
      const teamId = (body as { team_id?: string }).team_id;
      const tokens = (
        event as unknown as {
          tokens?: { oauth?: string[]; bot?: string[] };
        }
      ).tokens;
      if (!teamId || !tokens) return;
      const affectedUsers = [...(tokens.oauth ?? []), ...(tokens.bot ?? [])];
      if (affectedUsers.length === 0) return;
      try {
        let removed = 0;
        for (const userId of affectedUsers) {
          if (deleteSlackUserLink(teamId, userId)) removed++;
        }
        this.logger.info(
          `tokens_revoked: cleaned ${removed}/${affectedUsers.length} link(s) for team ${teamId}`,
        );
      } catch (err) {
        this.logger.warn('tokens_revoked cleanup failed', { err });
      }
    });

    // App Home block_actions and view_submissions live under the `home:*`
    // namespace so the broad `/^neuma:/` action handler (registered below)
    // does not double-dispatch.
    registerHomeHandlers({
      app: this.app,
      configId: this.configId,
      resolveDisplayName: async (client, slackUserId) => {
        try {
          const info = await client.users.info({ user: slackUserId });
          return (
            info.user?.profile?.display_name ||
            info.user?.real_name ||
            info.user?.name ||
            null
          );
        } catch {
          return null;
        }
      },
    });

    // Block Kit interactive actions. Flow:
    //   • Multi-input form (action_id under `neuma:form:…`, or state.values
    //     carries 2+ stateful widgets) → non-submit clicks just ack so
    //     users can adjust selections; Submit reads body.state.values,
    //     batches all selections into one handler call, and replaces the
    //     interactive blocks with a summary.
    //   • Single-input message → fire handler immediately, replace the
    //     block with "Selected: …".
    this.app.action(/^neuma:/, async ({ action, ack, body, client }) => {
      await ack();
      const handler = this.getMessageHandler();
      if (!handler) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = action as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = body as any;
      const channelId: string = b.channel?.id ?? '';
      const messageTs: string | undefined = b.message?.ts;
      const threadTs: string | undefined = b.message?.thread_ts ?? messageTs;
      const convId = threadTs ? `${channelId}:${threadTs}` : channelId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messageBlocks: any[] = Array.isArray(b.message?.blocks)
        ? b.message.blocks
        : [];
      const actionId = typeof a.action_id === 'string' ? a.action_id : '';
      const isFormAction = actionId.startsWith(FORM_ACTION_PREFIX);
      const isSubmit =
        actionId === FORM_SUBMIT_ACTION_ID ||
        actionId === LEGACY_SUBMIT_ACTION_ID;
      const isButton = a.type === 'button';
      // Fallback for messages posted before the form-namespace rewrite:
      // detect a form via state.values only if the primary signal missed.
      const isLikelyForm =
        isFormAction || countStatefulStateValues(b.state?.values) >= 2;

      // In-form click on a non-submit, non-button element: just ack.
      // Buttons still go through the legacy path so explicit CTAs work.
      if (isLikelyForm && !isSubmit && !isButton) return;

      const baseMeta = {
        channel: channelId,
        threadTs: threadTs ?? null,
        teamId: b.team?.id ?? null,
        channelType: channelId.startsWith('D') ? 'im' : 'channel',
      };

      if (isSubmit) {
        const collected = collectFormState(messageBlocks, b.state?.values);
        if (collected.length === 0) return;

        const combinedText = collected
          .map((e) => `${e.label}: ${e.value}`)
          .join('\n');
        const rawSummary = collected
          .map((e) => `*${escapeMrkdwn(e.label)}:* ${escapeMrkdwn(e.display)}`)
          .join('  •  ');
        // Slack enforces ~3000 chars per mrkdwn element. Leave headroom
        // for the "✅ Submitted:" prefix.
        const summaryLine =
          rawSummary.length > 2900
            ? rawSummary.slice(0, 2900) + '…'
            : rawSummary;

        if (channelId && messageTs) {
          try {
            const updatedBlocks = messageBlocks.filter(
              (blk) => blk?.type !== 'actions' && blk?.type !== 'input',
            );
            updatedBlocks.push({
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `\u2705 *Submitted:* ${summaryLine}`,
                },
              ],
            });
            await client.chat.update({
              channel: channelId,
              ts: messageTs,
              text: 'Submitted',
              blocks: updatedBlocks,
            });
          } catch (err) {
            this.logger.warn('chat.update for form submit summary failed', {
              err,
            });
          }
        }

        await handler({
          platform: 'slack',
          configId: this.configId,
          messageId: null,
          conversationId: convId,
          sessionKey: convId,
          userId: b.user?.id ?? 'unknown',
          text: combinedText,
          isCommand: false,
          metadata: baseMeta,
        });
        return;
      }

      // Single-input legacy path.
      const { value, display: displayLabel } = normalizeBlockKitValue(a);
      if (!value) return;

      if (channelId && messageTs && messageBlocks.length > 0) {
        try {
          const blockId: string | undefined = a.block_id;
          const updatedBlocks = messageBlocks.map((block) => {
            if (blockId && block.block_id === blockId) {
              return {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `\u2705 *Selected:* ${escapeMrkdwn(displayLabel)}`,
                  },
                ],
              };
            }
            return block;
          });
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: displayLabel,
            blocks: updatedBlocks,
          });
        } catch (err) {
          // Visual-only update — interaction still works if this fails
          // (e.g. message too old to update), but log so token/scope
          // problems aren't silently swallowed.
          this.logger.warn('chat.update for selection indicator failed', {
            err,
          });
        }
      }

      await handler({
        platform: 'slack',
        configId: this.configId,
        messageId: null,
        conversationId: convId,
        sessionKey: convId,
        userId: b.user?.id ?? 'unknown',
        text: value,
        isCommand: false,
        metadata: baseMeta,
      });
    });

    await this.app.start();

    // Set presence to "auto" so Slack shows the bot as active.
    // Requires "Always Show as Active" enabled in Slack app dashboard settings
    // for the green dot to appear (Socket Mode bots can't force-set "active").
    // On graceful shutdown we set "away" to override that toggle.
    await this.app.client.users
      .setPresence({ presence: 'auto' })
      .catch(() => {});

    // Restore thread participation from DB so the bot continues responding
    // in threads it was active in before the restart — without requiring @mention.
    this.restoreBotThreads(config.configId);
  }

  protected async onStop(): Promise<void> {
    // Signal offline before disconnecting — overrides "Always Show as Active"
    // so users see the bot go grey immediately on graceful shutdown.
    await this.app?.client.users
      .setPresence({ presence: 'away' })
      .catch(() => {});
    await this.app?.stop();
    this.app = null;
    this.botToken = null;
    this.botUserId = null;
    this.processingEmoji = null;
    this.botThreads.clear();
  }

  protected setupMessageHandler(
    _handler: (msg: NormalizedMessage) => Promise<void>,
  ): void {
    // Handler stored in base class; Slack uses event handlers registered in onStart
  }

  /** Split "channel:thread_ts" conversationId into parts */
  private parseConvId(id: string): { channel: string; thread_ts?: string } {
    if (id.includes(':')) {
      const [channel, thread_ts] = id.split(':') as [string, string];
      return { channel, thread_ts };
    }
    return { channel: id };
  }

  async sendMessage(
    conversationId: string,
    response: NormalizedResponse,
  ): Promise<{ messageId: string | null }> {
    if (!this.app) {
      this.logger.warn('Slack sendMessage skipped — app not started', {
        conversationId,
      });
      return { messageId: null };
    }

    const { channel, thread_ts } = this.parseConvId(conversationId);

    try {
      // Use Block Kit `type: "markdown"` for rendering (native CommonMark
      // support — tables, italic, lists). `text` is the notification/fallback
      // preview; mrkdwn conversion keeps that short form readable.
      const presentation = renderPresentationForChannel({
        platform: this.platform,
        capabilities: this.capabilities,
        response,
      });
      const blocks = [
        ...buildResponseBlocks(presentation.text, presentation.buttons),
        ...buildInteractiveActionsBlocks(presentation.blocks),
      ];
      const result = await this.app.client.chat.postMessage({
        channel,
        thread_ts,
        text: truncateForSlack(markdownToMrkdwn(presentation.text)),
        blocks,
        ...(response.unfurl === false
          ? { unfurl_links: false, unfurl_media: false }
          : {}),
      });
      if (thread_ts) this.trackBotThread(channel, thread_ts);
      this.logger.debug('Slack sendMessage ok', {
        channel,
        thread_ts,
        ts: result.ts,
      });
      return { messageId: result.ts ?? null };
    } catch (err) {
      this.logger.error('Slack sendMessage failed', { err, conversationId });
      return { messageId: null };
    }
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    if (!this.app) return;
    const { channel } = this.parseConvId(conversationId);
    try {
      const blocks = buildResponseBlocks(text);
      await this.app.client.chat.update({
        channel,
        ts: messageId,
        text: truncateForSlack(markdownToMrkdwn(text)),
        blocks,
      });
    } catch (err) {
      this.logger.warn('Slack editMessage failed', { err });
    }
  }

  getAuthToken(): string | undefined {
    return this.botToken ?? undefined;
  }

  getClient(): import('@slack/web-api').WebClient | null {
    return this.app?.client ?? null;
  }

  /**
   * Download Slack-hosted files to local temp paths.
   *
   * Slack's url_private_download redirects cross-origin (files.slack.com → CDN).
   * Node.js fetch strips Authorization on cross-origin redirects per WHATWG spec.
   * We handle redirects manually, re-attaching the auth header on every hop.
   *
   * @see https://github.com/slackapi/bolt-js/issues/2069
   * @see https://github.com/whatwg/fetch/issues/944
   */
  private async downloadSlackFiles(
    urls: string[],
    filesMeta?: Array<{ id: string; name?: string }>,
  ): Promise<string[]> {
    const token = this.getBotToken();
    const localPaths: string[] = [];
    const tmpDir = path.join(os.tmpdir(), 'neuma-slack-files');
    await fs.mkdir(tmpDir, { recursive: true });

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const origName = filesMeta?.[i]?.name ?? 'file';

      try {
        const res = await this.fetchWithSlackAuth(url, token);
        if (!res) {
          this.logger.warn('Slack file download failed, skipping', {
            file: origName,
          });
          continue;
        }

        const buf = Buffer.from(await res.arrayBuffer());
        if (
          buf.byteLength === 0 ||
          buf.byteLength > SlackPlugin.MAX_UPLOAD_BYTES
        ) {
          continue;
        }

        // Sanitize filename to prevent path traversal (origName is user-controlled)
        const safeName = path.basename(origName);
        const localPath = path.join(
          tmpDir,
          `${crypto.randomUUID().slice(0, 8)}-${safeName}`,
        );
        await fs.writeFile(localPath, buf);
        localPaths.push(localPath);
        this.logger.info(
          `Downloaded Slack file: ${origName} (${buf.byteLength} bytes)`,
        );
      } catch (err) {
        this.logger.warn('Failed to download Slack file', {
          file: origName,
          err,
        });
      }
    }

    return localPaths;
  }

  /** Slack-owned hostnames where it's safe to send the bot token */
  private static readonly SLACK_AUTH_HOSTS = [
    'files.slack.com',
    'slack-files.com',
    'slack-edge.com',
    'slack.com',
  ];

  /**
   * Fetch a Slack private URL with manual redirect handling.
   * Only attaches Authorization to Slack-owned hosts; follows
   * CDN redirects without auth (pre-signed URLs don't need it).
   * Returns the final successful Response, or null on failure.
   */
  private async fetchWithSlackAuth(
    fileUrl: string,
    token: string,
  ): Promise<Response | null> {
    try {
      const res = await downloadWithRedirects(fileUrl, {
        auth: `Bearer ${token}`,
        hosts: SlackPlugin.SLACK_AUTH_HOSTS,
        maxRedirects: 5,
        timeoutMs: 30_000,
      });
      if (!res.ok) {
        this.logger.warn('Slack file fetch failed', {
          status: res.status,
          url: fileUrl.slice(0, 80),
        });
        return null;
      }

      // Reject HTML login pages
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html')) {
        this.logger.warn('Slack file returned HTML (auth issue)', {
          url: fileUrl.slice(0, 80),
        });
        return null;
      }

      return res;
    } catch (err) {
      this.logger.warn('Slack file download failed', {
        err,
        url: fileUrl.slice(0, 80),
      });
      return null;
    }
  }

  /**
   * Set the assistant thread status — shows "BotName is typing..." at the
   * bottom of the thread and a status message (e.g. "Gathering information...")
   * as a shimmer indicator under the bot's name.
   *
   * Requires "Agents & AI Apps" enabled in the Slack app dashboard and the
   * `assistant:write` (or `chat:write`) scope.
   *
   * Pass an empty status string to clear the indicator.
   * Status auto-clears when the bot sends a reply, or after 2 minutes.
   *
   * @see https://docs.slack.dev/reference/methods/assistant.threads.setStatus/
   */
  async setThreadStatus(
    conversationId: string,
    status: string,
    loadingMessages?: string[],
  ): Promise<void> {
    if (!this.app) return;
    const { channel, thread_ts } = this.parseConvId(conversationId);
    if (!thread_ts) return; // assistant status only works in threads
    try {
      await this.app.client.assistant.threads.setStatus({
        channel_id: channel,
        thread_ts,
        status,
        ...(loadingMessages?.length
          ? { loading_messages: loadingMessages }
          : {}),
      });
    } catch (err) {
      // Graceful fallback — Agents & AI Apps may not be enabled,
      // or thread context isn't an assistant thread.
      this.logger.warn('assistant.threads.setStatus failed', {
        err,
        channel,
        thread_ts,
        status,
      });
    }
  }

  async sendTypingAction(conversationId: string): Promise<void> {
    await this.setThreadStatus(conversationId, 'Thinking...');
  }

  /**
   * Processing emoji: prefers custom animated `:loading:` spinner,
   * falls back to built-in ⏳ if workspace doesn't have it.
   * Resolved on first use and cached for the plugin lifetime.
   */
  private processingEmoji: string | null = null;

  /**
   * In-flight probe for the processing emoji. Concurrent first-time
   * callers all await this single promise instead of each running
   * their own probe (which would double-react on the first message).
   */
  private emojiProbe: Promise<string> | null = null;

  /**
   * Add a processing reaction to acknowledge the user's message.
   * On first call, probes for custom `:loading:` emoji; caches result.
   * Requires `reactions:write` scope.
   */
  async addReaction(channel: string, messageTs: string): Promise<void> {
    if (!this.app) return;

    // First call: probe whether custom :loading: emoji exists. The probe
    // itself adds the reaction to the first caller's message, so that
    // caller skips the follow-up add below. Concurrent callers await the
    // same probe promise and then add the resolved emoji to their own
    // messages.
    if (!this.processingEmoji) {
      let initiator = false;
      if (!this.emojiProbe) {
        initiator = true;
        const app = this.app;
        this.emojiProbe = (async () => {
          try {
            await app.client.reactions.add({
              channel,
              timestamp: messageTs,
              name: 'loading',
            });
            this.processingEmoji = 'loading';
            return 'loading';
          } catch {
            this.processingEmoji = 'hourglass_flowing_sand';
            return 'hourglass_flowing_sand';
          }
        })();
      }
      const emoji = await this.emojiProbe;
      if (initiator && emoji === 'loading') {
        // The probe's own add call already placed the reaction.
        return;
      }
      try {
        await this.app.client.reactions.add({
          channel,
          timestamp: messageTs,
          name: emoji,
        });
      } catch (err) {
        this.logger.debug('addReaction failed', { err, channel });
      }
      return;
    }

    try {
      await this.app.client.reactions.add({
        channel,
        timestamp: messageTs,
        name: this.processingEmoji,
      });
    } catch (err) {
      // Graceful — already_reacted, missing scope, etc.
      this.logger.debug('addReaction failed', { err, channel });
    }
  }

  /**
   * Add a specific named emoji reaction to a message.
   * Used for sentiment reactions (heart, thumbsup, bow, etc.).
   */
  async addNamedReaction(
    channel: string,
    messageTs: string,
    emoji: string,
  ): Promise<void> {
    if (!this.app) return;
    try {
      await this.app.client.reactions.add({
        channel,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (err) {
      // Graceful — invalid emoji name, missing scope, etc.
      this.logger.debug('addNamedReaction failed', { err, channel, emoji });
    }
  }

  /**
   * Remove the processing reaction after the bot has replied.
   */
  async removeReaction(channel: string, messageTs: string): Promise<void> {
    if (!this.app || !this.processingEmoji) return;
    try {
      await this.app.client.reactions.remove({
        channel,
        timestamp: messageTs,
        name: this.processingEmoji,
      });
    } catch (err) {
      // Graceful — no_reaction, missing scope, etc.
      this.logger.debug('removeReaction failed', { err, channel });
    }
  }

  async sendFiles(conversationId: string, filePaths: string[]): Promise<void> {
    if (!this.app || filePaths.length === 0) {
      if (filePaths.length > 0) {
        this.logger.warn('sendFiles skipped — Slack app not connected', {
          fileCount: filePaths.length,
        });
      }
      return;
    }

    const { channel, thread_ts } = this.parseConvId(conversationId);

    // Use files.uploadV2 — Slack's recommended helper that wraps the 3-step
    // (getUploadURLExternal → POST → completeUploadExternal) flow, batches
    // multiple files into a single share message, and applies retries.
    //   Docs: https://docs.slack.dev/messaging/working-with-files/
    const fileUploads: Array<{ file: Buffer; filename: string }> = [];

    for (const fp of filePaths) {
      let size: number;
      try {
        size = (await fs.stat(fp)).size;
      } catch {
        this.logger.warn(
          `sendFiles: file not found, skipping: ${path.basename(fp)}`,
        );
        continue;
      }

      if (size > SlackPlugin.MAX_UPLOAD_BYTES) {
        this.logger.warn(
          `File too large for Slack (${(size / 1024 / 1024).toFixed(1)}MB): ${path.basename(fp)}`,
        );
        continue;
      }

      try {
        const file = await fs.readFile(fp);
        fileUploads.push({ file, filename: path.basename(fp) });
      } catch (err) {
        this.logger.error('Slack sendFiles read failed', {
          err,
          file: path.basename(fp),
        });
      }
    }

    if (fileUploads.length === 0) return;

    // uploadV2 accepts up to 10 files per call; chunk to avoid a 400 on
    // turns that produce more than ten outputs.
    const CHUNK_SIZE = 10;
    for (let i = 0; i < fileUploads.length; i += CHUNK_SIZE) {
      const chunk = fileUploads.slice(i, i + CHUNK_SIZE);
      try {
        await this.app.client.files.uploadV2(
          thread_ts
            ? { channel_id: channel, thread_ts, file_uploads: chunk }
            : { channel_id: channel, file_uploads: chunk },
        );
      } catch (err) {
        this.logger.error('Slack files.uploadV2 failed', {
          err,
          fileCount: chunk.length,
          chunkIndex: i / CHUNK_SIZE,
          files: chunk.map((f) => f.filename),
        });
      }
    }
  }

  async sendPhotoUrls(conversationId: string, urls: string[]): Promise<void> {
    if (!this.app || urls.length === 0) return;

    const { channel, thread_ts } = this.parseConvId(conversationId);

    // Download each image and upload via 3-step Slack file API.
    // Block Kit image blocks require publicly accessible URLs, but CDN URLs
    // (e.g. BytePlus) are often temporary or geo-restricted.
    for (const url of urls) {
      // Defense-in-depth SSRF check — URLs come from agent tool output, but
      // prompt injection could inject arbitrary URLs for server-side fetch.
      const urlCheck = validateBaseUrl(url);
      if (!urlCheck.valid) {
        this.logger.warn('Blocked remote image URL (SSRF)', {
          url: url.slice(0, 80),
          reason: urlCheck.reason,
        });
        continue;
      }
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          this.logger.warn('Failed to download image URL', {
            status: res.status,
            url: url.slice(0, 80),
          });
          continue;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.byteLength > SlackPlugin.MAX_UPLOAD_BYTES) {
          this.logger.warn('Downloaded image too large for Slack upload');
          continue;
        }

        // CDNs often return 200 OK with HTML auth pages — without this
        // guard Slack renders the upload as "Binary".
        const imgCheck = validateImageResponse(res, buffer);
        if (!imgCheck.valid) {
          this.logger.warn('Skipped non-image response in sendPhotoUrls', {
            reason: imgCheck.reason,
            url: url.slice(0, 80),
          });
          continue;
        }
        const filename = `image-${crypto.randomUUID().slice(0, 8)}${imgCheck.ext}`;

        await this.app.client.files.uploadV2(
          thread_ts
            ? { channel_id: channel, thread_ts, file: buffer, filename }
            : { channel_id: channel, file: buffer, filename },
        );

        this.logger.info('Uploaded remote image to Slack', { filename });
      } catch (err) {
        this.logger.error('Slack sendPhotoUrls failed for URL', {
          err,
          url: url.slice(0, 80),
        });
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Escape Slack mrkdwn special characters so text renders literally. */
function escapeMrkdwn(text: string): string {
  return text.replace(/[*_~`]/g, (ch) => `\u200B${ch}`);
}

/**
 * Normalise any Block Kit interactive element (action payload or
 * state.values entry) into `{ value, display }`. Shared between the
 * single-click path and the Submit batching path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeBlockKitValue(e: any): { value: string; display: string } {
  if (!e) return { value: '', display: '' };
  switch (e.type) {
    case 'button':
      return { value: e.value ?? '', display: e.text?.text ?? e.value ?? '' };
    case 'static_select':
    case 'radio_buttons':
    case 'overflow':
      return {
        value: e.selected_option?.value ?? '',
        display:
          e.selected_option?.text?.text ?? e.selected_option?.value ?? '',
      };
    case 'multi_static_select':
    case 'checkboxes': {
      const opts = (e.selected_options ?? []) as {
        value: string;
        text?: { text?: string };
      }[];
      return {
        value: opts.map((o) => o.value).join(', '),
        display: opts.map((o) => o.text?.text ?? o.value).join(', '),
      };
    }
    case 'datepicker':
      return { value: e.selected_date ?? '', display: e.selected_date ?? '' };
    case 'timepicker':
      return { value: e.selected_time ?? '', display: e.selected_time ?? '' };
    case 'datetimepicker': {
      const ts = e.selected_date_time as number | undefined;
      const display = ts
        ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ')
        : '';
      return { value: ts?.toString() ?? '', display };
    }
    default:
      return { value: '', display: '' };
  }
}

/**
 * Count stateful widgets present in `state.values`. Fallback signal for
 * forms whose action_ids predate the `neuma:form:` rewrite.
 */
function countStatefulStateValues(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stateValues: Record<string, Record<string, any>> | undefined,
): number {
  if (!stateValues) return 0;
  let count = 0;
  for (const actionMap of Object.values(stateValues)) {
    for (const state of Object.values(actionMap)) {
      if (!state || typeof state !== 'object') continue;
      const t = (state as { type?: string }).type;
      if (t && STATEFUL_BLOCK_TYPES.has(t)) count++;
    }
  }
  return count;
}

/**
 * Walk `state.values` and pair each stateful entry with a label derived
 * from the corresponding element's placeholder/text, falling back to a
 * slug of the action_id.
 */
function collectFormState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messageBlocks: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stateValues: Record<string, Record<string, any>> | undefined,
): { label: string; value: string; display: string }[] {
  if (!stateValues) return [];
  const entries: { label: string; value: string; display: string }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blockMap = new Map<string, any>();
  for (const blk of messageBlocks) {
    if (blk?.block_id) blockMap.set(blk.block_id, blk);
  }

  for (const [blockId, actionMap] of Object.entries(stateValues)) {
    const block = blockMap.get(blockId);
    for (const [actionId, state] of Object.entries(actionMap)) {
      if (
        actionId === FORM_SUBMIT_ACTION_ID ||
        actionId === LEGACY_SUBMIT_ACTION_ID
      )
        continue;
      const extracted = normalizeBlockKitValue(state);
      // Unfilled widgets are omitted from the agent payload — the user
      // is treated as not having that field. Required-field semantics
      // (if ever needed) would have to be enforced client-side in the
      // agent prompt, since message actions blocks don't support them.
      if (!extracted.value && !extracted.display) continue;
      entries.push({
        label: deriveLabel(block, actionId),
        value: extracted.value,
        display: extracted.display || extracted.value,
      });
    }
  }
  return entries;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveLabel(block: any, actionId: string): string {
  if (block?.elements && Array.isArray(block.elements)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const el of block.elements as any[]) {
      if (el.action_id !== actionId) continue;
      const placeholder = el.placeholder?.text;
      if (typeof placeholder === 'string' && placeholder) return placeholder;
      const textLabel = el.text?.text;
      if (typeof textLabel === 'string' && textLabel) return textLabel;
      break;
    }
  }
  // e.g. "neuma:form:select:2_0" → "select 3"
  const m = actionId.match(/^neuma:(?:form:)?(\w+):(\d+)/);
  return m ? `${m[1]} ${Number(m[2]) + 1}` : 'input';
}
